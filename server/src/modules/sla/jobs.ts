/**
 * SLA background jobs.
 *
 * - 'sla.sweep' runs every minute (self-re-enqueueing, deduped): flags newly breached
 *   tickets via lib/sla sweepBreaches, records audit events, emits 'sla.breach', and
 *   schedules per-policy escalation ('sla.escalate') and pre-breach warning ('sla.warn')
 *   notifications from the policy's slaEscalations rows. The sweep also evaluates the
 *   periodic_update metric: new/open tickets whose policy sets a periodic_update target
 *   for their priority must get a public agent update every N minutes — when the silence
 *   exceeds the target, the assignee (supervisors when unassigned) is mailed once per
 *   silence window, with an 'sla_periodic_due' audit row and an 'sla.warning' bus event.
 * - 'sla.warn' / 'sla.escalate' re-check the ticket still has the due unmet before mailing
 *   the assignee (and supervisors / extra users when the escalation says so) — a satisfied
 *   or extended SLA silently cancels the notification.
 * - Settings key 'notifications' ({ slaWarning: { enabled }, slaBreach: { enabled } })
 *   gates the *emails* only — audit rows and bus events still happen so automations and
 *   the ticket timeline stay complete. A missing key or field means enabled.
 *
 * Every mail is an internal staff notification; the audit trail lives in ticket_events.
 */
import { and, eq, gte, inArray, isNotNull, lte } from 'drizzle-orm';
import { db, schema } from '../../db/index.js';
import { bus } from '../../lib/events.js';
import { businessMinutesBetween, type BusinessSchedule } from '../../lib/hours.js';
import { enqueueJob, registerJobHandler } from '../../lib/jobs.js';
import { sendMail } from '../../lib/mailer.js';
import { loadBusinessSchedule, sweepBreaches } from '../../lib/sla.js';

const SWEEP_INTERVAL_MS = 60_000;
const WARNING_LOOKAHEAD_MS = 120 * 60_000;
const OPEN_STATUSES = ['new', 'open', 'waiting_on_customer', 'on_hold'] as const;

type Ticket = typeof schema.tickets.$inferSelect;
type Metric = (typeof schema.slaMetric.enumValues)[number];

/** The due timestamp a metric is measured against (periodic_update has no due column). */
function dueFor(ticket: Ticket, metric: string): Date | null {
  switch (metric) {
    case 'first_response':
      return ticket.firstResponseDueAt;
    case 'next_response':
      return ticket.nextResponseDueAt;
    case 'resolution':
      return ticket.resolutionDueAt;
    default:
      return null;
  }
}

function breachedMetrics(ticket: Ticket, now: Date): { metric: Metric; dueAt: Date }[] {
  const metrics: Metric[] = ['first_response', 'next_response', 'resolution'];
  const out: { metric: Metric; dueAt: Date }[] = [];
  for (const metric of metrics) {
    const dueAt = dueFor(ticket, metric);
    if (dueAt && dueAt.getTime() < now.getTime()) out.push({ metric, dueAt });
  }
  return out;
}

async function escalationsForPolicy(policyId: string) {
  return db
    .select()
    .from(schema.slaEscalations)
    .where(eq(schema.slaEscalations.policyId, policyId));
}

/** Email on/off switches from the settings key 'notifications'. Missing key/fields = enabled. */
async function notificationToggles(): Promise<{ slaWarning: boolean; slaBreach: boolean }> {
  try {
    const [row] = await db
      .select()
      .from(schema.settings)
      .where(eq(schema.settings.key, 'notifications'))
      .limit(1);
    const v = (row?.value ?? {}) as {
      slaWarning?: { enabled?: boolean };
      slaBreach?: { enabled?: boolean };
    };
    return {
      slaWarning: v.slaWarning?.enabled !== false,
      slaBreach: v.slaBreach?.enabled !== false,
    };
  } catch {
    return { slaWarning: true, slaBreach: true };
  }
}

interface NotifyPayload {
  ticketId: string;
  metric: string;
  level: number;
}

function parseNotifyPayload(payload: Record<string, unknown>): NotifyPayload | null {
  const ticketId = payload.ticketId;
  const metric = payload.metric;
  const level = payload.level;
  if (typeof ticketId !== 'string' || typeof metric !== 'string') return null;
  return { ticketId, metric, level: typeof level === 'number' ? level : 1 };
}

