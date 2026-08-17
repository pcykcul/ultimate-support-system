# Development Conventions

Read this before writing any code in this repo. It is the coordination contract between modules.

## Constitution

1. **No AI features. Ever.** No model calls, no embeddings, no generated replies, no "smart" anything. Search is classic IR (Postgres tsvector + pg_trgm + synonyms). Suggestions are deterministic keyword matches. If a feature needs a model, it does not belong in this codebase.
2. **No open-core.** Every feature ships to everyone. No license gates, no edition checks.
3. **Human Guarantee in every surface**: automated emails are visibly receipts; agent replies carry the agent's real name/title; the customer always sees a human response-time promise, never a bot.

## Stack & layout

- Server: Fastify 5 + Drizzle ORM + PostgreSQL (`server/`). ESM, TypeScript strict. Import local files **with `.js` extension** (NodeNext resolution): `import { db } from '../../db/index.js'`.
- Client: React 18 + Vite + Tailwind + TanStack Query (`client/`). Path alias `@/` → `client/src/`.
- **No new npm dependencies.** Everything needed is installed. If you think you need a package, you need a simpler design.

## Server rules

- Each module is a Fastify plugin at `server/src/modules/<name>/routes.ts`, default-exported, already registered in `app.ts` under its `/api/<name>` prefix. **Never edit `app.ts`, `schema.ts`, `package.json`, or files outside your assigned module.**
- Validation: `zod` via `parse(schema, req.body)` from `lib/http.js`. Errors: throw `notFound()`, `forbidden()`, `badRequest()`, `unauthorized()` from `lib/http.js`.
- Auth guards from `lib/auth.js` as preHandlers: `requireStaff` (any staff incl. collaborators), `requireAgent` (staff who act), `requireSupervisor`, `requireAdmin`, `requireCustomer`, `requireAuth`. `request.user` is the session user (or null).
- Collaborators are **read-only**: give list/get routes `requireStaff`, mutating routes `requireAgent` (or stricter).
- DB: `import { db, schema } from '../../db/index.js'` and use Drizzle query builders (`eq`, `and`, `inArray`, `desc`, `asc`, `ilike`, `sql` from `'drizzle-orm'`). Raw SQL via `` sql`...` `` template is fine for search queries.
- SLA/business-hours: **always** go through `lib/sla.js` (`applySla`, `onAgentPublicReply`, `onCustomerReply`, `onStatusChange`, `extendSla`, `loadBusinessSchedule`) and `lib/hours.js` (`formatLocalClock`, `isOpen`, `nextOpenTime`). Never hand-roll date math.
- Events: emit via `bus.emitEvent('ticket.created', {...})` from `lib/events.js` after state changes. Jobs: `enqueueJob(type, payload, { runAt, dedupeKey })` from `lib/jobs.js`.
- Email: `sendMail()` from `lib/mailer.js`. Automated mails must be labeled: subject prefixes like `[Received]`, bodies that say "This is an automated receipt — a real person will reply."
- Audit: significant ticket changes insert a `ticket_events` row.

## Client rules

