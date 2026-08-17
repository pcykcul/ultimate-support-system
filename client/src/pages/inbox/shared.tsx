/**
 * Shared types + small helpers for the agent inbox.
 * Types mirror the /api/tickets contract in docs/development/conventions.md.
 */
import { Badge } from '@/lib/ui';

export type TicketStatus =
  | 'new'
  | 'open'
  | 'waiting_on_customer'
  | 'on_hold'
  | 'solved'
  | 'closed';
export type TicketPriority = 'low' | 'normal' | 'high' | 'urgent';
export type SlaMetric = 'first_response' | 'next_response' | 'periodic_update' | 'resolution';

export interface TicketListItem {
  id: string;
  number: number;
  subject: string;
  status: TicketStatus;
  priority: TicketPriority;
  channel: string;
  requester: { id: string; name: string; email: string | null };
  company: { id: string; name: string } | null;
  assignee: { id: string; name: string } | null;
  teamId: string | null;
  tags: string[];
  nextSlaDueAt: string | null;
  slaBreached: boolean;
  firstResponseDueAt: string | null;
  nextResponseDueAt: string | null;
  resolutionDueAt: string | null;
  lastCustomerReplyAt: string | null;
  updatedAt: string;
  createdAt: string;
}

export interface TicketMessage {
  id: string;
  kind: 'public' | 'internal' | 'system';
  author: {
    id: string;
    name: string;
    title: string | null;
    avatarUrl: string | null;
    kind: 'staff' | 'customer';
  } | null;
  body: string;
  createdAt: string;
}

export interface TicketEvent {
  id: string;
  type: string;
  actorId?: string | null;
  actorName?: string | null;
  actor?: { id: string; name: string } | null;
  data?: Record<string, unknown> | null;
  createdAt: string;
}

/** The server sends followers either as ids or small objects; accept both. */
export type TicketFollower = string | { userId?: string; id?: string; name?: string };

export interface TicketDetailResponse {
  ticket: TicketListItem;
  messages: TicketMessage[];
  events: TicketEvent[];
  followers: TicketFollower[];
  requesterLocalTime: { label: string; isDaytime: boolean; isBusinessHoursGuess: boolean } | null;
  sla: { policyName: string | null };
  runs: { id: string; sopId: string; sopTitle: string; status: string }[];
}

export interface MacroItem {
  id: string;
  name: string;
  body: string;
  actions?: Record<string, unknown>;
  sopId?: string | null;
}

export interface MacroApplyResult {
  body: string;
  sop?: { sopId: string; sopTitle: string } | null;
  sopId?: string | null;
  sopTitle?: string | null;
}

export interface StaffUser {
  id: string;
  name: string;
  email: string | null;
  role: string;
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

type BadgeColor = 'gray' | 'blue' | 'green' | 'yellow' | 'red' | 'purple' | 'brand';

export const STATUS_META: Record<TicketStatus, { label: string; color: BadgeColor }> = {
  new: { label: 'New', color: 'blue' },
  open: { label: 'Open', color: 'green' },
  waiting_on_customer: { label: 'Waiting on customer', color: 'yellow' },
  on_hold: { label: 'On hold', color: 'purple' },
  solved: { label: 'Solved', color: 'gray' },
  closed: { label: 'Closed', color: 'gray' },
};

export const ALL_STATUSES: TicketStatus[] = [
  'new',
  'open',
  'waiting_on_customer',
  'on_hold',
  'solved',
  'closed',
];

export const PRIORITY_META: Record<TicketPriority, { label: string; color: BadgeColor }> = {
  low: { label: 'Low', color: 'gray' },
  normal: { label: 'Normal', color: 'blue' },
  high: { label: 'High', color: 'yellow' },
  urgent: { label: 'Urgent', color: 'red' },
};

export const ALL_PRIORITIES: TicketPriority[] = ['low', 'normal', 'high', 'urgent'];

export function StatusBadge({ status }: { status: TicketStatus }) {
  const meta = STATUS_META[status] ?? { label: status, color: 'gray' as const };
  return <Badge color={meta.color}>{meta.label}</Badge>;
}

export function PriorityBadge({ priority }: { priority: TicketPriority }) {
  const meta = PRIORITY_META[priority] ?? { label: priority, color: 'gray' as const };
  return <Badge color={meta.color}>{meta.label}</Badge>;
}

export function isFollowing(followers: TicketFollower[], userId: string): boolean {
  return followers.some((f) =>
    typeof f === 'string' ? f === userId : (f.userId ?? f.id) === userId
  );
}
