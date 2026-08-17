/**
 * Ticket conversation view: message thread + composer on the left, requester/SLA/properties
 * sidebar on the right. Collaborators are read-only — internal notes only, no mutations.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Bell,
  BellOff,
  BookOpen,
  ChevronDown,
  Clock,
  FilePlus2,
  GitMerge,
  Lock,
  Send,
  X,
} from 'lucide-react';
import { api } from '@/api/client';
import {
  BackLink,
  Badge,
  Button,
  Card,
  Countdown,
  cx,
  EmptyState,
  Input,
  Select,
  Textarea,
  timeAgo,
} from '@/lib/ui';
import { Markdown } from '@/lib/markdown';
import { useMe } from '@/lib/session';
import {
  ALL_PRIORITIES,
  ALL_STATUSES,
  isFollowing,
  PRIORITY_META,
  PriorityBadge,
  STATUS_META,
  StatusBadge,
  type MacroApplyResult,
  type SlaMetric,
  type StaffUser,
  type Team,
  type TicketDetailResponse,
  type TicketEvent,
  type TicketMessage,
} from './shared';
import MacroPicker from './MacroPicker';
import ExtendSlaModal from './ExtendSlaModal';
import MergeModal from './MergeModal';

export default function TicketPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: me } = useMe();
  const isCollaborator = me?.role === 'collaborator';
  const canAct = !!me && !isCollaborator;

  const { data, isLoading } = useQuery({
    queryKey: ['ticket', id],
    queryFn: () => api.get<TicketDetailResponse>(`/api/tickets/${id}`),
    enabled: id !== '',
  });

  const { data: staffData } = useQuery({
    queryKey: ['users', 'staff'],
    queryFn: () => api.get<{ items: StaffUser[] }>('/api/users?kind=staff'),
    staleTime: 60_000,
  });
  const { data: teamsData } = useQuery({
    queryKey: ['teams'],
    queryFn: () => api.get<{ items: Team[] }>('/api/users/teams'),
    staleTime: 60_000,
  });

  // Composer
  const [body, setBody] = useState('');
  const [kind, setKind] = useState<'public' | 'internal'>('public');
  const [tagInput, setTagInput] = useState('');
  const [appliedSop, setAppliedSop] = useState<{ sopId: string; sopTitle: string } | null>(null);
  const [showExtend, setShowExtend] = useState(false);
  const [showMerge, setShowMerge] = useState(false);
  const [showEvents, setShowEvents] = useState(false);

  useEffect(() => {
    if (isCollaborator) setKind('internal');
  }, [isCollaborator]);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['ticket', id] });
    void qc.invalidateQueries({ queryKey: ['tickets'] });
  };

  const patchTicket = useMutation({
    mutationFn: (patch: Record<string, unknown>) => api.patch(`/api/tickets/${id}`, patch),
    onSuccess: invalidate,
  });

  const sendMessage = useMutation({
    mutationFn: (payload: { body: string; kind: 'public' | 'internal' }) =>
      api.post(`/api/tickets/${id}/messages`, payload),
    onSuccess: () => {
      setBody('');
      invalidate();
    },
  });

  const followMut = useMutation({
    mutationFn: (follow: boolean) =>
      follow ? api.post(`/api/tickets/${id}/follow`) : api.delete(`/api/tickets/${id}/follow`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['ticket', id] }),
  });

  const applyMacro = useMutation({
    mutationFn: (macroId: string) =>
      api.post<MacroApplyResult>(`/api/tickets/${id}/macros/${macroId}`),
    onSuccess: (res) => {
      setBody((b) => (b.trim() ? `${b}\n\n${res.body}` : res.body));
      const sop =
        res.sop ?? (res.sopId && res.sopTitle ? { sopId: res.sopId, sopTitle: res.sopTitle } : null);
      if (sop) setAppliedSop(sop);
      invalidate(); // macro actions may have changed status/tags/team
    },
  });

  const extendSla = useMutation({
    mutationFn: (payload: { metric: SlaMetric; newDueAt: string; reason: string }) =>
      api.post(`/api/tickets/${id}/extend-sla`, payload),
    onSuccess: () => {
      setShowExtend(false);
      invalidate();
    },
  });

  const draftArticle = useMutation({
    mutationFn: () =>
      api.post<{ articleId: string }>('/api/kb/articles/from-ticket', { ticketId: id }),
    onSuccess: (res) => navigate(`/kb/${res.articleId}`),
  });

  if (isLoading) {
    return <div className="py-12 text-center text-sm text-gray-400">Loading ticket…</div>;
  }
  if (!data) {
    return (
      <div>
        <BackLink to="/inbox" label="Inbox" />
        <EmptyState title="Ticket not found" hint="It may have been merged or deleted." />
      </div>
    );
  }

  const { ticket, messages, events, followers, requesterLocalTime, sla, runs } = data;
  const following = me ? isFollowing(followers, me.id) : false;
  const staff = (staffData?.items ?? []).filter((u) => u.active);
  const teams = teamsData?.items ?? [];
  const hasPublicStaffReply = messages.some(
    (m) => m.kind === 'public' && m.author?.kind === 'staff'
  );
  const outsideHours =
    kind === 'public' &&
    body.trim() !== '' &&
    requesterLocalTime !== null &&
    !requesterLocalTime.isBusinessHoursGuess;
  const localTimeShort = requesterLocalTime?.label.split(' · ')[0] ?? '';

  const addTag = () => {
    const t = tagInput.trim();
    if (!t || ticket.tags.includes(t)) return;
    patchTicket.mutate({ tags: [...ticket.tags, t] });
    setTagInput('');
  };

  return (
    <div>
      <BackLink to="/inbox" label="Inbox" />

      {/* Header */}
      <div className="flex items-start justify-between gap-3 mt-2 mb-4">
        <div className="min-w-0">
          <h1 className="text-xl font-bold flex items-center gap-2 min-w-0">
            <span className="font-mono text-base text-gray-400 shrink-0">#{ticket.number}</span>
            <span className="truncate">{ticket.subject}</span>
          </h1>
          <div className="flex flex-wrap items-center gap-2 mt-1.5">
            <StatusBadge status={ticket.status} />
            <PriorityBadge priority={ticket.priority} />
            {ticket.slaBreached && <Badge color="red">SLA breached</Badge>}
            <span className="text-xs text-gray-400">
              via {ticket.channel} · created {timeAgo(ticket.createdAt)}
            </span>
          </div>
        </div>
        <div className="flex gap-2 shrink-0">
          <Button
            variant="secondary"
            onClick={() => followMut.mutate(!following)}
            disabled={followMut.isPending}
          >
            {following ? <BellOff size={14} /> : <Bell size={14} />}
            {following ? 'Unfollow' : 'Follow'}
          </Button>
          {canAct && (
            <Button variant="secondary" onClick={() => setShowMerge(true)}>
              <GitMerge size={14} />
              Merge
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-5 items-stretch lg:items-start">
        {/* Conversation */}
        <div className="flex-1 min-w-0 space-y-3">
          {messages.map((m) => (
            <MessageItem key={m.id} message={m} />
          ))}
          {messages.length === 0 && (
            <Card>
              <EmptyState title="No messages yet" />
            </Card>
          )}

          {/* Composer */}
          <Card className="p-4">
            <div className="flex items-center justify-between gap-2 mb-2">
              <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs font-medium">
                {!isCollaborator && (
                  <button
                    onClick={() => setKind('public')}
                    className={cx(
                      'px-3 py-1.5',
                      kind === 'public' ? 'bg-brand-soft text-brand' : 'text-gray-500 hover:bg-gray-50'
                    )}
                  >
                    Public reply
                  </button>
                )}
                <button
                  onClick={() => setKind('internal')}
                  className={cx(
                    'px-3 py-1.5 border-l border-gray-200 first:border-l-0',
                    kind === 'internal' ? 'bg-amber-100 text-amber-800' : 'text-gray-500 hover:bg-gray-50'
                  )}
                >
                  Internal note
                </button>
              </div>
              {canAct && (
                <MacroPicker onPick={(m) => applyMacro.mutate(m.id)} disabled={applyMacro.isPending} />
              )}
            </div>
            <Textarea
              rows={5}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={
                kind === 'public'
                  ? `Reply to ${ticket.requester.name}… (Markdown supported)`
                  : 'Internal note — never emailed to the customer'
              }
              className={kind === 'internal' ? 'bg-amber-50 border-amber-200' : undefined}
            />
            {outsideHours && (
              <div className="mt-2 flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-700">
                <Clock size={13} className="shrink-0" />
                <span>
                  It's {localTimeShort} for {ticket.requester.name} — consider scheduling.
                </span>
              </div>
            )}
            <div className="flex items-center justify-between mt-2">
              <p className="text-xs text-gray-400">
                {kind === 'public'
                  ? 'Emailed to the requester, signed with your name and title.'
                  : 'Visible to staff only.'}
              </p>
              <Button
                onClick={() => sendMessage.mutate({ body: body.trim(), kind })}
                disabled={body.trim() === '' || sendMessage.isPending}
              >
                <Send size={14} />
                {kind === 'public' ? 'Send reply' : 'Add note'}
              </Button>
            </div>
          </Card>
        </div>

        {/* Sidebar */}
        <aside className="w-full lg:w-80 shrink-0 space-y-3">
          {/* Requester */}
          <Card className="p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">
              Requester
            </h3>
            <p className="text-sm font-medium">{ticket.requester.name}</p>
            {ticket.requester.email && (
              <p className="text-xs text-gray-500 truncate">{ticket.requester.email}</p>
            )}
            {ticket.company && <p className="text-xs text-gray-500 mt-0.5">{ticket.company.name}</p>}
            {requesterLocalTime && (
              <div className="mt-2.5 rounded-lg border border-gray-100 bg-gray-50 px-2.5 py-2">
                <div className="flex items-center gap-1.5 text-sm">
                  <span
                    className={cx(
                      'h-2 w-2 rounded-full shrink-0',
                      requesterLocalTime.isDaytime ? 'bg-amber-400' : 'bg-indigo-500'
                    )}
                    title={requesterLocalTime.isDaytime ? 'Daytime' : 'Night'}
                  />
                  <span>{requesterLocalTime.label}</span>
                </div>
                {!requesterLocalTime.isBusinessHoursGuess && (
                  <p className="mt-1 flex items-center gap-1 text-xs text-amber-700">
                    <AlertTriangle size={12} className="shrink-0" /> Outside their hours
                  </p>
                )}
              </div>
            )}
          </Card>

          {/* Properties */}
          <Card className="p-4 space-y-3">
            <Field label="Status">
              <Select
                value={ticket.status}
                disabled={!canAct || patchTicket.isPending}
                onChange={(e) => patchTicket.mutate({ status: e.target.value })}
                className="w-full"
              >
                {ALL_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_META[s].label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Priority">
              <Select
                value={ticket.priority}
                disabled={!canAct || patchTicket.isPending}
                onChange={(e) => patchTicket.mutate({ priority: e.target.value })}
                className="w-full"
              >
                {ALL_PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {PRIORITY_META[p].label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Assignee">
              <Select
                value={ticket.assignee?.id ?? ''}
                disabled={!canAct || patchTicket.isPending}
                onChange={(e) => patchTicket.mutate({ assigneeId: e.target.value || null })}
                className="w-full"
              >
                <option value="">Unassigned</option>
                {staff.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Team">
              <Select
                value={ticket.teamId ?? ''}
                disabled={!canAct || patchTicket.isPending}
                onChange={(e) => patchTicket.mutate({ teamId: e.target.value || null })}
                className="w-full"
              >
                <option value="">No team</option>
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.emoji ? `${t.emoji} ` : ''}
                    {t.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Tags">
              <div className="flex flex-wrap gap-1.5">
                {ticket.tags.map((t) => (
                  <span
                    key={t}
                    className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-700"
                  >
                    {t}
                    {canAct && (
                      <button
                        onClick={() =>
                          patchTicket.mutate({ tags: ticket.tags.filter((x) => x !== t) })
                        }
                        className="text-gray-400 hover:text-gray-700"
                        title={`Remove ${t}`}
                      >
                        <X size={11} />
                      </button>
                    )}
                  </span>
                ))}
                {ticket.tags.length === 0 && <span className="text-xs text-gray-400">No tags</span>}
              </div>
              {canAct && (
                <Input
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addTag();
                    }
                  }}
                  placeholder="Add tag, press Enter"
                  className="mt-1.5"
                />
              )}
            </Field>
          </Card>

          {/* SLA */}
          <Card className="p-4">
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400">SLA</h3>
              {canAct && (
                <button
                  className="text-xs font-medium text-brand hover:underline"
                  onClick={() => setShowExtend(true)}
                >
                  Extend SLA
                </button>
              )}
            </div>
            <p className="text-xs text-gray-500 mb-2">{sla.policyName ?? 'No policy applied'}</p>
            <SlaRow label="First response" due={ticket.firstResponseDueAt} />
            <SlaRow label="Next response" due={ticket.nextResponseDueAt} />
            <SlaRow label="Resolution" due={ticket.resolutionDueAt} />
            {!ticket.firstResponseDueAt && !ticket.nextResponseDueAt && !ticket.resolutionDueAt && (
              <p className="text-xs text-gray-400">No active targets</p>
            )}
          </Card>

          {/* SOPs: macro-linked chip + runs attached to this ticket */}
          {(appliedSop !== null || runs.length > 0) && (
            <Card className="p-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">
                SOPs
              </h3>
              {appliedSop && (
                <Link
                  to={`/sops/${appliedSop.sopId}`}
                  className="inline-flex items-center gap-1.5 rounded-full bg-brand-soft px-2.5 py-1 text-xs font-medium text-brand mb-2"
                >
                  <BookOpen size={12} />
                  {appliedSop.sopTitle}
                </Link>
              )}
              {runs.map((r) => (
                <Link
                  key={r.id}
                  to={`/sops/${r.sopId}`}
                  className="flex items-center justify-between gap-2 py-1.5 text-sm text-gray-700 hover:text-brand"
                >
                  <span className="truncate">{r.sopTitle}</span>
                  <Badge
                    color={
                      r.status === 'completed' ? 'green' : r.status === 'cancelled' ? 'gray' : 'blue'
                    }
                  >
                    {r.status.replace(/_/g, ' ')}
                  </Badge>
                </Link>
              ))}
            </Card>
          )}

          {/* Content loop: turn this resolution into a KB draft */}
          {canAct && (
            <Card className="p-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">
                Knowledge base
              </h3>
              <Button
                variant="secondary"
                disabled={!hasPublicStaffReply || draftArticle.isPending}
                onClick={() => draftArticle.mutate()}
              >
                <FilePlus2 size={14} />
                Draft KB article from this ticket
              </Button>
              <p className="mt-1.5 text-xs text-gray-400">
                {hasPublicStaffReply
                  ? 'Creates an internal draft from the problem and its resolution.'
                  : 'Available after the first public staff reply.'}
              </p>
              {draftArticle.isError && (
                <p className="mt-1.5 text-xs text-red-600">
                  {draftArticle.error instanceof Error
                    ? draftArticle.error.message
                    : 'Could not create the draft.'}
                </p>
              )}
            </Card>
          )}

          {/* Events timeline */}
          <Card className="p-4">
            <button
              className="w-full flex items-center justify-between"
              onClick={() => setShowEvents((v) => !v)}
            >
              <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                Timeline ({events.length})
              </h3>
              <ChevronDown
                size={14}
                className={cx('text-gray-400 transition-transform', showEvents && 'rotate-180')}
              />
            </button>
            {showEvents && (
              <ul className="mt-2 space-y-1.5">
                {events.map((e) => (
                  <li key={e.id} className="flex items-start justify-between gap-2 text-xs text-gray-600">
                    <span className="min-w-0">{describeEvent(e)}</span>
                    <span className="shrink-0 text-gray-400">{timeAgo(e.createdAt)}</span>
                  </li>
                ))}
                {events.length === 0 && <li className="text-xs text-gray-400">No events yet</li>}
              </ul>
            )}
          </Card>
        </aside>
      </div>

      <ExtendSlaModal
        open={showExtend}
        onClose={() => setShowExtend(false)}
        dues={{
          first_response: ticket.firstResponseDueAt,
          next_response: ticket.nextResponseDueAt,
          resolution: ticket.resolutionDueAt,
        }}
        onSubmit={(p) => extendSla.mutate(p)}
        pending={extendSla.isPending}
      />
      <MergeModal
        open={showMerge}
        onClose={() => setShowMerge(false)}
        targetId={ticket.id}
        targetNumber={ticket.number}
      />
    </div>
  );
}

// ---------- Small in-file pieces ----------

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <span className="block text-xs text-gray-500 mb-1">{label}</span>
      {children}
    </div>
  );
}

