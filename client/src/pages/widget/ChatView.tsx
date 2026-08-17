/**
 * Live chat: SSE message stream + composer. Staff bubbles carry the agent's
 * real name and title — the visitor always knows a human is on the other end.
 *
 * Connection handling: the browser's EventSource auto-retries transient drops;
 * when it gives up (fatal close, e.g. non-200), we probe the stream URL once —
 * a 401/403/404 means the stored visitor session is dead (clear + go home),
 * anything else schedules a manual reconnect with a visible notice.
 */
import { useEffect, useRef, useState } from 'react';
import { Moon, Send, WifiOff } from 'lucide-react';
import { api, ApiError } from '@/api/client';
import { Button, Textarea, cx, timeAgo } from '@/lib/ui';
import {
  DEFAULT_OFFLINE_PROMISE,
  isStaffMessage,
  nextLocalId,
  toChatMessage,
  type ChatMessage,
  type Presence,
  type StoredChat,
} from './shared';

const RETRY_MS = 3000;

async function probeStreamStatus(url: string): Promise<number> {
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), 5000);
  try {
    const res = await fetch(url, { credentials: 'include', signal: ctrl.signal });
    ctrl.abort(); // we only needed the status — stop the SSE body
    return res.status;
  } catch {
    return 0; // network unreachable — keep retrying
  } finally {
    window.clearTimeout(timer);
  }
}

