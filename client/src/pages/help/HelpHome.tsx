/**
 * Public help center home: search-first, with a visible human promise and
 * category sections. No auth, no staff layout.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { FileText, HeartHandshake, Search } from 'lucide-react';
import { api } from '@/api/client';
import { Card } from '@/lib/ui';
import { applyBrandColors } from '@/lib/session';
import { DEFAULT_PROMISE, HelpShell, stripTags, type HelpBranding } from './shared';

interface HelpHomeData {
  branding: HelpBranding;
  categories: {
    id: string;
    name: string;
    slug: string;
    description: string | null;
    articles: { id: string; title: string; slug: string }[];
  }[];
}

interface SearchResult {
  id: string;
  title: string;
  slug: string;
  snippet: string;
}

export default function HelpHome() {
  const { data, isLoading } = useQuery({
    queryKey: ['help', 'home'],
    queryFn: () => api.get<HelpHomeData>('/api/help-center/home'),
  });

  useEffect(() => {
    if (data?.branding) {
      applyBrandColors(data.branding.colors ?? null);
      document.title = data.branding.helpCenterTitle || data.branding.name || 'Help Center';
    }
  }, [data]);

  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  const { data: results, isFetching: searching } = useQuery({
    queryKey: ['help', 'search', debouncedQ],
    queryFn: () => api.get<SearchResult[]>(`/api/help-center/search?q=${encodeURIComponent(debouncedQ)}`),
    enabled: debouncedQ.length > 0,
  });

  const branding = data?.branding;
  const categories = data?.categories ?? [];
  const showDropdown = debouncedQ.length > 0 && q.trim().length > 0;

  return (
    <HelpShell branding={branding}>
      {/* Hero + search */}
      <div className="text-center pt-4 pb-2">
        <h1 className="text-3xl font-bold text-gray-900">
          {branding?.helpCenterTitle || 'How can we help?'}
        </h1>
        <div className="relative max-w-xl mx-auto mt-5 text-left">
          <Search size={17} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search for answers…"
            className="w-full rounded-xl border border-gray-300 bg-white pl-10 pr-4 py-3 text-base shadow-sm focus:outline-none focus:ring-2 focus:ring-brand/40 focus:border-brand"
          />
          {showDropdown && (
            <Card className="absolute z-10 mt-2 w-full max-h-80 overflow-y-auto shadow-lg">
              {searching && !results && (
                <p className="px-4 py-3 text-sm text-gray-400">Searching…</p>
              )}
              {results && results.length === 0 && (
                <div className="px-4 py-3 text-sm text-gray-500">
                  <p>No articles match “{debouncedQ}”.</p>
                  <p className="text-xs text-gray-400 mt-1">
                    We log every unanswered search so a human can write that article —{' '}
                    <Link to="/portal" className="text-brand underline">
                      or ask us directly
                    </Link>
                    .
                  </p>
                </div>
              )}
              {(results ?? []).map((r) => (
                <Link
                  key={r.id}
                  to={`/help/a/${r.slug}`}
                  className="block px-4 py-2.5 border-b border-gray-100 last:border-b-0 hover:bg-gray-50"
                >
                  <p className="text-sm font-medium text-gray-800">{r.title}</p>
                  {r.snippet && (
                    <p className="text-xs text-gray-500 truncate">{stripTags(r.snippet)}</p>
                  )}
                </Link>
              ))}
            </Card>
          )}
        </div>
      </div>

      {/* Human promise banner */}
      <div className="max-w-xl mx-auto mt-5 flex items-center gap-2.5 rounded-xl bg-brand-soft px-4 py-3 text-sm text-brand">
        <HeartHandshake size={17} className="shrink-0" />
        <span>{branding?.humanPromise ?? DEFAULT_PROMISE}</span>
      </div>

      {/* Categories */}
      {isLoading && <p className="text-center text-gray-400 py-12">Loading articles…</p>}
      {!isLoading && categories.length === 0 && (
        <p className="text-center text-gray-400 py-12">No articles published yet — check back soon.</p>
      )}
      {categories.map((c) => (
        <section key={c.id} id={`cat-${c.slug}`} className="mt-10">
          <h2 className="text-lg font-semibold text-gray-900">{c.name}</h2>
          {c.description && <p className="text-sm text-gray-500 mt-0.5">{c.description}</p>}
          {c.articles.length === 0 ? (
            <p className="mt-2 text-sm text-gray-400">No articles in this section yet.</p>
          ) : (
            <Card className="mt-2 divide-y divide-gray-100">
              {c.articles.map((a) => (
                <Link
                  key={a.id}
                  to={`/help/a/${a.slug}`}
                  className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 hover:text-brand"
                >
                  <FileText size={14} className="text-gray-400 shrink-0" />
                  <span className="truncate">{a.title}</span>
                </Link>
              ))}
            </Card>
          )}
        </section>
      ))}
    </HelpShell>
  );
}
