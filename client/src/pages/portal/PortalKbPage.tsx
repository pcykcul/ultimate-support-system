/**
 * Portal knowledge base: audience-scoped articles (public + customers +
 * company-scoped for the reader's companies) with search-first navigation.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { FileText, Search } from 'lucide-react';
import { api } from '@/api/client';
import { Badge, Card, Input, PageHeader } from '@/lib/ui';
import {
  articlesInCategory,
  normalizeKb,
  stripTags,
  useDebounced,
  type PortalKbArticle,
} from './shared';

function AudienceTag({ audience }: { audience?: string }) {
  if (audience === 'company') return <Badge color="purple">Your company</Badge>;
  if (audience === 'customers') return <Badge color="blue">Customers</Badge>;
  return null;
}

function ArticleLink({ article }: { article: PortalKbArticle }) {
  return (
    <Link
      to={`/portal/kb/${article.slug}`}
      className="flex items-start gap-2.5 px-4 py-2.5 hover:bg-gray-50"
    >
      <FileText size={14} className="text-gray-400 shrink-0 mt-0.5" />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="text-sm text-gray-800 font-medium">{article.title}</span>
          <AudienceTag audience={article.audience} />
        </span>
        {article.snippet && (
          <span className="block text-xs text-gray-500 truncate">{stripTags(article.snippet)}</span>
        )}
      </span>
    </Link>
  );
}

export default function PortalKbPage() {
  const [q, setQ] = useState('');
  const debouncedQ = useDebounced(q.trim(), 300);
  const searching = debouncedQ.length > 0;

  const { data, isLoading } = useQuery({
    queryKey: ['portal', 'kb', debouncedQ],
    queryFn: async () =>
      normalizeKb(
        await api.get<unknown>(
          searching ? `/api/portal/kb?q=${encodeURIComponent(debouncedQ)}` : '/api/portal/kb'
        )
      ),
  });

  const categories = data?.categories ?? [];
  const articles = data?.articles ?? [];

  return (
    <div>
      <PageHeader
        title="Help articles"
        subtitle="Written and kept up to date by the same people who answer your tickets."
      />

      <div className="relative max-w-xl">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search articles…"
          className="pl-9 py-2"
        />
      </div>

      {isLoading && <p className="text-center text-gray-400 py-12">Loading articles…</p>}

      {/* Search results: one flat list */}
      {!isLoading && searching && (
        <div className="mt-4">
          {articles.length === 0 ? (
            <Card>
              <div className="px-4 py-8 text-center text-sm text-gray-500">
                <p>No articles match “{debouncedQ}”.</p>
                <p className="text-xs text-gray-400 mt-1">
                  We log every unanswered search so a human can write that article —{' '}
                  <Link to="/portal/new" className="text-brand underline">
                    or just ask us directly
                  </Link>
                  .
                </p>
              </div>
            </Card>
          ) : (
            <Card className="divide-y divide-gray-100">
              {articles.map((a) => (
                <ArticleLink key={a.id} article={a} />
              ))}
            </Card>
          )}
        </div>
      )}

      {/* Browse mode: categories with their articles */}
      {!isLoading && !searching && (
        <>
          {categories.length === 0 && articles.length === 0 && (
            <Card className="mt-4">
              <div className="px-4 py-10 text-center text-sm text-gray-500">
                <p className="font-medium text-gray-700">No articles yet</p>
                <p className="mt-1">
                  Can't find what you need?{' '}
                  <Link to="/portal/new" className="text-brand underline">
                    Ask a human
                  </Link>{' '}
                  — we're happy to help.
                </p>
              </div>
            </Card>
          )}

          {categories.map((c) => {
            const catArticles = articlesInCategory({ categories, articles }, c);
            return (
              <section key={c.id} className="mt-6">
                <h2 className="text-base font-semibold text-gray-900">{c.name}</h2>
                {c.description && <p className="text-sm text-gray-500 mt-0.5">{c.description}</p>}
                {catArticles.length === 0 ? (
                  <p className="mt-2 text-sm text-gray-400">No articles in this section yet.</p>
                ) : (
                  <Card className="mt-2 divide-y divide-gray-100">
                    {catArticles.map((a) => (
                      <ArticleLink key={a.id} article={a} />
                    ))}
                  </Card>
                )}
              </section>
            );
          })}

          {/* Articles the server sent without a matching category */}
          {(() => {
            const inCats = new Set(
              categories.flatMap((c) => articlesInCategory({ categories, articles }, c)).map((a) => a.id)
            );
            const uncategorized = articles.filter((a) => !inCats.has(a.id));
            if (uncategorized.length === 0) return null;
            return (
              <section className="mt-6">
                {categories.length > 0 && (
                  <h2 className="text-base font-semibold text-gray-900">More articles</h2>
                )}
                <Card className="mt-2 divide-y divide-gray-100">
                  {uncategorized.map((a) => (
                    <ArticleLink key={a.id} article={a} />
                  ))}
                </Card>
              </section>
            );
          })()}
        </>
      )}
    </div>
  );
}
