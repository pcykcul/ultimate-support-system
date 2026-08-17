/**
 * Shared types + helpers for the customer portal — the face of the Human Guarantee.
 * Types mirror the /api/portal contract in docs/development/conventions.md.
 * Copy here is customer-facing: warm, honest, and always about people.
 */
import { useEffect, useState } from 'react';
import { HeartHandshake } from 'lucide-react';
import { Badge } from '@/lib/ui';

export type PortalTicketStatus =
  | 'new'
  | 'open'
  | 'waiting_on_customer'
  | 'on_hold'
  | 'solved'
  | 'closed';

export interface PortalTicketItem {
  id: string;
  number: number;
  subject: string;
  status: PortalTicketStatus;
  priority: string;
  updatedAt: string;
  requesterName: string;
  /** The visible human promise: when a real person will have replied by. */
  nextHumanReplyBy: string | null;
}

export interface PortalMessage {
  id: string;
  kind?: string;
  body: string;
  createdAt: string;
  author: {
    id?: string;
    name: string;
    title?: string | null;
    avatarUrl?: string | null;
    kind?: 'staff' | 'customer';
  } | null;
}

export interface PortalTicketDetail {
  ticket: PortalTicketItem & { createdAt?: string };
  messages: PortalMessage[];
}

export interface PortalCompanyMember {
  userId: string;
  name: string;
  email: string | null;
  isCompanyAdmin: boolean;
  canViewAllTickets: boolean;
}

export interface PortalCompanyData {
  company: { id: string; name: string; membersSeeAllTickets?: boolean };
  members: PortalCompanyMember[];
  tickets: PortalTicketItem[];
}

// ---------- Status labels (customer-friendly wording, not internal jargon) ----------

type BadgeColor = 'gray' | 'blue' | 'green' | 'yellow' | 'red' | 'purple' | 'brand';

export const PORTAL_STATUS_META: Record<PortalTicketStatus, { label: string; color: BadgeColor }> = {
  new: { label: 'Received', color: 'blue' },
  open: { label: "We're on it", color: 'brand' },
  waiting_on_customer: { label: 'Waiting on you', color: 'yellow' },
  on_hold: { label: 'On hold', color: 'purple' },
  solved: { label: 'Solved', color: 'green' },
  closed: { label: 'Closed', color: 'gray' },
};

export function PortalStatusBadge({ status }: { status: PortalTicketStatus }) {
  const meta = PORTAL_STATUS_META[status] ?? { label: status, color: 'gray' as const };
  return <Badge color={meta.color}>{meta.label}</Badge>;
}

/** Statuses where the ball is in our court and the reply promise is meaningful. */
export function isAwaitingHuman(status: PortalTicketStatus): boolean {
  return status === 'new' || status === 'open';
}

// ---------- The response promise ----------

export const DEFAULT_HUMAN_LINE = 'Every reply here comes from a real person — never a bot.';

/** "today at 4:30 PM" / "tomorrow at 9:00 AM" / "Mon, Aug 18 at 9:00 AM" in the viewer's zone. */
export function formatReplyBy(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return `today at ${time}`;
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  if (d.toDateString() === tomorrow.toDateString()) return `tomorrow at ${time}`;
  return `${d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })} at ${time}`;
}

/** Small chip for ticket lists: the human reply promise, honest even when we're late. */
export function PromiseChip({ due }: { due: string | null | undefined }) {
  if (!due) return null;
  const late = new Date(due).getTime() < Date.now();
  return (
    <span
      className={
        late
          ? 'inline-flex items-center gap-1 rounded-full bg-yellow-100 text-yellow-800 px-2 py-0.5 text-xs font-medium'
          : 'inline-flex items-center gap-1 rounded-full bg-brand-soft text-brand px-2 py-0.5 text-xs font-medium'
      }
    >
      <HeartHandshake size={12} className="shrink-0" />
      {late ? 'A person is on it — sorry for the wait' : `A person will reply by ${formatReplyBy(due)}`}
    </span>
  );
}

// ---------- Knowledge base (portal-scoped) ----------

export interface PortalKbArticle {
  id: string;
  title: string;
  slug: string;
  snippet?: string | null;
  categoryId?: string | null;
  categoryName?: string | null;
  audience?: string;
  updatedAt?: string;
}

export interface PortalKbCategory {
  id: string;
  name: string;
  slug?: string;
  description?: string | null;
  articles?: PortalKbArticle[];
}

export interface PortalKbData {
  categories: PortalKbCategory[];
  articles: PortalKbArticle[];
}

/**
 * The contract says GET /api/portal/kb returns "categories + articles list"; accept the
 * reasonable encodings (flat lists, nested articles, bare array) so the UI stays sturdy.
 */
export function normalizeKb(raw: unknown): PortalKbData {
  if (Array.isArray(raw)) return { categories: [], articles: raw as PortalKbArticle[] };
  const data = (raw ?? {}) as {
    categories?: PortalKbCategory[];
    articles?: PortalKbArticle[];
    items?: PortalKbArticle[];
  };
  const categories = Array.isArray(data.categories) ? data.categories : [];
  let articles = Array.isArray(data.articles)
    ? data.articles
    : Array.isArray(data.items)
      ? data.items
      : [];
  if (articles.length === 0 && categories.some((c) => (c.articles ?? []).length > 0)) {
    articles = categories.flatMap((c) =>
      (c.articles ?? []).map((a) => ({ categoryName: c.name, categoryId: c.id, ...a }))
    );
  }
  return { categories, articles };
}

/** Articles belonging to a category, whichever encoding the server chose. */
export function articlesInCategory(kb: PortalKbData, cat: PortalKbCategory): PortalKbArticle[] {
  if (cat.articles && cat.articles.length > 0) return cat.articles;
  return kb.articles.filter((a) => a.categoryId === cat.id || a.categoryName === cat.name);
}

/** Search snippets may carry FTS highlight markup; show them as plain text. */
export function stripTags(s: string): string {
  return s.replace(/<[^>]*>/g, '');
}

// ---------- Small hooks ----------

export function useDebounced<T>(value: T, ms = 350): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}
