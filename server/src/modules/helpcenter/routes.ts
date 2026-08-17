/**
 * Help center — the public, unauthenticated face of the knowledge base.
 * Only status='published', audience='public' content is ever exposed here.
 * Every search is logged to kb_search_queries so zero-result queries feed the
 * "write this article" queue, and every page carries the human promise.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, asc, eq, sql } from 'drizzle-orm';
import { db, schema } from '../../db/index.js';
import { notFound, parse } from '../../lib/http.js';
import {
  expandSynonyms,
  searchPublishedFts,
  searchPublishedTrigram,
} from '../kb/lib.js';

const idParams = z.object({ id: z.string().uuid() });

interface StoredBranding {
  name?: string;
  logoUrl?: string | null;
  colors?: unknown;
  helpCenterTitle?: string;
  humanPromise?: string;
}

const DEFAULT_HUMAN_PROMISE =
  'A real person reads and answers every message — no bots, ever. We typically reply within one business day.';

/** Branding for the public help center: settings 'branding' key → default brand row → fallbacks. */
async function loadBranding() {
  const settingsRow = await db
    .select()
    .from(schema.settings)
    .where(eq(schema.settings.key, 'branding'))
    .limit(1);
  const stored = (settingsRow[0]?.value ?? {}) as StoredBranding;
  const brandRow = await db
    .select()
    .from(schema.brands)
    .where(eq(schema.brands.isDefault, true))
    .limit(1);
  const brand = brandRow[0];
  const name = stored.name || brand?.name || 'Support';
  return {
    name,
    logoUrl: stored.logoUrl ?? brand?.logoUrl ?? null,
    helpCenterTitle: stored.helpCenterTitle || brand?.helpCenterTitle || `${name} Help Center`,
    humanPromise: stored.humanPromise || DEFAULT_HUMAN_PROMISE,
    colors: stored.colors ?? brand?.colors ?? null,
  };
}

export default async function routes(app: FastifyInstance): Promise<void> {
  const a = schema.kbArticles;
  const c = schema.kbCategories;

  // GET /home — branding + the public category/article tree.
  app.get('/home', async () => {
    const branding = await loadBranding();
    const categories = await db
      .select()
      .from(c)
      .where(eq(c.audience, 'public'))
      .orderBy(asc(c.position), asc(c.name));
    const articles = await db
      .select({ id: a.id, title: a.title, slug: a.slug, categoryId: a.categoryId })
      .from(a)
      .where(and(eq(a.status, 'published'), eq(a.audience, 'public')))
      .orderBy(asc(a.position), asc(a.title));

    const byCategory = new Map<string, { id: string; title: string; slug: string }[]>();
    for (const article of articles) {
      if (!article.categoryId) continue;
      const list = byCategory.get(article.categoryId) ?? [];
      list.push({ id: article.id, title: article.title, slug: article.slug });
      byCategory.set(article.categoryId, list);
    }

    return {
      branding,
      categories: categories.map((cat) => ({
        id: cat.id,
        name: cat.name,
        slug: cat.slug,
        description: cat.description,
        articles: byCategory.get(cat.id) ?? [],
      })),
    };
  });

  // GET /articles/:slug — a published public article; counts the view.
  app.get('/articles/:slug', async (req) => {
    const { slug } = parse(z.object({ slug: z.string().min(1).max(120) }), req.params);
    const rows = await db
      .select({ article: a, category: c })
      .from(a)
      .leftJoin(c, eq(a.categoryId, c.id))
      .where(and(eq(a.slug, slug), eq(a.status, 'published'), eq(a.audience, 'public')))
      .limit(1);
    if (!rows[0]) throw notFound('Article');
    const { article, category } = rows[0];
    await db
      .update(a)
      .set({ viewCount: sql`${a.viewCount} + 1` })
      .where(eq(a.id, article.id));
    return {
      id: article.id,
      title: article.title,
      body: article.body,
      updatedAt: article.updatedAt,
      category: category ? { name: category.name, slug: category.slug } : null,
    };
  });

  // GET /search?q= — synonym-expanded FTS with a trigram fallback; every query is logged.
  app.get('/search', async (req) => {
    const { q } = parse(z.object({ q: z.string().max(200).optional() }), req.query);
    const query = (q ?? '').trim();
    if (!query) return [];

    const expanded = await expandSynonyms(query);
    let hits = await searchPublishedFts(expanded, { publicOnly: true, limit: 10 });
    if (hits.length === 0) {
      hits = await searchPublishedTrigram(query, { publicOnly: true, limit: 10 });
    }

    // Always log — zero-result queries are the KB team's writing queue.
    await db.insert(schema.kbSearchQueries).values({
      query,
      resultCount: hits.length,
      source: 'help_center',
    });

    return hits.map((h) => ({ id: h.id, title: h.title, slug: h.slug, snippet: h.snippet }));
  });

  // POST /articles/:id/feedback — thumbs up/down + optional comment.
  app.post('/articles/:id/feedback', async (req, reply) => {
    const { id } = parse(idParams, req.params);
    const { helpful, comment } = parse(
      z.object({ helpful: z.boolean(), comment: z.string().max(2000).optional() }),
      req.body
    );
    const rows = await db
      .select({ id: a.id })
      .from(a)
      .where(and(eq(a.id, id), eq(a.status, 'published')))
      .limit(1);
    if (!rows[0]) throw notFound('Article');
    await db
      .update(a)
      .set(
        helpful
          ? { helpfulYes: sql`${a.helpfulYes} + 1` }
          : { helpfulNo: sql`${a.helpfulNo} + 1` }
      )
      .where(eq(a.id, id));
    await db.insert(schema.kbFeedback).values({
      articleId: id,
      helpful,
      comment: comment ?? null,
      userId: req.user?.id ?? null,
    });
    return reply.status(204).send();
  });
}
