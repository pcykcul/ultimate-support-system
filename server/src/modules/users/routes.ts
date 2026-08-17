/**
 * Staff directory & teams. Staff are invited by admins: we create the (passwordless) user row,
 * stash the invite under settings key `invite:<token>`, and email a link that the auth module's
 * accept-invite endpoint consumes.
 */
import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, asc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { db, schema } from '../../db/index.js';
import { config } from '../../config.js';
import { badRequest, forbidden, notFound, parse } from '../../lib/http.js';
import { requireAdmin, requireStaff, type SessionUser } from '../../lib/auth.js';
import { sendMail } from '../../lib/mailer.js';

const INVITE_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

const idParamSchema = z.object({ id: z.string().uuid() });

const listQuerySchema = z.object({
  kind: z.enum(['staff', 'customer']).optional(),
  q: z.string().optional(),
});

const createInviteSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  role: z.enum(['admin', 'supervisor', 'agent', 'collaborator']),
  title: z.string().optional(),
  timezone: z.string().optional(),
});

/** Fields anyone may change on their own profile. Unknown keys are stripped by zod. */
const selfPatchSchema = z.object({
  name: z.string().min(1).optional(),
  title: z.string().nullable().optional(),
  timezone: z.string().optional(),
  avatarUrl: z.string().nullable().optional(),
});

const adminPatchSchema = selfPatchSchema.extend({
  role: z.enum(['admin', 'supervisor', 'agent', 'collaborator']).optional(),
  scope: z.enum(['all', 'team', 'assigned']).optional(),
  active: z.boolean().optional(),
});

const createTeamSchema = z.object({
  name: z.string().min(1),
  emoji: z.string().optional(),
});

const patchTeamSchema = z.object({
  name: z.string().min(1).optional(),
  emoji: z.string().nullable().optional(),
  scheduleId: z.string().uuid().nullable().optional(),
  memberIds: z.array(z.string().uuid()).optional(),
});

function directoryItem(user: SessionUser, teamIds: string[]) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    title: user.title,
    timezone: user.timezone,
    active: user.active,
    teamIds,
  };
}

async function teamIdsFor(userId: string): Promise<string[]> {
  const rows = await db
    .select()
    .from(schema.teamMembers)
    .where(eq(schema.teamMembers.userId, userId));
  return rows.map((r) => r.teamId);
}

async function brandName(): Promise<string> {
  const rows = await db
    .select()
    .from(schema.settings)
    .where(eq(schema.settings.key, 'branding'))
    .limit(1);
  const value = rows[0]?.value as { name?: string } | undefined;
  return value?.name?.trim() || 'Support';
}

type Team = typeof schema.teams.$inferSelect;

function teamItem(team: Team, memberIds: string[]) {
  return {
    id: team.id,
    name: team.name,
    emoji: team.emoji,
    scheduleId: team.scheduleId,
    memberIds,
  };
}

