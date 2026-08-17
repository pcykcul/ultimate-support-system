import { useEffect } from 'react';
import { NavLink, Outlet, Navigate } from 'react-router-dom';
import { useMe, useBranding, useLogout, applyBrandColors } from '../lib/session';
import { cx } from '../lib/ui';

export default function PortalLayout() {
  const { data: me, isLoading } = useMe();
  const { data: branding } = useBranding();
  const logout = useLogout();

  useEffect(() => {
    if (branding) {
      applyBrandColors(branding.colors, branding.font);
      document.title = branding.helpCenterTitle || branding.name || 'Support';
    }
  }, [branding]);

  if (isLoading) {
    return <div className="h-full flex items-center justify-center text-gray-400">Loading…</div>;
  }
  if (!me) return <Navigate to="/portal/login" replace />;

  return (
    <div className="min-h-full bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-4xl mx-auto px-4 py-3 flex flex-wrap items-center justify-between gap-y-2">
          <div className="flex items-center gap-2.5">
            {branding?.logoUrl ? (
              <img src={branding.logoUrl} alt="" className="h-8 w-8 rounded" />
            ) : (
              <div className="h-8 w-8 rounded bg-brand text-brand-fg flex items-center justify-center font-bold">
                {(branding?.name ?? 'S')[0]}
              </div>
            )}
            <span className="font-semibold">{branding?.name ?? 'Support'}</span>
          </div>
          <nav className="flex items-center gap-1 overflow-x-auto max-w-full">
            {[
              { to: '/portal', label: 'My tickets', end: true },
              { to: '/portal/new', label: 'New ticket' },
              { to: '/portal/kb', label: 'Help articles' },
            ].map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  cx(
                    'px-3 py-1.5 rounded-lg text-sm font-medium',
                    isActive ? 'bg-brand-soft text-brand' : 'text-gray-600 hover:bg-gray-100'
                  )
                }
              >
                {item.label}
              </NavLink>
            ))}
            <button onClick={logout} className="ml-2 text-sm text-gray-500 hover:text-gray-800">
              Sign out
            </button>
          </nav>
        </div>
      </header>
      {branding?.humanPromise && (
        <div className="bg-brand-soft/60">
          <div className="max-w-4xl mx-auto px-4 py-2 text-sm text-brand">{branding.humanPromise}</div>
        </div>
      )}
      <main className="max-w-4xl mx-auto px-4 py-6">
        <Outlet />
      </main>
      <footer className="max-w-4xl mx-auto px-4 py-6 text-xs text-gray-400">
        Every reply here is written by a real person — never a bot.
      </footer>
    </div>
  );
}
