/**
 * Business-hours schedules and holiday calendars. Schedules drive every SLA clock, so any
 * change here re-runs applySla over the open tickets pinned to the changed schedule.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { db, schema } from '../../db/index.js';
import { badRequest, notFound, parse } from '../../lib/http.js';
import { requireAdmin, requireStaff, requireSupervisor } from '../../lib/auth.js';
import { applySla } from '../../lib/sla.js';
import { formatLocalClock } from '../../lib/hours.js';
import { AVAILABLE_PACKS, getHolidayPack } from './holiday-packs.js';

const OPEN_STATUSES = ['new', 'open', 'waiting_on_customer', 'on_hold'] as const;

const idParamSchema = z.object({ id: z.string().uuid() });

const intervalSchema = z
  .object({
    weekday: z.number().int().min(0).max(6),
    startMinute: z.number().int().min(0).max(24 * 60),
    endMinute: z.number().int().min(0).max(24 * 60),
  })
  .refine((i) => i.endMinute > i.startMinute, { message: 'endMinute must be after startMinute' });

const createScheduleSchema = z.object({
  name: z.string().trim().min(1),
  timezone: z.string().min(1),
  intervals: z.array(intervalSchema),
  holidayCalendarId: z.string().uuid().nullable().optional(),
  isDefault: z.boolean().optional(),
});

const patchScheduleSchema = z.object({
  name: z.string().trim().min(1).optional(),
  timezone: z.string().min(1).optional(),
  intervals: z.array(intervalSchema).optional(),
  holidayCalendarId: z.string().uuid().nullable().optional(),
  isDefault: z.boolean().optional(),
});

const createCalendarSchema = z.object({
  name: z.string().trim().min(1),
  countryCode: z.string().trim().min(2).max(2).optional(),
});

const createHolidaySchema = z.object({
  name: z.string().trim().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD'),
});

const importSchema = z.object({
  countryCode: z.string().trim().min(2).max(2),
  year: z.number().int(),
});

function assertTimezone(timezone: string): void {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
  } catch {
    throw badRequest(`Invalid IANA timezone "${timezone}"`);
  }
}

type IntervalRow = typeof schema.scheduleIntervals.$inferSelect;

function scheduleShape(sched: typeof schema.schedules.$inferSelect, intervals: IntervalRow[]) {
  return {
    id: sched.id,
    name: sched.name,
    timezone: sched.timezone,
    isDefault: sched.isDefault,
    holidayCalendarId: sched.holidayCalendarId,
    intervals: intervals
      .slice()
      .sort((a, b) => a.weekday - b.weekday || a.startMinute - b.startMinute)
      .map((i) => ({ weekday: i.weekday, startMinute: i.startMinute, endMinute: i.endMinute })),
  };
}

async function loadSchedule(id: string) {
  const [sched] = await db.select().from(schema.schedules).where(eq(schema.schedules.id, id)).limit(1);
  if (!sched) throw notFound('Schedule');
  return sched;
}

async function assertCalendarExists(id: string): Promise<void> {
  const [cal] = await db
    .select({ id: schema.holidayCalendars.id })
    .from(schema.holidayCalendars)
    .where(eq(schema.holidayCalendars.id, id))
    .limit(1);
  if (!cal) throw notFound('Holiday calendar');
}

/** Open tickets currently computed against this schedule. */
async function openTicketIdsOnSchedule(scheduleId: string): Promise<string[]> {
  const rows = await db
    .select({ id: schema.tickets.id })
    .from(schema.tickets)
    .where(
      and(
        inArray(schema.tickets.status, [...OPEN_STATUSES]),
        eq(schema.tickets.scheduleId, scheduleId)
      )
    );
  return rows.map((r) => r.id);
}

/** Re-run the SLA engine over open tickets pinned to a schedule (after edits/deletes). */
async function reapplySlaFor(ticketIds: string[]): Promise<void> {
  for (const id of ticketIds) {
    await applySla(id);
  }
}

