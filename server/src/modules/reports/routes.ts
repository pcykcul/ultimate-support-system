/**
 * Reporting — one honest overview endpoint computed live from the real tables.
 *
 * Honesty rules (deliberate, do not "improve"):
 * - Response/resolution medians are **plain calendar minutes** (createdAt → firstRespondedAt /
 *   createdAt → solvedAt), NOT business-hours minutes. Business-hours math flatters the numbers
 *   the customer never experiences — they waited the wall-clock time. The client labels it so.
 * - Medians, not averages, so one week-long outlier doesn't drown the typical experience.
 * - SLA attainment counts a solved ticket as achieved only if it has *no* recorded
 *   sla_breach event at all — a breach that later got solved still breached.
 * - No smoothing, no dropping of zero days: byDay includes every day in the range.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sql } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { badRequest, parse } from '../../lib/http.js';
import { requireStaff } from '../../lib/auth.js';

const MAX_RANGE_DAYS = 731; // two years — keeps byDay bounded for hostile ?from= values

const overviewQuery = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
});

function parseDateParam(value: string, label: string): Date {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw badRequest(`Invalid ${label} date`);
  return d;
}

// ---------- Raw-SQL row shapes (everything numeric is cast ::int / ::float8 in SQL,
// because postgres-js returns bigint/numeric as strings otherwise) ----------

type VolumeRow = { created: number; solved: number; open: number };
type ChannelRow = { channel: string; count: number };
type MedianRow = { median_first: number | null; median_resolution: number | null };
type SlaSolvedRow = { total: number; breached_solved: number };
type CountRow = { n: number };
type CsatRow = { avg: number | null; count: number };
type PerAgentRow = {
  agent_id: string;
  name: string;
  replies: number;
  solved: number;
  median_first_response_min: number | null;
};
type ByDayRow = { date: string; created: number; solved: number };
type DeflectionRow = { searches: number; zero_results: number };

export default async function routes(app: FastifyInstance): Promise<void> {
  app.get('/overview', { preHandler: requireStaff }, async (req) => {
    const query = parse(overviewQuery, req.query);
    const to = query.to ? parseDateParam(query.to, 'to') : new Date();
    const from = query.from
      ? parseDateParam(query.from, 'from')
      : new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
    if (from > to) throw badRequest('"from" must be before "to"');
    if (to.getTime() - from.getTime() > MAX_RANGE_DAYS * 24 * 60 * 60 * 1000) {
      throw badRequest(`Range too large — maximum ${MAX_RANGE_DAYS} days`);
    }
    // Raw-SQL params go over the wire as text; ISO strings let Postgres infer timestamptz.
    const fromTs = from.toISOString();
    const toTs = to.toISOString();

    // ----- Volume: created / solved inside the range, open right now -----
    const volumeRows = await db.execute<VolumeRow>(sql`
      select
        (select count(*)::int from tickets
          where created_at >= ${fromTs} and created_at <= ${toTs}) as created,
        (select count(*)::int from tickets
          where solved_at >= ${fromTs} and solved_at <= ${toTs}) as solved,
        (select count(*)::int from tickets
          where status in ('new', 'open', 'waiting_on_customer', 'on_hold')) as open
    `);
    const volume = volumeRows[0] ?? { created: 0, solved: 0, open: 0 };

    // ----- Channel mix of tickets created in the range -----
    const byChannel = await db.execute<ChannelRow>(sql`
      select channel::text as channel, count(*)::int as count
      from tickets
      where created_at >= ${fromTs} and created_at <= ${toTs}
      group by channel
      order by count desc, channel asc
    `);

    // ----- Response times: medians in CALENDAR minutes (see file header) -----
    const medianRows = await db.execute<MedianRow>(sql`
      select
        (select round(percentile_cont(0.5) within group (
            order by (extract(epoch from (first_responded_at - created_at)) / 60.0)::float8
          ))::int
          from tickets
          where first_responded_at is not null
            and created_at >= ${fromTs} and created_at <= ${toTs}) as median_first,
        (select round(percentile_cont(0.5) within group (
            order by (extract(epoch from (solved_at - created_at)) / 60.0)::float8
          ))::int
          from tickets
          where solved_at >= ${fromTs} and solved_at <= ${toTs}) as median_resolution
    `);
    const medians = medianRows[0] ?? { median_first: null, median_resolution: null };

    // ----- SLA: achievement over tickets solved in range vs recorded sla_breach events.
    // "breached" counts distinct tickets that recorded a breach event inside the range,
    // whether or not they are solved yet — an open breach is still a breach. -----
    const slaSolvedRows = await db.execute<SlaSolvedRow>(sql`
      select
        count(*)::int as total,
        count(*) filter (where exists (
          select 1 from ticket_events e
          where e.ticket_id = t.id and e.type = 'sla_breach'
        ))::int as breached_solved
      from tickets t
      where t.solved_at >= ${fromTs} and t.solved_at <= ${toTs}
    `);
    const slaSolved = slaSolvedRows[0] ?? { total: 0, breached_solved: 0 };
    const breachedRows = await db.execute<CountRow>(sql`
      select count(distinct ticket_id)::int as n
      from ticket_events
      where type = 'sla_breach' and created_at >= ${fromTs} and created_at <= ${toTs}
    `);
    const achievedPct = slaSolved.total
      ? Math.round(((slaSolved.total - slaSolved.breached_solved) / slaSolved.total) * 1000) / 10
      : 100;

    // ----- CSAT -----
    const csatRows = await db.execute<CsatRow>(sql`
      select round(avg(score)::numeric, 2)::float8 as avg, count(*)::int as count
      from csat_responses
      where created_at >= ${fromTs} and created_at <= ${toTs}
    `);
    const csat = csatRows[0] ?? { avg: null, count: 0 };

    // ----- Per-agent: public replies sent, tickets they moved to solved, and the median
    // (calendar) first-response time over tickets where THEY sent the first public reply -----
    const perAgentRows = await db.execute<PerAgentRow>(sql`
      with replies as (
        select m.author_id as agent_id, count(*)::int as replies
        from ticket_messages m
        join users u on u.id = m.author_id and u.kind = 'staff'
        where m.kind = 'public'
          and m.created_at >= ${fromTs} and m.created_at <= ${toTs}
        group by m.author_id
      ),
      solves as (
        select e.actor_id as agent_id, count(*)::int as solved
        from ticket_events e
        join users u on u.id = e.actor_id and u.kind = 'staff'
        where e.type = 'status_changed' and e.data->>'to' = 'solved'
          and e.created_at >= ${fromTs} and e.created_at <= ${toTs}
        group by e.actor_id
      ),
      first_replies as (
        select distinct on (m.ticket_id) m.ticket_id, m.author_id
        from ticket_messages m
        join users u on u.id = m.author_id and u.kind = 'staff'
        where m.kind = 'public'
        order by m.ticket_id, m.created_at asc
      ),
      first_response as (
        select fr.author_id as agent_id,
          round(percentile_cont(0.5) within group (
            order by (extract(epoch from (t.first_responded_at - t.created_at)) / 60.0)::float8
          ))::int as median_first_response_min
        from tickets t
        join first_replies fr on fr.ticket_id = t.id
        where t.first_responded_at is not null
          and t.created_at >= ${fromTs} and t.created_at <= ${toTs}
        group by fr.author_id
      )
      select u.id::text as agent_id, u.name,
        coalesce(r.replies, 0) as replies,
        coalesce(s.solved, 0) as solved,
        f.median_first_response_min
      from users u
      left join replies r on r.agent_id = u.id
      left join solves s on s.agent_id = u.id
      left join first_response f on f.agent_id = u.id
      where u.kind = 'staff'
        and (r.replies is not null or s.solved is not null
          or f.median_first_response_min is not null)
      order by coalesce(r.replies, 0) desc, u.name asc
    `);
    // Supervisors and admins see the whole team; everyone else only their own row.
    const user = req.user!;
    const seesEveryone = user.role === 'admin' || user.role === 'supervisor';
    const perAgent = (seesEveryone ? [...perAgentRows] : [...perAgentRows].filter((r) => r.agent_id === user.id)).map(
      (r) => ({
        agentId: r.agent_id,
        name: r.name,
        replies: r.replies,
        solved: r.solved,
        medianFirstResponseMin: r.median_first_response_min,
      })
    );

    // ----- Per-day created/solved, zero days included (UTC day buckets) -----
    const byDay = await db.execute<ByDayRow>(sql`
      with days as (
        select generate_series(
          (${fromTs}::timestamptz at time zone 'UTC')::date,
          (${toTs}::timestamptz at time zone 'UTC')::date,
          interval '1 day'
        )::date as day
      ),
      created as (
        select (created_at at time zone 'UTC')::date as day, count(*)::int as n
        from tickets
        where created_at >= ${fromTs} and created_at <= ${toTs}
        group by 1
      ),
      solved as (
        select (solved_at at time zone 'UTC')::date as day, count(*)::int as n
        from tickets
        where solved_at >= ${fromTs} and solved_at <= ${toTs}
        group by 1
      )
      select to_char(d.day, 'YYYY-MM-DD') as date,
        coalesce(c.n, 0)::int as created,
        coalesce(s.n, 0)::int as solved
      from days d
      left join created c on c.day = d.day
      left join solved s on s.day = d.day
      order by d.day asc
    `);

    // ----- Deflection: searches vs zero-result searches vs tickets created -----
    const deflectionRows = await db.execute<DeflectionRow>(sql`
      select
        count(*)::int as searches,
        count(*) filter (where result_count = 0)::int as zero_results
      from kb_search_queries
      where created_at >= ${fromTs} and created_at <= ${toTs}
    `);
    const deflection = deflectionRows[0] ?? { searches: 0, zero_results: 0 };

    return {
      range: { from: from.toISOString(), to: to.toISOString() },
      volume: { created: volume.created, solved: volume.solved, open: volume.open },
      byChannel: [...byChannel].map((r) => ({ channel: r.channel, count: r.count })),
      responseTimes: {
        // Calendar minutes, deliberately — see the header comment.
        medianFirstResponseMin: medians.median_first,
        medianResolutionMin: medians.median_resolution,
      },
      sla: { achievedPct, breached: breachedRows[0]?.n ?? 0 },
      csat: { avg: csat.avg, count: csat.count },
      perAgent,
      byDay: [...byDay],
      deflection: {
        searches: deflection.searches,
        zeroResults: deflection.zero_results,
        ticketsCreated: volume.created,
      },
    };
  });
}
