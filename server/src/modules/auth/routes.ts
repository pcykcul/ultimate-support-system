/**
 * Authentication: session login/logout, current-user lookup, and staff invite acceptance.
 * Invites live in the settings table under `invite:<token>` — created by the users module,
 * consumed (and deleted) here.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq, sql } from 'drizzle-orm';
import { db, schema } from '../../db/index.js';
import { badRequest, parse, unauthorized } from '../../lib/http.js';
import {
  createSession,
  destroySession,
  hashPassword,
  requireAuth,
  verifyPassword,
  type SessionUser,
} from '../../lib/auth.js';

const STAFF_ROLES = ['admin', 'supervisor', 'agent', 'collaborator'] as const;

interface StoredInvite {
  email: string;
  role: (typeof STAFF_ROLES)[number];
  name?: string;
  expiresAt: string;
}

/** The public user shape every auth endpoint returns. */
function publicUser(user: SessionUser) {
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
}

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const acceptInviteSchema = z.object({
  token: z.string().min(1),
  name: z.string().min(1),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

async function findUserByEmail(email: string): Promise<SessionUser | undefined> {
  const rows = await db
    .select()
    .from(schema.users)
    .where(sql`lower(${schema.users.email}) = lower(${email})`)
    .limit(1);
  return rows[0];
}

export default async function routes(app: FastifyInstance): Promise<void> {
  // POST /login — staff or customer sign-in. Sets the session cookie.
  app.post('/login', async (req, reply) => {
    const { email, password } = parse(loginSchema, req.body);
    const user = await findUserByEmail(email);
    // One generic message for every failure mode: never reveal which emails exist.
    if (!user || !user.active || !user.passwordHash) {
      throw unauthorized('Invalid email or password');
    }
    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) throw unauthorized('Invalid email or password');
    await db
      .update(schema.users)
      .set({ lastSeenAt: new Date() })
      .where(eq(schema.users.id, user.id));
    await createSession(reply, user.id);
    return publicUser(user);
  });

  // POST /logout — destroy the session, clear the cookie.
  app.post('/logout', async (req, reply) => {
    await destroySession(req, reply);
    return reply.status(204).send();
  });

  // GET /me — the signed-in user, or 401.
  app.get('/me', { preHandler: requireAuth }, async (req) => publicUser(req.user!));

  // POST /accept-invite — turn an emailed invite token into a staff account with a password.
  app.post('/accept-invite', async (req, reply) => {
    const { token, name, password } = parse(acceptInviteSchema, req.body);
    const key = `invite:${token}`;
    const rows = await db
      .select()
      .from(schema.settings)
      .where(eq(schema.settings.key, key))
      .limit(1);
    const row = rows[0];
    if (!row) throw badRequest('This invite is invalid or has already been used');
    const invite = row.value as StoredInvite;
    if (!invite.email || !STAFF_ROLES.includes(invite.role)) {
      throw badRequest('This invite is invalid or has already been used');
    }
    if (new Date(invite.expiresAt).getTime() < Date.now()) {
      await db.delete(schema.settings).where(eq(schema.settings.key, key));
      throw badRequest('This invite has expired — ask an admin to send a new one');
    }

    const passwordHash = await hashPassword(password);
    const existing = await findUserByEmail(invite.email);
    let user: SessionUser;
    if (existing) {
      // The users module creates the staff row at invite time; here we activate it.
      const updated = await db
        .update(schema.users)
        .set({ kind: 'staff', role: invite.role, name, passwordHash, active: true })
        .where(eq(schema.users.id, existing.id))
        .returning();
      user = updated[0]!;
    } else {
      const inserted = await db
        .insert(schema.users)
        .values({
          kind: 'staff',
          email: invite.email.toLowerCase(),
          name,
          role: invite.role,
          passwordHash,
        })
        .returning();
      user = inserted[0]!;
    }

    // Single-use: the token dies with the settings row.
    await db.delete(schema.settings).where(eq(schema.settings.key, key));
    await createSession(reply, user.id);
    return publicUser(user);
  });
}
