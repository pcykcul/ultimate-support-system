# Open-Source & Self-Hosted Helpdesks — Competitive Survey (August 2026)

## Landscape snapshot (GitHub data pulled 2026-08-17)

| Project | Stars | Stack | License | Activity | Open issues |
|---|---|---|---|---|---|
| Chatwoot | 35,908 | Ruby on Rails + Vue | MIT core + proprietary `/enterprise` dir (repo shows NOASSERTION) | pushed today | 1,339 |
| UVdesk | 19,525 | PHP/Symfony | OSL-3.0 | last push Oct 2025 — effectively dormant | 79 |
| Zammad | 5,851 | Ruby on Rails (Vue/TS rewrite in progress) | AGPL-3.0 | pushed today | 447 |
| FreeScout | 4,479 | PHP/Laravel | AGPL-3.0 | pushed Aug 15, 2026 | 23 |
| osTicket | 3,891 | PHP | GPL-2.0 | last push Jun 2026 | 1,203 |
| Frappe Helpdesk | 3,315 | Python (Frappe Framework) + Vue 3 | AGPL-3.0 | pushed Aug 13, 2026 | 183 |
| Peppermint | 3,159 | TypeScript/Next.js/Prisma | custom | **archived July 17, 2026 — read-only** | 101 |
| Libredesk | 2,705 | Go single binary + Vue 3/shadcn | AGPL-3.0 | pushed today; created May 2024 | 80 |

## Tool-by-tool

**Chatwoot** — the category leader by adoption. Omnichannel inbox (web widget, email, WhatsApp, Messenger, Instagram, Telegram), Help Center KB product, automations, reports, unlimited agents self-hosted. The catch is aggressive open-core: the free Community edition **excludes SLA policies, custom roles/permissions, SAML SSO, agent capacity, voice, and Captain AI**. Those require paid self-hosted tiers: Premium Support at $19/agent/mo (custom roles, Captain AI, branding) and Enterprise at $99/agent/mo (SAML, SLA). Cloud pricing: Hacker $0 / Startups $19 / Business $39 / Enterprise $99 per agent/mo (annual), plus metered Captain AI credits (300/500/800 per plan; $20 per extra 1,000) and data-retention caps of 6mo/1yr/2yr by tier. HN commenters explicitly criticize the retention limits and the open-core paywall.

**Zammad** — the closest structural Zendesk clone: full ticketing, SLAs, escalations, macros/triggers, email/phone/chat/Telegram/Facebook channels, included KB with granular permissions, LDAP/Exchange, real RBAC. Its costs are operational: PostgreSQL + Redis + **Elasticsearch**, 4 GB RAM minimum (8 GB at ~1,000 tickets/mo), and "upgrade choreography." HN verdict: features "pretty robust" but "frontend is a bit oldish." Hosted pricing was raised in an early-2026 "v2" update: €7 Starter / €16 Professional / €25 Plus per agent/mo — and WhatsApp/Facebook channels are **Plus-only**.

**FreeScout** — the lean favorite: pure PHP + MySQL, runs on shared hosting or a $4 VPS in under 512 MB RAM; unlimited agents/mailboxes free. Email-first shared inbox; everything else is a one-time-fee module (Knowledge Base $12 on freescout.net; third-party guides cite SLA ~$30). Community loves the model ("Happy to pay a bit to keep the project sustainable") and the repo hygiene is striking — only 23 open issues. Gaps: email-only by default, module sprawl instead of a coherent product, UI is functional-not-delightful, single-maintainer governance risk.

**osTicket** — the 2003-era warhorse. Included KB, customer portal, custom forms/fields, agent/team/department/role model, GPL-2.0. Still updated (June 2026) but carries 1,203 open issues and a UI that every 2025-26 roundup calls dated; API is minimal. Users who stay cite predictability: "no auto-messages sent to users." It's what people mean when they say open-source helpdesks "look ten years old."

**Peppermint** — cautionary tale, not a competitor: **archived July 17, 2026** after the sole maintainer stopped; last real push Sept 2025. It validated demand (3.1k stars for a Next.js "Zendesk & Jira alternative" with KB/notebook built in) and then proved the sustainability fear that HN keeps citing (alongside the papercups.io shutdown).

**Frappe Helpdesk** — the most modern-feeling entrant with real backing (Frappe/ERPNext). Dual agent + customer portals, included KB with search-driven article deflection, SLAs, auto-assignment rules, canned replies; AGPL; Frappe Cloud hosting from $5/mo flat (not per-agent). Gap: it drags in the entire Frappe Framework, so anyone outside the ERPNext ecosystem inherits a big, opinionated platform.

