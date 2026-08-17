import { useEffect } from 'react';
import { NavLink, Outlet, Navigate, useLocation } from 'react-router-dom';
import {
  Inbox,
  BookOpen,
  ClipboardList,
  BarChart3,
  Settings,
  LogOut,
  HeartHandshake,
} from 'lucide-react';
import { useMe, useBranding, useLogout, applyBrandColors } from '../lib/session';
import CommandPalette from './CommandPalette';
import { cx } from '../lib/ui';

const NAV = [
  { to: '/inbox', label: 'Inbox', icon: Inbox },
  { to: '/kb', label: 'Knowledge Base', icon: BookOpen },
  { to: '/sops', label: 'SOPs', icon: ClipboardList },
  { to: '/reports', label: 'Reports', icon: BarChart3 },
  { to: '/settings', label: 'Settings', icon: Settings },
];

export default function Layout() {
  const { data: me, isLoading } = useMe();
  const { data: branding } = useBranding();
  const logout = useLogout();
  const location = useLocation();

  useEffect(() => {
    if (branding) {
      applyBrandColors(branding.colors);
      document.title = branding.name || 'Support';
    }
  }, [branding]);

  if (isLoading) {
    return <div className="h-full flex items-center justify-center text-gray-400">Loading…</div>;
  }
  if (!me) return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  if (me.kind !== 'staff') return <Navigate to="/portal" replace />;

  return (
    <div className="h-full flex">
      <aside className="w-56 shrink-0 bg-white border-r border-gray-200 flex flex-col">
        <div className="px-4 py-4 border-b border-gray-100 flex items-center gap-2">
          {branding?.logoUrl ? (
            <img src={branding.logoUrl} alt="" className="h-7 w-7 rounded" />
          ) : (
            <div className="h-7 w-7 rounded bg-brand text-brand-fg flex items-center justify-center font-bold text-sm">
              {(branding?.name ?? 'S')[0]}
            </div>
          )}
          <span className="font-semibold truncate">{branding?.name ?? 'Support'}</span>
        </div>
        <nav className="flex-1 py-3 px-2 space-y-0.5">
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                cx(
                  'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium',
                  isActive ? 'bg-brand-soft text-brand' : 'text-gray-600 hover:bg-gray-100'
                )
              }
            >
              <Icon size={17} />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="px-3 py-2 border-t border-gray-100 text-[11px] text-gray-400 flex items-center gap-1.5">
          <HeartHandshake size={13} className="shrink-0" />
          <span>100% human support. No AI, ever.</span>
        </div>
        <div className="px-3 py-3 border-t border-gray-100 flex items-center justify-between">
          <div className="min-w-0">
            <p className="text-sm font-medium truncate">{me.name}</p>
            <p className="text-xs text-gray-500 capitalize">{me.role}</p>
          </div>
          <button
            onClick={logout}
            title="Sign out"
            className="text-gray-400 hover:text-gray-700 p-1.5 rounded-lg hover:bg-gray-100"
          >
            <LogOut size={16} />
          </button>
        </div>
      </aside>
      <main className="flex-1 min-w-0 overflow-y-auto">
        <div className="max-w-6xl mx-auto p-6">
          <Outlet />
        </div>
      </main>
      <CommandPalette />
    </div>
  );
}
