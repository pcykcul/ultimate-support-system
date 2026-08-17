/**
 * SLA Policies (supervisor+): ordered policy cards (first match wins) with
 * reorder, and a full editor: conditions, per-metric/per-priority targets grid
 * (blank cell = no target) and escalation steps.
 */
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from 'lucide-react';
import { api } from '@/api/client';
import { useMe } from '@/lib/session';
import { Badge, Button, Card, EmptyState, Input, Modal, Select, Textarea } from '@/lib/ui';
import {
  CHANNELS,
  CheckboxList,
  ErrorNote,
  Field,
  fromCsv,
  labelize,
  Loading,
  PRIORITIES,
  SLA_METRICS,
  toCsv,
  type SlaPolicy,
  type TicketPriority,
  useSchedules,
  useSlaPolicies,
} from './shared';

interface TargetCell {
  minutes: string; // blank = no target
  business: boolean;
}

interface EscalationRow {
  metric: string;
  level: string;
  minutesOffset: string;
  notifyAssignee: boolean;
  notifySupervisors: boolean;
}

interface EditorState {
  name: string;
  description: string;
  enabled: boolean;
  scheduleId: string;
  priorities: string[];
  channels: string[];
  companyTiers: string;
  tags: string;
  targets: Record<string, TargetCell>; // key: `${metric}|${priority}`
  escalations: EscalationRow[];
}

const cellKey = (metric: string, priority: string) => `${metric}|${priority}`;

function stateFromPolicy(p: SlaPolicy | null): EditorState {
  const targets: Record<string, TargetCell> = {};
  for (const t of p?.targets ?? []) {
    targets[cellKey(t.metric, t.priority)] = { minutes: String(t.minutes), business: t.useBusinessHours };
  }
  return {
    name: p?.name ?? '',
    description: p?.description ?? '',
    enabled: p?.enabled ?? true,
    scheduleId: p?.scheduleId ?? '',
    priorities: p?.conditions.priorities ?? [],
    channels: p?.conditions.channels ?? [],
    companyTiers: toCsv(p?.conditions.companyTiers),
    tags: toCsv(p?.conditions.tags),
    targets,
    escalations: (p?.escalations ?? []).map((e) => ({
      metric: e.metric,
      level: String(e.level),
      minutesOffset: String(e.minutesOffset),
      notifyAssignee: e.notifyAssignee,
      notifySupervisors: e.notifySupervisors,
    })),
  };
}

function payloadFromState(s: EditorState) {
  const targets = SLA_METRICS.flatMap((metric) =>
    PRIORITIES.flatMap((priority) => {
      const cell = s.targets[cellKey(metric, priority)];
      const minutes = cell ? Number(cell.minutes) : NaN;
      return cell && cell.minutes.trim() !== '' && Number.isFinite(minutes) && minutes > 0
        ? [{ metric, priority, minutes, useBusinessHours: cell.business }]
        : [];
    })
  );
  const companyTiers = fromCsv(s.companyTiers);
  const tags = fromCsv(s.tags);
  return {
    name: s.name.trim(),
    description: s.description.trim() || undefined,
    enabled: s.enabled,
    scheduleId: s.scheduleId || null,
    conditions: {
      ...(s.priorities.length ? { priorities: s.priorities } : {}),
      ...(s.channels.length ? { channels: s.channels } : {}),
      ...(companyTiers.length ? { companyTiers } : {}),
      ...(tags.length ? { tags } : {}),
    },
    targets,
    escalations: s.escalations.map((e) => ({
      metric: e.metric,
      level: Number(e.level) || 1,
      minutesOffset: Number(e.minutesOffset) || 0,
      notifyAssignee: e.notifyAssignee,
      notifySupervisors: e.notifySupervisors,
    })),
  };
}

