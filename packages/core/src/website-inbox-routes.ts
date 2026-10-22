import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import AjvCompiler from '@fastify/ajv-compiler';
import { and, eq, notExists, count, asc } from 'drizzle-orm';
import { database } from './database.js';
import { AccessError, requireAdministrator } from './access.js';
import { websiteInquiryDeliveries, websiteInquiries } from './schema.js';
import {
  websiteInquiryView,
  websiteInquiryViewSchema,
} from './website-inquiry-routes.js';
import { importStagedWebsiteInquiry } from './website-inquiry-deliveries.js';
import { WebsiteInquiryError } from './website-inquiries.js';
const validatorCompiler = AjvCompiler()(
  {},
  {
    customOptions: {
      coerceTypes: false,
      removeAdditional: false,
      useDefaults: true,
    },
  },
);
export function registerWebsiteInboxRoutes(
  app: FastifyInstance,
  pool: Pool,
  tenantId: string,
) {
  app.get<{ Querystring: { offset?: string } }>(
    '/api/v1/website-inquiries',
    {
      validatorCompiler,
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            offset: {
              type: 'string',
              pattern: '^(0|[1-9][0-9]{0,5})$',
              default: '0',
            },
          },
        },
        response: {
          200: {
            type: 'object',
            additionalProperties: false,
            required: ['items', 'total', 'offset', 'limit'],
            properties: {
              total: { type: 'integer' },
              offset: { type: 'integer' },
              limit: { type: 'integer' },
              items: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['id', 'original'],
                  properties: {
                    id: { type: 'string', format: 'uuid' },
                    original: websiteInquiryViewSchema,
                  },
                },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      reply.header('cache-control', 'no-store');
      if (!request.authSession)
        return reply.code(401).send({ error: 'unauthorized' });
      try {
        return await database(pool).transaction(
          async (tx) => {
            await requireAdministrator(
              tx,
              tenantId,
              request.authSession!.userId,
            );
            const pending = and(
              eq(websiteInquiryDeliveries.tenantId, tenantId),
              notExists(
                tx
                  .select({ id: websiteInquiries.id })
                  .from(websiteInquiries)
                  .where(
                    and(
                      eq(websiteInquiries.tenantId, tenantId),
                      eq(websiteInquiries.id, websiteInquiryDeliveries.id),
                    ),
                  ),
              ),
            );
            const [summary] = await tx
              .select({ total: count() })
              .from(websiteInquiryDeliveries)
              .where(pending);
            const offset = Math.min(
              Number(request.query.offset ?? '0'),
              Math.floor(Math.max(0, summary!.total - 1) / 25) * 25,
            );
            const rows = await tx
              .select()
              .from(websiteInquiryDeliveries)
              .where(pending)
              .orderBy(
                asc(websiteInquiryDeliveries.stagedAt),
                asc(websiteInquiryDeliveries.id),
              )
              .limit(25)
              .offset(offset);
            return {
              total: summary!.total,
              offset,
              limit: 25,
              items: rows.map((row) => {
                const original = websiteInquiryView(row.payload);
                if ((row.payload as { id: string }).id !== row.id)
                  throw new Error('Invalid stored inquiry');
                return { id: row.id, original };
              }),
            };
          },
          { isolationLevel: 'repeatable read', accessMode: 'read only' },
        );
      } catch (error) {
        return reply.code(error instanceof AccessError ? 403 : 503).send({
          error: error instanceof AccessError ? 'forbidden' : 'unavailable',
        });
      }
    },
  );
  app.post<{ Params: { id: string }; Body: { newContactCountry?: string } }>(
    '/api/v1/website-inquiries/:id/import',
    {
      validatorCompiler,
      schema: {
        params: {
          type: 'object',
          additionalProperties: false,
          required: ['id'],
          properties: { id: { type: 'string', format: 'uuid' } },
        },
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            newContactCountry: { type: 'string', pattern: '^[A-Z]{2}$' },
          },
        },
        response: {
          200: {
            type: 'object',
            additionalProperties: false,
            required: ['status', 'eventId', 'contactId'],
            properties: {
              status: { enum: ['created', 'duplicate'] },
              eventId: { type: 'string', format: 'uuid' },
              contactId: { type: ['string', 'null'], format: 'uuid' },
            },
          },
        },
      },
    },
    async (request, reply) => {
      reply.header('cache-control', 'no-store');
      if (!request.authSession)
        return reply.code(401).send({ error: 'unauthorized' });
      try {
        return await importStagedWebsiteInquiry(
          pool,
          tenantId,
          request.authSession.userId,
          request.params.id,
          request.body,
        );
      } catch (error) {
        if (error instanceof WebsiteInquiryError) {
          const codes = {
            invalid: 400,
            not_found: 404,
            expired: 409,
            conflict: 409,
            contact_review: 409,
            forbidden: 403,
            failed: 503,
          };
          return reply.code(codes[error.reason]).send({
            error: error.reason === 'failed' ? 'unavailable' : error.reason,
          });
        }
        return reply.code(503).send({ error: 'unavailable' });
      }
    },
  );
}
