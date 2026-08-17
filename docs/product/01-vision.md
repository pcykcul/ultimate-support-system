# Product Vision — The Ideal Support System

*Synthesized from the market research in [`docs/research/`](../research/). Last updated: August 2026.*

## The one-line thesis

**A support platform a small team can set up in an afternoon, that publishes one flat price with AI included, and that treats the knowledge base, internal SOPs, and multi-tier users as the core of the product instead of enterprise upsells.**

Every element of that sentence maps to a documented, review-verified weakness of Zendesk, Freshdesk, and the rest of the field.

## Why the incumbents are beatable now

The research (see [`01-zendesk.md`](../research/01-zendesk.md), [`02-freshdesk.md`](../research/02-freshdesk.md), [`03-market-landscape.md`](../research/03-market-landscape.md)) converges on five structural openings:

1. **Metered AI billing is the most resented practice in the industry.** Intercom charges $0.99 per "resolution" (including cases where a human had to fix the AI's wrong answer), Zendesk ~$1.50–$2.00 per resolution on top of seats, Freshdesk bills per session *whether or not the session resolves anything*. Documented customer bills have jumped from $200 to $1,400/month, and from $4k to $9k/month, purely from AI metering. **Flat, included AI is the single strongest positioning wedge available.**

2. **Complexity has become the incumbents' identity.** "Zendesk Administrator" is a full-time job category at $45–71/hr. Ease-of-setup is Zendesk's lowest G2 sub-score; median implementation runs 4–12 weeks. Freshdesk — whose whole brand was "the simple one" — now sells 2 SKU lines, 3 Freddy AI SKUs, session packs, day passes, and connector task packs.

3. **The basics are paywalled everywhere.** Zendesk's $19 plan has *no knowledge base at all*. Multiple timezone schedules: Enterprise-only ($169+/agent/mo). Freshdesk gates article versioning at $55 and approval workflows at $89. Zendesk Suite Team can't even mark an article agents-only. Collaborator seats are excluded from every vendor's entry tiers.

4. **Nobody — SaaS or open source — combines customer KB + verified internal SOPs + ticketing with tiered visibility.** Support teams pay $250+/mo extra for Trainual or Guru next to their helpdesk. Zendesk's answer (Copilot "procedures") requires a $115+ plan plus a $50/agent add-on. This is genuine white space (with the caveat in [`10-open-questions.md`](../research/10-open-questions.md) that demand for the combined product is not yet validated).

5. **Timing.** Freshdesk's CX line is growing only 4% and being starved of investment in favor of ITSM. Peppermint (the leading "simple open-source Zendesk alternative") was archived in July 2026. The fastest-moving open-source challenger, Libredesk, still has no knowledge base. Named market slots are open.

## Product principles

These are decision rules, not slogans. When a choice arises, these win:

### 1. Simple by subtraction, not by hiding
Opinionated defaults over infinite configuration (the Linear playbook — constraint is the feature). A new workspace works out of the box: sensible statuses, one working SLA policy, a default business-hours schedule, a starter KB structure. Every advanced surface is progressive disclosure, never a prerequisite. Target: **first ticket answered and first KB article published within one hour of signup** — against the incumbents' 2–12 weeks.

### 2. One price, everything included
Published flat pricing. No add-on lattice, no quote-only tiers, no per-resolution meter, no charging for read-only teammates. Features that are "basics" — versioning, reporting, SLA policies, business hours, agent-only content, collaborator seats — exist on every plan. If usage-based AI cost is ever unavoidable at the margin, generous included volume with a hard, user-visible cap — never a surprise bill. (AI inference unit economics still need modeling — flagged in open questions.)

### 3. The knowledge base is the heart, and it is also the AI's brain
AI answer quality is capped by KB quality (independent tests measure 38–50% real AI deflection, not the 65–80% vendors market). So the KB isn't a bolt-on: it's the day-one workflow. Authoring must feel like a modern doc editor; resolved tickets become article drafts; failed searches become a "write this" queue. This simultaneously solves the AI cold-start problem and makes our AI claims honest.

### 4. Three audiences, one system
End customers, internal team members, and admins are first-class tiers across *everything* — tickets, KB, SOPs. One editor publishes to public help center, logged-in customer portal, or internal-only SOP space with an audience toggle. No second product, no second instance, no second bill (Zendesk charges for a separate Employee Service instance for exactly this).

### 5. Time is a first-class citizen
Business hours, timezones, and SLAs are core plumbing, not an enterprise unlock. A team deploying support for Australia defines a Sydney schedule with a holiday calendar, attaches a "first response ≤ 15 min during Sydney business hours" SLA to Australian clients, and every agent sees the customer's local clock on every ticket — a feature no major helpdesk ships natively today.

### 6. Honest AI
Position AI at what it measurably does: deflect 40–50% of FAQ-class volume with clean human handoff, draft replies, summarize, triage. Never "replace your team" — the Klarna reversal and Gartner's cancellation forecast made overpromising a liability. Every AI answer cites its source articles.

### 7. Earn trust operationally
Fast human support from us (Zendesk scores 1.8/5 on Trustpilot for its own support), a public changelog (Freshdesk removes features silently), and no pricing rug-pulls (Help Scout's 2024 pricing flip-flop permanently damaged its trust). These are cheap, credible differentiators.

## Who it's for (working hypothesis)

Primary: **SMB and mid-market support teams (2–50 agents)** currently on Freshdesk/Zendesk entry tiers or outgrowing shared inboxes — the segment paying the "overkill tax" today. Secondary: agencies/MSPs serving multiple clients (multi-brand + per-account SLA needs, badly served at low tiers). The precise ICP, willingness-to-pay, and SaaS-vs-self-hosted business model are **open questions** that need customer validation before major build investment — see [`10-open-questions.md`](../research/10-open-questions.md).

## What "beating Zendesk" means concretely

| Dimension | Incumbent reality | Our target |
|---|---|---|
| Setup time | 2–12 weeks, dedicated admin | < 1 hour to productive |
| Pricing | $55–$215+/agent/mo with add-ons + AI meters | One published flat price, AI included |
| Knowledge base | Gated by plan; versioning/approval up-tier | Full KB with versioning + review on every plan |
| Internal SOPs | Separate product ($250+/mo) or AI-only luxury | Built in, with verification + acknowledgment |
| Collaborator seats | Excluded at entry tiers | Free and unlimited, every plan |
| Customer org admin | Doesn't exist (most-requested feature) | First-class portal role |
| Business hours / SLA | Multiple schedules = Enterprise-only | Core feature; per-account SLAs; local clocks |
| Reporting | Paywalled dashboards | Included |
| Their own support | 1.8/5 Trustpilot (Zendesk) | Fast human support as a feature |