**Libredesk** (2025-26 breakout) — Go backend, Vue 3 frontend, single-binary deploy; built by a Zerodha engineer because Zendesk/Intercom limits didn't work for ~500 agents; fully AGPL with an explicit "no open-core, ever" pledge. Already has automation, CSAT, SLAs, granular permissions, and a live-chat widget (beta) alongside email. Two Show HN front pages (Feb 2025, and again in 2026). Still alpha: **no knowledge base yet** (a top requested feature), no customer self-service portal (tickets via email/chat only), docs lag code.

Also-rans: UVdesk (e-commerce-flavored, near-dormant), OTOBO (Perl OTRS fork, ITSM-leaning), GLPI (ITSM/asset-first), OpenSupports (small), Helper by Antiwork/Gumroad (open-source AI support agent, 2025 — signal that AI-native OSS support is starting).

## What Reddit/HN actually complain about (recurring themes)

1. **Channel integrations decide the purchase.** "Support desk is all about channel integrations" — WhatsApp/Instagram/Telegram coverage is the #1 gap. One team's verbatim exit: integrations with "Shopify, ebay, whatsapp, woocommerce… that's where we gave up."
2. **KB and customer portal are afterthoughts.** FreeScout paywalls KB as a module, Libredesk lacks one entirely, Chatwoot ships it as a separate product; only Zammad, osTicket, and Frappe include a first-class KB + portal.
3. **The good stuff is paywalled even when self-hosting.** Chatwoot's SLA/custom-roles/SAML gating is the canonical example — "open-core alternatives lock essential features behind enterprise plans" is now a differentiation pitch (Libredesk's).
4. **Ops burden.** Zammad's Elasticsearch stack turns "one more web app" into infrastructure; Chatwoot needs Rails+Postgres+Redis+Sidekiq. FreeScout and Libredesk win mindshare purely on deployability.
5. **Mobile is bad everywhere** ("mobile experience is not great"); SLA engines lack severity tiers, timezones, and holiday calendars; people want **bidirectional Jira/GitHub sync**.
6. **Sustainability anxiety.** Post-Peppermint and post-Papercups, "lack of monetisation strategy is a concern" is a standard HN objection to any new OSS desk.
7. **AI gap (2025-26).** Zendesk/Freshdesk are selling AI agents hard; the only OSS answer is Chatwoot's Captain — metered and paywalled.

## Cost math driving the migration

Zendesk Suite runs $55–$115+/agent/mo (a 15-agent team on Suite Professional ≈ $9,900/yr; entry Support plans from $19). Self-hosting comparisons circulating in 2026: 10 agents over 3 years ≈ $6,840–$41,400 on Zendesk vs ~$280 on FreeScout or ~$360 on Zammad infrastructure.

## Implications for our product

- **Whitespace is exactly our thesis:** nothing in OSS combines a modern UI, first-class KB, *and* a customer portal without either enterprise paywalls (Chatwoot), heavy ops (Zammad), or framework lock-in (Frappe). No OSS tool has an internal **SOP/runbook section at all** — self-hosters bolt on BookStack or Outline next to their helpdesk.
- **Multi-tier roles are a monetization pressure point:** Chatwoot charges $19/agent/mo for custom roles; Zammad's RBAC is free but buried in a dated UI. Simple, free, granular roles (customer / agent / admin / viewer) would directly counter-position.
- **Table stakes to not lose evaluations:** WhatsApp + live chat channels, sub-1GB single-container deploy (FreeScout/Libredesk set the bar), SLA with business hours/holidays, Jira/GitHub sync, mobile-usable agent UI, and a credible sustainability story.
- **Peppermint's archive and UVdesk's stall mean two named "simple Zendesk alternative" slots just opened.** Libredesk is the fastest-moving occupant; its missing KB/portal is our clearest wedge.

Sources: [Libredesk HN thread](https://news.ycombinator.com/item?id=43158166), [Libredesk 2026 Show HN](https://news.ycombinator.com/item?id=47833870), [libredesk.io](https://libredesk.io/), [selfhosting.sh Zendesk replacement guide](https://selfhosting.sh/replace/zendesk/), [Chatwoot self-hosted pricing](https://www.chatwoot.com/pricing/self-hosted-plans), [eesel Chatwoot pricing teardown](https://www.eesel.ai/blog/chatwoot-pricing), [Zammad pricing](https://zammad.com/en/pricing), [Chatarmin Zammad pricing 2026](https://chatarmin.com/en/blog/zammad-pricing), [FreeScout KB module](https://freescout.net/module/knowledge-base/), [FreeScout GitHub](https://github.com/freescout-help-desk/freescout), [Peppermint GitHub (archived)](https://github.com/Peppermint-Lab/peppermint), [Frappe Helpdesk](https://frappe.io/helpdesk), [frappe/helpdesk GitHub](https://github.com/frappe/helpdesk), [openMSP open-source ticketing roundup](https://www.openmsp.ai/blog/ticketing-system-open-source), [use-apify Zendesk alternatives 2026](https://use-apify.com/blog/zendesk-alternatives-2026); GitHub repo metrics via GitHub API, 2026-08-17.