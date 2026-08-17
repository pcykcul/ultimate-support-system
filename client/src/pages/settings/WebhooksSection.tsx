/**
 * Webhooks (admin): CRUD + a per-webhook deliveries drawer with status chips.
 * Payloads are signed with X-USS-Signature (HMAC-SHA256 of the body).
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Pencil, Plus, Trash2 } from 'lucide-react';
import { api } from '@/api/client';
import { Badge, Button, Card, EmptyState, Input, Modal, timeAgo } from '@/lib/ui';
import { CheckboxList, ErrorNote, Field, getOr, Loading, type Webhook, useWebhooksList } from './shared';

const KNOWN_EVENTS = [
  'ticket.created',
  'ticket.updated',
  'ticket.status_changed',
  'message.created',
  'sla.warning',
  'sla.breach',
];

interface Delivery {
  id: string;
  event: string;
  responseStatus: number | null;
  error: string | null;
  createdAt: string;
}

export default function WebhooksSection() {
  const qc = useQueryClient();
  const { data, isLoading } = useWebhooksList();
  const webhooks = data?.items ?? [];
  const [editing, setEditing] = useState<Webhook | null>(null);
  const [creating, setCreating] = useState(false);
  const [drawerId, setDrawerId] = useState<string | null>(null);

  const invalidate = () => void qc.invalidateQueries({ queryKey: ['settings', 'webhooks'] });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/api/settings/webhooks/${id}`),
    onSuccess: invalidate,
  });
  const toggle = useMutation({
    mutationFn: (w: Webhook) => api.patch(`/api/settings/webhooks/${w.id}`, { enabled: !w.enabled }),
    onSuccess: invalidate,
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">
          POSTs event payloads to your endpoints, signed with an HMAC-SHA256 X-USS-Signature header.
        </p>
        <Button onClick={() => setCreating(true)}>
          <Plus size={15} /> New webhook
        </Button>
      </div>

      {isLoading ? (
        <Loading />
      ) : webhooks.length === 0 ? (
        <Card>
          <EmptyState title="No webhooks" hint="Push ticket and SLA events into your own systems." />
        </Card>
      ) : (
        <div className="space-y-3">
          {webhooks.map((w) => (
            <Card key={w.id} className="p-4">
              <div className="flex items-center gap-3">
                <button
                  className="text-gray-400 hover:text-gray-700"
                  title="Recent deliveries"
                  onClick={() => setDrawerId(drawerId === w.id ? null : w.id)}
                >
                  {drawerId === w.id ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                </button>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium flex items-center gap-2">
                    {w.name}
                    <Badge color={w.enabled ? 'green' : 'gray'}>{w.enabled ? 'enabled' : 'disabled'}</Badge>
                  </p>
                  <p className="text-xs text-gray-500 truncate font-mono">{w.url}</p>
                  <p className="text-xs text-gray-400">
                    {w.events.length > 0 ? w.events.join(', ') : 'All events'}
                  </p>
                </div>
                <label className="flex items-center gap-1.5 text-xs text-gray-600">
                  <input type="checkbox" checked={w.enabled} onChange={() => toggle.mutate(w)} />
                  enabled
                </label>
                <Button variant="secondary" onClick={() => setEditing(w)}>
                  <Pencil size={14} /> Edit
                </Button>
                <Button
                  variant="ghost"
                  title="Delete"
                  onClick={() => {
                    if (window.confirm(`Delete webhook "${w.name}"?`)) remove.mutate(w.id);
                  }}
                >
                  <Trash2 size={15} />
                </Button>
              </div>
              {drawerId === w.id && <DeliveriesDrawer webhookId={w.id} />}
            </Card>
          ))}
        </div>
      )}
      <ErrorNote error={remove.error ?? toggle.error} />

      {(creating || editing) && (
        <WebhookEditorModal
          webhook={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function DeliveriesDrawer({ webhookId }: { webhookId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['settings', 'webhook-deliveries', webhookId],
    queryFn: () => getOr<{ items: Delivery[] }>(`/api/settings/webhooks/${webhookId}/deliveries`, { items: [] }),
  });
  const deliveries = data?.items ?? [];

  return (
    <div className="mt-3 border-t border-gray-100 pt-3">
      {isLoading ? (
        <Loading />
      ) : deliveries.length === 0 ? (
        <p className="text-sm text-gray-400">No deliveries yet.</p>
      ) : (
        <ul className="divide-y divide-gray-50">
          {deliveries.map((d) => (
            <li key={d.id} className="flex items-center gap-3 py-1.5 text-sm">
              <DeliveryStatus delivery={d} />
              <span className="text-gray-700">{d.event}</span>
              {d.error && <span className="text-xs text-red-500 truncate flex-1">{d.error}</span>}
              <span className="text-xs text-gray-400 ml-auto shrink-0">{timeAgo(d.createdAt)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function DeliveryStatus({ delivery }: { delivery: Delivery }) {
  if (delivery.responseStatus == null) {
    return <Badge color={delivery.error ? 'red' : 'gray'}>{delivery.error ? 'failed' : 'pending'}</Badge>;
  }
  const ok = delivery.responseStatus >= 200 && delivery.responseStatus < 300;
  return <Badge color={ok ? 'green' : 'red'}>{delivery.responseStatus}</Badge>;
}

function WebhookEditorModal({ webhook, onClose }: { webhook: Webhook | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(webhook?.name ?? '');
  const [url, setUrl] = useState(webhook?.url ?? '');
  const [secret, setSecret] = useState(webhook?.secret ?? '');
  const [events, setEvents] = useState<string[]>(webhook?.events ?? []);

  const save = useMutation({
    mutationFn: () => {
      const body = { name: name.trim(), url: url.trim(), secret: secret.trim() || undefined, events };
      return webhook
        ? api.patch(`/api/settings/webhooks/${webhook.id}`, body)
        : api.post('/api/settings/webhooks', body);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['settings', 'webhooks'] });
      onClose();
    },
  });

  return (
    <Modal open onClose={onClose} title={webhook ? `Edit ${webhook.name}` : 'New webhook'}>
      <div className="space-y-3">
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ops Slack bridge" />
        </Field>
        <Field label="URL">
          <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/hooks/uss" />
        </Field>
        <Field label="Secret" hint="Used to sign payloads (X-USS-Signature). Leave blank for unsigned.">
          <Input value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="whsec_…" />
        </Field>
        <Field label="Events" hint="None selected = subscribe to all events">
          <CheckboxList
            options={KNOWN_EVENTS.map((e) => ({ value: e, label: e }))}
            value={events}
            onChange={setEvents}
          />
        </Field>
        <ErrorNote error={save.error} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending || !name.trim() || !url.trim()}>
            {save.isPending ? 'Saving…' : webhook ? 'Save webhook' : 'Create webhook'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
