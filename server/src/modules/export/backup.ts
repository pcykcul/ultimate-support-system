/**
 * Logical backup: one JSON document containing every business table, streamed to the
 * response in table order, with each table read in pages (see pagedRows) so a large
 * install never needs a whole table in memory.
 *
 * Deliberately NOT included: sessions (secrets, meaningless after restore), jobs
 * (transient queue state), kb_search_queries / webhook_deliveries / email_log
 * (unbounded operational logs), counters (recomputable). Use pg_dump when you want a
 * byte-faithful backup — this file is for portability between installs.
 */
import { and, asc, notLike } from 'drizzle-orm';
import { db, schema } from '../../db/index.js';
import { pagedRows } from './helpers.js';

type PageFn = (limit: number, offset: number) => Promise<unknown[]>;

function usersPage(limit: number, offset: number): Promise<unknown[]> {
  // passwordHash is EXCLUDED on purpose: bcrypt hashes are credential material, and a
  // portability export gets copied around (tickets, laptops, S3 buckets) far more
  // casually than a database. A restored install should force password resets instead
  // of importing old secrets.
  return db
    .select({
      id: schema.users.id,
      kind: schema.users.kind,
      email: schema.users.email,
      name: schema.users.name,
      title: schema.users.title,
      avatarUrl: schema.users.avatarUrl,
      role: schema.users.role,
      scope: schema.users.scope,
      timezone: schema.users.timezone,
      active: schema.users.active,
      lastSeenAt: schema.users.lastSeenAt,
      createdAt: schema.users.createdAt,
    })
    .from(schema.users)
    .orderBy(asc(schema.users.id))
    .limit(limit)
    .offset(offset);
}

function settingsPage(limit: number, offset: number): Promise<unknown[]> {
  // invite:* rows are live credentials (the token IS the key emailed to the invitee) and
  // chatToken:* rows are visitor bearer tokens — both grant access if leaked, so they
  // stay out of the export just like passwordHash does.
  return db
    .select()
    .from(schema.settings)
    .where(
      and(notLike(schema.settings.key, 'invite:%'), notLike(schema.settings.key, 'chatToken:%'))
    )
    .orderBy(asc(schema.settings.key))
    .limit(limit)
    .offset(offset);
}

