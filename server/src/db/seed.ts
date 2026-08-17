/**
 * Demo/dev seed: a small, realistic Acme Support install.
 *
 * Run:
 *   cd server && DATABASE_URL=postgres://uss:uss@127.0.0.1:5432/uss npx tsx src/db/seed.ts
 *
 * Idempotent: if admin@example.com already exists, logs "already seeded" and exits.
 * Ticket numbers are allocated through the counters table (same upsert pattern the
 * tickets module uses) so the seed never collides with tickets created by a dev server.
 */
import { eq, sql } from 'drizzle-orm';
import { db, schema, sql as pg } from './index.js';
import { hashPassword } from '../lib/auth.js';
import { applySla, onAgentPublicReply, onStatusChange } from '../lib/sla.js';

function one<T>(rows: T[], what: string): T {
  const row = rows[0];
  if (!row) throw new Error(`Seed failed: expected a row for ${what}`);
  return row;
}

function minutesAgo(n: number): Date {
  return new Date(Date.now() - n * 60_000);
}

function hoursAgo(n: number): Date {
  return minutesAgo(n * 60);
}

/** Same allocation pattern as modules/tickets/service.ts — safe against concurrent dev servers. */
async function nextTicketNumber(): Promise<number> {
  const updated = await db
    .update(schema.counters)
    .set({ value: sql`${schema.counters.value} + 1` })
    .where(eq(schema.counters.name, 'ticket_number'))
    .returning({ value: schema.counters.value });
  if (updated[0]) return updated[0].value;
  const inserted = await db
    .insert(schema.counters)
    .values({ name: 'ticket_number', value: 1 })
    .onConflictDoUpdate({
      target: schema.counters.name,
      set: { value: sql`${schema.counters.value} + 1` },
    })
    .returning({ value: schema.counters.value });
  return one(inserted, 'ticket number').value;
}