export default async function routes(app: FastifyInstance): Promise<void> {
  // ---- Staff directory ----

  // GET / — directory listing; ?kind=staff|customer (default staff), ?q= name/email filter.
  app.get('/', { preHandler: requireStaff }, async (req) => {
    const { kind = 'staff', q } = parse(listQuerySchema, req.query);
    const filters = [eq(schema.users.kind, kind)];
    if (q && q.trim()) {
      const like = `%${q.trim()}%`;
      filters.push(or(ilike(schema.users.name, like), ilike(schema.users.email, like))!);
    }
    const rows = await db
      .select()
      .from(schema.users)
      .where(and(...filters))
      .orderBy(asc(schema.users.name));

    const byUser = new Map<string, string[]>();
    if (rows.length > 0) {
      const memberships = await db
        .select()
        .from(schema.teamMembers)
        .where(inArray(schema.teamMembers.userId, rows.map((r) => r.id)));
      for (const m of memberships) {
        const list = byUser.get(m.userId);
        if (list) list.push(m.teamId);
        else byUser.set(m.userId, [m.teamId]);
      }
    }
    return { items: rows.map((u) => directoryItem(u, byUser.get(u.id) ?? [])) };
  });

  // POST / — create an invited staff user (no password yet) + email the invite link.
  app.post('/', { preHandler: requireAdmin }, async (req, reply) => {
    const body = parse(createInviteSchema, req.body);
    const email = body.email.toLowerCase();

    const existing = await db
      .select()
      .from(schema.users)
      .where(sql`lower(${schema.users.email}) = ${email}`)
      .limit(1);
    if (existing[0]) throw badRequest('A user with that email already exists');

    const inserted = await db
      .insert(schema.users)
      .values({
        kind: 'staff',
        email,
        name: body.name,
        role: body.role,
        title: body.title ?? null,
        timezone: body.timezone ?? 'UTC',
      })
      .returning();
    const user = inserted[0]!;

    const token = crypto.randomBytes(24).toString('hex');
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS).toISOString();
    await db.insert(schema.settings).values({
      key: `invite:${token}`,
      value: { email, role: body.role, name: body.name, expiresAt },
    });

    const brand = await brandName();
    const inviteUrl = `${config.appUrl}/login?invite=${token}`;
    await sendMail({
      to: email,
      subject: `[Invitation] Join ${brand} as ${body.role}`,
      text: [
        `Hi ${body.name},`,
        '',
        `${req.user!.name} invited you to join the ${brand} support team as ${body.role}.`,
        '',
        `Choose your password to finish setting up your account (link valid for 7 days):`,
        inviteUrl,
        '',
        `This is an automated invitation receipt — the invite itself came from a real person, ` +
          `and every reply on ${brand} does too.`,
      ].join('\n'),
    });

    reply.status(201);
    return {
      ...directoryItem(user, []),
      // Dev convenience: no SMTP configured locally, so surface the token for manual testing.
      ...(config.isProduction ? {} : { inviteToken: token }),
    };
  });

  // PATCH /:id — admin edits anyone; everyone else may edit their own name/title/timezone/avatar.
  app.patch('/:id', { preHandler: requireStaff }, async (req) => {
    const { id } = parse(idParamSchema, req.params);
    const isAdmin = req.user!.role === 'admin';
    if (!isAdmin && req.user!.id !== id) throw forbidden('You can only edit your own profile');

    // Self-service edits parse against the narrower schema, so role/scope/active are stripped.
    const body: z.infer<typeof adminPatchSchema> = isAdmin
      ? parse(adminPatchSchema, req.body)
      : parse(selfPatchSchema, req.body);
    const updates: Partial<typeof schema.users.$inferInsert> = {};
    if (body.name !== undefined) updates.name = body.name;
    if (body.title !== undefined) updates.title = body.title;
    if (body.timezone !== undefined) updates.timezone = body.timezone;
    if (body.avatarUrl !== undefined) updates.avatarUrl = body.avatarUrl;
    if (body.role !== undefined) updates.role = body.role;
    if (body.scope !== undefined) updates.scope = body.scope;
    if (body.active !== undefined) updates.active = body.active;

    if (Object.keys(updates).length === 0) {
      const rows = await db.select().from(schema.users).where(eq(schema.users.id, id)).limit(1);
      if (!rows[0]) throw notFound('User');
      return directoryItem(rows[0], await teamIdsFor(id));
    }

    const updated = await db
      .update(schema.users)
      .set(updates)
      .where(eq(schema.users.id, id))
      .returning();
    if (!updated[0]) throw notFound('User');
    return directoryItem(updated[0], await teamIdsFor(id));
  });

  // POST /:id/deactivate — admin only; also revokes the user's sessions.
  app.post('/:id/deactivate', { preHandler: requireAdmin }, async (req, reply) => {
    const { id } = parse(idParamSchema, req.params);
    if (id === req.user!.id) throw badRequest('You cannot deactivate your own account');
    const updated = await db
      .update(schema.users)
      .set({ active: false })
      .where(eq(schema.users.id, id))
      .returning();
    if (!updated[0]) throw notFound('User');
    await db.delete(schema.sessions).where(eq(schema.sessions.userId, id));
    return reply.status(204).send();
  });

  // ---- Teams ----

  app.get('/teams', { preHandler: requireStaff }, async () => {
    const rows = await db.select().from(schema.teams).orderBy(asc(schema.teams.name));
    const byTeam = new Map<string, string[]>();
    if (rows.length > 0) {
      const memberships = await db
        .select()
        .from(schema.teamMembers)
        .where(inArray(schema.teamMembers.teamId, rows.map((t) => t.id)));
      for (const m of memberships) {
        const list = byTeam.get(m.teamId);
        if (list) list.push(m.userId);
        else byTeam.set(m.teamId, [m.userId]);
      }
    }
    return { items: rows.map((t) => teamItem(t, byTeam.get(t.id) ?? [])) };
  });

  app.post('/teams', { preHandler: requireAdmin }, async (req, reply) => {
    const body = parse(createTeamSchema, req.body);
    const inserted = await db
      .insert(schema.teams)
      .values({ name: body.name, emoji: body.emoji ?? null })
      .returning();
    reply.status(201);
    return teamItem(inserted[0]!, []);
  });

  app.patch('/teams/:id', { preHandler: requireAdmin }, async (req) => {
    const { id } = parse(idParamSchema, req.params);
    const body = parse(patchTeamSchema, req.body);

    const existing = await db.select().from(schema.teams).where(eq(schema.teams.id, id)).limit(1);
    if (!existing[0]) throw notFound('Team');

    const updates: Partial<typeof schema.teams.$inferInsert> = {};
    if (body.name !== undefined) updates.name = body.name;
    if (body.emoji !== undefined) updates.emoji = body.emoji;
    if (body.scheduleId !== undefined) updates.scheduleId = body.scheduleId;

    let team = existing[0];
    if (Object.keys(updates).length > 0) {
      const updated = await db
        .update(schema.teams)
        .set(updates)
        .where(eq(schema.teams.id, id))
        .returning();
      team = updated[0]!;
    }

    let memberIds: string[];
    if (body.memberIds !== undefined) {
      // Replace the roster wholesale via team_members.
      const wanted = [...new Set(body.memberIds)];
      if (wanted.length > 0) {
        const found = await db
          .select({ id: schema.users.id })
          .from(schema.users)
          .where(and(inArray(schema.users.id, wanted), eq(schema.users.kind, 'staff')));
        if (found.length !== wanted.length) {
          throw badRequest('memberIds must all be existing staff users');
        }
      }
      await db.delete(schema.teamMembers).where(eq(schema.teamMembers.teamId, id));
      if (wanted.length > 0) {
        await db
          .insert(schema.teamMembers)
          .values(wanted.map((userId) => ({ teamId: id, userId })));
      }
      memberIds = wanted;
    } else {
      const memberships = await db
        .select()
        .from(schema.teamMembers)
        .where(eq(schema.teamMembers.teamId, id));
      memberIds = memberships.map((m) => m.userId);
    }

    return teamItem(team, memberIds);
  });

  app.delete('/teams/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const { id } = parse(idParamSchema, req.params);
    const deleted = await db.delete(schema.teams).where(eq(schema.teams.id, id)).returning();
    if (!deleted[0]) throw notFound('Team');
    return reply.status(204).send();
  });
}
