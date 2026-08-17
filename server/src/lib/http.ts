import type { FastifyReply } from 'fastify';
import { ZodError, type ZodSchema } from 'zod';

export class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string
  ) {
    super(message);
  }
}

export const notFound = (what = 'Resource') => new HttpError(404, `${what} not found`);
export const forbidden = (msg = 'Forbidden') => new HttpError(403, msg);
export const badRequest = (msg = 'Bad request') => new HttpError(400, msg);
export const unauthorized = (msg = 'Not signed in') => new HttpError(401, msg);

/** Parse a body/query against a zod schema, throwing a 400 with details on failure. */
export function parse<T>(schema: ZodSchema<T>, data: unknown): T {
  try {
    return schema.parse(data);
  } catch (err) {
    if (err instanceof ZodError) {
      const detail = err.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ');
      throw new HttpError(400, `Validation failed — ${detail}`);
    }
    throw err;
  }
}

export function sendError(reply: FastifyReply, err: unknown) {
  if (err instanceof HttpError) {
    return reply.status(err.statusCode).send({ error: err.message });
  }
  reply.log.error(err);
  return reply.status(500).send({ error: 'Internal server error' });
}
