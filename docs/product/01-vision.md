# Product Vision — The Ideal Support System

*Synthesized from the market research in [`docs/research/`](../research/). Last updated: August 2026.*

## The one-line thesis

**A free, open-source support platform a small team can self-host in an afternoon, where every ticket is answered by a real human — no AI, no chatbots, ever — backed by the tooling that makes human answers fast: a first-class knowledge base, internal SOPs, and timezone-aware SLAs. Everything in the public repo, nothing gated — no open-core, no enterprise edition, ever.**

In a world where every competitor is racing to put AI between the customer and a person, **"a human will get back to you" is the standout.** This is not a product for sale — it is a public, evergreen open-source project that aims to be one of the best support systems in existence. Every other element of that sentence maps to a documented, review-verified weakness of Zendesk, Freshdesk, and the rest of the field.

## Why "100% human" is the position to take

The research didn't start from this premise — it arrived here:

1. **Customers are telling the industry to stop.** 64% of customers wish companies would stop using AI in support; 68% prefer a live human over digital self-service. Only 14% of AI self-service interactions actually resolve. Independent tests measure 38–50% real AI deflection against vendors' 65–80% marketing ([`09-trends-ai.md`](../research/09-trends-ai.md)).
2. **The correction is already underway.** Klarna — the poster child for replacing 700 agents with AI — reversed course and rehired humans ("The result was lower quality, and that's not sustainable"). Gartner predicts >40% of agentic AI projects will be canceled by end of 2027.
3. **AI billing is the most resented practice in the industry.** Intercom charges $0.99 per "resolution" (including ones a human had to fix), Zendesk ~$1.50–$2.00 on top of seats, Freshdesk bills per session whether or not it resolves. Documented bills jumped $200→$1,400/month and $4k→$9k/month. We don't win this fight by doing AI cheaper — we win it by having no AI, no meter, and no bill at all.
4. **The position is empty and hard to copy.** Every incumbent has staked its valuation on AI revenue ($200M AI ARR at Zendesk). None of them can credibly market "always a human" without destroying their own story. A new entrant can own it outright.
5. **Reaching a human is already the industry's sorest wound.** Zendesk scores 1.8/5 on Trustpilot largely because its own customers can't get a person. The product that guarantees a person — visibly, with a deadline — attacks the deepest complaint there is.

## The honest trade-off

We concede the teams that want a deflection bot. That's a real segment, and it's the one every incumbent is fighting over. Our segment is the mirror image: teams whose support *is their brand* — premium e-commerce, agencies, B2B services, anyone whose customers are worth a human's time. For this to work, the product must make human answers *fast enough to feel magical*. That is the entire design brief: everything in the feature spec exists to shorten the distance between "ticket submitted" and "great human answer sent."

## Why the incumbents are beatable now

Beyond the AI opening ([`01-zendesk.md`](../research/01-zendesk.md), [`02-freshdesk.md`](../research/02-freshdesk.md), [`03-market-landscape.md`](../research/03-market-landscape.md)):

1. **Complexity has become the incumbents' identity.** "Zendesk Administrator" is a full-time job category at $45–71/hr. Ease-of-setup is Zendesk's lowest G2 sub-score; median implementation runs 4–12 weeks. Freshdesk — whose whole brand was "the simple one" — now sells 2 SKU lines, 3 AI SKUs, session packs, day passes, and connector task packs.
2. **The basics are paywalled everywhere.** Zendesk's $19 plan has *no knowledge base at all*. Multiple timezone schedules: Enterprise-only ($169+/agent/mo). Freshdesk gates article versioning at $55 and approval workflows at $89. Collaborator seats are excluded from every vendor's entry tiers.
3. **Nobody — SaaS or open source — combines customer KB + verified internal SOPs + ticketing with tiered visibility.** Support teams pay $250+/mo extra for Trainual or Guru next to their helpdesk. Genuine white space (with the caveat in [`10-open-questions.md`](../research/10-open-questions.md) that demand for the combined product is not yet validated).
4. **Timing.** Freshdesk's CX line is growing only 4% and being starved of investment. Peppermint (the leading "simple open-source Zendesk alternative") was archived in July 2026. The fastest-moving open-source challenger, Libredesk, still has no knowledge base.

## Product principles

These are decision rules, not slogans. When a choice arises, these win:

### 1. No AI. Every reply is a person.
The hard rule that everything else serves. No chatbots in the widget. No auto-generated answers. No "AI drafts, human approves." Auto-receipts exist but are visibly receipts ("We got your ticket — Sarah will reply by 2:18 PM your time"), never fake conversation. Every reply is signed by a named human, with a face. Customer data never trains a model. This is also a simplicity and privacy dividend: no inference costs, no meter, no prompt plumbing, nothing to hallucinate.

