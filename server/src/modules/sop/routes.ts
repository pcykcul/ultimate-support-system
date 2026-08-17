/**
 * SOPs — the platform's signature wedge: versioned procedures with checklists (runbooks),
 * ticket-linked runs, supervisor-gated publishing, verification staleness, and
 * read-and-sign acknowledgments (typed-name e-sign) with a re-acknowledgment loop
 * whenever a new version ships.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, asc, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { db, schema } from '../../db/index.js';
import { badRequest, forbidden, notFound, parse } from '../../lib/http.js';
import { requireAgent, requireStaff, requireSupervisor } from '../../lib/auth.js';
import { bus } from '../../lib/events.js';
import {
  ensureReacknowledgments,
  isStale,
  loadSteps,
  parseStepsSnapshot,
  sendAssignmentEmail,
  snapshotSteps,
  startRun,
  uniqueSopSlug,
  type Sop,
  type SopRun,
  type SopRunStep,
  type SopStep,
} from './lib.js';
import { registerSopTriggers } from './triggers.js';

const SOP_KINDS = ['reference', 'runbook'] as const;
const SOP_STATUSES = ['draft', 'review', 'published', 'archived'] as const;
const PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;

const idParams = z.object({ id: z.string().uuid() });
const runParams = z.object({ runId: z.string().uuid() });
const runStepParams = z.object({ runId: z.string().uuid(), stepRunId: z.string().uuid() });

// ---------- Zod schemas ----------

const listQuery = z.object({
  kind: z.string().optional(),
  status: z.string().optional(),
  q: z.string().max(200).optional(),
});

const createSchema = z.object({
  kind: z.enum(SOP_KINDS),
  title: z.string().trim().min(1).max(200),
  body: z.string().max(200_000).optional(),
  teamId: z.string().uuid().nullable().optional(),
});

const stepInputSchema = z.object({
  title: z.string().trim().min(1).max(300),
  body: z.string().max(20_000).nullable().optional(),
  roleHint: z.string().trim().max(60).nullable().optional(),
});

const triggersSchema = z.object({
  onSlaBreach: z.boolean().optional(),
  onPriority: z.enum(PRIORITIES).optional(),
  onTags: z.array(z.string().trim().min(1).max(60)).max(20).optional(),
});

const patchSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  body: z.string().max(200_000).optional(),
  steps: z.array(stepInputSchema).max(100).optional(),
  teamId: z.string().uuid().nullable().optional(),
  ownerId: z.string().uuid().nullable().optional(),
  verifyIntervalDays: z.number().int().positive().max(3650).nullable().optional(),
  triggers: triggersSchema.optional(),
  requiresAcknowledgment: z.boolean().optional(),
});

const rollbackSchema = z.object({ version: z.number().int().positive() });

const runCreateSchema = z.object({ ticketId: z.string().uuid().nullable().optional() });

const runStepPatchSchema = z.object({
  done: z.boolean().optional(),
  note: z.string().max(4000).nullable().optional(),
});

const assignSchema = z.object({
  userIds: z.array(z.string().uuid()).max(200).optional(),
  teamId: z.string().uuid().optional(),
  dueAt: z.coerce.date().optional(),
});

const acknowledgeSchema = z.object({
  signatureName: z.string().trim().min(2).max(120),
});

// ---------- Helpers ----------

/** Split a csv query param and validate each value against an allowed set. */
function csvFilter<T extends string>(raw: string | undefined, allowed: readonly T[]): T[] | null {
  if (!raw) return null;
  const values = raw
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
  if (values.length === 0) return null;
  for (const v of values) {
    if (!(allowed as readonly string[]).includes(v)) throw badRequest(`Invalid filter value: ${v}`);
  }
  return values as T[];
}

function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (c) => `\\${c}`);
}

async function getSop(id: string): Promise<Sop> {
  const rows = await db.select().from(schema.sops).where(eq(schema.sops.id, id)).limit(1);
  if (!rows[0]) throw notFound('SOP');
  return rows[0];
}

function serializeStep(step: SopStep) {
  return {
    id: step.id,
    position: step.position,
    title: step.title,
    body: step.body,
    roleHint: step.roleHint,
  };
}

