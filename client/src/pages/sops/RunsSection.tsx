/**
 * Runbook runs: active + past runs, "Start a run", and the run view —
 * a per-step checklist that records who did what, when (the audit trail).
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ExternalLink, PenLine, Play, X } from 'lucide-react';
import { api } from '@/api/client';
import { Badge, Button, Card, EmptyState, Input, Modal, cx, timeAgo } from '@/lib/ui';
import {
  RunStatusBadge,
  doneByLabel,
  normalizeRunDetail,
  startedByLabel,
  type SopFull,
  type SopRun,
} from './shared';

export default function RunsSection({ sop, canRun }: { sop: SopFull; canRun: boolean }) {
  const qc = useQueryClient();
  const [openRunId, setOpenRunId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runs = sop.runs ?? [];
  const active = runs.filter((r) => r.status === 'in_progress');
  const past = runs.filter((r) => r.status !== 'in_progress');

  const start = useMutation({
    mutationFn: () => api.post<{ run?: SopRun } & SopRun>(`/api/sops/${sop.id}/runs`, {}),
    onSuccess: (res) => {
      setError(null);
      const run = res.run ?? res;
      void qc.invalidateQueries({ queryKey: ['sops'] });
      setOpenRunId(run.id);
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'Could not start a run'),
  });

  return (
    <Card className="mt-4">
      <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 border-b border-gray-100">
        <Play size={14} className="text-gray-400" />
        <h2 className="text-sm font-semibold">Runs</h2>
        {active.length > 0 && <Badge color="blue">{active.length} active</Badge>}
        <span className="flex-1" />
        {canRun && (
          <Button variant="secondary" disabled={start.isPending} onClick={() => start.mutate()}>
            <Play size={14} />
            {start.isPending ? 'Starting…' : 'Start a run'}
          </Button>
        )}
      </div>
      {error && <p className="px-4 pt-2 text-xs text-red-600">{error}</p>}

      {runs.length === 0 && (
        <EmptyState
          title="No runs yet"
          hint="Start a run to walk through the checklist — every tick is recorded with who and when."
        />
      )}

      {[...active, ...past].map((r) => (
        <button
          key={r.id}
          onClick={() => setOpenRunId(r.id)}
          className="block w-full text-left px-4 py-2.5 border-b border-gray-100 last:border-b-0 hover:bg-gray-50 transition-colors"
        >
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <RunStatusBadge status={r.status} />
            <span className="text-xs text-gray-500">v{r.sopVersion}</span>
            {r.ticketId && (
              <Link
                to={`/tickets/${r.ticketId}`}
                onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center gap-1 text-xs text-brand hover:underline"
              >
                <ExternalLink size={12} />
                {r.ticket?.number ? `Ticket #${r.ticket.number}` : 'View ticket'}
              </Link>
            )}
            <span className="flex-1" />
            <span className="text-xs text-gray-400">
              {startedByLabel(r)} · started {timeAgo(r.startedAt)}
              {r.completedAt ? ` · finished ${timeAgo(r.completedAt)}` : ''}
            </span>
          </span>
        </button>
      ))}

      <RunDrawer sopTitle={sop.title} runId={openRunId} canRun={canRun} onClose={() => setOpenRunId(null)} />
    </Card>
  );
}

function RunDrawer({
  sopTitle,
  runId,
  canRun,
  onClose,
}: {
  sopTitle: string;
  runId: string | null;
  canRun: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { data: run, isLoading } = useQuery({
    queryKey: ['sops', 'run', runId],
    queryFn: async () => normalizeRunDetail(await api.get(`/api/sops/runs/${runId}`)),
    enabled: !!runId,
  });

  const refresh = () => {
    setError(null);
    void qc.invalidateQueries({ queryKey: ['sops', 'run', runId] });
    void qc.invalidateQueries({ queryKey: ['sops'] });
  };
  const fail = (e: unknown, fallback: string) =>
    setError(e instanceof Error ? e.message : fallback);

  const patchStep = useMutation({
    mutationFn: ({ stepRunId, done, note }: { stepRunId: string; done: boolean; note?: string }) =>
      api.patch(`/api/sops/runs/${runId}/steps/${stepRunId}`, { done, ...(note !== undefined ? { note } : {}) }),
    onSuccess: () => {
      refresh();
      setNoteFor(null);
    },
    onError: (e) => fail(e, 'Could not update the step'),
  });

  const finish = useMutation({
    mutationFn: (action: 'complete' | 'cancel') => api.post(`/api/sops/runs/${runId}/${action}`),
    onSuccess: refresh,
    onError: (e) => fail(e, 'Could not update the run'),
  });

  const steps = [...(run?.steps ?? [])].sort((a, b) => a.position - b.position);
  const doneCount = steps.filter((s) => s.done).length;
  const inProgress = run?.status === 'in_progress';
  const canTick = canRun && inProgress;

  return (
    <Modal open={!!runId} onClose={onClose} title={`Run · ${sopTitle}`} wide>
      {isLoading && <p className="py-8 text-center text-sm text-gray-400">Loading run…</p>}
      {!isLoading && !run && <p className="py-8 text-center text-sm text-gray-500">Run not found.</p>}
      {run && (
        <div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500 mb-3">
            <RunStatusBadge status={run.status} />
            <span>v{run.sopVersion}</span>
            <span>
              {startedByLabel(run)} · started {timeAgo(run.startedAt)}
            </span>
            {run.completedAt && <span>finished {timeAgo(run.completedAt)}</span>}
            {run.ticketId && (
              <Link to={`/tickets/${run.ticketId}`} className="inline-flex items-center gap-1 text-brand hover:underline">
                <ExternalLink size={12} />
                {run.ticket?.number ? `Ticket #${run.ticket.number}` : 'View ticket'}
              </Link>
            )}
          </div>

          <div className="rounded-xl border border-gray-200 divide-y divide-gray-100">
            {steps.length === 0 && (
              <p className="px-4 py-4 text-sm text-gray-400">This run has no steps.</p>
            )}
            {steps.map((s) => {
              const who = doneByLabel(s);
              return (
                <div key={s.id} className="flex items-start gap-3 px-3.5 py-2.5">
                  <input
                    type="checkbox"
                    checked={s.done}
                    disabled={!canTick || patchStep.isPending}
                    onChange={() => patchStep.mutate({ stepRunId: s.id, done: !s.done })}
                    className="mt-1 h-4 w-4 shrink-0 accent-brand cursor-pointer disabled:cursor-not-allowed"
                    aria-label={`Mark "${s.title}" ${s.done ? 'not done' : 'done'}`}
                  />
                  <div className="flex-1 min-w-0">
                    <p className={cx('text-sm', s.done ? 'text-gray-500' : 'text-gray-800')}>
                      <span className="text-gray-400 mr-1.5">{s.position}.</span>
                      {s.title}
                    </p>
                    {s.done && (
                      <p className="mt-0.5 inline-flex items-center gap-1 text-xs text-green-700">
                        <Check size={12} />
                        {who ? `${who} · ` : ''}
                        {s.doneAt ? timeAgo(s.doneAt) : 'done'}
                      </p>
                    )}
                    {noteFor === s.id ? (
                      <div className="mt-1.5 flex flex-wrap gap-2">
                        <Input
                          autoFocus
                          value={noteDraft}
                          onChange={(e) => setNoteDraft(e.target.value)}
                          placeholder="Note — what happened on this step?"
                          className="flex-1 min-w-[160px]"
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              patchStep.mutate({ stepRunId: s.id, done: s.done, note: noteDraft.trim() });
                            }
                            if (e.key === 'Escape') setNoteFor(null);
                          }}
                        />
                        <Button
                          variant="secondary"
                          disabled={patchStep.isPending}
                          onClick={() => patchStep.mutate({ stepRunId: s.id, done: s.done, note: noteDraft.trim() })}
                        >
                          Save note
                        </Button>
                      </div>
                    ) : (
                      <>
                        {s.note && <p className="mt-0.5 text-xs text-gray-500 italic">“{s.note}”</p>}
                        {canTick && (
                          <button
                            type="button"
                            onClick={() => {
                              setNoteFor(s.id);
                              setNoteDraft(s.note ?? '');
                            }}
                            className="mt-0.5 inline-flex items-center gap-1 text-xs text-gray-400 hover:text-gray-700"
                          >
                            <PenLine size={11} />
                            {s.note ? 'Edit note' : 'Add note'}
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {error && <p className="mt-2 text-xs text-red-600">{error}</p>}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-xs text-gray-500">
              {doneCount}/{steps.length} steps done
            </span>
            <span className="flex-1" />
            {canTick && (
              <>
                <Button
                  variant="secondary"
                  disabled={finish.isPending}
                  onClick={() => {
                    if (window.confirm('Cancel this run? Progress stays on record.')) finish.mutate('cancel');
                  }}
                >
                  <X size={14} />
                  Cancel run
                </Button>
                <Button
                  disabled={finish.isPending}
                  onClick={() => {
                    if (
                      doneCount === steps.length ||
                      window.confirm('Not every step is ticked. Complete the run anyway?')
                    ) {
                      finish.mutate('complete');
                    }
                  }}
                >
                  <Check size={14} />
                  Complete run
                </Button>
              </>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
