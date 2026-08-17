/**
 * The complete data model. Single-tenant: one install = one business (white-labeled).
 * Conventions: uuid PKs, timestamptz, snake_case column names, soft business rules live
 * in services — the schema stays honest and boring.
 */
import {
  pgTable,
  pgEnum,
  uuid,
  text,
  timestamp,
  integer,
  boolean,
  jsonb,
  index,
  uniqueIndex,
  primaryKey,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// ---------- Enums ----------

export const userKind = pgEnum('user_kind', ['staff', 'customer']);
export const staffRole = pgEnum('staff_role', ['admin', 'supervisor', 'agent', 'collaborator']);
export const ticketScope = pgEnum('ticket_scope', ['all', 'team', 'assigned']);
export const ticketStatus = pgEnum('ticket_status', [
  'new',
  'open',
  'waiting_on_customer',
  'on_hold',
  'solved',
  'closed',
]);
export const ticketPriority = pgEnum('ticket_priority', ['low', 'normal', 'high', 'urgent']);
export const ticketChannel = pgEnum('ticket_channel', ['email', 'portal', 'chat', 'api', 'internal']);
export const messageKind = pgEnum('message_kind', ['public', 'internal', 'system']);
export const audience = pgEnum('audience', ['public', 'customers', 'company', 'internal']);
export const articleStatus = pgEnum('article_status', ['draft', 'review', 'published', 'archived']);
export const slaMetric = pgEnum('sla_metric', [
  'first_response',
  'next_response',
  'periodic_update',
  'resolution',
]);
export const sopKind = pgEnum('sop_kind', ['reference', 'runbook']);
export const runStatus = pgEnum('run_status', ['in_progress', 'completed', 'cancelled']);
export const jobStatus = pgEnum('job_status', ['pending', 'running', 'done', 'failed']);

// ---------- Settings & branding ----------

/** Key/value instance settings. Branding lives under keys: branding.name, branding.logoUrl,
 * branding.colors, branding.emailFrom, humanGuarantee.enabled, etc. */
export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Multi-brand: each brand gets its own help center identity. A fresh install has one default brand. */
export const brands = pgTable('brands', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  logoUrl: text('logo_url'),
  colors: jsonb('colors'), // { brand: 'r g b', ... } css variable payload
  helpCenterTitle: text('help_center_title'),
  emailFrom: text('email_from'),
  isDefault: boolean('is_default').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------- Users, teams, companies ----------

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: userKind('kind').notNull(),
    email: text('email'),
    name: text('name').notNull(),
    title: text('title'), // e.g. "Support Engineer" — shown in signatures
    avatarUrl: text('avatar_url'),
    passwordHash: text('password_hash'),
    // staff-only
    role: staffRole('role'),
    scope: ticketScope('scope').default('all'),
    timezone: text('timezone').notNull().default('UTC'), // IANA zone
    active: boolean('active').notNull().default(true),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    emailUnique: uniqueIndex('users_email_unique').on(t.email).where(sql`email IS NOT NULL`),
    kindIdx: index('users_kind_idx').on(t.kind),
  })
);

export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(), // random token
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ userIdx: index('sessions_user_idx').on(t.userId) })
);

export const teams = pgTable('teams', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  emoji: text('emoji'),
  scheduleId: uuid('schedule_id').references(() => schedules.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const teamMembers = pgTable(
  'team_members',
  {
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
  },
  (t) => ({ pk: primaryKey({ columns: [t.teamId, t.userId] }) })
);

export const companies = pgTable(
  'companies',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    domains: text('domains').array().notNull().default(sql`'{}'::text[]`), // auto-associate contacts by email domain
    tier: text('tier'), // free-form customer tier label: "enterprise" | "standard" | ...
    timezone: text('timezone'), // IANA; drives the customer local clock when contact has none
    /** Every member sees all company tickets by default (the top community request). */
    membersSeeAllTickets: boolean('members_see_all_tickets').notNull().default(false),
    slaPolicyId: uuid('sla_policy_id').references(() => slaPolicies.id, { onDelete: 'set null' }),
    scheduleId: uuid('schedule_id').references(() => schedules.id, { onDelete: 'set null' }),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ nameIdx: index('companies_name_idx').on(t.name) })
);

