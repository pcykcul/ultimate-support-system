/**
 * The SLA engine. Centralized so every module shares one implementation of the clock rules.
 *
 * Documented semantics (docs/product/02-feature-spec.md, Module 5):
 * - first_response: starts at ticket creation, satisfied by the first public agent reply. Never pauses.
 * - next_response: starts when the customer replies, satisfied by the next public agent reply.
 *   Cleared while the ticket waits on the customer.
 * - resolution: starts at creation, satisfied at solved. Pauses on waiting_on_customer / on_hold / solved
 *   (remaining business minutes parked on the ticket, rehydrated on reopen).
 * - periodic_update: evaluated by the sweep job — an open ticket must get a public update every N minutes.
 * - Targets are computed against the ticket's schedule: ticket.scheduleId ?? policy.scheduleId ??
 *   company.scheduleId ?? default schedule ?? 24/7.
 * - Policy resolution: company.slaPolicyId wins; otherwise the first enabled policy (by position)
 *   whose conditions match. Conditions: priorities/channels/companyTiers/tags, ANDed; empty = match-all.
 */
import { and, asc, eq, inArray } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import {
  addBusinessMinutes,
  businessMinutesBetween,
  type BusinessSchedule,
} from './hours.js';

type Ticket = typeof schema.tickets.$inferSelect;
type SlaPolicy = typeof schema.slaPolicies.$inferSelect;
type SlaTarget = typeof schema.slaTargets.$inferSelect;

export const PAUSED_STATUSES = ['waiting_on_customer', 'on_hold', 'solved', 'closed'] as const;

const CALENDAR_24_7: BusinessSchedule = { timezone: 'UTC', intervals: [], holidays: new Set() };

export async function loadBusinessSchedule(scheduleId: string | null): Promise<BusinessSchedule> {
  if (!scheduleId) return CALENDAR_24_7;
  const [sched] = await db
    .select()
    .from(schema.schedules)
    .where(eq(schema.schedules.id, scheduleId))
    .limit(1);
  if (!sched) return CALENDAR_24_7;
  const intervals = await db
    .select()
    .from(schema.scheduleIntervals)
    .where(eq(schema.scheduleIntervals.scheduleId, sched.id));
  const holidays = new Set<string>();
  if (sched.holidayCalendarId) {
    const rows = await db
      .select()
      .from(schema.holidays)
      .where(eq(schema.holidays.calendarId, sched.holidayCalendarId));
    for (const h of rows) holidays.add(h.date);
  }
  return {
    timezone: sched.timezone,
    intervals: intervals.map((i) => ({
      weekday: i.weekday,
      startMinute: i.startMinute,
      endMinute: i.endMinute,
    })),
    holidays,
  };
}

async function defaultScheduleId(): Promise<string | null> {
  const [row] = await db
    .select({ id: schema.schedules.id })
    .from(schema.schedules)
    .where(eq(schema.schedules.isDefault, true))
    .limit(1);
  return row?.id ?? null;
}

interface PolicyConditions {
  priorities?: string[];
  channels?: string[];
  companyTiers?: string[];
  tags?: string[];
}

function policyMatches(policy: SlaPolicy, ticket: Ticket, companyTier: string | null): boolean {
  const c = (policy.conditions ?? {}) as PolicyConditions;
  if (c.priorities?.length && !c.priorities.includes(ticket.priority)) return false;
  if (c.channels?.length && !c.channels.includes(ticket.channel)) return false;
  if (c.companyTiers?.length && (!companyTier || !c.companyTiers.includes(companyTier))) return false;
  if (c.tags?.length && !c.tags.some((t) => ticket.tags.includes(t))) return false;
  return true;
}

/** Resolve which policy + schedule apply to a ticket. */
export async function resolvePolicy(
  ticket: Ticket
): Promise<{ policy: SlaPolicy | null; scheduleId: string | null }> {
  let company: typeof schema.companies.$inferSelect | undefined;
  if (ticket.companyId) {
    [company] = await db
      .select()
      .from(schema.companies)
      .where(eq(schema.companies.id, ticket.companyId))
      .limit(1);
  }

  let policy: SlaPolicy | null = null;
  if (company?.slaPolicyId) {
    const [p] = await db
      .select()
      .from(schema.slaPolicies)
      .where(and(eq(schema.slaPolicies.id, company.slaPolicyId), eq(schema.slaPolicies.enabled, true)))
      .limit(1);
    policy = p ?? null;
  }
  if (!policy) {
    const candidates = await db
      .select()
      .from(schema.slaPolicies)
      .where(eq(schema.slaPolicies.enabled, true))
      .orderBy(asc(schema.slaPolicies.position));
    policy = candidates.find((p) => policyMatches(p, ticket, company?.tier ?? null)) ?? null;
  }

  const scheduleId =
    ticket.scheduleId ??
    policy?.scheduleId ??
    company?.scheduleId ??
    (await defaultScheduleId());
  return { policy, scheduleId };
}

