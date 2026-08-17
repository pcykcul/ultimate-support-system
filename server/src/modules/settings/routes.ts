/**
 * Instance settings: branding/white-label (colors + font), email template
 * customization, staff alert controls, automation rules, outbound webhooks,
 * search synonyms, and the outbound email audit log. The automations engine,
 * alert notifications, and webhook fan-out are wired to the event bus when
 * this plugin registers.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { asc, desc, eq } from 'drizzle-orm';
import { db, schema } from '../../db/index.js';
import { badRequest, notFound, parse } from '../../lib/http.js';
import { requireAdmin, requireAgent, requireStaff, requireSupervisor } from '../../lib/auth.js';
import {
  DEFAULT_TEMPLATES,
  sendTemplatedMail,
  type EmailTemplate,
} from '../../lib/mailer.js';
import {
  AUTOMATION_EVENTS,
  actionsSchema,
  conditionsSchema,
  registerAutomationEngine,
} from './automations.js';
import {
  loadNotificationSettings,
  mergeNotificationSettings,
  notificationsPutSchema,
  registerNotifications,
  saveNotificationSettings,
} from './notifications.js';

const idParams = z.object({ id: z.string().uuid() });

// ---- Branding ----

const DEFAULT_COLORS = { brand: '37 99 235', brandSoft: '219 234 254', brandFg: '255 255 255' };
const DEFAULT_HUMAN_PROMISE =
  'Every reply here is written by a real person — typically within business hours.';

interface BrandingValue {
  name: string;
  logoUrl: string | null;
  colors: { brand: string; brandSoft: string; brandFg: string };
  /** Font key understood by the client's FONT_STACKS (or a raw CSS font-family string). */
  font: string | null;
  helpCenterTitle: string;
  humanPromise: string;
  emailFrom: string | null;
}

type StoredBranding = Partial<Omit<BrandingValue, 'colors'>> & {
  colors?: Partial<BrandingValue['colors']> | null;
};

const brandingPutSchema = z.object({
  name: z.string().min(1),
  logoUrl: z.string().nullable().optional(),
  colors: z
    .object({
      brand: z.string().min(1).optional(),
      brandSoft: z.string().min(1).optional(),
      brandFg: z.string().min(1).optional(),
    })
    .optional(),
  font: z.string().nullable().optional(),
  helpCenterTitle: z.string().nullable().optional(),
  humanPromise: z.string().nullable().optional(),
  emailFrom: z.string().email().nullable().optional(),
});

function withBrandingDefaults(stored: StoredBranding): BrandingValue {
  const name = stored.name?.trim() || 'Support';
  return {
    name,
    logoUrl: stored.logoUrl ?? null,
    colors: { ...DEFAULT_COLORS, ...(stored.colors ?? {}) },
    font: stored.font?.trim() || null,
    helpCenterTitle: stored.helpCenterTitle || `${name} Help Center`,
    humanPromise: stored.humanPromise || DEFAULT_HUMAN_PROMISE,
    emailFrom: stored.emailFrom ?? null,
  };
}

async function loadBranding(): Promise<BrandingValue> {
  const rows = await db
    .select()
    .from(schema.settings)
    .where(eq(schema.settings.key, 'branding'))
    .limit(1);
  return withBrandingDefaults((rows[0]?.value ?? {}) as StoredBranding);
}

// ---- Email templates ----

interface TemplateVariable {
  name: string;
  description: string;
}

/** The {{vars}} each template supports — surfaced to the editor as clickable chips. */
const TEMPLATE_VARIABLES: Record<string, TemplateVariable[]> = {
  ticket_receipt: [
    { name: 'customer.name', description: "The requester's name" },
    { name: 'ticket.number', description: 'Human-friendly ticket number' },
    { name: 'ticket.subject', description: 'Ticket subject line' },
    { name: 'promise', description: 'The human response promise, e.g. " by tomorrow 9:00 AM (your local time)"' },
    { name: 'brand.name', description: 'Your brand name' },
  ],
  agent_reply: [
    { name: 'reply.body', description: "The agent's reply text" },
    { name: 'agent.name', description: "The replying agent's real name" },
    { name: 'agent.titleLine', description: "The agent's title on its own line (empty when unset)" },
    { name: 'ticket.number', description: 'Human-friendly ticket number' },
    { name: 'ticket.subject', description: 'Ticket subject line' },
    { name: 'brand.name', description: 'Your brand name' },
  ],
  staff_invite: [
    { name: 'invite.name', description: "The invitee's name" },
    { name: 'invite.role', description: 'The role they were invited as' },
    { name: 'invite.url', description: 'The accept-invite link' },
    { name: 'brand.name', description: 'Your brand name' },
  ],
  sla_alert: [
    { name: 'ticket.number', description: 'Human-friendly ticket number' },
    { name: 'ticket.subject', description: 'Ticket subject line' },
    { name: 'ticket.url', description: 'Link to the ticket for staff' },
    { name: 'alert.kind', description: "'warning' or 'breached'" },
    { name: 'alert.detail', description: 'One-line explanation of the alert' },
    { name: 'brand.name', description: 'Your brand name' },
  ],
  csat_request: [
    { name: 'customer.name', description: "The requester's name" },
    { name: 'ticket.number', description: 'Human-friendly ticket number' },
    { name: 'ticket.subject', description: 'Ticket subject line' },
    { name: 'agent.name', description: 'The agent who solved the ticket' },
    { name: 'csat.url', description: 'The satisfaction survey link (customer portal)' },
    { name: 'brand.name', description: 'Your brand name' },
  ],
};