async function seed(): Promise<void> {
  const existing = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.email, 'admin@example.com'))
    .limit(1);
  if (existing.length > 0) {
    console.log('already seeded');
    return;
  }

  // ---------- Brand & branding settings ----------

  const brand = one(
    await db
      .insert(schema.brands)
      .values({
        name: 'Acme Support',
        slug: 'acme',
        helpCenterTitle: 'Acme Support Help Center',
        colors: { brand: '37 99 235' },
        isDefault: true,
      })
      .returning(),
    'default brand'
  );

  await db
    .insert(schema.settings)
    .values({
      key: 'branding',
      value: {
        name: 'Acme Support',
        humanPromise:
          'A real person answers every ticket — typically within 15 minutes during business hours.',
        colors: { brand: '37 99 235' },
      },
    })
    .onConflictDoUpdate({
      target: schema.settings.key,
      set: {
        value: {
          name: 'Acme Support',
          humanPromise:
            'A real person answers every ticket — typically within 15 minutes during business hours.',
          colors: { brand: '37 99 235' },
        },
        updatedAt: new Date(),
      },
    });
  console.log('Seeded brand + branding settings');

  // ---------- Staff ----------

  const admin = one(
    await db
      .insert(schema.users)
      .values({
        kind: 'staff',
        email: 'admin@example.com',
        name: 'Alex Morgan',
        title: 'Support Lead',
        role: 'admin',
        timezone: 'Australia/Sydney',
        passwordHash: await hashPassword('admin123'),
      })
      .returning(),
    'admin user'
  );
  const sarah = one(
    await db
      .insert(schema.users)
      .values({
        kind: 'staff',
        email: 'sarah@example.com',
        name: 'Sarah Chen',
        title: 'Support Engineer',
        role: 'agent',
        timezone: 'Australia/Sydney',
        passwordHash: await hashPassword('agent123'),
      })
      .returning(),
    'agent Sarah'
  );
  const james = one(
    await db
      .insert(schema.users)
      .values({
        kind: 'staff',
        email: 'james@example.com',
        name: 'James Okafor',
        title: 'Support Engineer',
        role: 'agent',
        timezone: 'Europe/London',
        passwordHash: await hashPassword('agent123'),
      })
      .returning(),
    'agent James'
  );
  await db.insert(schema.users).values({
    kind: 'staff',
    email: 'dev@example.com',
    name: 'Dev Observer',
    title: 'Developer',
    role: 'collaborator',
    timezone: 'UTC',
    passwordHash: await hashPassword('dev123'),
  });
  console.log('Seeded staff users');

  // ---------- Holiday calendar & schedules ----------

  const auCalendar = one(
    await db
      .insert(schema.holidayCalendars)
      .values({ name: 'Australia 2026', countryCode: 'AU' })
      .returning(),
    'AU holiday calendar'
  );
  await db.insert(schema.holidays).values(
    [
      { name: "New Year's Day", date: '2026-01-01' },
      { name: 'Australia Day', date: '2026-01-26' },
      { name: 'Good Friday', date: '2026-04-03' },
      { name: 'Easter Monday', date: '2026-04-06' },
      { name: 'Anzac Day', date: '2026-04-25' },
      { name: "King's Birthday", date: '2026-06-08' },
      { name: 'Christmas Day', date: '2026-12-25' },
      { name: 'Boxing Day', date: '2026-12-28' }, // observed (26th falls on a Saturday)
    ].map((h) => ({ ...h, calendarId: auCalendar.id }))
  );

  const weekdays = [1, 2, 3, 4, 5]; // Mon-Fri
  const sydneySchedule = one(
    await db
      .insert(schema.schedules)
      .values({
        name: 'Sydney Business Hours',
        timezone: 'Australia/Sydney',
        holidayCalendarId: auCalendar.id,
        isDefault: true,
      })
      .returning(),
    'Sydney schedule'
  );
  const londonSchedule = one(
    await db
      .insert(schema.schedules)
      .values({ name: 'London Business Hours', timezone: 'Europe/London' })
      .returning(),
    'London schedule'
  );
  await db.insert(schema.scheduleIntervals).values([
    // 9:00-17:30 local, both schedules
    ...weekdays.map((weekday) => ({
      scheduleId: sydneySchedule.id,
      weekday,
      startMinute: 540,
      endMinute: 1050,
    })),
    ...weekdays.map((weekday) => ({
      scheduleId: londonSchedule.id,
      weekday,
      startMinute: 540,
      endMinute: 1050,
    })),
  ]);
  console.log('Seeded schedules + Australia 2026 holidays');

  // ---------- Teams ----------

  const apacTeam = one(
    await db
      .insert(schema.teams)
      .values({ name: 'APAC Support', emoji: '🌏', scheduleId: sydneySchedule.id })
      .returning(),
    'APAC team'
  );
  const emeaTeam = one(
    await db
      .insert(schema.teams)
      .values({ name: 'EMEA Support', emoji: '🌍', scheduleId: londonSchedule.id })
      .returning(),
    'EMEA team'
  );
  await db.insert(schema.teamMembers).values([
    { teamId: apacTeam.id, userId: admin.id },
    { teamId: apacTeam.id, userId: sarah.id },
    { teamId: emeaTeam.id, userId: james.id },
  ]);
  console.log('Seeded teams');

  // ---------- SLA policies ----------

  const enterprisePolicy = one(
    await db
      .insert(schema.slaPolicies)
      .values({
        name: 'Australian Enterprise — 15 min',
        description:
          'Enterprise-tier promise: a human first response within 15 minutes during Sydney business hours.',
        position: 0,
        conditions: { companyTiers: ['enterprise'] },
        scheduleId: sydneySchedule.id,
      })
      .returning(),
    'enterprise SLA policy'
  );
  const priorities = ['urgent', 'high', 'normal', 'low'] as const;
  const enterpriseMinutes: Record<
    'first_response' | 'next_response' | 'resolution',
    Record<(typeof priorities)[number], number>
  > = {
    first_response: { urgent: 15, high: 15, normal: 30, low: 60 },
    next_response: { urgent: 30, high: 30, normal: 60, low: 120 },
    resolution: { urgent: 480, high: 960, normal: 1440, low: 2880 },
  };
  await db.insert(schema.slaTargets).values(
    (Object.keys(enterpriseMinutes) as (keyof typeof enterpriseMinutes)[]).flatMap((metric) =>
      priorities.map((priority) => ({
        policyId: enterprisePolicy.id,
        metric,
        priority,
        minutes: enterpriseMinutes[metric][priority],
        useBusinessHours: true,
      }))
    )
  );
  await db.insert(schema.slaEscalations).values([
    {
      policyId: enterprisePolicy.id,
      metric: 'first_response',
      level: 1,
      minutesOffset: -10,
      notifyAssignee: true,
      notifySupervisors: false,
    },
    {
      policyId: enterprisePolicy.id,
      metric: 'first_response',
      level: 2,
      minutesOffset: 0,
      notifyAssignee: false,
      notifySupervisors: true,
    },
  ]);

  const standardPolicy = one(
    await db
      .insert(schema.slaPolicies)
      .values({
        name: 'Standard',
        description: 'Default promise for everyone else: first response within 4 business hours.',
        position: 1,
        conditions: {},
      })
      .returning(),
    'standard SLA policy'
  );
  await db.insert(schema.slaTargets).values(
    priorities.flatMap((priority) => [
      {
        policyId: standardPolicy.id,
        metric: 'first_response' as const,
        priority,
        minutes: 240,
        useBusinessHours: true,
      },
      {
        policyId: standardPolicy.id,
        metric: 'resolution' as const,
        priority,
        minutes: 2880,
        useBusinessHours: true,
      },
    ])
  );
  console.log('Seeded SLA policies');

  // ---------- Companies & customers ----------

  const koala = one(
    await db
      .insert(schema.companies)
      .values({
        name: 'Koala Digital',
        domains: ['koala.example.au'],
        tier: 'enterprise',
        timezone: 'Australia/Sydney',
        membersSeeAllTickets: true,
        slaPolicyId: enterprisePolicy.id,
        scheduleId: sydneySchedule.id,
      })
      .returning(),
    'Koala Digital'
  );
  const bright = one(
    await db
      .insert(schema.companies)
      .values({
        name: 'Bright Retail',
        domains: ['bright.example.com'],
        tier: 'standard',
        timezone: 'America/New_York',
      })
      .returning(),
    'Bright Retail'
  );

  const mia = one(
    await db
      .insert(schema.users)
      .values({
        kind: 'customer',
        email: 'mia@koala.example.au',
        name: 'Mia Nguyen',
        timezone: 'Australia/Sydney',
        passwordHash: await hashPassword('customer123'),
      })
      .returning(),
    'Mia'
  );
  // Liam is a contact only (no portal password yet) — created the way inbound email would.
  const liam = one(
    await db
      .insert(schema.users)
      .values({
        kind: 'customer',
        email: 'liam@koala.example.au',
        name: 'Liam Park',
        timezone: 'Australia/Sydney',
      })
      .returning(),
    'Liam'
  );
  const emma = one(
    await db
      .insert(schema.users)
      .values({
        kind: 'customer',
        email: 'emma@bright.example.com',
        name: 'Emma Diaz',
        timezone: 'America/New_York',
        passwordHash: await hashPassword('customer123'),
      })
      .returning(),
    'Emma'
  );
  await db.insert(schema.companyMembers).values([
    { companyId: koala.id, userId: mia.id, isCompanyAdmin: true, canViewAllTickets: true },
    { companyId: koala.id, userId: liam.id },
    { companyId: bright.id, userId: emma.id },
  ]);
  console.log('Seeded companies + customers');

  // ---------- Knowledge base ----------

  const [gettingStarted, billing, internalPlaybooks] = await db
    .insert(schema.kbCategories)
    .values([
      {
        brandId: brand.id,
        name: 'Getting Started',
        slug: 'getting-started',
        description: 'Accounts, sign-in, and first steps.',
        audience: 'public',
        position: 0,
      },
      {
        brandId: brand.id,
        name: 'Billing',
        slug: 'billing',
        description: 'Invoices, payments, and refunds.',
        audience: 'public',
        position: 1,
      },
      {
        brandId: brand.id,
        name: 'Internal Playbooks',
        slug: 'internal-playbooks',
        description: 'Staff-only procedures and decision guides.',
        audience: 'internal',
        position: 2,
      },
    ])
    .returning();
  if (!gettingStarted || !billing || !internalPlaybooks) {
    throw new Error('Seed failed: expected 3 KB categories');
  }

  const now = new Date();
  const publishedArticle = {
    brandId: brand.id,
    status: 'published' as const,
    ownerId: sarah.id,
    verifyIntervalDays: 90,
    verifiedAt: now,
    publishedAt: now,
  };
  await db.insert(schema.kbArticles).values([
    {
      ...publishedArticle,
      categoryId: gettingStarted.id,
      slug: 'how-to-reset-your-password',
      title: 'How to reset your password',
      articleType: 'how-to',
      audience: 'public',
      position: 0,
      body: [
        'If you cannot sign in, you can reset your password yourself in under a minute.',
        '',
        '## Steps',
        '',
        '1. Go to the sign-in page and click **Forgot password?**',
        '2. Enter the email address on your account.',
        '3. Check your inbox for a message titled **Reset your Acme password**. It can take up to two minutes to arrive — check spam if you do not see it.',
        '4. Click the link and choose a new password (at least 10 characters; a passphrase works well).',
        '',
        '## Still locked out?',
        '',
        'Reset links expire after 60 minutes. If yours has expired, just request a new one.',
        '',
        'If you no longer have access to the email address on the account, open a ticket and a person on our team will verify your identity and help you regain access.',
      ].join('\n'),
    },
    {
      ...publishedArticle,
      categoryId: gettingStarted.id,
      slug: 'inviting-your-teammates',
      title: 'Inviting your teammates',
      articleType: 'how-to',
      audience: 'public',
      position: 1,
      body: [
        'Acme accounts are better with your whole team on board. Owners and admins can invite unlimited teammates.',
        '',
        '## Invite someone',
        '',
        '1. Open **Settings → Team**.',
        '2. Click **Invite teammate** and enter their work email address.',
        '3. Pick a role: **Member** (day-to-day use) or **Admin** (billing and team management).',
        '4. They will receive an email invitation valid for 7 days.',
        '',
        '## Tips',
        '',
        '- Invitations can be resent or revoked from the same page.',
        '- People who sign up with your company email domain can be approved in one click from the **Pending** tab.',
      ].join('\n'),
    },
    {
      ...publishedArticle,
      categoryId: gettingStarted.id,
      slug: 'supported-browsers-and-devices',
      title: 'Supported browsers and devices',
      articleType: 'reference',
      audience: 'public',
      position: 2,
      body: [
        'Acme works in every modern browser. For the best experience we recommend keeping your browser up to date.',
        '',
        '## Fully supported',
        '',
        '| Browser | Minimum version |',
        '| --- | --- |',
        '| Chrome / Edge | last 2 major versions |',
        '| Firefox | last 2 major versions |',
        '| Safari | 16+ |',
        '',
        '## Mobile',
        '',
        'The web app is responsive and works well on phones and tablets. Native apps are on our public roadmap.',
        '',
        'If something looks broken in a supported browser, tell us — a screenshot and the browser version help a lot.',
      ].join('\n'),
    },
    {
      ...publishedArticle,
      categoryId: billing.id,
      slug: 'understanding-your-invoice',
      title: 'Understanding your invoice',
      articleType: 'reference',
      audience: 'public',
      position: 0,
      body: [
        'Invoices are issued on the 1st of each month for the previous month of service and emailed to your billing contact.',
        '',
        '## Reading the invoice',
        '',
        '- **Plan charge** — your base subscription for the billing period.',
        '- **Usage** — any metered usage above the plan allowance, itemised per day.',
        '- **Credits** — service credits and prorated adjustments appear as negative line items.',
        '- **GST/VAT** — tax is applied based on your billing country and tax ID.',
        '',
        '## Common questions',
        '',
        '**Why did my total change this month?** Usually a mid-cycle seat change — added seats are prorated from the day they were added.',
        '',
        '**Can I get invoices in my own currency?** We bill in AUD, USD, EUR, and GBP. Set your currency under **Settings → Billing** before the next cycle starts.',
        '',
        'Anything unclear on an invoice, reply to the invoice email — a person on the billing team answers every one.',
      ].join('\n'),
    },
    {
      ...publishedArticle,
      categoryId: billing.id,
      slug: 'requesting-a-refund',
      title: 'Requesting a refund',
      articleType: 'faq',
      audience: 'public',
      position: 1,
      body: [
        'We offer a no-questions-asked refund window of 14 days on new subscriptions and plan upgrades.',
        '',
        '## How to request one',
        '',
        '1. Open a ticket from the portal (or reply to your invoice email) with the invoice number.',
        '2. Tell us the payment you would like refunded.',
        '3. A person on our billing team confirms within one business day.',
        '',
        '## What to expect',
        '',
        '- Refunds are returned to the original payment method within 5–10 business days.',
        '- Outside the 14-day window we can still help with billing mistakes — double charges, wrong plan, forgotten cancellations. Just ask.',
        '',
        'Refunds are always reviewed by a human, so edge cases get common sense rather than a policy bot.',
      ].join('\n'),
    },
    {
      ...publishedArticle,
      categoryId: internalPlaybooks.id,
      slug: 'refund-approval-playbook',
      title: 'Refund approval playbook',
      articleType: 'reference',
      audience: 'internal',
      position: 0,
      body: [
        'Staff-only guide for handling refund requests consistently. Customer-facing policy lives in "Requesting a refund".',
        '',
        '## Decision guide',
        '',
        '- **Within 14 days of charge** — approve immediately, any agent. No approval needed.',
        '- **Duplicate/erroneous charge** — approve immediately regardless of age; attach the invoice IDs to the ticket.',
        '- **Outside window, under $500** — agent judgement. Bias toward the customer; note the reason on the ticket.',
        '- **Outside window, $500+** — needs supervisor sign-off. Start the *Refund escalation runbook* from the macro.',
        '',
        '## Mechanics',
        '',
        '1. Locate the charge in the billing console (search by invoice number).',
        '2. Issue the refund to the **original payment method** — never to a different card or bank account.',
        '3. Add the `refund` tag and record the amount in the ticket before solving.',
        '',
        '## Never',
        '',
        '- Never promise a refund timeline shorter than 5 business days.',
        '- Never refund to a different payment method (fraud vector).',
      ].join('\n'),
    },
  ]);

  await db.insert(schema.kbArticles).values({
    brandId: brand.id,
    categoryId: gettingStarted.id,
    slug: 'exporting-your-account-data',
    title: 'Exporting your account data',
    articleType: 'how-to',
    audience: 'public',
    status: 'draft',
    ownerId: sarah.id,
    position: 3,
    body: [
      'Draft — needs screenshots and a review pass before publishing.',
      '',
      'You can export everything you have stored in Acme from **Settings → Data export**.',
      '',
      '1. Choose a format (CSV or JSON).',
      '2. Click **Request export** — large accounts can take up to an hour.',
      '3. You will get an email with a download link that stays valid for 7 days.',
    ].join('\n'),
  });

  await db.insert(schema.snippets).values({ key: 'refund_window', value: '14 days' });
  console.log('Seeded KB categories, articles, snippets');

  // ---------- SOP runbook (before macros — the Refund macro links to it) ----------

  const refundSop = one(
    await db
      .insert(schema.sops)
      .values({
        kind: 'runbook',
        title: 'Refund escalation runbook',
        slug: 'refund-escalation-runbook',
        status: 'published',
        ownerId: admin.id,
        verifyIntervalDays: 180,
        verifiedAt: now,
        requiresAcknowledgment: true,
        body: [
          'Run this for refund requests that need supervisor sign-off ($500+ or outside the 14-day window with unusual circumstances).',
          '',
          'The goal: the customer always knows a human is on it, and finance never gets surprised.',
        ].join('\n'),
      })
      .returning(),
    'refund SOP'
  );
  await db.insert(schema.sopSteps).values([
    {
      sopId: refundSop.id,
      position: 1,
      title: 'Verify the charge and collect invoice IDs',
      body: 'Find the charge in the billing console and paste the invoice number(s) and amount into an internal note on the ticket.',
      roleHint: 'agent',
    },
    {
      sopId: refundSop.id,
      position: 2,
      title: 'Tell the customer it is being reviewed by a person',
      body: 'Send a public reply: the request is with a supervisor and they will hear back within one business day. Never promise the outcome.',
      roleHint: 'agent',
    },
    {
      sopId: refundSop.id,
      position: 3,
      title: 'Supervisor decision',
      body: 'Supervisor reviews the note, decides approve/deny/partial, and records the reasoning on the ticket.',
      roleHint: 'supervisor',
    },
    {
      sopId: refundSop.id,
      position: 4,
      title: 'Issue the refund and close the loop',
      body: 'Issue to the original payment method only, add the `refund` tag, reply with the 5-10 business day timeline, then solve the ticket.',
      roleHint: 'agent',
    },
  ]);

  // ---------- Macros ----------

  await db.insert(schema.macros).values([
    {
      name: 'Password reset steps',
      body: [
        'Hi {{customer.name}},',
        '',
        'You can reset your password yourself in under a minute:',
        '',
        '1. Go to the sign-in page and click **Forgot password?**',
        '2. Enter the email address on your account.',
        '3. Follow the link in the email (valid for 60 minutes — check spam if it does not arrive).',
        '',
        'Full walkthrough with screenshots: /help/a/how-to-reset-your-password',
        '',
        'If the link never arrives or you have lost access to that inbox, reply here and I will help you regain access personally.',
      ].join('\n'),
    },
    {
      name: 'Refund request',
      body: [
        'Hi {{customer.name}},',
        '',
        'Thanks for the refund request on ticket #{{ticket.number}} — a real person (me) is looking at it now.',
        '',
        'Our standard refund window is {{snippet:refund_window}} from the charge, and refunds land back on the original payment method within 5-10 business days.',
        '',
        'Could you confirm the invoice number so I can locate the charge?',
        '',
        '{{agent.name}}',
      ].join('\n'),
      actions: { addTags: ['refund'] },
      sopId: refundSop.id,
    },
  ]);
  console.log('Seeded SOP runbook + macros');

  // ---------- Tickets ----------

  interface SeedTicketInput {
    subject: string;
    body: string;
    requesterId: string;
    companyId: string;
    channel: 'email' | 'portal';
    priority: 'low' | 'normal' | 'high' | 'urgent';
    teamId?: string;
    assigneeId?: string;
    tags?: string[];
    createdAt: Date;
  }

  async function seedTicket(input: SeedTicketInput) {
    const number = await nextTicketNumber();
    const ticket = one(
      await db
        .insert(schema.tickets)
        .values({
          number,
          subject: input.subject,
          status: 'new',
          priority: input.priority,
          channel: input.channel,
          brandId: brand.id,
          requesterId: input.requesterId,
          companyId: input.companyId,
          teamId: input.teamId ?? null,
          assigneeId: input.assigneeId ?? null,
          tags: input.tags ?? [],
          createdAt: input.createdAt,
          updatedAt: input.createdAt,
        })
        .returning(),
      `ticket "${input.subject}"`
    );
    await db.insert(schema.ticketMessages).values({
      ticketId: ticket.id,
      kind: 'public',
      authorId: input.requesterId,
      body: input.body,
      channel: input.channel,
      createdAt: input.createdAt,
    });
    if (input.assigneeId) {
      await db.insert(schema.ticketEvents).values({
        ticketId: ticket.id,
        actorId: null,
        type: 'assigned',
        data: { from: null, to: input.assigneeId },
        createdAt: input.createdAt,
      });
    }
    await applySla(ticket.id);
    return ticket;
  }

  // 1. Urgent from Mia (enterprise, email) — fresh, SLA clock visibly running.
  await seedTicket({
    subject: 'Checkout API returning 500s for all AU customers',
    body: [
      'Our production checkout integration started returning HTTP 500 on every request about ten minutes ago.',
      '',
      '- Endpoint: `POST /v2/payments`',
      '- Error: `{"error":"internal_error","request_id":"req_8fk2m1"}`',
      '- Volume: 100% of requests since 09:40 AEST',
      '',
      'This is blocking all checkouts on our storefront. Please treat as critical.',
    ].join('\n'),
    requesterId: mia.id,
    companyId: koala.id,
    channel: 'email',
    priority: 'urgent',
    teamId: apacTeam.id,
    tags: ['api', 'production'],
    createdAt: minutesAgo(5),
  });

  // 2. Portal question from Liam (enterprise, unassigned).
  await seedTicket({
    subject: 'How do we add a new teammate to our workspace?',
    body: [
      'Hi team,',
      '',
      "We have a new developer starting Monday and I can't find where to invite her.",
      'Do invitations need to come from Mia as the account admin, or can I send one myself?',
    ].join('\n'),
    requesterId: liam.id,
    companyId: koala.id,
    channel: 'portal',
    priority: 'normal',
    teamId: apacTeam.id,
    createdAt: hoursAgo(2),
  });

  // 3. Billing question from Emma (standard tier, email).
  await seedTicket({
    subject: 'Double-charged on our August invoice',
    body: [
      'Hello,',
      '',
      'Our card statement shows two identical charges of $249.00 on Aug 12, but we only have one subscription.',
      'Invoice number on the email we received is INV-20260812-4417.',
      '',
      'Could you check and refund the duplicate? Thanks!',
    ].join('\n'),
    requesterId: emma.id,
    companyId: bright.id,
    channel: 'email',
    priority: 'normal',
    tags: ['billing'],
    createdAt: hoursAgo(5),
  });

  // 4. Answered by Sarah, now waiting on the customer.
  {
    const createdAt = hoursAgo(26);
    const repliedAt = hoursAgo(24);
    const ticket = await seedTicket({
      subject: 'CSV export times out for large date ranges',
      body: [
        'When I export transactions for a full quarter the export spins for a couple of minutes and then fails with a timeout.',
        'Exporting a single month works fine. We are on the Growth plan.',
      ].join('\n'),
      requesterId: liam.id,
      companyId: koala.id,
      channel: 'portal',
      priority: 'normal',
      teamId: apacTeam.id,
      assigneeId: sarah.id,
      createdAt,
    });
    await db.insert(schema.ticketMessages).values({
      ticketId: ticket.id,
      kind: 'public',
      authorId: sarah.id,
      body: [
        'Hi Liam,',
        '',
        'Thanks for the clear report — I reproduced this with a 90-day range on an account of your size.',
        '',
        'Two things that will help me narrow it down:',
        '',
        '1. Roughly how many transactions are in the quarter you are exporting?',
        '2. Does it also time out if you export CSV *without* the "include line items" option ticked?',
        '',
        'In the meantime, three separate one-month exports will get you the same data.',
        '',
        'Sarah Chen, Support Engineer',
      ].join('\n'),
      channel: 'portal',
      createdAt: repliedAt,
    });
    await onAgentPublicReply(ticket.id, repliedAt);
    await onStatusChange(ticket.id, 'waiting_on_customer', repliedAt);
    await db.insert(schema.ticketEvents).values({
      ticketId: ticket.id,
      actorId: sarah.id,
      type: 'status_changed',
      data: { from: 'new', to: 'waiting_on_customer' },
      createdAt: repliedAt,
    });
  }

  // 5. Solved by Sarah with a 5-star CSAT.
  {
    const createdAt = hoursAgo(75);
    const repliedAt = hoursAgo(73);
    const solvedAt = hoursAgo(71);
    const ticket = await seedTicket({
      subject: 'Webhook signatures failing after we rotated our secret',
      body: [
        'We rotated our webhook signing secret this morning and now every delivery fails signature verification on our side.',
        'We updated the secret in our config — is there a propagation delay on your end?',
      ].join('\n'),
      requesterId: mia.id,
      companyId: koala.id,
      channel: 'email',
      priority: 'high',
      teamId: apacTeam.id,
      assigneeId: sarah.id,
      tags: ['webhooks'],
      createdAt,
    });
    await db.insert(schema.ticketMessages).values({
      ticketId: ticket.id,
      kind: 'public',
      authorId: sarah.id,
      body: [
        'Hi Mia,',
        '',
        'Found it — when you rotate the secret we keep signing with **both** the old and new secret for 24 hours so in-flight deliveries do not break. Your verifier was only checking the newest signature in the `X-Acme-Signature` header.',
        '',
        'The header carries a list; verify against each value and accept if *any* matches. There is a code sample in your dashboard under **Developers → Webhooks → Verifying**.',
        '',
        'Deliveries from your dashboard replay tool should verify immediately once you loop over the signatures.',
        '',
        'Sarah Chen, Support Engineer',
      ].join('\n'),
      channel: 'email',
      createdAt: repliedAt,
    });
    await onAgentPublicReply(ticket.id, repliedAt);
    await db.insert(schema.ticketMessages).values({
      ticketId: ticket.id,
      kind: 'public',
      authorId: mia.id,
      body: 'That was it — looping over the signature list fixed verification. Thanks for the fast, human answer!',
      channel: 'email',
      createdAt: solvedAt,
    });
    await onStatusChange(ticket.id, 'solved', solvedAt);
    await db.insert(schema.ticketEvents).values({
      ticketId: ticket.id,
      actorId: sarah.id,
      type: 'status_changed',
      data: { from: 'open', to: 'solved' },
      createdAt: solvedAt,
    });
    await db.insert(schema.csatResponses).values({
      ticketId: ticket.id,
      score: 5,
      comment: 'Sarah found the real cause in one reply. Great support.',
      createdAt: hoursAgo(70),
    });
  }
  console.log('Seeded 5 tickets (incl. one waiting on customer, one solved with CSAT)');

  // ---------- Summary ----------

  console.log('\nSeed complete. Demo logins:');
  console.table([
    { email: 'admin@example.com', password: 'admin123', role: 'admin (Alex Morgan)' },
    { email: 'sarah@example.com', password: 'agent123', role: 'agent (Sarah Chen)' },
    { email: 'james@example.com', password: 'agent123', role: 'agent (James Okafor)' },
    { email: 'dev@example.com', password: 'dev123', role: 'collaborator, read-only (Dev Observer)' },
    { email: 'mia@koala.example.au', password: 'customer123', role: 'customer, company admin (Koala Digital)' },
    { email: 'emma@bright.example.com', password: 'customer123', role: 'customer (Bright Retail)' },
  ]);
}

try {
  await seed();
} finally {
  await pg.end();
}
