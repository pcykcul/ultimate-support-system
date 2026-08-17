/**
 * Portal home: the customer's tickets, each carrying the visible human promise
 * ("A person will reply by …"), plus a company panel for company admins —
 * members, visibility toggles, invite-a-colleague, recent company tickets.
 */
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpen, Building2, Eye, EyeOff, Plus, UserPlus } from 'lucide-react';
import { api, ApiError } from '@/api/client';
import { Badge, Button, Card, Input, PageHeader, timeAgo } from '@/lib/ui';
import { useMe } from '@/lib/session';
import {
  PortalStatusBadge,
  PromiseChip,
  isAwaitingHuman,
  type PortalCompanyData,
  type PortalTicketItem,
} from './shared';

function TicketRow({ ticket, showRequester }: { ticket: PortalTicketItem; showRequester: boolean }) {
  return (
    <Link
      to={`/portal/tickets/${ticket.id}`}
      className="block px-4 py-3 border-b border-gray-100 last:border-b-0 hover:bg-gray-50"
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-xs font-mono text-gray-400">#{ticket.number}</span>
        <span className="text-sm font-medium text-gray-800 min-w-0 flex-1 basis-48 truncate">
          {ticket.subject}
        </span>
        <PortalStatusBadge status={ticket.status} />
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-400">
        {showRequester && <span className="truncate max-w-[12rem]">{ticket.requesterName}</span>}
        <span>Updated {timeAgo(ticket.updatedAt)}</span>
        {isAwaitingHuman(ticket.status) && <PromiseChip due={ticket.nextHumanReplyBy} />}
      </div>
    </Link>
  );
}

function CompanyPanel() {
  const queryClient = useQueryClient();

  // Only company admins get data back; everyone else quietly sees nothing.
  const { data: company } = useQuery({
    queryKey: ['portal', 'company'],
    queryFn: async () => {
      try {
        return await api.get<PortalCompanyData>('/api/portal/company');
      } catch (err) {
        if (err instanceof ApiError && (err.status === 403 || err.status === 404)) return null;
        throw err;
      }
    },
    retry: false,
  });

  const [inviteName, setInviteName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [invited, setInvited] = useState<string | null>(null);

  const invite = useMutation({
    mutationFn: (v: { email: string; name: string }) => api.post('/api/portal/company/members', v),
    onSuccess: (_d, v) => {
      setInvited(v.email);
      setInviteName('');
      setInviteEmail('');
      void queryClient.invalidateQueries({ queryKey: ['portal', 'company'] });
    },
  });

  const toggleVisibility = useMutation({
    mutationFn: (v: { userId: string; canViewAllTickets: boolean }) =>
      api.patch(`/api/portal/company/members/${v.userId}`, { canViewAllTickets: v.canViewAllTickets }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['portal', 'company'] }),
  });

  if (!company) return null;

  function handleInvite(e: FormEvent) {
    e.preventDefault();
    setInvited(null);
    invite.mutate({ email: inviteEmail.trim(), name: inviteName.trim() });
  }

  const recentTickets = (company.tickets ?? []).slice(0, 5);

  return (
    <section className="mt-8">
      <h2 className="flex items-center gap-2 text-base font-semibold text-gray-900">
        <Building2 size={16} className="text-gray-400" />
        {company.company.name}
      </h2>
      <p className="text-xs text-gray-500 mt-0.5">
        You manage support for your company — invite colleagues and choose what they can see.
      </p>

      <div className="mt-3 grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Members + invite */}
        <Card>
          <div className="px-4 py-2.5 border-b border-gray-100 text-sm font-medium text-gray-700">
            Colleagues
          </div>
          {(company.members ?? []).length === 0 && (
            <p className="px-4 py-4 text-sm text-gray-400">No colleagues yet — invite one below.</p>
          )}
          {(company.members ?? []).map((m) => (
            <div
              key={m.userId}
              className="px-4 py-2.5 border-b border-gray-100 flex flex-wrap items-center gap-x-3 gap-y-1"
            >
              <div className="min-w-0 flex-1 basis-40">
                <p className="text-sm text-gray-800 truncate">
                  {m.name}
                  {m.isCompanyAdmin && (
                    <Badge color="brand" className="ml-1.5">
                      Admin
                    </Badge>
                  )}
                </p>
                {m.email && <p className="text-xs text-gray-400 truncate">{m.email}</p>}
              </div>
              <button
                type="button"
                disabled={toggleVisibility.isPending}
                onClick={() =>
                  toggleVisibility.mutate({ userId: m.userId, canViewAllTickets: !m.canViewAllTickets })
                }
                className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                title="Toggle whether this colleague can see every company ticket"
              >
                {m.canViewAllTickets ? <Eye size={13} /> : <EyeOff size={13} />}
                {m.canViewAllTickets ? 'Sees all tickets' : 'Own tickets only'}
              </button>
            </div>
          ))}

          <form onSubmit={handleInvite} className="px-4 py-3 space-y-2">
            <p className="text-xs font-medium text-gray-500 flex items-center gap-1.5">
              <UserPlus size={13} />
              Invite a colleague
            </p>
            <div className="flex flex-col sm:flex-row gap-2">
              <Input
                value={inviteName}
                onChange={(e) => setInviteName(e.target.value)}
                placeholder="Name"
                required
              />
              <Input
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="colleague@company.com"
                required
              />
              <Button type="submit" variant="secondary" disabled={invite.isPending} className="justify-center">
                Invite
              </Button>
            </div>
            {invited && (
              <p className="text-xs text-green-700">
                Invited {invited} — they can sign in with that email.
              </p>
            )}
            {invite.isError && (
              <p className="text-xs text-red-600">
                {invite.error instanceof ApiError ? invite.error.message : "Couldn't invite — try again."}
              </p>
            )}
          </form>
        </Card>

        {/* Recent company tickets */}
        <Card>
          <div className="px-4 py-2.5 border-b border-gray-100 text-sm font-medium text-gray-700">
            Recent company tickets
          </div>
          {recentTickets.length === 0 ? (
            <p className="px-4 py-4 text-sm text-gray-400">No company tickets yet.</p>
          ) : (
            recentTickets.map((t) => <TicketRow key={t.id} ticket={t} showRequester />)
          )}
        </Card>
      </div>
    </section>
  );
}

