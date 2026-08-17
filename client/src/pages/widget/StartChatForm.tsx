/**
 * Start-a-chat form. Name and email are optional — we never make a person
 * fill in a form gauntlet before they can reach a human.
 */
import { useState } from 'react';
import { MessageCircle } from 'lucide-react';
import { api, ApiError } from '@/api/client';
import { Button, Input, Textarea } from '@/lib/ui';
import type { ChatStartResponse } from './shared';

export default function StartChatForm({
  onStarted,
}: {
  onStarted: (res: ChatStartResponse, firstMessage: string) => void;
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const body = message.trim();
    if (!body || sending) return;
    setSending(true);
    setError(null);
    try {
      const payload: { name?: string; email?: string; message: string } = { message: body };
      if (name.trim()) payload.name = name.trim();
      if (email.trim()) payload.email = email.trim();
      const res = await api.post<ChatStartResponse>('/api/chat/start', payload);
      onStarted(res, body);
    } catch (err) {
      setError(
        err instanceof ApiError && err.message
          ? err.message
          : 'Could not start the chat — please check your connection and try again.'
      );
      setSending(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex-1 min-h-0 overflow-y-auto px-4 py-4">
      <h2 className="text-base font-semibold text-gray-900">Talk to a human</h2>
      <p className="text-xs text-gray-500 mt-0.5">
        A real person will read this — no bots on the other end.
      </p>

      <label className="block mt-4">
        <span className="text-xs font-medium text-gray-600">
          Name <span className="font-normal text-gray-400">(optional)</span>
        </span>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your name"
          autoComplete="name"
          className="mt-1"
        />
      </label>

      <label className="block mt-3">
        <span className="text-xs font-medium text-gray-600">
          Email <span className="font-normal text-gray-400">(optional)</span>
        </span>
        <Input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          autoComplete="email"
          className="mt-1"
        />
        <span className="block text-[11px] text-gray-400 mt-1">So we can follow up if you leave.</span>
      </label>

      <label className="block mt-3">
        <span className="text-xs font-medium text-gray-600">Message</span>
        <Textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="How can we help?"
          rows={4}
          required
          className="mt-1"
        />
      </label>

      {error && <p className="text-xs text-red-600 mt-2">{error}</p>}

      <Button
        type="submit"
        disabled={!message.trim() || sending}
        className="w-full justify-center py-2 mt-4"
      >
        <MessageCircle size={15} />
        {sending ? 'Starting…' : 'Start chat'}
      </Button>
    </form>
  );
}
