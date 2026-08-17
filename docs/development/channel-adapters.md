# Channel Adapters

Every conversation channel enters the system the same way: something turns an external event into
either a **new ticket** or a **customer reply on an existing ticket**. Email and live chat ship
built-in; everything else (WhatsApp, Messenger, SMS, …) is an adapter following the same pattern.

## The pattern

An adapter is a small HTTP endpoint (or poller) that:

1. Authenticates the provider's webhook (shared secret / signature header).
2. Maps the provider payload to `{ from: {email?, externalId, name?}, text, threadRef }`.
3. Resolves the customer: find-or-create a `users` row (`kind: 'customer'`). For channels without
   email, store the provider identity in `customFields` on the ticket and match on `threadRef`.
4. Threads: if `threadRef` (provider conversation id) matches an open ticket's
   `custom_fields.threadRef`, it's a reply → insert a public message + `onCustomerReply(ticketId)`.
   Otherwise create a ticket via `server/src/modules/tickets/service.ts` helpers with the channel set.
5. Outbound: subscribe to the bus for `message.created` (public, staff-authored) on tickets of your
   channel and push the reply back through the provider's send API.

The built-in **email adapter** (`server/src/modules/inbound-email/routes.ts`) is the reference
implementation of exactly this shape — read it first.

## WhatsApp (via the Meta Cloud API)

WhatsApp support requires a Meta Business account, a verified WhatsApp Business number, and webhook
registration — that's provider bureaucracy, not code. The adapter itself is:

- `GET /webhook` — Meta's verification handshake (echo `hub.challenge` when `hub.verify_token` matches).
- `POST /webhook` — validate `X-Hub-Signature-256`, map `entry[].changes[].value.messages[]` to the
  pattern above (`threadRef` = the WhatsApp conversation/wa_id, channel `'chat'` or a dedicated
  `'whatsapp'` channel value if you extend the enum in `schema.ts` + a migration).
- Outbound — POST to `https://graph.facebook.com/v21.0/{phone-number-id}/messages` with the reply text
  inside the 24-hour customer-service window (outside it, WhatsApp requires template messages — surface
  that state to the agent rather than silently failing).

Keep the Human Guarantee: WhatsApp auto-acknowledgments must be visibly automated receipts, and every
real reply is a named human.

## SMS / Messenger / others

Same pattern; the only variables are the webhook verification scheme, the payload mapping, and the
outbound send call. Adapters belong in `server/src/modules/<channel>/` with their own routes file,
registered in `app.ts` — one module per channel, nothing shared but the pattern.
