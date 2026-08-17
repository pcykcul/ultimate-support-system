# Feature Specification

*What the ideal support system contains, module by module. Grounded in the research in [`docs/research/`](../research/) — each design choice traces to a documented competitor gap or complaint. This is a product spec, not an implementation plan; see [`03-architecture.md`](03-architecture.md) and [`04-roadmap.md`](04-roadmap.md) for build sequencing.*

## Module 1 — Ticketing & Inbox

The core loop: a customer writes in on any channel; the ticket lands in one inbox; the right agent answers fast, with context.

**Essentials**
- Email-first ingestion (forwarding + native mailboxes), web widget/live chat, and a customer portal form. WhatsApp and socials follow (guided ~10-minute setup — incumbents gate WhatsApp behind Omni SKUs or Meta verification gymnastics).
- Conversation-style ticket view (email-familiar mental model — Help Scout's most-cited strength) with public replies vs internal notes, collision detection ("Sam is typing…"), @mentions, and followers.
- Statuses: New / Open / Waiting on customer / On hold / Solved / Closed. Status drives SLA timer semantics (see Module 5) — documented, predictable pause rules.
- Assignment: individual + team (group) ownership; round-robin and load-based auto-assignment as opt-in defaults, not trigger-programming projects.
- Macros/canned replies with variables; merging tickets (a Freshdesk gap — no automated merge); child/linked tickets that keep conversation history (Freshdesk's child tickets break it).
- Priorities (Low/Normal/High/Urgent), tags, custom fields (typed: text, select, date, number).
- Fast full-text search across tickets from a **Cmd+K command palette**; keyboard-first triage (j/k navigation, single-key assign/snooze/close — the Linear pattern).

**Deliberately not in v1:** voice/telephony, social channels beyond WhatsApp, visual workflow builders. Depth over breadth; every "not yet" is a public roadmap entry, not a silent absence.

## Module 2 — Knowledge Base

One editor, three publishing surfaces: public help center, logged-in customer portal, internal. In a human-only product the KB carries the deflection load: every question it answers well never becomes a ticket, which is exactly what keeps human response times fast.

- **Editor**: Notion-quality block editor with Markdown shortcuts, slash commands, images/callouts/tables, real-time co-editing and inline comments. (Zendesk Guide still has no Markdown in its article editor — promised since 2022.)
- **Structure**: category tree capped at 3 levels + tags as a secondary facet; article types (how-to / FAQ / troubleshooting / reference); drag-and-drop tree manager; article templates.
- **Audience toggle per article/category**: Public / Logged-in customers / Specific companies / Internal-only. This single control replaces Zendesk user-segments (Professional+), gated portals, and "internal KB" hacks.
- **Versioning for everyone**: revision history, visual diff, rollback, scheduled publishing. Draft → Review → Published workflow with an approval gate. (Freshdesk gates versioning at $55/agent and approvals at $89/agent. Here both are simply free.)
- **Verification loop (Guru's model, built in)**: every article has an owner and a re-verify interval; expired articles get flagged in-product and wear a "needs review" badge until a human re-verifies them.
- **Reusable snippets/variables** (product names, prices, UI strings) — Zendesk gates this (Content Blocks) to Enterprise; here it's just a feature.
- **Search**: classic search done properly — typo tolerance, synonym dictionaries, instant results as you type. No embeddings, no AI: great search is an engineering problem, not a model problem. **Zero-result query tracking feeds a "write this article" queue** — the highest-value KB analytics feature per the research.
- **Feedback & analytics**: was-this-helpful with optional free text, contact-rate-after-view, deflection tracking, and a single "content health" dashboard (stale / low-rated / zero-result / high-traffic-low-deflection).
- **Agent-side panel in the ticket view**: keyword-matched article suggestions (deterministic search over the ticket's subject and body — no AI), one-click insert as link or expanded text, flag-as-outdated inline, and **convert-resolved-ticket-to-article-stub** (a structural transform of the thread into a draft template a human then writes properly).
- **Localization (post-MVP)**: human translation workflow with per-locale status; when the source article changes, all locales auto-flag as outdated (no incumbent does this); translation-status dashboard.
- **Multi-brand**: multiple help centers with shared-content sync, included (Zendesk: 1 help center at $55/agent, no content sync at any tier).

## Module 3 — SOPs & Internal Procedures

The unserved wedge: procedures live where the work happens, permissioned by tier, with ownership and proof of reading. Three internal content types, one system:

1. **Internal reference articles** — same editor as the KB, audience = internal; verified-badge + owner + re-verify interval.
2. **SOPs / runbooks** — structured step/checklist documents (steps, decision points, links to macros and tools) with version control, diff, rollback, and per-version usage stats.
3. **Runnable checklist instances** — an SOP can be *instantiated* against a ticket or standalone: each run tracks who did which step when, with an audit trail. (The "execution layer" that pure-documentation tools lack.)

Killer integrations no competitor ships natively:
- **Macro-linked procedures**: applying the "Refund request" macro surfaces the refund runbook in the ticket sidebar; the ticket links to the SOP run for QA/audit.
- **Escalation runbooks triggered by ticket state**: SLA breach, priority=Urgent, or a "security" tag auto-instantiates the matching runbook with role-assigned steps.
- **Acknowledgment tracking without LMS bloat**: assign an SOP to a role/team → require read + e-sign → dashboard of who's current. This is the #1 reason ops teams pay Trainual $249+/mo.
- **Role-based auto-assignment**: new agent joins the "Billing" team → billing SOPs auto-assigned with due dates.
- In-product flags for stale SOPs, not email nudge spam (Trainual's most-hated behavior).

## Module 4 — Users, Tiers & Permissions

**Internal roles — four cover ~95% of needs** (custom roles can come later; the base four are never crippled):

| Role | Can |
|---|---|
| **Admin/Owner** | Everything: settings, billing, schedules, SLAs, roles |
| **Supervisor** | Team management, reporting, all tickets, SLA/schedule editing |
| **Agent** | Work tickets in scope, author KB/SOP drafts, run SOPs |
| **Collaborator** — *unlimited* | View tickets in scope, private notes, @mentions, view internal KB/SOPs |

- "What you can do" (role) and "what you can see" (scope: all tickets / team's tickets / assigned only) are two pickers on one screen — Freshdesk's split is right, its UX isn't.
- Because the platform is free and self-hosted with no per-seat pricing at all, the most universal complaint in the research ("the CEO who logs in once a quarter pays like a power user"; Zendesk Suite Team: $0 light agents included; Freshdesk Growth: zero collaborators) disappears structurally — every teammate can have exactly the role that fits.

**End-customer side**
- **Company (organization) as a first-class object**: domains for auto-association, plan tier field, SLA policy attachment, default ticket-visibility setting (*per company*, not buried per-contact — the top community request in both Zendesk's and Freshdesk's forums).
- **Customer-admin portal role** — the most-requested missing feature across incumbent communities: a customer-side admin who can see and manage all their company's tickets, invite/deactivate colleagues, and control whether org-mates see each other's tickets.
- Contacts can belong to multiple companies (agency/consultant reality) with per-company visibility.
- Portal: view/create tickets, browse the gated KB, see ticket status + next-response-due commitment. CC'd colleagues can actually see the ticket in the portal (a Freshdesk gap).
- End users: always free, always unlimited.

## Module 5 — Business Hours, Timezones & SLAs

Core plumbing in every install — the full research is in [`08-business-hours-sla.md`](../research/08-business-hours-sla.md). The concrete scenario this module must make trivial: *"We deployed support for Australia; Australian clients must get a first response within 15 minutes during Sydney business hours, and our agents should always see the client's local time."*

**Schedules**
- Named schedules: IANA timezone + per-day working hours (e.g. "Sydney Office — Mon–Fri 09:00–17:30 Australia/Sydney"). Multiple schedules included (Zendesk gates this to Enterprise).
- **Shared holiday calendars with importable country packs** (Freshdesk's best idea), reusable across schedules; SLA clocks pause on holidays.
- Schedules attach to teams, companies, or SLA policies directly — no trigger plumbing (Zendesk's setup requires trigger gymnastics that its own community complains about).
- DST handled correctly by design: store UTC + IANA zone, schedules shift automatically at changeover, historical timestamps render in the offset in effect *at event time* (a documented Zendesk confusion source).

**Customer local time — everywhere**
- Every ticket and contact shows the customer's current local time with a day/night indicator ("3:42 PM Tue · Sydney ☀️"). Timezone inferred from company setting, phone country code, or portal browser — override-able.
- **Compose warning** when replying outside the customer's business hours ("It's 2:10 AM for this customer — schedule send for their morning?") with one-click scheduled send.
- No major helpdesk ships this natively — Zendesk needs marketplace apps.

**SLA policies**
- A policy = conditions (company, plan tier, priority, channel, tags) + per-priority targets. Ordered list, first match wins — but **SLAs also attach directly to a Company or plan-tier field** (the MSP-tool model: SLA as a contract attribute of the customer, not a workflow rule to reconstruct).
- Metrics: First response, Next response, Periodic update (pausable variant included — Zendesk's most-requested missing metric), Resolution. Each target per priority is business-hours or calendar-hours, measured against the policy's/company's schedule.
- Documented, status-driven pause semantics: timers pause on "Waiting on customer" / "On hold" per metric type.
- **Agent UX**: "next response due" on every ticket; countdown badges in list views; queue sort "closest to breach first" — and **breached tickets stay visible and sortable** (Zendesk's badge disappears at breach; tickets vanish from the sort — a known flaw).
- **Pre-breach reminders and multi-level escalation for every metric** (not Freshdesk's response/resolution asymmetry): notify assignee at T-minus X, escalate to supervisor at breach, then up a chain. Business-hours aware. No tag hacks.
- Manual SLA extension with audit trail (Freshdesk's genuinely liked feature).
- **SLA attainment reporting included**: % achieved by policy/metric/priority, breach drill-down (which team, which stage, which day).
- Optional per-customer-tier defaults (your Enterprise clients: 15-min first response; Standard: 4h; Free: 24h) — as first-class objects, the MSP-contract model.

## Module 6 — The Human Guarantee (no AI, by design)

The standout. In 2026 every competitor inserts AI between the customer and a person; this platform's contract is the opposite: **submit a ticket, and a real human gets back to you.** The research backs the bet: 64% of customers wish companies would stop using AI in support, 68% prefer a live human, only 14% of AI self-service interactions resolve, and Klarna publicly reversed its AI-replaces-agents strategy (see [`09-trends-ai.md`](../research/09-trends-ai.md)).

- **No chatbots, no auto-generated answers, no AI-drafted replies.** Not a plan limitation — a product constitution. Nothing in the customer experience is ever produced by a model.
- **Auto-receipts that are honestly receipts**: "We got your ticket — a person will reply by 2:18 PM your time." Clearly labeled as automatic, never fake conversation, never a bot pretending to type.
- **The response promise is visible**: the portal and the email receipt show the next-response-due commitment, computed by the SLA engine against business hours (Module 5), rendered in the customer's local timezone. The promise is only ever about a *human* reply.
- **Named humans**: every reply signed by a real person — name, role, optional photo. Optional "meet the team" section on the help center. People trust people.
- **The human-speed toolkit** (what keeps the promise keepable without bots): macros and snippets, keyboard-first triage, SOP runbooks in the ticket sidebar, collision detection, closest-to-breach queue sorting, and scheduled send for timezone politeness.
- **Deflection without bots**: the widget and portal search the KB as the customer types their ticket — plain, clearly-labeled search suggestions, with "skip and talk to a human" always one click away and never gatekept behind a bot conversation.
- **Privacy dividend**: no customer data ever sent to a model provider, nothing trains on your conversations, no third-party inference dependency. Combined with self-hosting: support data never leaves your server.

## Module 7 — Automation, Reporting, Platform & White-Label

- **Automation**: a small set of understandable rules (when X, do Y) with sane prebuilt defaults — auto-assignment, SLA escalations, satisfaction survey send. Deterministic and inspectable; explicitly not a Zapier clone at launch.
- **Reporting included**: ticket volume, response/resolution times, SLA attainment, CSAT, deflection, per-agent and per-team views, KB content health. (Reporting paywalls are a top-3 complaint against both incumbents.)
- **White-label by configuration** (a core requirement — this system will be deployed under multiple brands): instance-level product name, logo, favicon, color theme, email templates and sender identity (custom domain + DKIM), portal/help-center domains, and login-page branding — all settings, never code changes, so a rebrand survives every upgrade. Attribution is optional and off by default; nothing in the customer-facing surface reveals the underlying platform unless the operator wants it to.
- **Platform**: REST API + webhooks from day one; CSV/JSON export always available (Freshdesk gates CSV export); Zendesk/Freshdesk importers as an adoption wedge (migration tooling detail is an open research question — see [`10-open-questions.md`](../research/10-open-questions.md)).
- **Trust, open-source style**: developed in the open (public repo, public roadmap, changelog); no telemetry by default (opt-in only, transparent about what's counted); security hardening guide and responsible-disclosure policy early; a documented upgrade path for every release — evergreen means never being afraid to update.
