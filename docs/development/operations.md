# Operations: export, backup, and GDPR tooling

The `/api/export` module (server: `server/src/modules/export/`) is the operator's toolbox for
getting data *out* of the system: bulk exports, a single-file logical backup, and GDPR
anonymization. Every endpoint is **admin-only** — sign in as an admin first and reuse the
session cookie.

## Authenticating from the command line

All endpoints authenticate with the normal session cookie (`uss_session`, signed, httpOnly).
Log in once with a cookie jar, then pass it to every call:

```sh
# 1. Log in as an admin and save the session cookie
curl -c cookies.txt \
  -H 'content-type: application/json' \
  -d '{"email":"admin@example.com","password":"admin123"}' \
  http://localhost:3000/api/auth/login

# 2. Use the cookie jar for subsequent calls
curl -b cookies.txt http://localhost:3000/api/export/tickets.json
```

(Dev credentials above come from `npm run seed`; use your real admin account in production.)

## Export endpoints

### `GET /api/export/tickets.csv`

Every ticket, one row each, streamed as a CSV attachment. Columns:

```
number,subject,status,priority,channel,requester_name,requester_email,company,assignee,tags,created_at,solved_at,first_responded_at,sla_breached
```

Fields are RFC 4180-escaped (quotes doubled, fields with commas/quotes/newlines quoted);
`tags` is a comma-joined list inside one quoted field; timestamps are ISO 8601 UTC.

```sh
curl -b cookies.txt -o tickets.csv http://localhost:3000/api/export/tickets.csv
```

### `GET /api/export/tickets.json`

The same rows as the CSV, as a streamed JSON array, with each ticket carrying its full
conversation: `messages: [{kind, author, body, createdAt}]` (`author` is the author's
name, `null` for system messages).

```sh
curl -b cookies.txt -o tickets.json http://localhost:3000/api/export/tickets.json
```

### `GET /api/export/kb.json`

The knowledge base: `{categories: [...], articles: [...]}` — articles include full markdown
bodies and a `revisionCount` per article.

```sh
curl -b cookies.txt -o kb.json http://localhost:3000/api/export/kb.json
```

### `GET /api/export/sops.json`

SOPs with their ordered `steps` and the current read-and-sign `assignments` state (who must
acknowledge which version, who has, with the typed signature name).

```sh
curl -b cookies.txt -o sops.json http://localhost:3000/api/export/sops.json
```

### `GET /api/export/backup.json`

A single-file logical export of every business table:

```json
{ "version": 1, "exportedAt": "…", "tables": { "users": [...], "companies": [...], "…": [] } }
```

```sh
curl -b cookies.txt -o uss-backup.json http://localhost:3000/api/export/backup.json
```

What it deliberately leaves out:

- `users.passwordHash` — credential material never leaves the database; a restored install
  should force password resets.
- `settings` rows under `invite:*` and `chatToken:*` — live invite tokens and chat visitor
  tokens are bearer credentials.
- `sessions`, `jobs`, `kb_search_queries`, `webhook_deliveries`, `email_log`, `counters` —
  secrets, transient queue state, and unbounded operational logs.

All reads are paged (1000 rows at a time) and the response is streamed, so a large install
exports without memory spikes.

## Backup & restore guidance

**For real backups, prefer `pg_dump`.** It is transactionally consistent, byte-faithful
(including the excluded credential columns), fast to restore, and battle-tested:

```sh
pg_dump --format=custom --file=uss.dump "$DATABASE_URL"
pg_restore --clean --if-exists --dbname="$DATABASE_URL" uss.dump
```

**Use `backup.json` for portability**: migrating between installs, archiving a readable
snapshot, feeding data into another tool, or inspecting data without database access. Keep
in mind when restoring from it:

- Insert in an order that satisfies foreign keys (roughly the order the tables appear in
  the file — but note `teams.schedule_id` references `schedules`, so either insert schedules
  first or defer/disable FK checks for the load, e.g. `SET session_replication_role =
  replica` during the import).
- Tables are read page-by-page outside a single transaction, so a backup taken while the
  system is busy may be slightly skewed across tables. `pg_dump` does not have this caveat.
- No password hashes are included: after an import, have users reset passwords (staff can be
  re-invited; customers can use the portal's password flow).
- Ticket `number` uniqueness and the `counters` row must be reconciled on import (set the
  counter to `max(number)`).

Treat any export file as sensitive: it contains customer names, emails, and full ticket
conversations. Store it encrypted, and delete downloads when done.

## The data-privacy story

- **No third-party calls, ever.** Exports, search, and anonymization are all local SQL —
  nothing in this module (or this product; see the constitution) sends data to an external
  service or model. The only outbound traffic the platform ever generates is SMTP to your
  own configured mail server and webhooks to URLs you configured yourself.
- **Single-tenant.** One install, one operator, one database. There is no shared
  infrastructure to leak across.

### `POST /api/export/gdpr/anonymize-user`

Handles a customer's GDPR/CCPA erasure request while keeping the operator's business
records intact.

```sh
curl -b cookies.txt \
  -H 'content-type: application/json' \
  -d '{"email":"customer@example.com"}' \
  http://localhost:3000/api/export/gdpr/anonymize-user
# → {"ticketsAffected": 4, "messagesKept": 11}
```

What it **does** (in one transaction):

- User row: `name` → `"Anonymized user"`, `email` → `null`, `avatarUrl` → `null`,
  `passwordHash` → `null` (the account can never log in again).
- Scrubs free-text opinion in the customer's voice: CSAT comments on their tickets and
  their KB feedback comments are nulled.
- Deletes all their sessions (signed out everywhere) and their company memberships.
- Writes an audit record to `settings` under `gdprAnonymized:<userId>` containing only a
  SHA-256 hash of the original email and a timestamp — enough to later prove "yes, that
  address was anonymized on this date" without storing the address itself.

What it deliberately does **not** do:

- **Ticket message bodies are kept.** They are the operator's own business records of
  support delivered — order references, troubleshooting history, commitments made. GDPR
  erasure targets identifiability, not the operator's correspondence archive; once the
  name, email, and avatar are gone, the messages no longer point at an identifiable person.
  If a message body itself contains personal data the customer wants gone, edit that ticket
  case-by-case.
- **Ticket subjects are not touched**, for the same reason.
- **It refuses staff accounts (HTTP 400).** Staff identity is woven through the audit
  trail — ticket events, KB revisions, SOP sign-offs, replies emailed under their real
  name — and erasing it would falsify those records. Offboard staff by deactivation
  (`POST /api/users/:id/deactivate`), which cuts access while keeping history honest.
- It is idempotent in effect: after anonymization the user has no email, so a repeat call
  for the same address returns 404.

If a customer requests a copy of their data (GDPR access request), pull their tickets out
of `tickets.json` by `requester_email` before anonymizing — afterwards the linkage is gone
by design.
