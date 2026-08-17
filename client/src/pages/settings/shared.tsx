/**
 * Shared types, reference-data hooks and small helpers for the Settings area.
 * Reference fetches tolerate endpoints other modules haven't built yet (404/501)
 * and reference data the current role can't read (403) by falling back to empty.
 */
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, ApiError } from '@/api/client';
import { cx } from '@/lib/ui';

export async function getOr<T>(url: string, fallback: T): Promise<T> {
  try {
    return await api.get<T>(url);
  } catch (err) {
    if (err instanceof ApiError && [403, 404, 501].includes(err.status)) return fallback;
    throw err;
  }
}

export function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : 'Something went wrong';
}

// ---------- Domain types ----------

export type StaffRole = 'admin' | 'supervisor' | 'agent' | 'collaborator';
export type TicketPriority = 'low' | 'normal' | 'high' | 'urgent';

export const PRIORITIES: TicketPriority[] = ['low', 'normal', 'high', 'urgent'];
export const CHANNELS = ['email', 'portal', 'chat', 'api', 'internal'];
export const STATUSES = ['new', 'open', 'waiting_on_customer', 'on_hold', 'solved', 'closed'];
export const SLA_METRICS = ['first_response', 'next_response', 'resolution'];

export interface StaffUser {
  id: string;
  name: string;
  email: string | null;
  role: StaffRole | null;
  scope?: 'all' | 'team' | 'assigned' | null;
  title: string | null;
  timezone: string;
  active: boolean;
  teamIds: string[];
}

export interface Team {
  id: string;
  name: string;
  emoji: string | null;
  scheduleId: string | null;
  memberIds: string[];
}

export interface ScheduleInterval {
  weekday: number;
  startMinute: number;
  endMinute: number;
}

export interface Schedule {
  id: string;
  name: string;
  timezone: string;
  isDefault: boolean;
  holidayCalendarId: string | null;
  intervals: ScheduleInterval[];
}

export interface HolidayCalendar {
  id: string;
  name: string;
  countryCode: string | null;
  holidays: { id: string; name: string; date: string }[];
}

export interface SlaTarget {
  metric: string;
  priority: TicketPriority;
  minutes: number;
  useBusinessHours: boolean;
}

export interface SlaEscalation {
  metric: string;
  level: number;
  minutesOffset: number;
  notifyAssignee: boolean;
  notifySupervisors: boolean;
}

export interface SlaPolicy {
  id: string;
  name: string;
  description: string | null;
  position: number;
  conditions: { priorities?: string[]; channels?: string[]; companyTiers?: string[]; tags?: string[] };
  scheduleId: string | null;
  enabled: boolean;
  targets: SlaTarget[];
  escalations: SlaEscalation[];
}

export interface Webhook {
  id: string;
  name: string;
  url: string;
  secret?: string | null;
  events: string[];
  enabled: boolean;
}

export interface SopListItem {
  id: string;
  kind: string;
  title: string;
  status: string;
}

// ---------- Reference-data hooks ----------

export function useStaff() {
  return useQuery({
    queryKey: ['settings', 'staff'],
    queryFn: () => getOr<{ items: StaffUser[] }>('/api/users?kind=staff', { items: [] }),
  });
}

export function useTeams() {
  return useQuery({
    queryKey: ['settings', 'teams'],
    queryFn: () => getOr<{ items: Team[] }>('/api/users/teams', { items: [] }),
  });
}

export function useSchedules() {
  return useQuery({
    queryKey: ['settings', 'schedules'],
    queryFn: () => getOr<{ items: Schedule[] }>('/api/schedules', { items: [] }),
  });
}

export function useHolidayCalendars() {
  return useQuery({
    queryKey: ['settings', 'holiday-calendars'],
    queryFn: () => getOr<{ items: HolidayCalendar[] }>('/api/schedules/holiday-calendars', { items: [] }),
  });
}

export function useSlaPolicies() {
  return useQuery({
    queryKey: ['settings', 'sla-policies'],
    queryFn: () => getOr<{ items: SlaPolicy[] }>('/api/sla/policies', { items: [] }),
  });
}

export function useWebhooksList() {
  return useQuery({
    queryKey: ['settings', 'webhooks'],
    queryFn: () => getOr<{ items: Webhook[] }>('/api/settings/webhooks', { items: [] }),
  });
}

export function useSopsList() {
  return useQuery({
    queryKey: ['settings', 'sops'],
    queryFn: () => getOr<{ items: SopListItem[] }>('/api/sops', { items: [] }),
  });
}

// ---------- Small UI helpers ----------

export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: React.ReactNode;
  hint?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  // A div, not a <label>: several callers nest checkbox lists, and a wrapping
  // label would toggle the first checkbox when the caption is clicked.
  return (
    <div className={cx('block', className)}>
      <span className="block text-xs font-medium text-gray-600 mb-1">{label}</span>
      {children}
      {hint && <span className="block text-xs text-gray-400 mt-1">{hint}</span>}
    </div>
  );
}

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null;
  return <p className="text-sm text-red-600 mt-2">{errMsg(error)}</p>;
}

export function Loading() {
  return <div className="py-10 text-center text-sm text-gray-400">Loading…</div>;
}

/** Compact multi-select as a scrollable checkbox list. */
export function CheckboxList({
  options,
  value,
  onChange,
  className,
  disabled,
}: {
  options: { value: string; label: string }[];
  value: string[];
  onChange: (next: string[]) => void;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <div className={cx('space-y-1 max-h-36 overflow-y-auto rounded-lg border border-gray-200 p-2 bg-white', className)}>
      {options.length === 0 && <p className="text-xs text-gray-400">None available</p>}
      {options.map((o) => (
        <label key={o.value} className="flex items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            disabled={disabled}
            checked={value.includes(o.value)}
            onChange={(e) =>
              onChange(e.target.checked ? [...value, o.value] : value.filter((v) => v !== o.value))
            }
          />
          <span className="truncate">{o.label}</span>
        </label>
      ))}
    </div>
  );
}

// ---------- Plain helpers ----------

export const toCsv = (arr: string[] | null | undefined): string => (arr ?? []).join(', ');

export const fromCsv = (s: string): string[] =>
  s
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);

export function minutesToTime(m: number): string {
  const clamped = Math.max(0, Math.min(24 * 60, m));
  return `${String(Math.floor(clamped / 60)).padStart(2, '0')}:${String(clamped % 60).padStart(2, '0')}`;
}

export function timeToMinutes(t: string): number {
  const [h = 0, m = 0] = t.split(':').map((n) => Number(n) || 0);
  return h * 60 + m;
}

export function listTimezones(): string[] {
  try {
    return Intl.supportedValuesOf('timeZone');
  } catch {
    return ['UTC', 'Australia/Sydney', 'America/New_York', 'America/Los_Angeles', 'Europe/London'];
  }
}

export const ROLE_COLORS: Record<StaffRole, 'purple' | 'blue' | 'green' | 'gray'> = {
  admin: 'purple',
  supervisor: 'blue',
  agent: 'green',
  collaborator: 'gray',
};

export function labelize(s: string): string {
  return s.replace(/[_.]/g, ' ');
}
