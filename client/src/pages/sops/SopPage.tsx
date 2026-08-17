/**
 * SOP editor + runner: markdown body with live preview, runbook step editor,
 * auto-run triggers, publish/verify/rollback workflow, runs with audit trail,
 * and the supervisor read-and-sign coverage dashboard.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, History, PenLine, ShieldCheck, Undo2, UploadCloud, Zap } from 'lucide-react';
import { api } from '@/api/client';
import { BackLink, Badge, Button, Card, Input, Modal, Select, Textarea, timeAgo } from '@/lib/ui';
import { Markdown } from '@/lib/markdown';
import { useMe } from '@/lib/session';
import AssignmentsSection from './AssignmentsSection';
import RunsSection from './RunsSection';
import StepsEditor from './StepsEditor';
import {
  KIND_META,
  KindBadge,
  StatusBadge,
  TICKET_PRIORITIES,
  canAct,
  draftFromStep,
  draftsEqual,
  isStale,
  isSupervisor,
  normalizeSopDetail,
  stepsPayload,
  type SopFull,
  type SopRevisionMeta,
  type SopStepDraft,
} from './shared';

interface StaffUser {
  id: string;
  name: string;
}

interface Team {
  id: string;
  name: string;
  emoji: string | null;
}

export default function SopPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const { data: me } = useMe();
  const editable = canAct(me);
  const supervisor = isSupervisor(me);

  const { data: sop, isLoading, error } = useQuery({
    queryKey: ['sops', 'detail', id],
    queryFn: async () => normalizeSopDetail(await api.get(`/api/sops/${id}`)),
    enabled: !!id,
  });

  const { data: staffData } = useQuery({
    queryKey: ['users', 'staff'],
    queryFn: () => api.get<{ items: StaffUser[] }>('/api/users?kind=staff'),
  });
  const { data: teamData } = useQuery({
    queryKey: ['users', 'teams'],
    queryFn: () => api.get<{ items: Team[] }>('/api/users/teams'),
  });

  // ----- editable form state, hydrated once per sop id (and after rollback) -----
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [ownerId, setOwnerId] = useState('');
  const [teamId, setTeamId] = useState('');
  const [verifyDays, setVerifyDays] = useState('');
  const [requiresAck, setRequiresAck] = useState(false);
  const [trigSlaBreach, setTrigSlaBreach] = useState(false);
  const [trigPriority, setTrigPriority] = useState('');
  const [trigTags, setTrigTags] = useState('');
  const [steps, setSteps] = useState<SopStepDraft[]>([]);
  const [baseSteps, setBaseSteps] = useState<SopStepDraft[]>([]);
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [viewRev, setViewRev] = useState<SopRevisionMeta | null>(null);

  useEffect(() => {
    if (sop && sop.id !== loadedId) {
      setTitle(sop.title);
      setBody(sop.body);
      setOwnerId(sop.ownerId ?? sop.owner?.id ?? '');
      setTeamId(sop.teamId ?? '');
      setVerifyDays(sop.verifyIntervalDays != null ? String(sop.verifyIntervalDays) : '');
      setRequiresAck(sop.requiresAcknowledgment);
      setTrigSlaBreach(!!sop.triggers?.onSlaBreach);
      setTrigPriority(sop.triggers?.onPriority ?? '');
      setTrigTags((sop.triggers?.onTags ?? []).join(', '));
      const drafts = [...(sop.steps ?? [])]
        .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
        .map(draftFromStep);
      setSteps(drafts);
      setBaseSteps(drafts);
      setDirty(false);
      setLoadedId(sop.id);
    }
  }, [sop, loadedId]);

  const touch = <T,>(setter: (v: T) => void) => (v: T) => {
    setter(v);
    setDirty(true);
    setSaved(false);
  };

  const stepsDirty = !draftsEqual(steps, baseSteps);
  const anyDirty = dirty || stepsDirty;

  const save = useMutation({
    mutationFn: () => {
      if (!sop) return Promise.reject(new Error('Not loaded'));
      const payload: Record<string, unknown> = {};
      if (title.trim() !== sop.title) payload.title = title.trim() || 'Untitled';
      if (body !== sop.body) payload.body = body;
      if (ownerId !== (sop.ownerId ?? sop.owner?.id ?? '')) payload.ownerId = ownerId || null;
      if (teamId !== (sop.teamId ?? '')) payload.teamId = teamId || null;
      const days = verifyDays.trim() === '' ? null : Math.max(1, Number(verifyDays));
      if (days !== (sop.verifyIntervalDays ?? null)) payload.verifyIntervalDays = days;
      if (requiresAck !== sop.requiresAcknowledgment) payload.requiresAcknowledgment = requiresAck;
      if (sop.kind === 'runbook') {
        const tags = trigTags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean);
        const nextTriggers = {
          onSlaBreach: trigSlaBreach,
          onPriority: trigPriority || null,
          onTags: tags,
        };
        const baseTriggers = {
          onSlaBreach: !!sop.triggers?.onSlaBreach,
          onPriority: sop.triggers?.onPriority ?? null,
          onTags: sop.triggers?.onTags ?? [],
        };
        if (JSON.stringify(nextTriggers) !== JSON.stringify(baseTriggers)) payload.triggers = nextTriggers;
        if (stepsDirty) payload.steps = stepsPayload(steps);
      }
      return api.patch(`/api/sops/${id}`, payload);
    },
    onSuccess: () => {
      setDirty(false);
      setSaved(true);
      setActionError(null);
      window.setTimeout(() => setSaved(false), 2500);
      setBaseSteps(steps);
      void qc.invalidateQueries({ queryKey: ['sops'] });
    },
    onError: (e) => setActionError(e instanceof Error ? e.message : 'Save failed'),
  });

  const workflow = useMutation({
    mutationFn: (action: 'publish' | 'verify') => api.post(`/api/sops/${id}/${action}`),
    onSuccess: () => {
      setActionError(null);
      void qc.invalidateQueries({ queryKey: ['sops'] });
    },
    onError: (e) => setActionError(e instanceof Error ? e.message : 'Action failed'),
  });

  const rollback = useMutation({
    mutationFn: (version: number) => api.post(`/api/sops/${id}/rollback`, { version }),
    onSuccess: () => {
      setActionError(null);
      setViewRev(null);
      setHistoryOpen(false);
      setLoadedId(null); // rehydrate the form from the restored content
      void qc.invalidateQueries({ queryKey: ['sops'] });
    },
    onError: (e) => setActionError(e instanceof Error ? e.message : 'Rollback failed'),
  });

  const stale = useMemo(() => (sop ? isStale(sop) : false), [sop]);
  const isOwner = !!me && !!sop && (sop.ownerId ?? sop.owner?.id) === me.id;
  const canVerify = editable && (supervisor || isOwner);
  const revisions = useMemo(
    () => [...(sop?.revisions ?? [])].sort((a, b) => b.version - a.version),
    [sop]
  );
  const needsMySignature = !!sop?.myAssignment && !sop.myAssignment.acknowledgedAt;

  if (isLoading) return <div className="py-16 text-center text-gray-400">Loading SOP…</div>;
  if (error || !sop) {
    return (
      <div className="py-16 text-center text-gray-500">
        <p className="font-medium">SOP not found</p>
        <div className="mt-3">
          <BackLink to="/sops" label="Back to SOPs" />
        </div>
      </div>
    );
  }

  return (
    <div>
      <BackLink to="/sops" label="SOPs & Runbooks" />

      {stale && (
        <div className="mt-3 flex flex-wrap items-center gap-2.5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <AlertTriangle size={16} className="shrink-0" />
          <span className="flex-1 min-w-[200px]">
            Overdue for verification
            {sop.verifiedAt ? ` — last verified ${timeAgo(sop.verifiedAt)}` : ' — never verified'}
            {sop.verifyIntervalDays ? ` (interval: every ${sop.verifyIntervalDays} days).` : '.'}{' '}
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

      {needsMySignature && (
        <Link
          to="/sops/acknowledgments"
          className="mt-3 flex flex-wrap items-center gap-2.5 rounded-xl border border-yellow-300 bg-yellow-50 px-4 py-3 text-sm text-yellow-900 hover:bg-yellow-100 transition-colors"
        >
          <PenLine size={16} className="shrink-0" />
          <span className="flex-1 min-w-[200px]">
            You are assigned to read and sign v{sop.myAssignment?.sopVersion} of this SOP.
          </span>
          <span className="font-medium whitespace-nowrap">Sign it →</span>
        </Link>
      )}

      {/* Title + workflow */}
      <div className="mt-3 mb-4 flex flex-wrap items-center gap-2">
        <Input
          value={title}
          onChange={(e) => touch(setTitle)(e.target.value)}
          disabled={!editable}
          placeholder="SOP title"
          className="flex-1 min-w-[220px] !text-lg font-semibold"
        />
        <KindBadge kind={sop.kind} />
        <StatusBadge status={sop.status} />
        <Badge color="gray">v{sop.version}</Badge>
        {editable && (
          <>
            <Button disabled={!anyDirty || save.isPending} onClick={() => save.mutate()}>
              {save.isPending ? 'Saving…' : 'Save'}
            </Button>
            {saved && (
              <span className="inline-flex items-center gap-1 text-sm text-green-700">
                <Check size={14} /> Saved
              </span>
            )}
            {sop.status !== 'published' && supervisor && (
              <Button variant="secondary" disabled={workflow.isPending} onClick={() => workflow.mutate('publish')}>
                <UploadCloud size={14} />
                Publish
              </Button>
            )}
            {sop.status !== 'published' && !supervisor && (
              <span className="text-xs text-gray-400">A supervisor publishes this</span>
            )}
            {canVerify && !stale && (
              <Button variant="secondary" disabled={workflow.isPending} onClick={() => workflow.mutate('verify')}>
                <ShieldCheck size={14} />
                Verify now
              </Button>
            )}
            <Button variant="ghost" onClick={() => setHistoryOpen(true)}>
              <History size={14} />
              History ({revisions.length})
            </Button>
          </>
        )}
      </div>
      {actionError && <p className="mb-3 text-sm text-red-600">{actionError}</p>}

      <div className="flex flex-col lg:flex-row gap-4 items-start">
        {/* Editor + live preview + runbook sections */}
        <div className="flex-1 min-w-0 w-full">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <Textarea
              value={body}
              onChange={(e) => touch(setBody)(e.target.value)}
              disabled={!editable}
              rows={sop.kind === 'runbook' ? 14 : 24}
              placeholder={
                sop.kind === 'runbook'
                  ? 'Intro / context for this runbook, in markdown…'
                  : 'Write the reference document in markdown…'
              }
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

          {sop.kind === 'runbook' && (
            <StepsEditor
              steps={steps}
              onChange={(s) => {
                setSteps(s);
                setSaved(false);
              }}
              disabled={!editable}
            />
          )}

          {sop.kind === 'runbook' && <RunsSection sop={sop} canRun={editable} />}

          {supervisor && <AssignmentsSection sop={sop} />}
        </div>

        {/* Metadata sidebar */}
        <aside className="w-full lg:w-64 shrink-0 space-y-4">
          <Card className="p-4 space-y-3">
            <SidebarField label="Kind">
              <div>
                <KindBadge kind={sop.kind} />
                <p className="mt-1 text-[11px] text-gray-400">{KIND_META[sop.kind].hint}</p>
              </div>
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
            <SidebarField label="Team">
              <Select
                value={teamId}
                onChange={(e) => touch(setTeamId)(e.target.value)}
                disabled={!editable}
                className="w-full"
              >
                <option value="">No team</option>
                {(teamData?.items ?? []).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.emoji ? `${t.emoji} ` : ''}
                    {t.name}
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
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={requiresAck}
                disabled={!editable}
                onChange={(e) => touch(setRequiresAck)(e.target.checked)}
                className="mt-0.5 accent-brand"
              />
              <span>
                <span className="block text-sm text-gray-700">Requires acknowledgment</span>
                <span className="block text-[11px] text-gray-400">
                  Assignees must read it and sign with their full name.
                </span>
              </span>
            </label>
            {anyDirty && <p className="text-[11px] text-yellow-700">Unsaved changes</p>}
          </Card>

          {sop.kind === 'runbook' && (
            <Card className="p-4 space-y-3">
              <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400">
                <Zap size={12} />
                Auto-run triggers
              </h2>
              <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={trigSlaBreach}
                  disabled={!editable}
                  onChange={(e) => touch(setTrigSlaBreach)(e.target.checked)}
                  className="accent-brand"
                />
                On SLA breach
              </label>
              <SidebarField label="On priority">
                <Select
                  value={trigPriority}
                  onChange={(e) => touch(setTrigPriority)(e.target.value)}
                  disabled={!editable}
                  className="w-full"
                >
                  <option value="">Never</option>
                  {TICKET_PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </Select>
              </SidebarField>
              <SidebarField label="On tags (comma-separated)">
                <Input
                  value={trigTags}
                  onChange={(e) => touch(setTrigTags)(e.target.value)}
                  disabled={!editable}
                  placeholder="outage, refund"
                />
              </SidebarField>
              <p className="text-[11px] text-gray-400">
                Runs start automatically when a ticket matches, and attach to that ticket.
              </p>
            </Card>
          )}

          <Card className="p-4 text-sm space-y-1.5">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-1">About</h2>
            <p className="flex justify-between text-gray-600">
              <span>Version</span>
              <span>v{sop.version}</span>
            </p>
            <p className="flex justify-between text-gray-600">
              <span>Verified</span>
              <span>{sop.verifiedAt ? timeAgo(sop.verifiedAt) : 'never'}</span>
            </p>
            <p className="flex justify-between text-gray-600">
              <span>Updated</span>
              <span>{timeAgo(sop.updatedAt)}</span>
            </p>
            <p className="flex justify-between text-gray-600 items-center">
              <span>Slug</span>
              <Badge color="gray" className="font-mono !font-normal max-w-[9rem] truncate">
                {sop.slug}
              </Badge>
            </p>
          </Card>
        </aside>
      </div>

      {/* Revisions drawer */}
      <Modal open={historyOpen} onClose={() => setHistoryOpen(false)} title="Revision history" wide>
        {revisions.length === 0 && (
          <p className="py-6 text-center text-sm text-gray-400">No revisions yet — saving content creates one.</p>
        )}
        <div className="divide-y divide-gray-100">
          {revisions.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center gap-2 py-2.5">
              <Badge color={r.version === sop.version ? 'brand' : 'gray'}>v{r.version}</Badge>
              <div className="flex-1 min-w-[160px]">
                <p className="text-sm text-gray-800 truncate">{r.title}</p>
                <p className="text-xs text-gray-400 truncate">
                  {r.authorName ?? 'Unknown'} · {timeAgo(r.createdAt)}
                  {r.note ? ` · ${r.note}` : ''}
                </p>
              </div>
              {r.body !== undefined && (
                <Button variant="ghost" className="!px-2" onClick={() => setViewRev(r)}>
                  View
                </Button>
              )}
              {editable && r.version !== sop.version && (
                <Button
                  variant="ghost"
                  className="!px-2"
                  disabled={rollback.isPending}
                  onClick={() => {
                    if (window.confirm(`Roll back to v${r.version}? The current content is kept in history.`)) {
                      rollback.mutate(r.version);
                    }
                  }}
                >
                  <Undo2 size={14} />
                  Rollback
                </Button>
              )}
            </div>
          ))}
        </div>
      </Modal>

      {/* Revision body viewer (when the server includes bodies) */}
      <Modal open={!!viewRev} onClose={() => setViewRev(null)} title={viewRev ? `v${viewRev.version} · ${viewRev.title}` : ''} wide>
        {viewRev?.body !== undefined && (
          <div className="rounded-lg border border-gray-200 p-4 max-h-[55vh] overflow-y-auto">
            <Markdown className="text-sm text-gray-800">{viewRev.body}</Markdown>
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
