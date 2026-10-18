import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { and, eq } from 'drizzle-orm';
import { database } from './database.js';
import { AccessError, requireAdministrator } from './access.js';
import { websiteInquiries } from './schema.js';
import { isWebsiteInquiry } from './website-inquiries.js';
import { inquiryFormV1 } from './inquiry-form.js';

export function registerWebsiteInquiryRoutes(
  app: FastifyInstance,
  pool: Pool,
  tenantId: string,
) {
  app.get<{ Params: { id: string } }>(
    '/api/v1/events/:id/website-inquiry',
    {
      schema: {
        params: {
          type: 'object',
          additionalProperties: false,
          required: ['id'],
          properties: { id: { type: 'string', format: 'uuid' } },
        },
        response: {
          200: {
            type: 'object',
            additionalProperties: false,
            required: [
              'formId',
              'formVersion',
              'receivedAt',
              'fields',
              'privacyNotice',
              'privacyUrl',
            ],
            properties: {
              formId: { type: 'string' },
              formVersion: { type: 'integer' },
              receivedAt: { type: 'string', format: 'date-time' },
              privacyNotice: { type: 'string' },
              privacyUrl: { type: 'string' },
              fields: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['label', 'value'],
                  properties: {
                    label: { type: 'string' },
                    value: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      reply
        .header('cache-control', 'no-store')
        .header('referrer-policy', 'no-referrer');
      if (!request.authSession)
        return reply.code(401).send({ error: 'unauthorized' });
      const actorId = request.authSession.userId;
      try {
        const value = await database(pool).transaction(
          async (tx) => {
            await requireAdministrator(tx, tenantId, actorId);
            const [row] = await tx
              .select({ payload: websiteInquiries.payload })
              .from(websiteInquiries)
              .where(
                and(
                  eq(websiteInquiries.tenantId, tenantId),
                  eq(websiteInquiries.eventId, request.params.id),
                ),
              );
            if (!row) return null;
            if (!isWebsiteInquiry(row.payload))
              throw new Error('Invalid stored inquiry');
            const original = row.payload;
            return {
              formId: original.submission.formId,
              formVersion: original.submission.formVersion,
              receivedAt: original.receivedAt,
              privacyNotice: original.privacyNotice,
              privacyUrl: original.privacyUrl,
              fields: inquiryFormV1.fields.map((field) => {
                const raw = original.submission.fields[field.name] ?? '';
                return {
                  label: field.label,
                  value:
                    field.type === 'select'
                      ? (field.options.find((option) => option.value === raw)
                          ?.label ?? '')
                      : field.type === 'date'
                        ? raw.split('-').reverse().join('.')
                        : raw,
                };
              }),
            };
          },
          { isolationLevel: 'repeatable read', accessMode: 'read only' },
        );
        return value ?? reply.code(404).send({ error: 'not_found' });
      } catch (error) {
        return reply.code(error instanceof AccessError ? 403 : 503).send({
          error: error instanceof AccessError ? 'forbidden' : 'unavailable',
        });
      }
    },
  );
}
