# Roadmap

*Build sequencing for the feature spec. Phases are scope buckets, not date commitments. The guiding rule: every phase ends with something a real support team could run their day on — the "simple" thesis is proven by shipping small and coherent, not big and gated. The first production users are the maintainer's own startups/businesses, each on a rebranded instance — real support traffic is the acceptance test.*

## Phase 0 — Project foundation

Decisions and scaffolding that are cheap now and expensive later:

- **License & pledges**: adopt the license (AGPL-3.0 recommended — see [`03-architecture.md`](03-architecture.md)) and publish the two constitutional pledges in the README: **no AI, ever** and **no open-core, ever**.
- **Open-source hygiene**: CONTRIBUTING, code of conduct, issue/PR templates, GitHub Discussions for design feedback — the evergreen goal starts with structure that outlives any single maintainer.
- **Design-partner validation**: the maintainer's businesses enumerate their real support flows (channels, volumes, timezone coverage, SOPs they run today); these define MVP acceptance criteria. Open questions from the research ([`10-open-questions.md`](../research/10-open-questions.md)) get worked in public.
- **Technical foundation**: repo scaffolding, CI, the single-tenant app skeleton, auth, core data model (workspace, users, roles, companies, contacts), and the **branding/theming configuration layer** — white-label is a day-one concern because the first deployments are rebranded.

## Phase 1 — MVP: the credible simple helpdesk

*A 2–10 agent team can move their support here and lose nothing they use daily.*

- Email ticketing: inbound/outbound with correct threading, conversation view, notes vs replies, collision detection, assignment (individual + team), statuses, priorities, tags, merge.
- Macros with variables.
- Roles: Admin / Agent / Collaborator (unlimited) with scope picker. (Supervisor arrives with reporting in Phase 2.)
- Companies + contacts; per-company default ticket visibility.
- **Business hours core**: one+ schedules (IANA tz, per-day hours), holiday calendars with country packs, **customer local clock on every ticket** with outside-hours compose warning + scheduled send.
- **SLA core**: policies with first-response/next-response/resolution targets per priority, business-vs-calendar hours, attach to company or conditions, countdown badges, "closest to breach" sort, pre-breach reminder + one escalation level.
- **Human Guarantee v1**: honestly-labeled auto-receipts carrying the human next-response-due promise in the customer's local time; named-agent signatures with optional photo on every reply.
- **KB v1**: block editor with Markdown shortcuts, 3-level categories + tags, audience toggle (public / logged-in / internal), revision history + rollback, draft→review→publish, public help center with fast search (tsvector + trigram typo tolerance), agent side-panel with keyword-matched suggest + insert.
- **Branding v1**: instance name, logo, favicon, colors, email sender identity — enough that each deployment carries its own brand from day one.
- Cmd+K palette and keyboard triage from day one (retrofitting is impossible).
- CSV/JSON export; basic webhooks + REST API.
- Deploy: single docker-compose; a public demo instance.

**MVP exit criteria**: the first of the maintainer's businesses runs its production support on it; setup-to-first-answered-ticket under 1 hour, measured.

## Phase 2 — The wedge: SOPs, portal, full SLA engine

*The things nobody else has, on top of a helpdesk that already works.*

- **SOP module**: internal reference articles with owner + verification expiry + stale flags; structured SOPs/runbooks with versioning and diff; runnable checklist instances with audit trail; macro-linked procedures; acknowledgment tracking (read + e-sign + who's-current dashboard); role-based auto-assignment.
- **Customer portal**: ticket list/detail with the visible human next-response-due promise, gated KB browsing, **customer-admin role** (manage company tickets, invite colleagues, control org visibility), CC'd colleagues see tickets.
- **SLA engine completion**: periodic-update metrics (incl. pausable), multi-level escalation chains for every metric, manual SLA extension with audit trail, per-customer-tier SLA defaults, SLA attainment reporting with breach drill-down.
- **Reporting v1**: volume, response/resolution times, SLA attainment, per-agent/team, CSAT surveys, KB content health (stale, zero-result queue, feedback scores).
- **White-label completion**: custom portal/help-center domains, full email template control, DKIM setup flow, login-page branding — rebrand entirely by configuration.
- Supervisor role; escalation runbooks triggered by ticket state (SLA breach / priority / tag).
- Live chat widget — answered by humans, presence honestly shown from business hours ("We're online" only when someone actually is).
- Zendesk + Freshdesk importers (tickets, contacts, KB, macros).

## Phase 3 — Channels & self-service depth

*More ways in, and a KB good enough that customers choose it — deflection without bots.*

- WhatsApp channel with guided ~10-minute onboarding; then Facebook/Instagram DMs.
- Search depth: synonym dictionaries, instant results-as-you-type in widget and portal, ticket-form article suggestions ("before you submit — does this answer it?") with "skip and talk to a human" always one click away.
- Content loops: convert-resolved-ticket-to-article-stub, zero-result "write this article" queue, contact-rate-after-view analytics.
- Reusable snippets/variables across KB articles; article templates by type.
- Reporting depth: deflection tracking, content-health dashboard, per-channel volumes and response medians (publish your measured human first-response median — it's marketing).

## Phase 4 — Scale & longevity

- Multi-brand help centers with shared-content sync; localization workflow (human translation, per-locale staleness flags, translation dashboard).
- SSO (SAML/OIDC) — free like everything else; custom roles beyond the base four.
- Slack notifications + Jira/GitHub bidirectional sync (the most-requested integrations in the OSS research).
- Operator tooling: GDPR-friendly data export/anonymization/retention policies, security hardening guide, responsible-disclosure policy, backup/restore tooling.
- App UI internationalization; community programs (good-first-issues, plugin/API depth as pull demands).
- **Longevity guarantees**: documented upgrade path for every release, deprecation cycles for config changes, LTS mindset — an instance installed in 2026 upgrades cleanly for a decade.

## Sequencing rationale

1. **Business hours/SLA and the local clock are Phase 1, not Phase 4** — for a human-only product the response promise *is* the product, so the engine that computes "a person will reply by 2:18 PM Sydney time" must exist before anything else is credible. It's also cheap to build early and brutal to retrofit (ask Zendesk's trigger-plumbing).
2. **Content before channels**: the KB and SOP corpus is what keeps a human-only queue fast; adding channels before deflection content exists just floods the humans. Phase 2 builds the content system, Phase 3 opens the floodgates.
3. **Portal with customer-admin in Phase 2**: the most-requested missing feature in both incumbents' communities, and it requires the company/visibility model from Phase 1 — natural stacking.
4. **White-label split across 1 and 2**: enough branding in the MVP that the maintainer's businesses can deploy under their own names immediately; the long tail (custom domains, DKIM flows) lands with the portal it decorates.
