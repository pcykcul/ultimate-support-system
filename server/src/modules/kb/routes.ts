/**
 * Knowledge base — staff-side authoring.
 * Categories tree, article lifecycle (draft → review → published → archived, supervisor-gated
 * publish), revisions + rollback, verification staleness, content health, and snippets.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, asc, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { db, schema } from '../../db/index.js';
import { badRequest, forbidden, notFound, parse } from '../../lib/http.js';
import { requireAgent, requireStaff, requireSupervisor } from '../../lib/auth.js';
import { bus } from '../../lib/events.js';
import {
  defaultBrandId,
  isStale,
  searchPublishedFts,
  searchPublishedTrigram,
  uniqueArticleSlug,
  uniqueCategorySlug,
} from './lib.js';

type Article = typeof schema.kbArticles.$inferSelect;

const ARTICLE_STATUSES = ['draft', 'review', 'published', 'archived'] as const;
const AUDIENCES = ['public', 'customers', 'company', 'internal'] as const;

const idParams = z.object({ id: z.string().uuid() });

// ---------- Zod schemas ----------

const categoryCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  parentId: z.string().uuid().nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
  audience: z.enum(AUDIENCES).optional(),
  position: z.number().int().min(0).optional(),
});

const categoryPatchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  parentId: z.string().uuid().nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
  audience: z.enum(AUDIENCES).optional(),
  position: z.number().int().min(0).optional(),
});

const articleListQuery = z.object({
  status: z.string().optional(),
  categoryId: z.string().uuid().optional(),
  q: z.string().max(200).optional(),
  audience: z.string().optional(),
});

const articleCreateSchema = z.object({
  title: z.string().trim().min(1).max(200),
  body: z.string().max(200_000).optional(),
  categoryId: z.string().uuid().nullable().optional(),
  audience: z.enum(AUDIENCES).optional(),
  articleType: z.string().trim().max(40).nullable().optional(),
});

const articlePatchSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  body: z.string().max(200_000).optional(),
  categoryId: z.string().uuid().nullable().optional(),
  audience: z.enum(AUDIENCES).optional(),
  articleType: z.string().trim().max(40).nullable().optional(),
  ownerId: z.string().uuid().nullable().optional(),
  verifyIntervalDays: z.number().int().positive().max(3650).nullable().optional(),
  companyIds: z.array(z.string().uuid()).nullable().optional(),
});

const snippetCreateSchema = z.object({
  key: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .regex(/^[a-zA-Z0-9][\w.-]*$/, 'Use letters, digits, dots, dashes and underscores'),
  value: z.string().max(10_000),
});

const snippetPatchSchema = z.object({
  key: snippetCreateSchema.shape.key.optional(),
  value: z.string().max(10_000).optional(),
});

// ---------- Helpers ----------

/** Split a csv query param and validate each value against an allowed set. */
function csvFilter<T extends string>(raw: string | undefined, allowed: readonly T[]): T[] | null {
  if (!raw) return null;
  const values = raw
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
  if (values.length === 0) return null;
  for (const v of values) {
    if (!(allowed as readonly string[]).includes(v)) throw badRequest(`Invalid filter value: ${v}`);
  }
  return values as T[];
}

/** The list-item shape the contract specifies for GET /articles (and reused by /health). */
function articleSummary(article: Article, ownerName: string | null) {
  return {
    id: article.id,
    title: article.title,
    slug: article.slug,
    status: article.status,
    audience: article.audience,
    articleType: article.articleType,
    categoryId: article.categoryId,
    owner: article.ownerId && ownerName ? { id: article.ownerId, name: ownerName } : null,
    verifiedAt: article.verifiedAt,
    verifyIntervalDays: article.verifyIntervalDays,
    stale: isStale(article.verifyIntervalDays, article.verifiedAt),
    helpfulYes: article.helpfulYes,
    helpfulNo: article.helpfulNo,
    viewCount: article.viewCount,
    updatedAt: article.updatedAt,
  };
}

async function getArticle(id: string): Promise<Article> {
  const rows = await db
    .select()
    .from(schema.kbArticles)
    .where(eq(schema.kbArticles.id, id))
    .limit(1);
  if (!rows[0]) throw notFound('Article');
  return rows[0];
}

