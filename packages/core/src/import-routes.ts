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
