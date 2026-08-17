# 2025–2026 Support Trends & AI: Research Report

## 1. AI agents: what's real vs. hype

**Vendor claims vs. measured reality.** Intercom's Fin has processed 40M+ resolved conversations and Intercom cites a ~67% trailing-30-day resolution rate (vendor-reported, late 2025), backed by an enterprise "$1M performance guarantee" tied to a 65% resolution floor. But Intercom's own case studies show 42–50% (Linktree 42%, Robin 50%), and an independent test of Fin on 500 real tickets across 4 small businesses measured **38% resolution**. Intercom advertises a <1% hallucination rate, yet G2 reviewers and Intercom community threads report Fin "claiming features could do things they actually cannot do" even when sources were triple-checked. Industry-wide: 88% of contact centers use some AI, but **only 14% of self-service interactions actually resolve**.

**The correction is underway.** Klarna — the poster child for AI replacing 700 agents — reversed course in mid-2025 and rehired humans; CEO Siemiatkowski: "We focused too much on efficiency and cost. The result was lower quality, and that's not sustainable." Gartner predicted (March 2025) agentic AI would resolve 80% of common issues by 2029, then published (June 2025) that **>40% of agentic AI projects will be canceled by end of 2027** due to cost, unclear value, and inadequate risk controls. Customer sentiment matches: 64% of customers wish companies would stop using AI in support; 68% prefer a live human over digital self-service.

