/**
 * Companies: directory with member/open-ticket counts, CRUD, and customer membership
 * management (find-or-create customer users by email).
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, asc, eq, ilike, or, sql } from 'drizzle-orm';
import { db, schema } from '../../db/index.js';
import { badRequest, notFound, parse } from '../../lib/http.js';
import { requireAdmin, requireAgent, requireStaff } from '../../lib/auth.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Reject non-uuid path params early so Postgres never sees an invalid cast (22P02 → 500). */
function assertUuid(id: string, what = 'Resource'): void {
  if (!UUID_RE.test(id)) throw notFound(what);
}

const createSchema = z.object({
  name: z.string().trim().min(1),
  domains: z.array(z.string()).optional(),
  tier: z.string().optional(),
  timezone: z.string().optional(),
});

const patchSchema = z.object({
  name: z.string().trim().min(1).optional(),
  domains: z.array(z.string()).optional(),
  tier: z.string().nullable().optional(),
  timezone: z.string().nullable().optional(),
  membersSeeAllTickets: z.boolean().optional(),
  slaPolicyId: z.string().uuid().nullable().optional(),
  scheduleId: z.string().uuid().nullable().optional(),
  notes: z.string().nullable().optional(),
});

const memberCreateSchema = z.object({
  email: z.string().email(),
  name: z.string().trim().min(1).optional(),
});

const memberPatchSchema = z.object({
  isCompanyAdmin: z.boolean().optional(),
  canViewAllTickets: z.boolean().optional(),
});

function normalizeDomains(domains: string[]): string[] {
  return [...new Set(domains.map((d) => d.trim().toLowerCase()).filter(Boolean))];
}

async function getCompanyOr404(id: string) {
  assertUuid(id, 'Company');
  const [company] = await db.select().from(schema.companies).where(eq(schema.companies.id, id)).limit(1);
  if (!company) throw notFound('Company');
  return company;
}

async function memberView(companyId: string, userId: string) {
  const [row] = await db
    .select({
      userId: schema.companyMembers.userId,
      isCompanyAdmin: schema.companyMembers.isCompanyAdmin,
      canViewAllTickets: schema.companyMembers.canViewAllTickets,
      name: schema.users.name,
      email: schema.users.email,
    })
    .from(schema.companyMembers)
    .innerJoin(schema.users, eq(schema.companyMembers.userId, schema.users.id))
    .where(and(eq(schema.companyMembers.companyId, companyId), eq(schema.companyMembers.userId, userId)))
    .limit(1);
  if (!row) return null;
  return {
    userId: row.userId,
    name: row.name,
    email: row.email,
    isCompanyAdmin: row.isCompanyAdmin,
    canViewAllTickets: row.canViewAllTickets,
  };
}

