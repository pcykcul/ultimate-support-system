/**
 * Data export, logical backup, and GDPR tooling. All admin-only.
 * Streams the big dumps (CSV, tickets.json, backup.json) so exports of large installs
 * stay flat in memory. See docs/development/operations.md for usage.
 */
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { asc, eq, inArray, sql } from 'drizzle-orm';
import { db, schema } from '../../db/index.js';
import { badRequest, notFound, parse } from '../../lib/http.js';
import { requireAdmin } from '../../lib/auth.js';
import { csvRow, pagedRows, ticketExportPages } from './helpers.js';
import { backupJsonChunks } from './backup.js';

const CSV_COLUMNS = [
  'number',
  'subject',
  'status',
  'priority',
  'channel',
  'requester_name',
  'requester_email',
  'company',
  'assignee',
  'tags',
  'created_at',
  'solved_at',
  'first_responded_at',
  'sla_breached',
];

const anonymizeSchema = z.object({ email: z.string().email() });

interface ExportMessage {
  kind: string;
  author: string | null;
  body: string;
  createdAt: Date;
}

/** Loads {kind, author, body, createdAt} for a page of ticket ids, grouped per ticket. */
async function loadMessagesByTicket(ticketIds: string[]): Promise<Map<string, ExportMessage[]>> {
  const grouped = new Map<string, ExportMessage[]>();
  if (ticketIds.length === 0) return grouped;
  const rows = await db
    .select({
      ticketId: schema.ticketMessages.ticketId,
      kind: schema.ticketMessages.kind,
      author: schema.users.name,
      body: schema.ticketMessages.body,
      createdAt: schema.ticketMessages.createdAt,
    })
    .from(schema.ticketMessages)
    .leftJoin(schema.users, eq(schema.ticketMessages.authorId, schema.users.id))
    .where(inArray(schema.ticketMessages.ticketId, ticketIds))
    .orderBy(asc(schema.ticketMessages.ticketId), asc(schema.ticketMessages.createdAt));
  for (const { ticketId, ...message } of rows) {
    const list = grouped.get(ticketId);
    if (list) list.push(message);
    else grouped.set(ticketId, [message]);
  }
  return grouped;
}

