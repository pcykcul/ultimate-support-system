/**
 * SLA background jobs.
 *
 * - 'sla.sweep' runs every minute (self-re-enqueueing, deduped): flags newly breached
 *   tickets via lib/sla sweepBreaches, records audit events, emits 'sla.breach', and
 *   schedules per-policy escalation ('sla.escalate') and pre-breach warning ('sla.warn')
 *   notifications from the policy's slaEscalations rows.
 * - 'sla.warn' / 'sla.escalate' re-check the ticket still has the due unmet before mailing
 *   the assignee (and supervisors / extra users when the escalation says so) — a satisfied
 *   or extended SLA silently cancels the notification.
 *
 * Every mail is an internal staff notification; the audit trail lives in ticket_events.
 */
import { and, eq, gte, inArray, isNotNull, lte } from 'drizzle-orm';
import { db, schema } from '../../db/index.js';
import { bus } from '../../lib/events.js';
import { enqueueJob, registerJobHandler } from '../../lib/jobs.js';
import { sendMail } from '../../lib/mailer.js';
import { sweepBreaches } from '../../lib/sla.js';

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

  for (const to of recipients) {
    await sendMail({ to, subject, text, ticketId: ticket.id });
  }

  await db.insert(schema.ticketEvents).values({
    ticketId: ticket.id,
    type: kind === 'warn' ? 'sla_warning_sent' : 'sla_escalated',
    data: {
      metric: parsed.metric,
      level: parsed.level,
      dueAt: dueAt.toISOString(),
      notified: recipients,
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
