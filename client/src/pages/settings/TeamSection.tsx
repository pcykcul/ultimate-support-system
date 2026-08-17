/**
 * Team: staff directory (invite / edit role & scope / deactivate — admin) and
 * the Teams sub-section (cards with schedule + member checklist).
 */
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, UserX } from 'lucide-react';
import { api } from '@/api/client';
import { useMe } from '@/lib/session';
import { Badge, Button, Card, EmptyState, Input, Modal, Select } from '@/lib/ui';
import {
  CheckboxList,
  ErrorNote,
  Field,
  listTimezones,
  Loading,
  ROLE_COLORS,
  type StaffRole,
  type StaffUser,
  type Team,
  useSchedules,
  useStaff,
  useTeams,
} from './shared';

const ROLES: StaffRole[] = ['admin', 'supervisor', 'agent', 'collaborator'];
const SCOPES = ['all', 'team', 'assigned'] as const;

export default function TeamSection() {
  const { data: me } = useMe();
  const isAdmin = me?.role === 'admin';
  const { data, isLoading } = useStaff();
  const staff = data?.items ?? [];
  const [inviteOpen, setInviteOpen] = useState(false);
  const [editing, setEditing] = useState<StaffUser | null>(null);

  return (
    <div className="space-y-6">
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-800">Staff</h2>
          {isAdmin && (
            <Button onClick={() => setInviteOpen(true)}>
              <Plus size={15} /> Invite staff
            </Button>
          )}
        </div>
        <Card>
          {isLoading ? (
            <Loading />
          ) : staff.length === 0 ? (
            <EmptyState title="No staff yet" hint="Invite your first teammate to get started." />
          ) : (
            <ul className="divide-y divide-gray-100">
              {staff.map((u) => (
                <StaffRow key={u.id} user={u} isAdmin={isAdmin} onEdit={() => setEditing(u)} />
              ))}
            </ul>
          )}
        </Card>
      </section>

      <TeamsBlock staff={staff} isAdmin={isAdmin} />

      <InviteModal open={inviteOpen} onClose={() => setInviteOpen(false)} />
      {editing && <EditStaffModal user={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function StaffRow({ user, isAdmin, onEdit }: { user: StaffUser; isAdmin: boolean; onEdit: () => void }) {
  const qc = useQueryClient();
  const deactivate = useMutation({
    mutationFn: () => api.post(`/api/users/${user.id}/deactivate`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['settings', 'staff'] }),
  });

  return (
    <li className="flex items-center gap-3 px-4 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium truncate">
          {user.name}
          {user.title && <span className="text-gray-400 font-normal"> · {user.title}</span>}
        </p>
        <p className="text-xs text-gray-500 truncate">
          {user.email ?? '—'} · {user.timezone}
        </p>
      </div>
      {user.role && <Badge color={ROLE_COLORS[user.role]}>{user.role}</Badge>}
      {user.scope && <Badge color="gray">scope: {user.scope}</Badge>}
      {!user.active && <Badge color="red">deactivated</Badge>}
      {isAdmin && (
        <div className="flex items-center gap-1">
          <Button variant="ghost" onClick={onEdit} title="Edit">
            <Pencil size={14} />
          </Button>
          {user.active && (
            <Button
              variant="ghost"
              title="Deactivate"
              disabled={deactivate.isPending}
              onClick={() => {
                if (window.confirm(`Deactivate ${user.name}? They will no longer be able to sign in.`)) {
                  deactivate.mutate();
                }
              }}
            >
              <UserX size={14} />
            </Button>
          )}
        </div>
      )}
    </li>
  );
}

function InviteModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<StaffRole>('agent');

  const invite = useMutation({
    mutationFn: () =>
      api.post<{ inviteToken?: string }>('/api/users', { email: email.trim(), name: name.trim(), role }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['settings', 'staff'] }),
  });

  const close = () => {
    invite.reset();
    setEmail('');
    setName('');
    setRole('agent');
    onClose();
  };

  return (
    <Modal open={open} onClose={close} title="Invite staff">
      {invite.isSuccess ? (
        <div className="space-y-3">
          <p className="text-sm text-gray-700">
            Invite sent to <span className="font-medium">{email}</span>.
          </p>
          {invite.data?.inviteToken && (
            <div>
              <p className="text-xs text-gray-500 mb-1">Invite token (shown in dev — share the accept link):</p>
              <code className="block rounded-lg bg-gray-100 px-3 py-2 text-xs break-all select-all">
                {invite.data.inviteToken}
              </code>
            </div>
          )}
          <div className="flex justify-end">
            <Button onClick={close}>Done</Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <Field label="Email">
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="sam@acme.com" />
          </Field>
          <Field label="Name">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Sam Taylor" />
          </Field>
          <Field label="Role" hint="Collaborators are read-only: they can view and leave internal notes">
            <Select value={role} onChange={(e) => setRole(e.target.value as StaffRole)} className="w-full">
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </Select>
          </Field>
          <ErrorNote error={invite.error} />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={close}>
              Cancel
            </Button>
            <Button
              onClick={() => invite.mutate()}
              disabled={invite.isPending || !email.trim() || !name.trim()}
            >
              {invite.isPending ? 'Sending…' : 'Send invite'}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function EditStaffModal({ user, onClose }: { user: StaffUser; onClose: () => void }) {
  const qc = useQueryClient();
  const [role, setRole] = useState<StaffRole>(user.role ?? 'agent');
  const [scope, setScope] = useState<string>(user.scope ?? 'all');
  const [title, setTitle] = useState(user.title ?? '');
  const [timezone, setTimezone] = useState(user.timezone);

  const save = useMutation({
    mutationFn: () =>
      api.patch(`/api/users/${user.id}`, { role, scope, title: title.trim() || undefined, timezone }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['settings', 'staff'] });
      onClose();
    },
  });

  return (
    <Modal open onClose={onClose} title={`Edit ${user.name}`}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Role">
            <Select value={role} onChange={(e) => setRole(e.target.value as StaffRole)} className="w-full">
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Ticket scope" hint="What they see in the inbox">
            <Select value={scope} onChange={(e) => setScope(e.target.value)} className="w-full">
              {SCOPES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Title" hint="Shown in reply signatures — real names, real titles">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Support Engineer" />
        </Field>
        <Field label="Timezone">
          <Select value={timezone} onChange={(e) => setTimezone(e.target.value)} className="w-full">
            {listTimezones().map((tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
          </Select>
        </Field>
        <ErrorNote error={save.error} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ---------- Teams sub-section ----------

function TeamsBlock({ staff, isAdmin }: { staff: StaffUser[]; isAdmin: boolean }) {
  const qc = useQueryClient();
  const { data, isLoading } = useTeams();
  const teams = data?.items ?? [];
  const [newName, setNewName] = useState('');
  const [newEmoji, setNewEmoji] = useState('');

  const create = useMutation({
    mutationFn: () =>
      api.post('/api/users/teams', { name: newName.trim(), emoji: newEmoji.trim() || undefined }),
    onSuccess: () => {
      setNewName('');
      setNewEmoji('');
      void qc.invalidateQueries({ queryKey: ['settings', 'teams'] });
    },
  });

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-gray-800">Teams</h2>
        {isAdmin && (
          <div className="flex items-center gap-2">
            <Input
              value={newEmoji}
              onChange={(e) => setNewEmoji(e.target.value)}
              placeholder="🛠️"
              className="w-14 text-center"
            />
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="New team name"
              className="w-44"
            />
            <Button onClick={() => create.mutate()} disabled={create.isPending || !newName.trim()}>
              <Plus size={15} /> Add
            </Button>
          </div>
        )}
      </div>
      <ErrorNote error={create.error} />
      {isLoading ? (
        <Loading />
      ) : teams.length === 0 ? (
        <Card>
          <EmptyState title="No teams yet" hint="Teams route tickets and carry their own schedule." />
        </Card>
      ) : (
        <div className="grid grid-cols-2 gap-4">
          {teams.map((t) => (
            <TeamCard key={t.id} team={t} staff={staff} isAdmin={isAdmin} />
          ))}
        </div>
      )}
    </section>
  );
}

function TeamCard({ team, staff, isAdmin }: { team: Team; staff: StaffUser[]; isAdmin: boolean }) {
  const qc = useQueryClient();
  const { data: schedulesData } = useSchedules();
  const schedules = schedulesData?.items ?? [];
  const [name, setName] = useState(team.name);
  const [emoji, setEmoji] = useState(team.emoji ?? '');

  const patch = useMutation({
    mutationFn: (body: { name?: string; emoji?: string; scheduleId?: string | null; memberIds?: string[] }) =>
      api.patch(`/api/users/teams/${team.id}`, body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['settings', 'teams'] }),
  });
  const remove = useMutation({
    mutationFn: () => api.delete(`/api/users/teams/${team.id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['settings', 'teams'] }),
  });

  const activeStaff = staff.filter((u) => u.active);

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Input
          value={emoji}
          disabled={!isAdmin}
          onChange={(e) => setEmoji(e.target.value)}
          onBlur={() => emoji !== (team.emoji ?? '') && patch.mutate({ emoji })}
          className="w-12 text-center"
        />
        <Input
          value={name}
          disabled={!isAdmin}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name.trim() && name !== team.name && patch.mutate({ name: name.trim() })}
        />
        {isAdmin && (
          <Button
            variant="ghost"
            title="Delete team"
            disabled={remove.isPending}
            onClick={() => {
              if (window.confirm(`Delete team "${team.name}"?`)) remove.mutate();
            }}
          >
            ✕
          </Button>
        )}
      </div>
      <Field label="Schedule">
        <Select
          className="w-full"
          disabled={!isAdmin}
          value={team.scheduleId ?? ''}
          onChange={(e) => patch.mutate({ scheduleId: e.target.value || null })}
        >
          <option value="">No schedule (use default)</option>
          {schedules.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={`Members (${team.memberIds.length})`}>
        <CheckboxList
          disabled={!isAdmin}
          options={activeStaff.map((u) => ({ value: u.id, label: u.name }))}
          value={team.memberIds}
          onChange={(memberIds) => patch.mutate({ memberIds })}
        />
      </Field>
      <ErrorNote error={patch.error ?? remove.error} />
    </Card>
  );
}
