/**
 * Embeddable support widget — a standalone, iframe-sized surface (~380x600,
 * fully fluid). No app chrome: it renders inside an <iframe> on customers'
 * own sites. Three states in one flow:
 *   home  → search-first deflection (human path never gated behind search)
 *   start → tiny form to open a chat with a real person
 *   chat  → live SSE chat; returning visitors resume via localStorage
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ArrowLeft, Check, Copy, LifeBuoy, MessageCircle } from 'lucide-react';
import { applyBrandColors, useBranding } from '@/lib/session';
import { Button, cx } from '@/lib/ui';
import ChatView from './ChatView';
import HomeView from './HomeView';
import StartChatForm from './StartChatForm';
import {
  clearStoredChat,
  loadStoredChat,
  nextLocalId,
  saveStoredChat,
  type ChatMessage,
  type ChatStartResponse,
  type Presence,
  type StoredChat,
} from './shared';

type WidgetState = 'home' | 'start' | 'chat';

export default function WidgetPage() {
  const { data: branding } = useBranding();
  const [params] = useSearchParams();
  const showEmbedHint = params.get('embed') === 'demo';

  // Resume flow: a stored chat jumps straight back into the conversation.
  const [stored, setStored] = useState<StoredChat | null>(loadStoredChat);
  const [state, setState] = useState<WidgetState>(stored ? 'chat' : 'home');
  const [presence, setPresence] = useState<Presence | null>(null);
  const [seedMessages, setSeedMessages] = useState<ChatMessage[]>([]);

  useEffect(() => {
    if (branding) {
      applyBrandColors(branding.colors ?? null, branding.font ?? null);
      document.title = branding.name ? `${branding.name} — Support` : 'Support';
    }
  }, [branding]);

  const handleStarted = useCallback((res: ChatStartResponse, firstMessage: string) => {
    const chat: StoredChat = { ticketId: res.ticketId, visitorToken: res.visitorToken };
    saveStoredChat(chat);
    setStored(chat);
    setPresence({ online: res.online, promise: res.promise });
    setSeedMessages([
      {
        id: nextLocalId(),
        body: firstMessage,
        createdAt: new Date().toISOString(),
        author: null,
        local: true,
      },
    ]);
    setState('chat');
  }, []);

  // The stored visitor session is dead (stream/post 401) — clear and go home.
  const handleSessionInvalid = useCallback(() => {
    clearStoredChat();
    setStored(null);
    setPresence(null);
    setSeedMessages([]);
    setState('home');
  }, []);

  const embedSnippet = useMemo(
    () =>
      `<iframe src="${window.location.origin}/widget" width="380" height="600" style="border:0;border-radius:12px" title="Support"></iframe>`,
    []
  );
  const [copied, setCopied] = useState(false);
  const copySnippet = async () => {
    try {
      await navigator.clipboard.writeText(embedSnippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard may be blocked inside the iframe — the snippet is selectable */
    }
  };

  return (
    <div className="h-screen w-full flex flex-col bg-gray-50 overflow-hidden">
      {/* Compact header — no app chrome */}
      <header className="flex items-center gap-2 bg-white border-b border-gray-200 px-3 py-2.5 shrink-0">
        {state !== 'home' && (
          <button
            onClick={() => setState('home')}
            aria-label="Back to help"
            className="-ml-1 rounded p-1 text-gray-400 hover:text-gray-700 hover:bg-gray-100"
          >
            <ArrowLeft size={16} />
          </button>
        )}
        {branding?.logoUrl ? (
          <img src={branding.logoUrl} alt="" className="h-6 w-6 rounded shrink-0" />
        ) : (
          <span className="flex h-6 w-6 items-center justify-center rounded bg-brand text-brand-fg shrink-0">
            <LifeBuoy size={13} />
          </span>
        )}
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-900 truncate">{branding?.name ?? 'Support'}</p>
          <p className="text-[10px] leading-tight text-gray-400">
            {state === 'chat' ? 'Live chat with our team' : 'We answer in person'}
          </p>
        </div>
      </header>

      {/* Body: views stay mounted so the chat stream and search state survive
          switching tabs inside the widget. */}
      <main className="flex-1 min-h-0 flex flex-col">
        <div className={cx('flex-1 min-h-0 flex-col', state === 'home' ? 'flex' : 'hidden')}>
          <HomeView promise={branding?.humanPromise} />
        </div>
        {state === 'start' && <StartChatForm onStarted={handleStarted} />}
        {stored && (
          <div className={cx('flex-1 min-h-0 flex-col', state === 'chat' ? 'flex' : 'hidden')}>
            <ChatView
              key={stored.ticketId}
              chat={stored}
              presence={presence}
              onPresence={setPresence}
              initialMessages={seedMessages}
              onSessionInvalid={handleSessionInvalid}
            />
          </div>
        )}
      </main>

      {/* Always-visible human path — never gated behind search */}
      {state === 'home' && (
        <div className="bg-white border-t border-gray-200 px-3 py-2.5 shrink-0">
          <Button
            className="w-full justify-center py-2"
            onClick={() => setState(stored ? 'chat' : 'start')}
          >
            <MessageCircle size={15} />
            {stored ? 'Back to your chat' : 'Talk to a human'}
          </Button>
        </div>
      )}

      {showEmbedHint && (
        <div className="bg-gray-50 px-3 pt-2 shrink-0">
          <div className="rounded-lg border border-dashed border-gray-300 bg-white p-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10px] font-medium uppercase tracking-wide text-gray-500">
                Embed this widget
              </p>
              <button
                onClick={() => void copySnippet()}
                className="inline-flex items-center gap-1 text-[10px] font-medium text-brand hover:opacity-80"
              >
                {copied ? <Check size={11} /> : <Copy size={11} />}
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <pre className="mt-1 overflow-x-auto text-[10px] leading-relaxed text-gray-600">
              <code>{embedSnippet}</code>
            </pre>
          </div>
        </div>
      )}

      <footer className="shrink-0 py-1.5 text-center text-[10px] text-gray-400">
        No bots. No AI. Real humans.
      </footer>
    </div>
  );
}