export default async function routes(app: FastifyInstance): Promise<void> {
  app.get('/', { preHandler: requireStaff }, async (req) => {
    const { q } = parse(z.object({ q: z.string().optional() }), req.query);
    const like = q?.trim() ? `%${q.trim()}%` : null;
    const rows = await db
      .select({
        company: schema.companies,
        memberCount: sql<number>`(SELECT count(*)::int FROM company_members cm WHERE cm.company_id = ${schema.companies.id})`,
        openTickets: sql<number>`(SELECT count(*)::int FROM tickets t WHERE t.company_id = ${schema.companies.id} AND t.status IN ('new','open','waiting_on_customer','on_hold'))`,
      })
      .from(schema.companies)
      .where(
        like
          ? or(
              ilike(schema.companies.name, like),
              sql`array_to_string(${schema.companies.domains}, ' ') ILIKE ${like}`
            )
          : undefined
      )
      .orderBy(asc(schema.companies.name));
    return {
      items: rows.map((r) => ({
        id: r.company.id,
        name: r.company.name,
        domains: r.company.domains,
        tier: r.company.tier,
        timezone: r.company.timezone,
        membersSeeAllTickets: r.company.membersSeeAllTickets,
        slaPolicyId: r.company.slaPolicyId,
        scheduleId: r.company.scheduleId,
        memberCount: r.memberCount,
        openTickets: r.openTickets,
      })),
    };
  });

  app.post('/', { preHandler: requireAgent }, async (req, reply) => {
    const input = parse(createSchema, req.body);
    const [company] = await db
      .insert(schema.companies)
      .values({
        name: input.name,
        domains: normalizeDomains(input.domains ?? []),
        tier: input.tier ?? null,
        timezone: input.timezone ?? null,
      })
      .returning();
    reply.code(201);
    return company;
  });

  app.get('/:id', { preHandler: requireStaff }, async (req) => {
    const { id } = req.params as { id: string };
    const company = await getCompanyOr404(id);
    const members = await db
      .select({
        userId: schema.companyMembers.userId,
        isCompanyAdmin: schema.companyMembers.isCompanyAdmin,
        canViewAllTickets: schema.companyMembers.canViewAllTickets,
        name: schema.users.name,
        email: schema.users.email,
      })
      .from(schema.companyMembers)
      .innerJoin(schema.users, eq(schema.companyMembers.userId, schema.users.id))
      .where(eq(schema.companyMembers.companyId, company.id))
      .orderBy(asc(schema.users.name));
    return {
      ...company,
      members: members.map((m) => ({
        userId: m.userId,
        name: m.name,
        email: m.email,
        isCompanyAdmin: m.isCompanyAdmin,
        canViewAllTickets: m.canViewAllTickets,
      })),
    };
  });

  app.patch('/:id', { preHandler: requireAgent }, async (req) => {
    const { id } = req.params as { id: string };
    const company = await getCompanyOr404(id);
    const input = parse(patchSchema, req.body);
    const patch: Partial<typeof schema.companies.$inferInsert> = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.domains !== undefined) patch.domains = normalizeDomains(input.domains);
    if (input.tier !== undefined) patch.tier = input.tier;
    if (input.timezone !== undefined) patch.timezone = input.timezone;
    if (input.membersSeeAllTickets !== undefined) patch.membersSeeAllTickets = input.membersSeeAllTickets;
    if (input.slaPolicyId !== undefined) patch.slaPolicyId = input.slaPolicyId;
    if (input.scheduleId !== undefined) patch.scheduleId = input.scheduleId;
    if (input.notes !== undefined) patch.notes = input.notes;
    if (!Object.keys(patch).length) return company;
    const [updated] = await db
      .update(schema.companies)
      .set(patch)
      .where(eq(schema.companies.id, company.id))
      .returning();
    return updated;
  });

  app.delete('/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const company = await getCompanyOr404(id);
    await db.delete(schema.companies).where(eq(schema.companies.id, company.id));
    return reply.code(204).send();
  });

  // ---- Members ----
  app.post('/:id/members', { preHandler: requireAgent }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const company = await getCompanyOr404(id);
    const input = parse(memberCreateSchema, req.body);
    const email = input.email.trim().toLowerCase();

    let [user] = await db.select().from(schema.users).where(eq(schema.users.email, email)).limit(1);
    if (user && user.kind === 'staff') throw badRequest('That email belongs to a staff member');
    if (!user) {
      [user] = await db
        .insert(schema.users)
        .values({
          kind: 'customer',
          email,
          name: input.name?.trim() || email.split('@')[0] || email,
        })
        .returning();
    }
    if (!user) throw new Error('Failed to create customer user');

    await db
      .insert(schema.companyMembers)
      .values({ companyId: company.id, userId: user.id })
      .onConflictDoNothing();

    const member = await memberView(company.id, user.id);
    reply.code(201);
    return member;
  });

  app.patch('/:id/members/:userId', { preHandler: requireAgent }, async (req) => {
    const { id, userId } = req.params as { id: string; userId: string };
    const company = await getCompanyOr404(id);
    assertUuid(userId, 'Member');
    const input = parse(memberPatchSchema, req.body);

    const existing = await memberView(company.id, userId);
    if (!existing) throw notFound('Member');

    const patch: Partial<typeof schema.companyMembers.$inferInsert> = {};
    if (input.isCompanyAdmin !== undefined) patch.isCompanyAdmin = input.isCompanyAdmin;
    if (input.canViewAllTickets !== undefined) patch.canViewAllTickets = input.canViewAllTickets;
    if (Object.keys(patch).length) {
      await db
        .update(schema.companyMembers)
        .set(patch)
        .where(
          and(eq(schema.companyMembers.companyId, company.id), eq(schema.companyMembers.userId, userId))
        );
    }
    return memberView(company.id, userId);
  });

  app.delete('/:id/members/:userId', { preHandler: requireAgent }, async (req, reply) => {
    const { id, userId } = req.params as { id: string; userId: string };
    const company = await getCompanyOr404(id);
    assertUuid(userId, 'Member');
    await db
      .delete(schema.companyMembers)
      .where(
        and(eq(schema.companyMembers.companyId, company.id), eq(schema.companyMembers.userId, userId))
      );
    return reply.code(204).send();
  });
}