async function targetsFor(policyId: string): Promise<SlaTarget[]> {
  return db.select().from(schema.slaTargets).where(eq(schema.slaTargets.policyId, policyId));
}

function target(
  targets: SlaTarget[],
  metric: (typeof schema.slaMetric.enumValues)[number],
  priority: string
): SlaTarget | undefined {
  return targets.find((t) => t.metric === metric && t.priority === priority);
}

async function dueFrom(
  start: Date,
  t: SlaTarget | undefined,
  scheduleId: string | null
): Promise<Date | null> {
  if (!t) return null;
  const schedule = t.useBusinessHours ? await loadBusinessSchedule(scheduleId) : CALENDAR_24_7;
  return addBusinessMinutes(start, t.minutes, schedule);
}

function minDate(...dates: (Date | null)[]): Date | null {
  const real = dates.filter((d): d is Date => d != null);
  if (!real.length) return null;
  return new Date(Math.min(...real.map((d) => d.getTime())));
}

async function persist(ticketId: string, patch: Partial<typeof schema.tickets.$inferInsert>) {
  await db.update(schema.tickets).set({ ...patch, updatedAt: new Date() }).where(eq(schema.tickets.id, ticketId));
}

async function refreshQueueFields(ticket: Ticket, patch: Partial<typeof schema.tickets.$inferInsert>) {
  const merged = { ...ticket, ...patch } as Ticket;
  const next = minDate(merged.firstResponseDueAt, merged.nextResponseDueAt, merged.resolutionDueAt);
  const breached = next != null && next.getTime() < Date.now();
  await persist(ticket.id, { ...patch, nextSlaDueAt: next, slaBreached: breached });
}

/** Apply (or re-apply) SLA policy to a ticket. Call on create and when priority/company/tags change. */
export async function applySla(ticketId: string): Promise<void> {
  const [ticket] = await db.select().from(schema.tickets).where(eq(schema.tickets.id, ticketId)).limit(1);
  if (!ticket) return;
  const { policy, scheduleId } = await resolvePolicy(ticket);
  if (!policy) {
    await refreshQueueFields(ticket, {
      slaPolicyId: null,
      scheduleId,
      firstResponseDueAt: null,
      nextResponseDueAt: null,
      resolutionDueAt: null,
    });
    return;
  }
  const targets = await targetsFor(policy.id);
  const patch: Partial<typeof schema.tickets.$inferInsert> = { slaPolicyId: policy.id, scheduleId };

  if (!ticket.firstRespondedAt) {
    patch.firstResponseDueAt = await dueFrom(
      ticket.createdAt,
      target(targets, 'first_response', ticket.priority),
      scheduleId
    );
  } else {
    patch.firstResponseDueAt = null;
  }

  if (ticket.lastCustomerReplyAt && !isPaused(ticket.status)) {
    const awaitingAgent =
      !ticket.lastPublicReplyAt || ticket.lastCustomerReplyAt > ticket.lastPublicReplyAt;
    patch.nextResponseDueAt = awaitingAgent
      ? await dueFrom(ticket.lastCustomerReplyAt, target(targets, 'next_response', ticket.priority), scheduleId)
      : null;
  }

  if (!isPaused(ticket.status)) {
    patch.resolutionDueAt = await dueFrom(
      ticket.createdAt,
      target(targets, 'resolution', ticket.priority),
      scheduleId
    );
    patch.slaPausedAt = null;
    patch.resolutionRemainingMinutes = null;
  }

  await refreshQueueFields(ticket, patch);
}

export function isPaused(status: string): boolean {
  return (PAUSED_STATUSES as readonly string[]).includes(status);
}

/** A public agent reply landed. */
export async function onAgentPublicReply(ticketId: string, at: Date): Promise<void> {
  const [ticket] = await db.select().from(schema.tickets).where(eq(schema.tickets.id, ticketId)).limit(1);
  if (!ticket) return;
  const patch: Partial<typeof schema.tickets.$inferInsert> = {
    lastPublicReplyAt: at,
    nextResponseDueAt: null,
  };
  if (!ticket.firstRespondedAt) {
    patch.firstRespondedAt = at;
    patch.firstResponseDueAt = null;
  }
  await refreshQueueFields(ticket, patch);
}

