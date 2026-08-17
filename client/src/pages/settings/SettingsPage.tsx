/**
 * Settings hub: left tab nav + nested routes (mounted at /settings/*).
 * Tabs are role-gated: admin-only and supervisor-only sections disappear for
 * lower roles, and /settings redirects to the first tab the viewer can see
 * (branding for admins, per the default order).
 */
import { Navigate, NavLink, Route, Routes } from 'react-router-dom';
import {
  Bell,
  Braces,
  Building2,
  CalendarClock,
  Gauge,
  Mail,
  MailOpen,
  Palette,
  Shuffle,
  Users,
  Webhook,
  Zap,
} from 'lucide-react';
import { useMe } from '@/lib/session';
import { cx, PageHeader } from '@/lib/ui';
import type { StaffRole } from './shared';
import AppearanceSection from './AppearanceSection';
import TeamSection from './TeamSection';
import CompaniesSection from './CompaniesSection';
import SchedulesSection from './SchedulesSection';
import SlaPoliciesSection from './SlaPoliciesSection';
import AutomationsSection from './AutomationsSection';
import AlertsSection from './AlertsSection';
import EmailTemplatesSection from './EmailTemplatesSection';
import WebhooksSection from './WebhooksSection';
import SnippetsSection from './SnippetsSection';
import SynonymsSection from './SynonymsSection';
import EmailLogSection from './EmailLogSection';

type MinRole = 'admin' | 'supervisor' | 'staff';

const TABS: {
  path: string;
  label: string;
  icon: typeof Palette;
  min: MinRole;
  Component: () => JSX.Element;
}[] = [
  { path: 'branding', label: 'Appearance', icon: Palette, min: 'admin', Component: AppearanceSection },
  { path: 'team', label: 'Team', icon: Users, min: 'staff', Component: TeamSection },
  { path: 'companies', label: 'Companies', icon: Building2, min: 'staff', Component: CompaniesSection },
  { path: 'schedules', label: 'Schedules & Holidays', icon: CalendarClock, min: 'supervisor', Component: SchedulesSection },
  { path: 'sla', label: 'SLA Policies', icon: Gauge, min: 'supervisor', Component: SlaPoliciesSection },
  { path: 'automations', label: 'Automations', icon: Zap, min: 'supervisor', Component: AutomationsSection },
  { path: 'alerts', label: 'Alerts', icon: Bell, min: 'admin', Component: AlertsSection },
  { path: 'email-templates', label: 'Email templates', icon: MailOpen, min: 'admin', Component: EmailTemplatesSection },
  { path: 'webhooks', label: 'Webhooks', icon: Webhook, min: 'admin', Component: WebhooksSection },
  { path: 'snippets', label: 'Snippets', icon: Braces, min: 'staff', Component: SnippetsSection },
  { path: 'synonyms', label: 'Synonyms', icon: Shuffle, min: 'staff', Component: SynonymsSection },
  { path: 'email-log', label: 'Email log', icon: Mail, min: 'admin', Component: EmailLogSection },
];

function canSee(min: MinRole, role: StaffRole | null): boolean {
  if (min === 'admin') return role === 'admin';
  if (min === 'supervisor') return role === 'admin' || role === 'supervisor';
  return role !== null;
}

export default function SettingsPage() {
  const { data: me } = useMe();
  if (!me) return null; // Layout guards auth; this only covers the initial render

  const visible = TABS.filter((t) => canSee(t.min, me.role));
  const first = visible[0]?.path ?? 'team';

  return (
    <div>
      <PageHeader title="Settings" subtitle="Configure this install — every feature ships to everyone" />
      <div className="flex flex-col md:flex-row items-start gap-4 md:gap-6">
        {/* Sidebar on desktop; a horizontally scrolling strip at phone widths. */}
        <nav className="w-full md:w-52 shrink-0 flex md:block gap-1 md:gap-0 overflow-x-auto md:overflow-visible pb-1 md:pb-0 md:space-y-0.5">
          {visible.map(({ path, label, icon: Icon }) => (
            <NavLink
              key={path}
              to={path}
              className={({ isActive }) =>
                cx(
                  'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium whitespace-nowrap',
                  isActive ? 'bg-brand-soft text-brand' : 'text-gray-600 hover:bg-gray-100'
                )
              }
            >
              <Icon size={16} />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="flex-1 min-w-0">
          <Routes>
            <Route index element={<Navigate to={first} replace />} />
            {visible.map(({ path, Component }) => (
              <Route key={path} path={path} element={<Component />} />
            ))}
            <Route path="*" element={<Navigate to={first} replace />} />
          </Routes>
        </div>
      </div>
    </div>
  );
}
