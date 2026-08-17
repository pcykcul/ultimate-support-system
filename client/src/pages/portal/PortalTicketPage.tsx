/**
 * Customer ticket view: the conversation with real people. Staff replies carry
 * the agent's actual name, title and face; the reply-time promise stays visible
 * while the customer is waiting; solved tickets ask for a star rating.
 */
import { useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { HeartHandshake, Send, Star } from 'lucide-react';
import { api, ApiError } from '@/api/client';
import { BackLink, Button, Card, Textarea, cx, timeAgo } from '@/lib/ui';
import { Markdown } from '@/lib/markdown';
import {
  PortalStatusBadge,
  formatReplyBy,
  isAwaitingHuman,
  type PortalMessage,
  type PortalTicketDetail,
} from './shared';

function Avatar({ name, avatarUrl }: { name: string; avatarUrl?: string | null }) {
  if (avatarUrl) return <img src={avatarUrl} alt="" className="h-8 w-8 rounded-full shrink-0" />;
  return (
    <div className="h-8 w-8 rounded-full bg-brand text-brand-fg flex items-center justify-center text-sm font-semibold shrink-0">
      {(name || '?')[0].toUpperCase()}
    </div>
  );
}

function MessageBubble({ message }: { message: PortalMessage }) {
  const fromStaff = message.author?.kind === 'staff';

  if (!fromStaff) {
    // The customer's own words: right-aligned, brand-tinted.
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] sm:max-w-[75%]">
          <div className="rounded-2xl rounded-br-sm bg-brand-soft px-4 py-2.5">
            <Markdown className="text-sm text-gray-800">{message.body}</Markdown>
          </div>
          <p className="mt-1 text-right text-[11px] text-gray-400">
            {message.author?.name ?? 'You'} · {timeAgo(message.createdAt)}
          </p>
        </div>
      </div>
    );
  }

  // A staff reply: a person, with their real name and title on it.
  const author = message.author!;
  return (
    <div className="flex items-start gap-2.5">
      <Avatar name={author.name} avatarUrl={author.avatarUrl} />
      <div className="max-w-[85%] sm:max-w-[75%] min-w-0">
        <p className="text-[11px] text-gray-500 mb-0.5">
          <span className="font-medium text-gray-700">{author.name}</span>
          {author.title && <span> · {author.title}</span>}
          <span className="text-brand"> · a real person</span>
        </p>
        <div className="rounded-2xl rounded-tl-sm bg-white border border-gray-200 px-4 py-2.5">
          <Markdown className="text-sm text-gray-800">{message.body}</Markdown>
        </div>
        <p className="mt-1 text-[11px] text-gray-400">{timeAgo(message.createdAt)}</p>
      </div>
    </div>
  );
}

