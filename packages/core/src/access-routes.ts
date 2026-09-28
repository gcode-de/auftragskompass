import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { AccessError, accessRepository } from './access.js';
export function registerAccessRoutes(
  app: FastifyInstance,
  pool: Pool,
  tenantId: string,
) {
  const repo = accessRepository(pool, tenantId);
  const account = {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'email', 'active', 'claimed'],
    properties: {
      id: { type: 'string', format: 'uuid' },
      email: { type: 'string' },
      active: { type: 'boolean' },
      claimed: { type: 'boolean' },
    },
  };
  app.get(
    '/api/v1/access',
    { schema: { response: { 200: { type: 'array', items: account } } } },
    async () =>
      (await repo.list()).map((a) => ({
        id: a.id,
        email: a.email,
        active: a.active,
        claimed: a.userId !== null,
      })),
  );
  // Preserve neutral errors without exposing database diagnostics or submitted emails.
  async function mutate(action: () => Promise<unknown>) {
    try {
      await action();
      return undefined;
    } catch (error) {
      if (!(error instanceof AccessError)) throw error;
      return error.message;
    }
  }
  app.post<{ Body: { email: string } }>(
    '/api/v1/access',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['email'],
          properties: {
            email: { type: 'string', format: 'email', maxLength: 254 },
          },
        },
      },
    },
    async (request, reply) => {
      const error = await mutate(() =>
        repo.grant(request.authSession!.userId, request.body.email),
      );
      if (error)
        return reply.code(error === 'forbidden' ? 403 : 409).send({ error });
      return reply.code(201).send({ status: 'created' });
    },
  );
  app.patch<{ Params: { id: string }; Body: { active: boolean } }>(
    '/api/v1/access/:id',
    {
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string', format: 'uuid' } },
        },
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['active'],
          properties: { active: { type: 'boolean' } },
        },
      },
    },
    async (request, reply) => {
      const error = await mutate(() =>
        repo.change(
          request.authSession!.userId,
          request.params.id,
          request.body.active,
        ),
      );
      if (error)
        return reply
          .code(error === 'not_found' ? 404 : error === 'forbidden' ? 403 : 409)
          .send({ error });
      return reply.code(204).send();
    },
  );
}