- Pages live at the paths listed in `App.tsx` (already wired — **never edit `App.tsx`**, `Layout.tsx`, `theme.css`, or another area's pages).
- Data: TanStack Query + the `api` wrapper (`@/api/client`): `useQuery({ queryKey: [...], queryFn: () => api.get<T>('/api/...') })`; mutations invalidate their query keys.
- UI: primitives from `@/lib/ui` (`Button`, `Input`, `Textarea`, `Select`, `Card`, `Badge`, `Modal`, `PageHeader`, `EmptyState`, `Countdown`, `timeAgo`, `cx`, `BackLink`). Markdown rendering via `Markdown` from `@/lib/markdown`. Icons from `lucide-react`. Tailwind classes; brand color via `bg-brand`, `text-brand`, `bg-brand-soft`.
- Session: `useMe()`, `useBranding()` from `@/lib/session`.
- Keyboard-first: list pages should support j/k navigation and Enter-to-open where practical.

## API contract (authoritative)

Server modules implement exactly this; client pages consume exactly this. Shapes are JSON; dates are ISO strings; list endpoints return `{ items: [...], total?: number }` unless noted.

### auth (`/api/auth`)
- `POST /login` `{email, password}` → user object (staff or customer). Sets session cookie.
- `POST /logout` → 204.
- `GET /me` → user object or 401. Shape: `{id, kind, role, name, email, title, avatarUrl, timezone}`.
- `POST /accept-invite` `{token, name, password}` → user (token = invite id emailed to user; store invites in `settings` table under key `invite:<token>` with `{email, role, expiresAt}`).

### users (`/api/users`) — staff directory & teams
- `GET /` (staff) → `{items: [{id,name,email,role,title,timezone,active,teamIds:[...]}]}`; `?kind=staff|customer&q=` filter.
- `POST /` (admin) `{email,name,role,title?,timezone?}` → creates invited staff user (no password yet) + emails invite link; response includes `inviteToken` in dev.
- `PATCH /:id` (admin, or self for name/title/timezone/avatar) → updated user.
- `POST /:id/deactivate` (admin) → 204.
- `GET /teams` (staff) → `{items: [{id,name,emoji,scheduleId,memberIds:[...]}]}`.
- `POST /teams` (admin) `{name,emoji?}`; `PATCH /teams/:id` `{name?,emoji?,scheduleId?,memberIds?}`; `DELETE /teams/:id` (admin).

### companies (`/api/companies`)
- `GET /` (staff) `?q=` → `{items: [{id,name,domains,tier,timezone,membersSeeAllTickets,slaPolicyId,scheduleId,memberCount,openTickets}]}`.
- `POST /` (agent) `{name,domains?,tier?,timezone?}`; `PATCH /:id` (agent); `DELETE /:id` (admin).
- `GET /:id` → company + `members: [{userId,name,email,isCompanyAdmin,canViewAllTickets}]`.
- `POST /:id/members` (agent) `{email,name}` → creates/links customer user.
- `PATCH /:id/members/:userId` (agent) `{isCompanyAdmin?,canViewAllTickets?}`; `DELETE /:id/members/:userId`.

### tickets (`/api/tickets`)
- `GET /` (staff) query params: `status` (csv), `assigneeId|me|unassigned`, `teamId`, `companyId`, `priority`, `q`, `sort` (`updated|created|sla`), `page`, `limit` → `{items, total}`. Each item: `{id,number,subject,status,priority,channel,requester:{id,name,email},company:{id,name}|null,assignee:{id,name}|null,teamId,tags,nextSlaDueAt,slaBreached,firstResponseDueAt,nextResponseDueAt,resolutionDueAt,lastCustomerReplyAt,updatedAt,createdAt}`. Respect the caller's `scope` (assigned → only their tickets; team → their teams').
- `POST /` (agent) `{subject, body, requesterEmail, requesterName?, companyId?, priority?, teamId?, assigneeId?, tags?, channel?}` → creates requester customer user if needed (auto-associate company by email domain), ticket + first message, applies SLA, sends the labeled receipt email with the human response promise, emits `ticket.created`. → full ticket.
- `GET /:id` (staff) → `{ticket, messages: [{id,kind,author:{id,name,title,avatarUrl,kind}|null,body,createdAt}], events: [...], followers, requesterLocalTime: {label,isDaytime,isBusinessHoursGuess}|null, sla: {policyName|null}, runs: [{id,sopId,sopTitle,status}]}`.
- `POST /:id/messages` (staff; collaborators only `kind:'internal'`) `{body, kind: 'public'|'internal'}` → message. On public: calls `onAgentPublicReply`, emails the requester the reply (signed with agent name/title), emits `message.created`.
- `PATCH /:id` (agent) `{status?,priority?,assigneeId?,teamId?,tags?,companyId?}` → status changes via `onStatusChange`, priority/company changes re-run `applySla`, all changes audit to `ticket_events`, emit `ticket.updated` / `ticket.status_changed`.
- `POST /:id/merge` (agent) `{sourceTicketId}` → moves messages into target as internal notes + closes source with audit events.
- `POST /:id/macros/:macroId` (agent) → returns `{body}` rendered (variables `{{customer.name}}`, `{{agent.name}}`, `{{ticket.number}}`, `{{snippet:key}}`) + applies macro actions + surfaces linked SOP `{sopId,sopTitle}`.
- `POST /:id/extend-sla` (agent) `{metric,newDueAt,reason}` → uses `extendSla`.
- `POST /:id/follow` / `DELETE /:id/follow` (staff).
- `GET /macros` (staff) → `{items}`; `POST /macros` (agent) `{name,body,actions?,sopId?}`; `PATCH /macros/:id`; `DELETE /macros/:id` (supervisor).
- `GET /palette-search?q=` (staff) → `[{type:'ticket'|'article'|'sop', id, title, subtitle, url}]` (top 8 across tickets/articles/SOPs via FTS; url = `/tickets/:id` etc.).

