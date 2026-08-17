/**
 * Staff knowledge base: article table with filters, a category tree panel,
 * and the "New article" flow. Keyboard-first: j/k move, Enter opens.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { Activity, Plus, Search } from 'lucide-react';
import { api } from '@/api/client';
import { Badge, Button, Card, EmptyState, Input, Modal, PageHeader, Select, cx, timeAgo } from '@/lib/ui';
import { useMe } from '@/lib/session';
import CategoryPanel from './CategoryPanel';
import {
  ALL_AUDIENCES,
  ALL_STATUSES,
  AUDIENCE_META,
  AudienceBadge,
  STATUS_META,
  StatusBadge,
  canAct,
  feedbackPct,
  type Audience,
  type ArticleStatus,
  type KbArticleFull,
  type KbArticleListItem,
  type KbCategory,
} from './shared';

const ROW_GRID =
  'grid grid-cols-[minmax(0,1fr)_6.5rem_6.5rem_7.5rem_7rem_4.5rem_4rem_5rem] items-center gap-2 px-3';

export default function KbListPage() {
  const navigate = useNavigate();
  const { data: me } = useMe();
  const editable = canAct(me);

  const [status, setStatus] = useState<'' | ArticleStatus>('');
  const [audience, setAudience] = useState<'' | Audience>('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [newOpen, setNewOpen] = useState(false);
  const [sel, setSel] = useState(0);
  const selRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 300);
    return () => clearTimeout(t);
  }, [q]);

  const qs = useMemo(() => {
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (audience) params.set('audience', audience);
    if (categoryId) params.set('categoryId', categoryId);
    if (debouncedQ.trim()) params.set('q', debouncedQ.trim());
    return params.toString();
  }, [status, audience, categoryId, debouncedQ]);

  const { data: catData, isLoading: catsLoading } = useQuery({
    queryKey: ['kb', 'categories'],
    queryFn: () => api.get<{ items: KbCategory[] }>('/api/kb/categories'),
  });
  const { data, isLoading } = useQuery({
    queryKey: ['kb', 'articles', qs],
    queryFn: () => api.get<{ items: KbArticleListItem[] }>(`/api/kb/articles${qs ? `?${qs}` : ''}`),
    placeholderData: keepPreviousData,
  });

  const categories = catData?.items ?? [];
  const items = data?.items ?? [];

  useEffect(() => {
    setSel((s) => Math.min(s, Math.max(items.length - 1, 0)));
  }, [items.length]);

  useEffect(() => {
    selRef.current?.scrollIntoView({ block: 'nearest' });
  }, [sel]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) {
        return;
      }
      if (e.key === 'j') {
        e.preventDefault();
        setSel((s) => Math.min(s + 1, items.length - 1));
      } else if (e.key === 'k') {
        e.preventDefault();
        setSel((s) => Math.max(s - 1, 0));
      } else if (e.key === 'Enter') {
        if (t && t.tagName === 'BUTTON') return;
        const article = items[sel];
        if (article) navigate(`/kb/${article.id}`);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [items, sel, navigate]);

  return (
    <div>
      <PageHeader
        title="Knowledge Base"
        subtitle={isLoading ? 'Loading…' : `${items.length} article${items.length === 1 ? '' : 's'}`}
        actions={
          <>
            <Button variant="secondary" onClick={() => navigate('/kb/health')}>
              <Activity size={14} />
              Health
            </Button>
            {editable && (
              <Button onClick={() => setNewOpen(true)}>
                <Plus size={14} />
                New article
              </Button>
            )}
          </>
        }
      />

      <div className="flex flex-col md:flex-row gap-4 items-stretch md:items-start">
        <aside className="w-full md:w-60 shrink-0">
          <CategoryPanel
            categories={categories}
            isLoading={catsLoading}
            selectedId={categoryId}
            onSelect={setCategoryId}
            canEdit={editable}
          />
        </aside>

        <div className="flex-1 min-w-0">
          {/* Filters */}
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <Select value={status} onChange={(e) => setStatus(e.target.value as '' | ArticleStatus)}>
              <option value="">Any status</option>
              {ALL_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_META[s].label}
                </option>
              ))}
            </Select>
            <Select value={audience} onChange={(e) => setAudience(e.target.value as '' | Audience)}>
              <option value="">Any audience</option>
              {ALL_AUDIENCES.map((a) => (
                <option key={a} value={a}>
                  {AUDIENCE_META[a].label}
                </option>
              ))}
            </Select>
            <div className="relative flex-1 min-w-[180px] max-w-xs">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search articles…" className="pl-8" />
            </div>
          </div>

          <Card>
            <div
              className={cx(
                'hidden md:grid',
                ROW_GRID,
                'py-2 border-b border-gray-100 text-[11px] uppercase tracking-wide text-gray-400'
              )}
            >
              <span>Title</span>
              <span>Status</span>
              <span>Audience</span>
              <span>Owner</span>
              <span>Verified</span>
              <span className="text-right">Helpful</span>
              <span className="text-right">Views</span>
              <span className="text-right">Updated</span>
            </div>

            {isLoading && <div className="py-12 text-center text-sm text-gray-400">Loading articles…</div>}
            {!isLoading && items.length === 0 && (
              <EmptyState
                title="No articles match"
                hint="Adjust the filters, or write the first article."
                action={
                  editable ? (
                    <Button onClick={() => setNewOpen(true)}>
                      <Plus size={14} />
                      New article
                    </Button>
                  ) : undefined
                }
              />
            )}

            {items.map((a, i) => {
              const verified = a.stale ? (
                <Badge color="red">Needs review</Badge>
              ) : a.verifiedAt ? (
                <span className="text-xs text-green-700">✓ {timeAgo(a.verifiedAt)}</span>
              ) : (
                <span className="text-xs text-gray-300">—</span>
              );
              return (
                <button
                  key={a.id}
                  ref={i === sel ? selRef : undefined}
                  onClick={() => navigate(`/kb/${a.id}`)}
                  className={cx(
                    'block w-full text-left border-b border-gray-100 last:border-b-0 transition-colors',
                    i === sel ? 'bg-brand-soft' : 'hover:bg-gray-50'
                  )}
                >
                  {/* Mobile: two-line card */}
                  <span className="md:hidden flex flex-col gap-1.5 px-3 py-3">
                    <span className="flex items-start justify-between gap-2">
                      <span className="min-w-0 text-sm font-medium text-gray-800">{a.title}</span>
                      <span className="shrink-0">{verified}</span>
                    </span>
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500">
                      <StatusBadge status={a.status} />
                      <AudienceBadge audience={a.audience} />
                      <span>{feedbackPct(a.helpfulYes, a.helpfulNo)} helpful</span>
                      <span className="ml-auto text-gray-400">{timeAgo(a.updatedAt)}</span>
                    </span>
                  </span>

                  {/* Desktop: grid row */}
                  <span className={cx('hidden md:grid py-2.5', ROW_GRID)}>
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-gray-800 truncate">{a.title}</span>
                      {a.articleType && <span className="block text-[11px] text-gray-400">{a.articleType}</span>}
                    </span>
                    <span>
                      <StatusBadge status={a.status} />
                    </span>
                    <span>
                      <AudienceBadge audience={a.audience} />
                    </span>
                    <span className="text-xs text-gray-500 truncate">{a.owner?.name ?? '—'}</span>
                    <span>{verified}</span>
                    <span className="text-xs text-gray-600 text-right">{feedbackPct(a.helpfulYes, a.helpfulNo)}</span>
                    <span className="text-xs text-gray-600 text-right">{a.viewCount}</span>
                    <span className="text-xs text-gray-400 text-right">{timeAgo(a.updatedAt)}</span>
                  </span>
                </button>
              );
            })}
          </Card>
          <p className="mt-2 text-[11px] text-gray-400">j/k navigate · Enter open</p>
        </div>
      </div>

      <NewArticleModal
        open={newOpen}
        onClose={() => setNewOpen(false)}
        categories={categories}
        defaultCategoryId={categoryId}
      />
    </div>
  );
}