export const companyMembers = pgTable(
  'company_members',
  {
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Customer-side admin: manages the company's tickets, invites colleagues, sets visibility. */
    isCompanyAdmin: boolean('is_company_admin').notNull().default(false),
    canViewAllTickets: boolean('can_view_all_tickets').notNull().default(false),
  },
  (t) => ({ pk: primaryKey({ columns: [t.companyId, t.userId] }) })
);

// ---------- Business hours & SLA ----------

export const schedules = pgTable('schedules', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  timezone: text('timezone').notNull(), // IANA, e.g. Australia/Sydney
  holidayCalendarId: uuid('holiday_calendar_id').references(() => holidayCalendars.id, {
    onDelete: 'set null',
  }),
  isDefault: boolean('is_default').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Weekly working intervals in the schedule's local time. weekday: 0=Sunday..6=Saturday.
 * Minutes since local midnight, endMinute exclusive. Multiple rows per day allowed (split shifts). */
export const scheduleIntervals = pgTable(
  'schedule_intervals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    scheduleId: uuid('schedule_id')
      .notNull()
      .references(() => schedules.id, { onDelete: 'cascade' }),
    weekday: integer('weekday').notNull(),
    startMinute: integer('start_minute').notNull(),
    endMinute: integer('end_minute').notNull(),
  },
  (t) => ({ schedIdx: index('schedule_intervals_schedule_idx').on(t.scheduleId) })
);

