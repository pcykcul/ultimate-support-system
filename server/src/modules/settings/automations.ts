/**
 * The automations engine: deterministic if-this-then-that rules over ticket events.
 * A rule either matches or it doesn't — no models, no scoring — and every ticket
 * mutation it makes is audited to ticket_events (type 'automation').
 */
import { and, asc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../../db/index.js';
import { bus, type EventPayload } from '../../lib/events.js';
import { sendMail } from '../../lib/mailer.js';
import { applySla } from '../../lib/sla.js';
import { enqueueWebhookDelivery } from './webhook-jobs.js';

export const AUTOMATION_EVENTS = [
  'ticket.created',
  'ticket.updated',
  'message.created',
  'sla.warning',
  'sla.breach',
] as const;
export type AutomationEvent = (typeof AUTOMATION_EVENTS)[number];

export const conditionsSchema = z.object({
  priorities: z.array(z.enum(schema.ticketPriority.enumValues)).optional(),
  channels: z.array(z.enum(schema.ticketChannel.enumValues)).optional(),
  tags: z.array(z.string().min(1)).optional(),
  statuses: z.array(z.enum(schema.ticketStatus.enumValues)).optional(),
});

export const actionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('assign_team'), teamId: z.string().uuid() }),
  z.object({ type: z.literal('set_priority'), priority: z.enum(schema.ticketPriority.enumValues) }),
  z.object({ type: z.literal('add_tags'), tags: z.array(z.string().min(1)).min(1) }),
  z.object({ type: z.literal('notify'), userIds: z.array(z.string().uuid()).min(1) }),
  z.object({ type: z.literal('start_sop'), sopId: z.string().uuid() }),
  z.object({ type: z.literal('send_webhook'), webhookId: z.string().uuid() }),
]);
export const actionsSchema = z.array(actionSchema);

export type AutomationAction = z.infer<typeof actionSchema>;

type Ticket = typeof schema.tickets.$inferSelect;
type Automation = typeof schema.automations.$inferSelect;

/** Conditions are ANDed; an empty/missing field matches everything (same shape as SLA policies). */
export function conditionsMatch(raw: unknown, ticket: Ticket): boolean {
  const parsed = conditionsSchema.safeParse(raw ?? {});
  if (!parsed.success) return false;
  const c = parsed.data;
  if (c.priorities?.length && !c.priorities.includes(ticket.priority)) return false;
  if (c.channels?.length && !c.channels.includes(ticket.channel)) return false;
  if (c.statuses?.length && !c.statuses.includes(ticket.status)) return false;
  if (c.tags?.length && !c.tags.some((t) => ticket.tags.includes(t))) return false;
  return true;
}

async function audit(rule: Automation, ticketId: string, data: Record<string, unknown>): Promise<void> {
  await db.insert(schema.ticketEvents).values({
    ticketId,
    actorId: null,
    type: 'automation',
    data: { automationId: rule.id, automationName: rule.name, ...data },
  });
}

async function reloadTicket(ticketId: string, fallback: Ticket): Promise<Ticket> {
  const [fresh] = await db
    .select()
    .from(schema.tickets)
    .where(eq(schema.tickets.id, ticketId))
    .limit(1);
  return fresh ?? fallback;
}

async function notifyUsers(
  rule: Automation,
  userIds: string[],
  ticket: Ticket,
  event: AutomationEvent
): Promise<void> {
  const users = await db
    .select()
    .from(schema.users)
    .where(and(inArray(schema.users.id, userIds), eq(schema.users.active, true)));
  for (const user of users) {
    if (!user.email) continue;
    await sendMail({
      to: user.email,
      subject: `[Notification] Ticket #${ticket.number}: ${ticket.subject}`,
      text: [
        `Hi ${user.name},`,
        '',
        `The automation rule "${rule.name}" matched ticket #${ticket.number} (event: ${event}).`,
        '',
        `Subject: ${ticket.subject}`,
        `Status: ${ticket.status} — Priority: ${ticket.priority}`,
        '',
        'This is an automated notification from a deterministic rule — the ticket itself is handled by a real person.',
      ].join('\n'),
      ticketId: ticket.id,
    });
  }
}

async function startSopRun(rule: Automation, sopId: string, ticket: Ticket): Promise<void> {
  const [sop] = await db.select().from(schema.sops).where(eq(schema.sops.id, sopId)).limit(1);
  if (!sop) return; // rule points at a deleted SOP — nothing to start

  // Don't stack duplicate runs when a noisy rule fires repeatedly on the same ticket.
  const existing = await db
    .select({ id: schema.sopRuns.id })
    .from(schema.sopRuns)
    .where(
      and(
        eq(schema.sopRuns.sopId, sopId),
        eq(schema.sopRuns.ticketId, ticket.id),
        eq(schema.sopRuns.status, 'in_progress')
      )
    )
    .limit(1);
  if (existing[0]) return;

  const steps = await db
    .select()
    .from(schema.sopSteps)
    .where(eq(schema.sopSteps.sopId, sopId))
    .orderBy(asc(schema.sopSteps.position));

  const [run] = await db
    .insert(schema.sopRuns)
    .values({ sopId, sopVersion: sop.version, ticketId: ticket.id, startedById: null })
    .returning();
  if (!run) return;
  if (steps.length > 0) {
    await db.insert(schema.sopRunSteps).values(
      steps.map((s) => ({ runId: run.id, stepId: s.id, position: s.position, title: s.title }))
    );
  }
  await audit(rule, ticket.id, { action: 'start_sop', sopId, sopTitle: sop.title, runId: run.id });
  bus.emitEvent('sop.run_started', { runId: run.id, sopId, ticketId: ticket.id });
}