export default function ChatView({
  chat,
  presence,
  onPresence,
  initialMessages,
  onSessionInvalid,
}: {
  chat: StoredChat;
  presence: Presence | null;
  onPresence: (p: Presence) => void;
  initialMessages: ChatMessage[];
  onSessionInvalid: () => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [connState, setConnState] = useState<'connecting' | 'open' | 'retrying'>('connecting');
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const streamUrl = `/api/chat/${chat.ticketId}/stream?token=${encodeURIComponent(chat.visitorToken)}`;

  // Latest-callback refs so the stream effect doesn't reconnect on parent re-renders.
  const onPresenceRef = useRef(onPresence);
  const onSessionInvalidRef = useRef(onSessionInvalid);
  onPresenceRef.current = onPresence;
  onSessionInvalidRef.current = onSessionInvalid;

  useEffect(() => {
    let disposed = false;
    let es: EventSource | null = null;
    let retryTimer: number | null = null;

    const appendMessages = (incoming: ChatMessage[]) => {
      if (incoming.length === 0) return;
      setMessages((prev) => {
        let next = prev;
        for (const msg of incoming) {
          if (next.some((m) => m.id === msg.id)) continue;
          // The stream echoes our own sends back — replace the optimistic copy.
          const localIdx = isStaffMessage(msg)
            ? -1
            : next.findIndex((m) => m.local && m.body === msg.body);
          if (localIdx >= 0) {
            next = next.slice();
            next[localIdx] = msg;
          } else {
            next = [...next, msg];
          }
        }
        return next;
      });
    };

    // Tolerant ingest: single message, array, {messages:[...]} batch, or a
    // presence update {online, promise} — whatever the stream sends.
    const ingest = (data: string) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(data);
      } catch {
        return; // keep-alive / comment payloads
      }
      if (Array.isArray(parsed)) {
        appendMessages(parsed.map(toChatMessage).filter((m): m is ChatMessage => m !== null));
        return;
      }
      if (parsed && typeof parsed === 'object') {
        const obj = parsed as Record<string, unknown>;
        if (Array.isArray(obj.messages)) {
          appendMessages(
            obj.messages.map(toChatMessage).filter((m): m is ChatMessage => m !== null)
          );
          return;
        }
        if (typeof obj.online === 'boolean' && typeof obj.body !== 'string') {
          onPresenceRef.current({
            online: obj.online,
            promise: typeof obj.promise === 'string' ? obj.promise : DEFAULT_OFFLINE_PROMISE,
          });
          return;
        }
        const single = toChatMessage(parsed);
        if (single) appendMessages([single]);
      }
    };

    const connect = () => {
      if (disposed) return;
      es = new EventSource(streamUrl);
      es.onopen = () => {
        if (!disposed) setConnState('open');
      };
      es.onmessage = (e) => ingest(e.data as string);
      // Named events the server may use alongside the default channel.
      es.addEventListener('history', (e) => ingest((e as MessageEvent).data as string));
      es.addEventListener('presence', (e) => ingest((e as MessageEvent).data as string));
      es.onerror = () => {
        if (disposed || !es) return;
        setConnState('retrying');
        if (es.readyState === EventSource.CLOSED) {
          es.close();
          es = null;
          void probeStreamStatus(streamUrl).then((status) => {
            if (disposed) return;
            if (status === 401 || status === 403 || status === 404) {
              onSessionInvalidRef.current();
              return;
            }
            retryTimer = window.setTimeout(connect, RETRY_MS);
          });
        }
        // readyState CONNECTING → the browser is already retrying on its own.
      };
    };

    connect();
    return () => {
      disposed = true;
      es?.close();
      if (retryTimer !== null) window.clearTimeout(retryTimer);
    };
  }, [streamUrl]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages]);

  const send = async () => {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    setSendError(null);
    const localMsg: ChatMessage = {
      id: nextLocalId(),
      body,
      createdAt: new Date().toISOString(),
      author: null,
      local: true,
    };
    setMessages((prev) => [...prev, localMsg]);
    setDraft('');
    try {
      const res = await api.post<unknown>(`/api/chat/${chat.ticketId}/messages`, {
        token: chat.visitorToken,
        body,
      });
      const serverMsg = toChatMessage(res);
      if (serverMsg) {
        // Adopt the server id so the stream echo dedupes cleanly.
        setMessages((prev) => prev.map((m) => (m.id === localMsg.id ? serverMsg : m)));
      }
    } catch (err) {
      setMessages((prev) => prev.filter((m) => m.id !== localMsg.id));
      setDraft(body);
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
        onSessionInvalidRef.current();
      } else {
        setSendError('Message not sent — check your connection and try again.');
      }
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-gray-50">
      {/* Honest presence banner from the chat/start response */}
      {presence &&
        (presence.online ? (
          <div className="flex items-center gap-2 bg-green-50 border-b border-green-100 px-3 py-2 text-xs font-medium text-green-800 shrink-0">
            <span className="relative flex h-2 w-2 shrink-0">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
            </span>
            Real people online now
          </div>
        ) : (
          <div className="flex items-start gap-2 bg-amber-50 border-b border-amber-100 px-3 py-2 text-xs text-amber-800 shrink-0">
            <Moon size={13} className="shrink-0 mt-0.5" />
            <span>{presence.promise || DEFAULT_OFFLINE_PROMISE}</span>
          </div>
        ))}

      {connState === 'retrying' && (
        <div className="flex items-center gap-1.5 bg-amber-50 border-b border-amber-100 px-3 py-1.5 text-[11px] text-amber-700 shrink-0">
          <WifiOff size={12} className="shrink-0" />
          Connection lost — reconnecting…
        </div>
      )}

      {/* Message list */}
      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-3 flex flex-col gap-3">
        {messages.length === 0 && (
          <p className="text-center text-xs text-gray-400 py-8">
            {connState === 'connecting'
              ? 'Loading your conversation…'
              : 'Welcome back. Send a message and a real person will reply here.'}
          </p>
        )}
        {messages.map((m) => {
          const staff = isStaffMessage(m);
          return (
            <div key={m.id} className={cx('flex', staff ? 'justify-start' : 'justify-end')}>
              <div className={cx('max-w-[85%] flex flex-col', staff ? 'items-start' : 'items-end')}>
                {staff && m.author && (
                  <span className="text-[11px] text-gray-500 mb-0.5 px-1">
                    <span className="font-medium text-gray-700">{m.author.name}</span>
                    {m.author.title ? ` · ${m.author.title}` : ''}
                    <span className="text-green-700"> · real person</span>
                  </span>
                )}
                <div
                  className={cx(
                    'rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap break-words',
                    staff
                      ? 'bg-white border border-gray-200 text-gray-800 rounded-bl-sm'
                      : 'bg-brand text-brand-fg rounded-br-sm'
                  )}
                >
                  {m.body}
                </div>
                <span className="text-[10px] text-gray-400 mt-0.5 px-1">
                  {m.local ? 'sending…' : timeAgo(m.createdAt)}
                </span>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* Composer — always usable, online or not */}
      <div className="border-t border-gray-200 bg-white px-2 py-2 shrink-0">
        {sendError && <p className="text-[11px] text-red-600 px-1.5 pb-1">{sendError}</p>}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
          className="flex items-end gap-1.5"
        >
          <div className="flex-1 min-w-0">
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              placeholder="Write a message…"
              rows={1}
              className="resize-none max-h-28"
              aria-label="Chat message"
            />
          </div>
          <Button type="submit" disabled={!draft.trim() || sending} aria-label="Send message" className="py-2">
            <Send size={15} />
          </Button>
        </form>
      </div>
    </div>
  );
}