export default function SlaPoliciesSection() {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const isAdmin = me?.role === 'admin';
  const { data, isLoading } = useSlaPolicies();
  const policies = [...(data?.items ?? [])].sort((a, b) => a.position - b.position);
  const [editing, setEditing] = useState<SlaPolicy | null>(null);
  const [creating, setCreating] = useState(false);

  const invalidate = () => void qc.invalidateQueries({ queryKey: ['settings', 'sla-policies'] });

  const reorder = useMutation({
    mutationFn: (ids: string[]) => api.post('/api/sla/policies/reorder', { ids }),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/api/sla/policies/${id}`),
    onSuccess: invalidate,
  });

  const move = (index: number, dir: -1 | 1) => {
    const ids = policies.map((p) => p.id);
    const target = index + dir;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    reorder.mutate(ids);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">
          Ordered — the first matching enabled policy applies when a company has none attached.
        </p>
        <Button onClick={() => setCreating(true)}>
          <Plus size={15} /> New policy
        </Button>
      </div>

      {isLoading ? (
        <Loading />
      ) : policies.length === 0 ? (
        <Card>
          <EmptyState
            title="No SLA policies"
            hint="Targets power the response-time promise customers see — set one up."
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {policies.map((p, i) => (
            <Card key={p.id} className="p-4 flex items-center gap-3">
              <div className="flex flex-col gap-0.5">
                <button
                  className="text-gray-300 hover:text-gray-600 disabled:opacity-30"
                  disabled={i === 0 || reorder.isPending}
                  onClick={() => move(i, -1)}
                  title="Move up"
                >
                  <ArrowUp size={15} />
                </button>
                <button
                  className="text-gray-300 hover:text-gray-600 disabled:opacity-30"
                  disabled={i === policies.length - 1 || reorder.isPending}
                  onClick={() => move(i, 1)}
                  title="Move down"
                >
                  <ArrowDown size={15} />
                </button>
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium flex items-center gap-2">
                  {p.name}
                  <Badge color={p.enabled ? 'green' : 'gray'}>{p.enabled ? 'enabled' : 'disabled'}</Badge>
                </p>
                <p className="text-xs text-gray-500 truncate">
                  {p.description || `${p.targets.length} targets · ${p.escalations.length} escalations`}
                </p>
              </div>
              <Button variant="secondary" onClick={() => setEditing(p)}>
                <Pencil size={14} /> Edit
              </Button>
              {isAdmin && (
                <Button
                  variant="ghost"
                  title="Delete policy"
                  onClick={() => {
                    if (window.confirm(`Delete policy "${p.name}"?`)) remove.mutate(p.id);
                  }}
                >
                  <Trash2 size={15} />
                </Button>
              )}
            </Card>
          ))}
        </div>
      )}
      <ErrorNote error={reorder.error ?? remove.error} />

      {(creating || editing) && (
        <PolicyEditorModal
          policy={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function PolicyEditorModal({ policy, onClose }: { policy: SlaPolicy | null; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: schedulesData } = useSchedules();
  const schedules = schedulesData?.items ?? [];
  const [s, setS] = useState<EditorState>(() => stateFromPolicy(policy));
  const set = (patch: Partial<EditorState>) => setS((prev) => ({ ...prev, ...patch }));

  const save = useMutation({
    mutationFn: () =>
      policy
        ? api.patch(`/api/sla/policies/${policy.id}`, payloadFromState(s))
        : api.post('/api/sla/policies', payloadFromState(s)),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['settings', 'sla-policies'] });
      onClose();
    },
  });

  const setCell = (metric: string, priority: TicketPriority, patch: Partial<TargetCell>) => {
    const key = cellKey(metric, priority);
    const cell = s.targets[key] ?? { minutes: '', business: true };
    set({ targets: { ...s.targets, [key]: { ...cell, ...patch } } });
  };

  const setEscalation = (i: number, patch: Partial<EscalationRow>) =>
    set({ escalations: s.escalations.map((e, idx) => (idx === i ? { ...e, ...patch } : e)) });

  return (
    <Modal open onClose={onClose} title={policy ? `Edit ${policy.name}` : 'New SLA policy'} wide>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Name">
            <Input value={s.name} onChange={(e) => set({ name: e.target.value })} placeholder="Standard support" />
          </Field>
          <Field label="Schedule" hint="Business-hours targets count time on this schedule">
            <Select value={s.scheduleId} onChange={(e) => set({ scheduleId: e.target.value })} className="w-full">
              <option value="">Default schedule</option>
              {schedules.map((sch) => (
                <option key={sch.id} value={sch.id}>
                  {sch.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Description">
          <Textarea rows={2} value={s.description} onChange={(e) => set({ description: e.target.value })} />
        </Field>
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={s.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
          Enabled
        </label>

        <div>
          <h3 className="text-sm font-semibold text-gray-800 mb-2">Conditions</h3>
          <p className="text-xs text-gray-400 mb-2">All conditions are ANDed; leave everything empty to match all tickets.</p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Priorities">
              <CheckboxList
                options={PRIORITIES.map((p) => ({ value: p, label: p }))}
                value={s.priorities}
                onChange={(priorities) => set({ priorities })}
              />
            </Field>
            <Field label="Channels">
              <CheckboxList
                options={CHANNELS.map((c) => ({ value: c, label: c }))}
                value={s.channels}
                onChange={(channels) => set({ channels })}
              />
            </Field>
            <Field label="Company tiers (comma-separated)">
              <Input
                value={s.companyTiers}
                onChange={(e) => set({ companyTiers: e.target.value })}
                placeholder="enterprise, premium"
              />
            </Field>
            <Field label="Tags (comma-separated)">
              <Input value={s.tags} onChange={(e) => set({ tags: e.target.value })} placeholder="vip, outage" />
            </Field>
          </div>
        </div>

        <div>
          <h3 className="text-sm font-semibold text-gray-800 mb-2">Targets</h3>
          <p className="text-xs text-gray-400 mb-2">
            Minutes to meet each metric per priority. Blank = no target. "BH" counts business hours only.
          </p>
          <div className="overflow-x-auto">
            <table className="text-sm">
              <thead>
                <tr>
                  <th className="text-left text-xs text-gray-500 font-medium pr-3 py-1">Metric</th>
                  {PRIORITIES.map((p) => (
                    <th key={p} className="text-left text-xs text-gray-500 font-medium px-2 py-1 capitalize">
                      {p}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {SLA_METRICS.map((metric) => (
                  <tr key={metric} className="border-t border-gray-100">
                    <td className="pr-3 py-1.5 text-gray-700 whitespace-nowrap capitalize">{labelize(metric)}</td>
                    {PRIORITIES.map((priority) => {
                      const cell = s.targets[cellKey(metric, priority)] ?? { minutes: '', business: true };
                      return (
                        <td key={priority} className="px-2 py-1.5">
                          <div className="flex items-center gap-1.5">
                            <Input
                              type="number"
                              min={1}
                              value={cell.minutes}
                              onChange={(e) => setCell(metric, priority, { minutes: e.target.value })}
                              placeholder="—"
                              className="w-20"
                            />
                            <label className="flex items-center gap-1 text-xs text-gray-500" title="Business hours">
                              <input
                                type="checkbox"
                                checked={cell.business}
                                onChange={(e) => setCell(metric, priority, { business: e.target.checked })}
                              />
                              BH
                            </label>
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-gray-800">Escalations</h3>
            <Button
              variant="secondary"
              onClick={() =>
                set({
                  escalations: [
                    ...s.escalations,
                    { metric: 'first_response', level: String(s.escalations.length + 1), minutesOffset: '-30', notifyAssignee: true, notifySupervisors: false },
                  ],
                })
              }
            >
              <Plus size={14} /> Add escalation
            </Button>
          </div>
          <p className="text-xs text-gray-400 mb-2">
            Offset in minutes from the due time — negative fires <em>before</em> the breach (a warning), 0 at
            breach, positive after.
          </p>
          {s.escalations.length === 0 ? (
            <p className="text-sm text-gray-400">No escalations.</p>
          ) : (
            <div className="space-y-2">
              {s.escalations.map((e, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Select value={e.metric} onChange={(ev) => setEscalation(i, { metric: ev.target.value })}>
                    {SLA_METRICS.map((m) => (
                      <option key={m} value={m}>
                        {labelize(m)}
                      </option>
                    ))}
                  </Select>
                  <Input
                    type="number"
                    min={1}
                    value={e.level}
                    onChange={(ev) => setEscalation(i, { level: ev.target.value })}
                    className="w-16"
                    title="Level"
                  />
                  <Input
                    type="number"
                    value={e.minutesOffset}
                    onChange={(ev) => setEscalation(i, { minutesOffset: ev.target.value })}
                    className="w-24"
                    title="Minutes offset (negative = before due)"
                  />
                  <label className="flex items-center gap-1 text-xs text-gray-600">
                    <input
                      type="checkbox"
                      checked={e.notifyAssignee}
                      onChange={(ev) => setEscalation(i, { notifyAssignee: ev.target.checked })}
                    />
                    assignee
                  </label>
                  <label className="flex items-center gap-1 text-xs text-gray-600">
                    <input
                      type="checkbox"
                      checked={e.notifySupervisors}
                      onChange={(ev) => setEscalation(i, { notifySupervisors: ev.target.checked })}
                    />
                    supervisors
                  </label>
                  <button
                    className="text-gray-300 hover:text-red-500 ml-auto"
                    title="Remove"
                    onClick={() => set({ escalations: s.escalations.filter((_, idx) => idx !== i) })}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <ErrorNote error={save.error} />
        <div className="flex justify-end gap-2 border-t border-gray-100 pt-3">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending || !s.name.trim()}>
            {save.isPending ? 'Saving…' : policy ? 'Save policy' : 'Create policy'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