export const holidayCalendars = pgTable('holiday_calendars', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(), // e.g. "Australia (NSW) 2026"
  countryCode: text('country_code'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const holidays = pgTable(
  'holidays',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    calendarId: uuid('calendar_id')
      .notNull()
      .references(() => holidayCalendars.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    date: text('date').notNull(), // 'YYYY-MM-DD' in the schedule's local zone
  },
  (t) => ({ calIdx: index('holidays_calendar_idx').on(t.calendarId) })
);

export const slaPolicies = pgTable('sla_policies', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  description: text('description'),
  /** Ordered list; first matching policy wins when not directly attached to a company. */
  position: integer('position').notNull().default(0),
  /** Conditions: { priorities?: [], channels?: [], companyTiers?: [], tags?: [] } — all ANDed; empty = match all. */
  conditions: jsonb('conditions').notNull().default(sql`'{}'::jsonb`),
  scheduleId: uuid('schedule_id').references(() => schedules.id, { onDelete: 'set null' }),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Per-metric, per-priority target. useBusinessHours=false means calendar hours. */
export const slaTargets = pgTable(
  'sla_targets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    policyId: uuid('policy_id')
      .notNull()
      .references(() => slaPolicies.id, { onDelete: 'cascade' }),
    metric: slaMetric('metric').notNull(),
    priority: ticketPriority('priority').notNull(),
    minutes: integer('minutes').notNull(),
    useBusinessHours: boolean('use_business_hours').notNull().default(true),
  },
  (t) => ({
    policyIdx: index('sla_targets_policy_idx').on(t.policyId),
    uniq: uniqueIndex('sla_targets_uniq').on(t.policyId, t.metric, t.priority),
  })
);

/** Escalation steps for a policy+metric: minutesBefore<0 = pre-breach reminder, 0 = at breach, >0 = after. */
export const slaEscalations = pgTable(
  'sla_escalations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    policyId: uuid('policy_id')
      .notNull()
      .references(() => slaPolicies.id, { onDelete: 'cascade' }),
    metric: slaMetric('metric').notNull(),
    level: integer('level').notNull().default(1),
    minutesOffset: integer('minutes_offset').notNull(), // negative = before due
    notifyAssignee: boolean('notify_assignee').notNull().default(true),
    notifySupervisors: boolean('notify_supervisors').notNull().default(false),
    notifyUserIds: uuid('notify_user_ids').array(),
  },
  (t) => ({ policyIdx: index('sla_escalations_policy_idx').on(t.policyId) })
);

// ---------- Tickets ----------

export const tickets = pgTable(
  'tickets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    number: integer('number').notNull(), // human-friendly sequential number
    subject: text('subject').notNull(),
    status: ticketStatus('status').notNull().default('new'),
    priority: ticketPriority('priority').notNull().default('normal'),
    channel: ticketChannel('channel').notNull().default('portal'),
    brandId: uuid('brand_id').references(() => brands.id, { onDelete: 'set null' }),
    requesterId: uuid('requester_id')
      .notNull()
      .references(() => users.id),
    companyId: uuid('company_id').references(() => companies.id, { onDelete: 'set null' }),
    assigneeId: uuid('assignee_id').references(() => users.id, { onDelete: 'set null' }),
    teamId: uuid('team_id').references(() => teams.id, { onDelete: 'set null' }),
    tags: text('tags').array().notNull().default(sql`'{}'::text[]`),
    customFields: jsonb('custom_fields').notNull().default(sql`'{}'::jsonb`),
    // SLA state (denormalized so queue sorting is an indexed ORDER BY)
    slaPolicyId: uuid('sla_policy_id').references(() => slaPolicies.id, { onDelete: 'set null' }),
    scheduleId: uuid('schedule_id').references(() => schedules.id, { onDelete: 'set null' }),
    firstResponseDueAt: timestamp('first_response_due_at', { withTimezone: true }),
    nextResponseDueAt: timestamp('next_response_due_at', { withTimezone: true }),
    resolutionDueAt: timestamp('resolution_due_at', { withTimezone: true }),
    nextSlaDueAt: timestamp('next_sla_due_at', { withTimezone: true }), // min of active dues; queue sort key
    slaBreached: boolean('sla_breached').notNull().default(false),
    /** Pause bookkeeping: on waiting_on_customer / on_hold / solved the resolution clock stops;
     * remaining business minutes are parked here and rehydrated on reopen. */
    slaPausedAt: timestamp('sla_paused_at', { withTimezone: true }),
    resolutionRemainingMinutes: integer('resolution_remaining_minutes'),
    firstRespondedAt: timestamp('first_responded_at', { withTimezone: true }),
    // lifecycle
    lastPublicReplyAt: timestamp('last_public_reply_at', { withTimezone: true }),
    lastCustomerReplyAt: timestamp('last_customer_reply_at', { withTimezone: true }),
    solvedAt: timestamp('solved_at', { withTimezone: true }),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    // email threading
    emailMessageIds: text('email_message_ids').array().notNull().default(sql`'{}'::text[]`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    numberUniq: uniqueIndex('tickets_number_uniq').on(t.number),
    statusIdx: index('tickets_status_idx').on(t.status),
    assigneeIdx: index('tickets_assignee_idx').on(t.assigneeId),
    teamIdx: index('tickets_team_idx').on(t.teamId),
    requesterIdx: index('tickets_requester_idx').on(t.requesterId),
    companyIdx: index('tickets_company_idx').on(t.companyId),
    nextSlaIdx: index('tickets_next_sla_idx').on(t.nextSlaDueAt),
    updatedIdx: index('tickets_updated_idx').on(t.updatedAt),
  })
);

