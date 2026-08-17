import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { loadUser } from './lib/auth.js';
import { HttpError } from './lib/http.js';

import authRoutes from './modules/auth/routes.js';
import usersRoutes from './modules/users/routes.js';
import companiesRoutes from './modules/companies/routes.js';
import ticketsRoutes from './modules/tickets/routes.js';
import kbRoutes from './modules/kb/routes.js';
import helpCenterRoutes from './modules/helpcenter/routes.js';
import sopRoutes from './modules/sop/routes.js';
import schedulesRoutes from './modules/schedules/routes.js';
import slaRoutes from './modules/sla/routes.js';
import portalRoutes from './modules/portal/routes.js';
import settingsRoutes from './modules/settings/routes.js';
import reportsRoutes from './modules/reports/routes.js';
import inboundEmailRoutes from './modules/inbound-email/routes.js';
import chatRoutes from './modules/chat/routes.js';
import exportRoutes from './modules/export/routes.js';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: { level: config.isProduction ? 'info' : 'warn' } });

  await app.register(cookie, { secret: config.sessionSecret });
  await app.register(cors, { origin: true, credentials: true });

  app.addHook('preHandler', loadUser);

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof HttpError) {
      return reply.status(err.statusCode).send({ error: err.message });
    }
    if ((err as { validation?: unknown }).validation) {
      return reply.status(400).send({ error: (err as Error).message });
    }
    app.log.error(err);
    return reply.status(500).send({ error: 'Internal server error' });
  });

  app.get('/api/health', async () => ({ ok: true, human: true, ai: false }));

  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(usersRoutes, { prefix: '/api/users' });
  await app.register(companiesRoutes, { prefix: '/api/companies' });
  await app.register(ticketsRoutes, { prefix: '/api/tickets' });
  await app.register(kbRoutes, { prefix: '/api/kb' });
  await app.register(helpCenterRoutes, { prefix: '/api/help-center' });
  await app.register(sopRoutes, { prefix: '/api/sops' });
  await app.register(schedulesRoutes, { prefix: '/api/schedules' });
  await app.register(slaRoutes, { prefix: '/api/sla' });
  await app.register(portalRoutes, { prefix: '/api/portal' });
  await app.register(settingsRoutes, { prefix: '/api/settings' });
  await app.register(reportsRoutes, { prefix: '/api/reports' });
  await app.register(inboundEmailRoutes, { prefix: '/api/inbound-email' });
  await app.register(chatRoutes, { prefix: '/api/chat' });
  await app.register(exportRoutes, { prefix: '/api/export' });

  // Serve the built client (production). SPA fallback for non-API routes.
  const clientDist = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../client/dist'
  );
  // wildcard serving resolves files per-request, so client rebuilds (hashed filenames)
  // never require a server restart; misses fall through to the SPA fallback below.
  await app.register(fastifyStatic, { root: clientDist });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/')) {
      return reply.status(404).send({ error: 'Not found' });
    }
    return reply.sendFile('index.html');
  });

  return app;
}
