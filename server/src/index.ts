import { buildApp } from './app.js';
import { config } from './config.js';
import { startJobRunner } from './lib/jobs.js';
import { registerSlaJobs } from './modules/sla/jobs.js';
import { registerWebhookJobs } from './modules/settings/webhook-jobs.js';

const app = await buildApp();
registerSlaJobs();
registerWebhookJobs();
startJobRunner();

try {
  await app.listen({ port: config.port, host: config.host });
  console.log(`Support system listening on http://${config.host}:${config.port}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
