/**
 * In-process event bus. Modules emit domain events; automations, webhooks, and SSE streams subscribe.
 * Deterministic and inspectable — the automation engine is rules, not a model.
 */
import { EventEmitter } from 'node:events';

export type DomainEvent =
  | 'ticket.created'
  | 'ticket.updated'
  | 'ticket.status_changed'
  | 'message.created'
  | 'sla.warning'
  | 'sla.breach'
  | 'kb.article_published'
  | 'sop.run_started'
  | 'sop.run_completed'
  | 'chat.message';

export interface EventPayload {
  [key: string]: unknown;
}

class Bus extends EventEmitter {
  emitEvent(event: DomainEvent, payload: EventPayload): void {
    this.emit(event, payload);
    this.emit('*', { event, payload });
  }

  onEvent(event: DomainEvent | '*', handler: (payload: EventPayload) => void): void {
    this.on(event, handler);
  }
}

export const bus = new Bus();
bus.setMaxListeners(100);
