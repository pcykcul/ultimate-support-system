/**
 * Agent ticket queue. Keyboard-first: j/k move the selection, Enter opens, r refreshes.
 * Breached tickets stay visible with a red "overdue" badge — hiding failures is not an option.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { RefreshCw, Search } from 'lucide-react';
import { api } from '@/api/client';
import { Badge, Button, Card, Countdown, cx, EmptyState, Input, PageHeader, Select, timeAgo } from '@/lib/ui';
import {
  ALL_PRIORITIES,
  ALL_STATUSES,
  PRIORITY_META,
  PriorityBadge,
  STATUS_META,
  StatusBadge,
  type TicketListItem,
  type TicketPriority,
  type TicketStatus,
} from './shared';

type Owner = 'me' | 'unassigned' | 'all';
type Sort = 'updated' | 'created' | 'sla';

const PAGE_SIZE = 25;
const DEFAULT_STATUSES: TicketStatus[] = ['new', 'open', 'waiting_on_customer', 'on_hold'];
const OWNER_OPTIONS: { value: Owner; label: string }[] = [
  { value: 'me', label: 'Mine' },
  { value: 'unassigned', label: 'Unassigned' },
  { value: 'all', label: 'All' },
];
const SORT_OPTIONS: { value: Sort; label: string }[] = [
  { value: 'updated', label: 'Updated' },
  { value: 'created', label: 'Newest' },
  { value: 'sla', label: 'SLA: closest to breach' },
];

const ROW_GRID =
  'grid grid-cols-[3.5rem_minmax(0,1fr)_10rem_8.5rem_4.5rem_7rem_6.5rem_4.5rem] items-center gap-2 px-3';

export default function InboxPage() {
  const navigate = useNavigate();

  const [statuses, setStatuses] = useState<TicketStatus[]>(DEFAULT_STATUSES);
  const [owner, setOwner] = useState<Owner>('all');
  const [priority, setPriority] = useState<'' | TicketPriority>('');
  const [sort, setSort] = useState<Sort>('updated');
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [page, setPage] = useState(1);
  const [sel, setSel] = useState(0);
  const selRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 300);
    return () => clearTimeout(t);
  }, [q]);

  // Any filter change restarts pagination at page 1.
  const statusKey = statuses.join(',');
  useEffect(() => {
    setPage(1);
  }, [statusKey, owner, priority, sort, debouncedQ]);

  const qs = useMemo(() => {
    const params = new URLSearchParams();
    if (statuses.length > 0) params.set('status', statuses.join(','));
    if (owner !== 'all') params.set('assigneeId', owner);
    if (priority) params.set('priority', priority);
    if (debouncedQ.trim()) params.set('q', debouncedQ.trim());
    params.set('sort', sort);
    params.set('page', String(page));
    params.set('limit', String(PAGE_SIZE));
    return params.toString();
  }, [statuses, owner, priority, sort, debouncedQ, page]);

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['tickets', qs],
    queryFn: () => api.get<{ items: TicketListItem[]; total: number }>(`/api/tickets?${qs}`),
    placeholderData: keepPreviousData,
  });

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Keep the keyboard selection inside the current page.
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
        if (t && t.tagName === 'BUTTON') return; // let a focused control handle its own Enter
        const ticket = items[sel];
        if (ticket) navigate(`/tickets/${ticket.id}`);
      } else if (e.key === 'r') {
        e.preventDefault();
        void refetch();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [items, sel, navigate, refetch]);

  const toggleStatus = (s: TicketStatus) =>
    setStatuses((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));

  return (
    <div>
      <PageHeader
        title="Inbox"
        subtitle={isLoading ? 'Loading…' : `${total} ticket${total === 1 ? '' : 's'}`}
        actions={
          <Button variant="secondary" onClick={() => void refetch()} disabled={isFetching}>
            <RefreshCw size={14} className={isFetching ? 'animate-spin' : undefined} />
            Refresh
          </Button>
        }
      />

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <div className="flex rounded-lg border border-gray-300 overflow-hidden bg-white">
          {OWNER_OPTIONS.map((o) => (
            <button
              key={o.value}
              onClick={() => setOwner(o.value)}
              className={cx(
                'px-3 py-1.5 text-sm font-medium border-r border-gray-200 last:border-r-0',
                owner === o.value ? 'bg-brand-soft text-brand' : 'text-gray-600 hover:bg-gray-50'
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
        <Select value={priority} onChange={(e) => setPriority(e.target.value as '' | TicketPriority)}>
          <option value="">Any priority</option>
          {ALL_PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {PRIORITY_META[p].label}
            </option>
          ))}
        </Select>
        <Select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
          {SORT_OPTIONS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </Select>
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search tickets…"
            className="pl-8"
          />
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5 mb-3">
        {ALL_STATUSES.map((s) => {
          const active = statuses.includes(s);
          return (
            <button
              key={s}
              onClick={() => toggleStatus(s)}
              className={cx(
                'rounded-full px-2.5 py-1 text-xs font-medium border transition-colors',
                active
                  ? 'bg-brand-soft text-brand border-brand/30'
                  : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'
              )}
            >
              {STATUS_META[s].label}
            </button>
          );
        })}
      </div>

      {/* Queue */}
      <Card>
        <div
          className={cx(
            'hidden md:grid',
            ROW_GRID,
            'py-2 border-b border-gray-100 text-[11px] uppercase tracking-wide text-gray-400'
          )}
        >
          <span>#</span>
          <span>Subject</span>
          <span>Requester</span>
          <span>Status</span>
          <span>Priority</span>
          <span>Assignee</span>
          <span>SLA</span>
          <span className="text-right">Updated</span>
        </div>

        {isLoading && <div className="py-12 text-center text-sm text-gray-400">Loading tickets…</div>}
        {!isLoading && items.length === 0 && (
          <EmptyState title="No tickets match" hint="Adjust the filters or search to widen the queue." />
        )}

        {items.map((t, i) => {
          const sla = t.nextSlaDueAt ? (
            <Countdown due={t.nextSlaDueAt} />
          ) : t.slaBreached ? (
            <Badge color="red">Breached</Badge>
          ) : (
            <span className="text-xs text-gray-300">—</span>
          );
          return (
            <button
              key={t.id}
              ref={i === sel ? selRef : undefined}
              onClick={() => navigate(`/tickets/${t.id}`)}
              className={cx(
                'block w-full text-left border-b border-gray-100 last:border-b-0 transition-colors',
                i === sel ? 'bg-brand-soft' : 'hover:bg-gray-50'
              )}
            >
              {/* Mobile: two-line card */}
              <span className="md:hidden flex flex-col gap-1.5 px-3 py-3">
                <span className="flex items-start justify-between gap-2">
                  <span className="min-w-0 text-sm font-medium text-gray-800">
                    <span className="font-mono text-xs text-gray-400 mr-1.5">#{t.number}</span>
                    {t.subject}
                  </span>
                  <span className="shrink-0">{sla}</span>
                </span>
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500">
                  <span className="truncate max-w-[10rem]">
                    {t.requester.name}
                    {t.company ? ` · ${t.company.name}` : ''}
                  </span>
                  <StatusBadge status={t.status} />
                  <PriorityBadge priority={t.priority} />
                  <span className="ml-auto text-gray-400">{timeAgo(t.updatedAt)}</span>
                </span>
              </span>

              {/* Desktop: grid row */}
              <span className={cx('hidden md:grid py-2.5', ROW_GRID)}>
                <span className="text-xs font-mono text-gray-400">#{t.number}</span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-gray-800 truncate">{t.subject}</span>
                  {t.tags.length > 0 && (
                    <span className="block text-[11px] text-gray-400 truncate">{t.tags.join(' · ')}</span>
                  )}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm text-gray-700 truncate">{t.requester.name}</span>
                  {t.company && <span className="block text-[11px] text-gray-400 truncate">{t.company.name}</span>}
                </span>
                <span>
                  <StatusBadge status={t.status} />
                </span>
                <span>
                  <PriorityBadge priority={t.priority} />
                </span>
                <span className="text-xs text-gray-500 truncate">{t.assignee?.name ?? 'Unassigned'}</span>
                <span>{sla}</span>
                <span className="text-xs text-gray-400 text-right">{timeAgo(t.updatedAt)}</span>
              </span>
            </button>
          );
        })}

        {total > 0 && (
          <div className="flex items-center justify-between px-3 py-2 border-t border-gray-100">
            <span className="text-xs text-gray-400">
              Page {page} of {pages}
            </span>
            <div className="flex gap-1.5">
              <Button variant="ghost" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                ← Prev
              </Button>
              <Button variant="ghost" disabled={page >= pages} onClick={() => setPage((p) => Math.min(pages, p + 1))}>
                Next →
              </Button>
            </div>
          </div>
        )}
      </Card>

      <p className="mt-2 text-[11px] text-gray-400">j/k navigate · Enter open · r refresh</p>
    </div>
  );
}
