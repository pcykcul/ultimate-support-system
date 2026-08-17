/**
 * Shared types + helpers for the embeddable support widget.
 * The widget renders inside an <iframe> on customers' sites, so everything here
 * must survive a hostile embedding context (e.g. blocked localStorage).
 */

export const STORAGE_KEY = 'uss_widget_chat';

export const DEFAULT_OFFLINE_PROMISE =
  "We're away right now — leave a message and a real person will reply as soon as we're back.";

export interface StoredChat {
  ticketId: string;
  visitorToken: string;
}

export interface Presence {
  online: boolean;
  promise: string;
}

export interface WidgetSearchResult {
  id: string;
  title: string;
  slug: string;
  snippet: string;
}

export interface WidgetArticle {
  id: string;
  title: string;
  body: string;
  updatedAt: string;
  category: { name: string; slug: string } | null;
}

export interface ChatAuthor {
  id?: string;
  name: string;
  title?: string | null;
  avatarUrl?: string | null;
  kind?: string; // 'staff' | 'customer'
}

export interface ChatMessage {
  id: string;
  body: string;
  createdAt: string;
  author: ChatAuthor | null;
  /** Optimistic local echo — replaced when the server copy arrives on the stream. */
  local?: boolean;
}

export interface ChatStartResponse {
  ticketId: string;
  visitorToken: string;
  online: boolean;
  promise: string;
}

export function isStaffMessage(m: ChatMessage): boolean {
  return m.author?.kind === 'staff';
}

let localSeq = 0;
export function nextLocalId(): string {
  localSeq += 1;
  return `local-${Date.now()}-${localSeq}`;
}

/** Tolerant mapper: the stream and POST responses may vary slightly in shape. */
export function toChatMessage(raw: unknown): ChatMessage | null {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Record<string, unknown>;
  if (typeof m.body !== 'string') return null;
  let author: ChatAuthor | null = null;
  if (m.author && typeof m.author === 'object') {
    const a = m.author as Record<string, unknown>;
    if (typeof a.name === 'string') {
      author = {
        id: typeof a.id === 'string' ? a.id : undefined,
        name: a.name,
        title: typeof a.title === 'string' ? a.title : null,
        avatarUrl: typeof a.avatarUrl === 'string' ? a.avatarUrl : null,
        kind: typeof a.kind === 'string' ? a.kind : undefined,
      };
    }
  }
  return {
    id: typeof m.id === 'string' ? m.id : nextLocalId(),
    body: m.body,
    createdAt: typeof m.createdAt === 'string' ? m.createdAt : new Date().toISOString(),
    author,
  };
}

export function loadStoredChat(): StoredChat | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredChat>;
    if (typeof parsed.ticketId === 'string' && typeof parsed.visitorToken === 'string') {
      return { ticketId: parsed.ticketId, visitorToken: parsed.visitorToken };
    }
  } catch {
    /* blocked storage or corrupt value — treat as no stored chat */
  }
  return null;
}

export function saveStoredChat(chat: StoredChat): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(chat));
  } catch {
    /* third-party iframes may block storage — chat still works for this visit */
  }
}

export function clearStoredChat(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/** Search snippets can carry FTS highlight markup — render them as plain text. */
export function stripTags(s: string): string {
  return s.replace(/<[^>]*>/g, '');
}