/** Collect recipient emails per the escalation's notify flags. */
async function collectRecipients(
  ticket: Ticket,
  escalation: typeof schema.slaEscalations.$inferSelect | undefined
): Promise<string[]> {
  const notifyAssignee = escalation?.notifyAssignee ?? true;
  const notifySupervisors = escalation?.notifySupervisors ?? false;
  const emails = new Set<string>();

  if (notifyAssignee && ticket.assigneeId) {
    const [assignee] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, ticket.assigneeId))
      .limit(1);
    if (assignee?.active && assignee.email) emails.add(assignee.email);
  }
  if (notifySupervisors) {
    const supervisors = await db
      .select()
      .from(schema.users)
      .where(
        and(
          eq(schema.users.kind, 'staff'),
          inArray(schema.users.role, ['supervisor', 'admin']),
          eq(schema.users.active, true),
          isNotNull(schema.users.email)
        )
      );
    for (const s of supervisors) if (s.email) emails.add(s.email);
  }
  if (escalation?.notifyUserIds?.length) {
    const extras = await db
      .select()
      .from(schema.users)
      .where(inArray(schema.users.id, escalation.notifyUserIds));
    for (const u of extras) if (u.active && u.email) emails.add(u.email);
  }
  return [...emails];
}

/** Shared warn/escalate notifier: re-check, mail, audit. */
async function handleNotification(kind: 'warn' | 'escalate', payload: Record<string, unknown>): Promise<void> {
  const parsed = parseNotifyPayload(payload);
  if (!parsed) return;
  const [ticket] = await db
    .select()
    .from(schema.tickets)
    .where(eq(schema.tickets.id, parsed.ticketId))
    .limit(1);
  if (!ticket) return;
  if (ticket.status === 'solved' || ticket.status === 'closed') return;

  // Re-check: a cleared due means the metric was satisfied — nothing to nag about.
  const dueAt = dueFor(ticket, parsed.metric);
  if (!dueAt) return;
  // An extension can push a breached due back into the future — the escalation is moot.
  if (kind === 'escalate' && dueAt.getTime() > Date.now()) return;

  let escalation: typeof schema.slaEscalations.$inferSelect | undefined;
  if (ticket.slaPolicyId) {
    [escalation] = await db
      .select()
      .from(schema.slaEscalations)
      .where(
        and(
          eq(schema.slaEscalations.policyId, ticket.slaPolicyId),
          eq(schema.slaEscalations.metric, parsed.metric as Metric),
          eq(schema.slaEscalations.level, parsed.level)
        )
      )
      .limit(1);
  }

  const recipients = await collectRecipients(ticket, escalation);
  const subject = `[SLA] #${ticket.number} ${kind === 'warn' ? 'warning' : 'breach escalation'}`;
  const minutes = Math.round(Math.abs(dueAt.getTime() - Date.now()) / 60_000);
  const timing =
    kind === 'warn'
      ? `due at ${dueAt.toISOString()} (in about ${minutes} min)`
      : `was due at ${dueAt.toISOString()} (about ${minutes} min ago)`;
  const text = [
    `Ticket #${ticket.number}: ${ticket.subject}`,
    ``,
    kind === 'warn'
      ? `SLA warning — the "${parsed.metric}" target is ${timing}.`
      : `SLA breach escalation (level ${parsed.level}) — the "${parsed.metric}" target ${timing}.`,
    `Status: ${ticket.status} · Priority: ${ticket.priority}`,
    ``,
    `This is an automated SLA notification for the support team.`,
  ].join('\n');

  // Warnings ride the slaWarning toggle, breach escalations the slaBreach toggle.
  const toggles = await notificationToggles();
  const emailEnabled = kind === 'warn' ? toggles.slaWarning : toggles.slaBreach;
  const notified: string[] = [];
  if (emailEnabled) {
    for (const to of recipients) {
      await sendMail({ to, subject, text, ticketId: ticket.id });
      notified.push(to);
    }
  }

  await db.insert(schema.ticketEvents).values({
    ticketId: ticket.id,
    type: kind === 'warn' ? 'sla_warning_sent' : 'sla_escalated',
    data: {
      metric: parsed.metric,
      level: parsed.level,
      dueAt: dueAt.toISOString(),
      notified,
    },
  });

  if (kind === 'warn') {
    bus.emitEvent('sla.warning', {
      ticketId: ticket.id,
      number: ticket.number,
      metric: parsed.metric,
      level: parsed.level,
      dueAt: dueAt.toISOString(),
    });
  }
}