async function executeAction(
  rule: Automation,
  action: AutomationAction,
  ticket: Ticket,
  event: AutomationEvent,
  payload: EventPayload
): Promise<{ ticket: Ticket; mutated: boolean }> {
  switch (action.type) {
    case 'assign_team': {
      if (ticket.teamId === action.teamId) return { ticket, mutated: false };
      const [updated] = await db
        .update(schema.tickets)
        .set({ teamId: action.teamId, updatedAt: new Date() })
        .where(eq(schema.tickets.id, ticket.id))
        .returning();
      await audit(rule, ticket.id, { action: 'assign_team', teamId: action.teamId });
      return { ticket: updated ?? ticket, mutated: true };
    }
    case 'set_priority': {
      if (ticket.priority === action.priority) return { ticket, mutated: false };
      await db
        .update(schema.tickets)
        .set({ priority: action.priority, updatedAt: new Date() })
        .where(eq(schema.tickets.id, ticket.id));
      await applySla(ticket.id); // priority drives SLA targets — recompute due dates
      await audit(rule, ticket.id, {
        action: 'set_priority',
        from: ticket.priority,
        priority: action.priority,
      });
      return { ticket: await reloadTicket(ticket.id, ticket), mutated: true };
    }
    case 'add_tags': {
      const merged = [...new Set([...ticket.tags, ...action.tags])];
      if (merged.length === ticket.tags.length) return { ticket, mutated: false };
      const [updated] = await db
        .update(schema.tickets)
        .set({ tags: merged, updatedAt: new Date() })
        .where(eq(schema.tickets.id, ticket.id))
        .returning();
      await audit(rule, ticket.id, { action: 'add_tags', tags: action.tags });
      return { ticket: updated ?? ticket, mutated: true };
    }
    case 'notify': {
      await notifyUsers(rule, action.userIds, ticket, event);
      return { ticket, mutated: false };
    }
    case 'start_sop': {
      await startSopRun(rule, action.sopId, ticket);
      return { ticket, mutated: false };
    }
    case 'send_webhook': {
      await enqueueWebhookDelivery(action.webhookId, event, {
        ...payload,
        ticketId: ticket.id,
        automation: { id: rule.id, name: rule.name },
      });
      return { ticket, mutated: false };
    }
  }
}

/** Tickets currently being mutated by an automation run — events for them are skipped (loop guard). */
const inFlight = new Set<string>();

async function runAutomations(event: AutomationEvent, payload: EventPayload): Promise<void> {
  const ticketId = typeof payload.ticketId === 'string' ? payload.ticketId : null;
  // The inFlight check runs synchronously (before any await), so events emitted by an
  // automation's own ticket updates are dropped before they can re-trigger the engine.
  if (!ticketId || inFlight.has(ticketId)) return;

  const rules = await db
    .select()
    .from(schema.automations)
    .where(and(eq(schema.automations.event, event), eq(schema.automations.enabled, true)))
    .orderBy(asc(schema.automations.createdAt));
  if (rules.length === 0) return;

  const [ticket] = await db
    .select()
    .from(schema.tickets)
    .where(eq(schema.tickets.id, ticketId))
    .limit(1);
  if (!ticket) return;

  const matched = rules.filter((r) => conditionsMatch(r.conditions, ticket));
  if (matched.length === 0) return;

  inFlight.add(ticketId);
  try {
    let current = ticket;
    let mutatedTicket = false;
    for (const rule of matched) {
      const actions = actionsSchema.safeParse(rule.actions);
      if (!actions.success) continue; // malformed actions — skip the rule rather than crash the bus
      for (const action of actions.data) {
        const result = await executeAction(rule, action, current, event, payload);
        current = result.ticket;
        mutatedTicket = mutatedTicket || result.mutated;
      }
    }
    if (mutatedTicket) {
      // Emitted while still in flight, so our own subscription ignores it; SSE/webhooks still see it.
      bus.emitEvent('ticket.updated', { ticketId, ticket: current, changes: { automation: true } });
    }
  } finally {
    inFlight.delete(ticketId);
  }
}

let subscribed = false;

/** Called once at plugin registration: wires the engine to the event bus. */
export function registerAutomationEngine(): void {
  if (subscribed) return;
  subscribed = true;
  for (const event of AUTOMATION_EVENTS) {
    bus.onEvent(event, (payload) => {
      void runAutomations(event, payload).catch((err) =>
        console.error(`automation engine error on ${event}`, err)
      );
    });
  }
}