async function saveRevision(
  article: Pick<Article, 'id' | 'title' | 'body'>,
  authorId: string,
  note: string | null
): Promise<void> {
  await db.insert(schema.kbRevisions).values({
    articleId: article.id,
    title: article.title,
    body: article.body,
    authorId,
    note,
  });
}

// ---------- Routes ----------

export default async function routes(app: FastifyInstance): Promise<void> {
  const c = schema.kbCategories;
  const a = schema.kbArticles;

  // ----- Categories (flat list with parentId — the client renders the tree) -----

  app.get('/categories', { preHandler: requireStaff }, async () => {
    const rows = await db.select().from(c).orderBy(asc(c.position), asc(c.name));
    return {
      items: rows.map((row) => ({
        id: row.id,
        parentId: row.parentId,
        name: row.name,
        slug: row.slug,
        description: row.description,
        audience: row.audience,
        position: row.position,
        brandId: row.brandId,
      })),
    };
  });

  app.post('/categories', { preHandler: requireAgent }, async (req) => {
    const body = parse(categoryCreateSchema, req.body);
    if (body.parentId) {
      const parent = await db.select({ id: c.id }).from(c).where(eq(c.id, body.parentId)).limit(1);
      if (!parent[0]) throw badRequest('Parent category not found');
    }
    const brandId = await defaultBrandId();
    const slug = await uniqueCategorySlug(body.name, brandId);
    let position = body.position;
    if (position === undefined) {
      // Append at the end of the sibling list.
      const parentCond =
        body.parentId != null ? eq(c.parentId, body.parentId) : sql`${c.parentId} is null`;
      const maxRow = await db
        .select({ max: sql<number>`coalesce(max(${c.position}), -1)::int` })
        .from(c)
        .where(parentCond);
      position = (maxRow[0]?.max ?? -1) + 1;
    }
    const inserted = await db
      .insert(c)
      .values({
        brandId,
        parentId: body.parentId ?? null,
        name: body.name,
        slug,
        description: body.description ?? null,
        audience: body.audience ?? 'public',
        position,
      })
      .returning();
    return inserted[0];
  });

  app.patch('/categories/:id', { preHandler: requireAgent }, async (req) => {
    const { id } = parse(idParams, req.params);
    const body = parse(categoryPatchSchema, req.body);
    const rows = await db.select().from(c).where(eq(c.id, id)).limit(1);
    if (!rows[0]) throw notFound('Category');
    if (body.parentId) {
      if (body.parentId === id) throw badRequest('A category cannot be its own parent');
      const parent = await db.select({ id: c.id }).from(c).where(eq(c.id, body.parentId)).limit(1);
      if (!parent[0]) throw badRequest('Parent category not found');
    }
    const updates: Partial<typeof c.$inferInsert> = {};
    if (body.name !== undefined) updates.name = body.name;
    if (body.parentId !== undefined) updates.parentId = body.parentId;
    if (body.description !== undefined) updates.description = body.description;
    if (body.audience !== undefined) updates.audience = body.audience;
    if (body.position !== undefined) updates.position = body.position;
    if (Object.keys(updates).length === 0) return rows[0];
    const updated = await db.update(c).set(updates).where(eq(c.id, id)).returning();
    return updated[0];
  });

  app.delete('/categories/:id', { preHandler: requireAgent }, async (req, reply) => {
    const { id } = parse(idParams, req.params);
    const rows = await db.select().from(c).where(eq(c.id, id)).limit(1);
    if (!rows[0]) throw notFound('Category');
    // Re-parent children to the deleted node's parent so no subtree is orphaned.
    await db.update(c).set({ parentId: rows[0].parentId }).where(eq(c.parentId, id));
    await db.delete(c).where(eq(c.id, id));
    return reply.status(204).send();
  });

  // ----- Articles -----

  app.get('/articles', { preHandler: requireStaff }, async (req) => {
    const query = parse(articleListQuery, req.query);
    const statuses = csvFilter(query.status, ARTICLE_STATUSES);
    const audiences = csvFilter(query.audience, AUDIENCES);
    const conds = [];
    if (statuses) conds.push(inArray(a.status, statuses));
    if (audiences) conds.push(inArray(a.audience, audiences));
    if (query.categoryId) conds.push(eq(a.categoryId, query.categoryId));
    if (query.q && query.q.trim()) {
      const pattern = `%${query.q.trim().replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
      conds.push(or(ilike(a.title, pattern), ilike(a.body, pattern)));
    }
    const rows = await db
      .select({ article: a, ownerName: schema.users.name })
      .from(a)
      .leftJoin(schema.users, eq(a.ownerId, schema.users.id))
      .where(conds.length > 0 ? and(...conds) : undefined)
      .orderBy(desc(a.updatedAt));
    return { items: rows.map((r) => articleSummary(r.article, r.ownerName)) };
  });

  app.post('/articles', { preHandler: requireAgent }, async (req) => {
    const body = parse(articleCreateSchema, req.body);
    if (body.categoryId) {
      const cat = await db.select({ id: c.id }).from(c).where(eq(c.id, body.categoryId)).limit(1);
      if (!cat[0]) throw badRequest('Category not found');
    }
    const brandId = await defaultBrandId();
    const slug = await uniqueArticleSlug(body.title, brandId);
    const inserted = await db
      .insert(a)
      .values({
        brandId,
        categoryId: body.categoryId ?? null,
        slug,
        title: body.title,
        body: body.body ?? '',
        audience: body.audience ?? 'public',
        articleType: body.articleType ?? null,
        status: 'draft',
        ownerId: req.user!.id,
      })
      .returning();
    const article = inserted[0]!;
    await saveRevision(article, req.user!.id, 'created');
    return article;
  });

  app.get('/articles/:id', { preHandler: requireStaff }, async (req) => {
    const { id } = parse(idParams, req.params);
    const rows = await db
      .select({ article: a, ownerName: schema.users.name })
      .from(a)
      .leftJoin(schema.users, eq(a.ownerId, schema.users.id))
      .where(eq(a.id, id))
      .limit(1);
    if (!rows[0]) throw notFound('Article');
    const { article, ownerName } = rows[0];
    const revisions = await db
      .select({
        id: schema.kbRevisions.id,
        title: schema.kbRevisions.title,
        authorName: schema.users.name,
        note: schema.kbRevisions.note,
        createdAt: schema.kbRevisions.createdAt,
      })
      .from(schema.kbRevisions)
      .leftJoin(schema.users, eq(schema.kbRevisions.authorId, schema.users.id))
      .where(eq(schema.kbRevisions.articleId, id))
      .orderBy(desc(schema.kbRevisions.createdAt));
    return {
      ...article,
      stale: isStale(article.verifyIntervalDays, article.verifiedAt),
      owner: article.ownerId && ownerName ? { id: article.ownerId, name: ownerName } : null,
      revisions,
    };
  });

  app.patch('/articles/:id', { preHandler: requireAgent }, async (req) => {
    const { id } = parse(idParams, req.params);
    const body = parse(articlePatchSchema, req.body);
    const existing = await getArticle(id);
    if (body.categoryId) {
      const cat = await db.select({ id: c.id }).from(c).where(eq(c.id, body.categoryId)).limit(1);
      if (!cat[0]) throw badRequest('Category not found');
    }
    const updates: Partial<typeof a.$inferInsert> = { updatedAt: new Date() };
    if (body.title !== undefined) updates.title = body.title;
    if (body.body !== undefined) updates.body = body.body;
    if (body.categoryId !== undefined) updates.categoryId = body.categoryId;
    if (body.audience !== undefined) updates.audience = body.audience;
    if (body.articleType !== undefined) updates.articleType = body.articleType;
    if (body.ownerId !== undefined) updates.ownerId = body.ownerId;
    if (body.verifyIntervalDays !== undefined) updates.verifyIntervalDays = body.verifyIntervalDays;
    if (body.companyIds !== undefined) updates.companyIds = body.companyIds;
    const updated = await db.update(a).set(updates).where(eq(a.id, id)).returning();
    const article = updated[0]!;
    const contentChanged =
      (body.title !== undefined && body.title !== existing.title) ||
      (body.body !== undefined && body.body !== existing.body);
    if (contentChanged) await saveRevision(article, req.user!.id, 'edited');
    return { ...article, stale: isStale(article.verifyIntervalDays, article.verifiedAt) };
  });

  // ----- Lifecycle transitions -----

  app.post('/articles/:id/submit-review', { preHandler: requireAgent }, async (req) => {
    const { id } = parse(idParams, req.params);
    const article = await getArticle(id);
    if (article.status === 'review') return article;
    if (article.status !== 'draft') {
      throw badRequest('Only draft articles can be submitted for review');
    }
    const updated = await db
      .update(a)
      .set({ status: 'review', updatedAt: new Date() })
      .where(eq(a.id, id))
      .returning();
    return updated[0];
  });

  // Publishing is the human approval gate — supervisors only.
  app.post('/articles/:id/publish', { preHandler: requireSupervisor }, async (req) => {
    const { id } = parse(idParams, req.params);
    const article = await getArticle(id);
    if (article.status === 'published') return article;
    const now = new Date();
    const updated = await db
      .update(a)
      .set({ status: 'published', publishedAt: now, updatedAt: now })
      .where(eq(a.id, id))
      .returning();
    const published = updated[0]!;
    bus.emitEvent('kb.article_published', {
      articleId: published.id,
      title: published.title,
      slug: published.slug,
      actorId: req.user!.id,
    });
    return published;
  });

  app.post('/articles/:id/archive', { preHandler: requireSupervisor }, async (req) => {
    const { id } = parse(idParams, req.params);
    const article = await getArticle(id);
    if (article.status === 'archived') return article;
    const updated = await db
      .update(a)
      .set({ status: 'archived', updatedAt: new Date() })
      .where(eq(a.id, id))
      .returning();
    return updated[0];
  });

  // Verify: the owner (or a supervisor/admin) confirms the content is still accurate.
  app.post('/articles/:id/verify', { preHandler: requireAgent }, async (req) => {
    const { id } = parse(idParams, req.params);
    const article = await getArticle(id);
    const user = req.user!;
    const isSupervisor = user.role === 'admin' || user.role === 'supervisor';
    if (!isSupervisor && article.ownerId !== user.id) {
      throw forbidden('Only the article owner or a supervisor can verify it');
    }
    const updated = await db
      .update(a)
      .set({ verifiedAt: new Date() })
      .where(eq(a.id, id))
      .returning();
    const verified = updated[0]!;
    return { ...verified, stale: isStale(verified.verifyIntervalDays, verified.verifiedAt) };
  });

  // ----- Revisions -----

  app.post('/articles/:id/rollback', { preHandler: requireAgent }, async (req) => {
    const { id } = parse(idParams, req.params);
    const { revisionId } = parse(z.object({ revisionId: z.string().uuid() }), req.body);
    await getArticle(id);
    const revRows = await db
      .select()
      .from(schema.kbRevisions)
      .where(and(eq(schema.kbRevisions.id, revisionId), eq(schema.kbRevisions.articleId, id)))
      .limit(1);
    const revision = revRows[0];
    if (!revision) throw notFound('Revision');
    const updated = await db
      .update(a)
      .set({ title: revision.title, body: revision.body, updatedAt: new Date() })
      .where(eq(a.id, id))
      .returning();
    const article = updated[0]!;
    // The restore itself becomes a new revision, so history stays append-only.
    await saveRevision(
      article,
      req.user!.id,
      `rollback to revision from ${revision.createdAt.toISOString().slice(0, 10)}`
    );
    return article;
  });

  app.get('/articles/:id/revisions/:revId', { preHandler: requireStaff }, async (req) => {
    const { id, revId } = parse(
      z.object({ id: z.string().uuid(), revId: z.string().uuid() }),
      req.params
    );
    const rows = await db
      .select({
        id: schema.kbRevisions.id,
        articleId: schema.kbRevisions.articleId,
        title: schema.kbRevisions.title,
        body: schema.kbRevisions.body,
        authorName: schema.users.name,
        note: schema.kbRevisions.note,
        createdAt: schema.kbRevisions.createdAt,
      })
      .from(schema.kbRevisions)
      .leftJoin(schema.users, eq(schema.kbRevisions.authorId, schema.users.id))
      .where(and(eq(schema.kbRevisions.id, revId), eq(schema.kbRevisions.articleId, id)))
      .limit(1);
    if (!rows[0]) throw notFound('Revision');
    return rows[0];
  });

  // ----- Suggest (ticket sidebar) -----

  app.get('/suggest', { preHandler: requireStaff }, async (req) => {
    const { q } = parse(z.object({ q: z.string().max(200).optional() }), req.query);
    const query = (q ?? '').trim();
    if (!query) return [];
    const hits = await searchPublishedFts(query, { publicOnly: false, limit: 5 });
    if (hits.length < 5) {
      const fallback = await searchPublishedTrigram(query, { publicOnly: false, limit: 5 });
      const seen = new Set(hits.map((h) => h.id));
      for (const hit of fallback) {
        if (hits.length >= 5) break;
        if (!seen.has(hit.id)) hits.push(hit);
      }
    }
    return hits;
  });

  // ----- Content health -----

  app.get('/health', { preHandler: requireStaff }, async () => {
    const rows = await db
      .select({ article: a, ownerName: schema.users.name })
      .from(a)
      .leftJoin(schema.users, eq(a.ownerId, schema.users.id))
      .orderBy(desc(a.updatedAt));
    const items = rows.map((r) => articleSummary(r.article, r.ownerName));

    const stale = items.filter((i) => i.stale && i.status !== 'archived');
    const lowRated = items.filter(
      (i) => i.helpfulNo > i.helpfulYes && i.helpfulYes + i.helpfulNo >= 3
    );
    const topViewed = items
      .filter((i) => i.status === 'published' && i.viewCount > 0)
      .sort((x, y) => y.viewCount - x.viewCount)
      .slice(0, 10);

    const sq = schema.kbSearchQueries;
    const zeroResultQueries = await db
      .select({
        query: sq.query,
        count: sql<number>`count(*)::int`,
        lastAt: sql<Date>`max(${sq.createdAt})`,
      })
      .from(sq)
      .where(eq(sq.resultCount, 0))
      .groupBy(sq.query)
      .orderBy(desc(sql`count(*)`), desc(sql`max(${sq.createdAt})`))
      .limit(20);

    return { stale, lowRated, zeroResultQueries, topViewed };
  });

  // ----- Snippets (reusable {{snippet:key}} content) -----

  app.get('/snippets', { preHandler: requireStaff }, async () => {
    const items = await db.select().from(schema.snippets).orderBy(asc(schema.snippets.key));
    return { items };
  });

  app.post('/snippets', { preHandler: requireAgent }, async (req) => {
    const body = parse(snippetCreateSchema, req.body);
    const existing = await db
      .select({ id: schema.snippets.id })
      .from(schema.snippets)
      .where(eq(schema.snippets.key, body.key))
      .limit(1);
    if (existing[0]) throw badRequest('A snippet with this key already exists');
    const inserted = await db
      .insert(schema.snippets)
      .values({ key: body.key, value: body.value })
      .returning();
    return inserted[0];
  });

  app.patch('/snippets/:id', { preHandler: requireAgent }, async (req) => {
    const { id } = parse(idParams, req.params);
    const body = parse(snippetPatchSchema, req.body);
    const rows = await db
      .select()
      .from(schema.snippets)
      .where(eq(schema.snippets.id, id))
      .limit(1);
    if (!rows[0]) throw notFound('Snippet');
    if (body.key !== undefined && body.key !== rows[0].key) {
      const clash = await db
        .select({ id: schema.snippets.id })
        .from(schema.snippets)
        .where(eq(schema.snippets.key, body.key))
        .limit(1);
      if (clash[0]) throw badRequest('A snippet with this key already exists');
    }
    const updates: Partial<typeof schema.snippets.$inferInsert> = { updatedAt: new Date() };
    if (body.key !== undefined) updates.key = body.key;
    if (body.value !== undefined) updates.value = body.value;
    const updated = await db
      .update(schema.snippets)
      .set(updates)
      .where(eq(schema.snippets.id, id))
      .returning();
    return updated[0];
  });

  app.delete('/snippets/:id', { preHandler: requireAgent }, async (req, reply) => {
    const { id } = parse(idParams, req.params);
    const rows = await db
      .select({ id: schema.snippets.id })
      .from(schema.snippets)
      .where(eq(schema.snippets.id, id))
      .limit(1);
    if (!rows[0]) throw notFound('Snippet');
    await db.delete(schema.snippets).where(eq(schema.snippets.id, id));
    return reply.status(204).send();
  });
}
