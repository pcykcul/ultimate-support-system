/** Shared types, badges and helpers for the SOP area (list, editor/runner, acknowledgments). */
import { Badge } from '@/lib/ui';
import type { Me } from '@/lib/session';

export type SopKind = 'reference' | 'runbook';
export type SopStatus = 'draft' | 'review' | 'published' | 'archived';
export type RunStatus = 'in_progress' | 'completed' | 'cancelled';
export type BadgeColor = 'gray' | 'blue' | 'green' | 'yellow' | 'red' | 'purple' | 'brand';

export const ALL_SOP_STATUSES: SopStatus[] = ['draft', 'review', 'published', 'archived'];
export const TICKET_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;

export const KIND_META: Record<SopKind, { label: string; color: BadgeColor; hint: string }> = {
  reference: {
    label: 'Reference',
    color: 'blue',
    hint: 'A living document the team reads — policies, escalation contacts, product knowledge.',
  },
  runbook: {
    label: 'Runbook',
    color: 'purple',
    hint: 'A step-by-step checklist you run against a ticket or incident, with a full audit trail.',
  },
};

export const STATUS_META: Record<SopStatus, { label: string; color: BadgeColor }> = {
  draft: { label: 'Draft', color: 'gray' },
  review: { label: 'In review', color: 'yellow' },
  published: { label: 'Published', color: 'green' },
  archived: { label: 'Archived', color: 'purple' },
};

export const RUN_STATUS_META: Record<RunStatus, { label: string; color: BadgeColor }> = {
  in_progress: { label: 'In progress', color: 'blue' },
  completed: { label: 'Completed', color: 'green' },
  cancelled: { label: 'Cancelled', color: 'gray' },
};

export function KindBadge({ kind }: { kind: SopKind }) {
  const meta = KIND_META[kind] ?? { label: kind, color: 'gray' as BadgeColor };
  return <Badge color={meta.color}>{meta.label}</Badge>;
}

export function StatusBadge({ status }: { status: SopStatus }) {
  const meta = STATUS_META[status] ?? { label: status, color: 'gray' as BadgeColor };
  return <Badge color={meta.color}>{meta.label}</Badge>;
}

export function RunStatusBadge({ status }: { status: RunStatus }) {
  const meta = RUN_STATUS_META[status] ?? { label: status, color: 'gray' as BadgeColor };
  return <Badge color={meta.color}>{meta.label}</Badge>;
}

/** Collaborators are read-only; everyone else on staff can author and run. */
export function canAct(me: Me | null | undefined): boolean {
  return !!me && me.kind === 'staff' && me.role !== null && me.role !== 'collaborator';
}

export function isSupervisor(me: Me | null | undefined): boolean {
  return !!me && (me.role === 'admin' || me.role === 'supervisor');
}

/** Prefer the server's verdict; fall back to client-side date math. */
export function isStale(s: {
  stale?: boolean;
  verifyIntervalDays?: number | null;
  verifiedAt?: string | null;
}): boolean {
  if (typeof s.stale === 'boolean') return s.stale;
  if (!s.verifyIntervalDays) return false;
  if (!s.verifiedAt) return true;
  return Date.now() - new Date(s.verifiedAt).getTime() > s.verifyIntervalDays * 86_400_000;
}

// ---------- API shapes (per docs/development/conventions.md, sops section) ----------

export interface UserRef {
  id: string;
  name: string;
}

/** Auto-instantiate triggers: runs start automatically when a ticket matches. */
export interface SopTriggers {
  onSlaBreach?: boolean;
  onPriority?: string | null;
  onTags?: string[] | null;
}

export interface AckCoverage {
  acknowledged: number;
  total: number;
}

export interface SopListItem {
  id: string;
  kind: SopKind;
  title: string;
  slug: string;
  status: SopStatus;
  owner: UserRef | null;
  teamId: string | null;
  version: number;
  verifiedAt: string | null;
  verifyIntervalDays: number | null;
  stale: boolean;
  requiresAcknowledgment: boolean;
  stepCount: number;
  updatedAt: string;
  // Optional acknowledgment-coverage counters (server may include them on list rows).
  ackCoverage?: AckCoverage | null;
  acknowledgedCount?: number | null;
  assignmentCount?: number | null;
}