function serializeRunStep(step: SopRunStep, doneByName: string | null) {
  return {
    id: step.id,
    stepId: step.stepId,
    position: step.position,
    title: step.title,
    done: step.done,
    doneBy: step.doneById && doneByName ? { id: step.doneById, name: doneByName } : null,
    doneAt: step.doneAt,
    note: step.note,
  };
}

async function getRun(runId: string): Promise<SopRun> {
  const rows = await db.select().from(schema.sopRuns).where(eq(schema.sopRuns.id, runId)).limit(1);
  if (!rows[0]) throw notFound('Run');
  return rows[0];
}

/** Full `{run, steps}` payload for run responses: sop title, ticket link, actor names. */
async function loadRunPayload(runId: string) {
  const rows = await db
    .select({ run: schema.sopRuns, sopTitle: schema.sops.title, sopKind: schema.sops.kind })
    .from(schema.sopRuns)
    .innerJoin(schema.sops, eq(schema.sopRuns.sopId, schema.sops.id))
    .where(eq(schema.sopRuns.id, runId))
    .limit(1);
  if (!rows[0]) throw notFound('Run');
  const { run, sopTitle, sopKind } = rows[0];

  let ticket: { id: string; number: number; subject: string } | null = null;
  if (run.ticketId) {
    const [t] = await db
      .select({
        id: schema.tickets.id,
        number: schema.tickets.number,
        subject: schema.tickets.subject,
      })
      .from(schema.tickets)
      .where(eq(schema.tickets.id, run.ticketId))
      .limit(1);
    ticket = t ?? null;
  }

  let startedBy: { id: string; name: string } | null = null;
  if (run.startedById) {
    const [u] = await db
      .select({ id: schema.users.id, name: schema.users.name })
      .from(schema.users)
      .where(eq(schema.users.id, run.startedById))
      .limit(1);
    startedBy = u ?? null;
  }

  const stepRows = await db
    .select({ step: schema.sopRunSteps, doneByName: schema.users.name })
    .from(schema.sopRunSteps)
    .leftJoin(schema.users, eq(schema.sopRunSteps.doneById, schema.users.id))
    .where(eq(schema.sopRunSteps.runId, runId))
    .orderBy(asc(schema.sopRunSteps.position));

  return {
    run: {
      id: run.id,
      sopId: run.sopId,
      sopTitle,
      sopKind,
      sopVersion: run.sopVersion,
      status: run.status,
      ticketId: run.ticketId,
      ticket,
      startedBy,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
    },
    steps: stepRows.map((r) => serializeRunStep(r.step, r.doneByName)),
  };
}

async function saveRevision(
  sop: Pick<Sop, 'id' | 'version' | 'title' | 'body'>,
  steps: SopStep[],
  authorId: string | null,
  note: string | null
): Promise<void> {
  await db.insert(schema.sopRevisions).values({
    sopId: sop.id,
    version: sop.version,
    title: sop.title,
    body: sop.body,
    steps: snapshotSteps(steps),
    authorId,
    note,
  });
}

/**
 * Seeded/legacy SOPs may have no revision row for their current version. Before an edit
 * bumps the version, snapshot the pre-edit content so rollback can always reach it.
 */
async function ensureBaselineRevision(sop: Sop, steps: SopStep[], authorId: string): Promise<void> {
  const existing = await db
    .select({ id: schema.sopRevisions.id })
    .from(schema.sopRevisions)
    .where(
      and(eq(schema.sopRevisions.sopId, sop.id), eq(schema.sopRevisions.version, sop.version))
    )
    .limit(1);
  if (existing[0]) return;
  await saveRevision(sop, steps, authorId, 'baseline snapshot');
}

/** Replace a SOP's steps wholesale (positions renumbered 1..n from array order). */
async function replaceSteps(
  sopId: string,
  steps: Array<z.infer<typeof stepInputSchema>>
): Promise<SopStep[]> {
  await db.delete(schema.sopSteps).where(eq(schema.sopSteps.sopId, sopId));
  if (steps.length === 0) return [];
  const inserted = await db
    .insert(schema.sopSteps)
    .values(
      steps.map((s, i) => ({
        sopId,
        position: i + 1,
        title: s.title,
        body: s.body ?? null,
        roleHint: s.roleHint ?? null,
      }))
    )
    .returning();
  return inserted.sort((a, b) => a.position - b.position);
}

