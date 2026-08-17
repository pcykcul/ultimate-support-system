/**
 * Live chat — human-only, with honest presence. No auth: visitors hold a random token
 * minted at /start that scopes them to exactly one chat ticket.
 *
 * A chat is just a ticket on channel 'chat': staff reply through the normal tickets API,
 * and this module's SSE stream relays those replies by subscribing to the event bus.
 * Nothing here generates a reply — every message a visitor sees was typed by a person.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db, schema } from '../../db/index.js';
import { notFound, parse } from '../../lib/http.js';
import { applySla, onCustomerReply } from '../../lib/sla.js';
import { bus, type EventPayload } from '../../lib/events.js';
import {
  assertUuid,
  createTicket,
  loadTicketSummary,
  nextTicketNumber,
} from '../tickets/service.js';
import { expandSynonyms, searchPublishedFts, searchPublishedTrigram } from '../kb/lib.js';
import {
  chatPresence,
  chatSubject,
  loadChatHistory,
  loadChatMessage,
  newVisitorToken,
  storeVisitorToken,
  validateVisitorToken,
} from './service.js';

// Widget forms send empty strings for untouched fields — '' is accepted and treated as absent.
const startSchema = z.object({
  name: z.string().trim().max(120).optional(),
  email: z.union([z.string().trim().email(), z.literal('')]).optional(),
  message: z.string().min(1).max(10_000),
});

const tokenSchema = z.string().regex(/^[0-9a-f]{16,128}$/i, 'Invalid chat token');

const messageSchema = z.object({
  token: tokenSchema,
  body: z.string().min(1).max(10_000),
});

export default async function routes(app: FastifyInstance): Promise<void> {
  // ---- POST /start — open a chat: find-or-create the visitor, create the ticket, mint a token ----
  app.post('/start', async (req, reply) => {
    const input = parse(startSchema, req.body);
    const name = input.name?.trim() || undefined;
    const email = input.email?.trim() || undefined;

    let ticketId: string;
    let userId: string;
    if (email) {
      // Known email → the shared creation path: find-or-create by email, company
      // auto-association, SLA, the labeled receipt email, and the ticket.created event.
      const ticket = await createTicket({
        subject: chatSubject(input.message, name ?? email),
        body: input.message,
        requesterEmail: email,
        requesterName: name ?? null,
        channel: 'chat',
      });
      ticketId = ticket.id;
      userId = ticket.requester.id;
    } else {
      // Anonymous visitor: a lightweight customer user with no email — so no receipt to send;
      // the presence promise below is their receipt.
      const [visitor] = await db
        .insert(schema.users)
        .values({ kind: 'customer', name: name ?? 'Visitor', email: null })
        .returning();
      if (!visitor) throw new Error('Failed to create visitor user');

      const number = await nextTicketNumber();
      const [ticket] = await db
        .insert(schema.tickets)
        .values({
          number,
          subject: chatSubject(input.message, visitor.name),
          channel: 'chat',
          requesterId: visitor.id,
        })
        .returning();
      if (!ticket) throw new Error('Failed to create chat ticket');

      await db.insert(schema.ticketMessages).values({
        ticketId: ticket.id,
        kind: 'public',
        authorId: visitor.id,
        body: input.message,
        channel: 'chat',
      });

      await applySla(ticket.id);
      const fresh = await loadTicketSummary(ticket.id);
      if (!fresh) throw new Error('Ticket disappeared after creation');
      bus.emitEvent('ticket.created', { ticketId: ticket.id, ticket: fresh.ticket });

      ticketId = ticket.id;
      userId = visitor.id;
    }

    const visitorToken = newVisitorToken();
    await storeVisitorToken(visitorToken, ticketId, userId);
    const { online, promise } = await chatPresence(new Date());

    reply.code(201);
    return { ticketId, visitorToken, online, promise };
  });

  // ---- GET /:ticketId/stream?token= — SSE: history, then live public messages off the bus ----
  app.get('/:ticketId/stream', async (req, reply) => {
    const { ticketId } = req.params as { ticketId: string };
    assertUuid(ticketId, 'Ticket');
    const { token } = parse(z.object({ token: tokenSchema }), req.query);
    await validateVisitorToken(token, ticketId);
    const history = await loadChatHistory(ticketId);

    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    const write = (chunk: string) => {
      if (!res.writableEnded) res.write(chunk);
    };
    write('retry: 5000\n\n');
    write(`event: history\ndata: ${JSON.stringify(history)}\n\n`);

    // Comment heartbeat keeps proxies from idling the connection out.
    const heartbeat = setInterval(() => write(': heartbeat\n\n'), 25_000);

    // Relay every public message on this ticket — visitor echoes and staff replies alike.
    const onMessage = (payload: EventPayload) => {
      if (payload.ticketId !== ticketId || payload.kind !== 'public') return;
      const messageId = payload.messageId;
      if (typeof messageId !== 'string') return;
      loadChatMessage(messageId, ticketId)
        .then((message) => {
          if (message) write(`event: message\ndata: ${JSON.stringify(message)}\n\n`);
        })
        .catch((err) => req.log.warn({ err }, 'chat stream: failed to load message'));
    };
    bus.onEvent('message.created', onMessage);

    req.raw.on('close', () => {
      clearInterval(heartbeat);
      bus.off('message.created', onMessage);
      if (!res.writableEnded) res.end();
    });
  });

  // ---- POST /:ticketId/messages — visitor sends a message ----
  app.post('/:ticketId/messages', async (req, reply) => {
    const { ticketId } = req.params as { ticketId: string };
    assertUuid(ticketId, 'Ticket');
    const input = parse(messageSchema, req.body);
    const { userId } = await validateVisitorToken(input.token, ticketId);
    const row = await loadTicketSummary(ticketId);
    if (!row) throw notFound('Ticket');

    const now = new Date();
    const [message] = await db
      .insert(schema.ticketMessages)
      .values({ ticketId, kind: 'public', authorId: userId, body: input.body, channel: 'chat' })
      .returning();
    if (!message) throw new Error('Failed to create chat message');

    await onCustomerReply(ticketId, now);
    // Same shape the inbound-email module emits for customer replies.
    bus.emitEvent('message.created', {
      ticketId,
      messageId: message.id,
      kind: 'public',
      authorId: userId,
      authorKind: 'customer',
      channel: 'chat',
    });

    reply.code(201);
    const serialized = await loadChatMessage(message.id, ticketId);
    return (
      serialized ?? {
        id: message.id,
        body: message.body,
        author: null,
        createdAt: message.createdAt,
        fromCustomer: true,
      }
    );
  });

  // ---- GET /widget-search?q= — help-center search, logged as source='widget' ----
  // The widget is anonymous, so only audience='public' articles are searchable.
  app.get('/widget-search', async (req) => {
    const { q } = parse(z.object({ q: z.string().max(200).optional() }), req.query);
    const query = (q ?? '').trim();
    if (!query) return [];

    const expanded = await expandSynonyms(query);
    let hits = await searchPublishedFts(expanded, { publicOnly: true, limit: 10 });
    if (hits.length === 0) {
      hits = await searchPublishedTrigram(query, { publicOnly: true, limit: 10 });
    }

    await db.insert(schema.kbSearchQueries).values({
      query,
      resultCount: hits.length,
      source: 'widget',
    });

    return hits.map((h) => ({ id: h.id, title: h.title, slug: h.slug, snippet: h.snippet }));
  });
}
