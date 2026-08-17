/**
 * Widget home: "Hi — how can we help?" search-first deflection.
 * Articles open in an expandable panel; the path to a human lives in the
 * always-visible action bar owned by WidgetPage (never gated behind search).
 */
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ChevronRight, FileText, HeartHandshake, Search } from 'lucide-react';
import { api } from '@/api/client';
import { Markdown } from '@/lib/markdown';
import { timeAgo } from '@/lib/ui';
import { stripTags, type WidgetArticle, type WidgetSearchResult } from './shared';

export default function HomeView({ promise }: { promise: string | null | undefined }) {
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [openSlug, setOpenSlug] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  const { data: results, isFetching: searching } = useQuery({
    queryKey: ['widget', 'search', debouncedQ],
    queryFn: () =>
      api.get<WidgetSearchResult[]>(`/api/chat/widget-search?q=${encodeURIComponent(debouncedQ)}`),
    enabled: debouncedQ.length > 0,
  });

  const {
    data: article,
    isLoading: articleLoading,
    isError: articleError,
  } = useQuery({
    queryKey: ['widget', 'article', openSlug],
    queryFn: () => api.get<WidgetArticle>(`/api/help-center/articles/${openSlug}`),
    enabled: openSlug !== null,
  });

  // Expanded article panel replaces the search view; back returns to results intact.
  if (openSlug) {
    return (
      <div className="flex-1 min-h-0 overflow-y-auto bg-white">
        <div className="sticky top-0 bg-white/95 backdrop-blur border-b border-gray-100 px-3 py-2">
          <button
            onClick={() => setOpenSlug(null)}
            className="inline-flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-800"
          >
            <ArrowLeft size={13} />
            Back
          </button>
        </div>
        <div className="px-4 py-3">
          {articleLoading && <p className="text-sm text-gray-400 py-8 text-center">Loading article…</p>}
          {articleError && (
            <p className="text-sm text-gray-500 py-8 text-center">
              We couldn't load that article — it may have moved. Try searching again.
            </p>
          )}
          {article && (
            <article>
              <h2 className="text-base font-semibold text-gray-900">{article.title}</h2>
              <p className="text-[11px] text-gray-400 mt-0.5">
                {article.category ? `${article.category.name} · ` : ''}Updated {timeAgo(article.updatedAt)}
              </p>
              <Markdown className="mt-2 text-sm">{article.body}</Markdown>
            </article>
          )}
        </div>
      </div>
    );
  }

  const showResults = debouncedQ.length > 0 && q.trim().length > 0;

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="px-4 pt-4 pb-3">
        <h1 className="text-lg font-bold text-gray-900">Hi — how can we help?</h1>
        <p className="text-xs text-gray-500 mt-0.5">
          Search our help articles, or talk to a real person any time.
        </p>
        <div className="relative mt-3">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search for answers…"
            className="w-full rounded-xl border border-gray-300 bg-white pl-9 pr-3 py-2.5 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-brand/40 focus:border-brand"
          />
        </div>
      </div>

      {!showResults && (
        <div className="px-4 pb-4">
          {promise && (
            <div className="flex items-start gap-2 rounded-xl bg-brand-soft px-3 py-2.5 text-xs text-brand">
              <HeartHandshake size={14} className="shrink-0 mt-0.5" />
              <span>{promise}</span>
            </div>
          )}
        </div>
      )}

      {showResults && (
        <div className="px-3 pb-4">
          {searching && !results && <p className="px-1 py-3 text-sm text-gray-400">Searching…</p>}
          {results && results.length === 0 && (
            <div className="px-1 py-3 text-sm text-gray-500">
              <p>No articles match “{debouncedQ}”.</p>
              <p className="text-xs text-gray-400 mt-1">
                A human reads every unanswered search — or just talk to one directly below.
              </p>
            </div>
          )}
          {(results ?? []).map((r) => (
            <button
              key={r.id}
              onClick={() => setOpenSlug(r.slug)}
              className="w-full flex items-center gap-2.5 text-left rounded-lg px-2 py-2.5 hover:bg-white border-b border-gray-100 last:border-b-0"
            >
              <FileText size={15} className="text-gray-400 shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-gray-800 truncate">{r.title}</span>
                {r.snippet && (
                  <span className="block text-xs text-gray-500 truncate">{stripTags(r.snippet)}</span>
                )}
              </span>
              <ChevronRight size={14} className="text-gray-300 shrink-0" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