export default async function routes(app: FastifyInstance): Promise<void> {
  // ---- GET /tickets.csv — full ticket dump as a streamed CSV attachment ----
  app.get('/tickets.csv', { preHandler: requireAdmin }, async (_req, reply) => {
    async function* csv(): AsyncGenerator<string> {
      yield csvRow(CSV_COLUMNS);
      for await (const page of ticketExportPages()) {
        for (const t of page) {
          yield csvRow([
            t.number,
            t.subject,
            t.status,
            t.priority,
            t.channel,
            t.requesterName,
            t.requesterEmail,
            t.company,
            t.assignee,
            t.tags,
            t.createdAt,
            t.solvedAt,
            t.firstRespondedAt,
            t.slaBreached,
          ]);
        }
      }
    }
    reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', 'attachment; filename="tickets.csv"');
    return reply.send(Readable.from(csv()));
  });

  // ---- GET /tickets.json — same dump as a streamed JSON array, plus messages ----
  app.get('/tickets.json', { preHandler: requireAdmin }, async (_req, reply) => {
    async function* json(): AsyncGenerator<string> {
      yield '[';
      let first = true;
      for await (const page of ticketExportPages()) {
        const messagesByTicket = await loadMessagesByTicket(page.map((t) => t.id));
        for (const { id, ...ticket } of page) {
          const item = { ...ticket, messages: messagesByTicket.get(id) ?? [] };
          yield (first ? '' : ',') + JSON.stringify(item);
          first = false;
        }
      }
      yield ']';
    }
    reply.header('content-type', 'application/json; charset=utf-8');
    return reply.send(Readable.from(json()));
  });

  // ---- GET /kb.json — categories + articles (with bodies) + revision counts ----
  app.get('/kb.json', { preHandler: requireAdmin }, async () => {
    const categories = await db
      .select()
      .from(schema.kbCategories)
      .orderBy(asc(schema.kbCategories.position), asc(schema.kbCategories.id));
    const revisionCounts = await db
      .select({ articleId: schema.kbRevisions.articleId, n: sql<number>`count(*)::int` })
      .from(schema.kbRevisions)
      .groupBy(schema.kbRevisions.articleId);
    const countByArticle = new Map(revisionCounts.map((r) => [r.articleId, r.n]));
    const articles: Array<Record<string, unknown>> = [];
    for await (const page of pagedRows((limit, offset) =>
      db.select().from(schema.kbArticles).orderBy(asc(schema.kbArticles.id)).limit(limit).offset(offset)
    )) {
      for (const article of page) {
        articles.push({ ...article, revisionCount: countByArticle.get(article.id) ?? 0 });
      }
    }
    return { categories, articles };
  });

  // ---- GET /sops.json — sops + steps + current assignment state ----
  app.get('/sops.json', { preHandler: requireAdmin }, async () => {
    const steps = await db
      .select()
      .from(schema.sopSteps)
      .orderBy(asc(schema.sopSteps.sopId), asc(schema.sopSteps.position));
    const assignments = await db
      .select({
        id: schema.sopAssignments.id,
        sopId: schema.sopAssignments.sopId,
        userId: schema.sopAssignments.userId,
        userName: schema.users.name,
        sopVersion: schema.sopAssignments.sopVersion,
        dueAt: schema.sopAssignments.dueAt,
        acknowledgedAt: schema.sopAssignments.acknowledgedAt,
        signatureName: schema.sopAssignments.signatureName,
        createdAt: schema.sopAssignments.createdAt,
      })
      .from(schema.sopAssignments)
      .leftJoin(schema.users, eq(schema.sopAssignments.userId, schema.users.id))
      .orderBy(asc(schema.sopAssignments.sopId), asc(schema.sopAssignments.createdAt));

    const sops: Array<Record<string, unknown>> = [];
    for await (const page of pagedRows((limit, offset) =>
      db.select().from(schema.sops).orderBy(asc(schema.sops.id)).limit(limit).offset(offset)
    )) {
      for (const sop of page) {
        sops.push({
          ...sop,
          steps: steps.filter((s) => s.sopId === sop.id),
          assignments: assignments.filter((a) => a.sopId === sop.id),
        });
      }
    }
    return { sops };
  });

  // ---- GET /backup.json — single-file logical export of all business tables ----
  app.get('/backup.json', { preHandler: requireAdmin }, async (_req, reply) => {
    reply
      .header('content-type', 'application/json; charset=utf-8')
      .header('content-disposition', 'attachment; filename="uss-backup.json"');
    return reply.send(Readable.from(backupJsonChunks()));
  });

  // ---- POST /gdpr/anonymize-user — scrub a customer's PII, keep the business records ----
  app.post('/gdpr/anonymize-user', { preHandler: requireAdmin }, async (req) => {
    const { email } = parse(anonymizeSchema, req.body);
    const [user] = await db
      .select()
      .from(schema.users)
      .where(sql`lower(${schema.users.email}) = lower(${email})`)
      .limit(1);
    if (!user || !user.email) throw notFound('User');

    // Staff are never anonymized: their identity is woven through the audit trail — ticket
    // events, KB revisions, SOP sign-offs, agent replies emailed under their real name.
    // Erasing it would falsify those records. Staff offboarding is deactivation
    // (POST /api/users/:id/deactivate), which cuts access while keeping history honest.
    if (user.kind === 'staff') {
      throw badRequest('Staff accounts are deactivated, not anonymized');
    }

    const originalEmail = user.email;
    const summary = await db.transaction(async (tx) => {
      const [ticketCount] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(schema.tickets)
        .where(eq(schema.tickets.requesterId, user.id));
      const [messageCount] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(schema.ticketMessages)
        .where(eq(schema.ticketMessages.authorId, user.id));

      // Strip the identifiers from the user row itself.
      await tx
        .update(schema.users)
        .set({ name: 'Anonymized user', email: null, avatarUrl: null, passwordHash: null })
        .where(eq(schema.users.id, user.id));

      // Their ticket message bodies are deliberately KEPT: they are the operator's own
      // business records of support delivered (order numbers, troubleshooting history,
      // commitments made). GDPR erasure targets identifiability, not the operator's
      // correspondence archive — once name/email/avatar are gone the messages no longer
      // point at an identifiable person. Ticket subjects are likewise left untouched.
      // CSAT comments, by contrast, are free-text opinion in the customer's own voice
      // with no operational value, so they are scrubbed:
      await tx
        .update(schema.csatResponses)
        .set({ comment: null })
        .where(
          inArray(
            schema.csatResponses.ticketId,
            tx
              .select({ id: schema.tickets.id })
              .from(schema.tickets)
              .where(eq(schema.tickets.requesterId, user.id))
          )
        );
      await tx
        .update(schema.kbFeedback)
        .set({ comment: null })
        .where(eq(schema.kbFeedback.userId, user.id));

      // Sign them out everywhere and unlink them from companies.
      await tx.delete(schema.sessions).where(eq(schema.sessions.userId, user.id));
      await tx.delete(schema.companyMembers).where(eq(schema.companyMembers.userId, user.id));

      // Audit record: proves the request was honoured (and lets support answer "was
      // x@y.com anonymized?" by hashing the asked-about address) without storing the email.
      const originalEmailHash = createHash('sha256')
        .update(originalEmail.toLowerCase())
        .digest('hex');
      await tx.insert(schema.settings).values({
        key: `gdprAnonymized:${user.id}`,
        value: { originalEmailHash, at: new Date().toISOString() },
      });

      return { ticketsAffected: ticketCount.n, messagesKept: messageCount.n };
    });

    return summary;
  });
}
