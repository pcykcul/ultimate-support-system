# Architecture Recommendation

*How to build it so the product promises in [`01-vision.md`](01-vision.md) hold. The open-source survey ([`04-open-source.md`](../research/04-open-source.md)) is the strongest input here: it shows exactly which architectural choices made existing tools loved or abandoned.*

## Lessons the market already paid for

| Lesson | Evidence |
|---|---|
| **Deployability wins mindshare** | FreeScout (runs on a $4 VPS in <512 MB) and Libredesk (Go single binary) win praise purely on ease of deploy; Zammad loses evaluations because it demands Postgres + Redis + Elasticsearch and 4–8 GB RAM |
| **Open-core resentment is real** | Chatwoot paywalls SLA, custom roles, and SSO *even when self-hosted* — cited on HN as the canonical bad example; Libredesk's "no open-core, ever" pledge is its marketing |
| **Single-maintainer projects die** | Peppermint archived July 2026; Papercups shut down; "sustainability anxiety" is now a standard HN objection |
| **A dated UI caps adoption** | osTicket and Zammad have the features but "look ten years old" — UI quality is a real moat |
| **Search infra is a tax** | Elasticsearch as a hard dependency is repeatedly cited as the reason teams skip Zammad |

## Recommended shape: modular monolith, boring stack

One deployable application with clear internal module boundaries (ticketing, KB, SOP, identity, SLA engine) — not microservices. A support platform's modules are tightly coupled by data (tickets reference articles, SOPs, schedules, companies); a monolith keeps every promise in the feature spec one JOIN away, and keeps self-hosted deployment to **one container + one database**. For an open-source project this is also the sustainability choice: one codebase contributors can hold in their head.

### Core stack

- **Backend: TypeScript (Node/NestJS or equivalent) or Go.** Either supports the single-binary/single-container goal. TypeScript maximizes hiring pool and shares types end-to-end with the frontend; Go gives the smallest ops footprint (Libredesk proves the model). Decide by team skills — both are defensible; what matters is *one* language for the backend, not a polyglot spread.
- **Database: PostgreSQL for everything.**
  - Relational core (tickets, users, companies, articles, SOPs, schedules, SLA policies).
  - **Search via `tsvector` (full-text) + `pg_trgm` (typo tolerance) + synonym dictionaries** — the load-bearing choice that avoids the Elasticsearch tax entirely. No embeddings, no vector store, no model dependency: the spec's search promises (typo-tolerant, synonym-aware, instant) are classic information-retrieval engineering, all native to Postgres.
  - Revision history (KB versioning, SOP versions, audit trails) as append-only tables.
- **Cache/queue: Redis** (job queue for email ingest, SLA timer evaluation, webhooks) — acceptable second dependency; skip it only if Go's in-process scheduling proves sufficient.
- **Frontend: React + TypeScript SPA** (Vite), with the command palette, keyboard triage, and real-time updates (WebSocket/SSE) as first-class concerns from the start — retrofitting keyboard-first UX later never works.
- **Email**: inbound via provider webhooks (Postmark/SES) with a self-hosted SMTP/IMAP fallback; outbound with per-workspace DKIM. Email threading correctness (References/In-Reply-To) is a known incumbent sore spot — treat it as a tested module, not glue code.
- **File storage**: local disk by default, S3-compatible (MinIO) optional — a small self-hosted install should need nothing but the container and Postgres.
- **No AI layer.** This is architectural, not just positional: no model gateway, no vector pipeline, no inference budget, no external API dependency, nothing that can hallucinate in front of a customer. It removes an entire class of cost, complexity, and privacy surface — and it is the product's headline promise made structural.

### Tenancy & branding

**Single-tenant per install**: one instance = one business, fully white-labeled. Branding (product name, logo, favicon, theme colors, email templates and sender domain, portal domains) is **instance configuration stored as data — never a fork** — so every rebranded deployment stays on the stock upgrade path. Within an instance, **multi-brand** (multiple help centers/portals sharing one agent workspace) covers businesses with several products. Running five businesses means five independent installs, each under its own brand — isolation by default, no tenancy code to get wrong, no cross-business data risk.

### The SLA/business-hours engine (deserves first-class design)

- All timestamps stored UTC; schedules store IANA zone identifiers; business-hours math uses the tz database so DST shifts are automatic. Historical events render in the offset in effect at event time.
- SLA targets computed as **concrete breach deadlines** (`first_response_due_at`) recalculated on relevant events (status change, schedule/holiday edit, priority change) — so queue sorting "closest to breach" is a plain indexed ORDER BY, list views stay fast, and reminders/escalations are simple due-time jobs rather than continuous timer evaluation.
- Timer state machine per metric with explicit, documented pause semantics tied to ticket status.
- Holiday calendars as shared objects (country packs importable) referenced by schedules.

### Identity & permissions

- Sessions + OAuth; SSO (SAML/OIDC) ships free like everything else (Chatwoot's paywalled-SSO resentment is the canonical warning).
- Authorization as a central policy module implementing the two-axis model (role × scope) and the audience model (public / customers / company-scoped / internal) shared by KB and SOP content. One implementation, used everywhere — permission drift across modules is how incumbents ended up with segment/role/scope sprawl.

### What we deliberately do NOT build

- **No AI — ever.** No chatbots, no generated replies, no embeddings. The Human Guarantee (feature spec, Module 6) is enforced by architecture: the capability simply does not exist in the codebase.
- **No Elasticsearch** — tsvector + pg_trgm until proven insufficient at scale.
- **No microservices, no Kafka** — a queue table + Redis covers webhook fan-out and email ingest for years.
- **No plugin marketplace at launch** — REST API + webhooks + a handful of first-party integrations (Slack, Jira/GitHub sync — the most-requested integration in the OSS research).
- **No open-core, no license gates, no enterprise edition** — every feature in the public repo, forever. Crippling self-hosted basics is the documented path to community backlash (Chatwoot), and "no open-core, ever" is a proven differentiator (Libredesk).

## License & sustainability (the "evergreen" engineering)

- **License: AGPL-3.0 recommended** — the license of Zammad, FreeScout, and Libredesk. It keeps the project genuinely open while preventing a third party from closing it up as a proprietary hosted service. (MIT maximizes adoption but invites exactly that; the OSS survey shows AGPL is the community norm for this category.)
- **Outlive any single maintainer**: the Peppermint archive and Papercups shutdown are the category's cautionary tales. Counters: boring long-lived dependencies, high test coverage on the money paths (email threading, SLA math, permissions), architecture docs in-repo, CONTRIBUTING with a real on-ramp, and conventional code over cleverness — a contributor should be productive in an evening.
- **Upgrades as a feature**: versioned migrations, one-command upgrade, release notes for every release, no breaking config changes without a deprecation cycle. An instance set up in 2026 should upgrade cleanly for a decade — that is what "evergreen" means operationally.
- **No telemetry by default**; opt-in only and transparent.

## Deployment story

- **Self-hosted**: `docker compose up` → app + Postgres (+ Redis). Target < 1 GB RAM at small scale — matching the bar FreeScout/Libredesk set and Zammad fails.
- One image, many brands: each business runs its own fully-rebranded instance of the same image.
- Nightly-tested one-command upgrades and importers (Zendesk/Freshdesk) as first-class release artifacts.
