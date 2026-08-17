/**
 * Automations (supervisor+): deterministic event → conditions → actions rules.
 * No AI, no scoring — just honest "when X and Y, do Z" that a contributor can
 * read in one sitting.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { api } from '@/api/client';
import { Badge, Button, Card, EmptyState, Input, Modal, Select } from '@/lib/ui';
import {
  CHANNELS,
  CheckboxList,
  ErrorNote,
  Field,
  fromCsv,
  getOr,
  labelize,
  Loading,
  PRIORITIES,
  STATUSES,
  toCsv,
  useSopsList,
  useStaff,
  useTeams,
  useWebhooksList,
} from './shared';

const EVENTS = ['ticket.created', 'ticket.updated', 'message.created', 'sla.warning', 'sla.breach'];
const ACTION_TYPES = [
  { value: 'assign_team', label: 'Assign to team' },
  { value: 'set_priority', label: 'Set priority' },
  { value: 'add_tags', label: 'Add tags' },
  { value: 'notify', label: 'Notify staff (email)' },
  { value: 'start_sop', label: 'Start SOP run' },
  { value: 'send_webhook', label: 'Send webhook' },
];

interface Automation {
  id: string;
  name: string;
  event: string;
  conditions: { priorities?: string[]; channels?: string[]; tags?: string[]; statuses?: string[] };
  actions: Record<string, unknown>[];
  enabled: boolean;
}

/** Flat editor row — one field per action type, only the relevant one is sent. */
interface ActionRow {
  type: string;
  teamId: string;
  priority: string;
  tags: string;
  userIds: string[];
  sopId: string;
  webhookId: string;
}

const EMPTY_ROW: ActionRow = {
  type: 'assign_team',
  teamId: '',
  priority: 'normal',
  tags: '',
  userIds: [],
  sopId: '',
  webhookId: '',
};

function rowsFromActions(actions: Record<string, unknown>[]): ActionRow[] {
  return actions.map((a) => ({
    ...EMPTY_ROW,
    type: typeof a.type === 'string' ? a.type : 'assign_team',
    teamId: typeof a.teamId === 'string' ? a.teamId : '',
    priority: typeof a.priority === 'string' ? a.priority : 'normal',
    tags: Array.isArray(a.tags) ? (a.tags as string[]).join(', ') : '',
    userIds: Array.isArray(a.userIds) ? (a.userIds as string[]) : [],
    sopId: typeof a.sopId === 'string' ? a.sopId : '',
    webhookId: typeof a.webhookId === 'string' ? a.webhookId : '',
  }));
}

function actionsFromRows(rows: ActionRow[]): Record<string, unknown>[] {
  return rows.map((r) => {
    switch (r.type) {
      case 'assign_team':
        return { type: r.type, teamId: r.teamId };
      case 'set_priority':
        return { type: r.type, priority: r.priority };
      case 'add_tags':
        return { type: r.type, tags: fromCsv(r.tags) };
      case 'notify':
        return { type: r.type, userIds: r.userIds };
      case 'start_sop':
        return { type: r.type, sopId: r.sopId };
      default:
        return { type: r.type, webhookId: r.webhookId };
    }
  });
}

