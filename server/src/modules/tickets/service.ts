/**
 * Ticketing domain helpers shared by the staff tickets API and the inbound-email webhook.
 * Owns requester find-or-create (with company auto-association by email domain), sequential
 * ticket numbering via the counters table, ticket creation (first message + SLA + the labeled
 * human-promise receipt), macro template rendering, and email Message-ID threading bookkeeping.
 */
import crypto from 'node:crypto';
import { eq, inArray, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { db, schema } from '../../db/index.js';
import { notFound } from '../../lib/http.js';
import { applySla } from '../../lib/sla.js';
import { formatLocalClock } from '../../lib/hours.js';
import { sendMail } from '../../lib/mailer.js';
import { bus } from '../../lib/events.js';

export type TicketStatus = (typeof schema.ticketStatus.enumValues)[number];
export type TicketPriority = (typeof schema.ticketPriority.enumValues)[number];
export type TicketChannel = (typeof schema.ticketChannel.enumValues)[number];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

/** Reject non-uuid path params early so Postgres never sees an invalid cast (22P02 → 500). */
export function assertUuid(id: string, what = 'Resource'): void {
  if (!isUuid(id)) throw notFound(what);
}

// Aliased user joins so requester and assignee can both appear in one query.
export const requesterAlias = alias(schema.users, 'requester_user');
export const assigneeAlias = alias(schema.users, 'assignee_user');

/** Ticket + requester/company/assignee in one query. Null when the ticket doesn't exist. */
export async function loadTicketSummary(id: string) {
  const rows = await db
    .select({
      ticket: schema.tickets,
      requester: {
        id: requesterAlias.id,
        name: requesterAlias.name,
        email: requesterAlias.email,
        timezone: requesterAlias.timezone,
      },
      company: {
        id: schema.companies.id,
        name: schema.companies.name,
        timezone: schema.companies.timezone,
      },
      assignee: { id: assigneeAlias.id, name: assigneeAlias.name },
    })
    .from(schema.tickets)
    .innerJoin(requesterAlias, eq(schema.tickets.requesterId, requesterAlias.id))
    .leftJoin(schema.companies, eq(schema.tickets.companyId, schema.companies.id))
    .leftJoin(assigneeAlias, eq(schema.tickets.assigneeId, assigneeAlias.id))
    .where(eq(schema.tickets.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export type TicketSummaryRow = NonNullable<Awaited<ReturnType<typeof loadTicketSummary>>>;

/** The full ticket shape the API returns: every column + nested requester/company/assignee. */
export function serializeTicket(row: TicketSummaryRow) {
  return {
    ...row.ticket,
    requester: { id: row.requester.id, name: row.requester.name, email: row.requester.email },
    company: row.company ? { id: row.company.id, name: row.company.name } : null,
    assignee: row.assignee ? { id: row.assignee.id, name: row.assignee.name } : null,
  };
}

/** Find the company whose domains include the email's domain (case-insensitive). */
export async function companyForEmailDomain(email: string) {
  const domain = email.trim().toLowerCase().split('@')[1];
  if (!domain) return null;
  const [company] = await db
    .select()
    .from(schema.companies)
    .where(sql`EXISTS (SELECT 1 FROM unnest(${schema.companies.domains}) AS d WHERE lower(d) = ${domain})`)
    .limit(1);
  return company ?? null;
}

/**
 * Find-or-create a customer user by email. When a company's domains match the email domain,
 * the user is auto-associated as a company member (idempotent).
 */
export async function findOrCreateCustomerByEmail(email: string, name?: string | null) {
  const normalized = email.trim().toLowerCase();
  const company = await companyForEmailDomain(normalized);
  let [user] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, normalized))
    .limit(1);
  if (!user) {
    [user] = await db
      .insert(schema.users)
      .values({
        kind: 'customer',
        email: normalized,
        name: name?.trim() || normalized.split('@')[0] || normalized,
      })
      .returning();
  }
  if (!user) throw new Error('Failed to create requester user');
  if (user.kind === 'customer' && company) {
    await db
      .insert(schema.companyMembers)
      .values({ companyId: company.id, userId: user.id })
      .onConflictDoNothing();
  }
  return { user, company };
}

/** Sequential human-friendly ticket number: counters UPDATE ... RETURNING (row seeded by migration). */
export async function nextTicketNumber(): Promise<number> {
  const [row] = await db
    .update(schema.counters)
    .set({ value: sql`${schema.counters.value} + 1` })
    .where(eq(schema.counters.name, 'ticket_number'))
    .returning({ value: schema.counters.value });
  if (row) return row.value;
  // Fresh install without the seed row: create it atomically.
  const [inserted] = await db
    .insert(schema.counters)
    .values({ name: 'ticket_number', value: 1 })
    .onConflictDoUpdate({
      target: schema.counters.name,
      set: { value: sql`${schema.counters.value} + 1` },
    })
    .returning({ value: schema.counters.value });
  if (!inserted) throw new Error('Failed to allocate ticket number');
  return inserted.value;
}

/** Audit trail row. */
export async function logTicketEvent(
  ticketId: string,
  actorId: string | null,
  type: string,
  data: Record<string, unknown> = {}
): Promise<void> {
  await db.insert(schema.ticketEvents).values({ ticketId, actorId, type, data });
}

// ---- Email threading ----

/** Strip surrounding angle brackets from an RFC 5322 Message-ID. */
export function stripAngles(messageId: string): string {
  return messageId.trim().replace(/^</, '').replace(/>$/, '');
}

/** Message-ID we stamp on outbound mail so customer replies thread back via In-Reply-To. */
export function newEmailMessageId(ticketNumber: number): string {
  return `uss-ticket-${ticketNumber}-${crypto.randomUUID()}@tickets.local`;
}

export async function trackEmailMessageId(ticketId: string, messageId: string): Promise<void> {
  await db
    .update(schema.tickets)
    .set({ emailMessageIds: sql`array_append(${schema.tickets.emailMessageIds}, ${messageId})` })
    .where(eq(schema.tickets.id, ticketId));
}

// ---- Receipt (the Human Guarantee) ----

/**
 * Labeled automated receipt with the human response promise, rendered in the requester's
 * timezone (requester.timezone ?? company.timezone) via formatLocalClock.
 */
export async function sendTicketReceipt(row: TicketSummaryRow): Promise<void> {
  const { ticket, requester, company } = row;
  if (!requester.email) return;
  const timezone = requester.timezone ?? company?.timezone ?? 'UTC';
  let promise = 'A real person will get back to you as soon as possible.';
  if (ticket.firstResponseDueAt) {
    try {
      const clock = formatLocalClock(ticket.firstResponseDueAt, timezone);
      promise = `A real person will get back to you by ${clock.label} (your local time).`;
    } catch {
      promise = `A real person will get back to you by ${ticket.firstResponseDueAt.toISOString()}.`;
    }
  }
  const outboundId = newEmailMessageId(ticket.number);
  await sendMail({
    to: requester.email,
    subject: `[Received] [#${ticket.number}] ${ticket.subject}`,
    text: [
      `Hi ${requester.name},`,
      '',
      `We've received your request "${ticket.subject}" — it's now ticket #${ticket.number}.`,
      '',
      promise,
      '',
      'This is an automated receipt — a real person will reply. No bots write our answers.',
    ].join('\n'),
    ticketId: ticket.id,
    headers: { 'Message-ID': `<${outboundId}>` },
  });
  await trackEmailMessageId(ticket.id, outboundId);
}

// ---- Creation (shared by POST /api/tickets and the inbound-email webhook) ----

export interface CreateTicketInput {
  subject: string;
  body: string;
  requesterEmail: string;
  requesterName?: string | null;
  companyId?: string | null;
  priority?: TicketPriority;
  teamId?: string | null;
  assigneeId?: string | null;
  tags?: string[];
  channel?: TicketChannel;
  emailMessageId?: string | null;
  actorId?: string | null;
}

export async function createTicket(input: CreateTicketInput) {
  const { user: requester, company: autoCompany } = await findOrCreateCustomerByEmail(
    input.requesterEmail,
    input.requesterName ?? null
  );
  const companyId = input.companyId ?? autoCompany?.id ?? null;
  const number = await nextTicketNumber();
  const channel = input.channel ?? 'internal';

  const [ticket] = await db
    .insert(schema.tickets)
    .values({
      number,
      subject: input.subject,
      channel,
      priority: input.priority ?? 'normal',
      requesterId: requester.id,
      companyId,
      teamId: input.teamId ?? null,
      assigneeId: input.assigneeId ?? null,
      tags: input.tags ?? [],
      emailMessageIds: input.emailMessageId ? [input.emailMessageId] : [],
    })
    .returning();
  if (!ticket) throw new Error('Failed to create ticket');

  // First message = the requester's problem statement.
  await db.insert(schema.ticketMessages).values({
    ticketId: ticket.id,
    kind: 'public',
    authorId: requester.id,
    body: input.body,
    channel,
    emailMessageId: input.emailMessageId ?? null,
  });

  if (input.assigneeId) {
    await logTicketEvent(ticket.id, input.actorId ?? null, 'assigned', {
      from: null,
      to: input.assigneeId,
    });
  }

  await applySla(ticket.id);
  const fresh = await loadTicketSummary(ticket.id);
  if (!fresh) throw new Error('Ticket disappeared after creation');

  await sendTicketReceipt(fresh);
  bus.emitEvent('ticket.created', { ticketId: ticket.id, ticket: fresh.ticket });
  return serializeTicket(fresh);
}

// ---- Macro rendering ----

const SNIPPET_RE = /\{\{\s*snippet:([A-Za-z0-9_.-]+)\s*\}\}/g;

export async function renderMacroBody(
  template: string,
  vars: { customerName: string; agentName: string; ticketNumber: number }
): Promise<string> {
  let out = template
    .replace(/\{\{\s*customer\.name\s*\}\}/g, vars.customerName)
    .replace(/\{\{\s*agent\.name\s*\}\}/g, vars.agentName)
    .replace(/\{\{\s*ticket\.number\s*\}\}/g, String(vars.ticketNumber));
  const keys = [...new Set([...out.matchAll(SNIPPET_RE)].map((m) => m[1]!))];
  if (keys.length) {
    const rows = await db.select().from(schema.snippets).where(inArray(schema.snippets.key, keys));
    const byKey = new Map(rows.map((r) => [r.key, r.value]));
    // Unknown snippet keys stay visible in the output so authors notice the typo.
    out = out.replace(SNIPPET_RE, (full, key: string) => byKey.get(key) ?? full);
  }
  return out;
}