### kb (`/api/kb`) — staff-side authoring
- `GET /categories` (staff) → tree `{items: [{id,parentId,name,slug,audience,position,brandId}]}`; `POST /categories` (agent), `PATCH /categories/:id`, `DELETE /categories/:id`.
- `GET /articles` (staff) `?status=&categoryId=&q=&audience=` → `{items: [{id,title,slug,status,audience,articleType,categoryId,owner:{id,name}|null,verifiedAt,verifyIntervalDays,stale:boolean,helpfulYes,helpfulNo,viewCount,updatedAt}]}`.
- `POST /articles` (agent) `{title, body?, categoryId?, audience?, articleType?}` → draft article (slug auto).
- `GET /articles/:id` → article + `revisions: [{id,title,authorName,note,createdAt}]`.
- `PATCH /articles/:id` (agent) `{title?,body?,categoryId?,audience?,articleType?,ownerId?,verifyIntervalDays?,companyIds?}` → saves + creates revision row.
- `POST /articles/:id/submit-review` (agent), `POST /articles/:id/publish` (supervisor — the approval gate), `POST /articles/:id/archive` (supervisor).
- `POST /articles/:id/verify` (agent = owner or supervisor) → stamps verifiedAt.
- `POST /articles/:id/rollback` (agent) `{revisionId}` → restores that revision (as a new revision).
- `GET /articles/:id/revisions/:revId` → full revision body (for diff view).
- `GET /suggest?q=` (staff) → top 5 published articles matching (FTS + trigram) — used in the ticket sidebar: `[{id,title,slug,audience,snippet}]`.
- `GET /health` (staff) → `{stale: [...], lowRated: [...], zeroResultQueries: [{query,count,lastAt}], topViewed: [...]}`.
- `GET /snippets` (staff), `POST /snippets` (agent) `{key,value}`, `PATCH /snippets/:id`, `DELETE /snippets/:id`.

### helpcenter (`/api/help-center`) — public, no auth
- `GET /home` → `{branding: {name,logoUrl,helpCenterTitle,humanPromise,colors}, categories: [{id,name,slug,description, articles: [{id,title,slug}]}]}` (audience='public', status='published' only).
- `GET /articles/:slug` → `{id,title,body,updatedAt,category:{name,slug}}` (increments viewCount).
- `GET /search?q=` → `[{id,title,slug,snippet}]` — logs to `kb_search_queries` (source='help_center'), applies synonyms, FTS + trigram fallback.
- `POST /articles/:id/feedback` `{helpful, comment?}` → 204 (updates counters + kb_feedback row).

### schedules (`/api/schedules`)
- `GET /` (staff) → `{items: [{id,name,timezone,isDefault,holidayCalendarId,intervals: [{weekday,startMinute,endMinute}]}]}`.
- `POST /` (supervisor) `{name,timezone,intervals,holidayCalendarId?,isDefault?}`; `PATCH /:id`; `DELETE /:id` (admin). Setting `isDefault` clears other defaults. After any schedule change, re-run `applySla` for open tickets on that schedule (fire-and-forget loop is fine).
- `GET /holiday-calendars` → `{items: [{id,name,countryCode,holidays:[{id,name,date}]}]}`; `POST /holiday-calendars` `{name,countryCode?}`; `POST /holiday-calendars/:id/holidays` `{name,date}`; `DELETE /holidays/:id`; `DELETE /holiday-calendars/:id`.
- `POST /holiday-calendars/import` (supervisor) `{countryCode, year}` → creates calendar from built-in packs (implement packs for AU, US, GB, NZ, CA public holidays for 2026-2027 as data in the module).
- `GET /preview-local-time?timezone=` (staff) → `formatLocalClock` result now.

