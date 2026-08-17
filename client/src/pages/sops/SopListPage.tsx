/**
 * SOP library: references + runbooks with kind/status/search filters,
 * the "New SOP" flow, and a banner when I still owe acknowledgments.
 * Keyboard-first: j/k move, Enter opens.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { ListChecks, PenLine, Plus, Search } from 'lucide-react';
import { api } from '@/api/client';
import { Badge, Button, Card, EmptyState, Input, Modal, PageHeader, Select, cx, timeAgo } from '@/lib/ui';
import { useMe } from '@/lib/session';
import {
  ALL_SOP_STATUSES,
  KIND_META,
  KindBadge,
  STATUS_META,
  StatusBadge,
  canAct,
  coverageOf,
  normalizeMyAcks,
  type MyAcksPayload,
  type SopFull,
  type SopKind,
  type SopListItem,
  type SopStatus,
} from './shared';

interface Team {
  id: string;
  name: string;
  emoji: string | null;
}

const KIND_CHIPS: { value: '' | SopKind; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'reference', label: 'Reference' },
  { value: 'runbook', label: 'Runbooks' },
];

export default function SopListPage() {
  const navigate = useNavigate();
  const { data: me } = useMe();
  const editable = canAct(me);

  const [kind, setKind] = useState<'' | SopKind>('');
  const [status, setStatus] = useState<'' | SopStatus>('');
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
    if (kind) params.set('kind', kind);
    if (status) params.set('status', status);
    if (debouncedQ.trim()) params.set('q', debouncedQ.trim());
    return params.toString();
  }, [kind, status, debouncedQ]);

  const { data, isLoading } = useQuery({
    queryKey: ['sops', 'list', qs],
    queryFn: () => api.get<{ items: SopListItem[] }>(`/api/sops${qs ? `?${qs}` : ''}`),
    placeholderData: keepPreviousData,
  });

  const { data: mineRaw } = useQuery({
    queryKey: ['sops', 'acks', 'mine'],
    queryFn: () => api.get<MyAcksPayload>('/api/sops/acknowledgments/mine'),
  });
  const pendingAcks = useMemo(() => normalizeMyAcks(mineRaw).pending, [mineRaw]);

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
        const sop = items[sel];
        if (sop) navigate(`/sops/${sop.id}`);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [items, sel, navigate]);

  return (
    <div>
      <PageHeader
        title="SOPs & Runbooks"
        subtitle={isLoading ? 'Loading…' : `${items.length} procedure${items.length === 1 ? '' : 's'}`}
        actions={
          <>
            <Button variant="secondary" onClick={() => navigate('/sops/acknowledgments')}>
              <PenLine size={14} />
              My acknowledgments
            </Button>
            {editable && (
              <Button onClick={() => setNewOpen(true)}>
                <Plus size={14} />
                New SOP
              </Button>
            )}
          </>
        }
      />

      {pendingAcks.length > 0 && (
        <Link
          to="/sops/acknowledgments"
          className="mb-3 flex flex-wrap items-center gap-2.5 rounded-xl border border-yellow-300 bg-yellow-50 px-4 py-3 text-sm text-yellow-900 hover:bg-yellow-100 transition-colors"
        >
          <PenLine size={16} className="shrink-0" />
          <span className="flex-1 min-w-[180px]">
            {pendingAcks.length === 1
              ? 'One SOP is waiting for your read-and-sign acknowledgment.'
              : `${pendingAcks.length} SOPs are waiting for your read-and-sign acknowledgment.`}
          </span>
          <span className="font-medium whitespace-nowrap">Review &amp; sign →</span>
        </Link>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="flex items-center gap-1 rounded-lg bg-gray-100 p-1">
          {KIND_CHIPS.map((c) => (
            <button
              key={c.value}
              onClick={() => setKind(c.value)}
              className={cx(
                'rounded-md px-2.5 py-1 text-sm transition-colors',
                kind === c.value ? 'bg-white shadow-sm font-medium text-gray-800' : 'text-gray-500 hover:text-gray-800'
              )}
            >
              {c.label}
            </button>
          ))}
        </div>
        <Select value={status} onChange={(e) => setStatus(e.target.value as '' | SopStatus)}>
          <option value="">Any status</option>
          {ALL_SOP_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_META[s].label}
            </option>
          ))}
        </Select>
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search SOPs…" className="pl-8" />
        </div>
      </div>

      <Card>
        {isLoading && <div className="py-12 text-center text-sm text-gray-400">Loading SOPs…</div>}
        {!isLoading && items.length === 0 && (
          <EmptyState
            title="No SOPs match"
            hint="Adjust the filters, or document the first procedure."
            action={
              editable ? (
                <Button onClick={() => setNewOpen(true)}>
                  <Plus size={14} />
                  New SOP
                </Button>
              ) : undefined
            }
          />
        )}

        {items.map((s, i) => {
          const coverage = coverageOf(s);
          return (
            <button
              key={s.id}
              ref={i === sel ? selRef : undefined}
              onClick={() => navigate(`/sops/${s.id}`)}
              className={cx(
                'block w-full text-left border-b border-gray-100 last:border-b-0 px-3 py-2.5 transition-colors',
                i === sel ? 'bg-brand-soft' : 'hover:bg-gray-50'
              )}
            >
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-sm font-medium text-gray-800 truncate max-w-full sm:flex-1 sm:min-w-[160px]">
                  {s.title}
                </span>
                <KindBadge kind={s.kind} />
                <StatusBadge status={s.status} />
                {s.stale && <Badge color="red">Needs review</Badge>}
              </span>
              <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-gray-500">
                <span>{s.owner?.name ?? 'No owner'}</span>
                <span>v{s.version}</span>
                {s.kind === 'runbook' && (
                  <span className="inline-flex items-center gap-1">
                    <ListChecks size={12} className="text-gray-400" />
                    {s.stepCount} step{s.stepCount === 1 ? '' : 's'}
                  </span>
                )}
                {!s.stale && s.verifiedAt && (
                  <span className="text-green-700">✓ verified {timeAgo(s.verifiedAt)}</span>
                )}
                {s.requiresAcknowledgment &&
                  (coverage ? (
                    <span
                      className={cx(
                        coverage.total > 0 && coverage.acknowledged >= coverage.total
                          ? 'text-green-700'
                          : coverage.acknowledged > 0
                            ? 'text-yellow-700'
                            : 'text-red-700'
                      )}
                    >
                      {coverage.acknowledged}/{coverage.total} signed
                    </span>
                  ) : (
                    <span className="text-yellow-700">sign-off required</span>
                  ))}
                <span className="text-gray-400">updated {timeAgo(s.updatedAt)}</span>
              </span>
            </button>
          );
        })}
      </Card>
      <p className="mt-2 text-[11px] text-gray-400">j/k navigate · Enter open</p>

      <NewSopModal open={newOpen} onClose={() => setNewOpen(false)} />
    </div>
  );
}

function NewSopModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const [kind, setKind] = useState<SopKind>('reference');
  const [title, setTitle] = useState('');
  const [teamId, setTeamId] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setKind('reference');
      setTitle('');
      setTeamId('');
      setError(null);
    }
  }, [open]);

  const { data: teamData } = useQuery({
    queryKey: ['users', 'teams'],
    queryFn: () => api.get<{ items: Team[] }>('/api/users/teams'),
    enabled: open,
  });

  const create = useMutation({
    mutationFn: () =>
      api.post<SopFull & { sop?: SopFull }>('/api/sops', {
        kind,
        title: title.trim(),
        teamId: teamId || undefined,
      }),
    onSuccess: (res) => {
      const sop = res.sop ?? res;
      navigate(`/sops/${sop.id}`);
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'Could not create the SOP'),
  });

  return (
    <Modal open={open} onClose={onClose} title="New SOP">
      <div className="space-y-3">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Kind</label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {(Object.keys(KIND_META) as SopKind[]).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                className={cx(
                  'rounded-xl border p-3 text-left transition-colors',
                  kind === k ? 'border-brand bg-brand-soft' : 'border-gray-200 hover:bg-gray-50'
                )}
              >
                <span className="block text-sm font-medium text-gray-800">{KIND_META[k].label}</span>
                <span className="mt-0.5 block text-xs text-gray-500">{KIND_META[k].hint}</span>
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Title</label>
          <Input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={kind === 'runbook' ? 'e.g. Major outage response' : 'e.g. Refund policy'}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && title.trim()) create.mutate();
            }}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Team (optional)</label>
          <Select value={teamId} onChange={(e) => setTeamId(e.target.value)} className="w-full">
            <option value="">No team</option>
            {(teamData?.items ?? []).map((t) => (
              <option key={t.id} value={t.id}>
                {t.emoji ? `${t.emoji} ` : ''}
                {t.name}
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