function CsatBlock({ ticketId }: { ticketId: string }) {
  const storageKey = `uss-csat-${ticketId}`;
  const [done, setDone] = useState(() => localStorage.getItem(storageKey) === '1');
  const [score, setScore] = useState(0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState('');

  const submit = useMutation({
    mutationFn: (v: { score: number; comment?: string }) =>
      api.post(`/api/portal/tickets/${ticketId}/csat`, v),
    onSuccess: () => {
      localStorage.setItem(storageKey, '1');
      setDone(true);
    },
  });

  if (done) {
    return (
      <Card className="p-5 text-center">
        <p className="text-sm font-medium text-gray-800">Thank you!</p>
        <p className="text-xs text-gray-500 mt-1">
          Your rating goes straight to the people who helped you — it genuinely matters to them.
        </p>
      </Card>
    );
  }

  return (
    <Card className="p-5">
      <p className="text-sm font-medium text-gray-800">How did we do?</p>
      <p className="text-xs text-gray-500 mt-0.5">
        Rate the humans who helped — they'll read this themselves.
      </p>
      <div className="mt-3 flex items-center gap-1" onMouseLeave={() => setHover(0)}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            aria-label={`${n} star${n === 1 ? '' : 's'}`}
            onClick={() => setScore(n)}
            onMouseEnter={() => setHover(n)}
            className="p-1"
          >
            <Star
              size={24}
              className={cx(
                'transition-colors',
                (hover || score) >= n ? 'text-amber-400 fill-amber-400' : 'text-gray-300'
              )}
            />
          </button>
        ))}
      </div>
      {score > 0 && (
        <div className="mt-3 space-y-2">
          <Textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={3}
            placeholder="Anything you'd like to add? (Optional)"
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              disabled={submit.isPending}
              onClick={() => submit.mutate({ score, comment: comment.trim() || undefined })}
            >
              Send rating
            </Button>
            {submit.isError && (
              <span className="text-xs text-red-600">
                {submit.error instanceof ApiError
                  ? submit.error.message
                  : "Couldn't send that — please try again."}
              </span>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

export default function PortalTicketPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ['portal', 'ticket', id],
    queryFn: () => api.get<PortalTicketDetail>(`/api/portal/tickets/${id}`),
    enabled: !!id,
  });

  const [reply, setReply] = useState('');
  const sendReply = useMutation({
    mutationFn: (body: string) => api.post(`/api/portal/tickets/${id}/messages`, { body }),
    onSuccess: () => {
      setReply('');
      void queryClient.invalidateQueries({ queryKey: ['portal', 'ticket', id] });
      void queryClient.invalidateQueries({ queryKey: ['portal', 'tickets'] });
    },
  });

  if (isLoading) {
    return <p className="text-center text-gray-400 py-16">Loading your ticket…</p>;
  }
  if (error || !data) {
    return (
      <div className="text-center py-16 text-gray-500">
        <p className="font-medium text-gray-700">We couldn't find that ticket</p>
        <p className="text-sm mt-1">It may belong to a different account.</p>
        <div className="mt-3">
          <BackLink to="/portal" label="Back to my tickets" />
        </div>
      </div>
    );
  }

  const { ticket, messages } = data;
  const waiting = isAwaitingHuman(ticket.status) && !!ticket.nextHumanReplyBy;
  const promiseLate = waiting && new Date(ticket.nextHumanReplyBy!).getTime() < Date.now();
  const finished = ticket.status === 'solved' || ticket.status === 'closed';

  function handleReply(e: FormEvent) {
    e.preventDefault();
    const body = reply.trim();
    if (!body || sendReply.isPending) return;
    sendReply.mutate(body);
  }

  return (
    <div className="max-w-2xl mx-auto">
      <BackLink to="/portal" label="My tickets" />

      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-sm font-mono text-gray-400">#{ticket.number}</span>
        <h1 className="text-lg font-bold text-gray-900 min-w-0 flex-1 basis-56">{ticket.subject}</h1>
        <PortalStatusBadge status={ticket.status} />
      </div>

      {/* The promise banner — visible the whole time the customer is waiting on us. */}
      {waiting && (
        <div
          className={cx(
            'mt-3 flex items-start gap-2.5 rounded-xl px-4 py-3 text-sm',
            promiseLate ? 'bg-yellow-50 text-yellow-800' : 'bg-brand-soft text-brand'
          )}
        >
          <HeartHandshake size={17} className="shrink-0 mt-0.5" />
          <span className="font-medium">
            {promiseLate
              ? "We're past our promised reply time — sorry. A real person is on it and you're at the top of the queue."
              : `A real person will reply by ${formatReplyBy(ticket.nextHumanReplyBy!)}.`}
          </span>
        </div>
      )}

      {/* Conversation */}
      <div className="mt-5 space-y-4">
        {messages.length === 0 && (
          <p className="text-center text-sm text-gray-400 py-8">No messages yet.</p>
        )}
        {messages.map((m) => (
          <MessageBubble key={m.id} message={m} />
        ))}
      </div>

      {/* CSAT once we're done */}
      {finished && (
        <div className="mt-6">
          <CsatBlock ticketId={ticket.id} />
        </div>
      )}

      {/* Reply composer — the line to a human never closes while the ticket is live. */}
      <form onSubmit={handleReply} className="mt-6">
        <Card className="p-3 sm:p-4">
          <Textarea
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            rows={4}
            placeholder={
              finished
                ? 'Need more help on this? Reply here and a person will pick it back up…'
                : 'Write a reply…'
            }
          />
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-gray-400">
              {ticket.status === 'waiting_on_customer'
                ? "We're waiting on you — reply when you're ready."
                : 'Your reply goes straight to a real person.'}
            </span>
            <Button type="submit" disabled={sendReply.isPending || reply.trim().length === 0}>
              <Send size={14} />
              {sendReply.isPending ? 'Sending…' : 'Send reply'}
            </Button>
          </div>
          {sendReply.isError && (
            <p className="mt-2 text-sm text-red-600">
              {sendReply.error instanceof ApiError
                ? sendReply.error.message
                : "Couldn't send that — please try again."}
            </p>
          )}
        </Card>
      </form>
    </div>
  );
}