/** Representative values for test sends — brand.name is filled from real branding at send time. */
const SAMPLE_VARS: Record<string, Record<string, string | number>> = {
  ticket_receipt: {
    'customer.name': 'Alex Sample',
    'ticket.number': 1042,
    'ticket.subject': 'Cannot sign in to my account',
    promise: ' by tomorrow 9:00 AM (your local time)',
  },
  agent_reply: {
    'reply.body': "Thanks for the details — I've reset your session and you should be able to sign in now. Let me know if anything still looks off.",
    'agent.name': 'Sam Agent',
    'agent.titleLine': '\nSupport Engineer',
    'ticket.number': 1042,
    'ticket.subject': 'Cannot sign in to my account',
  },
  staff_invite: {
    'invite.name': 'Jordan New',
    'invite.role': 'agent',
    'invite.url': 'https://example.com/accept-invite?token=sample',
  },
  sla_alert: {
    'ticket.number': 1042,
    'ticket.subject': 'Cannot sign in to my account',
    'ticket.url': 'https://example.com/tickets/sample',
    'alert.kind': 'warning',
    'alert.detail': 'The first_response SLA target is due in about 30 minutes.',
  },
  csat_request: {
    'customer.name': 'Alex Sample',
    'ticket.number': 1042,
    'ticket.subject': 'Cannot sign in to my account',
    'agent.name': 'Sam Agent',
    'csat.url': 'https://example.com/portal/tickets/sample',
  },
};

type TemplateOverrides = Record<string, Partial<EmailTemplate>>;

async function loadTemplateOverrides(): Promise<TemplateOverrides> {
  const rows = await db
    .select()
    .from(schema.settings)
    .where(eq(schema.settings.key, 'emailTemplates'))
    .limit(1);
  return (rows[0]?.value ?? {}) as TemplateOverrides;
}

function resolveTemplate(
  key: string,
  overrides: TemplateOverrides
): { subject: string; body: string; isDefault: boolean } {
  const fallback = DEFAULT_TEMPLATES[key]!;
  const o = overrides[key];
  const isDefault = !o || (!o.subject && !o.body);
  return {
    subject: o?.subject || fallback.subject,
    body: o?.body || fallback.body,
    isDefault,
  };
}

const templatePutSchema = z.object({
  subject: z.string(),
  body: z.string(),
});

// ---- Automations ----

const automationCreateSchema = z.object({
  name: z.string().min(1),
  event: z.enum(AUTOMATION_EVENTS),
  conditions: conditionsSchema.default({}),
  actions: actionsSchema.default([]),
  enabled: z.boolean().optional(),
});

const automationPatchSchema = z.object({
  name: z.string().min(1).optional(),
  event: z.enum(AUTOMATION_EVENTS).optional(),
  conditions: conditionsSchema.optional(),
  actions: actionsSchema.optional(),
  enabled: z.boolean().optional(),
});

// ---- Webhooks ----

const webhookCreateSchema = z.object({
  name: z.string().min(1),
  url: z.string().url(),
  secret: z.string().nullable().optional(),
  events: z.array(z.string().min(1)).default([]),
});

const webhookPatchSchema = z.object({
  name: z.string().min(1).optional(),
  url: z.string().url().optional(),
  secret: z.string().nullable().optional(),
  events: z.array(z.string().min(1)).optional(),
  enabled: z.boolean().optional(),
});

// ---- Synonyms ----

const synonymCreateSchema = z.object({
  terms: z.array(z.string()).min(2),
});

