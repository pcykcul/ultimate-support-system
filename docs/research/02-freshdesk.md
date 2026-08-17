# Freshdesk / Freshworks Deep-Dive (August 2026)

## 1. Company snapshot

- Freshworks Q2 FY2026 (reported Aug 2026): revenue **$237.4M, +16% YoY**; non-GAAP operating margin 23.6%; 1,746 customers >$100K ARR ([Futurum](https://futurumgroup.com/insights/freshworks-q2-fy-2026-freddy-ai-and-ex-drive-commercial-momentum/), [TradingView](https://www.tradingview.com/news/tradingview:88b1ce05f24e7:0-freshworks-inc-q2-2026-revenue-237-38m-net-income-3-24m-eps-0-01-10-q-summary/)).
- **Strategically critical split:** Employee Experience (Freshservice/ITSM) ARR is $567M growing **24%** cc; Customer Experience (Freshdesk) ARR is $400M growing only **4%** cc. Freshworks' investment and roadmap energy (ITAM via Device42, Service Health Monitoring, XLAs) is flowing to Freshservice. **Freshdesk is effectively a slow-growth cash cow** — an opening for an attacker in SMB customer support.
- Wells Fargo attributes ~3 points of FY2026 growth to a **Freshdesk price increase** — growth is coming from pricing, not seats.

## 2. Current product lineup

- **Freshdesk (Email & Ticketing)** — classic helpdesk: shared inbox, ticketing, KB, portal.
- **Freshdesk Omni** — separate, pricier SKU unifying Freshdesk + Freshchat + Freddy AI for omnichannel (chat, WhatsApp, voice via Freshcaller).
- **Freshservice** — ITSM/ESM; 2026 additions: **Freshservice ITAM** (Device42-powered, GA Mar 31 2026), **Service Health Monitoring** (GA Jun 24), **XLAs** (Experience Level Agreements, GA ~Jul 31), **MCP Gateway** (early access — connects Freshservice to Claude/Cursor/Copilot) ([Freshworks May 2026 launch](https://www.freshworks.com/theworks/company-news/may-2026-launch/)).
- **Freddy AI** — three paid SKUs: **Freddy AI Agent** (autonomous bot, session-metered), **Freddy AI Copilot** (agent assist: summarization, tone rewrite, sentiment, live translation), **Freddy AI Insights** (analytics; Enterprise-tier). **Freddy AI Agent Studio** (no-code agent builder) shipped May 14 2026; Email AI Agent May 29 (Pro/Enterprise only).
- **Freshsales** (CRM) rounds out the portfolio.

## 3. Pricing (annual billing, per agent/month)

| Plan | Freshdesk | Freshdesk Omni | Freshservice |
|---|---|---|---|
| Free | $0 (2 agents, 6 months) | — | — |
| Growth / Starter | **$19** | $29 | $19 (Starter) |
| Pro / Growth | **$55** | $79 | $49 (Growth) |
| Enterprise / Pro | **$89** | $119 | $95 (Pro); ~$119 Enterprise |

Monthly billing runs ~20–35% higher ([Freshworks pricing](https://www.freshworks.com/freshdesk/pricing/), [Clearfeed analysis](https://clearfeed.ai/blogs/freshdesk-pricing-analysis), [eesel Freshservice pricing](https://www.eesel.ai/blog/freshservice-pricing)).

**AI add-on economics (the real story):**
- **Freddy AI Copilot: +$29/agent/mo annual ($35 monthly)** — on top of seat price, and **only purchasable on Pro/Enterprise** (Growth customers can't buy it at all).
- **Freddy AI Agent: session-metered** — 500 free sessions on Pro/Enterprise, then **$49/100 sessions** (~$100/1,000 bundles). Every interaction consumes a session **whether or not it resolves**; for email AI agents each response counts as a session. Freshworks' own case studies show 23–30% resolution rates, so effective cost per *resolved* ticket is 3–4x the headline per-session price ([eesel Freddy pricing](https://www.eesel.ai/blog/freshdesk-freddy-ai-pricing), [myaskai](https://myaskai.com/blog/freshdesk-freddy-ai-agent-complete-guide-2026)).
- Other metered add-ons: day passes $2–$12; connector app tasks $80/5,000.
- Fully loaded example: 15-agent Pro team + 10 Copilot seats = **$1,115/mo** before session overages — vs the "$19" anchor price prospects see.

## 4. What users praise

G2: **4.4/5 from ~3,700 reviews** (65% five-star) ([G2](https://www.g2.com/products/freshdesk/reviews)). Consistent positives:
- **Ease of use / fast onboarding** — clean ticketing UI, new agents productive quickly; the #1 cited strength.
- **Price vs Zendesk** — 40–60% cheaper at equivalent tiers.
- **Automation basics** — workflow automations, Omniroute load-balancing praised.
- **Multichannel coverage** (email, chat, phone, social) at lower tiers than Zendesk.

## 5. Complaint themes (G2 / Capterra / Trustpilot / AWS Marketplace reviews)

1. **Feature gating / pricing creep** — the loudest theme. Essential items pushed up-tier: CSV export gated; custom reporting, custom portals, multilingual KB require Pro ($55); audit logs, skills-based routing, sandbox, approval workflows require Enterprise ($89). "Costs quickly add up with essential features surprisingly considered add-ons" ([Desk365 review roundup](https://www.desk365.io/blog/freshdesk-reviews/), [Capterra](https://www.capterra.com/p/124981/Freshdesk/reviews/)).
2. **Bugs and performance** — "Laggy & complex interface that is full of bugs that never get fixed" (verified AWS Marketplace review); messages disappearing while typing, cursor jumping after signature insertion; cluttered UI leaving "~1/3 of the screen" for composing replies.
3. **Freshworks' own support quality** — slow, scripted replies; "team was not proactive during onboarding"; one Zendesk-to-Freshdesk switcher reported being "without a help desk for over a week"; support "inadequately trained on their own product."
4. **Reporting** — the analytics redesign is called "overly complex"; raw data export "extremely inconvenient"; useful dashboards paywalled.
5. **Ticketing model gaps** — child tickets behave as separate tickets (breaks conversation history); no automated ticket merging; mobile app feature-poor (WhatsApp support was removed from mobile without warning; noisy Android notifications).
6. **AI value-for-money** — Freddy described as "basic capabilities for the cost"; session-based billing seen as unpredictable; Growth-plan customers locked out of Copilot entirely.

## 6. Positioning vs Zendesk

- Freshdesk's pitch: cheaper, faster to launch, free tier. Growth $19 vs Zendesk Suite Team $55; Freshdesk Enterprise $89 vs Zendesk Suite Enterprise ~$115+. 100 agents: ~$1,500/mo (Growth) vs ~$4,900/mo Zendesk ([helpdesk.com comparison](https://www.helpdesk.com/blog/freshdesk-vs-zendesk/), [CompareTiers](https://comparetiers.com/blog/zendesk-vs-freshdesk-pricing)).
- Zendesk wins on depth: customization, analytics, voice, marketplace, enterprise scale. Zendesk has moved to outcome-based AI pricing (per automated resolution), which is easier to justify than Freddy's per-session metering that bills for failures.
- Net: Freshdesk is "the affordable Zendesk," but reviewers increasingly say it's inheriting Zendesk's problems (upsell pressure, complexity, add-on sprawl) without Zendesk's depth — squeezed from below by Zoho Desk (free for 3 users, far cheaper) and AI-native tools (Intercom Fin, Lorikeet, eesel).

## 7. Exploitable gaps for a simpler competitor

1. **The "simple" brand is now a legacy claim.** Freshdesk's core praise (ease of use) is contradicted by its current reality: 2 SKU lines (classic vs Omni), 3 Freddy SKUs, session packs, day passes, connector task packs. **Flat, all-inclusive pricing with AI included** directly attacks their biggest review-verified pain.
2. **Knowledge base is under-invested and heavily gated.** Article **versioning requires Pro ($55)**; **approval workflows are Enterprise-only ($89)** — below that, the article lifecycle is just Draft→Published with no enforced review gate; multilingual KB and portal customization also up-tier ([Freshdesk KB approval docs](https://support.freshdesk.com/support/solutions/articles/50000001888-approval-workflow-in-the-freshdesk-knowledge-base), [getmacha KB guide](https://www.getmacha.com/blog/freshdesk-knowledge-base-explained)). A product with versioning, review/approval, and analytics on a first-class KB **at the entry tier** is a clear wedge.
3. **No real SOP/internal-process concept.** Freshdesk has "internal KB" folders with agent-only visibility, but nothing like runbooks/SOPs with checklists, ownership, review cadence, or linkage from tickets to procedures. Freshservice has some of this for IT, but it's a separate $49–$119 product. **One platform where customer-facing KB and internal SOPs live together, permissioned by user tier, doesn't exist in the Freshworks lineup.**
4. **Multi-tier user pricing is hostile.** Everyone who touches a ticket needs an agent seat; "external collaborators" only arrive at Pro (5,000 included). Generous free viewer/collaborator/light-agent tiers would undercut them.
5. **AI billing resentment.** Bill per *resolution* (or include AI flat) — Freddy's charge-per-attempt session model is documented as costing 3–4x its headline per successful outcome, and Growth customers can't buy Copilot at all.
6. **Trust gap:** slow vendor support and silent feature removals recur in reviews — fast human support and a public changelog are cheap, credible differentiators.
7. **Timing:** with CX growing only 4% and Freshworks pivoting spend to ITSM/EX, Freshdesk's SMB support base is ripe for displacement.

**Sources:** [Freshworks pricing](https://www.freshworks.com/freshdesk/pricing/) · [Clearfeed Freshdesk pricing analysis](https://clearfeed.ai/blogs/freshdesk-pricing-analysis) · [eesel Freddy AI pricing](https://www.eesel.ai/blog/freshdesk-freddy-ai-pricing) · [myaskai Freddy guide](https://myaskai.com/blog/freshdesk-freddy-ai-agent-complete-guide-2026) · [G2 Freshdesk reviews](https://www.g2.com/products/freshdesk/reviews) · [Capterra Freshdesk reviews](https://www.capterra.com/p/124981/Freshdesk/reviews/) · [Desk365 review roundup](https://www.desk365.io/blog/freshdesk-reviews/) · [Freshworks May 2026 launch](https://www.freshworks.com/theworks/company-news/may-2026-launch/) · [Futurum Q2 FY2026](https://futurumgroup.com/insights/freshworks-q2-fy-2026-freddy-ai-and-ex-drive-commercial-momentum/) · [TradingView 10-Q summary](https://www.tradingview.com/news/tradingview:88b1ce05f24e7:0-freshworks-inc-q2-2026-revenue-237-38m-net-income-3-24m-eps-0-01-10-q-summary/) · [helpdesk.com Freshdesk vs Zendesk](https://www.helpdesk.com/blog/freshdesk-vs-zendesk/) · [CompareTiers pricing comparison](https://comparetiers.com/blog/zendesk-vs-freshdesk-pricing) · [Freshdesk KB approval workflow](https://support.freshdesk.com/support/solutions/articles/50000001888-approval-workflow-in-the-freshdesk-knowledge-base) · [eesel Freshservice pricing](https://www.eesel.ai/blog/freshservice-pricing) · [Trustpilot](https://ca.trustpilot.com/review/freshdesk.com) / AWS Marketplace verified reviews