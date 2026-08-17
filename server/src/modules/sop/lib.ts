/**
 * Shared SOP helpers: slugs, staleness, run instantiation, trigger parsing, and the
 * read-and-sign assignment machinery (emails + the re-acknowledgment loop on publish).
 */
import { and, asc, eq, inArray, isNotNull, like, lt, or } from 'drizzle-orm';
import { db, schema } from '../../db/index.js';
import { bus } from '../../lib/events.js';
import { sendTemplatedMail } from '../../lib/mailer.js';
import { config } from '../../config.js';

export type Sop = typeof schema.sops.$inferSelect;
export type SopStep = typeof schema.sopSteps.$inferSelect;
export type SopRun = typeof schema.sopRuns.$inferSelect;
export type SopRunStep = typeof schema.sopRunSteps.$inferSelect;
export type SopAssignment = typeof schema.sopAssignments.$inferSelect;

// ---------- Slugs ----------

export function slugify(input: string): string {
  const slug = input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // strip combining diacritics after NFKD decomposition
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/, '');
  return slug || 'untitled';
}

/** sops.slug is globally unique: pick `base`, or `base-2`, `base-3`, … */
export async function uniqueSopSlug(title: string): Promise<string> {
  const s = schema.sops;
  const base = slugify(title);
  const rows = await db
    .select({ slug: s.slug })
    .from(s)
    .where(or(eq(s.slug, base), like(s.slug, `${base}-%`)));
  const taken = new Set(rows.map((r) => r.slug));
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

// ---------- Staleness ----------

/** Stale = a verify interval is set and the SOP was never verified, or the interval has lapsed. */
export function isStale(
  verifyIntervalDays: number | null,
  verifiedAt: Date | null,
  now: Date = new Date()
): boolean {
  if (!verifyIntervalDays) return false;
  if (!verifiedAt) return true;
  return verifiedAt.getTime() + verifyIntervalDays * 86_400_000 < now.getTime();
}

// ---------- Steps ----------

export interface StepSnapshot {
  position: number;
  title: string;
  body: string | null;
  roleHint: string | null;
}

export async function loadSteps(sopId: string): Promise<SopStep[]> {
  return db
    .select()
    .from(schema.sopSteps)
    .where(eq(schema.sopSteps.sopId, sopId))
    .orderBy(asc(schema.sopSteps.position));
}

/** The jsonb shape stored in sop_revisions.steps. */
export function snapshotSteps(steps: SopStep[]): StepSnapshot[] {
  return steps.map((s) => ({
    position: s.position,
    title: s.title,
    body: s.body,
    roleHint: s.roleHint,
  }));
}

/** Best-effort parse of a revision's steps jsonb (null when absent/malformed). */
export function parseStepsSnapshot(raw: unknown): StepSnapshot[] | null {
  if (!Array.isArray(raw)) return null;
  const out: StepSnapshot[] = [];
  for (let i = 0; i < raw.length; i += 1) {
    const item = raw[i] as Record<string, unknown> | null;
    if (!item || typeof item !== 'object' || typeof item.title !== 'string') return null;
    out.push({
      position: typeof item.position === 'number' ? item.position : i + 1,
      title: item.title,
      body: typeof item.body === 'string' ? item.body : null,
      roleHint: typeof item.roleHint === 'string' ? item.roleHint : null,
    });
  }
  return out;
}

// ---------- Triggers ----------

/** Auto-instantiate config stored in sops.triggers jsonb. */
export interface TriggerConfig {
  onSlaBreach?: boolean;
  onPriority?: string;
  onTags?: string[];
}

export function parseTriggers(raw: unknown): TriggerConfig {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const o = raw as Record<string, unknown>;
  return {
    onSlaBreach: o.onSlaBreach === true,
    onPriority: typeof o.onPriority === 'string' ? o.onPriority : undefined,
    onTags: Array.isArray(o.onTags)
      ? o.onTags.filter((t): t is string => typeof t === 'string')
      : undefined,
  };
}

// ---------- Run instantiation ----------

export interface StartRunOptions {
  ticketId?: string | null;
  startedById?: string | null;
  /** True when a ticket-state trigger (not a person) started the run. */
  auto?: boolean;
  /** Which event fired the auto-start, for the audit trail. */
  trigger?: string;
}

/**
 * Instantiate a run: snapshot the SOP's current steps into sop_run_steps, link the ticket
 * (with a ticket_events audit row) and emit 'sop.run_started'.
 */
export async function startRun(
  sop: Pick<Sop, 'id' | 'title' | 'version'>,
  opts: StartRunOptions = {}
): Promise<{ run: SopRun; steps: SopRunStep[] }> {
  const steps = await loadSteps(sop.id);
  const [run] = await db
    .insert(schema.sopRuns)
    .values({
      sopId: sop.id,
      sopVersion: sop.version,
      ticketId: opts.ticketId ?? null,
      startedById: opts.startedById ?? null,
    })
    .returning();
  if (!run) throw new Error('Failed to create SOP run');

  let runSteps: SopRunStep[] = [];
  if (steps.length > 0) {
    runSteps = await db
      .insert(schema.sopRunSteps)
      .values(
        steps.map((s) => ({ runId: run.id, stepId: s.id, position: s.position, title: s.title }))
      )
      .returning();
    runSteps.sort((a, b) => a.position - b.position);
  }

  if (run.ticketId) {
    await db.insert(schema.ticketEvents).values({
      ticketId: run.ticketId,
      actorId: opts.startedById ?? null,
      type: 'sop_run_started',
      data: {
        runId: run.id,
        sopId: sop.id,
        sopTitle: sop.title,
        sopVersion: sop.version,
        auto: opts.auto ?? false,
        ...(opts.trigger ? { trigger: opts.trigger } : {}),
      },
    });
  }

  bus.emitEvent('sop.run_started', {
    runId: run.id,
    sopId: sop.id,
    ticketId: run.ticketId,
    auto: opts.auto ?? false,
  });

  return { run, steps: runSteps };
}

// ---------- Assignments ----------

/**
 * Labeled read-and-sign notification. Uses the customizable template machinery: admins can
 * override subject/body via settings emailTemplates.sop_assignment (vars: sop.title,
 * sop.version, sop.url, assignee.name, assignment.dueLine).
 */
export async function sendAssignmentEmail(
  user: { name: string; email: string | null },
  sop: Pick<Sop, 'id' | 'title' | 'version'>,
  dueAt: Date | null
): Promise<void> {
  if (!user.email) return;
  const url = `${config.appUrl}/sops/${sop.id}`;
  const dueLine = dueAt ? `\nPlease acknowledge by ${dueAt.toISOString().slice(0, 10)}.` : '';
  await sendTemplatedMail('sop_assignment', user.email, {
    subject: `[Action required] Read & acknowledge: ${sop.title} (v${sop.version})`,
    body: [
      `Hi ${user.name},`,
      '',
      `You have been assigned to read and acknowledge the SOP "${sop.title}" (version ${sop.version}).${dueLine}`,
      '',
      `Read and sign here: ${url}`,
      '',
      '(This is an automated notification — the SOP itself is written and verified by real people.)',
    ].join('\n'),
    'sop.title': sop.title,
    'sop.version': sop.version,
    'sop.url': url,
    'assignee.name': user.name,
    'assignment.dueLine': dueLine,
  });
}

/**
 * Re-acknowledgment loop: when a new version of an acknowledgment-required SOP is published,
 * everyone who signed a previous version gets a fresh assignment for the current version.
 * Idempotent — users who already have a current-version assignment are skipped.
 */
export async function ensureReacknowledgments(sop: Sop): Promise<void> {
  if (!sop.requiresAcknowledgment) return;
  const a = schema.sopAssignments;

  const previous = await db
    .select({ userId: a.userId })
    .from(a)
    .where(and(eq(a.sopId, sop.id), lt(a.sopVersion, sop.version), isNotNull(a.acknowledgedAt)));
  const candidateIds = [...new Set(previous.map((p) => p.userId))];
  if (candidateIds.length === 0) return;

  const current = await db
    .select({ userId: a.userId })
    .from(a)
    .where(and(eq(a.sopId, sop.id), eq(a.sopVersion, sop.version)));
  const already = new Set(current.map((c) => c.userId));
  const neededIds = candidateIds.filter((id) => !already.has(id));
  if (neededIds.length === 0) return;

  const u = schema.users;
  const assignees = await db
    .select({ id: u.id, name: u.name, email: u.email })
    .from(u)
    .where(and(inArray(u.id, neededIds), eq(u.kind, 'staff'), eq(u.active, true)));
  if (assignees.length === 0) return;

  await db
    .insert(schema.sopAssignments)
    .values(assignees.map((user) => ({ sopId: sop.id, userId: user.id, sopVersion: sop.version })))
    .onConflictDoNothing();
  for (const user of assignees) {
    await sendAssignmentEmail(user, sop, null);
  }
}