/** Periodic-update recipients: the assignee, or supervisors/admins when unassigned (or unmailable). */
async function periodicRecipients(ticket: Ticket): Promise<string[]> {
  if (ticket.assigneeId) {
    const [assignee] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, ticket.assigneeId))
      .limit(1);
    if (assignee?.active && assignee.email) return [assignee.email];
  }
  const supervisors = await db
    .select()
    .from(schema.users)
    .where(
      and(
        eq(schema.users.kind, 'staff'),
        inArray(schema.users.role, ['supervisor', 'admin']),
        eq(schema.users.active, true),
        isNotNull(schema.users.email)
      )
    );
  const emails = new Set<string>();
  for (const s of supervisors) if (s.email) emails.add(s.email);
  return [...emails];
}

/**
 * Periodic-update pass: a new/open ticket whose policy sets a periodic_update target for
 * its priority must receive a public agent update every N minutes (business or calendar
 * minutes per the target). Silence is measured from max(lastPublicReplyAt, createdAt).
 */
async function sweepPeriodicUpdates(now: Date): Promise<void> {
  const tickets = await db
    .select()
    .from(schema.tickets)
    .where(
      and(
        inArray(schema.tickets.status, ['new', 'open']),
        isNotNull(schema.tickets.slaPolicyId)
      )
    );
  if (!tickets.length) return;

  const policyIds = [...new Set(tickets.map((t) => t.slaPolicyId).filter((id): id is string => id != null))];
  if (!policyIds.length) return;
  const targets = await db
    .select()
    .from(schema.slaTargets)
    .where(
      and(
        inArray(schema.slaTargets.policyId, policyIds),
        eq(schema.slaTargets.metric, 'periodic_update')
      )
    );
  if (!targets.length) return;

  const toggles = await notificationToggles();

  // Schedules repeat across tickets — load each at most once per sweep.
  const scheduleCache = new Map<string, BusinessSchedule>();
  const cachedSchedule = async (scheduleId: string | null): Promise<BusinessSchedule> => {
    const key = scheduleId ?? '';
    let sched = scheduleCache.get(key);
    if (!sched) {
      sched = await loadBusinessSchedule(scheduleId);
      scheduleCache.set(key, sched);
    }
    return sched;
  };

  for (const ticket of tickets) {
    const target = targets.find(
      (t) => t.policyId === ticket.slaPolicyId && t.priority === ticket.priority
    );
    if (!target || target.minutes <= 0) continue;

    const anchor =
      ticket.lastPublicReplyAt && ticket.lastPublicReplyAt > ticket.createdAt
        ? ticket.lastPublicReplyAt
        : ticket.createdAt;
    const elapsed = target.useBusinessHours
      ? businessMinutesBetween(anchor, now, await cachedSchedule(ticket.scheduleId))
      : Math.floor((now.getTime() - anchor.getTime()) / 60_000);
    if (elapsed < target.minutes) continue;

    // Dedupe on the audit row, not an enqueueJob dedupeKey: the jobs unique index only
    // holds while a job is *pending*, so one sweep after the notify job completed the
    // same bucket key would re-enqueue and nag every minute. The sla_periodic_due
    // ticket_events row is permanent, survives restarts, and resets itself — the next
    // public reply moves the anchor past any earlier row, re-arming the check.
    const [already] = await db
      .select({ id: schema.ticketEvents.id })
      .from(schema.ticketEvents)
      .where(
        and(
          eq(schema.ticketEvents.ticketId, ticket.id),
          eq(schema.ticketEvents.type, 'sla_periodic_due'),
          gte(schema.ticketEvents.createdAt, anchor)
        )
      )
      .limit(1);
    if (already) continue;

    const recipients = await periodicRecipients(ticket);
    const subject = `[SLA] #${ticket.number} periodic update due`;
    const cadence = `${target.minutes}${target.useBusinessHours ? ' business' : ''} min`;
    const text = [
      `Ticket #${ticket.number}: ${ticket.subject}`,
      ``,
      `SLA periodic update due — no public update for about ${elapsed} min (target: every ${cadence}).`,
      `Status: ${ticket.status} · Priority: ${ticket.priority}`,
      ``,
      `This is an automated SLA notification for the support team.`,
    ].join('\n');

    const notified: string[] = [];
    if (toggles.slaWarning) {
      for (const to of recipients) {
        await sendMail({ to, subject, text, ticketId: ticket.id });
        notified.push(to);
      }
    }

    await db.insert(schema.ticketEvents).values({
      ticketId: ticket.id,
      type: 'sla_periodic_due',
      data: {
        metric: 'periodic_update',
        targetMinutes: target.minutes,
        elapsedMinutes: elapsed,
        useBusinessHours: target.useBusinessHours,
        since: anchor.toISOString(),
        notified,
      },
    });

    bus.emitEvent('sla.warning', {
      ticketId: ticket.id,
      number: ticket.number,
      metric: 'periodic_update',
      targetMinutes: target.minutes,
      elapsedMinutes: elapsed,
    });
  }
}

