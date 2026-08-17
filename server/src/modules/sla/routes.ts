/**
 * SLA policy administration + attainment reporting.
 * Policies carry targets (per metric/priority) and escalation steps; both are written
 * wholesale on PATCH (delete + insert) so the client can treat them as one document.
 * Attainment is computed honestly: total = tickets solved/closed in range per policy,
 * breached = distinct tickets with a recorded sla_breach event for that metric.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, asc, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { db, schema } from '../../db/index.js';
import { badRequest, notFound, parse } from '../../lib/http.js';
import { requireAdmin, requireStaff, requireSupervisor } from '../../lib/auth.js';

const OPEN_STATUSES = ['new', 'open', 'waiting_on_customer', 'on_hold'] as const;
const METRIC_ORDER = ['first_response', 'next_response', 'periodic_update', 'resolution'] as const;
const PRIORITY_ORDER = ['low', 'normal', 'high', 'urgent'] as const;

const idParamSchema = z.object({ id: z.string().uuid() });

const metricEnum = z.enum(schema.slaMetric.enumValues);
const priorityEnum = z.enum(schema.ticketPriority.enumValues);

const targetSchema = z.object({
  metric: metricEnum,
  priority: priorityEnum,
  minutes: z.number().int().positive(),
  useBusinessHours: z.boolean().default(true),
});

const escalationSchema = z.object({
  metric: metricEnum,
  level: z.number().int().min(1).default(1),
  minutesOffset: z.number().int(),
  notifyAssignee: z.boolean().default(true),
  notifySupervisors: z.boolean().default(false),
});

const conditionsSchema = z.object({
  priorities: z.array(z.string()).optional(),
  channels: z.array(z.string()).optional(),
  companyTiers: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
});

const createPolicySchema = z.object({
  name: z.string().trim().min(1),
  description: z.string().nullable().optional(),
  conditions: conditionsSchema.optional(),
  scheduleId: z.string().uuid().nullable().optional(),
  enabled: z.boolean().optional(),
  position: z.number().int().optional(),
  targets: z.array(targetSchema).optional(),
  escalations: z.array(escalationSchema).optional(),
});

const patchPolicySchema = z.object({
  name: z.string().trim().min(1).optional(),
  description: z.string().nullable().optional(),
  conditions: conditionsSchema.optional(),
  scheduleId: z.string().uuid().nullable().optional(),
  enabled: z.boolean().optional(),
  position: z.number().int().optional(),
  targets: z.array(targetSchema).optional(),
  escalations: z.array(escalationSchema).optional(),
});

const reorderSchema = z.object({ ids: z.array(z.string().uuid()).min(1) });

const attainmentQuerySchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
});

type PolicyRow = typeof schema.slaPolicies.$inferSelect;
type TargetRow = typeof schema.slaTargets.$inferSelect;
type EscalationRow = typeof schema.slaEscalations.$inferSelect;

function metricRank(metric: string): number {
  return METRIC_ORDER.indexOf(metric as (typeof METRIC_ORDER)[number]);
}

function priorityRank(priority: string): number {
  return PRIORITY_ORDER.indexOf(priority as (typeof PRIORITY_ORDER)[number]);
}

function policyShape(policy: PolicyRow, targets: TargetRow[], escalations: EscalationRow[]) {
  return {
    id: policy.id,
    name: policy.name,
    description: policy.description,
    position: policy.position,
    conditions: policy.conditions,
    scheduleId: policy.scheduleId,
    enabled: policy.enabled,
    targets: targets
      .slice()
      .sort((a, b) => metricRank(a.metric) - metricRank(b.metric) || priorityRank(a.priority) - priorityRank(b.priority))
      .map((t) => ({
        metric: t.metric,
        priority: t.priority,
        minutes: t.minutes,
        useBusinessHours: t.useBusinessHours,
      })),
    escalations: escalations
      .slice()
      .sort((a, b) => metricRank(a.metric) - metricRank(b.metric) || a.level - b.level)
      .map((e) => ({
        metric: e.metric,
        level: e.level,
        minutesOffset: e.minutesOffset,
        notifyAssignee: e.notifyAssignee,
        notifySupervisors: e.notifySupervisors,
      })),
  };
}

async function loadPolicyShape(policyId: string) {
  const [policy] = await db
    .select()
    .from(schema.slaPolicies)
    .where(eq(schema.slaPolicies.id, policyId))
    .limit(1);
  if (!policy) throw notFound('SLA policy');
  const targets = await db
    .select()
    .from(schema.slaTargets)
    .where(eq(schema.slaTargets.policyId, policyId));
  const escalations = await db
    .select()
    .from(schema.slaEscalations)
    .where(eq(schema.slaEscalations.policyId, policyId));
  return policyShape(policy, targets, escalations);
}

async function assertScheduleExists(id: string): Promise<void> {
  const [row] = await db
    .select({ id: schema.schedules.id })
    .from(schema.schedules)
    .where(eq(schema.schedules.id, id))
    .limit(1);
  if (!row) throw notFound('Schedule');
}

function parseDateParam(value: string, label: string): Date {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw badRequest(`Invalid ${label} date`);
  return d;
}

/** Which metric is currently overdue on a ticket (earliest past due wins). */
function overdueMetric(
  ticket: typeof schema.tickets.$inferSelect,
  now: Date
): { metric: string; dueAt: Date } | null {
  const candidates: { metric: string; dueAt: Date }[] = [];
  if (ticket.firstResponseDueAt && ticket.firstResponseDueAt < now)
    candidates.push({ metric: 'first_response', dueAt: ticket.firstResponseDueAt });
  if (ticket.nextResponseDueAt && ticket.nextResponseDueAt < now)
    candidates.push({ metric: 'next_response', dueAt: ticket.nextResponseDueAt });
  if (ticket.resolutionDueAt && ticket.resolutionDueAt < now)
    candidates.push({ metric: 'resolution', dueAt: ticket.resolutionDueAt });
  if (!candidates.length) return null;
  candidates.sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());
  return candidates[0]!;
}

