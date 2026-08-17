/**
 * New ticket form with a "before you submit" deflection step: as the customer
 * types a subject we surface up to three matching help articles — but the path
 * to a human is never gated. Submitting shows the ticket number and the promise.
 */
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, BookOpen, CheckCircle2, HeartHandshake } from 'lucide-react';
import { api, ApiError } from '@/api/client';
import { Button, Card, Input, PageHeader, Textarea } from '@/lib/ui';
import { useBranding } from '@/lib/session';
import {
  DEFAULT_HUMAN_LINE,
  formatReplyBy,
  normalizeKb,
  stripTags,
  useDebounced,
  type PortalTicketItem,
} from './shared';

/** The server returns the ticket plus the promise; tolerate flat or nested encodings. */
interface RawCreateResponse extends Partial<PortalTicketItem> {
  ticket?: Partial<PortalTicketItem> & { promiseText?: string | null };
  promiseText?: string | null;
  nextHumanReplyBy?: string | null;
}

interface CreatedTicket {
  id: string | null;
  number: number | null;
  promiseText: string | null;
  nextHumanReplyBy: string | null;
}

function normalizeCreated(r: RawCreateResponse): CreatedTicket {
  return {
    id: r.ticket?.id ?? r.id ?? null,
    number: r.ticket?.number ?? r.number ?? null,
    promiseText: r.promiseText ?? r.ticket?.promiseText ?? null,
    nextHumanReplyBy: r.nextHumanReplyBy ?? r.ticket?.nextHumanReplyBy ?? null,
  };
}

export default function PortalNewTicket() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: branding } = useBranding();

  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [created, setCreated] = useState<CreatedTicket | null>(null);

  // Deflection: debounce the subject and look for instant answers — never a gate.
  const debouncedSubject = useDebounced(subject.trim(), 400);
  const { data: suggestions } = useQuery({
    queryKey: ['portal', 'kb-suggest', debouncedSubject],
    queryFn: async () =>
      normalizeKb(
        await api.get<unknown>(`/api/portal/kb?q=${encodeURIComponent(debouncedSubject)}`)
      ).articles.slice(0, 3),
    enabled: !created && debouncedSubject.length >= 3,
  });

  const submit = useMutation({
    mutationFn: (v: { subject: string; body: string }) =>
      api.post<RawCreateResponse>('/api/portal/tickets', v),
    onSuccess: (r) => {
      setCreated(normalizeCreated(r));
      void queryClient.invalidateQueries({ queryKey: ['portal', 'tickets'] });
      window.scrollTo({ top: 0 });
    },
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (submit.isPending) return;
    submit.mutate({ subject: subject.trim(), body: body.trim() });
  }

  // ---------- Success screen: the ticket number + THE PROMISE, front and center ----------
  if (created) {
    const promise =
      created.promiseText ??
      (created.nextHumanReplyBy
        ? `A real person will reply by ${formatReplyBy(created.nextHumanReplyBy)}.`
        : (branding?.humanPromise ?? DEFAULT_HUMAN_LINE));
    return (
      <div className="max-w-xl mx-auto">
        <Card className="p-6 sm:p-8 text-center">
          <CheckCircle2 size={40} className="mx-auto text-green-600" />
          <h1 className="mt-3 text-xl font-bold text-gray-900">
            Got it{created.number != null ? ` — ticket #${created.number}` : ''}
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            Your request is in front of our team now.
          </p>

          <div className="mt-5 flex items-start gap-2.5 rounded-xl bg-brand-soft px-4 py-3.5 text-left">
            <HeartHandshake size={18} className="shrink-0 text-brand mt-0.5" />
            <p className="text-sm font-medium text-brand">{promise}</p>
          </div>

          <div className="mt-6 flex flex-col sm:flex-row items-center justify-center gap-2">
            {created.id && (
              <Link to={`/portal/tickets/${created.id}`}>
                <Button>
                  View your ticket
                  <ArrowRight size={14} />
                </Button>
              </Link>
            )}
            <Link to="/portal">
              <Button variant="secondary">Back to my tickets</Button>
            </Link>
          </div>
        </Card>
      </div>
    );
  }

  // ---------- The form ----------
  return (
    <div className="max-w-xl mx-auto">
      <PageHeader
        title="New ticket"
        subtitle="Tell us what's going on — a real person will pick it up."
      />

      <form onSubmit={handleSubmit}>
        <Card className="p-4 sm:p-5 space-y-4">
          <label className="block">
            <span className="text-sm font-medium text-gray-700">Subject</span>
            <Input
              className="mt-1"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="e.g. Can't download my invoice"
              autoFocus
              required
              maxLength={200}
            />
          </label>

          {/* Deflection cards — helpful, never a gate. */}
          {suggestions && suggestions.length > 0 && (
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
              <p className="flex items-center gap-1.5 text-xs font-medium text-gray-600">
                <BookOpen size={13} className="text-brand" />
                These might answer it instantly
              </p>
              <div className="mt-2 space-y-1.5">
                {suggestions.map((a) => (
                  <Link
                    key={a.id}
                    to={`/portal/kb/${a.slug}`}
                    target="_blank"
                    rel="noreferrer"
                    className="block rounded-lg bg-white border border-gray-200 px-3 py-2 hover:border-brand/40 hover:bg-brand-soft/30"
                  >
                    <p className="text-sm font-medium text-gray-800">{a.title}</p>
                    {a.snippet && (
                      <p className="text-xs text-gray-500 truncate">{stripTags(a.snippet)}</p>
                    )}
                  </Link>
                ))}
              </div>
              <p className="mt-2 text-xs text-gray-500">
                Opens in a new tab — your draft stays right here. Not what you need?{' '}
                <span className="font-medium text-gray-700">
                  No thanks, I want a human — just finish the form below.
                </span>
              </p>
            </div>
          )}

          <label className="block">
            <span className="text-sm font-medium text-gray-700">What happened?</span>
            <Textarea
              className="mt-1"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={7}
              placeholder="The more detail, the faster we can help…"
              required
            />
            <span className="block text-xs text-gray-400 mt-1">
              Markdown works: **bold**, `code`, lists, links.
            </span>
          </label>

          {submit.isError && (
            <p className="text-sm text-red-600">
              {submit.error instanceof ApiError
                ? submit.error.message
                : "Couldn't send that — please try again."}
            </p>
          )}

          {/* Always-available path to a human — never gatekeep. */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-2">
            <Button type="submit" disabled={submit.isPending} className="justify-center">
              {submit.isPending
                ? 'Sending…'
                : suggestions && suggestions.length > 0
                  ? 'No thanks, I want a human'
                  : 'Send to a human'}
            </Button>
            <span className="text-xs text-gray-400">
              A real person reads every ticket — never a bot.
            </span>
          </div>
        </Card>
      </form>
    </div>
  );
}
