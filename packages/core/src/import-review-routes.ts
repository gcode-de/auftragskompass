import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool } from 'pg';
import { AccessError } from './access.js';
import { ImportReviewError, importReviewRepository } from './import-review.js';
import { ResourcePlanError } from './event-reservations.js';
import { eventFields, resourceAvailabilitySchema } from './events.js';
export function registerImportReviewRoutes(
  app: FastifyInstance,
  pool: Pool,
  tenantId: string,
) {
  const repo = importReviewRepository(pool, tenantId);
  const params = {
    type: 'object',
    required: ['id'],
    properties: { id: { type: 'string', format: 'uuid' } },
  };
  const outcome = {
    type: 'object',
    additionalProperties: false,
    required: ['eventId', 'excluded'],
    properties: {
      eventId: { type: ['string', 'null'] },
      excluded: { type: 'boolean' },
    },
  };
  const root = '/api/v1/imports/bookitup/promises/:id';
  function failure(error: unknown, reply: FastifyReply) {
    if (error instanceof AccessError)
      return reply.code(403).send({ error: 'forbidden' });
    if (
      error instanceof ImportReviewError ||
      error instanceof ResourcePlanError
    )
      return reply
        .code(
          error.message === 'not_found'
            ? 404
            : [
                  'invalid_request',
                  'invalid_reference',
                  'invalid_schedule',
                  'invalid_notes',
                  'invalid_period',
                  'invalid_assignments',
                ].includes(error.message)
              ? 400
              : 409,
        )
        .send({ error: error.message });
    throw error;
  }
  app.get<{ Params: { id: string } }>(
    root,
    {
      schema: {
        params,
        response: {
          200: {
            type: 'object',
            additionalProperties: false,
            required: [
              'event',
              'reviewAction',
              'reviewedEventId',
              'canExcludePast',
            ],
            properties: {
              event: {
                type: 'object',
                additionalProperties: false,
                required: [
                  ...Object.keys(eventFields),
                  'id',
                  'version',
                  'timeZone',
                ],
                properties: {
                  ...eventFields,
                  id: { type: 'string' },
                  version: { type: 'integer' },
                  timeZone: { type: 'string' },
                },
              },
              reviewAction: { type: ['string', 'null'] },
              reviewedEventId: { type: ['string', 'null'] },
              canExcludePast: { type: 'boolean' },
            },
          },
        },
      },
    },
    async (request, reply) => {
      try {
        return await repo.read(request.authSession!.userId, request.params.id);
      } catch (error) {
        return failure(error, reply);
      }
    },
  );
  app.get<{
    Params: { id: string };
    Querystring: { unitId?: string; baseStart?: string; baseEnd?: string };
  }>(
    root + '/availability',
    {
      schema: {
        params,
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            unitId: { type: 'string', format: 'uuid' },
            baseStart: { type: 'string', format: 'date-time' },
            baseEnd: { type: 'string', format: 'date-time' },
          },
        },
        response: { 200: { type: 'array', items: resourceAvailabilitySchema } },
      },
    },
    async (request, reply) => {
      try {
        return await repo.availability(
          request.authSession!.userId,
          request.params.id,
          request.query,
        );
      } catch (error) {
        return failure(error, reply);
      }
    },
  );
  app.put<{ Params: { id: string }; Body: unknown }>(
    root,
    {
      config: { rateLimit: {} },
      schema: { params, response: { 200: outcome } },
    },
    async (request, reply) => {
      try {
        return await repo.review(
          request.authSession!.userId,
          request.params.id,
          request.body,
        );
      } catch (error) {
        return failure(error, reply);
      }
    },
  );
  app.post<{ Params: { id: string }; Body: { version: number } }>(
    root + '/exclude-past',
    {
      config: { rateLimit: {} },
      schema: {
        params,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['version'],
          properties: { version: { type: 'integer', minimum: 1 } },
        },
        response: { 200: outcome },
      },
    },
    async (request, reply) => {
      try {
        return await repo.excludePast(
          request.authSession!.userId,
          request.params.id,
          request.body.version,
        );
      } catch (error) {
        return failure(error, reply);
      }
    },
  );
}