/** Every exported table with a stable ORDER BY so limit/offset paging is deterministic. */
const backupTables: Array<[name: string, page: PageFn]> = [
  ['users', usersPage],
  ['companies', (l, o) => db.select().from(schema.companies).orderBy(asc(schema.companies.id)).limit(l).offset(o)],
  ['company_members', (l, o) => db.select().from(schema.companyMembers).orderBy(asc(schema.companyMembers.companyId), asc(schema.companyMembers.userId)).limit(l).offset(o)],
  ['teams', (l, o) => db.select().from(schema.teams).orderBy(asc(schema.teams.id)).limit(l).offset(o)],
  ['team_members', (l, o) => db.select().from(schema.teamMembers).orderBy(asc(schema.teamMembers.teamId), asc(schema.teamMembers.userId)).limit(l).offset(o)],
  ['brands', (l, o) => db.select().from(schema.brands).orderBy(asc(schema.brands.id)).limit(l).offset(o)],
  ['schedules', (l, o) => db.select().from(schema.schedules).orderBy(asc(schema.schedules.id)).limit(l).offset(o)],
  ['schedule_intervals', (l, o) => db.select().from(schema.scheduleIntervals).orderBy(asc(schema.scheduleIntervals.id)).limit(l).offset(o)],
  ['holiday_calendars', (l, o) => db.select().from(schema.holidayCalendars).orderBy(asc(schema.holidayCalendars.id)).limit(l).offset(o)],
  ['holidays', (l, o) => db.select().from(schema.holidays).orderBy(asc(schema.holidays.id)).limit(l).offset(o)],
  ['sla_policies', (l, o) => db.select().from(schema.slaPolicies).orderBy(asc(schema.slaPolicies.id)).limit(l).offset(o)],
  ['sla_targets', (l, o) => db.select().from(schema.slaTargets).orderBy(asc(schema.slaTargets.id)).limit(l).offset(o)],
  ['sla_escalations', (l, o) => db.select().from(schema.slaEscalations).orderBy(asc(schema.slaEscalations.id)).limit(l).offset(o)],
  ['tickets', (l, o) => db.select().from(schema.tickets).orderBy(asc(schema.tickets.number)).limit(l).offset(o)],
  ['ticket_messages', (l, o) => db.select().from(schema.ticketMessages).orderBy(asc(schema.ticketMessages.id)).limit(l).offset(o)],
  ['ticket_events', (l, o) => db.select().from(schema.ticketEvents).orderBy(asc(schema.ticketEvents.id)).limit(l).offset(o)],
  ['ticket_followers', (l, o) => db.select().from(schema.ticketFollowers).orderBy(asc(schema.ticketFollowers.ticketId), asc(schema.ticketFollowers.userId)).limit(l).offset(o)],
  ['csat_responses', (l, o) => db.select().from(schema.csatResponses).orderBy(asc(schema.csatResponses.id)).limit(l).offset(o)],
  ['macros', (l, o) => db.select().from(schema.macros).orderBy(asc(schema.macros.id)).limit(l).offset(o)],
  ['kb_categories', (l, o) => db.select().from(schema.kbCategories).orderBy(asc(schema.kbCategories.id)).limit(l).offset(o)],
  ['kb_articles', (l, o) => db.select().from(schema.kbArticles).orderBy(asc(schema.kbArticles.id)).limit(l).offset(o)],
  ['kb_revisions', (l, o) => db.select().from(schema.kbRevisions).orderBy(asc(schema.kbRevisions.id)).limit(l).offset(o)],
  ['kb_feedback', (l, o) => db.select().from(schema.kbFeedback).orderBy(asc(schema.kbFeedback.id)).limit(l).offset(o)],
  ['snippets', (l, o) => db.select().from(schema.snippets).orderBy(asc(schema.snippets.id)).limit(l).offset(o)],
  ['search_synonyms', (l, o) => db.select().from(schema.searchSynonyms).orderBy(asc(schema.searchSynonyms.id)).limit(l).offset(o)],
  ['sops', (l, o) => db.select().from(schema.sops).orderBy(asc(schema.sops.id)).limit(l).offset(o)],
  ['sop_steps', (l, o) => db.select().from(schema.sopSteps).orderBy(asc(schema.sopSteps.id)).limit(l).offset(o)],
  ['sop_revisions', (l, o) => db.select().from(schema.sopRevisions).orderBy(asc(schema.sopRevisions.id)).limit(l).offset(o)],
  ['sop_runs', (l, o) => db.select().from(schema.sopRuns).orderBy(asc(schema.sopRuns.id)).limit(l).offset(o)],
  ['sop_run_steps', (l, o) => db.select().from(schema.sopRunSteps).orderBy(asc(schema.sopRunSteps.id)).limit(l).offset(o)],
  ['sop_assignments', (l, o) => db.select().from(schema.sopAssignments).orderBy(asc(schema.sopAssignments.id)).limit(l).offset(o)],
  ['automations', (l, o) => db.select().from(schema.automations).orderBy(asc(schema.automations.id)).limit(l).offset(o)],
  ['webhooks', (l, o) => db.select().from(schema.webhooks).orderBy(asc(schema.webhooks.id)).limit(l).offset(o)],
  ['settings', settingsPage],
];

/**
 * Streams the whole backup as JSON text chunks:
 * {"version":1,"exportedAt":"...","tables":{"users":[...],...}}
 * JSON.stringify turns Date columns into ISO strings for free.
 */
export async function* backupJsonChunks(): AsyncGenerator<string> {
  yield `{"version":1,"exportedAt":${JSON.stringify(new Date().toISOString())},"tables":{`;
  let firstTable = true;
  for (const [name, page] of backupTables) {
    yield `${firstTable ? '' : ','}${JSON.stringify(name)}:[`;
    firstTable = false;
    let firstRow = true;
    for await (const rows of pagedRows(page)) {
      yield (firstRow ? '' : ',') + rows.map((row) => JSON.stringify(row)).join(',');
      firstRow = false;
    }
    yield ']';
  }
  yield '}}';
}
