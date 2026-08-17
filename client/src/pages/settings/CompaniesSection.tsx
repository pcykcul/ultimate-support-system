/**
 * Companies: searchable list + detail modal with company settings and a
 * members table (customer users linked to the company).
 */
import { useEffect, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Search, Trash2 } from 'lucide-react';
import { api } from '@/api/client';
import { useMe } from '@/lib/session';
import { Badge, Button, Card, EmptyState, Input, Modal, Select } from '@/lib/ui';
import {
  ErrorNote,
  Field,
  fromCsv,
  getOr,
  listTimezones,
  Loading,
  toCsv,
  useSchedules,
  useSlaPolicies,
} from './shared';

interface CompanyListItem {
  id: string;
  name: string;
  domains: string[];
  tier: string | null;
  timezone: string | null;
  membersSeeAllTickets: boolean;
  slaPolicyId: string | null;
  scheduleId: string | null;
  memberCount: number;
  openTickets: number;
}

interface CompanyMember {
  userId: string;
  name: string;
  email: string | null;
  isCompanyAdmin: boolean;
  canViewAllTickets: boolean;
}

interface CompanyDetail {
  id: string;
  name: string;
  domains: string[];
  tier: string | null;
  timezone: string | null;
  membersSeeAllTickets: boolean;
  slaPolicyId: string | null;
  scheduleId: string | null;
  members: CompanyMember[];
}

