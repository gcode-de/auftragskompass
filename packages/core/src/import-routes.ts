import { ImportError, importRepository } from './import-repository.js';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import { tenants } from './schema.js';
import { AccessError, requireAdministrator } from './access.js';
import { importSections, previewImport } from './minimal-import.js';
const integer = { type: 'integer', minimum: 0 };
const issue = {
  type: 'object',
  additionalProperties: false,
  required: ['section', 'row', 'code'],
  properties: {
    section: { type: 'string', enum: ['manifest', ...importSections] },
    row: integer,
    code: { type: 'string' },
  },
};
const count = {
  type: 'object',
  additionalProperties: false,
  required: ['total', 'accepted', 'excluded', 'invalid'],
  properties: {
    total: integer,
    accepted: integer,
    excluded: integer,
    invalid: integer,
  },
};
const previewSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'valid',
    'checkedAt',
    'timeZone',
    'pendingPromises',
    'counts',
    'errors',
    'warnings',
    'events',
  ],
  properties: {
    valid: { type: 'boolean' },
    checkedAt: { type: 'string', format: 'date-time' },
    timeZone: { type: 'string' },
    pendingPromises: integer,
    counts: {
      type: 'object',
      additionalProperties: false,
      required: importSections,
      properties: Object.fromEntries(
        importSections.map((section) => [section, count]),
      ),
    },
    errors: { type: 'array', items: issue },
    warnings: { type: 'array', items: issue },
    events: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['row', 'status', 'sourceStatus', 'requiresResourceReview'],
        properties: {
          row: integer,
          status: {
            type: 'string',
            enum: ['inquiry', 'option', 'booked', 'unavailable', 'cancelled'],
          },
          sourceStatus: { type: 'string' },
          requiresResourceReview: { type: 'boolean' },
        },
      },
    },
  },
};
export function registerImportRoutes(
  app: FastifyInstance,
  pool: Pool,
  tenantId: string,
) {
  const repo = importRepository(pool, tenantId);
  const string = { type: 'string' },
    nullable = { type: ['string', 'null'] },
    boolean = { type: 'boolean' };
  const object = (properties: Record<string, unknown>) => ({
    type: 'object',
    additionalProperties: false,
    required: Object.keys(properties),
    properties,
  });
  app.get<{ Querystring: unknown }>(
    '/api/v1/imports/bookitup',
    {
      schema: {
        response: {
          200: object({
            checkedAt: { type: 'string', format: 'date-time' },
            pendingPromises: integer,
            counts: object(
              Object.fromEntries(
                importSections.map((section) => [section, integer]),
              ),
            ),
            mappings: {
              type: 'array',
              items: object({
                section: { type: 'string', enum: importSections },
                externalId: string,
                targetId: string,
                name: string,
                sourceStatus: string,
                targetVersion: integer,
                currentVersion: integer,
                locallyChanged: boolean,
                pendingResourceReview: boolean,
              }),
            },
            promises: {
              type: 'array',
              items: object({
                id: string,
                version: integer,
                externalId: nullable,
                name: string,
                eventDate: nullable,
                startsAt: nullable,
                endsAt: nullable,
                timeZone: string,
                contact: nullable,
                location: nullable,
                package: nullable,
                description: string,
                notesHtml: string,
              }),
            },
          }),
        },
      },
    },
    async (request, reply) => {
      try {
        return await repo.overview(request.authSession!.userId);
      } catch (error) {
        if (error instanceof AccessError)
          return reply.code(403).send({ error: 'forbidden' });
        throw error;
      }
    },
  );

  app.post<{ Body: unknown }>(
    '/api/v1/imports/bookitup',
    {
      bodyLimit: 4 * 1024 * 1024,
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: {
        response: {
          200: {
            type: 'object',
            additionalProperties: false,
            required: ['applied', 'pendingPromises', 'counts'],
            properties: {
              applied: { type: 'boolean' },
              pendingPromises: integer,
              counts: {
                type: 'object',
                additionalProperties: false,
                required: importSections,
                properties: Object.fromEntries(
                  importSections.map((section) => [
                    section,
                    {
                      type: 'object',
                      additionalProperties: false,
                      required: [
                        'created',
                        'bound',
                        'updated',
                        'unchanged',
                        'excluded',
                      ],
                      properties: {
                        created: integer,
                        bound: integer,
                        updated: integer,
                        unchanged: integer,
                        excluded: integer,
                      },
                    },
                  ]),
                ),
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      try {
        return await repo.run(request.authSession!.userId, request.body);
      } catch (error) {
        if (error instanceof AccessError)
          return reply.code(403).send({ error: 'forbidden' });
        if (error instanceof ImportError)
          return reply
            .code(
              [
                'invalid_request',
                'invalid_format',
                'invalid_fields',
                'duplicate_external_id',
                'missing_reference',
                'inactive_reference',
                'duplicate_contact',
                'invalid_schedule',
                'missing_date',
                'invalid_notes',
                'invalid_decision',
              ].includes(error.message)
                ? 400
                : 409,
            )
            .send({
              error: error.message,
              section: error.section,
              row: error.row,
              candidates: error.candidates,
            });
        throw error;
      }
    },
  );
  app.post<{ Body: unknown }>(
    '/api/v1/imports/bookitup/preview',
    {
      schema: { response: { 200: previewSchema } },
      bodyLimit: 4 * 1024 * 1024,
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      try {
        return await drizzle(pool).transaction(
          async (tx) => {
            await requireAdministrator(
              tx,
              tenantId,
              request.authSession!.userId,
            );
            const [tenant] = await tx
              .select({ timeZone: tenants.timezone })
              .from(tenants)
              .where(eq(tenants.id, tenantId));
            return previewImport(request.body, tenant!.timeZone);
          },
          { accessMode: 'read only' },
        );
      } catch (error) {
        if (error instanceof AccessError)
          return reply.code(403).send({ error: 'forbidden' });
        throw error;
      }
    },
  );
}