/** Acknowledgment coverage for a list row, whichever shape the server sends. */
export function coverageOf(s: SopListItem): AckCoverage | null {
  if (s.ackCoverage && typeof s.ackCoverage.total === 'number') return s.ackCoverage;
  if (typeof s.acknowledgedCount === 'number' && typeof s.assignmentCount === 'number') {
    return { acknowledged: s.acknowledgedCount, total: s.assignmentCount };
  }
  return null;
}

export interface SopStepRow {
  id?: string;
  position?: number;
  title: string;
  body?: string | null;
  roleHint?: string | null;
}

export interface SopRevisionMeta {
  id: string;
  version: number;
  title: string;
  authorName?: string | null;
  note?: string | null;
  createdAt: string;
  body?: string;
}

export interface SopRunStepRow {
  id: string;
  position: number;
  title: string;
  done: boolean;
  doneAt: string | null;
  note: string | null;
  doneById?: string | null;
  doneBy?: UserRef | null;
  doneByName?: string | null;
}

export function doneByLabel(s: SopRunStepRow): string | null {
  return s.doneBy?.name ?? s.doneByName ?? null;
}

export interface SopRun {
  id: string;
  sopId?: string;
  sopVersion: number;
  status: RunStatus;
  ticketId: string | null;
  ticket?: { id: string; number?: number; subject?: string } | null;
  startedById?: string | null;
  startedBy?: UserRef | null;
  startedByName?: string | null;
  startedAt: string;
  completedAt?: string | null;
  steps?: SopRunStepRow[];
}

export function startedByLabel(r: SopRun): string {
  return r.startedBy?.name ?? r.startedByName ?? (r.startedById ? 'Staff member' : 'Auto-started');
}

export interface MyAssignment {
  sopVersion: number;
  acknowledgedAt: string | null;
}

export interface SopFull {
  id: string;
  kind: SopKind;
  title: string;
  slug: string;
  body: string;
  status: SopStatus;
  ownerId?: string | null;
  owner?: UserRef | null;
  teamId: string | null;
  verifyIntervalDays: number | null;
  verifiedAt: string | null;
  stale?: boolean;
  version: number;
  triggers?: SopTriggers | null;
  requiresAcknowledgment: boolean;
  updatedAt: string;
  steps?: SopStepRow[];
  revisions?: SopRevisionMeta[];
  runs?: SopRun[];
  myAssignment?: MyAssignment | null;
}

type SopDetailRaw = SopFull & { sop?: SopFull };

/** Tolerate both `{...sop, steps, revisions, ...}` and `{sop, steps, revisions, ...}` payload styles. */
export function normalizeSopDetail(raw: SopDetailRaw): SopFull {
  if (raw.sop) {
    return {
      ...raw.sop,
      steps: raw.steps ?? raw.sop.steps ?? [],
      revisions: raw.revisions ?? raw.sop.revisions ?? [],
      runs: raw.runs ?? raw.sop.runs ?? [],
      myAssignment: raw.myAssignment ?? raw.sop.myAssignment ?? null,
    };
  }
  return { ...raw, steps: raw.steps ?? [], revisions: raw.revisions ?? [], runs: raw.runs ?? [] };
}

type RunDetailRaw = SopRun & { run?: SopRun };

/** Tolerate both `{...run, steps}` and `{run, steps}` payload styles. */
export function normalizeRunDetail(raw: RunDetailRaw): SopRun {
  if (raw.run) return { ...raw.run, steps: raw.steps ?? raw.run.steps ?? [] };
  return { ...raw, steps: raw.steps ?? [] };
}

// ---------- Acknowledgments ----------

export interface MyAckRaw {
  id: string;
  sopId?: string;
  sopTitle?: string;
  sopKind?: SopKind;
  sop?: { id: string; title: string; kind?: SopKind };
  sopVersion: number;
  dueAt?: string | null;
  acknowledgedAt?: string | null;
  signatureName?: string | null;
}

export interface MyAck {
  assignmentId: string;
  sopId: string;
  sopTitle: string;
  sopKind: SopKind | null;
  sopVersion: number;
  dueAt: string | null;
  acknowledgedAt: string | null;
  signatureName: string | null;
}

export type MyAcksPayload = { items?: MyAckRaw[]; pending?: MyAckRaw[]; done?: MyAckRaw[] } | MyAckRaw[];