/** A customer reply landed. */
export async function onCustomerReply(ticketId: string, at: Date): Promise<void> {
  const [ticket] = await db.select().from(schema.tickets).where(eq(schema.tickets.id, ticketId)).limit(1);
  if (!ticket) return;
  const patch: Partial<typeof schema.tickets.$inferInsert> = { lastCustomerReplyAt: at };

  // Customer replying reopens waiting/solved tickets.
  let status = ticket.status;
  if (status === 'waiting_on_customer' || status === 'solved') {
    status = 'open';
    patch.status = status;
    Object.assign(patch, await unpauseResolution(ticket, at));
  }

  if (!isPaused(status) && ticket.slaPolicyId) {
    const targets = await targetsFor(ticket.slaPolicyId);
    patch.nextResponseDueAt = await dueFrom(
      at,
      target(targets, 'next_response', ticket.priority),
      ticket.scheduleId
    );
  }
  await refreshQueueFields(ticket, patch);
}

async function pauseResolution(ticket: Ticket, at: Date) {
  const patch: Partial<typeof schema.tickets.$inferInsert> = {
    slaPausedAt: at,
    nextResponseDueAt: null,
  };
  if (ticket.resolutionDueAt) {
    const schedule = await loadBusinessSchedule(ticket.scheduleId);
    patch.resolutionRemainingMinutes = Math.max(
      0,
      businessMinutesBetween(at, ticket.resolutionDueAt, schedule)
    );
    patch.resolutionDueAt = null;
  }
  return patch;
}

async function unpauseResolution(ticket: Ticket, at: Date) {
  const patch: Partial<typeof schema.tickets.$inferInsert> = {
    slaPausedAt: null,
  };
  if (ticket.resolutionRemainingMinutes != null) {
    const schedule = await loadBusinessSchedule(ticket.scheduleId);
    patch.resolutionDueAt = addBusinessMinutes(at, ticket.resolutionRemainingMinutes, schedule);
    patch.resolutionRemainingMinutes = null;
  }
  return patch;
}

/** Status transition hook — owns all pause/unpause bookkeeping. */
export async function onStatusChange(ticketId: string, newStatus: Ticket['status'], at: Date): Promise<void> {
  const [ticket] = await db.select().from(schema.tickets).where(eq(schema.tickets.id, ticketId)).limit(1);
  if (!ticket) return;
  const wasPaused = isPaused(ticket.status);
  const nowPaused = isPaused(newStatus);
  let patch: Partial<typeof schema.tickets.$inferInsert> = { status: newStatus };

  if (!wasPaused && nowPaused) {
    patch = { ...patch, ...(await pauseResolution(ticket, at)) };
  } else if (wasPaused && !nowPaused) {
    patch = { ...patch, ...(await unpauseResolution(ticket, at)) };
  }
  if (newStatus === 'solved') patch.solvedAt = at;
  if (newStatus === 'closed') patch.closedAt = at;

  await refreshQueueFields(ticket, patch);
}

/** Manual SLA extension (Freshdesk's liked feature) with audit trail. */
export async function extendSla(
  ticketId: string,
  metric: 'first_response' | 'next_response' | 'resolution',
  newDueAt: Date,
  actorId: string,
  reason: string
): Promise<void> {
  const [ticket] = await db.select().from(schema.tickets).where(eq(schema.tickets.id, ticketId)).limit(1);
  if (!ticket) return;
  const patch: Partial<typeof schema.tickets.$inferInsert> = {};
  if (metric === 'first_response') patch.firstResponseDueAt = newDueAt;
  if (metric === 'next_response') patch.nextResponseDueAt = newDueAt;
  if (metric === 'resolution') patch.resolutionDueAt = newDueAt;
  await refreshQueueFields(ticket, patch);
  await db.insert(schema.ticketEvents).values({
    ticketId,
    actorId,
    type: 'sla_extended',
    data: { metric, newDueAt: newDueAt.toISOString(), reason },
  });
}

/** Recompute breach flags for tickets whose due dates passed; returns tickets newly needing escalation. */
export async function sweepBreaches(now: Date): Promise<Ticket[]> {
  const due = await db
    .select()
    .from(schema.tickets)
    .where(
      and(
        inArray(schema.tickets.status, ['new', 'open', 'waiting_on_customer', 'on_hold']),
        eq(schema.tickets.slaBreached, false)
      )
    );
  const newlyBreached: Ticket[] = [];
  for (const t of due) {
    if (t.nextSlaDueAt && t.nextSlaDueAt.getTime() < now.getTime()) {
      await persist(t.id, { slaBreached: true });
      newlyBreached.push(t);
    }
  }
  return newlyBreached;
}
