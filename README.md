# Ultimate Support System

**A free, open-source, human-first support platform.** Submit a ticket — a real person gets back to you. No AI, no chatbots, ever. In a world where every support tool races to put a model between you and a human, this one guarantees the opposite: **the most human touch possible.**

Built to beat Zendesk and Freshdesk at what actually matters: radical simplicity, a first-class **Knowledge Base**, a built-in **SOP section** for internal teams, **multi-tier users** (end customers, internal team members, admins), and **business hours / SLA / timezone awareness** as core features. Self-hosted, fully **white-label** (run it under your own brand), and **evergreen** — everything in this public repo, nothing gated, no open-core, no enterprise edition.

> **Status:** research & product-definition phase. No application code yet — the docs below define what gets built and why.

## The two pledges

1. **No AI, ever.** Every reply is written and signed by a named human. Auto-receipts are honestly labeled receipts, never fake conversation. Customer data never touches a model.
2. **No open-core, ever.** There is nothing for sale, so there is nothing to gate. SLAs, SSO, roles, versioning, reporting — everything ships to everyone, forever.

## Why this wins (from the research)

The market research in [`docs/research/`](docs/research/) arrived at this position from the evidence:

- **Customers want humans**: Gartner — 64% prefer companies *not* use AI for service, and **53% would switch to a competitor over it**; SurveyMonkey (Dec 2025) — 79% prefer a human; 30% abandon a brand after one bad chatbot experience. Human-first works commercially: T-Mobile's "No Bots" Team of Experts cut churn 39% at its lowest-ever cost-to-serve.
- **AI support is a liability the incumbents can't drop**: Klarna publicly reversed its AI-replaces-700-agents strategy; Air Canada was held liable for its chatbot's invented policy; Cursor's bot hallucinated a policy and cost real subscriptions. Every incumbent has staked its valuation on AI revenue — none can credibly market "always a human." This position is empty, and we take it.
- **The incumbents' pricing and complexity are the top churn drivers**: metered AI billing (Intercom $0.99/resolution, Zendesk ~$1.50–2.00, Freshdesk per-session even for failures), "Zendesk Administrator" as a full-time job, 4–12 week implementations, and basics paywalled (Zendesk's $19 plan has no KB; multiple timezone schedules are Enterprise-only).
- **The open-source field has a hole exactly this shape**: Chatwoot paywalls SLA/roles/SSO even self-hosted; Zammad needs an Elasticsearch-heavy stack; FreeScout sells the KB as a module; Libredesk has no KB yet; Peppermint was archived July 2026. Nothing combines a modern UI + first-class KB + SOPs + customer portal + real SLA engine, ungated.
- **Deflection doesn't need a bot**: a well-maintained KB deflects 20–35% of tickets on its own — which is exactly what keeps a human-only queue fast.

## Documentation

### Product definition — [`docs/product/`](docs/product/)

| Doc | Contents |
|---|---|
| [01 · Vision](docs/product/01-vision.md) | The thesis, why "100% human" + open source wins, product principles, what beating Zendesk means |
| [02 · Feature Spec](docs/product/02-feature-spec.md) | Module-by-module: ticketing, knowledge base, SOPs, user tiers & permissions, business hours/SLA, the Human Guarantee, white-label |
| [03 · Architecture](docs/product/03-architecture.md) | Modular monolith, Postgres-for-everything, single-container deploy, license & sustainability, no-AI-by-architecture |
| [04 · Roadmap](docs/product/04-roadmap.md) | Phase 0 foundation → MVP → SOP/portal wedge → channels → longevity |

### Market research — [`docs/research/`](docs/research/)

| Doc | Contents |
|---|---|
| [01 · Zendesk](docs/research/01-zendesk.md) | Product suite, pricing, praise, churn drivers |
| [02 · Freshdesk](docs/research/02-freshdesk.md) | Lineup, pricing, Freddy AI economics, exploitable gaps |
| [03 · Market landscape](docs/research/03-market-landscape.md) | Intercom, Help Scout, Zoho Desk, Front, HubSpot, Crisp; underserved segments |
| [04 · Open source](docs/research/04-open-source.md) | Chatwoot, Zammad, FreeScout, osTicket, Frappe, Libredesk; what the OSS market teaches |
| [05 · Knowledge base](docs/research/05-knowledge-base.md) | KB market, complaint themes, best practices, spec-level ideal |
| [06 · SOP systems](docs/research/06-sop-systems.md) | Trainual/Process Street/Scribe et al.; what an integrated SOP section should be |
| [07 · Users, roles & permissions](docs/research/07-users-roles-permissions.md) | Incumbent role taxonomies, seat-pricing pain, the simple-but-sufficient model |
| [08 · Business hours & SLA](docs/research/08-business-hours-sla.md) | Zendesk/Freshdesk schedule & SLA engines, MSP-tool lessons, timezone/DST design |
| [09 · Trends & AI](docs/research/09-trends-ai.md) | What AI actually delivers vs hype, pricing backlash, "simple" UX patterns |
| [10 · Open questions](docs/research/10-open-questions.md) | Unvalidated assumptions, conflicting claims, decision-relevant insights |
| [11 · Human-first positioning](docs/research/11-human-first-support.md) | Sentiment data, companies that win on human support, AI-support failure cases, execution playbook |

## Headline commitments

- **The Human Guarantee** — every ticket answered by a named person with a visible, timezone-aware deadline: *"Submitted 2:03 PM — a real person will respond by 2:18 PM Sydney time."*
- **Setup in under 1 hour** — `docker compose up`, opinionated defaults, a working SLA + KB structure out of the box.
- **Free means free** — no seats, no tiers, no meters, no open-core. The repo is the product.
- **KB with versioning, review workflow, and audience control** — public / customer-gated / internal from one editor; classic search done properly (typo-tolerant, synonym-aware — no embeddings).
- **Built-in SOPs** — verified internal articles, runnable checklists with audit trails, acknowledgment tracking, macro-linked procedures.
- **Multi-tier users** — Admin / Supervisor / Agent / unlimited Collaborators internally; Companies with a customer-admin portal role externally.
- **Time-zone native** — regional business-hours schedules with holiday packs; per-account SLAs ("Australian clients: first response ≤ 15 min during Sydney hours"); the customer's local clock on every ticket with an outside-hours compose warning.
- **White-label by configuration** — deploy it under any brand (name, logo, theme, domains, email identity) without forking; rebrands survive every upgrade.
- **Evergreen** — boring dependencies, one-command upgrades, documented migrations; an instance installed today should upgrade cleanly for a decade.

## Status

- [x] Market & competitive research (11 reports)
- [x] Product vision, feature spec, architecture recommendation, roadmap
- [ ] Phase 0: license & governance, contribution scaffolding, technical foundation
- [ ] Phase 1: MVP build

*Research compiled August 2026. Pricing and feature-gating facts reflect that date; see [open questions](docs/research/10-open-questions.md) for caveats.*