export default async function routes(app: FastifyInstance): Promise<void> {
  registerAutomationEngine();
  registerNotifications(app);

  // ---- Branding / white-label ----

  // GET /branding/public — no auth: the login page, help center and portal all need it.
  app.get('/branding/public', async () => {
    const b = await loadBranding();
    return {
      name: b.name,
      logoUrl: b.logoUrl,
      colors: b.colors,
      font: b.font,
      helpCenterTitle: b.helpCenterTitle,
      humanPromise: b.humanPromise,
    };
  });

  app.get('/branding', { preHandler: requireAdmin }, async () => loadBranding());

  // PUT /branding — full replace of the stored value (normalized with defaults).
  app.put('/branding', { preHandler: requireAdmin }, async (req) => {
    const body = parse(brandingPutSchema, req.body);
    const value = withBrandingDefaults({
      name: body.name,
      logoUrl: body.logoUrl ?? null,
      colors: body.colors ?? null,
      font: body.font ?? null,
      helpCenterTitle: body.helpCenterTitle ?? undefined,
      humanPromise: body.humanPromise ?? undefined,
      emailFrom: body.emailFrom ?? null,
    });
    await db
      .insert(schema.settings)
      .values({ key: 'branding', value, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: schema.settings.key,
        set: { value, updatedAt: new Date() },
      });
    return value;
  });

  // ---- Email templates ----

  app.get('/email-templates', { preHandler: requireAdmin }, async () => {
    const overrides = await loadTemplateOverrides();
    const templates: Record<string, { subject: string; body: string; isDefault: boolean }> = {};
    for (const key of Object.keys(DEFAULT_TEMPLATES)) {
      templates[key] = resolveTemplate(key, overrides);
    }
    return { templates, variables: TEMPLATE_VARIABLES };
  });

  // PUT /email-templates/:key — empty subject AND body reset the template to its default.
  app.put('/email-templates/:key', { preHandler: requireAdmin }, async (req) => {
    const { key } = req.params as { key: string };
    if (!DEFAULT_TEMPLATES[key]) throw notFound('Email template');
    const body = parse(templatePutSchema, req.body);
    const subject = body.subject.trim();
    const text = body.body.trim();

    const overrides = await loadTemplateOverrides();
    if (!subject && !text) {
      delete overrides[key];
    } else {
      overrides[key] = { ...(subject ? { subject } : {}), ...(text ? { body: text } : {}) };
    }
    await db
      .insert(schema.settings)
      .values({ key: 'emailTemplates', value: overrides, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: schema.settings.key,
        set: { value: overrides, updatedAt: new Date() },
      });
    return resolveTemplate(key, overrides);
  });

  // POST /email-templates/:key/test — send the template with sample data to the calling admin.
  app.post('/email-templates/:key/test', { preHandler: requireAdmin }, async (req) => {
    const { key } = req.params as { key: string };
    if (!DEFAULT_TEMPLATES[key]) throw notFound('Email template');
    const email = req.user!.email;
    if (!email) throw badRequest('Your account has no email address to send the test to');
    const branding = await loadBranding();
    await sendTemplatedMail(key, email, {
      ...(SAMPLE_VARS[key] ?? {}),
      'brand.name': branding.name,
    });
    return { ok: true, to: email };
  });

  // ---- Alert / notification controls ----

  app.get('/notifications', { preHandler: requireAdmin }, async () => loadNotificationSettings());

  app.put('/notifications', { preHandler: requireAdmin }, async (req) => {
    const body = parse(notificationsPutSchema, req.body);
    return saveNotificationSettings(mergeNotificationSettings(body));
  });

  // ---- Automations ----

  app.get('/automations', { preHandler: requireSupervisor }, async () => {
    const rows = await db
      .select()
      .from(schema.automations)
      .orderBy(asc(schema.automations.createdAt));
    return { items: rows };
  });

  app.post('/automations', { preHandler: requireSupervisor }, async (req, reply) => {
    const body = parse(automationCreateSchema, req.body);
    const inserted = await db
      .insert(schema.automations)
      .values({
        name: body.name,
        event: body.event,
        conditions: body.conditions,
        actions: body.actions,
        enabled: body.enabled ?? true,
      })
      .returning();
    reply.status(201);
    return inserted[0]!;
  });

  app.patch('/automations/:id', { preHandler: requireSupervisor }, async (req) => {
    const { id } = parse(idParams, req.params);
    const body = parse(automationPatchSchema, req.body);
    const updates: Partial<typeof schema.automations.$inferInsert> = {};
    if (body.name !== undefined) updates.name = body.name;
    if (body.event !== undefined) updates.event = body.event;
    if (body.conditions !== undefined) updates.conditions = body.conditions;
    if (body.actions !== undefined) updates.actions = body.actions;
    if (body.enabled !== undefined) updates.enabled = body.enabled;

    if (Object.keys(updates).length === 0) {
      const rows = await db
        .select()
        .from(schema.automations)
        .where(eq(schema.automations.id, id))
        .limit(1);
      if (!rows[0]) throw notFound('Automation');
      return rows[0];
    }
    const updated = await db
      .update(schema.automations)
      .set(updates)
      .where(eq(schema.automations.id, id))
      .returning();
    if (!updated[0]) throw notFound('Automation');
    return updated[0];
  });

  app.delete('/automations/:id', { preHandler: requireSupervisor }, async (req, reply) => {
    const { id } = parse(idParams, req.params);
    const deleted = await db
      .delete(schema.automations)
      .where(eq(schema.automations.id, id))
      .returning();
    if (!deleted[0]) throw notFound('Automation');
    return reply.status(204).send();
  });

  // ---- Webhooks ----

  app.get('/webhooks', { preHandler: requireAdmin }, async () => {
    const rows = await db.select().from(schema.webhooks).orderBy(asc(schema.webhooks.createdAt));
    return { items: rows };
  });

  app.post('/webhooks', { preHandler: requireAdmin }, async (req, reply) => {
    const body = parse(webhookCreateSchema, req.body);
    const inserted = await db
      .insert(schema.webhooks)
      .values({
        name: body.name,
        url: body.url,
        secret: body.secret ?? null,
        events: body.events,
      })
      .returning();
    reply.status(201);
    return inserted[0]!;
  });

  app.patch('/webhooks/:id', { preHandler: requireAdmin }, async (req) => {
    const { id } = parse(idParams, req.params);
    const body = parse(webhookPatchSchema, req.body);
    const updates: Partial<typeof schema.webhooks.$inferInsert> = {};
    if (body.name !== undefined) updates.name = body.name;
    if (body.url !== undefined) updates.url = body.url;
    if (body.secret !== undefined) updates.secret = body.secret;
    if (body.events !== undefined) updates.events = body.events;
    if (body.enabled !== undefined) updates.enabled = body.enabled;

    if (Object.keys(updates).length === 0) {
      const rows = await db
        .select()
        .from(schema.webhooks)
        .where(eq(schema.webhooks.id, id))
        .limit(1);
      if (!rows[0]) throw notFound('Webhook');
      return rows[0];
    }
    const updated = await db
      .update(schema.webhooks)
      .set(updates)
      .where(eq(schema.webhooks.id, id))
      .returning();
    if (!updated[0]) throw notFound('Webhook');
    return updated[0];
  });

  app.delete('/webhooks/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const { id } = parse(idParams, req.params);
    const deleted = await db
      .delete(schema.webhooks)
      .where(eq(schema.webhooks.id, id))
      .returning();
    if (!deleted[0]) throw notFound('Webhook');
    return reply.status(204).send();
  });

  app.get('/webhooks/:id/deliveries', { preHandler: requireAdmin }, async (req) => {
    const { id } = parse(idParams, req.params);
    const hook = await db
      .select({ id: schema.webhooks.id })
      .from(schema.webhooks)
      .where(eq(schema.webhooks.id, id))
      .limit(1);
    if (!hook[0]) throw notFound('Webhook');
    const rows = await db
      .select()
      .from(schema.webhookDeliveries)
      .where(eq(schema.webhookDeliveries.webhookId, id))
      .orderBy(desc(schema.webhookDeliveries.createdAt))
      .limit(50);
    return { items: rows };
  });

  // ---- Search synonyms ----

  app.get('/synonyms', { preHandler: requireStaff }, async () => {
    const rows = await db.select().from(schema.searchSynonyms).orderBy(asc(schema.searchSynonyms.id));
    return { items: rows };
  });

  app.post('/synonyms', { preHandler: requireAgent }, async (req, reply) => {
    const body = parse(synonymCreateSchema, req.body);
    // Normalize: trim, lowercase, dedupe — a group needs at least two distinct terms to mean anything.
    const terms = [...new Set(body.terms.map((t) => t.trim().toLowerCase()).filter(Boolean))];
    if (terms.length < 2) throw badRequest('A synonym group needs at least two distinct terms');
    const inserted = await db.insert(schema.searchSynonyms).values({ terms }).returning();
    reply.status(201);
    return inserted[0]!;
  });

  app.delete('/synonyms/:id', { preHandler: requireAgent }, async (req, reply) => {
    const { id } = parse(idParams, req.params);
    const deleted = await db
      .delete(schema.searchSynonyms)
      .where(eq(schema.searchSynonyms.id, id))
      .returning();
    if (!deleted[0]) throw notFound('Synonym group');
    return reply.status(204).send();
  });

  // ---- Email log ----

  app.get('/email-log', { preHandler: requireAdmin }, async () => {
    const rows = await db
      .select()
      .from(schema.emailLog)
      .orderBy(desc(schema.emailLog.createdAt))
      .limit(100);
    return { items: rows };
  });
}