export default function PortalHome() {
  const navigate = useNavigate();
  const { data: me } = useMe();

  const { data, isLoading } = useQuery({
    queryKey: ['portal', 'tickets'],
    queryFn: () => api.get<{ items: PortalTicketItem[] }>('/api/portal/tickets'),
  });

  const tickets = data?.items ?? [];

  return (
    <div>
      <PageHeader
        title="My tickets"
        subtitle={me ? `Hi ${me.name.split(' ')[0]} — here's everything you've asked us.` : undefined}
        actions={
          <Button onClick={() => navigate('/portal/new')} className="hidden sm:inline-flex">
            <Plus size={14} />
            New ticket
          </Button>
        }
      />

      {/* Mobile: keep the primary action reachable without the header cramping. */}
      <div className="sm:hidden mb-3">
        <Link to="/portal/new">
          <Button className="w-full justify-center">
            <Plus size={14} />
            New ticket
          </Button>
        </Link>
      </div>

      {isLoading && (
        <Card>
          <p className="px-4 py-10 text-center text-sm text-gray-400">Loading your tickets…</p>
        </Card>
      )}

      {!isLoading && tickets.length === 0 && (
        <Card>
          <div className="px-4 py-12 text-center">
            <p className="font-medium text-gray-700">Nothing here yet</p>
            <p className="text-sm text-gray-500 mt-1">
              Stuck on something? Ask us — a real person will get back to you.
            </p>
            <div className="mt-4 flex flex-col sm:flex-row items-center justify-center gap-2">
              <Link to="/portal/new">
                <Button>
                  <Plus size={14} />
                  New ticket
                </Button>
              </Link>
              <Link to="/portal/kb">
                <Button variant="secondary">
                  <BookOpen size={14} />
                  Browse help articles
                </Button>
              </Link>
            </div>
          </div>
        </Card>
      )}

      {!isLoading && tickets.length > 0 && (
        <Card>
          {tickets.map((t) => (
            <TicketRow key={t.id} ticket={t} showRequester={!!me && t.requesterName !== me.name} />
          ))}
        </Card>
      )}

      <CompanyPanel />
    </div>
  );
}