export const ticketMessages = pgTable(
  'ticket_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ticketId: uuid('ticket_id')
      .notNull()
      .references(() => tickets.id, { onDelete: 'cascade' }),
    kind: messageKind('kind').notNull().default('public'),
    authorId: uuid('author_id').references(() => users.id, { onDelete: 'set null' }),
    body: text('body').notNull(), // markdown
    channel: ticketChannel('channel'),
    emailMessageId: text('email_message_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ ticketIdx: index('ticket_messages_ticket_idx').on(t.ticketId, t.createdAt) })
);

export const ticketFollowers = pgTable(
  'ticket_followers',
  {
    ticketId: uuid('ticket_id')
      .notNull()
      .references(() => tickets.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** 'cc' followers are visible to the customer & see the ticket in the portal; 'internal' are silent. */
    kind: text('kind').notNull().default('internal'),
  },
  (t) => ({ pk: primaryKey({ columns: [t.ticketId, t.userId] }) })
);

/** Audit trail: status changes, assignments, SLA events, merges — everything non-message. */
export const ticketEvents = pgTable(
  'ticket_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ticketId: uuid('ticket_id')
      .notNull()
      .references(() => tickets.id, { onDelete: 'cascade' }),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    type: text('type').notNull(), // status_changed | assigned | priority_changed | sla_applied | sla_extended | merged | ...
    data: jsonb('data').notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ ticketIdx: index('ticket_events_ticket_idx').on(t.ticketId, t.createdAt) })
);

export const csatResponses = pgTable('csat_responses', {
  id: uuid('id').primaryKey().defaultRandom(),
  ticketId: uuid('ticket_id')
    .notNull()
    .references(() => tickets.id, { onDelete: 'cascade' }),
  score: integer('score').notNull(), // 1..5
  comment: text('comment'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const macros = pgTable('macros', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  body: text('body').notNull(), // reply template with {{variables}}
  /** Actions applied with the macro: { setStatus?, setPriority?, addTags?, assignTeamId? } */
  actions: jsonb('actions').notNull().default(sql`'{}'::jsonb`),
  /** Linked runbook surfaced in the sidebar when this macro is applied. */
  sopId: uuid('sop_id').references(() => sops.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------- Knowledge base ----------

export const kbCategories = pgTable(
  'kb_categories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    brandId: uuid('brand_id').references(() => brands.id, { onDelete: 'cascade' }),
    parentId: uuid('parent_id'),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    description: text('description'),
    audience: audience('audience').notNull().default('public'),
    position: integer('position').notNull().default(0),
  },
  (t) => ({
    slugUniq: uniqueIndex('kb_categories_slug_uniq').on(t.brandId, t.slug),
    parentIdx: index('kb_categories_parent_idx').on(t.parentId),
  })
);

export const kbArticles = pgTable(
  'kb_articles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    categoryId: uuid('category_id').references(() => kbCategories.id, { onDelete: 'set null' }),
    brandId: uuid('brand_id').references(() => brands.id, { onDelete: 'cascade' }),
    slug: text('slug').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull().default(''), // markdown, current published/working copy
    articleType: text('article_type'), // how-to | faq | troubleshooting | reference
    audience: audience('audience').notNull().default('public'),
    /** When audience='company': the companies allowed to read it. */
    companyIds: uuid('company_ids').array(),
    status: articleStatus('status').notNull().default('draft'),
    ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'set null' }),
    verifyIntervalDays: integer('verify_interval_days'),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    position: integer('position').notNull().default(0),
    viewCount: integer('view_count').notNull().default(0),
    helpfulYes: integer('helpful_yes').notNull().default(0),
    helpfulNo: integer('helpful_no').notNull().default(0),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    slugUniq: uniqueIndex('kb_articles_slug_uniq').on(t.brandId, t.slug),
    statusIdx: index('kb_articles_status_idx').on(t.status),
    categoryIdx: index('kb_articles_category_idx').on(t.categoryId),
  })
);

export const kbRevisions = pgTable(
  'kb_revisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    articleId: uuid('article_id')
      .notNull()
      .references(() => kbArticles.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    body: text('body').notNull(),
    authorId: uuid('author_id').references(() => users.id, { onDelete: 'set null' }),
    note: text('note'), // e.g. "submitted for review", "published", "rollback to v3"
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ articleIdx: index('kb_revisions_article_idx').on(t.articleId, t.createdAt) })
);

