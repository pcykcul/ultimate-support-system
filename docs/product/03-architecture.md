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

One deployable application with clear internal module boundaries (ticketing, KB, SOP, identity, SLA engine, AI) — not microservices. A support platform's modules are tightly coupled by data (tickets reference articles, SOPs, schedules, companies); a monolith keeps every promise in the feature spec one JOIN away, and keeps self-hosted deployment to **one container + one database**.

### Core stack

- **Backend: TypeScript (Node/NestJS or equivalent) or Go.** Either supports the single-binary/single-container goal. TypeScript maximizes hiring pool and shares types end-to-end with the frontend; Go gives the smallest ops footprint (Libredesk proves the model). Decide by team skills — both are defensible; what matters is *one* language for the backend, not a polyglot spread.
- **Database: PostgreSQL for everything.**
  - Relational core (tickets, users, companies, articles, SOPs, schedules, SLA policies).
  - **Full-text search via `tsvector` + hybrid semantic search via `pgvector`** — this is the load-bearing choice that avoids the Elasticsearch tax while still delivering the hybrid keyword+semantic search the KB spec requires. Embeddings for articles and tickets live in the same database as the data they index.
  - Revision history (KB versioning, SOP versions, audit trails) as append-only tables.
- **Cache/queue: Redis** (job queue for email ingest, SLA timer evaluation, webhooks, AI calls) — acceptable second dependency; skip it only if Go's in-process scheduling proves sufficient.
- **Frontend: React + TypeScript SPA** (Vite), with the command palette, keyboard triage, and real-time updates (WebSocket/SSE) as first-class concerns from the start — retrofitting keyboard-first UX later never works.
- **Email**: inbound via provider webhooks (Postmark/SES) with a self-hosted SMTP/IMAP fallback; outbound with per-workspace DKIM. Email threading correctness (References/In-Reply-To) is a known incumbent sore spot — treat it as a tested module, not glue code.
- **File storage**: S3-compatible (MinIO when self-hosted).
- **AI layer**: provider-agnostic gateway (Claude/OpenAI/local models) so self-hosters can bring their own keys. RAG pipeline: article/ticket chunking → pgvector → retrieval with citation tracking. Per-workspace token accounting from day one — this is what makes "AI included, hard caps, no surprise bills" operable, and it feeds the unit-economics model the open-questions doc demands.

### Multi-tenancy

Single shared schema keyed by `workspace_id` with Postgres **row-level security** as a second enforcement layer. This serves SaaS cheaply and lets a self-hosted instance be one tenant of the same codebase — one codebase, both business models, deferring the SaaS-vs-self-hosted decision the research left open without forking the architecture.

### The SLA/business-hours engine (deserves first-class design)

- All timestamps stored UTC; schedules store IANA zone identifiers; business-hours math uses the tz database so DST shifts are automatic. Historical events render in the offset in effect at event time.
- SLA targets computed as **concrete breach deadlines** (`first_response_due_at`) recalculated on relevant events (status change, schedule/holiday edit, priority change) — so queue sorting "closest to breach" is a plain indexed ORDER BY, list views stay fast, and reminders/escalations are simple due-time jobs rather than continuous timer evaluation.
- Timer state machine per metric with explicit, documented pause semantics tied to ticket status.
- Holiday calendars as shared objects (country packs importable) referenced by schedules.

### Identity & permissions

- Sessions + OAuth; SSO (SAML/OIDC) **not paywalled** when it ships (Chatwoot's paywalled-SSO resentment is a warning).
- Authorization as a central policy module implementing the two-axis model (role × scope) and the audience model (public / customers / company-scoped / internal) shared by KB and SOP content. One implementation, used everywhere — permission drift across modules is how incumbents ended up with segment/role/scope sprawl.

### What we deliberately do NOT build

- **No Elasticsearch** — pgvector + tsvector until proven insufficient at scale.
- **No microservices, no Kafka** — a queue table + Redis covers webhook fan-out and email ingest for years.
- **No plugin marketplace at launch** — REST API + webhooks + a handful of first-party integrations (Slack, Jira/GitHub sync — the most-requested integration in the OSS research).
- **No per-feature license gates in the self-hosted build** — whatever the business model becomes, crippling self-hosted basics is the documented path to community backlash.

## Deployment story

- **Self-hosted**: `docker compose up` → app + Postgres (+ Redis). Target < 1 GB RAM at small scale — matching the bar FreeScout/Libredesk set and Zammad fails.
- **Cloud/SaaS**: the same image behind a load balancer; workspace = tenant.
- Nightly-tested one-command upgrades and importers (Zendesk/Freshdesk) as first-class release artifacts.
