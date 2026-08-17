/**
 * Outbound email with three transports, picked automatically:
 *   1. Resend (RESEND_API_KEY set) — https://resend.com, plain HTTPS API, no SDK needed.
 *   2. SMTP (SMTP_HOST set) — via nodemailer.
 *   3. Dev log — logs to stdout + email_log so local installs still show what would send.
 * Every send is recorded in email_log for audit.
 *
 * The Human Guarantee applies here: automated mails are visibly receipts, never fake replies.
 * Templates: settings key 'emailTemplates' lets admins customize subjects/bodies (see renderTemplate).
 */
import nodemailer from 'nodemailer';
import { eq } from 'drizzle-orm';
import { config } from '../config.js';
import { db, schema } from '../db/index.js';

const smtpTransport = config.smtp.host
  ? nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.port === 465,
      auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
    })
  : null;

export interface SendMailOptions {
  to: string;
  subject: string;
  text: string;
  html?: string;
  ticketId?: string;
  headers?: Record<string, string>;
  from?: string;
}

async function sendViaResend(opts: SendMailOptions, from: string): Promise<void> {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [opts.to],
      subject: opts.subject,
      text: opts.text,
      ...(opts.html ? { html: opts.html } : {}),
      ...(opts.headers ? { headers: opts.headers } : {}),
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Resend ${res.status}: ${body.slice(0, 300)}`);
  }
}

export async function sendMail(opts: SendMailOptions): Promise<void> {
  const from = opts.from ?? (await brandedFrom());
  let status = 'logged';
  let error: string | null = null;

  if (config.resendApiKey) {
    try {
      await sendViaResend(opts, from);
      status = 'sent';
    } catch (err) {
      status = 'failed';
      error = err instanceof Error ? err.message : String(err);
    }
  } else if (smtpTransport) {
    try {
      await smtpTransport.sendMail({
        from,
        to: opts.to,
        subject: opts.subject,
        text: opts.text,
        html: opts.html,
        headers: opts.headers,
      });
      status = 'sent';
    } catch (err) {
      status = 'failed';
      error = err instanceof Error ? err.message : String(err);
    }
  } else {
    // eslint-disable-next-line no-console
    console.log(`[mail:logged] to=${opts.to} subject="${opts.subject}"`);
  }

  await db.insert(schema.emailLog).values({
    to: opts.to,
    subject: opts.subject,
    body: opts.text,
    ticketId: opts.ticketId ?? null,
    status,
    error,
  });
}

/** From-address: branding.emailFrom setting wins over the env default. */
async function brandedFrom(): Promise<string> {
  try {
    const [row] = await db
      .select()
      .from(schema.settings)
      .where(eq(schema.settings.key, 'branding'))
      .limit(1);
    const emailFrom = (row?.value as { emailFrom?: string } | undefined)?.emailFrom;
    if (emailFrom) return emailFrom;
  } catch {
    /* settings table may not exist yet during migration */
  }
  return config.smtp.from;
}

// ---- Customizable templates ----

export interface EmailTemplate {
  subject: string;
  body: string;
}

/** Built-in defaults; admins override via settings key 'emailTemplates' (partial overrides fine). */
export const DEFAULT_TEMPLATES: Record<string, EmailTemplate> = {
  ticket_receipt: {
    subject: '[Received] {{ticket.subject}} (#{{ticket.number}})',
    body: 'Hi {{customer.name}},\n\nWe got your message — this is an automated receipt, not a reply.\n\nA real person will get back to you{{promise}}.\n\nTicket: #{{ticket.number}} — {{ticket.subject}}\n\n— {{brand.name}}',
  },
  agent_reply: {
    subject: '[#{{ticket.number}}] {{ticket.subject}}',
    body: '{{reply.body}}\n\n— {{agent.name}}{{agent.titleLine}}\n{{brand.name}}',
  },
  staff_invite: {
    subject: 'You have been invited to {{brand.name}}',
    body: 'Hi {{invite.name}},\n\nYou have been invited to join {{brand.name}} as {{invite.role}}.\n\nAccept your invite: {{invite.url}}\n\n(This is an automated message.)',
  },
  sla_alert: {
    subject: '[SLA] #{{ticket.number}} {{alert.kind}}',
    body: 'Ticket #{{ticket.number}} — {{ticket.subject}}\n\n{{alert.detail}}\n\nOpen: {{ticket.url}}\n\n(Automated SLA alert from {{brand.name}}.)',
  },
  csat_request: {
    subject: 'How did we do? (#{{ticket.number}})',
    body: 'Hi {{customer.name}},\n\nYour ticket "{{ticket.subject}}" was resolved by {{agent.name}} — a real person, for the record.\n\nTell us how it went: {{csat.url}}\n\n— {{brand.name}}',
  },
};

export async function getTemplate(key: string): Promise<EmailTemplate> {
  const fallback = DEFAULT_TEMPLATES[key] ?? { subject: '{{subject}}', body: '{{body}}' };
  try {
    const [row] = await db
      .select()
      .from(schema.settings)
      .where(eq(schema.settings.key, 'emailTemplates'))
      .limit(1);
    const overrides = (row?.value ?? {}) as Record<string, Partial<EmailTemplate>>;
    const o = overrides[key];
    if (!o) return fallback;
    return { subject: o.subject || fallback.subject, body: o.body || fallback.body };
  } catch {
    return fallback;
  }
}

/** Render {{dotted.path}} variables from a flat map like {'ticket.number': 42}. Unknown vars → ''. */
export function renderTemplate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{\{([\w.]+)\}\}/g, (_, key: string) => {
    const v = vars[key];
    return v === undefined || v === null ? '' : String(v);
  });
}

/** Convenience: load template, render subject+body, send. */
export async function sendTemplatedMail(
  templateKey: string,
  to: string,
  vars: Record<string, string | number>,
  opts: { ticketId?: string; headers?: Record<string, string> } = {}
): Promise<void> {
  const t = await getTemplate(templateKey);
  await sendMail({
    to,
    subject: renderTemplate(t.subject, vars),
    text: renderTemplate(t.body, vars),
    ticketId: opts.ticketId,
    headers: opts.headers,
  });
}
