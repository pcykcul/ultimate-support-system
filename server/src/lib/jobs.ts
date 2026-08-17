/**
 * Postgres-backed job queue: SLA reminders/escalations, webhook deliveries, digest emails.
 * A single in-process poller — no Redis required. Handlers are registered by modules at boot.
 */
import { and, asc, eq, lte, sql as dsql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';

type JobRow = typeof schema.jobs.$inferSelect;
type Handler = (payload: Record<string, unknown>, job: JobRow) => Promise<void>;

const handlers = new Map<string, Handler>();
let timer: ReturnType<typeof setInterval> | null = null;

export function registerJobHandler(type: string, handler: Handler): void {
  handlers.set(type, handler);
}

export async function enqueueJob(
  type: string,
  payload: Record<string, unknown>,
  opts: { runAt?: Date; dedupeKey?: string } = {}
): Promise<void> {
  await db
    .insert(schema.jobs)
    .values({
      type,
      payload,
      runAt: opts.runAt ?? new Date(),
      dedupeKey: opts.dedupeKey ?? null,
    })
    .onConflictDoNothing();
}

async function claimDueJobs(limit: number): Promise<JobRow[]> {
  // Atomic claim so a crashed run can't double-execute after restart within the same instance.
  const rows = await db
    .update(schema.jobs)
    .set({ status: 'running', attempts: dsql`${schema.jobs.attempts} + 1` })
    .where(
      and(
        eq(schema.jobs.status, 'pending'),
        lte(schema.jobs.runAt, new Date())
      )
    )
    .returning();
  return rows.sort((a, b) => a.runAt.getTime() - b.runAt.getTime()).slice(0, limit);
}

async function runOnce(): Promise<void> {
  const due = await claimDueJobs(20);
  for (const job of due) {
    const handler = handlers.get(job.type);
    try {
      if (!handler) throw new Error(`No handler for job type "${job.type}"`);
      await handler(job.payload as Record<string, unknown>, job);
      await db.update(schema.jobs).set({ status: 'done' }).where(eq(schema.jobs.id, job.id));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const giveUp = job.attempts >= 5;
      await db
        .update(schema.jobs)
        .set({
          status: giveUp ? 'failed' : 'pending',
          lastError: message,
          runAt: giveUp ? job.runAt : new Date(Date.now() + Math.min(job.attempts, 5) * 60_000),
        })
        .where(eq(schema.jobs.id, job.id));
    }
  }
}

export function startJobRunner(intervalMs = 15_000): void {
  if (timer) return;
  timer = setInterval(() => {
    runOnce().catch((err) => console.error('job runner error', err));
  }, intervalMs);
  timer.unref();
}

export function stopJobRunner(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
