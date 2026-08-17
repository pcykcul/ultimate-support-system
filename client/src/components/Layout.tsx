import { useEffect, useState } from 'react';
import { NavLink, Outlet, Navigate, useLocation } from 'react-router-dom';
import {
  Inbox,
  BookOpen,
  ClipboardList,
  BarChart3,
  Settings,
  LogOut,
  HeartHandshake,
  Menu,
  X,
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

function NavItems({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav className="flex-1 py-3 px-2 space-y-0.5">
      {NAV.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          onClick={onNavigate}
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
  );
}

export default function Layout() {
  const { data: me, isLoading } = useMe();
  const { data: branding } = useBranding();
  const logout = useLogout();
  const location = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    if (branding) {
      applyBrandColors(branding.colors);
      document.title = branding.name || 'Support';
    }
  }, [branding]);

  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname]);

  if (isLoading) {
    return <div className="h-full flex items-center justify-center text-gray-400">Loading…</div>;
  }
  if (!me) return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  if (me.kind !== 'staff') return <Navigate to="/portal" replace />;

  const brandMark = branding?.logoUrl ? (
    <img src={branding.logoUrl} alt="" className="h-7 w-7 rounded" />
  ) : (
    <div className="h-7 w-7 rounded bg-brand text-brand-fg flex items-center justify-center font-bold text-sm">
      {(branding?.name ?? 'S')[0]}
    </div>
  );

  return (
    <div className="h-full flex flex-col md:flex-row">
      {/* Mobile top bar */}
      <header className="md:hidden flex items-center justify-between bg-white border-b border-gray-200 px-3 py-2.5 sticky top-0 z-40">
        <button
          className="p-2 -ml-1 text-gray-600 hover:bg-gray-100 rounded-lg"
          onClick={() => setDrawerOpen(true)}
          aria-label="Open menu"
        >
          <Menu size={20} />
        </button>
        <div className="flex items-center gap-2 min-w-0">
          {brandMark}
          <span className="font-semibold truncate">{branding?.name ?? 'Support'}</span>
        </div>
        <button
          onClick={logout}
          title="Sign out"
          aria-label="Sign out"
          className="p-2 -mr-1 text-gray-400 hover:text-gray-700 rounded-lg hover:bg-gray-100"
        >
          <LogOut size={18} />
        </button>
      </header>

      {/* Mobile drawer */}
      {drawerOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-black/40" onClick={() => setDrawerOpen(false)} />
          <aside className="relative w-64 max-w-[80vw] bg-white h-full flex flex-col shadow-xl">
            <div className="px-4 py-4 border-b border-gray-100 flex items-center justify-between">
              <div className="flex items-center gap-2 min-w-0">
                {brandMark}
                <span className="font-semibold truncate">{branding?.name ?? 'Support'}</span>
              </div>
              <button
                className="p-1.5 text-gray-400 hover:text-gray-700 rounded-lg hover:bg-gray-100"
                onClick={() => setDrawerOpen(false)}
                aria-label="Close menu"
              >
                <X size={18} />
              </button>
            </div>
            <NavItems onNavigate={() => setDrawerOpen(false)} />
            <div className="px-4 py-3 border-t border-gray-100">
              <p className="text-sm font-medium truncate">{me.name}</p>
              <p className="text-xs text-gray-500 capitalize">{me.role}</p>
            </div>
          </aside>
        </div>
      )}

      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-56 shrink-0 bg-white border-r border-gray-200 flex-col">
        <div className="px-4 py-4 border-b border-gray-100 flex items-center gap-2">
          {brandMark}
          <span className="font-semibold truncate">{branding?.name ?? 'Support'}</span>
        </div>
        <NavItems />
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
        <div className="max-w-6xl mx-auto p-3 sm:p-6">
          <Outlet />
        </div>
      </main>
      <CommandPalette />
    </div>
  );
}