**What actually works:** AI grounded in a well-maintained KB (RAG) for FAQ-class tickets (Tidio's Lyro resolves a claimed 55–65% of common FAQs), agent-assist drafting/summarization/tone-adjust, and auto-triage. The universal failure mode: **answer quality is capped by KB quality** — a stale help center produces confidently wrong answers. Freddy AI Agent sources answers directly from the Freshdesk KB; Fin is the same. This is a direct argument for making the KB a first-class, easy-to-maintain product surface, since it doubles as the AI's brain.

## 2. The pricing backlash (the biggest opening)

**Resolution-based pricing is broadly resented:**
- **Intercom Fin: $0.99 per "outcome"** (resolution, procedure handoff, or disqualification; $9.99 per lead qualification) on top of seat prices. Notably, Fin now sells standalone on top of Zendesk, Salesforce, HubSpot, Freshworks, Zoho — the AI layer is being unbundled from the helpdesk.
- **Zendesk: ~$1.50/resolution committed, ~$2.00 pay-as-you-go** — the meter rate isn't even published. Complaint themes: bills swing with ticket volume (spikes are penalized); **double-billing** when AI fails and escalates (you pay the resolution meter *and* the human seat); a few thousand AI resolutions/month = a four-figure bill atop seats.
- **Freshdesk Freddy AI Agent: session-based** — 500 free sessions on Growth/Pro/Enterprise, then $49 per 100 sessions ($0.49/session) on classic Freshdesk, ~$100 per 1,000 ($0.10/session) on Omni. **Sessions expire monthly with no rollover.**

**Add-on stacking on per-agent pricing:**
- Zendesk seats run **$19–$115/agent/mo**; AI Copilot is a **$50/agent/mo add-on**, so a Professional-plan team pays **~$165/agent before any resolution charges**.
- Freddy AI Copilot is **$29/agent/mo** (annual), locked to Pro/Enterprise — Growth customers can't buy it at all. Capterra reviewers: "The Freddy AI is an add on so expensive for what it can do."
- **Help Scout's cautionary tale:** switched to contact-based billing Nov 2024, walked much of it back by April 2025 after customer criticism; now runs two coexisting models (Standard $50/mo with 100 contacts, Plus $75/mo), with no AI usage fees.

**What SMBs are choosing instead:** flat or seat-free pricing. Chatwoot's Pro tier is **$75/mo for unlimited agents** (cloud per-agent tiers: $19/$39/$99); Commslayer is a **free helpdesk with a $39/mo AI agent, unlimited seats**; Tidio is $29–79/mo flat. The recurring SMB demand set: predictable flat pricing, no per-agent gouging, no AI meter anxiety, no feature-gating of "basics" (reporting, automation) behind enterprise tiers.

## 3. Incumbent complaint themes (G2/Capterra/Reddit)

- **Zendesk** (G2 ~4.3, Capterra ~4.4): steep learning curve — "configuration takes longer than sales demos suggest," requires admin expertise; feature overload for small teams; cost escalation via add-ons; and its *own* support for billing/contract issues takes "days or weeks."
- **Freshdesk** (G2 4.4/~3,700 reviews, Capterra 4.5/~3,440): Freddy "basic" relative to marketing; **Freddy only replies to the first email in a thread** (follow-ups dump to humans); basics locked behind higher tiers; below-average support once issues turn technical; difficult cancellation.
- The winners' positioning writes itself from these reviews: Help Scout is praised for a "learning curve measured in hours rather than weeks"; **Pylon** (Slack/Teams-native B2B helpdesk) raised a **$31M Series B in Aug 2025** ($51M total, 750+ customers, 5x YoY revenue growth two years running); **Plain** is API-first, Slack-native, with **AI included on all plans** — bundled AI as an anti-add-on stance.

## 4. Omnichannel expectations

Email + web chat are table stakes; **WhatsApp is the fastest-growing support channel globally** (especially Europe, LatAm, Asia, Africa). 76% of customers expect a ≤24-hour response on social. The expectation is *one inbox* across email, chat, WhatsApp, Instagram, Facebook — "one inbox, one price, no separate products." Incumbent friction to exploit: Zendesk's WhatsApp setup requires Meta Business Manager verification plus Admin Center configuration; Freshdesk gates WhatsApp into Omni plans. A simpler product wins by making WhatsApp/social onboarding a guided 10-minute flow, not an enterprise add-on.

## 5. Self-service & KB

**92% of consumers would use a knowledge base for self-support if available; 32% have stopped doing business with a company over missing self-service.** Yet only 14% of self-service interactions resolve — the gap is content quality and findability, not willingness. Product implications: KB authoring must be as easy as writing a doc; AI should draft KB articles from resolved tickets (closing the RAG feedback loop); analytics should surface "questions with no KB answer." An internal SOP layer is a differentiator none of the big three treat as first-class — internal notes and macros exist, but versioned, permissioned SOPs for tiered internal teams are typically bolted on via Guide "internal" articles or external wikis.

## 6. What makes tools feel "simple" (UX patterns)

- **Cmd+K command palette** is now standard in power-user tools (Linear, Vercel, GitHub, Slack, Raycast) — it collapses navigation, actions, and feature discovery into one searchable surface, which especially helps new/infrequent users discover features.
- **Keyboard-first triage** (Linear's model: j/k navigation, single-key assign/snooze/close) — reviewers consistently cite Linear's speed + keyboard-first navigation as why it displaced Jira for startups.
- **Opinionated defaults over infinite config**: Linear "deliberately avoids the breadth of Jira/ClickUp" — constraint is the feature. Zendesk's negative reviews are the mirror image: config sprawl and admin expertise required.
- **Email-familiar mental model**: Help Scout's "email-style interface that feels instantly familiar" is its most-cited strength.
- **Live-in-your-tools**: Pylon/Plain's growth shows B2B teams want support threaded into Slack/Teams rather than a separate console.

## 7. Actionable positioning for our product

1. **Flat, published pricing with AI included** (Plain/Commslayer model) directly counters the three-layer bill (seat + copilot add-on + resolution meter). "No AI meter" is a marketable feature in 2026.
2. **KB-as-AI-brain**: one KB powers customer self-service, RAG answers, and agent-assist; ship "draft article from this ticket" and "unanswered questions" reports.
3. **Honest AI framing**: target 40–50% deflection of FAQ-class volume with human handoff, not "replace your team" — the Klarna/Gartner correction made overpromising a liability.
4. **First-class SOPs with role-based visibility** (end customer / team / admin) — an unserved wedge.
5. **Cmd+K + keyboard triage + opinionated defaults + 10-minute WhatsApp setup** as the "simple" proof points.

## Sources

- [Gleap — Intercom Fin pricing 2026](https://www.gleap.io/blog/intercom-fin-ai-pricing-2026) · [Featurebase — Fin AI pricing](https://www.featurebase.app/blog/fin-ai-pricing) · [builts.ai — Fin tested on 500 tickets](https://builts.ai/blog/intercom-fin-ai-review/) · [Intercom community — Fin hallucinations](https://community.intercom.com/deploy-fin-96/fin-suddenly-hallucinates-and-no-longer-responds-correctly-13286)
- [Voiceflow — Zendesk pricing 2026](https://www.voiceflow.com/blog/zendesk-pricing) · [eesel — Zendesk AI pricing](https://www.eesel.ai/blog/zendesk-ai-pricing) · [eesel — Zendesk Copilot add-on](https://www.eesel.ai/blog/zendesk-ai-copilot-add-on-pricing) · [Futurum — Zendesk outcome-based pricing](https://futurumgroup.com/insights/will-zendesks-resolutions-driven-strategy-resonate-with-customers/) · [Richpanel — Zendesk pricing/add-ons](https://www.richpanel.com/learn/zendesk-pricing)
- [eesel — Freddy AI pricing](https://www.eesel.ai/blog/freshdesk-freddy-ai-pricing) · [myaskai — Freddy AI guide](https://myaskai.com/blog/freshdesk-freddy-ai-agent-complete-guide-2026) · [Capterra — Freshdesk reviews](https://www.capterra.com/p/124981/Freshdesk/reviews/) · [G2 — Freshdesk reviews](https://www.g2.com/products/freshdesk/reviews)
- [Helpjuice — Zendesk review 2026](https://helpjuice.com/blog/zendesk-review) · [Featurebase — Zendesk pros/cons](https://www.featurebase.app/blog/zendesk-pros-and-cons)
- [Forbes — Klarna reverses AI push](https://www.forbes.com/sites/quickerbettertech/2025/05/18/business-tech-news-klarna-reverses-on-ai-says-customers-like-talking-to-people/) · [Gartner — 40% of agentic AI projects canceled by 2027](https://www.gartner.com/en/newsroom/press-releases/2025-06-25-gartner-predicts-over-40-percent-of-agentic-ai-projects-will-be-canceled-by-end-of-2027) · [MavenAGI — Gartner 80% prediction, one year on](https://www.mavenagi.com/resources/one-year-since-gartners-ai-resolution-prediction)
- [Lorikeet — AI customer service statistics 2026](https://www.lorikeetcx.ai/articles/ai-customer-service-statistics) · [Freshworks — customer service statistics 2026](https://www.freshworks.com/customer-service/statistics/)
- [eesel — Help Scout pricing 2026](https://www.eesel.ai/blog/helpscout-pricing) · [Chatwoot pricing](https://www.chatwoot.com/pricing) · [Commslayer pricing](https://www.commslayer.com/pricing) · [builts.ai — Zendesk alternatives for SMB](https://builts.ai/blog/zendesk-alternative-small-business/)
- [Pylon — Zendesk alternatives / modern UX](https://www.usepylon.com/blog/zendesk-alternatives-modern-user-experience-2025) · [Hiver — Pylon alternatives (funding/traction)](https://hiverhq.com/blog/pylon-alternatives) · [Plain — startup support tools](https://www.plain.com/blog/startups-customer-support-tools)
- [Knock — designing keyboard shortcuts](https://knock.app/blog/how-to-design-great-keyboard-shortcuts) · [uxpatterns.dev — command palette pattern](https://uxpatterns.dev/patterns/advanced/command-palette) · [Toolradar — Linear review](https://toolradar.com/tools/linear)
- [eesel — Zendesk WhatsApp 2026](https://www.eesel.ai/blog/zendesk-whatsapp-connection) · [eesel — Freshdesk WhatsApp 2026](https://www.eesel.ai/blog/freshdesk-whatsapp-business)