/**
 * Live-chat helpers: visitor tokens (stored in the settings table under `chatToken:<token>`,
 * mirroring the invite-token pattern), honest presence computed from the default business
 * schedule, and the public-message serialization the widget stream uses.
 *
 * Chat is human-only. The presence promise never pretends anyone is online when the
 * default schedule says the team is closed — that honesty is the product.
 */
import crypto from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import { db, schema } from '../../db/index.js';
import { unauthorized } from '../../lib/http.js';
import { loadBusinessSchedule } from '../../lib/sla.js';
import { formatLocalClock, isOpen, nextOpenTime } from '../../lib/hours.js';

export const VISITOR_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24h

export interface VisitorTokenRecord {
  ticketId: string;
  userId: string;
  expiresAt: string; // ISO
}

export function newVisitorToken(): string {
  return crypto.randomBytes(24).toString('hex');
}

export async function storeVisitorToken(
  token: string,
  ticketId: string,
  userId: string
): Promise<void> {
  const record: VisitorTokenRecord = {
    ticketId,
    userId,
    expiresAt: new Date(Date.now() + VISITOR_TOKEN_TTL_MS).toISOString(),
  };
  await db.insert(schema.settings).values({ key: `chatToken:${token}`, value: record });
}

/** Token must exist, match the ticket, and not be expired. Expired rows are deleted on sight. */
export async function validateVisitorToken(
  token: string,
  ticketId: string
): Promise<{ userId: string }> {
  const key = `chatToken:${token}`;
  const [row] = await db
    .select()
    .from(schema.settings)
    .where(eq(schema.settings.key, key))
    .limit(1);
  if (!row) throw unauthorized('Invalid chat token');
  const record = row.value as Partial<VisitorTokenRecord>;
  if (!record.ticketId || !record.userId || record.ticketId !== ticketId) {
    throw unauthorized('Invalid chat token');
  }
  if (!record.expiresAt || new Date(record.expiresAt).getTime() < Date.now()) {
    await db.delete(schema.settings).where(eq(schema.settings.key, key));
    throw unauthorized('This chat session has expired — start a new chat and a real person will pick it up');
  }
  return { userId: record.userId };
}

// ---- Honest presence ----

export const ONLINE_PROMISE = 'You are chatting with real people — someone will reply shortly.';

/** online = isOpen(now) on the default schedule; offline promise names the real next-open time. */
export async function chatPresence(now: Date): Promise<{ online: boolean; promise: string }> {
  const [def] = await db
    .select({ id: schema.schedules.id })
    .from(schema.schedules)
    .where(eq(schema.schedules.isDefault, true))
    .limit(1);
  const schedule = await loadBusinessSchedule(def?.id ?? null);
  if (isOpen(now, schedule)) {
    return { online: true, promise: ONLINE_PROMISE };
  }
  try {
    const opensAt = nextOpenTime(now, schedule);
    const clock = formatLocalClock(opensAt, schedule.timezone);
    return {
      online: false,
      promise: `We are offline right now — a real person will reply after we open at ${clock.label}.`,
    };
  } catch {
    // Degenerate schedule config — stay honest without a concrete time.
    return {
      online: false,
      promise: 'We are offline right now — a real person will reply as soon as we are back.',
    };
  }
}

// ---- Message shapes for the widget ----

export interface ChatMessage {
  id: string;
  body: string;
  author: { name: string; title: string | null; avatarUrl: string | null } | null;
  createdAt: Date;
  fromCustomer: boolean;
}

const chatMessageColumns = {
  id: schema.ticketMessages.id,
  body: schema.ticketMessages.body,
  createdAt: schema.ticketMessages.createdAt,
  author: {
    name: schema.users.name,
    title: schema.users.title,
    avatarUrl: schema.users.avatarUrl,
    kind: schema.users.kind,
  },
};

type ChatMessageRow = {
  id: string;
  body: string;
  createdAt: Date;
  author: { name: string; title: string | null; avatarUrl: string | null; kind: string } | null;
};

function toChatMessage(row: ChatMessageRow): ChatMessage {
  return {
    id: row.id,
    body: row.body,
    author: row.author
      ? { name: row.author.name, title: row.author.title, avatarUrl: row.author.avatarUrl }
      : null,
    createdAt: row.createdAt,
    fromCustomer: row.author?.kind === 'customer',
  };
}

/** Last `limit` public messages, oldest-first — the stream's initial 'history' event. */
export async function loadChatHistory(ticketId: string, limit = 50): Promise<ChatMessage[]> {
  const rows = await db
    .select(chatMessageColumns)
    .from(schema.ticketMessages)
    .leftJoin(schema.users, eq(schema.ticketMessages.authorId, schema.users.id))
    .where(
      and(eq(schema.ticketMessages.ticketId, ticketId), eq(schema.ticketMessages.kind, 'public'))
    )
    .orderBy(desc(schema.ticketMessages.createdAt))
    .limit(limit);
  return rows.reverse().map(toChatMessage);
}

/** One public message scoped to the ticket (null when missing/internal — never leak notes). */
export async function loadChatMessage(
  messageId: string,
  ticketId: string
): Promise<ChatMessage | null> {
  const rows = await db
    .select(chatMessageColumns)
    .from(schema.ticketMessages)
    .leftJoin(schema.users, eq(schema.ticketMessages.authorId, schema.users.id))
    .where(
      and(
        eq(schema.ticketMessages.id, messageId),
        eq(schema.ticketMessages.ticketId, ticketId),
        eq(schema.ticketMessages.kind, 'public')
      )
    )
    .limit(1);
  return rows[0] ? toChatMessage(rows[0]) : null;
}

/** Ticket subject from the opening message: its first line, tidied; falls back to the visitor's name. */
export function chatSubject(message: string, fallbackName: string): string {
  const firstLine = message.split('\n')[0]?.replace(/\s+/g, ' ').trim() ?? '';
  if (!firstLine) return `Chat with ${fallbackName}`;
  return firstLine.length > 80 ? `${firstLine.slice(0, 79).trimEnd()}…` : firstLine;
}
