/**
 * Supervisor-only read-and-sign area: assign users/teams with a due date,
 * and the coverage dashboard — who is current on which version (green/amber/red).
 */
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { UserPlus, Users } from 'lucide-react';
import { api } from '@/api/client';
import { Badge, Button, Card, Input, Modal, Select, timeAgo } from '@/lib/ui';
import {
  ACK_STATE_META,
  ackRowName,
  ackRowVersion,
  ackState,
  type AckDashboardRow,
  type SopFull,
} from './shared';

interface StaffUser {
  id: string;
  name: string;
  email: string | null;
}

interface Team {
  id: string;
  name: string;
  emoji: string | null;
}

export default function AssignmentsSection({ sop }: { sop: SopFull }) {
  const qc = useQueryClient();
  const [assignOpen, setAssignOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['sops', 'detail', sop.id, 'acks'],
    queryFn: async () => {
      const raw = await api.get<{ items?: AckDashboardRow[] } | AckDashboardRow[]>(
        `/api/sops/${sop.id}/acknowledgments`
      );
      return Array.isArray(raw) ? raw : (raw.items ?? []);
    },
  });

  const rows = data ?? [];

  return (
    <Card className="mt-4">
      <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 border-b border-gray-100">
        <Users size={14} className="text-gray-400" />
        <h2 className="text-sm font-semibold">Read &amp; sign coverage</h2>
        <span className="text-xs text-gray-400">v{sop.version} is current</span>
        <span className="flex-1" />
        <Button variant="secondary" onClick={() => setAssignOpen(true)}>
          <UserPlus size={14} />
          Assign
        </Button>
      </div>

      {!sop.requiresAcknowledgment && (
        <p className="px-4 pt-3 text-xs text-yellow-700">
          Heads up: this SOP does not require acknowledgment yet — turn the toggle on so assignments count.
        </p>
      )}

      {isLoading && <p className="px-4 py-6 text-center text-sm text-gray-400">Loading coverage…</p>}
      {!isLoading && rows.length === 0 && (
        <p className="px-4 py-6 text-center text-sm text-gray-400">
          No one is assigned yet. Assign people or a team to require a signed read-through.
        </p>
      )}

      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-gray-400 border-b border-gray-100">
                <th className="px-4 py-2 font-medium">Who</th>
                <th className="px-3 py-2 font-medium">Version</th>
                <th className="px-3 py-2 font-medium">Due</th>
                <th className="px-3 py-2 font-medium">Acknowledged</th>
                <th className="px-4 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const state = ackState(r, sop.version);
                const meta = ACK_STATE_META[state];
                const v = ackRowVersion(r);
                return (
                  <tr key={r.id ?? r.userId ?? i} className="border-b border-gray-100 last:border-b-0">
                    <td className="px-4 py-2.5">
                      <p className="text-gray-800 truncate max-w-[200px]">{ackRowName(r)}</p>
                      {r.signatureName && (
                        <p className="text-xs text-gray-400 italic truncate max-w-[200px]">
                          signed “{r.signatureName}”
                        </p>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-gray-600">{v != null ? `v${v}` : '—'}</td>
                    <td className="px-3 py-2.5 text-xs text-gray-600">
                      {r.dueAt ? timeAgo(r.dueAt) : '—'}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-gray-600">
                      {r.acknowledgedAt ? timeAgo(r.acknowledgedAt) : 'not yet'}
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge color={meta.color}>{meta.label}</Badge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <AssignModal
        open={assignOpen}
        onClose={() => setAssignOpen(false)}
        sopId={sop.id}
        onAssigned={() => {
          setAssignOpen(false);
          void qc.invalidateQueries({ queryKey: ['sops'] });
        }}
      />
    </Card>
  );
}

function AssignModal({
  open,
  onClose,
  sopId,
  onAssigned,
}: {
  open: boolean;
  onClose: () => void;
  sopId: string;
  onAssigned: () => void;
}) {
  const [userIds, setUserIds] = useState<string[]>([]);
  const [teamId, setTeamId] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setUserIds([]);
      setTeamId('');
      setDueAt('');
      setError(null);
    }
  }, [open]);

  const { data: staffData } = useQuery({
    queryKey: ['users', 'staff'],
    queryFn: () => api.get<{ items: StaffUser[] }>('/api/users?kind=staff'),
    enabled: open,
  });
  const { data: teamData } = useQuery({
    queryKey: ['users', 'teams'],
    queryFn: () => api.get<{ items: Team[] }>('/api/users/teams'),
    enabled: open,
  });

  const assign = useMutation({
    mutationFn: () =>
      api.post(`/api/sops/${sopId}/assign`, {
        ...(userIds.length > 0 ? { userIds } : {}),
        ...(teamId ? { teamId } : {}),
        ...(dueAt ? { dueAt: new Date(dueAt).toISOString() } : {}),
      }),
    onSuccess: onAssigned,
    onError: (e) => setError(e instanceof Error ? e.message : 'Could not create assignments'),
  });

  const toggleUser = (id: string) =>
    setUserIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  return (
    <Modal open={open} onClose={onClose} title="Assign read & sign">
      <div className="space-y-3">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">People</label>
          <div className="max-h-48 overflow-y-auto rounded-lg border border-gray-200 divide-y divide-gray-100">
            {(staffData?.items ?? []).length === 0 && (
              <p className="px-2.5 py-2 text-xs text-gray-400">No staff found.</p>
            )}
            {(staffData?.items ?? []).map((u) => (
              <label
                key={u.id}
                className="flex items-center gap-2 px-2.5 py-1.5 text-sm cursor-pointer hover:bg-gray-50"
              >
                <input
                  type="checkbox"
                  checked={userIds.includes(u.id)}
                  onChange={() => toggleUser(u.id)}
                  className="accent-brand"
                />
                <span className="truncate">{u.name}</span>
                {u.email && <span className="text-xs text-gray-400 truncate">{u.email}</span>}
              </label>
            ))}
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">…and/or a whole team</label>
          <Select value={teamId} onChange={(e) => setTeamId(e.target.value)} className="w-full">
            <option value="">No team</option>
            {(teamData?.items ?? []).map((t) => (
              <option key={t.id} value={t.id}>
                {t.emoji ? `${t.emoji} ` : ''}
                {t.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Due by (optional)</label>
          <Input type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
        </div>
        <p className="text-xs text-gray-400">
          Everyone assigned must read the current version and sign with their full name.
        </p>
        {error && <p className="text-xs text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={(userIds.length === 0 && !teamId) || assign.isPending}
            onClick={() => assign.mutate()}
          >
            {assign.isPending ? 'Assigning…' : 'Assign'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
