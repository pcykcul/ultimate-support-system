# Ultimate Support System

A customer-support platform designed to beat Zendesk and Freshdesk by being **radically simpler**, with a first-class **Knowledge Base**, a built-in **SOP section** for internal teams, **multi-tier users** (end customers, internal team members, admins), and **business hours / SLA / timezone awareness** as core features rather than enterprise add-ons.

This repository currently contains the **market research and product definition** phase. No application code yet — the docs below define what gets built and why.

## The thesis (from the research)

> A support platform a small team can set up in an afternoon, that publishes one flat price with AI included, and that treats the knowledge base, internal SOPs, and multi-tier users as the core of the product instead of enterprise upsells.

Five review-verified openings make the incumbents beatable in 2026:

1. **Metered AI billing is universally resented** — Intercom $0.99/resolution, Zendesk ~$1.50–2.00/resolution, Freshdesk billing per session *even for failed sessions*. Flat, included AI is the strongest wedge.
2. **Complexity is the incumbents' identity** — "Zendesk Administrator" is a full-time job category; median implementation 4–12 weeks; ease-of-setup is Zendesk's lowest G2 sub-score.
3. **Basics are paywalled** — Zendesk's $19 plan has no knowledge base; multiple timezone schedules are Enterprise-only; Freshdesk gates KB versioning at $55 and approvals at $89; collaborator seats are excluded from entry tiers everywhere.
4. **Nobody combines customer KB + verified internal SOPs + ticketing with tiered visibility** — teams pay $250+/mo extra for Trainual/Guru next to their helpdesk.
5. **Timing** — Freshdesk's CX line grows only 4% and is starved of investment; Peppermint (leading simple OSS alternative) was archived July 2026; Libredesk still lacks a KB.

## Documentation

### Product definition — [`docs/product/`](docs/product/)

| Doc | Contents |
|---|---|
| [01 · Vision](docs/product/01-vision.md) | The thesis, why incumbents are beatable, product principles, what "beating Zendesk" means concretely |
| [02 · Feature Spec](docs/product/02-feature-spec.md) | Module-by-module spec: ticketing, knowledge base, SOPs, user tiers & permissions, business hours/SLA, AI, reporting |
| [03 · Architecture](docs/product/03-architecture.md) | Modular monolith, Postgres-for-everything (incl. pgvector search), single-container deploy, multi-tenancy |
| [04 · Roadmap](docs/product/04-roadmap.md) | Phase 0 validation → MVP → SOP/portal wedge → AI & channels → scale |

### Market research — [`docs/research/`](docs/research/)

| Doc | Contents |
|---|---|
| [01 · Zendesk](docs/research/01-zendesk.md) | Product suite, pricing, praise, churn drivers, what a "Zendesk killer" must fix |
| [02 · Freshdesk](docs/research/02-freshdesk.md) | Lineup, pricing, Freddy AI economics, exploitable gaps |
| [03 · Market landscape](docs/research/03-market-landscape.md) | Intercom, Help Scout, Zoho Desk, Front, HubSpot, Crisp; underserved segments |
| [04 · Open source](docs/research/04-open-source.md) | Chatwoot, Zammad, FreeScout, osTicket, Frappe, Libredesk; what the OSS market teaches |
| [05 · Knowledge base](docs/research/05-knowledge-base.md) | KB market, complaint themes, best practices, spec-level ideal |
| [06 · SOP systems](docs/research/06-sop-systems.md) | Trainual/Process Street/Scribe et al.; what an integrated SOP section should be |
| [07 · Users, roles & permissions](docs/research/07-users-roles-permissions.md) | Incumbent role taxonomies, collaborator-seat pricing pain, the simple-but-sufficient model |
| [08 · Business hours & SLA](docs/research/08-business-hours-sla.md) | Zendesk/Freshdesk schedule & SLA engines, MSP-tool lessons, timezone/DST design details |
| [09 · Trends & AI](docs/research/09-trends-ai.md) | What AI actually delivers vs hype, pricing backlash, omnichannel expectations, "simple" UX patterns |
| [10 · Open questions](docs/research/10-open-questions.md) | Unvalidated assumptions, conflicting claims, the five most decision-relevant insights |

## Headline product commitments

- **Setup in under 1 hour** — opinionated defaults, guided onboarding, working SLA + KB structure out of the box.
- **One published flat price** — no add-on lattice, no AI meter, free unlimited collaborator seats, end users always free.
- **KB with versioning, review workflow, and audience control on every plan** — public / customer-gated / internal from one editor.
- **Built-in SOPs** — verified internal articles, runnable checklists with audit trails, acknowledgment tracking, macro-linked procedures.
- **Multi-tier users** — Admin / Supervisor / Agent / free Collaborator internally; Companies with a customer-admin portal role externally.
- **Time-zone native** — regional business-hours schedules with holiday packs on every plan; per-account SLAs ("Australian clients: first response ≤ 15 min during Sydney hours"); the customer's local clock on every ticket with an outside-hours compose warning.
- **Honest, included AI** — RAG answers cited from the KB, 40–50% realistic deflection framing, hard visible caps, never a surprise bill.

## Status

- [x] Market & competitive research
- [x] Product vision, feature spec, architecture recommendation, roadmap
- [ ] Phase 0: customer validation + AI unit economics + technical foundation
- [ ] Phase 1: MVP build

*Research compiled August 2026. Pricing and feature-gating facts reflect that date; verify before external use (see [open questions](docs/research/10-open-questions.md)).*
