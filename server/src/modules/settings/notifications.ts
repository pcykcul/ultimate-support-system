/**
 * Staff alert notifications + the CSAT customer email, driven by the event bus.
 *
 * Settings key 'notifications' controls which alerts fire. All alerts here are
 * STAFF-facing (the tickets module already sends the customer receipt and agent
 * reply emails — we never duplicate those); the only customer-facing mail is the
 * CSAT request on solve, which is sent at most once per ticket.
 *
 * Bus handlers never throw: every one is wrapped in try/catch and logs failures,
 * and an in-memory recent-key set keeps re-emitted events idempotent-ish.
 */
import type { FastifyInstance } from 'fastify';
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import { z } from 'zod';
import { config } from '../../config.js';
import { db, schema } from '../../db/index.js';
import { bus, type EventPayload } from '../../lib/events.js';
import { sendMail, sendTemplatedMail } from '../../lib/mailer.js';

// ---- Settings shape ----

export interface NotificationSettings {
  newTicket: { enabled: boolean; notifyTeam: boolean };
  customerReply: { enabled: boolean };
  assignment: { enabled: boolean };
  slaWarning: { enabled: boolean };
  slaBreach: { enabled: boolean };
  csatOnSolve: { enabled: boolean };
}

export const DEFAULT_NOTIFICATIONS: NotificationSettings = {
  newTicket: { enabled: true, notifyTeam: true },
  customerReply: { enabled: true },
  assignment: { enabled: true },
  slaWarning: { enabled: true },
  slaBreach: { enabled: true },
  csatOnSolve: { enabled: true },
};

const enabledSchema = z.object({ enabled: z.boolean().optional() }).optional();

/** Tolerant of partial/stale stored values — merge fills the gaps with defaults. */
export const notificationsPutSchema = z.object({
  newTicket: z
    .object({ enabled: z.boolean().optional(), notifyTeam: z.boolean().optional() })
    .optional(),
  customerReply: enabledSchema,
  assignment: enabledSchema,
  slaWarning: enabledSchema,
  slaBreach: enabledSchema,
  csatOnSolve: enabledSchema,
});

export function mergeNotificationSettings(raw: unknown): NotificationSettings {
  const parsed = notificationsPutSchema.safeParse(raw ?? {});
  const s = parsed.success ? parsed.data : {};
  const d = DEFAULT_NOTIFICATIONS;
  return {
    newTicket: {
      enabled: s.newTicket?.enabled ?? d.newTicket.enabled,
      notifyTeam: s.newTicket?.notifyTeam ?? d.newTicket.notifyTeam,
    },
    customerReply: { enabled: s.customerReply?.enabled ?? d.customerReply.enabled },
    assignment: { enabled: s.assignment?.enabled ?? d.assignment.enabled },
    slaWarning: { enabled: s.slaWarning?.enabled ?? d.slaWarning.enabled },
    slaBreach: { enabled: s.slaBreach?.enabled ?? d.slaBreach.enabled },
    csatOnSolve: { enabled: s.csatOnSolve?.enabled ?? d.csatOnSolve.enabled },
  };
}

export async function loadNotificationSettings(): Promise<NotificationSettings> {
  try {
    const [row] = await db
      .select()
      .from(schema.settings)
      .where(eq(schema.settings.key, 'notifications'))
      .limit(1);
    return mergeNotificationSettings(row?.value);
  } catch {
    return DEFAULT_NOTIFICATIONS;
  }
}

export async function saveNotificationSettings(
  value: NotificationSettings
): Promise<NotificationSettings> {
  await db
    .insert(schema.settings)
    .values({ key: 'notifications', value, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: schema.settings.key,
      set: { value, updatedAt: new Date() },
    });
  return value;
}

// ---- Helpers ----

type Ticket = typeof schema.tickets.$inferSelect;
type User = typeof schema.users.$inferSelect;

async function loadTicket(id: string): Promise<Ticket | null> {
  const [ticket] = await db.select().from(schema.tickets).where(eq(schema.tickets.id, id)).limit(1);
  return ticket ?? null;
}