export const kbFeedback = pgTable('kb_feedback', {
  id: uuid('id').primaryKey().defaultRandom(),
  articleId: uuid('article_id')
    .notNull()
    .references(() => kbArticles.id, { onDelete: 'cascade' }),
  helpful: boolean('helpful').notNull(),
  comment: text('comment'),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Every help-center / portal search gets logged; zero-result queries feed the "write this" queue. */
export const kbSearchQueries = pgTable(
  'kb_search_queries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    query: text('query').notNull(),
    resultCount: integer('result_count').notNull(),
    source: text('source').notNull().default('help_center'), // help_center | portal | widget | agent
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ createdIdx: index('kb_search_queries_created_idx').on(t.createdAt) })
);

/** Reusable content snippets: {{snippet:key}} in article/macro bodies expands at render time. */
export const snippets = pgTable('snippets', {
  id: uuid('id').primaryKey().defaultRandom(),
  key: text('key').notNull().unique(),
  value: text('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Search synonyms: searching any term in the group finds the others. */
export const searchSynonyms = pgTable('search_synonyms', {
  id: uuid('id').primaryKey().defaultRandom(),
  terms: text('terms').array().notNull(), // e.g. ['invoice','bill','receipt']
});

// ---------- SOPs ----------

export const sops = pgTable(
  'sops',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: sopKind('kind').notNull().default('reference'),
    title: text('title').notNull(),
    slug: text('slug').notNull().unique(),
    body: text('body').notNull().default(''), // markdown intro / full reference body
    status: articleStatus('status').notNull().default('draft'),
    ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'set null' }),
    teamId: uuid('team_id').references(() => teams.id, { onDelete: 'set null' }),
    verifyIntervalDays: integer('verify_interval_days'),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    version: integer('version').notNull().default(1),
    /** Auto-instantiate triggers: { onSlaBreach?: bool, onPriority?: 'urgent', onTags?: string[] } */
    triggers: jsonb('triggers').notNull().default(sql`'{}'::jsonb`),
    requiresAcknowledgment: boolean('requires_acknowledgment').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ statusIdx: index('sops_status_idx').on(t.status) })
);

export const sopRevisions = pgTable(
  'sop_revisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sopId: uuid('sop_id')
      .notNull()
      .references(() => sops.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    steps: jsonb('steps'), // snapshot of steps at this version
    authorId: uuid('author_id').references(() => users.id, { onDelete: 'set null' }),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ sopIdx: index('sop_revisions_sop_idx').on(t.sopId, t.version) })
);

export const sopSteps = pgTable(
  'sop_steps',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sopId: uuid('sop_id')
      .notNull()
      .references(() => sops.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    title: text('title').notNull(),
    body: text('body'),
    roleHint: text('role_hint'), // who typically does this step: "agent" | "supervisor" | "on-call engineer"
  },
  (t) => ({ sopIdx: index('sop_steps_sop_idx').on(t.sopId, t.position) })
);

export const sopRuns = pgTable(
  'sop_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sopId: uuid('sop_id')
      .notNull()
      .references(() => sops.id, { onDelete: 'cascade' }),
    sopVersion: integer('sop_version').notNull(),
    ticketId: uuid('ticket_id').references(() => tickets.id, { onDelete: 'set null' }),
    startedById: uuid('started_by_id').references(() => users.id, { onDelete: 'set null' }),
    status: runStatus('status').notNull().default('in_progress'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => ({
    sopIdx: index('sop_runs_sop_idx').on(t.sopId),
    ticketIdx: index('sop_runs_ticket_idx').on(t.ticketId),
  })
);

export const sopRunSteps = pgTable(
  'sop_run_steps',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    runId: uuid('run_id')
      .notNull()
      .references(() => sopRuns.id, { onDelete: 'cascade' }),
    stepId: uuid('step_id').references(() => sopSteps.id, { onDelete: 'set null' }),
    position: integer('position').notNull(),
    title: text('title').notNull(),
    done: boolean('done').notNull().default(false),
    doneById: uuid('done_by_id').references(() => users.id, { onDelete: 'set null' }),
    doneAt: timestamp('done_at', { withTimezone: true }),
    note: text('note'),
  },
  (t) => ({ runIdx: index('sop_run_steps_run_idx').on(t.runId, t.position) })
);

