/**
 * Email log (admin): every outbound email the system sent, for audit and dev
 * inspection — click a row to read the full body.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '@/api/client';
import { Badge, Card, EmptyState, timeAgo } from '@/lib/ui';
import { getOr, Loading } from './shared';

interface EmailLogEntry {
  id: string;
  to: string;
  subject: string;
  body?: string;
  ticketId: string | null;
  status: string; // sent | logged | failed
  error: string | null;
  createdAt: string;
}

const STATUS_COLORS: Record<string, 'green' | 'blue' | 'red' | 'gray'> = {
  sent: 'green',
  logged: 'blue',
  failed: 'red',
};

export default function EmailLogSection() {
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['settings', 'email-log'],
    queryFn: () => getOr<{ items: EmailLogEntry[] }>('/api/settings/email-log', { items: [] }),
  });
  const emails = data?.items ?? [];
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">
          The last 100 outbound emails. Automated mails are always labeled as receipts — never fake humans.
        </p>
        <button
          className="text-sm text-gray-500 hover:text-gray-800"
          onClick={() => void refetch()}
          disabled={isFetching}
        >
          {isFetching ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      <Card>
        {isLoading ? (
          <Loading />
        ) : emails.length === 0 ? (
          <EmptyState title="No emails yet" hint="Outbound mail shows up here as soon as the system sends any." />
        ) : (
          <ul className="divide-y divide-gray-100">
            {emails.map((e) => (
              <li key={e.id}>
                <button
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-gray-50"
                  onClick={() => setOpenId(openId === e.id ? null : e.id)}
                >
                  <Badge color={STATUS_COLORS[e.status] ?? 'gray'}>{e.status}</Badge>
                  <span className="w-52 shrink-0 truncate text-sm text-gray-600">{e.to}</span>
                  <span className="flex-1 min-w-0 truncate text-sm font-medium">{e.subject}</span>
                  <span className="text-xs text-gray-400 shrink-0">{timeAgo(e.createdAt)}</span>
                </button>
                {openId === e.id && (
                  <div className="px-4 pb-3 space-y-2">
                    {e.error && <p className="text-xs text-red-600">Error: {e.error}</p>}
                    {e.ticketId && (
                      <Link to={`/tickets/${e.ticketId}`} className="text-xs text-brand hover:underline">
                        Open linked ticket →
                      </Link>
                    )}
                    <pre className="rounded-lg bg-gray-50 border border-gray-100 p-3 text-xs whitespace-pre-wrap text-gray-700 max-h-72 overflow-y-auto">
                      {e.body ?? '(body not available)'}
                    </pre>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
