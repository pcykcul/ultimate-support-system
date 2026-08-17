# Contributing

Thanks for helping build the human-first support system. This project is free software (AGPL-3.0) with two constitutional rules that are not up for debate in PRs:

1. **No AI features.** No model calls, no embeddings, no generated content. Search and suggestions are classic engineering (Postgres full-text + trigram + synonyms). PRs adding AI will be closed with a friendly link to the vision doc.
2. **No open-core.** Every feature ships to everyone. No license gates, no paid editions, no feature flags that segment users.

## Getting started

```bash
git clone https://github.com/pcykcul/ultimate-support-system
cd ultimate-support-system
npm install

# Start Postgres (any way you like), then:
cp .env.example .env            # defaults work for local dev
npm run db:migrate
npm run db:seed                 # demo data — logins are printed at the end
npm run dev                     # API on :3000
npm run dev:client              # Vite dev server on :5173 (proxies /api)
```

Or the whole thing in containers: `docker compose up`.

Demo logins after seeding: `admin@example.com / admin123` (admin), `sarah@example.com / agent123` (agent), `mia@koala.example.au / customer123` (customer portal).

## Before you open a PR

- `npm run typecheck` — zero errors, strict mode.
- `npm test` — the business-hours/SLA math tests must pass; add tests when you touch `server/src/lib/hours.ts` or `sla.ts`.
- `npm run build` — client + server must build.
- Read `docs/development/conventions.md` — module layout, API conventions, and the rules that keep parallel work coherent.

## What makes a good change here

- **Boring and readable beats clever.** A contributor should understand your code in an evening. The evergreen goal means every dependency and abstraction has to pay rent for a decade.
- **Migrations, never manual schema edits** — `npm run db:generate` after editing `server/src/db/schema.ts`; commit the generated SQL.
- **The Human Guarantee shapes UX**: automated emails are labeled receipts, agent replies carry real names, response promises are computed from real schedules — keep it that way in anything you build.
- Small PRs with a clear story merge fastest. For large features, open an issue first and link the relevant product doc (`docs/product/`).

## Project structure

| Path | What lives there |
|---|---|
| `server/src/db/schema.ts` | The whole data model (Drizzle) |
| `server/src/lib/` | Shared engines: auth, business hours, SLA, jobs, mail, events |
| `server/src/modules/<name>/` | One Fastify plugin per domain module |
| `client/src/pages/<area>/` | One React area per domain module |
| `docs/product/` | Vision, feature spec, architecture, roadmap |
| `docs/research/` | The market research this project is built on |

## Reporting bugs & proposing features

Use GitHub Issues. For security problems, see [SECURITY.md](SECURITY.md) — please don't open public issues for vulnerabilities.
