/**
 * Customer portal API. Every route runs behind requireCustomer except POST /register.
 *
 * SECURITY: all reads flow through the scoping helpers in ./lib.js — a customer sees
 * only their own tickets, company tickets they were explicitly granted, and KB content
 * published to their audience. Invisible resources 404 (never 403) so the portal
 * never confirms that someone else's data exists.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { db, schema } from '../../db/index.js';
import { badRequest, forbidden, notFound, parse } from '../../lib/http.js';
import { createSession, hashPassword, requireCustomer } from '../../lib/auth.js';
import { onCustomerReply } from '../../lib/sla.js';
import { sendMail } from '../../lib/mailer.js';
import { bus } from '../../lib/events.js';
import { config } from '../../config.js';
import {
  assertUuid,
  companyForEmailDomain,
  createTicket,
  loadTicketSummary,
  requesterAlias,
} from '../tickets/service.js';
import {
  articleAudienceCondition,
  canSeeTicket,
  humanPromiseText,
  loadMemberships,
  memberCompanyIds,
  nextHumanReplyBy,
  searchPortalArticles,
  ticketVisibilityWhere,
  ticketVisibleCompanyIds,
  type Membership,
} from './lib.js';

const createTicketSchema = z.object({
  subject: z.string().trim().min(1).max(300),
  body: z.string().min(1),
});

const messageSchema = z.object({ body: z.string().min(1) });

const csatSchema = z.object({
  score: z.number().int().min(1).max(5),
  comment: z.string().max(2000).optional(),
});

const inviteSchema = z.object({
  email: z.string().email(),
  name: z.string().trim().min(1).max(120),
});

const registerSchema = z.object({
  email: z.string().email(),
  name: z.string().trim().min(1).max(120),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

/** Companies this customer administers; portal company management requires at least one. */
function adminMemberships(memberships: Membership[]): Membership[] {
  return memberships.filter((m) => m.isCompanyAdmin);
}

/** The member shape the company endpoints return. hasPassword = false means "invite pending". */
interface MemberOut {
  userId: string;
  name: string;
  email: string | null;
  isCompanyAdmin: boolean;
  canViewAllTickets: boolean;
  hasPassword: boolean;
}

async function loadCompanyMembers(companyId: string): Promise<MemberOut[]> {
  return db
    .select({
      userId: schema.companyMembers.userId,
      name: schema.users.name,
      email: schema.users.email,
      isCompanyAdmin: schema.companyMembers.isCompanyAdmin,
      canViewAllTickets: schema.companyMembers.canViewAllTickets,
      hasPassword: sql<boolean>`${schema.users.passwordHash} is not null`,
    })
    .from(schema.companyMembers)
    .innerJoin(schema.users, eq(schema.companyMembers.userId, schema.users.id))
    .where(eq(schema.companyMembers.companyId, companyId))
    .orderBy(asc(schema.users.name));
}