### sla (`/api/sla`)
- `GET /policies` (staff) → `{items: [{id,name,description,position,conditions,scheduleId,enabled,targets:[{metric,priority,minutes,useBusinessHours}],escalations:[{metric,level,minutesOffset,notifyAssignee,notifySupervisors}]}]}`.
- `POST /policies` (supervisor), `PATCH /policies/:id`, `DELETE /policies/:id` (admin), `POST /policies/reorder` `{ids}` — writes targets/escalations wholesale (delete + insert within the PATCH).
- `GET /attainment?from=&to=` (staff) → `{policies: [{policyId,name,metrics:[{metric,total,achieved,breached,pct}]}], breaches: [{ticketId,number,subject,metric,dueAt,companyName}]}` (computed from ticket_events 'sla_achieved'/'sla_breach' rows + current ticket state).
- SLA jobs (`modules/sla/jobs.ts` — `registerSlaJobs()`): a `sla.sweep` job every minute (self-re-enqueueing with dedupeKey 'sla-sweep'): calls `sweepBreaches`, emits `sla.breach` + inserts ticket_events + enqueues escalation notifications per policy `slaEscalations` (dedupe per ticket+metric+level), and pre-breach warnings (`sla.warning`) for tickets whose `nextSlaDueAt` is within each escalation's negative offset. Notifications = `sendMail` to assignee/supervisors + ticket_events row.

### settings (`/api/settings`)
- `GET /branding/public` (no auth) → `{name,logoUrl,colors,helpCenterTitle,humanPromise}` (from settings keys, brand default fallback).
- `GET /branding` (admin) / `PUT /branding` (admin) `{name,logoUrl?,colors?,helpCenterTitle?,humanPromise?,emailFrom?}` → stored in settings table under `branding`.
- `GET /automations` (supervisor) → `{items}`; `POST /automations` `{name,event,conditions,actions}`; `PATCH /automations/:id`; `DELETE /automations/:id`. On boot, module subscribes to bus events and executes matching automations' actions (assign_team, set_priority, add_tags, notify (email userIds), start_sop, send_webhook).
- `GET /webhooks` (admin), `POST /webhooks` `{name,url,secret?,events}`, `PATCH /webhooks/:id`, `DELETE /webhooks/:id`, `GET /webhooks/:id/deliveries` → last 50.
- `modules/settings/webhook-jobs.ts` — `registerWebhookJobs()`: job handler `webhook.deliver` POSTs payload with `X-USS-Signature` (HMAC-SHA256 of body with secret), records delivery. Module also subscribes bus '*' → enqueues deliveries for enabled webhooks whose events match.
- `GET /synonyms` (staff), `POST /synonyms` `{terms:[...]}`, `DELETE /synonyms/:id`.
- `GET /email-log` (admin) → last 100 outbound emails.

### reports (`/api/reports`)
- `GET /overview?from=&to=` (staff; supervisors see per-agent) → `{volume: {created,solved,open}, byChannel: [{channel,count}], responseTimes: {medianFirstResponseMin, medianResolutionMin}, sla: {achievedPct, breached}, csat: {avg, count}, perAgent: [{agentId,name,replies,solved,medianFirstResponseMin}], byDay: [{date,created,solved}], deflection: {searches, zeroResults, ticketsCreated}}`.

### portal (`/api/portal`) — customer-side (requireCustomer)
- `GET /tickets` → own tickets; company admins / canViewAllTickets members also see company tickets: `{items: [{id,number,subject,status,priority,updatedAt,requesterName,nextHumanReplyBy: iso|null}]}` — `nextHumanReplyBy` = the visible human promise (firstResponseDueAt ?? nextResponseDueAt).
- `POST /tickets` `{subject, body}` → creates ticket (channel 'portal'), applies SLA, returns ticket + `nextHumanReplyBy`; response of `GET /tickets/:id` → `{ticket:{...,nextHumanReplyBy}, messages: [public messages only, with author {name,title,avatarUrl} for staff]}`.
- `POST /tickets/:id/messages` `{body}` → customer reply (calls `onCustomerReply`).
- `POST /tickets/:id/csat` `{score, comment?}` (only when solved/closed).
- `GET /kb?q=` → published articles with audience in ('public','customers') (+ company-scoped for their companies): categories + articles list; `GET /kb/:slug` → article body. Search logs source='portal'.
- `GET /company` → for company admins: `{company, members, tickets}` ; `POST /company/members` `{email,name}` (company admin invites colleague); `PATCH /company/members/:userId` `{canViewAllTickets?}` (company admin).
- `POST /register` (no auth) `{email,name,password}` → customer account (auto-associate company by domain); `POST /../auth/login` shared.

