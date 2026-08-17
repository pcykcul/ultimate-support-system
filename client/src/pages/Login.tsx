import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { HeartHandshake } from 'lucide-react';
import { api, ApiError } from '@/api/client';
import { Button, Card, Input } from '@/lib/ui';
import { applyBrandColors, useBranding, type Me } from '@/lib/session';

export default function LoginPage() {
  const { data: branding } = useBranding();
  const [searchParams] = useSearchParams();
  const inviteToken = searchParams.get('invite');
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (branding) {
      applyBrandColors(branding.colors);
      document.title = branding.name || 'Support';
    }
  }, [branding]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const user = inviteToken
        ? await api.post<Me>('/api/auth/accept-invite', { token: inviteToken, name, password })
        : await api.post<Me>('/api/auth/login', { email, password });
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
        </div>

        <Card className="p-6">
          <h2 className="font-semibold text-gray-900">
            {inviteToken ? 'Finish setting up your account' : 'Sign in'}
          </h2>
          <p className="text-sm text-gray-500 mt-0.5 mb-4">
            {inviteToken
              ? 'You were invited to the team. Choose how your name appears and set a password.'
              : 'Welcome back — sign in to continue.'}
          </p>

          <form onSubmit={handleSubmit} className="space-y-3">
            {inviteToken ? (
              <label className="block">
                <span className="text-sm font-medium text-gray-700">Your name</span>
                <Input
                  className="mt-1"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Jane Citizen"
                  autoFocus
                  required
                />
              </label>
            ) : (
              <label className="block">
                <span className="text-sm font-medium text-gray-700">Email</span>
                <Input
                  className="mt-1"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  autoComplete="email"
                  autoFocus
                  required
                />
              </label>
            )}

            <label className="block">
              <span className="text-sm font-medium text-gray-700">
                {inviteToken ? 'Choose a password' : 'Password'}
              </span>
              <Input
                className="mt-1"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={inviteToken ? 'new-password' : 'current-password'}
                minLength={inviteToken ? 8 : undefined}
                required
              />
              {inviteToken && (
                <span className="block text-xs text-gray-400 mt-1">At least 8 characters.</span>
              )}
            </label>

            {error && <p className="text-sm text-red-600">{error}</p>}

            <Button type="submit" className="w-full justify-center" disabled={submitting}>
              {submitting
                ? inviteToken
                  ? 'Creating your account…'
                  : 'Signing in…'
                : inviteToken
                  ? 'Create account'
                  : 'Sign in'}
            </Button>
          </form>
        </Card>

        <p className="mt-4 flex items-center justify-center gap-1.5 text-sm text-gray-500">
          <HeartHandshake size={15} className="shrink-0" />
          Every reply here comes from a real person.
        </p>
      </div>
    </div>
  );
}