/** Read-and-sign assignments: who must acknowledge this SOP, and whether they have. */
export const sopAssignments = pgTable(
  'sop_assignments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sopId: uuid('sop_id')
      .notNull()
      .references(() => sops.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    sopVersion: integer('sop_version').notNull(), // version they must (re)acknowledge
    dueAt: timestamp('due_at', { withTimezone: true }),
    acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }),
    signatureName: text('signature_name'), // typed full name = e-sign record
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniq: uniqueIndex('sop_assignments_uniq').on(t.sopId, t.userId, t.sopVersion),
    userIdx: index('sop_assignments_user_idx').on(t.userId),
  })
);

// ---------- Automations, webhooks, jobs ----------

export const automations = pgTable('automations', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  event: text('event').notNull(), // ticket.created | ticket.updated | message.created | sla.warning | sla.breach
  /** { priorities?, channels?, tags?, statuses? } ANDed; empty = all */
  conditions: jsonb('conditions').notNull().default(sql`'{}'::jsonb`),
  /** [{ type: 'assign_team', teamId } | { type: 'set_priority', priority } | { type: 'add_tags', tags } |
   *  { type: 'notify', userIds } | { type: 'start_sop', sopId } | { type: 'send_webhook', webhookId }] */
  actions: jsonb('actions').notNull().default(sql`'[]'::jsonb`),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const webhooks = pgTable('webhooks', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  url: text('url').notNull(),
  secret: text('secret'),
  events: text('events').array().notNull().default(sql`'{}'::text[]`), // empty = all
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const webhookDeliveries = pgTable(
  'webhook_deliveries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    webhookId: uuid('webhook_id')
      .notNull()
      .references(() => webhooks.id, { onDelete: 'cascade' }),
    event: text('event').notNull(),
    payload: jsonb('payload').notNull(),
    responseStatus: integer('response_status'),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ hookIdx: index('webhook_deliveries_hook_idx').on(t.webhookId, t.createdAt) })
);

/** Postgres-backed job queue: SLA reminders/escalations, email sends, webhook deliveries. */
export const jobs = pgTable(
  'jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    type: text('type').notNull(),
    payload: jsonb('payload').notNull().default(sql`'{}'::jsonb`),
    runAt: timestamp('run_at', { withTimezone: true }).notNull().defaultNow(),
    status: jobStatus('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    /** Dedup key: jobs with the same key are only enqueued once while pending. */
    dedupeKey: text('dedupe_key'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    dueIdx: index('jobs_due_idx').on(t.status, t.runAt),
    dedupeIdx: uniqueIndex('jobs_dedupe_idx').on(t.dedupeKey).where(sql`status = 'pending' AND dedupe_key IS NOT NULL`),
  })
);

/** Outbound email log — every mail the system sends, for audit and dev inspection. */
export const emailLog = pgTable(
  'email_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    to: text('to').notNull(),
    subject: text('subject').notNull(),
    body: text('body').notNull(),
    ticketId: uuid('ticket_id').references(() => tickets.id, { onDelete: 'set null' }),
    status: text('status').notNull().default('sent'), // sent | logged (no SMTP configured) | failed
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ createdIdx: index('email_log_created_idx').on(t.createdAt) })
);

/** Sequential ticket numbers. */
export const counters = pgTable('counters', {
  name: text('name').primaryKey(),
  value: integer('value').notNull().default(0),
});