### inbound-email (`/api/inbound-email`)
- `POST /` header `x-inbound-secret` must equal config.inboundEmailSecret. Body `{from: {email,name?}, to?, subject, text, messageId?, inReplyTo?}` → threads by `inReplyTo`/subject `[#123]` marker into existing ticket (customer reply path) or creates a new ticket (channel 'email') + receipt email. This is the provider-agnostic email webhook (works with Postmark/SES/Mailgun payload adapters written as tiny mappers).

### chat (`/api/chat`) — Phase 3
- `POST /start` (no auth) `{name?, email?, message}` → `{ticketId, visitorToken}` — creates ticket channel 'chat' (+ lightweight customer user). Honest presence: response includes `{online: boolean, promise: string}` computed from the default schedule (`isOpen`) — "We're online" only when true.
- `GET /:ticketId/stream?token=` → SSE stream of new public messages (bus-driven).
- `POST /:ticketId/messages` `{token, body}` → customer chat message (onCustomerReply).
- Staff replies flow through the normal tickets API; SSE fan-out via bus 'message.created'.
- `GET /widget-search?q=` (no auth) → same as help-center search, source='widget'.

### export (`/api/export`) — Phase 4
- `GET /tickets.csv|.json` (admin) — full dump; `GET /kb.json`, `GET /sops.json` (admin).
- `POST /gdpr/anonymize-user` (admin) `{email}` → scrubs PII (name→'Anonymized', email→null) keeping ticket stats.
- `GET /backup.json` (admin) → single-file logical export of all tables.

### sops (`/api/sops`) — Phase 2
- `GET /` (staff) `?kind=&status=&q=` → `{items: [{id,kind,title,slug,status,owner:{id,name}|null,teamId,version,verifiedAt,verifyIntervalDays,stale,requiresAcknowledgment,stepCount,updatedAt}]}`.
- `POST /` (agent) `{kind,title,body?,teamId?}`; `GET /:id` → sop + steps + revisions + myAssignment `{sopVersion,acknowledgedAt}|null`; `PATCH /:id` (agent) `{title?,body?,steps?:[{title,body?,roleHint?}],teamId?,ownerId?,verifyIntervalDays?,triggers?,requiresAcknowledgment?}` → bumps version + snapshot revision when title/body/steps change.
- `POST /:id/publish` (supervisor); `POST /:id/verify` (owner/supervisor); `POST /:id/rollback` `{version}`.
- `POST /:id/runs` (staff) `{ticketId?}` → instantiates run with step snapshot → `{run}`; `GET /runs/:runId` → run + steps; `PATCH /runs/:runId/steps/:stepRunId` `{done,note?}` (records doneBy/doneAt); `POST /runs/:runId/complete`; `POST /runs/:runId/cancel`.
- `POST /:id/assign` (supervisor) `{userIds?, teamId?, dueAt?}` → creates assignments for current version; `POST /:id/acknowledge` `{signatureName}` (assignee signs).
- `GET /acknowledgments/mine` (staff) → my pending/done assignments; `GET /:id/acknowledgments` (supervisor) → who's current dashboard.
- Ticket-state triggers: module subscribes to bus (`ticket.updated`, `sla.breach`) and auto-starts runs per sop.triggers, attaching to the ticket.

## Quality bar

- `npm run typecheck` must pass with zero errors — strict mode, no `any` unless genuinely unavoidable.
- Server modules: handle not-found and permission cases; never trust client-supplied ids without scoping checks (especially portal routes — a customer must never read another company's data).
- UI: loading and empty states for every list; mutations show optimistic or invalidate-refetch behavior; no dead buttons.
- Write code a contributor can read in an evening: clear names, small functions, comments only where the *why* is non-obvious.
