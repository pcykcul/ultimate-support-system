import type { FastifyInstance } from 'fastify';

// STUB — replaced during module build-out.
export default async function routes(app: FastifyInstance): Promise<void> {
  app.get('/__stub', async () => ({ stub: true }));
}