/** Content equality for steps, ignoring positions/ids — order + title/body/roleHint. */
function stepsEqual(existing: SopStep[], incoming: Array<z.infer<typeof stepInputSchema>>): boolean {
  if (existing.length !== incoming.length) return false;
  return existing.every((s, i) => {
    const n = incoming[i]!;
    return s.title === n.title && s.body === (n.body ?? null) && s.roleHint === (n.roleHint ?? null);
  });
}

// ---------- Routes ----------

export default async function routes(app: FastifyInstance): Promise<void> {
  registerSopTriggers();

  const s = schema.sops;
  const asn = schema.sopAssignments;

  // ----- List -----

  app.get('/', { preHandler: requireStaff }, async (req) => {
    const query = parse(listQuery, req.query);
    const kinds = csvFilter(query.kind, SOP_KINDS);
    const statuses = csvFilter(query.status, SOP_STATUSES);
    const conds = [];
    if (kinds) conds.push(inArray(s.kind, kinds));
    if (statuses) conds.push(inArray(s.status, statuses));
    if (query.q && query.q.trim()) {
      const pattern = `%${escapeLike(query.q.trim())}%`;
      conds.push(or(ilike(s.title, pattern), ilike(s.body, pattern)));
    }
    const rows = await db
      .select({
        sop: s,
        ownerName: schema.users.name,
        stepCount: sql<number>`(select count(*)::int from ${schema.sopSteps} where ${schema.sopSteps.sopId} = ${s.id})`,
      })
      .from(s)
      .leftJoin(schema.users, eq(s.ownerId, schema.users.id))
      .where(conds.length > 0 ? and(...conds) : undefined)
      .orderBy(desc(s.updatedAt));
    return {
      items: rows.map(({ sop, ownerName, stepCount }) => ({
        id: sop.id,
        kind: sop.kind,
        title: sop.title,
        slug: sop.slug,
        status: sop.status,
        owner: sop.ownerId && ownerName ? { id: sop.ownerId, name: ownerName } : null,
        teamId: sop.teamId,
        version: sop.version,
        verifiedAt: sop.verifiedAt,
        verifyIntervalDays: sop.verifyIntervalDays,
        stale: isStale(sop.verifyIntervalDays, sop.verifiedAt),
        requiresAcknowledgment: sop.requiresAcknowledgment,
        stepCount,
        updatedAt: sop.updatedAt,
      })),
    };
  });

  // ----- Create -----

  app.post('/', { preHandler: requireAgent }, async (req) => {
    const body = parse(createSchema, req.body);
    if (body.teamId) {
      const [team] = await db
        .select({ id: schema.teams.id })
        .from(schema.teams)
        .where(eq(schema.teams.id, body.teamId))
        .limit(1);
      if (!team) throw badRequest('Team not found');
    }
    const slug = await uniqueSopSlug(body.title);
    const inserted = await db
      .insert(s)
      .values({
        kind: body.kind,
        title: body.title,
        slug,
        body: body.body ?? '',
        teamId: body.teamId ?? null,
        status: 'draft',
        ownerId: req.user!.id,
      })
      .returning();
    const sop = inserted[0]!;
    // v1 snapshot so the very first version is always reachable by rollback.
    await saveRevision(sop, [], req.user!.id, 'created');
    return { ...sop, stale: isStale(sop.verifyIntervalDays, sop.verifiedAt), steps: [] };
  });

  // ----- Get (sop + steps + revisions + myAssignment) -----

  app.get('/:id', { preHandler: requireStaff }, async (req) => {
    const { id } = parse(idParams, req.params);
    const rows = await db
      .select({ sop: s, ownerName: schema.users.name })
      .from(s)
      .leftJoin(schema.users, eq(s.ownerId, schema.users.id))
      .where(eq(s.id, id))
      .limit(1);
    if (!rows[0]) throw notFound('SOP');
    const { sop, ownerName } = rows[0];

    const [steps, revisions, myAssignments] = await Promise.all([
      loadSteps(id),
      db
        .select({
          id: schema.sopRevisions.id,
          version: schema.sopRevisions.version,
          title: schema.sopRevisions.title,
          authorName: schema.users.name,
          note: schema.sopRevisions.note,
          createdAt: schema.sopRevisions.createdAt,
        })
        .from(schema.sopRevisions)
        .leftJoin(schema.users, eq(schema.sopRevisions.authorId, schema.users.id))
        .where(eq(schema.sopRevisions.sopId, id))
        .orderBy(desc(schema.sopRevisions.version), desc(schema.sopRevisions.createdAt)),
      db
        .select()
        .from(asn)
        .where(and(eq(asn.sopId, id), eq(asn.userId, req.user!.id)))
        .orderBy(desc(asn.sopVersion)),
    ]);

    // Prefer the current version's assignment; otherwise the latest one they had.
    const mine = myAssignments.find((a) => a.sopVersion === sop.version) ?? myAssignments[0] ?? null;

    return {
      ...sop,
      stale: isStale(sop.verifyIntervalDays, sop.verifiedAt),
      owner: sop.ownerId && ownerName ? { id: sop.ownerId, name: ownerName } : null,
      steps: steps.map(serializeStep),
      stepCount: steps.length,
      revisions,
      myAssignment: mine
        ? {
            id: mine.id,
            sopVersion: mine.sopVersion,
            acknowledgedAt: mine.acknowledgedAt,
            dueAt: mine.dueAt,
            signatureName: mine.signatureName,
          }
        : null,
    };
  });

  // ----- Patch (bumps version + snapshots a revision on content change) -----

  app.patch('/:id', { preHandler: requireAgent }, async (req) => {
    const { id } = parse(idParams, req.params);
    const body = parse(patchSchema, req.body);
    const sop = await getSop(id);
    const user = req.user!;

    if (body.teamId) {
      const [team] = await db
        .select({ id: schema.teams.id })
        .from(schema.teams)
        .where(eq(schema.teams.id, body.teamId))
        .limit(1);
      if (!team) throw badRequest('Team not found');
    }
    if (body.ownerId) {
      const [owner] = await db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(and(eq(schema.users.id, body.ownerId), eq(schema.users.kind, 'staff')))
        .limit(1);
      if (!owner) throw badRequest('Owner must be a staff user');
    }

    const existingSteps = await loadSteps(id);
    const titleChanged = body.title !== undefined && body.title !== sop.title;
    const bodyChanged = body.body !== undefined && body.body !== sop.body;
    const stepsChanged = body.steps !== undefined && !stepsEqual(existingSteps, body.steps);
    const contentChanged = titleChanged || bodyChanged || stepsChanged;

    const updates: Partial<typeof s.$inferInsert> = { updatedAt: new Date() };
    if (body.title !== undefined) updates.title = body.title;
    if (body.body !== undefined) updates.body = body.body;
    if (body.teamId !== undefined) updates.teamId = body.teamId;
    if (body.ownerId !== undefined) updates.ownerId = body.ownerId;
    if (body.verifyIntervalDays !== undefined) updates.verifyIntervalDays = body.verifyIntervalDays;
    if (body.triggers !== undefined) updates.triggers = body.triggers;
    if (body.requiresAcknowledgment !== undefined) {
      updates.requiresAcknowledgment = body.requiresAcknowledgment;
    }

    if (contentChanged) {
      await ensureBaselineRevision(sop, existingSteps, user.id);
      updates.version = sop.version + 1;
    }

    const updatedRows = await db.update(s).set(updates).where(eq(s.id, id)).returning();
    const updated = updatedRows[0]!;

    const finalSteps = stepsChanged ? await replaceSteps(id, body.steps!) : existingSteps;
    if (contentChanged) await saveRevision(updated, finalSteps, user.id, 'edited');

    return {
      ...updated,
      stale: isStale(updated.verifyIntervalDays, updated.verifiedAt),
      steps: finalSteps.map(serializeStep),
      stepCount: finalSteps.length,
    };
  });

  // ----- Lifecycle: publish (supervisor gate) / verify / rollback -----

  app.post('/:id/publish', { preHandler: requireSupervisor }, async (req) => {
    const { id } = parse(idParams, req.params);
    await getSop(id);
    const updatedRows = await db
      .update(s)
      .set({ status: 'published', updatedAt: new Date() })
      .where(eq(s.id, id))
      .returning();
    const published = updatedRows[0]!;
    // Re-acknowledgment loop: signers of previous versions must sign the new one.
    await ensureReacknowledgments(published);
    return { ...published, stale: isStale(published.verifyIntervalDays, published.verifiedAt) };
  });

  app.post('/:id/verify', { preHandler: requireAgent }, async (req) => {
    const { id } = parse(idParams, req.params);
    const sop = await getSop(id);
    const user = req.user!;
    const isSupervisor = user.role === 'admin' || user.role === 'supervisor';
    if (!isSupervisor && sop.ownerId !== user.id) {
      throw forbidden('Only the SOP owner or a supervisor can verify it');
    }
    const updatedRows = await db
      .update(s)
      .set({ verifiedAt: new Date() })
      .where(eq(s.id, id))
      .returning();
    const verified = updatedRows[0]!;
    return { ...verified, stale: isStale(verified.verifyIntervalDays, verified.verifiedAt) };
  });

  app.post('/:id/rollback', { preHandler: requireAgent }, async (req) => {
    const { id } = parse(idParams, req.params);
    const { version } = parse(rollbackSchema, req.body);
    const sop = await getSop(id);
    const revRows = await db
      .select()
      .from(schema.sopRevisions)
      .where(and(eq(schema.sopRevisions.sopId, id), eq(schema.sopRevisions.version, version)))
      .orderBy(desc(schema.sopRevisions.createdAt))
      .limit(1);
    const revision = revRows[0];
    if (!revision) throw notFound('Revision');

    const existingSteps = await loadSteps(id);
    await ensureBaselineRevision(sop, existingSteps, req.user!.id);

    const updatedRows = await db
      .update(s)
      .set({
        title: revision.title,
        body: revision.body,
        version: sop.version + 1,
        updatedAt: new Date(),
      })
      .where(eq(s.id, id))
      .returning();
    const updated = updatedRows[0]!;

    // Restore the version's step snapshot when it exists; otherwise steps stay as-is.
    const revSteps = parseStepsSnapshot(revision.steps);
    const finalSteps = revSteps
      ? await replaceSteps(
          id,
          revSteps.map((st) => ({ title: st.title, body: st.body, roleHint: st.roleHint }))
        )
      : existingSteps;

    // The restore itself becomes a new version, so history stays append-only.
    await saveRevision(updated, finalSteps, req.user!.id, `rollback to v${version}`);

    return {
      ...updated,
      stale: isStale(updated.verifyIntervalDays, updated.verifiedAt),
      steps: finalSteps.map(serializeStep),
      stepCount: finalSteps.length,
    };
  });

  // ----- Runs -----

  app.post('/:id/runs', { preHandler: requireStaff }, async (req) => {
    const { id } = parse(idParams, req.params);
    const body = parse(runCreateSchema, req.body ?? {});
    const sop = await getSop(id);
    if (body.ticketId) {
      const [ticket] = await db
        .select({ id: schema.tickets.id })
        .from(schema.tickets)
        .where(eq(schema.tickets.id, body.ticketId))
        .limit(1);
      if (!ticket) throw badRequest('Ticket not found');
    }
    const { run } = await startRun(sop, {
      ticketId: body.ticketId ?? null,
      startedById: req.user!.id,
    });
    return loadRunPayload(run.id);
  });

  app.get('/runs/:runId', { preHandler: requireStaff }, async (req) => {
    const { runId } = parse(runParams, req.params);
    return loadRunPayload(runId);
  });

  app.patch('/runs/:runId/steps/:stepRunId', { preHandler: requireStaff }, async (req) => {
    const { runId, stepRunId } = parse(runStepParams, req.params);
    const body = parse(runStepPatchSchema, req.body);
    const run = await getRun(runId);
    if (run.status !== 'in_progress') throw badRequest('Run is not in progress');

    const stepRows = await db
      .select()
      .from(schema.sopRunSteps)
      .where(and(eq(schema.sopRunSteps.id, stepRunId), eq(schema.sopRunSteps.runId, runId)))
      .limit(1);
    const step = stepRows[0];
    if (!step) throw notFound('Run step');

    const updates: Partial<typeof schema.sopRunSteps.$inferInsert> = {};
    if (body.done !== undefined && body.done !== step.done) {
      updates.done = body.done;
      updates.doneById = body.done ? req.user!.id : null;
      updates.doneAt = body.done ? new Date() : null;
    }
    if (body.note !== undefined) updates.note = body.note;

    const updated =
      Object.keys(updates).length > 0
        ? (
            await db
              .update(schema.sopRunSteps)
              .set(updates)
              .where(eq(schema.sopRunSteps.id, stepRunId))
              .returning()
          )[0]!
        : step;

    let doneByName: string | null = null;
    if (updated.doneById) {
      const [u] = await db
        .select({ name: schema.users.name })
        .from(schema.users)
        .where(eq(schema.users.id, updated.doneById))
        .limit(1);
      doneByName = u?.name ?? null;
    }
    return serializeRunStep(updated, doneByName);
  });

  app.post('/runs/:runId/complete', { preHandler: requireStaff }, async (req) => {
    const { runId } = parse(runParams, req.params);
    const run = await getRun(runId);
    if (run.status === 'completed') return loadRunPayload(runId);
    if (run.status !== 'in_progress') throw badRequest('Run is not in progress');

    await db
      .update(schema.sopRuns)
      .set({ status: 'completed', completedAt: new Date() })
      .where(eq(schema.sopRuns.id, runId));

    const [sop] = await db.select().from(s).where(eq(s.id, run.sopId)).limit(1);
    if (run.ticketId) {
      await db.insert(schema.ticketEvents).values({
        ticketId: run.ticketId,
        actorId: req.user!.id,
        type: 'sop_run_completed',
        data: { runId: run.id, sopId: run.sopId, sopTitle: sop?.title ?? null },
      });
    }
    bus.emitEvent('sop.run_completed', {
      runId: run.id,
      sopId: run.sopId,
      ticketId: run.ticketId,
    });
    return loadRunPayload(runId);
  });

  app.post('/runs/:runId/cancel', { preHandler: requireStaff }, async (req) => {
    const { runId } = parse(runParams, req.params);
    const run = await getRun(runId);
    if (run.status === 'cancelled') return loadRunPayload(runId);
    if (run.status !== 'in_progress') throw badRequest('Run is not in progress');

    await db
      .update(schema.sopRuns)
      .set({ status: 'cancelled', completedAt: new Date() })
      .where(eq(schema.sopRuns.id, runId));

    if (run.ticketId) {
      const [sop] = await db.select({ title: s.title }).from(s).where(eq(s.id, run.sopId)).limit(1);
      await db.insert(schema.ticketEvents).values({
        ticketId: run.ticketId,
        actorId: req.user!.id,
        type: 'sop_run_cancelled',
        data: { runId: run.id, sopId: run.sopId, sopTitle: sop?.title ?? null },
      });
    }
    return loadRunPayload(runId);
  });

  // ----- Assignments (read-and-sign) -----

  app.post('/:id/assign', { preHandler: requireSupervisor }, async (req) => {
    const { id } = parse(idParams, req.params);
    const body = parse(assignSchema, req.body);
    if ((!body.userIds || body.userIds.length === 0) && !body.teamId) {
      throw badRequest('Provide userIds and/or teamId');
    }
    const sop = await getSop(id);

    const candidateIds = new Set(body.userIds ?? []);
    if (body.teamId) {
      const [team] = await db
        .select({ id: schema.teams.id })
        .from(schema.teams)
        .where(eq(schema.teams.id, body.teamId))
        .limit(1);
      if (!team) throw badRequest('Team not found');
      const members = await db
        .select({ userId: schema.teamMembers.userId })
        .from(schema.teamMembers)
        .where(eq(schema.teamMembers.teamId, body.teamId));
      for (const m of members) candidateIds.add(m.userId);
    }
    if (candidateIds.size === 0) return { created: 0, skipped: 0, items: [] };

    const assignees = await db
      .select({ id: schema.users.id, name: schema.users.name, email: schema.users.email })
      .from(schema.users)
      .where(
        and(
          inArray(schema.users.id, [...candidateIds]),
          eq(schema.users.kind, 'staff'),
          eq(schema.users.active, true)
        )
      );
    if (assignees.length === 0) return { created: 0, skipped: 0, items: [] };

    const existing = await db
      .select({ userId: asn.userId })
      .from(asn)
      .where(
        and(
          eq(asn.sopId, id),
          eq(asn.sopVersion, sop.version),
          inArray(
            asn.userId,
            assignees.map((u) => u.id)
          )
        )
      );
    const already = new Set(existing.map((e) => e.userId));
    const toCreate = assignees.filter((u) => !already.has(u.id));

    const dueAt = body.dueAt ?? null;
    let items: (typeof asn.$inferSelect)[] = [];
    if (toCreate.length > 0) {
      items = await db
        .insert(asn)
        .values(
          toCreate.map((u) => ({ sopId: id, userId: u.id, sopVersion: sop.version, dueAt }))
        )
        .onConflictDoNothing()
        .returning();
      for (const u of toCreate) {
        await sendAssignmentEmail(u, sop, dueAt);
      }
    }
    return { created: items.length, skipped: assignees.length - items.length, items };
  });

  app.post('/:id/acknowledge', { preHandler: requireStaff }, async (req) => {
    const { id } = parse(idParams, req.params);
    const { signatureName } = parse(acknowledgeSchema, req.body);
    const sop = await getSop(id);
    const rows = await db
      .select()
      .from(asn)
      .where(
        and(eq(asn.sopId, id), eq(asn.userId, req.user!.id), eq(asn.sopVersion, sop.version))
      )
      .limit(1);
    const assignment = rows[0];
    if (!assignment) throw forbidden('You are not assigned to acknowledge this SOP version');
    if (assignment.acknowledgedAt) return assignment; // already signed — idempotent
    const updated = await db
      .update(asn)
      .set({ acknowledgedAt: new Date(), signatureName })
      .where(eq(asn.id, assignment.id))
      .returning();
    return updated[0];
  });

  // ----- My acknowledgments (pending + done, with sop titles) -----

  app.get('/acknowledgments/mine', { preHandler: requireStaff }, async (req) => {
    const rows = await db
      .select({
        assignment: asn,
        sopTitle: s.title,
        sopKind: s.kind,
        currentVersion: s.version,
      })
      .from(asn)
      .innerJoin(s, eq(asn.sopId, s.id))
      .where(eq(asn.userId, req.user!.id))
      .orderBy(desc(asn.createdAt));
    const serialize = (r: (typeof rows)[number]) => ({
      id: r.assignment.id,
      sopId: r.assignment.sopId,
      sopTitle: r.sopTitle,
      sopKind: r.sopKind,
      sopVersion: r.assignment.sopVersion,
      currentVersion: r.currentVersion,
      isCurrent: r.assignment.sopVersion === r.currentVersion,
      dueAt: r.assignment.dueAt,
      acknowledgedAt: r.assignment.acknowledgedAt,
      signatureName: r.assignment.signatureName,
      createdAt: r.assignment.createdAt,
    });
    return {
      pending: rows.filter((r) => !r.assignment.acknowledgedAt).map(serialize),
      done: rows.filter((r) => r.assignment.acknowledgedAt).map(serialize),
    };
  });

  // ----- Acknowledgment dashboard (supervisor): who's current + coverage % -----

  app.get('/:id/acknowledgments', { preHandler: requireSupervisor }, async (req) => {
    const { id } = parse(idParams, req.params);
    const sop = await getSop(id);
    const rows = await db
      .select({ assignment: asn, name: schema.users.name, email: schema.users.email })
      .from(asn)
      .innerJoin(schema.users, eq(asn.userId, schema.users.id))
      .where(eq(asn.sopId, id))
      .orderBy(desc(asn.sopVersion), desc(asn.createdAt));

    // One row per assignee: their latest assignment (rows are sorted newest-version first).
    const latestByUser = new Map<string, (typeof rows)[number]>();
    for (const r of rows) {
      if (!latestByUser.has(r.assignment.userId)) latestByUser.set(r.assignment.userId, r);
    }
    const items = [...latestByUser.values()]
      .map((r) => ({
        userId: r.assignment.userId,
        name: r.name,
        email: r.email,
        sopVersion: r.assignment.sopVersion,
        dueAt: r.assignment.dueAt,
        acknowledgedAt: r.assignment.acknowledgedAt,
        signatureName: r.assignment.signatureName,
        isCurrent:
          r.assignment.sopVersion === sop.version && r.assignment.acknowledgedAt !== null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const currentRows = rows.filter((r) => r.assignment.sopVersion === sop.version);
    const acknowledged = currentRows.filter((r) => r.assignment.acknowledgedAt).length;
    return {
      items,
      coverage: {
        currentVersion: sop.version,
        assigned: currentRows.length,
        acknowledged,
        pct:
          currentRows.length > 0 ? Math.round((acknowledged / currentRows.length) * 100) : 0,
      },
    };
  });
}