async function runSweep(): Promise<void> {
  // Keep the loop alive first — a failure below must not stop future sweeps.
  await enqueueJob('sla.sweep', {}, { runAt: new Date(Date.now() + SWEEP_INTERVAL_MS), dedupeKey: 'sla-sweep' });

  const now = new Date();
  const newlyBreached = await sweepBreaches(now);

  for (const ticket of newlyBreached) {
    const breaches = breachedMetrics(ticket, now);
    for (const b of breaches) {
      await db.insert(schema.ticketEvents).values({
        ticketId: ticket.id,
        type: 'sla_breach',
        data: { metric: b.metric, dueAt: b.dueAt.toISOString() },
      });
    }
    bus.emitEvent('sla.breach', {
      ticketId: ticket.id,
      number: ticket.number,
      metrics: breaches.map((b) => b.metric),
    });

    if (!ticket.slaPolicyId) continue;
    const escalations = await escalationsForPolicy(ticket.slaPolicyId);
    for (const b of breaches) {
      for (const esc of escalations) {
        if (esc.metric !== b.metric || esc.minutesOffset < 0) continue;
        await enqueueJob(
          'sla.escalate',
          { ticketId: ticket.id, metric: esc.metric, level: esc.level },
          {
            runAt: new Date(b.dueAt.getTime() + esc.minutesOffset * 60_000),
            dedupeKey: `sla.escalate:${ticket.id}:${esc.metric}:${esc.level}`,
          }
        );
      }
    }
  }

  // Pre-breach warnings for tickets coming due inside the lookahead window.
  const horizon = new Date(now.getTime() + WARNING_LOOKAHEAD_MS);
  const dueSoon = await db
    .select()
    .from(schema.tickets)
    .where(
      and(
        inArray(schema.tickets.status, [...OPEN_STATUSES]),
        isNotNull(schema.tickets.slaPolicyId),
        gte(schema.tickets.nextSlaDueAt, now),
        lte(schema.tickets.nextSlaDueAt, horizon)
      )
    );
  for (const ticket of dueSoon) {
    const escalations = await escalationsForPolicy(ticket.slaPolicyId!);
    for (const esc of escalations) {
      if (esc.minutesOffset >= 0) continue;
      const dueAt = dueFor(ticket, esc.metric);
      if (!dueAt) continue;
      const runAt = new Date(dueAt.getTime() + esc.minutesOffset * 60_000);
      if (runAt.getTime() < now.getTime()) continue; // warning moment already passed
      await enqueueJob(
        'sla.warn',
        { ticketId: ticket.id, metric: esc.metric, level: esc.level },
        { runAt, dedupeKey: `sla.warn:${ticket.id}:${esc.metric}:${esc.level}` }
      );
    }
  }

  await sweepPeriodicUpdates(now);
}

export function registerSlaJobs(): void {
  registerJobHandler('sla.sweep', async () => runSweep());
  registerJobHandler('sla.warn', async (payload) => handleNotification('warn', payload));
  registerJobHandler('sla.escalate', async (payload) => handleNotification('escalate', payload));

  // Kick off the sweep loop; the dedupe key makes this a no-op when one is already pending.
  void enqueueJob('sla.sweep', {}, { dedupeKey: 'sla-sweep' }).catch((err) =>
    console.error('failed to enqueue initial sla.sweep job', err)
  );
}
