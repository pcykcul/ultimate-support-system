import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { forbidden, unauthorized } from './http.js';

const SESSION_COOKIE = 'uss_session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

export type SessionUser = typeof schema.users.$inferSelect;

declare module 'fastify' {
  interface FastifyRequest {
    user: SessionUser | null;
  }
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export async function createSession(reply: FastifyReply, userId: string): Promise<void> {
  const id = crypto.randomBytes(32).toString('hex');
  await db.insert(schema.sessions).values({
    id,
    userId,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
  });
  reply.setCookie(SESSION_COOKIE, id, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: SESSION_TTL_MS / 1000,
    signed: true,
  });
}

export async function destroySession(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const raw = request.cookies[SESSION_COOKIE];
  if (raw) {
    const unsigned = request.unsignCookie(raw);
    if (unsigned.valid && unsigned.value) {
      await db.delete(schema.sessions).where(eq(schema.sessions.id, unsigned.value));
    }
  }
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
}

/** Populates request.user from the session cookie (null when signed out). Registered as a global hook. */
export async function loadUser(request: FastifyRequest): Promise<void> {
  request.user = null;
  const raw = request.cookies[SESSION_COOKIE];
  if (!raw) return;
  const unsigned = request.unsignCookie(raw);
  if (!unsigned.valid || !unsigned.value) return;
  const rows = await db
    .select({ session: schema.sessions, user: schema.users })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.sessions.userId, schema.users.id))
    .where(eq(schema.sessions.id, unsigned.value))
    .limit(1);
  const row = rows[0];
  if (!row) return;
  if (row.session.expiresAt.getTime() < Date.now()) {
    await db.delete(schema.sessions).where(eq(schema.sessions.id, row.session.id));
    return;
  }
  if (!row.user.active) return;
  request.user = row.user;
}

// ---- Route guards (use as preHandler) ----

export async function requireAuth(request: FastifyRequest): Promise<void> {
  if (!request.user) throw unauthorized();
}

/** Any staff member, collaborators included. */
export async function requireStaff(request: FastifyRequest): Promise<void> {
  if (!request.user) throw unauthorized();
  if (request.user.kind !== 'staff') throw forbidden('Staff only');
}

/** Staff who can act on tickets (not collaborators). */
export async function requireAgent(request: FastifyRequest): Promise<void> {
  await requireStaff(request);
  if (request.user!.role === 'collaborator') throw forbidden('Collaborators have read-only access');
}

export async function requireSupervisor(request: FastifyRequest): Promise<void> {
  await requireStaff(request);
  if (request.user!.role !== 'admin' && request.user!.role !== 'supervisor') {
    throw forbidden('Supervisor or admin only');
  }
}

export async function requireAdmin(request: FastifyRequest): Promise<void> {
  await requireStaff(request);
  if (request.user!.role !== 'admin') throw forbidden('Admin only');
}

/** Customer portal guard. */
export async function requireCustomer(request: FastifyRequest): Promise<void> {
  if (!request.user) throw unauthorized();
  if (request.user.kind !== 'customer') throw forbidden('Customer portal only');
}
