/**
 * Webhook delivery. Two halves:
 *  - a `webhook.deliver` job handler that POSTs signed JSON to the subscriber URL and
 *    records every attempt in webhook_deliveries (failures throw so the queue retries);
 *  - a bus '*' subscription that fans every domain event out to enabled webhooks whose
 *    events filter matches (empty filter = everything).
 */
import crypto from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db, schema } from '../../db/index.js';
import { bus } from '../../lib/events.js';
import { enqueueJob, registerJobHandler } from '../../lib/jobs.js';

/** Deep-convert to plain JSON (Dates → ISO strings, undefined dropped) so payloads survive jsonb + HTTP. */
export function jsonSafe(value: unknown): unknown {
  if (value === undefined) return null;
  return JSON.parse(JSON.stringify(value)) as unknown;
}

/** Enqueue one delivery to a specific webhook (used by the automations `send_webhook` action). */
export async function enqueueWebhookDelivery(
  webhookId: string,
  event: string,
  payload: unknown
): Promise<void> {
  await enqueueJob('webhook.deliver', { webhookId, event, payload: jsonSafe(payload) });
}

async function fanOut(event: string, payload: unknown): Promise<void> {
  const hooks = await db
    .select()
    .from(schema.webhooks)
    .where(eq(schema.webhooks.enabled, true));
  if (hooks.length === 0) return;
  const safe = jsonSafe(payload ?? {});
  for (const hook of hooks) {
    if (hook.events.length > 0 && !hook.events.includes(event)) continue;
    await enqueueJob('webhook.deliver', { webhookId: hook.id, event, payload: safe });
  }
}

async function deliver(jobPayload: Record<string, unknown>): Promise<void> {
  const webhookId = typeof jobPayload.webhookId === 'string' ? jobPayload.webhookId : null;
  const event = typeof jobPayload.event === 'string' ? jobPayload.event : 'unknown';
  const payload = jobPayload.payload ?? {};
  if (!webhookId) return;

  const [webhook] = await db
    .select()
    .from(schema.webhooks)
    .where(eq(schema.webhooks.id, webhookId))
    .limit(1);
  // Deleted or switched off since enqueue — drop silently rather than error-retry forever.
  if (!webhook || !webhook.enabled) return;

  const body = JSON.stringify({ event, payload });
  const signature = crypto
    .createHmac('sha256', webhook.secret ?? '')
    .update(body)
    .digest('hex');

  let responseStatus: number | null = null;
  let error: string | null = null;
  try {
    const res = await fetch(webhook.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'X-USS-Event': event,
        'X-USS-Signature': signature,
      },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    responseStatus = res.status;
    if (!res.ok) error = `HTTP ${res.status}`;
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  await db.insert(schema.webhookDeliveries).values({
    webhookId,
    event,
    payload,
    responseStatus,
    error,
  });

  // Throwing marks the job failed so the queue retries with backoff; each attempt gets its own row.
  if (error) throw new Error(`Webhook "${webhook.name}" delivery failed: ${error}`);
}

let registered = false;

export function registerWebhookJobs(): void {
  if (registered) return;
  registered = true;

  registerJobHandler('webhook.deliver', deliver);

  bus.onEvent('*', (envelope) => {
    const event = typeof envelope.event === 'string' ? envelope.event : null;
    if (!event) return;
    void fanOut(event, envelope.payload).catch((err) =>
      console.error('webhook fan-out error', err)
    );
  });
}
