/**
 * Outbound email. With SMTP configured, sends for real; otherwise logs to stdout + email_log —
 * dev installs still get a full audit of what would have been sent.
 * The Human Guarantee applies here: automated mails are visibly receipts, never fake replies.
 */
import nodemailer from 'nodemailer';
import { config } from '../config.js';
import { db, schema } from '../db/index.js';

const transport = config.smtp.host
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

export async function sendMail(opts: SendMailOptions): Promise<void> {
  const from = opts.from ?? config.smtp.from;
  let status = 'logged';
  let error: string | null = null;
  if (transport) {
    try {
      await transport.sendMail({
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
