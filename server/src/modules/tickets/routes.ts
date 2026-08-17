/**
 * The ticketing core: queue listing with scope + SLA sort, creation with the labeled receipt,
 * the ticket workspace payload, replies/notes, workflow patches, merge, macros, manual SLA
 * extension, follow, and the command-palette search.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, asc, desc, eq, ilike, inArray, or, sql, type SQL } from 'drizzle-orm';
import { db, schema } from '../../db/index.js';
import { badRequest, forbidden, notFound, parse } from '../../lib/http.js';
import { requireAgent, requireStaff, requireSupervisor } from '../../lib/auth.js';
import { applySla, extendSla, onAgentPublicReply, onStatusChange } from '../../lib/sla.js';
import { formatLocalClock } from '../../lib/hours.js';
import { sendMail } from '../../lib/mailer.js';
import { bus } from '../../lib/events.js';
import {
  assertUuid,
  assigneeAlias,
  createTicket,
  isUuid,
  loadTicketSummary,
  logTicketEvent,
  newEmailMessageId,
  renderMacroBody,
  requesterAlias,
  serializeTicket,
  trackEmailMessageId,
  type TicketPriority,
  type TicketStatus,
} from './service.js';

const STATUS_VALUES = schema.ticketStatus.enumValues as readonly string[];
const PRIORITY_VALUES = schema.ticketPriority.enumValues as readonly string[];

const listQuerySchema = z.object({
  status: z.string().optional(),
  assigneeId: z.string().optional(),
  teamId: z.string().uuid().optional(),
  companyId: z.string().uuid().optional(),
  priority: z.string().optional(),
  q: z.string().optional(),
  sort: z.enum(['updated', 'created', 'sla']).optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

const createSchema = z.object({
  subject: z.string().trim().min(1),
  body: z.string().min(1),
  requesterEmail: z.string().email(),
  requesterName: z.string().optional(),
  companyId: z.string().uuid().optional(),
  priority: z.enum(schema.ticketPriority.enumValues).optional(),
  teamId: z.string().uuid().optional(),
  assigneeId: z.string().uuid().optional(),
  tags: z.array(z.string()).optional(),
  channel: z.enum(schema.ticketChannel.enumValues).optional(),
});

const patchSchema = z.object({
  status: z.enum(schema.ticketStatus.enumValues).optional(),
  priority: z.enum(schema.ticketPriority.enumValues).optional(),
  assigneeId: z.string().uuid().nullable().optional(),
  teamId: z.string().uuid().nullable().optional(),
  companyId: z.string().uuid().nullable().optional(),
  tags: z.array(z.string()).optional(),
});

const messageSchema = z.object({
  body: z.string().min(1),
  kind: z.enum(['public', 'internal']),
});

const macroBodySchema = z.object({
  name: z.string().trim().min(1),
  body: z.string().min(1),
  actions: z.record(z.unknown()).optional(),
  sopId: z.string().uuid().nullable().optional(),
});

const macroPatchSchema = z.object({
  name: z.string().trim().min(1).optional(),
  body: z.string().min(1).optional(),
  actions: z.record(z.unknown()).optional(),
  sopId: z.string().uuid().nullable().optional(),
});

interface MacroActions {
  setStatus?: string;
  setPriority?: string;
  addTags?: string[];
  assignTeamId?: string;
}

function sameTags(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((t, i) => b[i] === t);
}

export default async function routes(app: FastifyInstance): Promise<void> {
  // ---- Queue listing ----
  app.get('/', { preHandler: requireStaff }, async (req) => {
    const user = req.user!;
    const query = parse(listQuerySchema, req.query);
    const page = query.page ?? 1;
    const limit = query.limit ?? 50;

    const conditions: SQL[] = [];

    if (query.status) {
      const statuses = query.status
        .split(',')
        .map((s) => s.trim())
        .filter((s): s is TicketStatus => STATUS_VALUES.includes(s));
      if (statuses.length) conditions.push(inArray(schema.tickets.status, statuses));
    }
    if (query.assigneeId === 'me') {
      conditions.push(eq(schema.tickets.assigneeId, user.id));
    } else if (query.assigneeId === 'unassigned') {
      conditions.push(sql`${schema.tickets.assigneeId} IS NULL`);
    } else if (query.assigneeId) {
      assertUuid(query.assigneeId, 'Assignee');
      conditions.push(eq(schema.tickets.assigneeId, query.assigneeId));
    }
    if (query.teamId) conditions.push(eq(schema.tickets.teamId, query.teamId));
    if (query.companyId) conditions.push(eq(schema.tickets.companyId, query.companyId));
    if (query.priority) {
      const priorities = query.priority
        .split(',')
        .map((p) => p.trim())
        .filter((p): p is TicketPriority => PRIORITY_VALUES.includes(p));
      if (priorities.length) conditions.push(inArray(schema.tickets.priority, priorities));
    }
    if (query.q?.trim()) {
      const term = query.q.trim();
      const like = `%${term}%`;
      const ors: SQL[] = [
        ilike(schema.tickets.subject, like),
        ilike(requesterAlias.name, like),
        ilike(requesterAlias.email, like),
      ];
      if (/^#?\d+$/.test(term)) ors.push(eq(schema.tickets.number, Number(term.replace(/^#/, ''))));
      conditions.push(or(...ors)!);
    }

    // Visibility scope: 'assigned' agents see only their tickets; 'team' agents their teams' (or their own).
    const scope = user.scope ?? 'all';
    if (scope === 'assigned') {
      conditions.push(eq(schema.tickets.assigneeId, user.id));
    } else if (scope === 'team') {
      const teamRows = await db
        .select({ teamId: schema.teamMembers.teamId })
        .from(schema.teamMembers)
        .where(eq(schema.teamMembers.userId, user.id));
      const teamIds = teamRows.map((r) => r.teamId);
      const scopeOrs: SQL[] = [eq(schema.tickets.assigneeId, user.id)];
      if (teamIds.length) scopeOrs.push(inArray(schema.tickets.teamId, teamIds));
      conditions.push(or(...scopeOrs)!);
    }

    const where = conditions.length ? and(...conditions) : undefined;
    const orderBy =
      query.sort === 'created'
        ? [desc(schema.tickets.createdAt)]
        : query.sort === 'sla'
          ? [
              // Breached first, then soonest due; no active SLA sinks to the bottom.
              sql`${schema.tickets.slaBreached} DESC`,
              sql`${schema.tickets.nextSlaDueAt} ASC NULLS LAST`,
              desc(schema.tickets.updatedAt),
            ]
          : [desc(schema.tickets.updatedAt)];

    const [rows, countRows] = await Promise.all([
      db
        .select({
          ticket: schema.tickets,
          requester: { id: requesterAlias.id, name: requesterAlias.name, email: requesterAlias.email },
          company: { id: schema.companies.id, name: schema.companies.name },
          assignee: { id: assigneeAlias.id, name: assigneeAlias.name },
        })
        .from(schema.tickets)
        .innerJoin(requesterAlias, eq(schema.tickets.requesterId, requesterAlias.id))
        .leftJoin(schema.companies, eq(schema.tickets.companyId, schema.companies.id))
        .leftJoin(assigneeAlias, eq(schema.tickets.assigneeId, assigneeAlias.id))
        .where(where)
        .orderBy(...orderBy)
        .limit(limit)
        .offset((page - 1) * limit),
      db
        .select({ total: sql<number>`count(*)::int` })
        .from(schema.tickets)
        .innerJoin(requesterAlias, eq(schema.tickets.requesterId, requesterAlias.id))
        .where(where),
    ]);

    return {
      items: rows.map((r) => ({
        id: r.ticket.id,
        number: r.ticket.number,
        subject: r.ticket.subject,
        status: r.ticket.status,
        priority: r.ticket.priority,
        channel: r.ticket.channel,
        requester: r.requester,
        company: r.company ? { id: r.company.id, name: r.company.name } : null,
        assignee: r.assignee ? { id: r.assignee.id, name: r.assignee.name } : null,
        teamId: r.ticket.teamId,
        tags: r.ticket.tags,
        nextSlaDueAt: r.ticket.nextSlaDueAt,
        slaBreached: r.ticket.slaBreached,
        firstResponseDueAt: r.ticket.firstResponseDueAt,
        nextResponseDueAt: r.ticket.nextResponseDueAt,
        resolutionDueAt: r.ticket.resolutionDueAt,
        lastCustomerReplyAt: r.ticket.lastCustomerReplyAt,
        updatedAt: r.ticket.updatedAt,
        createdAt: r.ticket.createdAt,
      })),
      total: countRows[0]?.total ?? 0,
    };
  });

  // ---- Command palette search (tickets + published KB + SOPs, top 8) ----
  app.get('/palette-search', { preHandler: requireStaff }, async (req) => {
    const { q } = parse(z.object({ q: z.string().optional() }), req.query);
    const term = (q ?? '').trim();
    if (!term) return [];
    const like = `%${term}%`;
    const numeric = /^#?\d+$/.test(term) ? Number(term.replace(/^#/, '')) : null;
    const numberCond = numeric != null ? sql` OR t.number = ${numeric}` : sql``;

    const result = await db.execute(sql`
      WITH q AS (SELECT plainto_tsquery('english', ${term}) AS tsq)
      SELECT type, id, title, subtitle, url
      FROM (
        SELECT
          'ticket' AS type,
          t.id::text AS id,
          '#' || t.number || ' · ' || t.subject AS title,
          t.status::text AS subtitle,
          '/tickets/' || t.id AS url,
          GREATEST(ts_rank(to_tsvector('english', t.subject), q.tsq), 0.02) AS rank,
          t.updated_at AS recency
        FROM tickets t, q
        WHERE to_tsvector('english', t.subject) @@ q.tsq
          OR t.subject ILIKE ${like}${numberCond}
          OR EXISTS (
            SELECT 1 FROM ticket_messages tm
            WHERE tm.ticket_id = t.id AND to_tsvector('english', tm.body) @@ q.tsq
          )
        UNION ALL
        SELECT
          'article',
          a.id::text,
          a.title,
          'Knowledge base',
          '/kb/' || a.id,
          GREATEST(ts_rank(to_tsvector('english', a.title || ' ' || a.body), q.tsq), 0.02),
          a.updated_at
        FROM kb_articles a, q
        WHERE a.status = 'published'
          AND (to_tsvector('english', a.title || ' ' || a.body) @@ q.tsq OR a.title ILIKE ${like})
        UNION ALL
        SELECT
          'sop',
          s.id::text,
          s.title,
          CASE WHEN s.kind = 'runbook' THEN 'Runbook' ELSE 'SOP' END,
          '/sops/' || s.id,
          GREATEST(ts_rank(to_tsvector('english', s.title || ' ' || s.body), q.tsq), 0.02),
          s.updated_at
        FROM sops s, q
        WHERE to_tsvector('english', s.title || ' ' || s.body) @@ q.tsq OR s.title ILIKE ${like}
      ) hits
      ORDER BY rank DESC, recency DESC
      LIMIT 8
    `);
    const rows = result as unknown as Array<{
      type: string;
      id: string;
      title: string;
      subtitle: string;
      url: string;
    }>;
    return rows.map((r) => ({ type: r.type, id: r.id, title: r.title, subtitle: r.subtitle, url: r.url }));
  });

  // ---- Macros CRUD ----
  app.get('/macros', { preHandler: requireStaff }, async () => {
    const rows = await db
      .select({ macro: schema.macros, sopTitle: schema.sops.title })
      .from(schema.macros)
      .leftJoin(schema.sops, eq(schema.macros.sopId, schema.sops.id))
      .orderBy(asc(schema.macros.name));
    return { items: rows.map((r) => ({ ...r.macro, sopTitle: r.sopTitle })) };
  });

  app.post('/macros', { preHandler: requireAgent }, async (req, reply) => {
    const input = parse(macroBodySchema, req.body);
    const [macro] = await db
      .insert(schema.macros)
      .values({
        name: input.name,
        body: input.body,
        actions: input.actions ?? {},
        sopId: input.sopId ?? null,
      })
      .returning();
    reply.code(201);
    return macro;
  });

  app.patch('/macros/:id', { preHandler: requireAgent }, async (req) => {
    const { id } = req.params as { id: string };
    assertUuid(id, 'Macro');
    const input = parse(macroPatchSchema, req.body);
    const patch: Partial<typeof schema.macros.$inferInsert> = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.body !== undefined) patch.body = input.body;
    if (input.actions !== undefined) patch.actions = input.actions;
    if (input.sopId !== undefined) patch.sopId = input.sopId;
    if (!Object.keys(patch).length) {
      const [existing] = await db.select().from(schema.macros).where(eq(schema.macros.id, id)).limit(1);
      if (!existing) throw notFound('Macro');
      return existing;
    }
    const [updated] = await db.update(schema.macros).set(patch).where(eq(schema.macros.id, id)).returning();
    if (!updated) throw notFound('Macro');
    return updated;
  });

  app.delete('/macros/:id', { preHandler: requireSupervisor }, async (req, reply) => {
    const { id } = req.params as { id: string };
    assertUuid(id, 'Macro');
    const deleted = await db.delete(schema.macros).where(eq(schema.macros.id, id)).returning();
    if (!deleted.length) throw notFound('Macro');
    return reply.code(204).send();
  });

  // ---- Create ----
  app.post('/', { preHandler: requireAgent }, async (req, reply) => {
    const user = req.user!;
    const input = parse(createSchema, req.body);
    const ticket = await createTicket({
      subject: input.subject,
      body: input.body,
      requesterEmail: input.requesterEmail,
      requesterName: input.requesterName ?? null,
      companyId: input.companyId ?? null,
      priority: input.priority,
      teamId: input.teamId ?? null,
      assigneeId: input.assigneeId ?? null,
      tags: input.tags,
      channel: input.channel ?? 'internal',
      actorId: user.id,
    });
    reply.code(201);
    return ticket;
  });

  // ---- Ticket workspace payload ----
  app.get('/:id', { preHandler: requireStaff }, async (req) => {
    const { id } = req.params as { id: string };
    assertUuid(id, 'Ticket');
    const row = await loadTicketSummary(id);
    if (!row) throw notFound('Ticket');

    const [messages, events, followers, runs] = await Promise.all([
      db
        .select({
          id: schema.ticketMessages.id,
          kind: schema.ticketMessages.kind,
          body: schema.ticketMessages.body,
          createdAt: schema.ticketMessages.createdAt,
          author: {
            id: schema.users.id,
            name: schema.users.name,
            title: schema.users.title,
            avatarUrl: schema.users.avatarUrl,
            kind: schema.users.kind,
          },
        })
        .from(schema.ticketMessages)
        .leftJoin(schema.users, eq(schema.ticketMessages.authorId, schema.users.id))
        .where(eq(schema.ticketMessages.ticketId, id))
        .orderBy(asc(schema.ticketMessages.createdAt)),
      db
        .select({
          id: schema.ticketEvents.id,
          type: schema.ticketEvents.type,
          data: schema.ticketEvents.data,
          createdAt: schema.ticketEvents.createdAt,
          actor: { id: schema.users.id, name: schema.users.name },
        })
        .from(schema.ticketEvents)
        .leftJoin(schema.users, eq(schema.ticketEvents.actorId, schema.users.id))
        .where(eq(schema.ticketEvents.ticketId, id))
        .orderBy(asc(schema.ticketEvents.createdAt)),
      db
        .select({
          userId: schema.ticketFollowers.userId,
          kind: schema.ticketFollowers.kind,
          name: schema.users.name,
        })
        .from(schema.ticketFollowers)
        .innerJoin(schema.users, eq(schema.ticketFollowers.userId, schema.users.id))
        .where(eq(schema.ticketFollowers.ticketId, id)),
      db
        .select({
          id: schema.sopRuns.id,
          sopId: schema.sopRuns.sopId,
          sopTitle: schema.sops.title,
          status: schema.sopRuns.status,
        })
        .from(schema.sopRuns)
        .innerJoin(schema.sops, eq(schema.sopRuns.sopId, schema.sops.id))
        .where(eq(schema.sopRuns.ticketId, id))
        .orderBy(desc(schema.sopRuns.startedAt)),
    ]);

    let policyName: string | null = null;
    if (row.ticket.slaPolicyId) {
      const [policy] = await db
        .select({ name: schema.slaPolicies.name })
        .from(schema.slaPolicies)
        .where(eq(schema.slaPolicies.id, row.ticket.slaPolicyId))
        .limit(1);
      policyName = policy?.name ?? null;
    }

    const timezone = row.requester.timezone ?? row.company?.timezone ?? null;
    let requesterLocalTime: ReturnType<typeof formatLocalClock> | null = null;
    if (timezone) {
      try {
        requesterLocalTime = formatLocalClock(new Date(), timezone);
      } catch {
        requesterLocalTime = null; // invalid IANA zone stored on the user — don't blow up the page
      }
    }

    return {
      ticket: serializeTicket(row),
      messages,
      events,
      followers,
      requesterLocalTime,
      sla: { policyName },
      runs,
    };
  });

  // ---- Replies & internal notes ----
  app.post('/:id/messages', { preHandler: requireStaff }, async (req, reply) => {
    const user = req.user!;
    const { id } = req.params as { id: string };
    assertUuid(id, 'Ticket');
    const input = parse(messageSchema, req.body);
    if (user.role === 'collaborator' && input.kind !== 'internal') {
      throw forbidden('Collaborators can only leave internal notes');
    }
    const row = await loadTicketSummary(id);
    if (!row) throw notFound('Ticket');

    const now = new Date();
    const [message] = await db
      .insert(schema.ticketMessages)
      .values({ ticketId: id, kind: input.kind, authorId: user.id, body: input.body })
      .returning();
    if (!message) throw new Error('Failed to create message');

    if (input.kind === 'public') {
      await onAgentPublicReply(id, now);
      if (row.requester.email) {
        // Human Guarantee: replies go out under the agent's real name and title.
        const signature = `— ${user.name}${user.title ? `, ${user.title}` : ''}`;
        const outboundId = newEmailMessageId(row.ticket.number);
        await sendMail({
          to: row.requester.email,
          subject: `[#${row.ticket.number}] ${row.ticket.subject}`,
          text: `${input.body}\n\n${signature}`,
          ticketId: id,
          headers: { 'Message-ID': `<${outboundId}>` },
        });
        await trackEmailMessageId(id, outboundId);
      }
      bus.emitEvent('message.created', {
        ticketId: id,
        messageId: message.id,
        kind: 'public',
        authorId: user.id,
        authorKind: 'staff',
      });
    } else {
      await db.update(schema.tickets).set({ updatedAt: now }).where(eq(schema.tickets.id, id));
    }

    reply.code(201);
    return {
      id: message.id,
      kind: message.kind,
      author: { id: user.id, name: user.name, title: user.title, avatarUrl: user.avatarUrl, kind: user.kind },
      body: message.body,
      createdAt: message.createdAt,
    };
  });

  // ---- Workflow patch ----
  app.patch('/:id', { preHandler: requireAgent }, async (req) => {
    const user = req.user!;
    const { id } = req.params as { id: string };
    assertUuid(id, 'Ticket');
    const input = parse(patchSchema, req.body);
    const [ticket] = await db.select().from(schema.tickets).where(eq(schema.tickets.id, id)).limit(1);
    if (!ticket) throw notFound('Ticket');

    // Validate referenced rows up front so FK violations never become 500s.
    if (input.assigneeId) {
      const [assignee] = await db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(eq(schema.users.id, input.assigneeId))
        .limit(1);
      if (!assignee) throw badRequest('Assignee not found');
    }
    if (input.teamId) {
      const [team] = await db
        .select({ id: schema.teams.id })
        .from(schema.teams)
        .where(eq(schema.teams.id, input.teamId))
        .limit(1);
      if (!team) throw badRequest('Team not found');
    }
    if (input.companyId) {
      const [company] = await db
        .select({ id: schema.companies.id })
        .from(schema.companies)
        .where(eq(schema.companies.id, input.companyId))
        .limit(1);
      if (!company) throw badRequest('Company not found');
    }

    const updates: Partial<typeof schema.tickets.$inferInsert> = {};
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    let slaDirty = false;

    if (input.priority !== undefined && input.priority !== ticket.priority) {
      updates.priority = input.priority;
      changes.priority = { from: ticket.priority, to: input.priority };
      await logTicketEvent(id, user.id, 'priority_changed', { from: ticket.priority, to: input.priority });
      slaDirty = true;
    }
    if (input.assigneeId !== undefined && input.assigneeId !== ticket.assigneeId) {
      updates.assigneeId = input.assigneeId;
      changes.assigneeId = { from: ticket.assigneeId, to: input.assigneeId };
      await logTicketEvent(id, user.id, 'assigned', { from: ticket.assigneeId, to: input.assigneeId });
    }
    if (input.teamId !== undefined && input.teamId !== ticket.teamId) {
      updates.teamId = input.teamId;
      changes.teamId = { from: ticket.teamId, to: input.teamId };
      await logTicketEvent(id, user.id, 'team_changed', { from: ticket.teamId, to: input.teamId });
    }
    if (input.companyId !== undefined && input.companyId !== ticket.companyId) {
      updates.companyId = input.companyId;
      changes.companyId = { from: ticket.companyId, to: input.companyId };
      await logTicketEvent(id, user.id, 'company_changed', { from: ticket.companyId, to: input.companyId });
      slaDirty = true;
    }
    if (input.tags !== undefined && !sameTags(input.tags, ticket.tags)) {
      updates.tags = input.tags;
      changes.tags = { from: ticket.tags, to: input.tags };
      await logTicketEvent(id, user.id, 'tags_changed', { from: ticket.tags, to: input.tags });
      slaDirty = true;
    }

    if (Object.keys(updates).length) {
      await db
        .update(schema.tickets)
        .set({ ...updates, updatedAt: new Date() })
        .where(eq(schema.tickets.id, id));
    }
    if (slaDirty) await applySla(id);

    let statusChanged = false;
    if (input.status !== undefined && input.status !== ticket.status) {
      await onStatusChange(id, input.status, new Date());
      await logTicketEvent(id, user.id, 'status_changed', { from: ticket.status, to: input.status });
      changes.status = { from: ticket.status, to: input.status };
      statusChanged = true;
    }

    const fresh = await loadTicketSummary(id);
    if (!fresh) throw notFound('Ticket');
    if (Object.keys(changes).length) {
      bus.emitEvent('ticket.updated', { ticketId: id, ticket: fresh.ticket, changes });
    }
    if (statusChanged) {
      bus.emitEvent('ticket.status_changed', {
        ticketId: id,
        ticket: fresh.ticket,
        from: ticket.status,
        to: input.status,
      });
    }
    return serializeTicket(fresh);
  });

  // ---- Merge ----
  app.post('/:id/merge', { preHandler: requireAgent }, async (req) => {
    const user = req.user!;
    const { id } = req.params as { id: string };
    assertUuid(id, 'Ticket');
    const { sourceTicketId } = parse(z.object({ sourceTicketId: z.string().uuid() }), req.body);
    if (sourceTicketId === id) throw badRequest('Cannot merge a ticket into itself');

    const [target] = await db.select().from(schema.tickets).where(eq(schema.tickets.id, id)).limit(1);
    if (!target) throw notFound('Ticket');
    const [source] = await db
      .select()
      .from(schema.tickets)
      .where(eq(schema.tickets.id, sourceTicketId))
      .limit(1);
    if (!source) throw notFound('Source ticket');

    // Move the source conversation into the target as internal notes, keeping chronology.
    const sourceMessages = await db
      .select()
      .from(schema.ticketMessages)
      .where(eq(schema.ticketMessages.ticketId, source.id))
      .orderBy(asc(schema.ticketMessages.createdAt));
    for (const m of sourceMessages) {
      await db.insert(schema.ticketMessages).values({
        ticketId: target.id,
        kind: 'internal',
        authorId: m.authorId,
        body: `_Merged from #${source.number}:_\n\n${m.body}`,
        channel: m.channel,
        createdAt: m.createdAt,
      });
    }
    // Future email replies to the source thread should land on the target.
    if (source.emailMessageIds.length) {
      const combined = [...new Set([...target.emailMessageIds, ...source.emailMessageIds])];
      await db
        .update(schema.tickets)
        .set({ emailMessageIds: combined })
        .where(eq(schema.tickets.id, target.id));
    }

    await logTicketEvent(target.id, user.id, 'merged', {
      direction: 'in',
      sourceTicketId: source.id,
      sourceNumber: source.number,
    });
    await logTicketEvent(source.id, user.id, 'merged', {
      direction: 'out',
      targetTicketId: target.id,
      targetNumber: target.number,
    });

    await onStatusChange(source.id, 'closed', new Date());
    await db.update(schema.tickets).set({ updatedAt: new Date() }).where(eq(schema.tickets.id, target.id));

    const fresh = await loadTicketSummary(target.id);
    if (!fresh) throw notFound('Ticket');
    bus.emitEvent('ticket.updated', {
      ticketId: target.id,
      ticket: fresh.ticket,
      changes: { merged: { from: null, to: source.id } },
    });
    bus.emitEvent('ticket.status_changed', {
      ticketId: source.id,
      from: source.status,
      to: 'closed',
    });
    return serializeTicket(fresh);
  });

  // ---- Apply macro ----
  app.post('/:id/macros/:macroId', { preHandler: requireAgent }, async (req) => {
    const user = req.user!;
    const { id, macroId } = req.params as { id: string; macroId: string };
    assertUuid(id, 'Ticket');
    assertUuid(macroId, 'Macro');
    const row = await loadTicketSummary(id);
    if (!row) throw notFound('Ticket');
    const [macroRow] = await db
      .select({ macro: schema.macros, sopTitle: schema.sops.title })
      .from(schema.macros)
      .leftJoin(schema.sops, eq(schema.macros.sopId, schema.sops.id))
      .where(eq(schema.macros.id, macroId))
      .limit(1);
    if (!macroRow) throw notFound('Macro');
    const macro = macroRow.macro;

    const rendered = await renderMacroBody(macro.body, {
      customerName: row.requester.name,
      agentName: user.name,
      ticketNumber: row.ticket.number,
    });

    const actions = (macro.actions ?? {}) as MacroActions;
    const updates: Partial<typeof schema.tickets.$inferInsert> = {};
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    let slaDirty = false;

    if (
      actions.setPriority &&
      PRIORITY_VALUES.includes(actions.setPriority) &&
      actions.setPriority !== row.ticket.priority
    ) {
      const to = actions.setPriority as TicketPriority;
      updates.priority = to;
      changes.priority = { from: row.ticket.priority, to };
      await logTicketEvent(id, user.id, 'priority_changed', { from: row.ticket.priority, to, via: 'macro', macroId });
      slaDirty = true;
    }
    if (actions.addTags?.length) {
      const merged = [...new Set([...row.ticket.tags, ...actions.addTags])];
      if (merged.length !== row.ticket.tags.length) {
        updates.tags = merged;
        changes.tags = { from: row.ticket.tags, to: merged };
        await logTicketEvent(id, user.id, 'tags_changed', { from: row.ticket.tags, to: merged, via: 'macro', macroId });
        slaDirty = true;
      }
    }
    if (actions.assignTeamId && isUuid(actions.assignTeamId) && actions.assignTeamId !== row.ticket.teamId) {
      updates.teamId = actions.assignTeamId;
      changes.teamId = { from: row.ticket.teamId, to: actions.assignTeamId };
      await logTicketEvent(id, user.id, 'team_changed', {
        from: row.ticket.teamId,
        to: actions.assignTeamId,
        via: 'macro',
        macroId,
      });
    }

    if (Object.keys(updates).length) {
      await db
        .update(schema.tickets)
        .set({ ...updates, updatedAt: new Date() })
        .where(eq(schema.tickets.id, id));
    }
    if (slaDirty) await applySla(id);

    let statusChanged = false;
    let newStatus: TicketStatus | null = null;
    if (
      actions.setStatus &&
      STATUS_VALUES.includes(actions.setStatus) &&
      actions.setStatus !== row.ticket.status
    ) {
      newStatus = actions.setStatus as TicketStatus;
      await onStatusChange(id, newStatus, new Date());
      await logTicketEvent(id, user.id, 'status_changed', { from: row.ticket.status, to: newStatus, via: 'macro', macroId });
      changes.status = { from: row.ticket.status, to: newStatus };
      statusChanged = true;
    }

    if (Object.keys(changes).length) {
      const fresh = await loadTicketSummary(id);
      bus.emitEvent('ticket.updated', { ticketId: id, ticket: fresh?.ticket, changes });
      if (statusChanged) {
        bus.emitEvent('ticket.status_changed', {
          ticketId: id,
          ticket: fresh?.ticket,
          from: row.ticket.status,
          to: newStatus,
        });
      }
    }

    return {
      body: rendered,
      sop: macro.sopId ? { sopId: macro.sopId, sopTitle: macroRow.sopTitle } : null,
    };
  });

  // ---- Manual SLA extension ----
  app.post('/:id/extend-sla', { preHandler: requireAgent }, async (req) => {
    const user = req.user!;
    const { id } = req.params as { id: string };
    assertUuid(id, 'Ticket');
    const input = parse(
      z.object({
        metric: z.enum(['first_response', 'next_response', 'resolution']),
        newDueAt: z.coerce.date(),
        reason: z.string().trim().min(1),
      }),
      req.body
    );
    const row = await loadTicketSummary(id);
    if (!row) throw notFound('Ticket');
    await extendSla(id, input.metric, input.newDueAt, user.id, input.reason);
    const fresh = await loadTicketSummary(id);
    if (!fresh) throw notFound('Ticket');
    bus.emitEvent('ticket.updated', {
      ticketId: id,
      ticket: fresh.ticket,
      changes: { slaExtended: { from: input.metric, to: input.newDueAt.toISOString() } },
    });
    return serializeTicket(fresh);
  });

  // ---- Follow / unfollow ----
  app.post('/:id/follow', { preHandler: requireStaff }, async (req, reply) => {
    const user = req.user!;
    const { id } = req.params as { id: string };
    assertUuid(id, 'Ticket');
    const [ticket] = await db
      .select({ id: schema.tickets.id })
      .from(schema.tickets)
      .where(eq(schema.tickets.id, id))
      .limit(1);
    if (!ticket) throw notFound('Ticket');
    await db
      .insert(schema.ticketFollowers)
      .values({ ticketId: id, userId: user.id, kind: 'internal' })
      .onConflictDoNothing();
    return reply.code(204).send();
  });

  app.delete('/:id/follow', { preHandler: requireStaff }, async (req, reply) => {
    const user = req.user!;
    const { id } = req.params as { id: string };
    assertUuid(id, 'Ticket');
    await db
      .delete(schema.ticketFollowers)
      .where(and(eq(schema.ticketFollowers.ticketId, id), eq(schema.ticketFollowers.userId, user.id)));
    return reply.code(204).send();
  });
}
