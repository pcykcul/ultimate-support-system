/**
 * Article editor: markdown with live side-by-side preview, metadata sidebar,
 * status workflow (submit → supervisor publish → archive), verification and revisions.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Archive, Check, Eye, History, Send, ShieldCheck, Undo2, UploadCloud } from 'lucide-react';
import { api } from '@/api/client';
import { BackLink, Badge, Button, Card, Input, Modal, Select, Textarea, timeAgo } from '@/lib/ui';
import { Markdown } from '@/lib/markdown';
import { useMe } from '@/lib/session';
import {
  ALL_AUDIENCES,
  ARTICLE_TYPES,
  AUDIENCE_META,
  StatusBadge,
  canAct,
  feedbackPct,
  isStale,
  isSupervisor,
  type Audience,
  type KbArticleFull,
  type KbRevisionFull,
  type KbRevisionMeta,
} from './shared';

interface StaffUser {
  id: string;
  name: string;
}

export default function KbArticlePage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const { data: me } = useMe();
  const editable = canAct(me);
  const supervisor = isSupervisor(me);

  const { data: article, isLoading, error } = useQuery({
    queryKey: ['kb', 'article', id],
    // Tolerate both `{...article, revisions}` and `{article, revisions}` payload styles.
    queryFn: async () => {
      const raw = await api.get<KbArticleFull & { article?: KbArticleFull; revisions?: KbRevisionMeta[] }>(
        `/api/kb/articles/${id}`
      );
      return raw.article ? { ...raw.article, revisions: raw.revisions ?? raw.article.revisions ?? [] } : raw;
    },
    enabled: !!id,
  });

  const { data: staffData } = useQuery({
    queryKey: ['users', 'staff'],
    queryFn: () => api.get<{ items: StaffUser[] }>('/api/users?kind=staff'),
  });

  // ----- editable form state, hydrated once per article id -----
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [audience, setAudience] = useState<Audience>('public');
  const [articleType, setArticleType] = useState('');
  const [ownerId, setOwnerId] = useState('');
  const [verifyDays, setVerifyDays] = useState('');
  const [companyIds, setCompanyIds] = useState<string[]>([]);
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [viewRev, setViewRev] = useState<KbRevisionMeta | null>(null);

  useEffect(() => {
    if (article && article.id !== loadedId) {
      setTitle(article.title);
      setBody(article.body);
      setCategoryId(article.categoryId ?? '');
      setAudience(article.audience);
      setArticleType(article.articleType ?? '');
      setOwnerId(article.ownerId ?? article.owner?.id ?? '');
      setVerifyDays(article.verifyIntervalDays != null ? String(article.verifyIntervalDays) : '');
      setCompanyIds(article.companyIds ?? []);
      setDirty(false);
      setLoadedId(article.id);
    }
  }, [article, loadedId]);

  const { data: categoriesData } = useQuery({
    queryKey: ['kb', 'categories'],
    queryFn: () => api.get<{ items: { id: string; name: string; parentId: string | null }[] }>('/api/kb/categories'),
  });
  const { data: companiesData } = useQuery({
    queryKey: ['companies', 'picker'],
    queryFn: () => api.get<{ items: { id: string; name: string }[] }>('/api/companies'),
    enabled: audience === 'company',
  });

  const touch = <T,>(setter: (v: T) => void) => (v: T) => {
    setter(v);
    setDirty(true);
    setSaved(false);
  };

  const save = useMutation({
    mutationFn: () =>
      api.patch<KbArticleFull>(`/api/kb/articles/${id}`, {
        title: title.trim() || 'Untitled',
        body,
        categoryId: categoryId || null,
        audience,
        articleType: articleType || null,
        ownerId: ownerId || null,
        verifyIntervalDays: verifyDays.trim() === '' ? null : Math.max(1, Number(verifyDays)),
        ...(audience === 'company' ? { companyIds } : {}),
      }),
    onSuccess: () => {
      setDirty(false);
      setSaved(true);
      setActionError(null);
      window.setTimeout(() => setSaved(false), 2500);
      void qc.invalidateQueries({ queryKey: ['kb'] });
    },
    onError: (e) => setActionError(e instanceof Error ? e.message : 'Save failed'),
  });

  const workflow = useMutation({
    mutationFn: (action: 'submit-review' | 'publish' | 'archive' | 'verify') =>
      api.post(`/api/kb/articles/${id}/${action}`),
    onSuccess: () => {
      setActionError(null);
      void qc.invalidateQueries({ queryKey: ['kb'] });
    },
    onError: (e) => setActionError(e instanceof Error ? e.message : 'Action failed'),
  });

  const rollback = useMutation({
    mutationFn: (revisionId: string) => api.post(`/api/kb/articles/${id}/rollback`, { revisionId }),
    onSuccess: () => {
      setActionError(null);
      setViewRev(null);
      setLoadedId(null); // rehydrate the form from the restored content
      void qc.invalidateQueries({ queryKey: ['kb'] });
    },
    onError: (e) => setActionError(e instanceof Error ? e.message : 'Rollback failed'),
  });

  const { data: revFull, isLoading: revLoading } = useQuery({
    queryKey: ['kb', 'article', id, 'revision', viewRev?.id],
    queryFn: () => api.get<KbRevisionFull>(`/api/kb/articles/${id}/revisions/${viewRev?.id}`),
    enabled: !!viewRev,
  });

  const stale = useMemo(() => (article ? isStale(article) : false), [article]);
  const isOwner = !!me && !!article && (article.ownerId ?? article.owner?.id) === me.id;
  const canVerify = editable && (supervisor || isOwner);
  const revisions = article?.revisions ?? [];

  if (isLoading) return <div className="py-16 text-center text-gray-400">Loading article…</div>;
  if (error || !article) {
    return (
      <div className="py-16 text-center text-gray-500">
        <p className="font-medium">Article not found</p>
        <div className="mt-3">
          <BackLink to="/kb" label="Back to knowledge base" />
        </div>
      </div>
    );
  }

  return (
    <div>
      <BackLink to="/kb" label="Knowledge base" />

      {stale && (
        <div className="mt-3 flex items-center gap-2.5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <AlertTriangle size={16} className="shrink-0" />
          <span className="flex-1">
            Overdue for verification
            {article.verifiedAt
              ? ` — last verified ${timeAgo(article.verifiedAt)}`
              : ' — never verified'}
            {article.verifyIntervalDays ? ` (interval: every ${article.verifyIntervalDays} days).` : '.'}{' '}
            Re-read it and confirm it is still accurate.
          </span>
          {canVerify && (
            <Button variant="secondary" disabled={workflow.isPending} onClick={() => workflow.mutate('verify')}>
              <ShieldCheck size={14} />
              Verify now
            </Button>
          )}
        </div>
      )}

      {/* Title + workflow */}
      <div className="mt-3 mb-4 flex flex-wrap items-center gap-2">
        <Input
          value={title}
          onChange={(e) => touch(setTitle)(e.target.value)}
          disabled={!editable}
          placeholder="Article title"
          className="flex-1 min-w-[240px] !text-lg font-semibold"
        />
        <StatusBadge status={article.status} />
        {editable && (
          <>
            <Button disabled={!dirty || save.isPending} onClick={() => save.mutate()}>
              {save.isPending ? 'Saving…' : 'Save'}
            </Button>
            {saved && (
              <span className="inline-flex items-center gap-1 text-sm text-green-700">
                <Check size={14} /> Saved
              </span>
            )}
            {article.status === 'draft' && (
              <Button variant="secondary" disabled={workflow.isPending} onClick={() => workflow.mutate('submit-review')}>
                <Send size={14} />
                Submit for review
              </Button>
            )}
            {(article.status === 'draft' || article.status === 'review') && supervisor && (
              <Button variant="secondary" disabled={workflow.isPending} onClick={() => workflow.mutate('publish')}>
                <UploadCloud size={14} />
                Publish
              </Button>
            )}
            {article.status === 'review' && !supervisor && (
              <span className="text-xs text-gray-400">Awaiting supervisor approval to publish</span>
            )}
            {article.status === 'published' && canVerify && !stale && (
              <Button variant="secondary" disabled={workflow.isPending} onClick={() => workflow.mutate('verify')}>
                <ShieldCheck size={14} />
                Verify now
              </Button>
            )}
            {article.status === 'published' && supervisor && (
              <Button variant="danger" disabled={workflow.isPending} onClick={() => workflow.mutate('archive')}>
                <Archive size={14} />
                Archive
              </Button>
            )}
          </>
        )}
      </div>
      {actionError && <p className="mb-3 text-sm text-red-600">{actionError}</p>}

      <div className="flex flex-col lg:flex-row gap-4 items-stretch lg:items-start">
        {/* Editor + live preview */}
        <div className="flex-1 min-w-0">
          <div className="grid lg:grid-cols-2 gap-3">
            <Textarea
              value={body}
              onChange={(e) => touch(setBody)(e.target.value)}
              disabled={!editable}
              rows={26}
              placeholder="Write the article in markdown…"
              className="font-mono !text-[13px] leading-relaxed resize-y"
            />
            <Card className="p-4 overflow-y-auto max-h-[560px]">
              {body.trim() ? (
                <Markdown className="text-sm text-gray-800">{body}</Markdown>
              ) : (
                <p className="text-sm text-gray-400">The live preview appears here as you type.</p>
              )}
            </Card>
          </div>

          {/* Revisions */}
          <Card className="mt-4">
            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-gray-100">
              <History size={14} className="text-gray-400" />
              <h2 className="text-sm font-semibold">Revisions</h2>
              <span className="text-xs text-gray-400">{revisions.length}</span>
            </div>
            {revisions.length === 0 && (
              <p className="px-4 py-4 text-sm text-gray-400">No revisions yet — saving creates one.</p>
            )}
            {revisions.map((r) => (
              <div
                key={r.id}
                className="flex items-center gap-3 px-4 py-2.5 border-b border-gray-100 last:border-b-0"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-800 truncate">{r.title}</p>
                  <p className="text-xs text-gray-400 truncate">
                    {r.authorName ?? 'Unknown'} · {timeAgo(r.createdAt)}
                    {r.note ? ` · ${r.note}` : ''}
                  </p>
                </div>
                <Button variant="ghost" className="!px-2" onClick={() => setViewRev(r)}>
                  <Eye size={14} />
                  View
                </Button>
                {editable && (
                  <Button
                    variant="ghost"
                    className="!px-2"
                    disabled={rollback.isPending}
                    onClick={() => {
                      if (window.confirm('Restore this revision? The current content is kept as a revision.')) {
                        rollback.mutate(r.id);
                      }
                    }}
                  >
                    <Undo2 size={14} />
                    Rollback
                  </Button>
                )}
              </div>
            ))}
          </Card>
        </div>

        {/* Metadata sidebar */}
        <aside className="w-full lg:w-64 shrink-0 space-y-4">
          <Card className="p-4 space-y-3">
            <SidebarField label="Category">
              <Select
                value={categoryId}
                onChange={(e) => touch(setCategoryId)(e.target.value)}
                disabled={!editable}
                className="w-full"
              >
                <option value="">No category</option>
                {(categoriesData?.items ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.parentId ? `— ${c.name}` : c.name}
                  </option>
                ))}
              </Select>
            </SidebarField>
            <SidebarField label="Audience">
              <Select
                value={audience}
                onChange={(e) => touch(setAudience)(e.target.value as Audience)}
                disabled={!editable}
                className="w-full"
              >
                {ALL_AUDIENCES.map((a) => (
                  <option key={a} value={a}>
                    {AUDIENCE_META[a].label}
                  </option>
                ))}
              </Select>
            </SidebarField>
            {audience === 'company' && (
              <SidebarField label="Visible to companies">
                <div className="max-h-40 overflow-y-auto rounded-lg border border-gray-200 divide-y divide-gray-100">
                  {(companiesData?.items ?? []).length === 0 && (
                    <p className="px-2.5 py-2 text-xs text-gray-400">No companies yet.</p>
                  )}
                  {(companiesData?.items ?? []).map((c) => (
                    <label key={c.id} className="flex items-center gap-2 px-2.5 py-1.5 text-sm cursor-pointer hover:bg-gray-50">
                      <input
                        type="checkbox"
                        disabled={!editable}
                        checked={companyIds.includes(c.id)}
                        onChange={(e) =>
                          touch(setCompanyIds)(
                            e.target.checked ? [...companyIds, c.id] : companyIds.filter((x) => x !== c.id)
                          )
                        }
                      />
                      <span className="truncate">{c.name}</span>
                    </label>
                  ))}
                </div>
              </SidebarField>
            )}
            <SidebarField label="Type">
              <Select
                value={articleType}
                onChange={(e) => touch(setArticleType)(e.target.value)}
                disabled={!editable}
                className="w-full"
              >
                <option value="">Unset</option>
                {ARTICLE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </Select>
            </SidebarField>
            <SidebarField label="Owner">
              <Select
                value={ownerId}
                onChange={(e) => touch(setOwnerId)(e.target.value)}
                disabled={!editable}
                className="w-full"
              >
                <option value="">No owner</option>
                {(staffData?.items ?? []).map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </Select>
            </SidebarField>
            <SidebarField label="Verify every (days)">
              <Input
                type="number"
                min={1}
                value={verifyDays}
                onChange={(e) => touch(setVerifyDays)(e.target.value)}
                disabled={!editable}
                placeholder="e.g. 90"
              />
            </SidebarField>
            {dirty && <p className="text-[11px] text-yellow-700">Unsaved changes</p>}
          </Card>

          <Card className="p-4 text-sm space-y-1.5">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-1">Stats</h2>
            <p className="flex justify-between text-gray-600">
              <span>Views</span>
              <span>{article.viewCount}</span>
            </p>
            <p className="flex justify-between text-gray-600">
              <span>Helpful</span>
              <span>
                {feedbackPct(article.helpfulYes, article.helpfulNo)}{' '}
                <span className="text-gray-400">
                  ({article.helpfulYes}/{article.helpfulYes + article.helpfulNo})
                </span>
              </span>
            </p>
            <p className="flex justify-between text-gray-600">
              <span>Verified</span>
              <span>{article.verifiedAt ? timeAgo(article.verifiedAt) : 'never'}</span>
            </p>
            <p className="flex justify-between text-gray-600">
              <span>Updated</span>
              <span>{timeAgo(article.updatedAt)}</span>
            </p>
            <p className="flex justify-between text-gray-600 items-center">
              <span>Slug</span>
              <Badge color="gray" className="font-mono !font-normal max-w-[9rem] truncate">
                {article.slug}
              </Badge>
            </p>
          </Card>
        </aside>
      </div>

      {/* Revision viewer */}
      <Modal open={!!viewRev} onClose={() => setViewRev(null)} title={viewRev ? `Revision · ${viewRev.title}` : ''} wide>
        {viewRev && (
          <div>
            <p className="text-xs text-gray-400 mb-3">
              {viewRev.authorName ?? 'Unknown'} · {timeAgo(viewRev.createdAt)}
              {viewRev.note ? ` · ${viewRev.note}` : ''}
            </p>
            {revLoading && <p className="text-sm text-gray-400 py-6 text-center">Loading revision…</p>}
            {revFull && (
              <div className="rounded-lg border border-gray-200 p-4 max-h-[50vh] overflow-y-auto">
                <Markdown className="text-sm text-gray-800">{revFull.body}</Markdown>
              </div>
            )}
            {editable && (
              <div className="flex justify-end mt-3">
                <Button
                  variant="secondary"
                  disabled={rollback.isPending || !revFull}
                  onClick={() => rollback.mutate(viewRev.id)}
                >
                  <Undo2 size={14} />
                  Restore this revision
                </Button>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}

function SidebarField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-500 mb-1">{label}</label>
      {children}
    </div>
  );
}