function NewArticleModal({
  open,
  onClose,
  categories,
  defaultCategoryId,
}: {
  open: boolean;
  onClose: () => void;
  categories: KbCategory[];
  defaultCategoryId: string | null;
}) {
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [audience, setAudience] = useState<Audience>('public');
  const [error, setError] = useState<string | null>(null);

  // Pre-select the category currently filtered in the list.
  useEffect(() => {
    if (open) {
      setTitle('');
      setCategoryId(defaultCategoryId ?? '');
      setAudience('public');
      setError(null);
    }
  }, [open, defaultCategoryId]);

  const create = useMutation({
    mutationFn: () =>
      api.post<KbArticleFull>('/api/kb/articles', {
        title: title.trim(),
        categoryId: categoryId || undefined,
        audience,
      }),
    onSuccess: (article) => navigate(`/kb/${article.id}`),
    onError: (e) => setError(e instanceof Error ? e.message : 'Could not create the article'),
  });

  return (
    <Modal open={open} onClose={onClose} title="New article">
      <div className="space-y-3">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Title</label>
          <Input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="How do I…"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && title.trim()) create.mutate();
            }}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Category</label>
          <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="w-full">
            <option value="">No category</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.parentId ? `— ${c.name}` : c.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Audience</label>
          <Select value={audience} onChange={(e) => setAudience(e.target.value as Audience)} className="w-full">
            {ALL_AUDIENCES.map((a) => (
              <option key={a} value={a}>
                {AUDIENCE_META[a].label}
              </option>
            ))}
          </Select>
        </div>
        {error && <p className="text-xs text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!title.trim() || create.isPending} onClick={() => create.mutate()}>
            {create.isPending ? 'Creating…' : 'Create draft'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
