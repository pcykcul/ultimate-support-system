/**
 * Provider-agnostic inbound email webhook. A tiny mapper in front of Postmark/SES/Mailgun
 * POSTs `{from, to?, subject, text, messageId?, inReplyTo?}` here with the shared secret.
 * Threads into an existing ticket by In-Reply-To (against tickets.email_message_ids) or the
 * `[#123]` subject marker; otherwise opens a new ticket on the email channel with a receipt.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq, sql } from 'drizzle-orm';
import { db, schema } from '../../db/index.js';
import { config } from '../../config.js';
import { parse, unauthorized } from '../../lib/http.js';
import { onCustomerReply } from '../../lib/sla.js';
import { bus } from '../../lib/events.js';
import {
  createTicket,
  findOrCreateCustomerByEmail,
  stripAngles,
  trackEmailMessageId,
} from '../tickets/service.js';

const inboundSchema = z.object({
  from: z.object({
    email: z.string().email(),
    name: z.string().optional(),
  }),
  to: z.string().optional(),
  subject: z.string().optional(),
  text: z.string().optional(),
  messageId: z.string().optional(),
  inReplyTo: z.string().optional(),
});

const SUBJECT_TICKET_RE = /\[#(\d+)\]/;

export default async function routes(app: FastifyInstance): Promise<void> {
  app.post('/', async (req, reply) => {
    const secret = req.headers['x-inbound-secret'];
    if (typeof secret !== 'string' || secret !== config.inboundEmailSecret) {
      throw unauthorized('Invalid inbound email secret');
    }
    const input = parse(inboundSchema, req.body);
    const subject = input.subject?.trim() || '(no subject)';
    const text = input.text?.trim() || '(empty message)';
    const messageId = input.messageId ? stripAngles(input.messageId) : null;

    // 1) Thread by In-Reply-To against the message-ids we've seen/sent on each ticket.
    let ticket: typeof schema.tickets.$inferSelect | undefined;
    if (input.inReplyTo) {
      const ref = stripAngles(input.inReplyTo);
      [ticket] = await db
        .select()
        .from(schema.tickets)
        .where(sql`${schema.tickets.emailMessageIds} @> ARRAY[${ref}]::text[]`)
        .limit(1);
    }
    // 2) Fall back to the [#123] marker our outbound subjects carry.
    if (!ticket) {
      const marker = subject.match(SUBJECT_TICKET_RE);
      if (marker) {
        [ticket] = await db
          .select()
          .from(schema.tickets)
          .where(eq(schema.tickets.number, Number(marker[1])))
          .limit(1);
      }
    }

    if (ticket) {
      // Customer reply path.
      const { user } = await findOrCreateCustomerByEmail(input.from.email, input.from.name ?? null);
      const [message] = await db
        .insert(schema.ticketMessages)
        .values({
          ticketId: ticket.id,
          kind: 'public',
          authorId: user.id,
          body: text,
          channel: 'email',
          emailMessageId: messageId,
        })
        .returning();
      await onCustomerReply(ticket.id, new Date());
      if (messageId) await trackEmailMessageId(ticket.id, messageId);
      bus.emitEvent('message.created', {
        ticketId: ticket.id,
        messageId: message?.id,
        kind: 'public',
        authorId: user.id,
        authorKind: user.kind,
        channel: 'email',
      });
      return { ticketId: ticket.id, number: ticket.number, threaded: true };
    }

    // New ticket path — same flow as POST /api/tickets, on the email channel.
    const created = await createTicket({
      subject,
      body: text,
      requesterEmail: input.from.email,
      requesterName: input.from.name ?? null,
      channel: 'email',
      emailMessageId: messageId,
    });
    reply.code(201);
    return { ticketId: created.id, number: created.number, threaded: false };
  });
}
