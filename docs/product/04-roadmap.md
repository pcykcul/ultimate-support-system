# Roadmap

*Build sequencing for the feature spec. Phases are scope buckets, not date commitments. The guiding rule: every phase ends with something a real support team could run their day on — the "simple" thesis is proven by shipping small and coherent, not big and gated.*

## Phase 0 — Validation & foundation (before heavy build)

The research flagged real unknowns ([`10-open-questions.md`](../research/10-open-questions.md)). Cheap to resolve now, expensive later:

- **Customer discovery**: 15–20 interviews with teams on Freshdesk/Zendesk entry tiers and teams using helpdesk + Trainual/Guru side-by-side. Validate: demand for combined KB+SOP+ticketing, willingness-to-pay, SaaS vs self-hosted preference, and what actually blocks migration (data export, macros, KB import).
- **AI unit economics**: model inference cost per conversation/resolution at realistic volumes to prove "AI included flat" is viable margin-wise, and size the hard caps.
- **Technical foundation**: repo scaffolding, CI, the multi-tenant + RLS skeleton, auth, and the workspace/user/company data model — the pieces everything else builds on.

## Phase 1 — MVP: the credible simple helpdesk

*A 2–10 agent team can move their support here and lose nothing they use daily.*

- Email ticketing: inbound/outbound with correct threading, conversation view, notes vs replies, collision detection, assignment (individual + team), statuses, priorities, tags, merge.
- Macros with variables.
- Roles: Admin / Agent / Collaborator (free, unlimited) with scope picker. (Supervisor arrives with reporting in Phase 2.)
- Companies + contacts; per-company default ticket visibility.
- **Business hours core**: one+ schedules (IANA tz, per-day hours), holiday calendars with country packs, **customer local clock on every ticket** with outside-hours compose warning + scheduled send.
- **SLA core**: policies with first-response/next-response/resolution targets per priority, business-vs-calendar hours, attach to company or conditions, countdown badges, "closest to breach" sort, pre-breach reminder + one escalation level.
- **KB v1**: block editor with Markdown shortcuts, 3-level categories + tags, audience toggle (public / logged-in / internal), revision history + rollback, draft→review→publish, public help center with fast search (tsvector), agent side-panel with suggest + insert.
- Cmd+K palette and keyboard triage from day one (retrofitting is impossible).
- CSV/JSON export free; basic webhooks + REST API.
- Deploy: single docker-compose; cloud alpha on the same image.

**MVP exit criteria**: a real team migrates from Freshdesk and stays; setup-to-first-answered-ticket under 1 hour, measured.

## Phase 2 — The wedge: SOPs, portal, full SLA engine

*The things nobody else has, on top of a helpdesk that already works.*

- **SOP module**: internal reference articles with owner + verification expiry + stale flags; structured SOPs/runbooks with versioning and diff; runnable checklist instances with audit trail; macro-linked procedures; acknowledgment tracking (read + e-sign + who's-current dashboard); role-based auto-assignment.
- **Customer portal**: ticket list/detail with next-response-due, gated KB browsing, **customer-admin role** (manage company tickets, invite colleagues, control org visibility), CC'd colleagues see tickets.
- **SLA engine completion**: periodic-update metrics (incl. pausable), multi-level escalation chains for every metric, manual SLA extension with audit trail, per-plan-tier SLA defaults, SLA attainment reporting with breach drill-down.
- **Reporting v1**: volume, response/resolution times, SLA attainment, per-agent/team, CSAT surveys, KB content health (stale, zero-result queue, feedback scores).
- Supervisor role; escalation runbooks triggered by ticket state (SLA breach / priority / tag).
- Live chat widget.
- Zendesk + Freshdesk importers (tickets, contacts, KB, macros) — informed by Phase 0 migration research.

## Phase 3 — AI layer & channel expansion

*AI lands after the KB exists — content first, then the AI that feeds on it. Solves cold-start and keeps the honesty positioning.*

- RAG self-service answers in portal + widget with citations, verified-content weighting, one-click human handoff.
- Agent assist: draft reply, thread summary, tone adjust, translate.
- Auto-triage: category/priority/routing suggestions, sentiment.
- Content loops: article-draft-from-resolved-ticket; unanswered-questions report (zero-result searches + unresolved AI chats).
- WhatsApp channel with guided 10-minute onboarding; then Facebook/Instagram.
- Hybrid semantic search (pgvector) across KB + tickets.
- Per-workspace AI usage metering with visible, generous hard caps — no surprise bills, ever.

## Phase 4 — Scale & moat

- Multi-brand help centers with shared-content sync; localization with auto-stale flagging of translations.
- SSO (SAML/OIDC) — not paywalled; custom roles as the enterprise upsell (base four roles never crippled).
- SOP-aware agent assist (suggest runbook mid-ticket); Slack + Jira/GitHub bidirectional sync.
- Public changelog, status page, SOC 2 / GDPR compliance program.
- Marketplace/API depth as pull demands.

## Sequencing rationale

1. **Business hours/SLA and the local clock are Phase 1, not Phase 4** — they're this product's proof that "core, not enterprise add-on" is real, they're cheap to build early (a schedule engine designed in from the start) and brutal to retrofit (ask Zendesk's trigger-plumbing).
2. **SOPs before AI**: the SOP/KB corpus is what makes the AI good; shipping AI first repeats the incumbents' cold-start failure.
3. **Portal with customer-admin in Phase 2**: it's the most-requested missing feature in both incumbents' communities and requires the company/visibility model from Phase 1 — natural stacking.
4. **Channels late**: email + chat cover the MVP segment; WhatsApp arrives with the AI phase where its volume most benefits from deflection.
