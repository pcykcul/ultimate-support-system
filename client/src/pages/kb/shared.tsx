/** Shared types, badges and helpers for the staff knowledge-base pages. */
import { Badge } from '@/lib/ui';
import type { Me } from '@/lib/session';

export type ArticleStatus = 'draft' | 'review' | 'published' | 'archived';
export type Audience = 'public' | 'customers' | 'company' | 'internal';

export const ALL_STATUSES: ArticleStatus[] = ['draft', 'review', 'published', 'archived'];
export const ALL_AUDIENCES: Audience[] = ['public', 'customers', 'company', 'internal'];
export const ARTICLE_TYPES = ['how-to', 'faq', 'troubleshooting', 'reference'];

export type BadgeColor = 'gray' | 'blue' | 'green' | 'yellow' | 'red' | 'purple' | 'brand';

export const STATUS_META: Record<ArticleStatus, { label: string; color: BadgeColor }> = {
  draft: { label: 'Draft', color: 'gray' },
  review: { label: 'In review', color: 'yellow' },
  published: { label: 'Published', color: 'green' },
  archived: { label: 'Archived', color: 'purple' },
};

export const AUDIENCE_META: Record<Audience, { label: string; color: BadgeColor }> = {
  public: { label: 'Public', color: 'blue' },
  customers: { label: 'Customers', color: 'purple' },
  company: { label: 'Company', color: 'yellow' },
  internal: { label: 'Internal', color: 'gray' },
};

export function StatusBadge({ status }: { status: ArticleStatus }) {
  const meta = STATUS_META[status] ?? { label: status, color: 'gray' as BadgeColor };
  return <Badge color={meta.color}>{meta.label}</Badge>;
}

export function AudienceBadge({ audience }: { audience: Audience }) {
  const meta = AUDIENCE_META[audience] ?? { label: audience, color: 'gray' as BadgeColor };
  return <Badge color={meta.color}>{meta.label}</Badge>;
}

/** "83%" from helpful counters, or an em-dash before any feedback exists. */
export function feedbackPct(yes: number | undefined, no: number | undefined): string {
  const y = yes ?? 0;
  const total = y + (no ?? 0);
  if (total === 0) return '—';
  return `${Math.round((y / total) * 100)}%`;
}

/** Collaborators are read-only; everyone else on staff can author. */
export function canAct(me: Me | null | undefined): boolean {
  return !!me && me.kind === 'staff' && me.role !== null && me.role !== 'collaborator';
}

export function isSupervisor(me: Me | null | undefined): boolean {
  return !!me && (me.role === 'admin' || me.role === 'supervisor');
}

/** Prefer the server's verdict; fall back to client-side date math for full-article payloads. */
export function isStale(a: {
  stale?: boolean;
  verifyIntervalDays?: number | null;
  verifiedAt?: string | null;
}): boolean {
  if (typeof a.stale === 'boolean') return a.stale;
  if (!a.verifyIntervalDays) return false;
  if (!a.verifiedAt) return true;
  return Date.now() - new Date(a.verifiedAt).getTime() > a.verifyIntervalDays * 86_400_000;
}

// ---------- API shapes (per docs/development/conventions.md) ----------

export interface KbCategory {
  id: string;
  parentId: string | null;
  name: string;
  slug: string;
  audience: Audience;
  position: number;
  brandId: string | null;
}

export interface KbArticleListItem {
  id: string;
  title: string;
  slug: string;
  status: ArticleStatus;
  audience: Audience;
  articleType: string | null;
  categoryId: string | null;
  owner: { id: string; name: string } | null;
  verifiedAt: string | null;
  verifyIntervalDays: number | null;
  stale: boolean;
  helpfulYes: number;
  helpfulNo: number;
  viewCount: number;
  updatedAt: string;
}

export interface KbRevisionMeta {
  id: string;
  title: string;
  authorName: string | null;
  note: string | null;
  createdAt: string;
}

export interface KbRevisionFull extends KbRevisionMeta {
  body: string;
}

export interface KbArticleFull {
  id: string;
  title: string;
  slug: string;
  body: string;
  status: ArticleStatus;
  audience: Audience;
  articleType: string | null;
  categoryId: string | null;
  ownerId?: string | null;
  owner?: { id: string; name: string } | null;
  companyIds?: string[] | null;
  verifyIntervalDays: number | null;
  verifiedAt: string | null;
  stale?: boolean;
  helpfulYes: number;
  helpfulNo: number;
  viewCount: number;
  updatedAt: string;
  revisions?: KbRevisionMeta[];
}

export interface HealthArticle {
  id: string;
  title: string;
  status?: ArticleStatus;
  audience?: Audience;
  verifiedAt?: string | null;
  verifyIntervalDays?: number | null;
  owner?: { id: string; name: string } | null;
  helpfulYes?: number;
  helpfulNo?: number;
  viewCount?: number;
  updatedAt?: string;
}

export interface ZeroResultQuery {
  query: string;
  count: number;
  lastAt: string;
}

export interface KbHealth {
  stale: HealthArticle[];
  lowRated: HealthArticle[];
  zeroResultQueries: ZeroResultQuery[];
  topViewed: HealthArticle[];
}
