/**
 * Portal scoping helpers — the security core of the customer portal.
 *
 * Every portal read goes through these helpers. The rules:
 * - Tickets: a customer always sees their own. They see a company's tickets only when
 *   they are a company admin, hold a personal canViewAllTickets grant, or the company
 *   has membersSeeAllTickets enabled.
 * - KB: published articles with audience 'public' or 'customers', plus audience
 *   'company' articles whose companyIds overlap the customer's memberships.
 *   'internal' content is never reachable from here.
 * - Invisible things 404 — the portal never confirms a resource exists.
 */
import { and, eq, inArray, or, sql, type SQL } from 'drizzle-orm';
import { db, schema } from '../../db/index.js';
import { formatLocalClock } from '../../lib/hours.js';
import { expandSynonyms, makeSnippet, stripMarkdown } from '../kb/lib.js';

// ---------- Memberships & ticket visibility ----------

export interface Membership {
  companyId: string;
  companyName: string;
  isCompanyAdmin: boolean;
  canViewAllTickets: boolean;
  membersSeeAllTickets: boolean;
}

/** The customer's company memberships with the visibility flags that drive all scoping. */
export async function loadMemberships(userId: string): Promise<Membership[]> {
  return db
    .select({
      companyId: schema.companyMembers.companyId,
      companyName: schema.companies.name,
      isCompanyAdmin: schema.companyMembers.isCompanyAdmin,
      canViewAllTickets: schema.companyMembers.canViewAllTickets,
      membersSeeAllTickets: schema.companies.membersSeeAllTickets,
    })
    .from(schema.companyMembers)
    .innerJoin(schema.companies, eq(schema.companyMembers.companyId, schema.companies.id))
    .where(eq(schema.companyMembers.userId, userId));
}

/** Companies whose *tickets* this customer may browse (admin, personal grant, or company-wide default). */
export function ticketVisibleCompanyIds(memberships: Membership[]): string[] {
  return memberships
    .filter((m) => m.isCompanyAdmin || m.canViewAllTickets || m.membersSeeAllTickets)
    .map((m) => m.companyId);
}

/** Any membership (no flags needed) grants access to that company's company-audience KB articles. */
export function memberCompanyIds(memberships: Membership[]): string[] {
  return memberships.map((m) => m.companyId);
}

/** WHERE clause limiting a tickets query to what this customer may see. */
export function ticketVisibilityWhere(userId: string, visibleCompanyIds: string[]): SQL {
  const conditions: SQL[] = [eq(schema.tickets.requesterId, userId)];
  if (visibleCompanyIds.length) {
    conditions.push(inArray(schema.tickets.companyId, visibleCompanyIds));
  }
  return or(...conditions)!;
}

/** Point check for a single already-loaded ticket — same rule as ticketVisibilityWhere. */
export function canSeeTicket(
  ticket: { requesterId: string; companyId: string | null },
  userId: string,
  visibleCompanyIds: string[]
): boolean {
  if (ticket.requesterId === userId) return true;
  return ticket.companyId != null && visibleCompanyIds.includes(ticket.companyId);
}

// ---------- The human promise ----------

/** The next moment a real person has promised to reply: first response, else next response. */
export function nextHumanReplyBy(ticket: {
  firstResponseDueAt: Date | null;
  nextResponseDueAt: Date | null;
}): Date | null {
  return ticket.firstResponseDueAt ?? ticket.nextResponseDueAt;
}

/** "A real person will reply by 3:42 PM Tue · Sydney (Australia/Sydney)" — or null when no promise is active. */
export function humanPromiseText(due: Date | null, timezone: string | null | undefined): string | null {
  if (!due) return null;
  const tz = timezone || 'UTC';
  try {
    const clock = formatLocalClock(due, tz);
    return `A real person will reply by ${clock.label} (${tz})`;
  } catch {
    // Invalid IANA zone stored on the user — fall back to UTC rather than blowing up the page.
    const clock = formatLocalClock(due, 'UTC');
    return `A real person will reply by ${clock.label} (UTC)`;
  }
}

// ---------- Audience-scoped knowledge base ----------

/** SQL condition: published-article audiences this customer may read. */
export function articleAudienceCondition(companyIds: string[]): SQL {
  const a = schema.kbArticles;
  const shared = inArray(a.audience, ['public', 'customers']);
  if (!companyIds.length) return shared;
  const idList = sql.join(
    companyIds.map((id) => sql`${id}::uuid`),
    sql`, `
  );
  return or(shared, and(eq(a.audience, 'company'), sql`${a.companyIds} && ARRAY[${idList}]`))!;
}

export interface PortalArticleHit {
  id: string;
  title: string;
  slug: string;
  snippet: string;
}

type SearchRow = {
  id: string;
  title: string;
  slug: string;
  body: string;
  snippet: string | null;
};

function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (c) => `\\${c}`);
}

function toHit(row: SearchRow, query: string): PortalArticleHit {
  const headline = row.snippet ? stripMarkdown(row.snippet.replace(/<\/?b>/g, '')).slice(0, 200) : '';
  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    snippet: headline || makeSnippet(row.body, query),
  };
}

/**
 * Classic-IR search over the articles this customer may read: synonym-expanded FTS
 * with a trigram/ILIKE fallback. Mirrors kb/lib's published search but with the
 * portal audience condition applied inside the query — never post-filtered.
 */
export async function searchPortalArticles(
  query: string,
  companyIds: string[]
): Promise<PortalArticleHit[]> {
  const a = schema.kbArticles;
  const audienceCond = articleAudienceCondition(companyIds);
  const expanded = await expandSynonyms(query);
  const tsq = sql`websearch_to_tsquery('english', ${expanded})`;
  const tsv = sql`to_tsvector('english', ${a.title} || ' ' || ${a.body})`;

  const ftsRows = await db.execute<SearchRow>(sql`
    select ${a.id} as id, ${a.title} as title, ${a.slug} as slug, ${a.body} as body,
      ts_headline('english', ${a.body}, ${tsq}, 'MaxFragments=1, MaxWords=30, MinWords=12') as snippet
    from ${a}
    where ${a.status} = 'published' and (${audienceCond}) and ${tsv} @@ ${tsq}
    order by ts_rank(${tsv}, ${tsq}) desc, ${a.viewCount} desc
    limit 10
  `);
  if (ftsRows.length) return ftsRows.map((r) => toHit(r, query));

  const pattern = `%${escapeLike(query)}%`;
  const trigramRows = await db.execute<SearchRow>(sql`
    select ${a.id} as id, ${a.title} as title, ${a.slug} as slug, ${a.body} as body,
      null as snippet
    from ${a}
    where ${a.status} = 'published' and (${audienceCond})
      and (${a.title} ilike ${pattern} or ${a.body} ilike ${pattern}
        or similarity(${a.title}, ${query}) > 0.25)
    order by similarity(${a.title}, ${query}) desc, ${a.viewCount} desc
    limit 10
  `);
  return trigramRows.map((r) => toHit(r, query));
}