export default async function routes(app: FastifyInstance): Promise<void> {
  // ---- My tickets (own + visible company tickets) ----
  app.get('/tickets', { preHandler: requireCustomer }, async (req) => {
    const user = req.user!;
    const memberships = await loadMemberships(user.id);
    const where = ticketVisibilityWhere(user.id, ticketVisibleCompanyIds(memberships));

    const rows = await db
      .select({
        ticket: schema.tickets,
        requesterName: requesterAlias.name,
        requesterTimezone: requesterAlias.timezone,
        companyTimezone: schema.companies.timezone,
      })
      .from(schema.tickets)
      .innerJoin(requesterAlias, eq(schema.tickets.requesterId, requesterAlias.id))
      .leftJoin(schema.companies, eq(schema.tickets.companyId, schema.companies.id))
      .where(where)
      .orderBy(desc(schema.tickets.updatedAt))
      .limit(200);

    return {
      items: rows.map((r) => {
        const due = nextHumanReplyBy(r.ticket);
        return {
          id: r.ticket.id,
          number: r.ticket.number,
          subject: r.ticket.subject,
          status: r.ticket.status,
          priority: r.ticket.priority,
          updatedAt: r.ticket.updatedAt,
          createdAt: r.ticket.createdAt,
          requesterName: r.requesterName,
          nextHumanReplyBy: due,
          promiseText: humanPromiseText(due, r.requesterTimezone ?? r.companyTimezone),
        };
      }),
    };
  });

  // ---- New ticket (channel 'portal'; the service sends the labeled receipt + emits ticket.created) ----
  app.post('/tickets', { preHandler: requireCustomer }, async (req, reply) => {
    const user = req.user!;
    if (!user.email) throw badRequest('Your account has no email address — please contact support');
    const input = parse(createTicketSchema, req.body);

    const ticket = await createTicket({
      subject: input.subject,
      body: input.body,
      requesterEmail: user.email,
      requesterName: user.name,
      channel: 'portal',
      actorId: user.id,
    });

    const due = nextHumanReplyBy(ticket);
    reply.code(201);
    return {
      ...ticket,
      nextHumanReplyBy: due,
      promiseText: humanPromiseText(due, user.timezone),
    };
  });

  // ---- Ticket detail: public messages only, staff authors without internal ids ----
  app.get('/tickets/:id', { preHandler: requireCustomer }, async (req) => {
    const user = req.user!;
    const { id } = req.params as { id: string };
    assertUuid(id, 'Ticket');

    const row = await loadTicketSummary(id);
    const memberships = await loadMemberships(user.id);
    if (!row || !canSeeTicket(row.ticket, user.id, ticketVisibleCompanyIds(memberships))) {
      throw notFound('Ticket');
    }

    const messages = await db
      .select({
        id: schema.ticketMessages.id,
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
      .where(and(eq(schema.ticketMessages.ticketId, id), eq(schema.ticketMessages.kind, 'public')))
      .orderBy(asc(schema.ticketMessages.createdAt));

    // "Own CSAT": only surfaced to the requester — a colleague browsing company
    // tickets doesn't need to see how someone else rated the experience.
    let csat: { score: number; comment: string | null } | null = null;
    if (row.ticket.requesterId === user.id) {
      const [existing] = await db
        .select()
        .from(schema.csatResponses)
        .where(eq(schema.csatResponses.ticketId, id))
        .limit(1);
      if (existing) csat = { score: existing.score, comment: existing.comment };
    }

    const due = nextHumanReplyBy(row.ticket);
    const timezone = row.requester.timezone ?? row.company?.timezone ?? null;

    return {
      // Curated subset — the portal never exposes assignee ids, SLA policy internals, or tags.
      ticket: {
        id: row.ticket.id,
        number: row.ticket.number,
        subject: row.ticket.subject,
        status: row.ticket.status,
        priority: row.ticket.priority,
        channel: row.ticket.channel,
        createdAt: row.ticket.createdAt,
        updatedAt: row.ticket.updatedAt,
        requesterName: row.requester.name,
        isOwn: row.ticket.requesterId === user.id,
        companyName: row.company?.name ?? null,
        nextHumanReplyBy: due,
        promiseText: humanPromiseText(due, timezone),
      },
      messages: messages.map((m) => ({
        id: m.id,
        body: m.body,
        createdAt: m.createdAt,
        author: m.author
          ? {
              name: m.author.name,
              title: m.author.kind === 'staff' ? m.author.title : null,
              avatarUrl: m.author.avatarUrl,
              kind: m.author.kind,
            }
          : null,
      })),
      csat,
    };
  });

  // ---- Customer reply ----
  app.post('/tickets/:id/messages', { preHandler: requireCustomer }, async (req, reply) => {
    const user = req.user!;
    const { id } = req.params as { id: string };
    assertUuid(id, 'Ticket');
    const { body } = parse(messageSchema, req.body);

    const row = await loadTicketSummary(id);
    const memberships = await loadMemberships(user.id);
    if (!row || !canSeeTicket(row.ticket, user.id, ticketVisibleCompanyIds(memberships))) {
      throw notFound('Ticket');
    }
    if (row.ticket.status === 'closed') {
      throw badRequest('This ticket is closed — please open a new ticket instead');
    }

    const now = new Date();
    const [message] = await db
      .insert(schema.ticketMessages)
      .values({ ticketId: id, kind: 'public', authorId: user.id, body, channel: 'portal' })
      .returning();
    if (!message) throw new Error('Failed to create message');

    // Reopens waiting/solved tickets and restarts the next-response clock.
    await onCustomerReply(id, now);

    bus.emitEvent('message.created', {
      ticketId: id,
      messageId: message.id,
      kind: 'public',
      authorId: user.id,
      authorKind: 'customer',
      customer: true,
    });

    reply.code(201);
    return {
      id: message.id,
      body: message.body,
      createdAt: message.createdAt,
      author: { name: user.name, title: null, avatarUrl: user.avatarUrl, kind: 'customer' },
    };
  });

  // ---- CSAT (requester only, solved/closed only, one response per ticket — upsert) ----
  app.post('/tickets/:id/csat', { preHandler: requireCustomer }, async (req) => {
    const user = req.user!;
    const { id } = req.params as { id: string };
    assertUuid(id, 'Ticket');
    const input = parse(csatSchema, req.body);

    const row = await loadTicketSummary(id);
    // Only the person who asked can rate the experience — company visibility isn't enough.
    if (!row || row.ticket.requesterId !== user.id) throw notFound('Ticket');
    if (row.ticket.status !== 'solved' && row.ticket.status !== 'closed') {
      throw badRequest('You can rate a ticket once it has been solved');
    }

    const [existing] = await db
      .select()
      .from(schema.csatResponses)
      .where(eq(schema.csatResponses.ticketId, id))
      .limit(1);
    let saved;
    if (existing) {
      [saved] = await db
        .update(schema.csatResponses)
        .set({ score: input.score, comment: input.comment ?? null })
        .where(eq(schema.csatResponses.id, existing.id))
        .returning();
    } else {
      [saved] = await db
        .insert(schema.csatResponses)
        .values({ ticketId: id, score: input.score, comment: input.comment ?? null })
        .returning();
    }
    if (!saved) throw new Error('Failed to save rating');
    return { score: saved.score, comment: saved.comment };
  });

  // ---- Knowledge base: audience-scoped categories/articles (+ optional search) ----
  app.get('/kb', { preHandler: requireCustomer }, async (req) => {
    const user = req.user!;
    const { q } = parse(z.object({ q: z.string().max(200).optional() }), req.query);
    const memberships = await loadMemberships(user.id);
    const companyIds = memberCompanyIds(memberships);
    const a = schema.kbArticles;
    const c = schema.kbCategories;

    const articles = await db
      .select({
        id: a.id,
        title: a.title,
        slug: a.slug,
        categoryId: a.categoryId,
        articleType: a.articleType,
        updatedAt: a.updatedAt,
      })
      .from(a)
      .where(and(eq(a.status, 'published'), articleAudienceCondition(companyIds)))
      .orderBy(asc(a.position), asc(a.title));

    const categoryIds = [...new Set(articles.map((art) => art.categoryId).filter((v): v is string => v != null))];
    const categories = categoryIds.length
      ? await db
          .select({ id: c.id, name: c.name, slug: c.slug, description: c.description, position: c.position })
          .from(c)
          .where(inArray(c.id, categoryIds))
          .orderBy(asc(c.position), asc(c.name))
      : [];

    const byCategory = new Map<string, { id: string; title: string; slug: string; articleType: string | null }[]>();
    const uncategorized: { id: string; title: string; slug: string; articleType: string | null }[] = [];
    for (const art of articles) {
      const item = { id: art.id, title: art.title, slug: art.slug, articleType: art.articleType };
      if (!art.categoryId) {
        uncategorized.push(item);
        continue;
      }
      const list = byCategory.get(art.categoryId) ?? [];
      list.push(item);
      byCategory.set(art.categoryId, list);
    }

    // ?q= → scoped search; every query is logged so zero-result searches feed the writing queue.
    let results: Awaited<ReturnType<typeof searchPortalArticles>> | null = null;
    const query = (q ?? '').trim();
    if (query) {
      results = await searchPortalArticles(query, companyIds);
      await db.insert(schema.kbSearchQueries).values({
        query,
        resultCount: results.length,
        source: 'portal',
      });
    }

    return {
      categories: categories.map((cat) => ({
        id: cat.id,
        name: cat.name,
        slug: cat.slug,
        description: cat.description,
        articles: byCategory.get(cat.id) ?? [],
      })),
      uncategorized,
      results,
    };
  });

  // ---- Article body (audience-scoped; counts the view) ----
  app.get('/kb/:slug', { preHandler: requireCustomer }, async (req) => {
    const user = req.user!;
    const { slug } = parse(z.object({ slug: z.string().min(1).max(160) }), req.params);
    const memberships = await loadMemberships(user.id);
    const a = schema.kbArticles;
    const c = schema.kbCategories;

    const rows = await db
      .select({ article: a, category: c })
      .from(a)
      .leftJoin(c, eq(a.categoryId, c.id))
      .where(
        and(
          eq(a.slug, slug),
          eq(a.status, 'published'),
          articleAudienceCondition(memberCompanyIds(memberships))
        )
      )
      .limit(1);
    if (!rows[0]) throw notFound('Article');
    const { article, category } = rows[0];

    await db
      .update(a)
      .set({ viewCount: sql`${a.viewCount} + 1` })
      .where(eq(a.id, article.id));

    return {
      id: article.id,
      title: article.title,
      body: article.body,
      articleType: article.articleType,
      updatedAt: article.updatedAt,
      category: category ? { name: category.name, slug: category.slug } : null,
    };
  });

  // ---- Company overview (company admins only) ----
  app.get('/company', { preHandler: requireCustomer }, async (req) => {
    const user = req.user!;
    const memberships = await loadMemberships(user.id);
    const admin = adminMemberships(memberships)[0];
    if (!admin) throw forbidden('Company admins only');

    const [company] = await db
      .select()
      .from(schema.companies)
      .where(eq(schema.companies.id, admin.companyId))
      .limit(1);
    if (!company) throw notFound('Company');

    const [members, ticketRows] = await Promise.all([
      loadCompanyMembers(company.id),
      db
        .select({
          ticket: schema.tickets,
          requesterName: requesterAlias.name,
          requesterTimezone: requesterAlias.timezone,
        })
        .from(schema.tickets)
        .innerJoin(requesterAlias, eq(schema.tickets.requesterId, requesterAlias.id))
        .where(eq(schema.tickets.companyId, company.id))
        .orderBy(desc(schema.tickets.updatedAt))
        .limit(20),
    ]);

    return {
      company: {
        id: company.id,
        name: company.name,
        domains: company.domains,
        tier: company.tier,
        timezone: company.timezone,
        membersSeeAllTickets: company.membersSeeAllTickets,
      },
      members,
      tickets: ticketRows.map((r) => {
        const due = nextHumanReplyBy(r.ticket);
        return {
          id: r.ticket.id,
          number: r.ticket.number,
          subject: r.ticket.subject,
          status: r.ticket.status,
          priority: r.ticket.priority,
          updatedAt: r.ticket.updatedAt,
          requesterName: r.requesterName,
          nextHumanReplyBy: due,
          promiseText: humanPromiseText(due, r.requesterTimezone ?? company.timezone),
        };
      }),
    };
  });

  // ---- Invite a colleague (company admins only) ----
  // The invitee is created with passwordHash null; they claim the account by signing up
  // at the portal with the same email (POST /register below).
  app.post('/company/members', { preHandler: requireCustomer }, async (req, reply) => {
    const user = req.user!;
    const input = parse(inviteSchema, req.body);
    const memberships = await loadMemberships(user.id);
    const admin = adminMemberships(memberships)[0];
    if (!admin) throw forbidden('Company admins only');

    const [company] = await db
      .select()
      .from(schema.companies)
      .where(eq(schema.companies.id, admin.companyId))
      .limit(1);
    if (!company) throw notFound('Company');

    const normalized = input.email.trim().toLowerCase();
    const [existing] = await db
      .select()
      .from(schema.users)
      .where(sql`lower(${schema.users.email}) = ${normalized}`)
      .limit(1);
    if (existing && existing.kind !== 'customer') {
      // Staff addresses can't be pulled into a customer company. Keep the message generic.
      throw badRequest('That email address cannot be added to your company');
    }

    let invitee = existing;
    if (!invitee) {
      [invitee] = await db
        .insert(schema.users)
        .values({ kind: 'customer', email: normalized, name: input.name })
        .returning();
    }
    if (!invitee) throw new Error('Failed to create user');

    await db
      .insert(schema.companyMembers)
      .values({ companyId: company.id, userId: invitee.id })
      .onConflictDoNothing();

    // Labeled invite mail with the portal link and account-claim instructions.
    const portalUrl = `${config.appUrl}/portal/login`;
    const needsAccount = invitee.passwordHash == null;
    await sendMail({
      to: normalized,
      subject: `[Invitation] ${user.name} added you to ${company.name}'s support portal`,
      text: [
        `Hi ${invitee.name},`,
        '',
        `${user.name} added you to ${company.name}'s support portal, where you can open and track support tickets.`,
        '',
        needsAccount
          ? `To activate your account, sign up with this email address (${normalized}) and choose a password here:`
          : 'Sign in with your existing account here:',
        portalUrl,
        '',
        'This is an automated invitation — real people answer every ticket. No bots write our replies.',
      ].join('\n'),
    });

    const [member] = await db
      .select({
        isCompanyAdmin: schema.companyMembers.isCompanyAdmin,
        canViewAllTickets: schema.companyMembers.canViewAllTickets,
      })
      .from(schema.companyMembers)
      .where(
        and(
          eq(schema.companyMembers.companyId, company.id),
          eq(schema.companyMembers.userId, invitee.id)
        )
      )
      .limit(1);

    reply.code(201);
    return {
      userId: invitee.id,
      name: invitee.name,
      email: invitee.email,
      isCompanyAdmin: member?.isCompanyAdmin ?? false,
      canViewAllTickets: member?.canViewAllTickets ?? false,
      hasPassword: invitee.passwordHash != null,
    };
  });

  // ---- Toggle a member's ticket visibility (company admins only, own companies only) ----
  app.patch('/company/members/:userId', { preHandler: requireCustomer }, async (req) => {
    const user = req.user!;
    const { userId } = req.params as { userId: string };
    assertUuid(userId, 'Member');
    const { canViewAllTickets } = parse(
      z.object({ canViewAllTickets: z.boolean().optional() }),
      req.body
    );

    const memberships = await loadMemberships(user.id);
    const adminCompanyIds = adminMemberships(memberships).map((m) => m.companyId);
    if (!adminCompanyIds.length) throw forbidden('Company admins only');

    // The target must be a member of a company this user administers — anyone else is invisible.
    const [target] = await db
      .select({
        companyId: schema.companyMembers.companyId,
        userId: schema.companyMembers.userId,
      })
      .from(schema.companyMembers)
      .where(
        and(
          eq(schema.companyMembers.userId, userId),
          inArray(schema.companyMembers.companyId, adminCompanyIds)
        )
      )
      .limit(1);
    if (!target) throw notFound('Member');

    if (canViewAllTickets !== undefined) {
      await db
        .update(schema.companyMembers)
        .set({ canViewAllTickets })
        .where(
          and(
            eq(schema.companyMembers.companyId, target.companyId),
            eq(schema.companyMembers.userId, target.userId)
          )
        );
    }

    const [member] = await db
      .select({
        userId: schema.companyMembers.userId,
        name: schema.users.name,
        email: schema.users.email,
        isCompanyAdmin: schema.companyMembers.isCompanyAdmin,
        canViewAllTickets: schema.companyMembers.canViewAllTickets,
        hasPassword: sql<boolean>`${schema.users.passwordHash} is not null`,
      })
      .from(schema.companyMembers)
      .innerJoin(schema.users, eq(schema.companyMembers.userId, schema.users.id))
      .where(
        and(
          eq(schema.companyMembers.companyId, target.companyId),
          eq(schema.companyMembers.userId, target.userId)
        )
      )
      .limit(1);
    if (!member) throw notFound('Member');
    return member;
  });

  // ---- Self-service sign-up / account claim (no auth) ----
  // A customer row with passwordHash null (created by inbound email, staff, or a company
  // admin invite) is claimed by registering with the same email. Existing accounts with
  // a password — and any staff account — get one generic 400 so emails aren't probed.
  app.post('/register', async (req, reply) => {
    const input = parse(registerSchema, req.body);
    const normalized = input.email.trim().toLowerCase();

    const [existing] = await db
      .select()
      .from(schema.users)
      .where(sql`lower(${schema.users.email}) = ${normalized}`)
      .limit(1);

    const passwordHash = await hashPassword(input.password);
    let user;
    if (existing) {
      const claimable =
        existing.kind === 'customer' && existing.passwordHash == null && existing.active;
      if (!claimable) {
        throw badRequest('An account with this email already exists — try signing in instead');
      }
      [user] = await db
        .update(schema.users)
        .set({ name: input.name, passwordHash })
        .where(eq(schema.users.id, existing.id))
        .returning();
    } else {
      [user] = await db
        .insert(schema.users)
        .values({ kind: 'customer', email: normalized, name: input.name, passwordHash })
        .returning();
    }
    if (!user) throw new Error('Failed to create account');

    // Auto-associate by email domain — always as a plain member, never as company admin.
    const company = await companyForEmailDomain(normalized);
    if (company) {
      await db
        .insert(schema.companyMembers)
        .values({ companyId: company.id, userId: user.id })
        .onConflictDoNothing();
    }

    await createSession(reply, user.id);
    reply.code(201);
    return {
      id: user.id,
      kind: user.kind,
      role: user.role,
      name: user.name,
      email: user.email,
      title: user.title,
      avatarUrl: user.avatarUrl,
      timezone: user.timezone,
    };
  });
}
