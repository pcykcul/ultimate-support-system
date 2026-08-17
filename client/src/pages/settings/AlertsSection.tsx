/**
 * Alerts (admin): which automated staff notification emails this install sends,
 * plus the one customer-facing automation (the CSAT request on solve). Ticket
 * receipts and agent replies are core behavior and are not toggleable here.
 */
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Save } from 'lucide-react';
import { api } from '@/api/client';
import { Button, Card, cx } from '@/lib/ui';
import { ErrorNote, Loading } from './shared';

interface NotificationSettings {
  newTicket: { enabled: boolean; notifyTeam: boolean };
  customerReply: { enabled: boolean };
  assignment: { enabled: boolean };
  slaWarning: { enabled: boolean };
  slaBreach: { enabled: boolean };
  csatOnSolve: { enabled: boolean };
}

function Toggle({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        'relative h-5 w-9 shrink-0 rounded-full transition-colors',
        checked ? 'bg-brand' : 'bg-gray-300',
        disabled && 'opacity-40 cursor-not-allowed'
      )}
    >
      <span
        className={cx(
          'absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all',
          checked ? 'left-[18px]' : 'left-0.5'
        )}
      />
    </button>
  );
}

function AlertRow({
  title,
  description,
  checked,
  onChange,
  disabled,
  indent,
}: {
  title: string;
  description: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  indent?: boolean;
}) {
  return (
    <div className={cx('flex items-start justify-between gap-4 py-3', indent && 'pl-6')}>
      <div className="min-w-0">
        <p className={cx('text-sm font-medium', disabled ? 'text-gray-400' : 'text-gray-800')}>{title}</p>
        <p className={cx('text-xs mt-0.5', disabled ? 'text-gray-300' : 'text-gray-500')}>{description}</p>
      </div>
      <div className="pt-0.5">
        <Toggle checked={checked} onChange={onChange} disabled={disabled} label={title} />
      </div>
    </div>
  );
}

export default function AlertsSection() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['settings', 'notifications'],
    queryFn: () => api.get<NotificationSettings>('/api/settings/notifications'),
  });

  const [form, setForm] = useState<NotificationSettings | null>(null);

  useEffect(() => {
    if (data && form === null) setForm(data);
  }, [data, form]);

  const save = useMutation({
    mutationFn: (value: NotificationSettings) =>
      api.put<NotificationSettings>('/api/settings/notifications', value),
    onSuccess: (result) => {
      setForm(result);
      void qc.invalidateQueries({ queryKey: ['settings', 'notifications'] });
    },
  });

  if (isLoading || form === null) return <Loading />;

  const dirty = JSON.stringify(form) !== JSON.stringify(data);

  return (
    <div className="space-y-4 max-w-2xl">
      <Card className="p-4 bg-brand-soft/50 border-brand/20">
        <p className="text-sm text-gray-700">
          <span className="font-semibold">Staff alerts:</span> automated heads-up emails for your team.
          Ticket receipts and agent replies always send — they are the product, not an alert.
        </p>
      </Card>

      <Card className="p-5">
        <h2 className="text-sm font-semibold text-gray-800">Team alerts</h2>
        <div className="divide-y divide-gray-100">
          <AlertRow
            title="New ticket"
            description="Email the assigned team's members when a new ticket arrives."
            checked={form.newTicket.enabled}
            onChange={(v) => setForm({ ...form, newTicket: { ...form.newTicket, enabled: v } })}
          />
          <AlertRow
            indent
            title="No team? Email every agent"
            description="When a new ticket has no team, alert all acting staff instead."
            checked={form.newTicket.notifyTeam}
            disabled={!form.newTicket.enabled}
            onChange={(v) => setForm({ ...form, newTicket: { ...form.newTicket, notifyTeam: v } })}
          />
          <AlertRow
            title="Customer reply"
            description="Email the assignee when a customer replies to their ticket."
            checked={form.customerReply.enabled}
            onChange={(v) => setForm({ ...form, customerReply: { enabled: v } })}
          />
          <AlertRow
            title="Assignment"
            description="Email an agent when a ticket is assigned to them."
            checked={form.assignment.enabled}
            onChange={(v) => setForm({ ...form, assignment: { enabled: v } })}
          />
          <AlertRow
            title="SLA warning"
            description="Email the assignee when an SLA warning fires and no escalation rule already notifies them."
            checked={form.slaWarning.enabled}
            onChange={(v) => setForm({ ...form, slaWarning: { enabled: v } })}
          />
          <AlertRow
            title="SLA breach"
            description="Email the assignee when a ticket breaches its SLA and no escalation rule already covers it."
            checked={form.slaBreach.enabled}
            onChange={(v) => setForm({ ...form, slaBreach: { enabled: v } })}
          />
        </div>
      </Card>

      <Card className="p-5">
        <h2 className="text-sm font-semibold text-gray-800">Customer emails</h2>
        <div className="divide-y divide-gray-100">
          <AlertRow
            title="CSAT request on solve"
            description="Email the customer a short satisfaction survey when their ticket is solved — sent at most once per ticket."
            checked={form.csatOnSolve.enabled}
            onChange={(v) => setForm({ ...form, csatOnSolve: { enabled: v } })}
          />
        </div>
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => save.mutate(form)} disabled={save.isPending || !dirty}>
          <Save size={15} /> {save.isPending ? 'Saving…' : 'Save alert settings'}
        </Button>
        {save.isSuccess && !save.isPending && !dirty && <span className="text-sm text-green-600">Saved.</span>}
      </div>
      <ErrorNote error={save.error} />
    </div>
  );
}