export default async function routes(app: FastifyInstance): Promise<void> {
  // ---- Schedules ----

  app.get('/', { preHandler: requireStaff }, async () => {
    const scheds = await db.select().from(schema.schedules).orderBy(asc(schema.schedules.createdAt));
    const intervals = await db.select().from(schema.scheduleIntervals);
    const byId = new Map<string, IntervalRow[]>();
    for (const i of intervals) {
      const list = byId.get(i.scheduleId) ?? [];
      list.push(i);
      byId.set(i.scheduleId, list);
    }
    return { items: scheds.map((s) => scheduleShape(s, byId.get(s.id) ?? [])) };
  });

  app.post('/', { preHandler: requireSupervisor }, async (req, reply) => {
    const body = parse(createScheduleSchema, req.body);
    assertTimezone(body.timezone);
    if (body.holidayCalendarId) await assertCalendarExists(body.holidayCalendarId);

    if (body.isDefault) {
      await db.update(schema.schedules).set({ isDefault: false }).where(eq(schema.schedules.isDefault, true));
    }
    const [sched] = await db
      .insert(schema.schedules)
      .values({
        name: body.name,
        timezone: body.timezone,
        holidayCalendarId: body.holidayCalendarId ?? null,
        isDefault: body.isDefault ?? false,
      })
      .returning();
    if (body.intervals.length) {
      await db
        .insert(schema.scheduleIntervals)
        .values(body.intervals.map((i) => ({ ...i, scheduleId: sched!.id })));
    }
    const rows = await db
      .select()
      .from(schema.scheduleIntervals)
      .where(eq(schema.scheduleIntervals.scheduleId, sched!.id));
    return reply.status(201).send(scheduleShape(sched!, rows));
  });

  app.patch('/:id', { preHandler: requireSupervisor }, async (req) => {
    const { id } = parse(idParamSchema, req.params);
    const body = parse(patchScheduleSchema, req.body);
    const sched = await loadSchedule(id);

    if (body.timezone) assertTimezone(body.timezone);
    if (body.holidayCalendarId) await assertCalendarExists(body.holidayCalendarId);
    if (body.isDefault === true && !sched.isDefault) {
      await db.update(schema.schedules).set({ isDefault: false }).where(eq(schema.schedules.isDefault, true));
    }

    const patch: Partial<typeof schema.schedules.$inferInsert> = {};
    if (body.name !== undefined) patch.name = body.name;
    if (body.timezone !== undefined) patch.timezone = body.timezone;
    if (body.holidayCalendarId !== undefined) patch.holidayCalendarId = body.holidayCalendarId;
    if (body.isDefault !== undefined) patch.isDefault = body.isDefault;
    if (Object.keys(patch).length) {
      await db.update(schema.schedules).set(patch).where(eq(schema.schedules.id, id));
    }
    if (body.intervals) {
      await db.delete(schema.scheduleIntervals).where(eq(schema.scheduleIntervals.scheduleId, id));
      if (body.intervals.length) {
        await db
          .insert(schema.scheduleIntervals)
          .values(body.intervals.map((i) => ({ ...i, scheduleId: id })));
      }
    }

    // Business hours changed — every open ticket on this schedule gets fresh due dates.
    await reapplySlaFor(await openTicketIdsOnSchedule(id));

    const updated = await loadSchedule(id);
    const rows = await db
      .select()
      .from(schema.scheduleIntervals)
      .where(eq(schema.scheduleIntervals.scheduleId, id));
    return scheduleShape(updated, rows);
  });

  app.delete('/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const { id } = parse(idParamSchema, req.params);
    await loadSchedule(id);
    // Capture affected tickets first — the FK sets tickets.scheduleId to null on delete.
    const ticketIds = await openTicketIdsOnSchedule(id);
    await db.delete(schema.schedules).where(eq(schema.schedules.id, id));
    await reapplySlaFor(ticketIds);
    return reply.status(204).send();
  });

  // ---- Holiday calendars ----

  app.get('/holiday-calendars', { preHandler: requireStaff }, async () => {
    const cals = await db
      .select()
      .from(schema.holidayCalendars)
      .orderBy(asc(schema.holidayCalendars.createdAt));
    const hols = await db.select().from(schema.holidays).orderBy(asc(schema.holidays.date));
    const byCal = new Map<string, { id: string; name: string; date: string }[]>();
    for (const h of hols) {
      const list = byCal.get(h.calendarId) ?? [];
      list.push({ id: h.id, name: h.name, date: h.date });
      byCal.set(h.calendarId, list);
    }
    return {
      items: cals.map((c) => ({
        id: c.id,
        name: c.name,
        countryCode: c.countryCode,
        holidays: byCal.get(c.id) ?? [],
      })),
    };
  });

  app.post('/holiday-calendars', { preHandler: requireSupervisor }, async (req, reply) => {
    const body = parse(createCalendarSchema, req.body);
    const [cal] = await db
      .insert(schema.holidayCalendars)
      .values({ name: body.name, countryCode: body.countryCode?.toUpperCase() ?? null })
      .returning();
    return reply
      .status(201)
      .send({ id: cal!.id, name: cal!.name, countryCode: cal!.countryCode, holidays: [] });
  });

  /** Create a calendar from the built-in national public holiday packs. */
  app.post('/holiday-calendars/import', { preHandler: requireSupervisor }, async (req, reply) => {
    const body = parse(importSchema, req.body);
    const pack = getHolidayPack(body.countryCode, body.year);
    if (!pack) {
      const available = AVAILABLE_PACKS.map((p) => `${p.countryCode} (${p.years.join(', ')})`).join('; ');
      throw badRequest(`No built-in holiday pack for ${body.countryCode} ${body.year}. Available: ${available}`);
    }
    const [cal] = await db
      .insert(schema.holidayCalendars)
      .values({ name: pack.name, countryCode: pack.countryCode })
      .returning();
    const inserted = await db
      .insert(schema.holidays)
      .values(pack.holidays.map((h) => ({ calendarId: cal!.id, name: h.name, date: h.date })))
      .returning();
    return reply.status(201).send({
      id: cal!.id,
      name: cal!.name,
      countryCode: cal!.countryCode,
      holidays: inserted
        .slice()
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((h) => ({ id: h.id, name: h.name, date: h.date })),
    });
  });

  app.post('/holiday-calendars/:id/holidays', { preHandler: requireSupervisor }, async (req, reply) => {
    const { id } = parse(idParamSchema, req.params);
    await assertCalendarExists(id);
    const body = parse(createHolidaySchema, req.body);
    const [holiday] = await db
      .insert(schema.holidays)
      .values({ calendarId: id, name: body.name, date: body.date })
      .returning();
    return reply.status(201).send({ id: holiday!.id, name: holiday!.name, date: holiday!.date });
  });

  app.delete('/holidays/:id', { preHandler: requireSupervisor }, async (req, reply) => {
    const { id } = parse(idParamSchema, req.params);
    const deleted = await db.delete(schema.holidays).where(eq(schema.holidays.id, id)).returning();
    if (!deleted.length) throw notFound('Holiday');
    return reply.status(204).send();
  });

  app.delete('/holiday-calendars/:id', { preHandler: requireSupervisor }, async (req, reply) => {
    const { id } = parse(idParamSchema, req.params);
    const deleted = await db
      .delete(schema.holidayCalendars)
      .where(eq(schema.holidayCalendars.id, id))
      .returning();
    if (!deleted.length) throw notFound('Holiday calendar');
    return reply.status(204).send();
  });

  // ---- Utilities ----

  app.get('/preview-local-time', { preHandler: requireStaff }, async (req) => {
    const { timezone } = parse(z.object({ timezone: z.string().min(1) }), req.query);
    assertTimezone(timezone);
    return formatLocalClock(new Date(), timezone);
  });
}