export default function CompaniesSection() {
  const { data: me } = useMe();
  const canEdit = me?.role != null && me.role !== 'collaborator';
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 300);
    return () => clearTimeout(t);
  }, [q]);

  const { data, isLoading } = useQuery({
    queryKey: ['settings', 'companies', debouncedQ],
    queryFn: () =>
      getOr<{ items: CompanyListItem[] }>(
        `/api/companies${debouncedQ.trim() ? `?q=${encodeURIComponent(debouncedQ.trim())}` : ''}`,
        { items: [] }
      ),
    placeholderData: keepPreviousData,
  });
  const companies = data?.items ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search companies…" className="pl-9" />
        </div>
        {canEdit && (
          <Button onClick={() => setCreating(true)}>
            <Plus size={15} /> New company
          </Button>
        )}
      </div>

      <Card>
        {isLoading ? (
          <Loading />
        ) : companies.length === 0 ? (
          <EmptyState
            title="No companies"
            hint="Companies group customers, drive SLA policies and email-domain auto-association."
          />
        ) : (
          <ul className="divide-y divide-gray-100">
            {companies.map((c) => (
              <li key={c.id}>
                <button
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-gray-50"
                  onClick={() => setOpenId(c.id)}
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{c.name}</p>
                    <p className="text-xs text-gray-500 truncate">
                      {c.domains.length > 0 ? c.domains.join(', ') : 'No domains'}
                    </p>
                  </div>
                  {c.tier && <Badge color="purple">{c.tier}</Badge>}
                  <span className="text-xs text-gray-500 w-20 text-right">{c.memberCount} members</span>
                  <span className="text-xs text-gray-500 w-16 text-right">{c.openTickets} open</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {creating && (
        <CreateCompanyModal
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            setOpenId(id);
          }}
        />
      )}
      {openId && <CompanyModal id={openId} canEdit={canEdit} onClose={() => setOpenId(null)} />}
    </div>
  );
}

function CreateCompanyModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const create = useMutation({
    mutationFn: () => api.post<{ id: string }>('/api/companies', { name: name.trim() }),
    onSuccess: (created) => {
      void qc.invalidateQueries({ queryKey: ['settings', 'companies'] });
      onCreated(created.id);
    },
  });
  return (
    <Modal open onClose={onClose} title="New company">
      <div className="space-y-3">
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Pty Ltd" autoFocus />
        </Field>
        <ErrorNote error={create.error} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => create.mutate()} disabled={create.isPending || !name.trim()}>
            {create.isPending ? 'Creating…' : 'Create'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function CompanyModal({ id, canEdit, onClose }: { id: string; canEdit: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const isAdmin = me?.role === 'admin';
  const { data: company, isLoading } = useQuery({
    queryKey: ['settings', 'company', id],
    queryFn: () => api.get<CompanyDetail>(`/api/companies/${id}`),
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['settings', 'company', id] });
    void qc.invalidateQueries({ queryKey: ['settings', 'companies'] });
  };

  const remove = useMutation({
    mutationFn: () => api.delete(`/api/companies/${id}`),
    onSuccess: () => {
      invalidate();
      onClose();
    },
  });

  return (
    <Modal open onClose={onClose} title={company?.name ?? 'Company'} wide>
      {isLoading || !company ? (
        <Loading />
      ) : (
        <div className="space-y-5">
          <CompanyForm company={company} canEdit={canEdit} onSaved={invalidate} />
          <MembersTable company={company} canEdit={canEdit} onChanged={invalidate} />
          {isAdmin && (
            <div className="border-t border-gray-100 pt-3 flex justify-end">
              <Button
                variant="danger"
                disabled={remove.isPending}
                onClick={() => {
                  if (window.confirm(`Delete ${company.name}? Tickets keep their history.`)) remove.mutate();
                }}
              >
                <Trash2 size={15} /> Delete company
              </Button>
            </div>
          )}
          <ErrorNote error={remove.error} />
        </div>
      )}
    </Modal>
  );
}

function CompanyForm({
  company,
  canEdit,
  onSaved,
}: {
  company: CompanyDetail;
  canEdit: boolean;
  onSaved: () => void;
}) {
  const { data: policiesData } = useSlaPolicies();
  const { data: schedulesData } = useSchedules();
  const [name, setName] = useState(company.name);
  const [domains, setDomains] = useState(toCsv(company.domains));
  const [tier, setTier] = useState(company.tier ?? '');
  const [timezone, setTimezone] = useState(company.timezone ?? '');
  const [seeAll, setSeeAll] = useState(company.membersSeeAllTickets);
  const [slaPolicyId, setSlaPolicyId] = useState(company.slaPolicyId ?? '');
  const [scheduleId, setScheduleId] = useState(company.scheduleId ?? '');

  const save = useMutation({
    mutationFn: () =>
      api.patch(`/api/companies/${company.id}`, {
        name: name.trim(),
        domains: fromCsv(domains),
        tier: tier.trim() || null,
        timezone: timezone || null,
        membersSeeAllTickets: seeAll,
        slaPolicyId: slaPolicyId || null,
        scheduleId: scheduleId || null,
      }),
    onSuccess: onSaved,
  });

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Name">
          <Input value={name} disabled={!canEdit} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Tier" hint='Free-form label, e.g. "enterprise" — SLA conditions can match it'>
          <Input value={tier} disabled={!canEdit} onChange={(e) => setTier(e.target.value)} placeholder="standard" />
        </Field>
      </div>
      <Field label="Email domains (comma-separated)" hint="New contacts with these domains auto-join this company">
        <Input value={domains} disabled={!canEdit} onChange={(e) => setDomains(e.target.value)} placeholder="acme.com, acme.io" />
      </Field>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Timezone">
          <Select value={timezone} disabled={!canEdit} onChange={(e) => setTimezone(e.target.value)} className="w-full">
            <option value="">Not set</option>
            {listTimezones().map((tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="SLA policy">
          <Select value={slaPolicyId} disabled={!canEdit} onChange={(e) => setSlaPolicyId(e.target.value)} className="w-full">
            <option value="">Match by conditions</option>
            {(policiesData?.items ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Schedule">
          <Select value={scheduleId} disabled={!canEdit} onChange={(e) => setScheduleId(e.target.value)} className="w-full">
            <option value="">Default</option>
            {(schedulesData?.items ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <label className="flex items-center gap-2 text-sm text-gray-700">
        <input type="checkbox" disabled={!canEdit} checked={seeAll} onChange={(e) => setSeeAll(e.target.checked)} />
        Members see all company tickets in the portal
      </label>
      <ErrorNote error={save.error} />
      {canEdit && (
        <div className="flex items-center gap-3">
          <Button onClick={() => save.mutate()} disabled={save.isPending || !name.trim()}>
            {save.isPending ? 'Saving…' : 'Save company'}
          </Button>
          {save.isSuccess && !save.isPending && <span className="text-sm text-green-600">Saved.</span>}
        </div>
      )}
    </div>
  );
}

function MembersTable({
  company,
  canEdit,
  onChanged,
}: {
  company: CompanyDetail;
  canEdit: boolean;
  onChanged: () => void;
}) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');

  const add = useMutation({
    mutationFn: () => api.post(`/api/companies/${company.id}/members`, { email: email.trim(), name: name.trim() }),
    onSuccess: () => {
      setEmail('');
      setName('');
      onChanged();
    },
  });
  const patch = useMutation({
    mutationFn: (v: { userId: string; body: { isCompanyAdmin?: boolean; canViewAllTickets?: boolean } }) =>
      api.patch(`/api/companies/${company.id}/members/${v.userId}`, v.body),
    onSuccess: onChanged,
  });
  const remove = useMutation({
    mutationFn: (userId: string) => api.delete(`/api/companies/${company.id}/members/${userId}`),
    onSuccess: onChanged,
  });

  return (
    <div className="border-t border-gray-100 pt-4 space-y-3">
      <h3 className="text-sm font-semibold text-gray-800">Members ({company.members.length})</h3>
      {company.members.length === 0 ? (
        <p className="text-sm text-gray-400">No members yet.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-500">
              <th className="py-1 font-medium">Member</th>
              <th className="py-1 font-medium text-center">Company admin</th>
              <th className="py-1 font-medium text-center">Sees all tickets</th>
              <th className="py-1" />
            </tr>
          </thead>
          <tbody>
            {company.members.map((m) => (
              <tr key={m.userId} className="border-t border-gray-100">
                <td className="py-1.5">
                  <span className="font-medium">{m.name}</span>{' '}
                  <span className="text-gray-500 text-xs">{m.email ?? ''}</span>
                </td>
                <td className="py-1.5 text-center">
                  <input
                    type="checkbox"
                    disabled={!canEdit}
                    checked={m.isCompanyAdmin}
                    onChange={(e) =>
                      patch.mutate({ userId: m.userId, body: { isCompanyAdmin: e.target.checked } })
                    }
                  />
                </td>
                <td className="py-1.5 text-center">
                  <input
                    type="checkbox"
                    disabled={!canEdit}
                    checked={m.canViewAllTickets}
                    onChange={(e) =>
                      patch.mutate({ userId: m.userId, body: { canViewAllTickets: e.target.checked } })
                    }
                  />
                </td>
                <td className="py-1.5 text-right">
                  {canEdit && (
                    <Button variant="ghost" title="Remove from company" onClick={() => remove.mutate(m.userId)}>
                      ✕
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {canEdit && (
        <div className="flex items-end gap-2">
          <Field label="Email" className="flex-1">
            <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="pat@acme.com" />
          </Field>
          <Field label="Name" className="flex-1">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Pat Lee" />
          </Field>
          <Button onClick={() => add.mutate()} disabled={add.isPending || !email.trim() || !name.trim()}>
            <Plus size={15} /> Add
          </Button>
        </div>
      )}
      <ErrorNote error={add.error ?? patch.error ?? remove.error} />
    </div>
  );
}
