/**
 * Ticket-state triggers: published runbook SOPs can declare, in sops.triggers,
 * the ticket conditions that auto-start a run — deterministic rules, never a model.
 *
 *   { onSlaBreach: true }        → start on 'sla.breach' for the breached ticket
 *   { onPriority: 'urgent' }     → start on 'ticket.updated' when priority matches
 *   { onTags: ['refund', ...] }  → start on 'ticket.updated' when any tag overlaps
 *
 * One run per SOP+ticket ever (dedupe check), so noisy events can't stack duplicates.
 */
import { and, eq } from 'drizzle-orm';
import { db, schema } from '../../db/index.js';
import { bus, type EventPayload } from '../../lib/events.js';
import { parseTriggers, startRun, type Sop, type TriggerConfig } from './lib.js';

type Ticket = typeof schema.tickets.$inferSelect;
type TriggerEvent = 'ticket.updated' | 'sla.breach';

function matches(event: TriggerEvent, trig: TriggerConfig, ticket: Ticket): boolean {
  if (event === 'sla.breach') return trig.onSlaBreach === true;
  // ticket.updated — any declared condition matching is enough.
  if (trig.onPriority && ticket.priority === trig.onPriority) return true;
  if (trig.onTags && trig.onTags.length > 0 && ticket.tags.some((t) => trig.onTags!.includes(t))) {
    return true;
  }
  return false;
}

async function handleEvent(event: TriggerEvent, payload: EventPayload): Promise<void> {
  const ticketId = typeof payload.ticketId === 'string' ? payload.ticketId : null;
  if (!ticketId) return;

  const [ticket] = await db
    .select()
    .from(schema.tickets)
    .where(eq(schema.tickets.id, ticketId))
    .limit(1);
  if (!ticket) return;

  const candidates: Sop[] = await db
    .select()
    .from(schema.sops)
    .where(and(eq(schema.sops.status, 'published'), eq(schema.sops.kind, 'runbook')));

  for (const sop of candidates) {
    const trig = parseTriggers(sop.triggers);
    if (!matches(event, trig, ticket)) continue;

    // Dedupe: never start a second run of the same SOP for the same ticket.
    const existing = await db
      .select({ id: schema.sopRuns.id })
      .from(schema.sopRuns)
      .where(and(eq(schema.sopRuns.sopId, sop.id), eq(schema.sopRuns.ticketId, ticket.id)))
      .limit(1);
    if (existing[0]) continue;

    await startRun(sop, { ticketId: ticket.id, startedById: null, auto: true, trigger: event });
  }
}

let subscribed = false;

/** Called once at plugin registration: wires SOP auto-start triggers to the event bus. */
export function registerSopTriggers(): void {
  if (subscribed) return;
  subscribed = true;
  for (const event of ['ticket.updated', 'sla.breach'] as const) {
    bus.onEvent(event, (payload) => {
      void handleEvent(event, payload).catch((err) =>
        console.error(`sop trigger error on ${event}`, err)
      );
    });
  }
}