function toMyAck(raw: MyAckRaw): MyAck {
  return {
    assignmentId: raw.id,
    sopId: raw.sopId ?? raw.sop?.id ?? '',
    sopTitle: raw.sopTitle ?? raw.sop?.title ?? 'Untitled SOP',
    sopKind: raw.sopKind ?? raw.sop?.kind ?? null,
    sopVersion: raw.sopVersion,
    dueAt: raw.dueAt ?? null,
    acknowledgedAt: raw.acknowledgedAt ?? null,
    signatureName: raw.signatureName ?? null,
  };
}

/** Split "my assignments" into pending (due-date order) and done (latest first). */
export function normalizeMyAcks(data: MyAcksPayload | undefined): { pending: MyAck[]; done: MyAck[] } {
  if (!data) return { pending: [], done: [] };
  const arr = Array.isArray(data) ? data : undefined;
  const obj = Array.isArray(data) ? undefined : data;
  const all = (arr ?? obj?.items ?? [...(obj?.pending ?? []), ...(obj?.done ?? [])]).map(toMyAck);
  const pending = all
    .filter((a) => !a.acknowledgedAt)
    .sort((a, b) => {
      if (!a.dueAt && !b.dueAt) return 0;
      if (!a.dueAt) return 1;
      if (!b.dueAt) return -1;
      return new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime();
    });
  const done = all
    .filter((a) => a.acknowledgedAt)
    .sort((a, b) => new Date(b.acknowledgedAt!).getTime() - new Date(a.acknowledgedAt!).getTime());
  return { pending, done };
}

/** A row of the supervisor coverage dashboard ("who's current"). */
export interface AckDashboardRow {
  id?: string;
  userId?: string;
  user?: UserRef & { email?: string | null };
  name?: string;
  userName?: string;
  email?: string | null;
  sopVersion?: number;
  version?: number;
  dueAt?: string | null;
  acknowledgedAt?: string | null;
  signatureName?: string | null;
}

export function ackRowName(r: AckDashboardRow): string {
  return r.user?.name ?? r.name ?? r.userName ?? r.email ?? r.user?.email ?? 'Unknown';
}

export function ackRowVersion(r: AckDashboardRow): number | null {
  return r.sopVersion ?? r.version ?? null;
}

export type AckState = 'current' | 'outdated' | 'pending' | 'overdue';

export function ackState(row: AckDashboardRow, currentVersion: number): AckState {
  const v = ackRowVersion(row);
  if (row.acknowledgedAt) return v != null && v < currentVersion ? 'outdated' : 'current';
  if (row.dueAt && new Date(row.dueAt).getTime() < Date.now()) return 'overdue';
  return 'pending';
}

export const ACK_STATE_META: Record<AckState, { label: string; color: BadgeColor }> = {
  current: { label: 'Acknowledged', color: 'green' },
  outdated: { label: 'Outdated version', color: 'yellow' },
  pending: { label: 'Pending', color: 'yellow' },
  overdue: { label: 'Overdue', color: 'red' },
};

// ---------- Steps editor drafts ----------

let stepKeySeq = 0;

export interface SopStepDraft {
  key: string;
  title: string;
  body: string;
  roleHint: string;
}

export function draftFromStep(s?: SopStepRow): SopStepDraft {
  stepKeySeq += 1;
  return {
    key: `step-${stepKeySeq}`,
    title: s?.title ?? '',
    body: s?.body ?? '',
    roleHint: s?.roleHint ?? '',
  };
}

export function draftsEqual(a: SopStepDraft[], b: SopStepDraft[]): boolean {
  if (a.length !== b.length) return false;
  return a.every(
    (s, i) => s.title === b[i].title && s.body === b[i].body && s.roleHint === b[i].roleHint
  );
}

/** Serialize drafts to the PATCH `steps` payload shape. */
export function stepsPayload(drafts: SopStepDraft[]): { title: string; body?: string; roleHint?: string }[] {
  return drafts
    .filter((s) => s.title.trim() !== '' || s.body.trim() !== '')
    .map((s) => ({
      title: s.title.trim() || 'Untitled step',
      ...(s.body.trim() ? { body: s.body.trim() } : {}),
      ...(s.roleHint.trim() ? { roleHint: s.roleHint.trim() } : {}),
    }));
}
