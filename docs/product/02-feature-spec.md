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
- Full-text + semantic search across tickets from a **Cmd+K command palette**; keyboard-first triage (j/k navigation, single-key assign/snooze/close — the Linear pattern).

**Deliberately not in v1:** voice/telephony, social channels beyond WhatsApp, visual workflow builders. Depth over breadth; every "not yet" is a public roadmap entry, not a silent absence.

## Module 2 — Knowledge Base

One editor, three publishing surfaces: public help center, logged-in customer portal, internal. The KB doubles as the AI's retrieval corpus, so authoring quality directly powers deflection.

- **Editor**: Notion-quality block editor with Markdown shortcuts, slash commands, images/callouts/tables, real-time co-editing and inline comments. (Zendesk Guide still has no Markdown in its article editor — promised since 2022.)
- **Structure**: category tree capped at 3 levels + tags as a secondary facet; article types (how-to / FAQ / troubleshooting / reference); drag-and-drop tree manager; article templates.
- **Audience toggle per article/category**: Public / Logged-in customers / Specific companies / Internal-only. This single control replaces Zendesk user-segments (Professional+), gated portals, and "internal KB" hacks.
- **Versioning on every plan**: revision history, visual diff, rollback, scheduled publishing. Draft → Review → Published workflow with an approval gate. (Freshdesk: versioning $55, approvals $89. We ship both at base.)
- **Verification loop (Guru's model, built in)**: every article has an owner and a re-verify interval; expired articles get flagged in-product and the AI deprioritizes/labels stale content in answers.
- **Reusable snippets/variables** (product names, prices, UI strings) at every tier — Zendesk gates this (Content Blocks) to Enterprise.
- **Search**: hybrid keyword + semantic, synonym support, typo tolerance, instant results. **Zero-result query tracking feeds a "write this article" queue** — the highest-value KB analytics feature per the research.
- **Feedback & analytics**: was-this-helpful with optional free text, contact-rate-after-view, deflection tracking, AI citation rate, and a single "content health" dashboard (stale / low-rated / zero-result / high-traffic-low-deflection).
- **Agent-side panel in the ticket view**: auto-suggested articles, one-click insert as link or expanded text, flag-as-outdated inline, and **create-article-draft-from-resolved-ticket**.
- **Localization (post-MVP)**: machine-translate from a canonical source; when the source changes, all locales auto-flag as outdated (no incumbent does this); translation-status dashboard.
- **Multi-brand**: multiple help centers with shared-content sync on every paid plan (Zendesk: 1 help center at $55, no content sync at any tier).

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

**Internal roles — four cover ~95% of needs** (custom roles can come later as an upsell; the base four are never crippled):

| Role | Can |
|---|---|
| **Admin/Owner** | Everything: settings, billing, schedules, SLAs, roles |
| **Supervisor** | Team management, reporting, all tickets, SLA/schedule editing |
| **Agent** | Work tickets in scope, author KB/SOP drafts, run SOPs |
| **Collaborator** — *free, unlimited, every plan* | View tickets in scope, private notes, @mentions, view internal KB/SOPs |

- "What you can do" (role) and "what you can see" (scope: all tickets / team's tickets / assigned only) are two pickers on one screen — Freshdesk's split is right, its UX isn't.
- Free unlimited collaborators directly attack the most universal pricing complaint in the research ("the CEO who logs in once a quarter pays like a power user"; Zendesk Suite Team: $0 light agents included; Freshdesk Growth: zero collaborators).

**End-customer side**
- **Company (organization) as a first-class object**: domains for auto-association, plan tier field, SLA policy attachment, default ticket-visibility setting (*per company*, not buried per-contact — the top community request in both Zendesk's and Freshdesk's forums).
- **Customer-admin portal role** — the most-requested missing feature across incumbent communities: a customer-side admin who can see and manage all their company's tickets, invite/deactivate colleagues, and control whether org-mates see each other's tickets.
- Contacts can belong to multiple companies (agency/consultant reality) with per-company visibility.
- Portal: view/create tickets, browse the gated KB, see ticket status + next-response-due commitment. CC'd colleagues can actually see the ticket in the portal (a Freshdesk gap).
- End users: always free, always unlimited.

## Module 5 — Business Hours, Timezones & SLAs

Core plumbing on every plan — the full research is in [`08-business-hours-sla.md`](../research/08-business-hours-sla.md). The concrete scenario this module must make trivial: *"We deployed support for Australia; Australian clients must get a first response within 15 minutes during Sydney business hours, and our agents should always see the client's local time."*

**Schedules**
- Named schedules: IANA timezone + per-day working hours (e.g. "Sydney Office — Mon–Fri 09:00–17:30 Australia/Sydney"). Multiple schedules on every paid plan (Zendesk: Enterprise-only).
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
- Optional per-plan-tier defaults: Enterprise customers 15-min first response, Standard 4h, Free 24h — as first-class objects.

## Module 6 — AI Layer (included in price)

Grounded in honesty: independent tests measure 38–50% real deflection, not vendors' 65–80% marketing. AI is included flat; if margins ever force limits, they're generous, visible, and hard-capped — never a surprise bill.

- **Self-service answers (RAG over the KB)** in portal search and chat widget, always citing source articles, always one click from "talk to a human." Stale (unverified) articles are deprioritized and labeled.
- **Agent assist**: draft reply from ticket + KB context, summarize long threads, tone adjust, translate.
- **Triage**: auto-categorize, priority suggestion, routing suggestion; sentiment flag.
- **Content loops**: draft KB article from resolved ticket; "unanswered questions" report from zero-result searches and unresolved AI conversations.
- **SOP-aware assist (later)**: suggest the relevant runbook mid-ticket (Zendesk sells this as a $50/agent add-on on a $115+ plan).

## Module 7 — Automation, Reporting, Platform

- **Automation**: a small set of understandable rules (when X, do Y) with sane prebuilt defaults — auto-assignment, SLA escalations, satisfaction survey send. Explicitly not a Zapier clone at launch.
- **Reporting included on every plan**: ticket volume, response/resolution times, SLA attainment, CSAT, deflection, per-agent and per-team views, KB content health. (Reporting paywalls are a top-3 complaint against both incumbents.)
- **Platform**: REST API + webhooks from day one; CSV/JSON export always free (Freshdesk gates CSV export); Zendesk/Freshdesk importers as a growth wedge (migration tooling is an open research question — see [`10-open-questions.md`](../research/10-open-questions.md)).
- **Trust**: public changelog, public roadmap, status page; SOC 2 / GDPR posture planned early (table stakes even for SMB — flagged in open questions).