export default function AutomationsSection() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['settings', 'automations'],
    queryFn: () => getOr<{ items: Automation[] }>('/api/settings/automations', { items: [] }),
  });
  const automations = data?.items ?? [];
  const [editing, setEditing] = useState<Automation | null>(null);
  const [creating, setCreating] = useState(false);

  const invalidate = () => void qc.invalidateQueries({ queryKey: ['settings', 'automations'] });

  const toggle = useMutation({
    mutationFn: (a: Automation) => api.patch(`/api/settings/automations/${a.id}`, { enabled: !a.enabled }),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/api/settings/automations/${id}`),
    onSuccess: invalidate,
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">Deterministic rules: when an event fires and conditions match, run the actions.</p>
        <Button onClick={() => setCreating(true)}>
          <Plus size={15} /> New automation
        </Button>
      </div>

      {isLoading ? (
        <Loading />
      ) : automations.length === 0 ? (
        <Card>
          <EmptyState title="No automations" hint='e.g. "urgent tickets → assign the escalations team".' />
        </Card>
      ) : (
        <div className="space-y-3">
          {automations.map((a) => (
            <Card key={a.id} className="p-4 flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium flex items-center gap-2">
                  {a.name}
                  <Badge color="blue">{a.event}</Badge>
                </p>
                <p className="text-xs text-gray-500 truncate">
                  {a.actions.length} action{a.actions.length === 1 ? '' : 's'}:{' '}
                  {a.actions.map((act) => labelize(String(act.type ?? '?'))).join(', ') || 'none'}
                </p>
              </div>
              <label className="flex items-center gap-1.5 text-xs text-gray-600">
                <input type="checkbox" checked={a.enabled} onChange={() => toggle.mutate(a)} />
                enabled
              </label>
              <Button variant="secondary" onClick={() => setEditing(a)}>
                <Pencil size={14} /> Edit
              </Button>
              <Button
                variant="ghost"
                title="Delete"
                onClick={() => {
                  if (window.confirm(`Delete automation "${a.name}"?`)) remove.mutate(a.id);
                }}
              >
                <Trash2 size={15} />
              </Button>
            </Card>
          ))}
        </div>
      )}
      <ErrorNote error={toggle.error ?? remove.error} />

      {(creating || editing) && (
        <AutomationEditorModal
          automation={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function AutomationEditorModal({ automation, onClose }: { automation: Automation | null; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: teamsData } = useTeams();
  const { data: staffData } = useStaff();
  const { data: sopsData } = useSopsList();
  const { data: webhooksData } = useWebhooksList();

  const [name, setName] = useState(automation?.name ?? '');
  const [event, setEvent] = useState(automation?.event ?? 'ticket.created');
  const [priorities, setPriorities] = useState<string[]>(automation?.conditions.priorities ?? []);
  const [channels, setChannels] = useState<string[]>(automation?.conditions.channels ?? []);
  const [statuses, setStatuses] = useState<string[]>(automation?.conditions.statuses ?? []);
  const [tags, setTags] = useState(toCsv(automation?.conditions.tags));
  const [rows, setRows] = useState<ActionRow[]>(() =>
    automation ? rowsFromActions(automation.actions) : [{ ...EMPTY_ROW }]
  );

  const save = useMutation({
    mutationFn: () => {
      const tagList = fromCsv(tags);
      const body = {
        name: name.trim(),
        event,
        conditions: {
          ...(priorities.length ? { priorities } : {}),
          ...(channels.length ? { channels } : {}),
          ...(statuses.length ? { statuses } : {}),
          ...(tagList.length ? { tags: tagList } : {}),
        },
        actions: actionsFromRows(rows),
      };
      return automation
        ? api.patch(`/api/settings/automations/${automation.id}`, body)
        : api.post('/api/settings/automations', body);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['settings', 'automations'] });
      onClose();
    },
  });

  const setRow = (i: number, patch: Partial<ActionRow>) =>
    setRows(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const teams = teamsData?.items ?? [];
  const staff = (staffData?.items ?? []).filter((u) => u.active);
  const sops = sopsData?.items ?? [];
  const webhooks = webhooksData?.items ?? [];

  return (
    <Modal open onClose={onClose} title={automation ? `Edit ${automation.name}` : 'New automation'} wide>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Name">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Route urgent tickets" />
          </Field>
          <Field label="When this event fires">
            <Select value={event} onChange={(e) => setEvent(e.target.value)} className="w-full">
              {EVENTS.map((ev) => (
                <option key={ev} value={ev}>
                  {ev}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div>
          <h3 className="text-sm font-semibold text-gray-800 mb-2">Conditions</h3>
          <p className="text-xs text-gray-400 mb-2">All ANDed; leave everything empty to match every event.</p>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Priorities">
              <CheckboxList
                options={PRIORITIES.map((p) => ({ value: p, label: p }))}
                value={priorities}
                onChange={setPriorities}
              />
            </Field>
            <Field label="Channels">
              <CheckboxList
                options={CHANNELS.map((c) => ({ value: c, label: c }))}
                value={channels}
                onChange={setChannels}
              />
            </Field>
            <Field label="Statuses">
              <CheckboxList
                options={STATUSES.map((st) => ({ value: st, label: labelize(st) }))}
                value={statuses}
                onChange={setStatuses}
              />
            </Field>
          </div>
          <Field label="Tags (comma-separated)" className="mt-3">
            <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="vip, outage" />
          </Field>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-gray-800">Actions</h3>
            <Button variant="secondary" onClick={() => setRows([...rows, { ...EMPTY_ROW }])}>
              <Plus size={14} /> Add action
            </Button>
          </div>
          {rows.length === 0 ? (
            <p className="text-sm text-gray-400">No actions — add at least one.</p>
          ) : (
            <div className="space-y-2">
              {rows.map((r, i) => (
                <div key={i} className="flex items-start gap-2">
                  <Select value={r.type} onChange={(e) => setRow(i, { type: e.target.value })} className="w-44 shrink-0">
                    {ACTION_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </Select>
                  <div className="flex-1 min-w-0">
                    {r.type === 'assign_team' && (
                      <Select value={r.teamId} onChange={(e) => setRow(i, { teamId: e.target.value })} className="w-full">
                        <option value="">Choose a team…</option>
                        {teams.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.emoji ? `${t.emoji} ` : ''}
                            {t.name}
                          </option>
                        ))}
                      </Select>
                    )}
                    {r.type === 'set_priority' && (
                      <Select value={r.priority} onChange={(e) => setRow(i, { priority: e.target.value })} className="w-full">
                        {PRIORITIES.map((p) => (
                          <option key={p} value={p}>
                            {p}
                          </option>
                        ))}
                      </Select>
                    )}
                    {r.type === 'add_tags' && (
                      <Input
                        value={r.tags}
                        onChange={(e) => setRow(i, { tags: e.target.value })}
                        placeholder="tags, comma, separated"
                      />
                    )}
                    {r.type === 'notify' && (
                      <CheckboxList
                        options={staff.map((u) => ({ value: u.id, label: u.name }))}
                        value={r.userIds}
                        onChange={(userIds) => setRow(i, { userIds })}
                        className="max-h-28"
                      />
                    )}
                    {r.type === 'start_sop' && (
                      <Select value={r.sopId} onChange={(e) => setRow(i, { sopId: e.target.value })} className="w-full">
                        <option value="">Choose a SOP…</option>
                        {sops.map((sop) => (
                          <option key={sop.id} value={sop.id}>
                            {sop.title}
                          </option>
                        ))}
                      </Select>
                    )}
                    {r.type === 'send_webhook' && (
                      <Select value={r.webhookId} onChange={(e) => setRow(i, { webhookId: e.target.value })} className="w-full">
                        <option value="">Choose a webhook…</option>
                        {webhooks.map((w) => (
                          <option key={w.id} value={w.id}>
                            {w.name}
                          </option>
                        ))}
                      </Select>
                    )}
                  </div>
                  <button
                    className="text-gray-300 hover:text-red-500 mt-2"
                    title="Remove action"
                    onClick={() => setRows(rows.filter((_, idx) => idx !== i))}
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
          <Button onClick={() => save.mutate()} disabled={save.isPending || !name.trim() || rows.length === 0}>
            {save.isPending ? 'Saving…' : automation ? 'Save automation' : 'Create automation'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