async function loadUser(id: string): Promise<User | null> {
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, id)).limit(1);
  return user ?? null;
}

async function brandName(): Promise<string> {
  try {
    const [row] = await db
      .select()
      .from(schema.settings)
      .where(eq(schema.settings.key, 'branding'))
      .limit(1);
    const name = (row?.value as { name?: string } | undefined)?.name;
    return name?.trim() || 'Support';
  } catch {
    return 'Support';
  }
}

function ticketUrl(ticketId: string): string {
  return `${config.appUrl}/tickets/${ticketId}`;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/** Bounded in-memory dedupe so a re-emitted event doesn't re-send the same alert. */
const recentKeys = new Set<string>();
function alreadySent(key: string): boolean {
  if (recentKeys.has(key)) return true;
  recentKeys.add(key);
  if (recentKeys.size > 1000) {
    const oldest = recentKeys.values().next().value;
    if (oldest !== undefined) recentKeys.delete(oldest);
  }
  return false;
}

const AUTOMATED_FOOTER =
  'This is an automated staff alert — the ticket itself is handled by a real person.';

// ---- Handlers ----

/** New ticket → email the assigned team's members, or every acting agent when unassigned. */
async function onTicketCreated(payload: EventPayload): Promise<void> {
  const ticketId = str(payload.ticketId);
  if (!ticketId || alreadySent(`new:${ticketId}`)) return;
  const settings = await loadNotificationSettings();
  if (!settings.newTicket.enabled) return;
  const ticket = await loadTicket(ticketId);
  if (!ticket) return;

  let recipients: User[] = [];
  if (ticket.teamId) {
    const rows = await db
      .select({ user: schema.users })
      .from(schema.teamMembers)
      .innerJoin(schema.users, eq(schema.teamMembers.userId, schema.users.id))
      .where(and(eq(schema.teamMembers.teamId, ticket.teamId), eq(schema.users.active, true)));
    recipients = rows.map((r) => r.user);
  } else if (settings.newTicket.notifyTeam) {
    // No team on the ticket: fall back to every staff member who can act on it.
    recipients = await db
      .select()
      .from(schema.users)
      .where(
        and(
          eq(schema.users.kind, 'staff'),
          eq(schema.users.active, true),
          isNotNull(schema.users.email),
          inArray(schema.users.role, ['admin', 'supervisor', 'agent'])
        )
      );
  }

  const brand = await brandName();
  for (const user of recipients) {
    if (!user.email || user.kind !== 'staff') continue;
    await sendMail({
      to: user.email,
      subject: `[New ticket] #${ticket.number} ${ticket.subject}`,
      text: [
        `Hi ${user.name},`,
        '',
        `A new ticket just arrived: #${ticket.number} — ${ticket.subject}`,
        `Priority: ${ticket.priority} · Channel: ${ticket.channel}`,
        '',
        `Open it: ${ticketUrl(ticket.id)}`,
        '',
        `${AUTOMATED_FOOTER} — ${brand}`,
      ].join('\n'),
      ticketId: ticket.id,
    });
  }
}

/** Customer replied → email the assignee (nothing to do when unassigned). */
async function onMessageCreated(payload: EventPayload): Promise<void> {
  const ticketId = str(payload.ticketId);
  const messageId = str(payload.messageId);
  const isCustomer = payload.customer === true || payload.authorKind === 'customer';
  if (!ticketId || !isCustomer || payload.kind === 'internal') return;
  if (alreadySent(`reply:${messageId ?? ticketId}`)) return;
  const settings = await loadNotificationSettings();
  if (!settings.customerReply.enabled) return;
  const ticket = await loadTicket(ticketId);
  if (!ticket?.assigneeId) return;
  const assignee = await loadUser(ticket.assigneeId);
  if (!assignee?.active || !assignee.email) return;

  const brand = await brandName();
  await sendMail({
    to: assignee.email,
    subject: `[Reply] #${ticket.number} ${ticket.subject}`,
    text: [
      `Hi ${assignee.name},`,
      '',
      `The customer replied on ticket #${ticket.number} — ${ticket.subject}.`,
      '',
      `Open it: ${ticketUrl(ticket.id)}`,
      '',
      `${AUTOMATED_FOOTER} — ${brand}`,
    ].join('\n'),
    ticketId: ticket.id,
  });
}

/** Assignment change → email the new assignee. */
async function onTicketUpdated(payload: EventPayload): Promise<void> {
  const ticketId = str(payload.ticketId);
  const changes = payload.changes as Record<string, { from?: unknown; to?: unknown }> | undefined;
  const newAssigneeId = str(changes?.assigneeId?.to);
  if (!ticketId || !newAssigneeId) return;
  if (alreadySent(`assign:${ticketId}:${newAssigneeId}`)) return;
  const settings = await loadNotificationSettings();
  if (!settings.assignment.enabled) return;
  const [ticket, assignee] = await Promise.all([loadTicket(ticketId), loadUser(newAssigneeId)]);
  if (!ticket || !assignee?.active || !assignee.email) return;

  const brand = await brandName();
  await sendMail({
    to: assignee.email,
    subject: `You were assigned #${ticket.number} ${ticket.subject}`,
    text: [
      `Hi ${assignee.name},`,
      '',
      `Ticket #${ticket.number} — ${ticket.subject} — was just assigned to you.`,
      `Status: ${ticket.status} · Priority: ${ticket.priority}`,
      '',
      `Open it: ${ticketUrl(ticket.id)}`,
      '',
      `${AUTOMATED_FOOTER} — ${brand}`,
    ].join('\n'),
    ticketId: ticket.id,
  });
}

/** Solved → CSAT request to the requester, at most once per ticket (durable via ticket_events). */
async function onStatusChanged(payload: EventPayload): Promise<void> {
  const ticketId = str(payload.ticketId);
  if (!ticketId || payload.to !== 'solved') return;
  const settings = await loadNotificationSettings();
  if (!settings.csatOnSolve.enabled) return;

  // Durable once-per-ticket guard: re-solving after a reopen must not nag the customer again.
  const [sentBefore] = await db
    .select({ id: schema.ticketEvents.id })
    .from(schema.ticketEvents)
    .where(
      and(eq(schema.ticketEvents.ticketId, ticketId), eq(schema.ticketEvents.type, 'csat_request_sent'))
    )
    .limit(1);
  if (sentBefore) return;

  const ticket = await loadTicket(ticketId);
  if (!ticket) return;
  const requester = await loadUser(ticket.requesterId);
  if (!requester?.email) return;
  const assignee = ticket.assigneeId ? await loadUser(ticket.assigneeId) : null;

  await sendTemplatedMail(
    'csat_request',
    requester.email,
    {
      'customer.name': requester.name,
      'ticket.number': ticket.number,
      'ticket.subject': ticket.subject,
      'agent.name': assignee?.name ?? 'our support team',
      'csat.url': `${config.appUrl}/portal/tickets/${ticket.id}`,
      'brand.name': await brandName(),
    },
    { ticketId: ticket.id }
  );
  await db.insert(schema.ticketEvents).values({
    ticketId: ticket.id,
    type: 'csat_request_sent',
    data: { to: requester.email },
  });
}

/**
 * SLA breach → email the assignee, but only when the ticket's policy has no at/after-breach
 * escalation that already notifies the assignee (the SLA module mails those — never double-send).
 */
async function onSlaBreach(payload: EventPayload): Promise<void> {
  const ticketId = str(payload.ticketId);
  const metrics = Array.isArray(payload.metrics)
    ? payload.metrics.filter((m): m is string => typeof m === 'string')
    : [];
  if (!ticketId || metrics.length === 0) return;
  if (alreadySent(`breach:${ticketId}:${metrics.join(',')}`)) return;
  const settings = await loadNotificationSettings();
  if (!settings.slaBreach.enabled) return;
  const ticket = await loadTicket(ticketId);
  if (!ticket?.assigneeId) return;

  if (ticket.slaPolicyId) {
    const escalations = await db
      .select()
      .from(schema.slaEscalations)
      .where(eq(schema.slaEscalations.policyId, ticket.slaPolicyId));
    const covered = escalations.some(
      (e) =>
        e.minutesOffset >= 0 && e.notifyAssignee && metrics.includes(e.metric)
    );
    if (covered) return; // the policy's own escalation already emails the assignee
  }

  const assignee = await loadUser(ticket.assigneeId);
  if (!assignee?.active || !assignee.email) return;
  await sendTemplatedMail(
    'sla_alert',
    assignee.email,
    {
      'ticket.number': ticket.number,
      'ticket.subject': ticket.subject,
      'ticket.url': ticketUrl(ticket.id),
      'alert.kind': 'breached',
      'alert.detail': `The ${metrics.join(', ')} SLA target${metrics.length > 1 ? 's are' : ' is'} now past due.`,
      'brand.name': await brandName(),
    },
    { ticketId: ticket.id }
  );
}

/**
 * SLA warning → the SLA module has already mailed the escalation's recipients by the time this
 * event fires, so we only fill the gap: email the assignee when that escalation deliberately
 * skipped them (notifyAssignee=false, e.g. a supervisors-only warning rule).
 */
async function onSlaWarning(payload: EventPayload): Promise<void> {
  const ticketId = str(payload.ticketId);
  const metric = str(payload.metric);
  const level = typeof payload.level === 'number' ? payload.level : 1;
  if (!ticketId || !metric) return;
  if (alreadySent(`warn:${ticketId}:${metric}:${level}`)) return;
  const settings = await loadNotificationSettings();
  if (!settings.slaWarning.enabled) return;
  const ticket = await loadTicket(ticketId);
  if (!ticket?.assigneeId) return;

  if (ticket.slaPolicyId) {
    const [escalation] = await db
      .select()
      .from(schema.slaEscalations)
      .where(
        and(
          eq(schema.slaEscalations.policyId, ticket.slaPolicyId),
          eq(schema.slaEscalations.metric, metric as (typeof schema.slaMetric.enumValues)[number]),
          eq(schema.slaEscalations.level, level)
        )
      )
      .limit(1);
    if (escalation?.notifyAssignee) return; // already mailed by the SLA module's warn job
  }

  const assignee = await loadUser(ticket.assigneeId);
  if (!assignee?.active || !assignee.email) return;
  const dueAt = str(payload.dueAt);
  await sendTemplatedMail(
    'sla_alert',
    assignee.email,
    {
      'ticket.number': ticket.number,
      'ticket.subject': ticket.subject,
      'ticket.url': ticketUrl(ticket.id),
      'alert.kind': 'warning',
      'alert.detail': `The ${metric} SLA target is coming up${dueAt ? ` (due ${dueAt})` : ''}.`,
      'brand.name': await brandName(),
    },
    { ticketId: ticket.id }
  );
}

// ---- Registration ----

let subscribed = false;

/** Called once at settings plugin registration: wires the alert handlers to the event bus. */
export function registerNotifications(app: FastifyInstance): void {
  if (subscribed) return;
  subscribed = true;

  const wrap = (name: string, handler: (payload: EventPayload) => Promise<void>) => {
    return (payload: EventPayload) => {
      void handler(payload).catch((err) => app.log.error({ err }, `notification handler failed: ${name}`));
    };
  };

  bus.onEvent('ticket.created', wrap('ticket.created', onTicketCreated));
  bus.onEvent('message.created', wrap('message.created', onMessageCreated));
  bus.onEvent('ticket.updated', wrap('ticket.updated', onTicketUpdated));
  bus.onEvent('ticket.status_changed', wrap('ticket.status_changed', onStatusChanged));
  bus.onEvent('sla.breach', wrap('sla.breach', onSlaBreach));
  bus.onEvent('sla.warning', wrap('sla.warning', onSlaWarning));
}
