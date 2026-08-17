/**
 * Shared knowledge-base helpers: slugs, staleness, and classic-IR search primitives.
 * Search is Postgres FTS (websearch_to_tsquery) + pg_trgm + a synonym table —
 * deterministic and inspectable, never a model (see the constitution).
 */
import { and, eq, isNull, like, or, sql } from 'drizzle-orm';
import { db, schema } from '../../db/index.js';

// ---------- Slugs ----------

export function slugify(input: string): string {
  const slug = input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // strip combining diacritics after NFKD decomposition
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/, '');
  return slug || 'untitled';
}

/** Pick `base`, or `base-2`, `base-3`, … — first one not already taken. */
function pickSlug(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

export async function uniqueArticleSlug(title: string, brandId: string | null): Promise<string> {
  const a = schema.kbArticles;
  const base = slugify(title);
  const brandCond = brandId === null ? isNull(a.brandId) : eq(a.brandId, brandId);
  const rows = await db
    .select({ slug: a.slug })
    .from(a)
    .where(and(brandCond, or(eq(a.slug, base), like(a.slug, `${base}-%`))));
  return pickSlug(base, new Set(rows.map((r) => r.slug)));
}

export async function uniqueCategorySlug(name: string, brandId: string | null): Promise<string> {
  const c = schema.kbCategories;
  const base = slugify(name);
  const brandCond = brandId === null ? isNull(c.brandId) : eq(c.brandId, brandId);
  const rows = await db
    .select({ slug: c.slug })
    .from(c)
    .where(and(brandCond, or(eq(c.slug, base), like(c.slug, `${base}-%`))));
  return pickSlug(base, new Set(rows.map((r) => r.slug)));
}

/** The default brand's id (fresh installs seed exactly one). Null when no brands exist. */
export async function defaultBrandId(): Promise<string | null> {
  const b = schema.brands;
  const def = await db.select({ id: b.id }).from(b).where(eq(b.isDefault, true)).limit(1);
  if (def[0]) return def[0].id;
  const any = await db.select({ id: b.id }).from(b).limit(1);
  return any[0]?.id ?? null;
}

// ---------- Staleness ----------

/** Stale = a verify interval is set and the article was never verified, or the interval has lapsed. */
export function isStale(
  verifyIntervalDays: number | null,
  verifiedAt: Date | null,
  now: Date = new Date()
): boolean {
  if (!verifyIntervalDays) return false;
  if (!verifiedAt) return true;
  return verifiedAt.getTime() + verifyIntervalDays * 86_400_000 < now.getTime();
}

// ---------- Snippets (text extraction) ----------

/** Crude markdown-to-text for snippet display: drops code fences, link targets, and markup tokens. */
export function stripMarkdown(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_>|]/g, '')
    .replace(/<\/?[a-zA-Z][^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** First ~160 chars of the body, centered on the query match when one exists. */
export function makeSnippet(body: string, q?: string): string {
  const text = stripMarkdown(body);
  if (!text) return '';
  let start = 0;
  if (q) {
    const idx = text.toLowerCase().indexOf(q.toLowerCase());
    if (idx > 60) start = idx - 60;
  }
  const slice = text.slice(start, start + 160).trim();
  const prefix = start > 0 ? '…' : '';
  const suffix = start + 160 < text.length ? '…' : '';
  return `${prefix}${slice}${suffix}`;
}

/** ts_headline output → plain text (default <b> markers removed). */
function cleanHeadline(headline: string | null): string {
  if (!headline) return '';
  return stripMarkdown(headline.replace(/<\/?b>/g, '')).slice(0, 200);
}

function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (c) => `\\${c}`);
}

// ---------- Search ----------

export interface ArticleHit {
  id: string;
  title: string;
  slug: string;
  audience: string;
  snippet: string;
}

type FtsRow = {
  id: string;
  title: string;
  slug: string;
  audience: string;
  body: string;
  snippet: string | null;
  rank: number;
};

/** Full-text search over published articles, ranked, with a ts_headline snippet. */
export async function searchPublishedFts(
  query: string,
  opts: { publicOnly: boolean; limit: number }
): Promise<ArticleHit[]> {
  const a = schema.kbArticles;
  const tsq = sql`websearch_to_tsquery('english', ${query})`;
  const tsv = sql`to_tsvector('english', ${a.title} || ' ' || ${a.body})`;
  const publicCond = opts.publicOnly ? sql` and ${a.audience} = 'public'` : sql``;
  const rows = await db.execute<FtsRow>(sql`
    select ${a.id} as id, ${a.title} as title, ${a.slug} as slug, ${a.audience} as audience,
      ${a.body} as body,
      ts_headline('english', ${a.body}, ${tsq}, 'MaxFragments=1, MaxWords=30, MinWords=12') as snippet,
      ts_rank(${tsv}, ${tsq}) as rank
    from ${a}
    where ${a.status} = 'published'${publicCond}
      and ${tsv} @@ ${tsq}
    order by rank desc, ${a.viewCount} desc
    limit ${opts.limit}
  `);
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    slug: r.slug,
    audience: r.audience,
    snippet: cleanHeadline(r.snippet) || makeSnippet(r.body, query),
  }));
}

type TrigramRow = {
  id: string;
  title: string;
  slug: string;
  audience: string;
  body: string;
  sim: number;
};

/** Trigram / ILIKE fallback for typo-ish or partial queries that FTS misses. */
export async function searchPublishedTrigram(
  query: string,
  opts: { publicOnly: boolean; limit: number }
): Promise<ArticleHit[]> {
  const a = schema.kbArticles;
  const pattern = `%${escapeLike(query)}%`;
  const publicCond = opts.publicOnly ? sql` and ${a.audience} = 'public'` : sql``;
  const rows = await db.execute<TrigramRow>(sql`
    select ${a.id} as id, ${a.title} as title, ${a.slug} as slug, ${a.audience} as audience,
      ${a.body} as body,
      similarity(${a.title}, ${query}) as sim
    from ${a}
    where ${a.status} = 'published'${publicCond}
      and (${a.title} ilike ${pattern} or ${a.body} ilike ${pattern}
        or similarity(${a.title}, ${query}) > 0.25)
    order by sim desc, ${a.viewCount} desc
    limit ${opts.limit}
  `);
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    slug: r.slug,
    audience: r.audience,
    snippet: makeSnippet(r.body, query),
  }));
}

/**
 * Expand a query with the synonym table: any term of a group appearing in the query
 * pulls the group's other terms in as websearch OR-alternatives.
 */
export async function expandSynonyms(q: string): Promise<string> {
  const groups = await db.select().from(schema.searchSynonyms);
  if (groups.length === 0) return q;
  const lower = q.toLowerCase();
  const words = new Set(lower.match(/[a-z0-9']+/g) ?? []);
  const extras = new Set<string>();
  for (const group of groups) {
    const terms = group.terms.map((t) => t.toLowerCase().trim()).filter(Boolean);
    const matched = terms.some((t) => (t.includes(' ') ? lower.includes(t) : words.has(t)));
    if (!matched) continue;
    for (const t of terms) {
      const present = t.includes(' ') ? lower.includes(t) : words.has(t);
      if (!present) extras.add(t.includes(' ') ? `"${t}"` : t);
    }
  }
  if (extras.size === 0) return q;
  return [q, ...extras].join(' OR ');
}
