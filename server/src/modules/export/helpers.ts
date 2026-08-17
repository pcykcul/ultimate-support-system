/**
 * Export helpers: CSV escaping, chunked table reads, and the shared ticket-dump query.
 * Everything reads in fixed-size pages so a large install can be exported without pulling
 * whole tables into memory at once.
 */
import { asc, eq } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { db, schema } from '../../db/index.js';

export const PAGE_SIZE = 1000;

/**
 * RFC 4180-style CSV field escaping. A field is quoted only when it contains a comma,
 * double quote, CR or LF; embedded quotes are doubled. Dates become ISO strings, arrays
 * join on comma (quoting then kicks in), null/undefined become empty fields.
 */
export function csvField(value: unknown): string {
  if (value === null || value === undefined) return '';
  const raw =
    value instanceof Date
      ? value.toISOString()
      : Array.isArray(value)
        ? value.join(',')
        : String(value);
  return /[",\r\n]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
}

/** One CSV line (CRLF-terminated) from a list of raw values. */
export function csvRow(values: unknown[]): string {
  return values.map(csvField).join(',') + '\r\n';
}

/**
 * Generic limit/offset pager: keeps calling fetchPage until a short page signals the end.
 * The fetchPage query must have a stable ORDER BY, or pages can overlap/skip rows.
 */
export async function* pagedRows<T>(
  fetchPage: (limit: number, offset: number) => Promise<T[]>,
  pageSize = PAGE_SIZE
): AsyncGenerator<T[], void> {
  for (let offset = 0; ; offset += pageSize) {
    const rows = await fetchPage(pageSize, offset);
    if (rows.length > 0) yield rows;
    if (rows.length < pageSize) return;
  }
}

const requesterUser = alias(schema.users, 'export_requester');
const assigneeUser = alias(schema.users, 'export_assignee');

/**
 * The shared ticket-dump query used by both /tickets.csv and /tickets.json:
 * every ticket joined with requester, company and assignee, in ticket-number order,
 * yielded a page at a time. `id` rides along so the JSON export can batch-load messages;
 * the CSV export simply doesn't print it.
 */
export async function* ticketExportPages() {
  yield* pagedRows((limit, offset) =>
    db
      .select({
        id: schema.tickets.id,
        number: schema.tickets.number,
        subject: schema.tickets.subject,
        status: schema.tickets.status,
        priority: schema.tickets.priority,
        channel: schema.tickets.channel,
        requesterName: requesterUser.name,
        requesterEmail: requesterUser.email,
        company: schema.companies.name,
        assignee: assigneeUser.name,
        tags: schema.tickets.tags,
        createdAt: schema.tickets.createdAt,
        solvedAt: schema.tickets.solvedAt,
        firstRespondedAt: schema.tickets.firstRespondedAt,
        slaBreached: schema.tickets.slaBreached,
      })
      .from(schema.tickets)
      .innerJoin(requesterUser, eq(schema.tickets.requesterId, requesterUser.id))
      .leftJoin(schema.companies, eq(schema.tickets.companyId, schema.companies.id))
      .leftJoin(assigneeUser, eq(schema.tickets.assigneeId, assigneeUser.id))
      .orderBy(asc(schema.tickets.number))
      .limit(limit)
      .offset(offset)
  );
}