function SlaRow({ label, due }: { label: string; due: string | null }) {
  if (!due) return null;
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-xs text-gray-500">{label}</span>
      <Countdown due={due} />
    </div>
  );
}

function Avatar({ author }: { author: TicketMessage['author'] }) {
  if (author?.avatarUrl) {
    return <img src={author.avatarUrl} alt="" className="h-7 w-7 rounded-full shrink-0" />;
  }
  const initial = (author?.name ?? '?').charAt(0).toUpperCase();
  return (
    <div className="h-7 w-7 shrink-0 rounded-full bg-gray-200 text-gray-600 flex items-center justify-center text-xs font-semibold">
      {initial}
    </div>
  );
}

function MessageItem({ message: m }: { message: TicketMessage }) {
  if (m.kind === 'system') {
    return (
      <div className="text-center text-xs text-gray-400 py-1">
        {m.body} · {timeAgo(m.createdAt)}
      </div>
    );
  }
  const internal = m.kind === 'internal';
  return (
    <div
      className={cx(
        'rounded-xl border p-4',
        internal ? 'bg-amber-50 border-amber-200' : 'bg-white border-gray-200 shadow-sm'
      )}
    >
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <Avatar author={m.author} />
          <div className="min-w-0">
            <p className="text-sm font-medium truncate">
              {m.author?.name ?? 'System'}
              {m.author?.kind === 'customer' && (
                <span className="ml-1.5 text-xs font-normal text-gray-400">Customer</span>
              )}
            </p>
            {m.author?.title && <p className="text-xs text-gray-500 truncate">{m.author.title}</p>}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {internal && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
              <Lock size={11} />
              Internal note
            </span>
          )}
          <span className="text-xs text-gray-400">{timeAgo(m.createdAt)}</span>
        </div>
      </div>
      <Markdown className="text-sm">{m.body}</Markdown>
    </div>
  );
}

/** Human line for an audit event; falls back to the raw type for unknown kinds. */
function describeEvent(e: TicketEvent): string {
  const d = (e.data ?? {}) as Record<string, unknown>;
  const s = (v: unknown) => (typeof v === 'string' ? v.replace(/_/g, ' ') : null);
  switch (e.type) {
    case 'status_changed':
      return `Status: ${s(d.from) ?? '?'} → ${s(d.to) ?? '?'}`;
    case 'assigned':
      return s(d.assigneeName) ? `Assigned to ${s(d.assigneeName)}` : 'Assignee changed';
    case 'priority_changed':
      return `Priority: ${s(d.from) ?? '?'} → ${s(d.to) ?? '?'}`;
    case 'sla_applied':
      return 'SLA policy applied';
    case 'sla_extended':
      return `SLA extended${s(d.metric) ? ` (${s(d.metric)})` : ''}`;
    case 'sla_breach':
      return `SLA breached${s(d.metric) ? ` (${s(d.metric)})` : ''}`;
    case 'sla_achieved':
      return `SLA met${s(d.metric) ? ` (${s(d.metric)})` : ''}`;
    case 'merged':
      return 'Ticket merged';
    default:
      return e.type.replace(/_/g, ' ');
  }
}