### 2. Human speed is the product
If humans answer everything, the product's job is making that fast. The customer-visible promise — "a real person will respond by *{time}*, in your timezone" — is powered by the business-hours/SLA engine and staffing visibility. Internally: keyboard-first triage, macros, SOP runbooks in the ticket sidebar, collision detection, "closest to breach" queues. Deflection still exists — through a knowledge base so good customers *choose* it — but nobody is ever blocked from a human.

### 3. Simple by subtraction, not by hiding
Opinionated defaults over infinite configuration (the Linear playbook — constraint is the feature). A new workspace works out of the box: sensible statuses, one working SLA policy, a default business-hours schedule, a starter KB structure. Target: **first ticket answered and first KB article published within one hour of signup** — against the incumbents' 2–12 weeks.

### 4. Free means free — no open-core, ever
This is a free, open-source project with a public repo. There is no paid tier, so there is nothing to gate: versioning, reporting, SLA policies, business hours, SSO, custom roles, collaborator seats — everything ships to everyone. This is a hard pledge, not a pricing choice: the open-source research shows open-core gating (Chatwoot paywalling SLAs, roles, and SSO *even when self-hosted*) is the single biggest resentment in the OSS helpdesk world, and "no open-core, ever" is already a winning pitch (Libredesk). We adopt it structurally — there is no company to be tempted.

### 5. The knowledge base is the heart
Self-service without chatbots: a searchable, well-maintained KB deflects the tickets customers *want* to self-solve (92% would use one), which is what keeps human-only economics viable. Authoring feels like a modern doc editor; resolved tickets convert to article stubs; failed searches feed a "write this" queue. Verified-content workflow keeps it trustworthy — for readers, not for a model.

### 6. Three audiences, one system
End customers, internal team members, and admins are first-class tiers across *everything* — tickets, KB, SOPs. One editor publishes to public help center, logged-in customer portal, or internal-only SOP space with an audience toggle. No second product, no second instance, no second bill.

### 7. Time is a first-class citizen
Business hours, timezones, and SLAs are core plumbing, not an enterprise unlock. A team deploying support for Australia defines a Sydney schedule with a holiday calendar, attaches a "first response ≤ 15 min during Sydney business hours" SLA to Australian clients, and every agent sees the customer's local clock on every ticket — a feature no major helpdesk ships natively today. For a human-only product this engine isn't a feature, it's the credibility of the promise.

### 8. Evergreen by engineering
"One of the best out there" is a durability claim, not a launch claim. That means: boring, long-lived dependencies; a single-container deploy that stays under 1 GB RAM (the bar FreeScout/Libredesk set and Zammad fails); one-command upgrades that never eat data; documentation treated as a feature; tests that make releases safe; and governance/contribution structure that outlives any single maintainer — the Peppermint archive and the Papercups shutdown are the cautionary tales the OSS research kept surfacing. No silent feature removals, no rug-pulls, development in the open.

### 9. White-label by design
This platform will run under multiple brands (the maintainer's own businesses first). Rebranding is instance configuration — name, logo, theme, domains, email identity — never a fork, so every rebranded deployment stays on the upgrade path. The customer-facing surface shows the operator's brand, not the platform's.

## Who it's for

First users: **the maintainer's own startups and businesses**, each running a rebranded instance — the product is validated by operating real support on it before anyone else adopts it. Beyond that: **small and mid-size teams (2–50 agents) whose support is part of their brand** — premium e-commerce, agencies/MSPs, B2B services — priced out of or alienated by AI-first incumbents, plus the self-hosting community that currently has no option combining a modern UI, first-class KB, SOPs, and a customer portal without open-core paywalls (see [`04-open-source.md`](../research/04-open-source.md)). Demand assumptions worth validating in the open (via issues/discussions) are listed in [`10-open-questions.md`](../research/10-open-questions.md).

## What "beating Zendesk" means concretely

| Dimension | Incumbent reality | Our target |
|---|---|---|
| AI | AI-first, metered per resolution/session | **None. Every reply from a named human, guaranteed** |
| Setup time | 2–12 weeks, dedicated admin | < 1 hour from `docker compose up` to productive |
| Price | $55–$215+/agent/mo with add-ons + AI meters | **Free. Open source. No meters, no seats, no tiers** |
| Open-core gating | Chatwoot paywalls SLA/roles/SSO even self-hosted | Nothing gated, ever — the whole product is the repo |
| Knowledge base | Gated by plan; versioning/approval up-tier | Full KB with versioning + review, included |
| Internal SOPs | Separate product ($250+/mo) or AI-only luxury | Built in, with verification + acknowledgment |
| Collaborator seats | Excluded at entry tiers; per-seat billing pain | No seat pricing exists — every teammate gets the right role |
| Customer org admin | Doesn't exist (most-requested feature) | First-class portal role |
| Business hours / SLA | Multiple schedules = Enterprise-only | Core feature; per-account SLAs; local clocks; customer-visible response promises |
| Reporting | Paywalled dashboards | Included |
| White-label | "Powered by" branding; portal customization up-tier | Full rebrand by configuration, per instance |
