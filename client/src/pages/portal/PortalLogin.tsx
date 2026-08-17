/**
 * Customer portal sign-in / sign-up. A single centered card with the instance
 * branding and the human line underneath — the first thing a customer reads
 * should already be the promise that people, not bots, answer here.
 */
import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { HeartHandshake } from 'lucide-react';
import { api, ApiError } from '@/api/client';
import { Button, Card, Input, cx } from '@/lib/ui';
import { applyBrandColors, useBranding, type Me } from '@/lib/session';
import { DEFAULT_HUMAN_LINE } from './shared';

type Tab = 'signin' | 'register';

export default function PortalLogin() {
  const { data: branding } = useBranding();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [tab, setTab] = useState<Tab>('signin');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (branding) {
      applyBrandColors(branding.colors, branding.font);
      document.title = branding.name || 'Support';
    }
  }, [branding]);

  function switchTab(next: Tab) {
    setTab(next);
    setError(null);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (tab === 'register') {
        await api.post('/api/portal/register', { email, name, password });
      }
      const user = await api.post<Me>('/api/auth/login', { email, password });
      queryClient.setQueryData(['me'], user);
      await queryClient.invalidateQueries({ queryKey: ['me'] });
      navigate(user.kind === 'staff' ? '/' : '/portal', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong — please try again');
      setSubmitting(false);
    }
  }

  const productName = branding?.name ?? 'Support';

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center gap-2 mb-6">
          {branding?.logoUrl ? (
            <img src={branding.logoUrl} alt="" className="h-10 w-10 rounded-lg" />
          ) : (
            <div className="h-10 w-10 rounded-lg bg-brand text-brand-fg flex items-center justify-center font-bold text-lg">
              {productName[0]}
            </div>
          )}
          <h1 className="text-lg font-semibold text-gray-900">{productName}</h1>
          <p className="text-sm text-gray-500 -mt-1">Customer support portal</p>
        </div>

        <Card className="overflow-hidden">
          {/* Tabs */}
          <div className="grid grid-cols-2 border-b border-gray-200">
            {(
              [
                { value: 'signin', label: 'Sign in' },
                { value: 'register', label: 'Create account' },
              ] as { value: Tab; label: string }[]
            ).map((t) => (
              <button
                key={t.value}
                type="button"
                onClick={() => switchTab(t.value)}
                className={cx(
                  'py-2.5 text-sm font-medium transition-colors',
                  tab === t.value
                    ? 'text-brand border-b-2 border-brand bg-brand-soft/40'
                    : 'text-gray-500 hover:text-gray-800'
                )}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="p-6">
            <p className="text-sm text-gray-500 mb-4">
              {tab === 'signin'
                ? 'Welcome back — sign in to see your tickets and talk to us.'
                : "Takes half a minute. Then you can reach a real person whenever you're stuck."}
            </p>

            <form onSubmit={handleSubmit} className="space-y-3">
              {tab === 'register' && (
                <label className="block">
                  <span className="text-sm font-medium text-gray-700">Your name</span>
                  <Input
                    className="mt-1"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Jane Citizen"
                    autoComplete="name"
                    autoFocus
                    required
                  />
                </label>
              )}

              <label className="block">
                <span className="text-sm font-medium text-gray-700">Email</span>
                <Input
                  className="mt-1"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  autoComplete="email"
                  autoFocus={tab === 'signin'}
                  required
                />
              </label>

              <label className="block">
                <span className="text-sm font-medium text-gray-700">
                  {tab === 'register' ? 'Choose a password' : 'Password'}
                </span>
                <Input
                  className="mt-1"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete={tab === 'register' ? 'new-password' : 'current-password'}
                  minLength={tab === 'register' ? 8 : undefined}
                  required
                />
                {tab === 'register' && (
                  <span className="block text-xs text-gray-400 mt-1">At least 8 characters.</span>
                )}
              </label>

              {error && <p className="text-sm text-red-600">{error}</p>}

              <Button type="submit" className="w-full justify-center" disabled={submitting}>
                {submitting
                  ? tab === 'register'
                    ? 'Creating your account…'
                    : 'Signing in…'
                  : tab === 'register'
                    ? 'Create account'
                    : 'Sign in'}
              </Button>
            </form>
          </div>
        </Card>

        {/* The human line — the whole point of this product, right under the door. */}
        <p className="mt-4 flex items-center justify-center gap-1.5 text-sm text-gray-500 text-center">
          <HeartHandshake size={15} className="shrink-0 text-brand" />
          {branding?.humanPromise ?? DEFAULT_HUMAN_LINE}
        </p>
      </div>
    </div>
  );
}