export default async function routes(app: FastifyInstance): Promise<void> {
  app.get('/policies', { preHandler: requireStaff }, async () => {
    const policies = await db
      .select()
      .from(schema.slaPolicies)
      .orderBy(asc(schema.slaPolicies.position), asc(schema.slaPolicies.createdAt));
    const targets = await db.select().from(schema.slaTargets);
    const escalations = await db.select().from(schema.slaEscalations);
    return {
      items: policies.map((p) =>
        policyShape(
          p,
          targets.filter((t) => t.policyId === p.id),
          escalations.filter((e) => e.policyId === p.id)
        )
      ),
    };
  });

  app.post('/policies', { preHandler: requireSupervisor }, async (req, reply) => {
    const body = parse(createPolicySchema, req.body);
    if (body.scheduleId) await assertScheduleExists(body.scheduleId);

    let position = body.position;
    if (position === undefined) {
      const [last] = await db
        .select({ position: schema.slaPolicies.position })
        .from(schema.slaPolicies)
        .orderBy(desc(schema.slaPolicies.position))
        .limit(1);
      position = (last?.position ?? -1) + 1;
    }

    const [policy] = await db
      .insert(schema.slaPolicies)
      .values({
        name: body.name,
        description: body.description ?? null,
        conditions: body.conditions ?? {},
        scheduleId: body.scheduleId ?? null,
        enabled: body.enabled ?? true,
        position,
      })
      .returning();
    if (body.targets?.length) {
      await db
        .insert(schema.slaTargets)
        .values(body.targets.map((t) => ({ ...t, policyId: policy!.id })));
    }
    if (body.escalations?.length) {
      await db
        .insert(schema.slaEscalations)
        .values(body.escalations.map((e) => ({ ...e, policyId: policy!.id })));
    }
    return reply.status(201).send(await loadPolicyShape(policy!.id));
  });

  app.patch('/policies/:id', { preHandler: requireSupervisor }, async (req) => {
    const { id } = parse(idParamSchema, req.params);
    const body = parse(patchPolicySchema, req.body);
    const [policy] = await db
      .select()
      .from(schema.slaPolicies)
      .where(eq(schema.slaPolicies.id, id))
      .limit(1);
    if (!policy) throw notFound('SLA policy');
    if (body.scheduleId) await assertScheduleExists(body.scheduleId);

    const patch: Partial<typeof schema.slaPolicies.$inferInsert> = {};
    if (body.name !== undefined) patch.name = body.name;
    if (body.description !== undefined) patch.description = body.description;
    if (body.conditions !== undefined) patch.conditions = body.conditions;
    if (body.scheduleId !== undefined) patch.scheduleId = body.scheduleId;
    if (body.enabled !== undefined) patch.enabled = body.enabled;
    if (body.position !== undefined) patch.position = body.position;
    if (Object.keys(patch).length) {
      await db.update(schema.slaPolicies).set(patch).where(eq(schema.slaPolicies.id, id));
    }

    // Targets/escalations are written wholesale — the client edits them as one document.
    if (body.targets) {
      await db.delete(schema.slaTargets).where(eq(schema.slaTargets.policyId, id));
      if (body.targets.length) {
        await db.insert(schema.slaTargets).values(body.targets.map((t) => ({ ...t, policyId: id })));
      }
    }
    if (body.escalations) {
      await db.delete(schema.slaEscalations).where(eq(schema.slaEscalations.policyId, id));
      if (body.escalations.length) {
        await db
          .insert(schema.slaEscalations)
          .values(body.escalations.map((e) => ({ ...e, policyId: id })));
      }
    }
    return loadPolicyShape(id);
  });

  app.delete('/policies/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const { id } = parse(idParamSchema, req.params);
    const deleted = await db
      .delete(schema.slaPolicies)
      .where(eq(schema.slaPolicies.id, id))
      .returning();
    if (!deleted.length) throw notFound('SLA policy');
    return reply.status(204).send();
  });

  app.post('/policies/reorder', { preHandler: requireSupervisor }, async (req, reply) => {
    const { ids } = parse(reorderSchema, req.body);
    for (let i = 0; i < ids.length; i++) {
      await db
        .update(schema.slaPolicies)
        .set({ position: i })
        .where(eq(schema.slaPolicies.id, ids[i]!));
    }
    return reply.status(204).send();
  });

  app.get('/attainment', { preHandler: requireStaff }, async (req) => {
    const query = parse(attainmentQuerySchema, req.query);
    const to = query.to ? parseDateParam(query.to, 'to') : new Date();
    const from = query.from
      ? parseDateParam(query.from, 'from')
      : new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
    if (from > to) throw badRequest('"from" must be before "to"');

    const policies = await db
      .select()
      .from(schema.slaPolicies)
      .orderBy(asc(schema.slaPolicies.position), asc(schema.slaPolicies.createdAt));
    const targets = await db.select().from(schema.slaTargets);

    // Tickets that finished (solved or closed) inside the window, per policy.
    const finished = await db
      .select({ id: schema.tickets.id, slaPolicyId: schema.tickets.slaPolicyId })
      .from(schema.tickets)
      .where(
        and(
          isNotNull(schema.tickets.slaPolicyId),
          sql`coalesce(${schema.tickets.solvedAt}, ${schema.tickets.closedAt}) >= ${from}`,
          sql`coalesce(${schema.tickets.solvedAt}, ${schema.tickets.closedAt}) <= ${to}`
        )
      );

    // Every breach ever recorded against those tickets, keyed by ticket → set of metrics.
    const finishedIds = finished.map((t) => t.id);
    const breachEvents = finishedIds.length
      ? await db
          .select({ ticketId: schema.ticketEvents.ticketId, data: schema.ticketEvents.data })
          .from(schema.ticketEvents)
          .where(
            and(
              eq(schema.ticketEvents.type, 'sla_breach'),
              inArray(schema.ticketEvents.ticketId, finishedIds)
            )
          )
      : [];
    const breachedMetricsByTicket = new Map<string, Set<string>>();
    for (const e of breachEvents) {
      const metric = (e.data as { metric?: string }).metric;
      if (!metric) continue;
      const set = breachedMetricsByTicket.get(e.ticketId) ?? new Set<string>();
      set.add(metric);
      breachedMetricsByTicket.set(e.ticketId, set);
    }

    const policyReports = policies.map((p) => {
      const ticketIds = finished.filter((t) => t.slaPolicyId === p.id).map((t) => t.id);
      const total = ticketIds.length;
      const metrics = [...new Set(targets.filter((t) => t.policyId === p.id).map((t) => t.metric))]
        .sort((a, b) => metricRank(a) - metricRank(b))
        .map((metric) => {
          const breached = ticketIds.filter((id) =>
            breachedMetricsByTicket.get(id)?.has(metric)
          ).length;
          const achieved = total - breached;
          const pct = total ? Math.round((achieved / total) * 1000) / 10 : 100;
          return { metric, total, achieved, breached, pct };
        });
      return { policyId: p.id, name: p.name, metrics };
    });

    // Currently open breaches, with company names for triage.
    const now = new Date();
    const breachedRows = await db
      .select({ ticket: schema.tickets, companyName: schema.companies.name })
      .from(schema.tickets)
      .leftJoin(schema.companies, eq(schema.tickets.companyId, schema.companies.id))
      .where(
        and(
          eq(schema.tickets.slaBreached, true),
          inArray(schema.tickets.status, [...OPEN_STATUSES])
        )
      )
      .orderBy(asc(schema.tickets.nextSlaDueAt));
    const breaches = breachedRows.flatMap((row) => {
      const overdue = overdueMetric(row.ticket, now);
      if (!overdue) return []; // stale breach flag; the sweep will reconcile
      return [
        {
          ticketId: row.ticket.id,
          number: row.ticket.number,
          subject: row.ticket.subject,
          metric: overdue.metric,
          dueAt: overdue.dueAt.toISOString(),
          companyName: row.companyName ?? null,
        },
      ];
    });

    return { policies: policyReports, breaches };
  });
}
