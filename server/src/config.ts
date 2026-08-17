export const config = {
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? '0.0.0.0',
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://uss:uss@localhost:5432/uss',
  sessionSecret: process.env.SESSION_SECRET ?? 'dev-only-change-me',
  appUrl: process.env.APP_URL ?? 'http://localhost:3000',
  smtp: {
    host: process.env.SMTP_HOST ?? '',
    port: Number(process.env.SMTP_PORT ?? 587),
    user: process.env.SMTP_USER ?? '',
    pass: process.env.SMTP_PASS ?? '',
    from: process.env.SMTP_FROM ?? 'Support <support@example.com>',
  },
  inboundEmailSecret: process.env.INBOUND_EMAIL_SECRET ?? 'dev-only-change-me',
  isProduction: process.env.NODE_ENV === 'production',
};
