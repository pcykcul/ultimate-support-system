/**
 * My read-and-sign queue: pending SOP acknowledgments open a full read view
 * with a typed-name signature; signed ones stay below as the personal record.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, ListChecks, PenLine } from 'lucide-react';
import { api } from '@/api/client';
import { Badge, Button, Card, Countdown, EmptyState, Input, Modal, PageHeader, timeAgo } from '@/lib/ui';
import { Markdown } from '@/lib/markdown';
import { useMe } from '@/lib/session';
import {
  KindBadge,
  normalizeMyAcks,
  normalizeSopDetail,
  type MyAck,
  type MyAcksPayload,
} from './shared';

export default function MyAcknowledgmentsPage() {
  const { data: me } = useMe();
  const [reading, setReading] = useState<MyAck | null>(null);

  const { data: raw, isLoading } = useQuery({
    queryKey: ['sops', 'acks', 'mine'],
    queryFn: () => api.get<MyAcksPayload>('/api/sops/acknowledgments/mine'),
  });

  const { pending, done } = normalizeMyAcks(raw);

  return (
    <div>
      <div className="mb-2">
        <Link to="/sops" className="text-sm text-gray-500 hover:text-gray-800">
          ← SOPs &amp; Runbooks
        </Link>
      </div>
      <PageHeader
        title="My acknowledgments"
        subtitle="SOPs assigned to you for a signed read-through — your signature is the audit record."
      />

      {isLoading && <div className="py-12 text-center text-sm text-gray-400">Loading assignments…</div>}

      {!isLoading && (
        <>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
            Waiting for your signature
          </h2>
          <Card className="mb-6">
            {pending.length === 0 && (
              <EmptyState title="All signed" hint="Nothing is waiting for your acknowledgment. Nice." />
            )}
            {pending.map((a) => {
              const overdue = !!a.dueAt && new Date(a.dueAt).getTime() < Date.now();
              return (
                <button
                  key={a.assignmentId}
                  onClick={() => setReading(a)}
                  className="block w-full text-left px-4 py-3 border-b border-gray-100 last:border-b-0 hover:bg-gray-50 transition-colors"
                >
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <PenLine size={14} className={overdue ? 'text-red-500' : 'text-yellow-600'} />
                    <span className="text-sm font-medium text-gray-800 truncate max-w-full sm:flex-1 sm:min-w-[160px]">
                      {a.sopTitle}
                    </span>
                    {a.sopKind && <KindBadge kind={a.sopKind} />}
                    <Badge color="gray">v{a.sopVersion}</Badge>
                    {a.dueAt ? <Countdown due={a.dueAt} /> : <span className="text-xs text-gray-400">no due date</span>}
                    <span className="text-xs font-medium text-brand whitespace-nowrap">Read &amp; sign →</span>
                  </span>
                </button>
              );
            })}
          </Card>

          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Signed</h2>
          <Card>
            {done.length === 0 && (
              <EmptyState title="Nothing signed yet" hint="Acknowledged SOPs appear here with your signature." />
            )}
            {done.map((a) => (
              <div
                key={a.assignmentId}
                className="flex flex-wrap items-center gap-x-2 gap-y-1 px-4 py-3 border-b border-gray-100 last:border-b-0"
              >
                <CheckCircle2 size={14} className="text-green-600" />
                <span className="text-sm text-gray-700 truncate max-w-full sm:flex-1 sm:min-w-[160px]">{a.sopTitle}</span>
                <Badge color="gray">v{a.sopVersion}</Badge>
                <span className="text-xs text-gray-500">
                  signed{a.signatureName ? ` “${a.signatureName}”` : ''} {timeAgo(a.acknowledgedAt)}
                </span>
              </div>
            ))}
          </Card>
        </>
      )}

      <ReadAndSignModal ack={reading} myName={me?.name ?? ''} onClose={() => setReading(null)} />
    </div>
  );
}

function ReadAndSignModal({
  ack,
  myName,
  onClose,
}: {
  ack: MyAck | null;
  myName: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [signature, setSignature] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (ack) {
      setSignature('');
      setError(null);
    }
  }, [ack]);

  const { data: sop, isLoading } = useQuery({
    queryKey: ['sops', 'detail', ack?.sopId],
    queryFn: async () => normalizeSopDetail(await api.get(`/api/sops/${ack?.sopId}`)),
    enabled: !!ack?.sopId,
  });

  const acknowledge = useMutation({
    mutationFn: () =>
      api.post(`/api/sops/${ack?.sopId}/acknowledge`, { signatureName: signature.trim() }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['sops'] });
      onClose();
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'Could not record the acknowledgment'),
  });

  const steps = [...(sop?.steps ?? [])].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

  return (
    <Modal open={!!ack} onClose={onClose} title={ack ? `Read & sign · ${ack.sopTitle}` : ''} wide>
      {ack && (
        <div>
          <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-gray-500">
            {sop && <KindBadge kind={sop.kind} />}
            <Badge color="gray">v{ack.sopVersion}</Badge>
            {ack.dueAt && <Countdown due={ack.dueAt} />}
          </div>

          {isLoading && <p className="py-8 text-center text-sm text-gray-400">Loading the document…</p>}

          {sop && (
            <div className="rounded-xl border border-gray-200 p-4 max-h-[45vh] overflow-y-auto">
              {sop.body.trim() ? (
                <Markdown className="text-sm text-gray-800">{sop.body}</Markdown>
              ) : (
                <p className="text-sm text-gray-400">This SOP has no body text.</p>
              )}
              {sop.kind === 'runbook' && steps.length > 0 && (
                <div className="mt-4 border-t border-gray-100 pt-3">
                  <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400">
                    <ListChecks size={12} />
                    Checklist steps
                  </h3>
                  <ol className="space-y-1.5">
                    {steps.map((s, i) => (
                      <li key={s.id ?? i} className="text-sm text-gray-700">
                        <span className="text-gray-400 mr-1.5">{i + 1}.</span>
                        {s.title}
                        {s.roleHint && <span className="ml-1.5 text-xs text-gray-400">({s.roleHint})</span>}
                        {s.body && <p className="ml-5 text-xs text-gray-500">{s.body}</p>}
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </div>
          )}

          <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-4">
            <label className="block text-sm font-medium text-gray-800 mb-2">
              I have read and understood — sign your full name
            </label>
            <div className="flex flex-col sm:flex-row gap-2">
              <Input
                value={signature}
                onChange={(e) => setSignature(e.target.value)}
                placeholder={myName || 'Your full name'}
                className="sm:flex-1 !text-base !py-2"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && signature.trim().length >= 2) acknowledge.mutate();
                }}
              />
              <Button
                disabled={signature.trim().length < 2 || acknowledge.isPending}
                onClick={() => acknowledge.mutate()}
                className="!py-2"
              >
                <PenLine size={14} />
                {acknowledge.isPending ? 'Signing…' : `Acknowledge v${ack.sopVersion}`}
              </Button>
            </div>
            <p className="mt-2 text-xs text-gray-500">
              Your typed name and the timestamp are stored as the signed record for this version.
            </p>
            {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
          </div>
        </div>
      )}
    </Modal>
  );
}
