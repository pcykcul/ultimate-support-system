/** "Extend SLA" modal: pick a metric, a new due datetime, and a reason (audited server-side). */
import { useEffect, useState } from 'react';
import { Button, Input, Modal, Select, Textarea } from '@/lib/ui';
import type { SlaMetric } from './shared';

const METRICS: { value: SlaMetric; label: string }[] = [
  { value: 'first_response', label: 'First response' },
  { value: 'next_response', label: 'Next response' },
  { value: 'periodic_update', label: 'Periodic update' },
  { value: 'resolution', label: 'Resolution' },
];

/** ISO instant → value for <input type="datetime-local"> in the agent's local zone. */
function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function ExtendSlaModal({
  open,
  onClose,
  dues,
  onSubmit,
  pending,
}: {
  open: boolean;
  onClose: () => void;
  /** Current due per metric, used to prefill the datetime input. */
  dues: Partial<Record<SlaMetric, string | null>>;
  onSubmit: (payload: { metric: SlaMetric; newDueAt: string; reason: string }) => void;
  pending: boolean;
}) {
  const [metric, setMetric] = useState<SlaMetric>('first_response');
  const [dueLocal, setDueLocal] = useState('');
  const [reason, setReason] = useState('');

  // Prefill from the metric's current due when opening or switching metric.
  useEffect(() => {
    if (open) setDueLocal(toLocalInput(dues[metric]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, metric]);

  const valid = dueLocal !== '' && reason.trim() !== '';

  return (
    <Modal open={open} onClose={onClose} title="Extend SLA">
      <div className="space-y-3">
        <label className="block">
          <span className="block text-xs text-gray-500 mb-1">Metric</span>
          <Select value={metric} onChange={(e) => setMetric(e.target.value as SlaMetric)} className="w-full">
            {METRICS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </Select>
        </label>
        <label className="block">
          <span className="block text-xs text-gray-500 mb-1">New due (your local time)</span>
          <Input type="datetime-local" value={dueLocal} onChange={(e) => setDueLocal(e.target.value)} />
        </label>
        <label className="block">
          <span className="block text-xs text-gray-500 mb-1">Reason</span>
          <Textarea
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why is the deadline moving? Recorded in the ticket timeline."
          />
        </label>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!valid || pending}
            onClick={() =>
              onSubmit({ metric, newDueAt: new Date(dueLocal).toISOString(), reason: reason.trim() })
            }
          >
            {pending ? 'Extending…' : 'Extend SLA'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
