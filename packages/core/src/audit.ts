import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { desc, eq } from 'drizzle-orm';
import { auditEvents } from './schema.js';
export type AuditAction =
  | 'login.succeeded'
  | 'login.denied'
  | 'login.failed'
  | 'logout'
  | 'password.changed'
  | 'feed.created'
  | 'feed.rotated'
  | 'feed.revoked'
  | 'password.reset'
  | 'password.change_denied'
  | 'master_data.created'
  | 'master_data.updated'
  | 'resource.created'
  | 'resource.updated'
  | 'product.created'
  | 'product.updated'
  | 'contact.created'
  | 'contact.updated'
  | 'location.created'
  | 'location.updated'
  | 'event.created'
  | 'event.updated'
  | 'reservation.created'
  | 'reservation.updated'
  | 'reservation.expired'
  | 'import.created'
  | 'import.updated'
  | 'import.reviewed'
  | 'document_template.created'
  | 'document_template.updated'
  | 'document_number.updated'
  | 'document_layout.updated'
  | 'document.created'
  | 'document.updated'
  | 'document.finalized';
export async function appendAudit(
  db: Pick<NodePgDatabase, 'insert'>,
  tenantId: string,
  action: AuditAction,
  actorId: string | null = null,
  recordId: string | null = null,
) {
  await db.insert(auditEvents).values({ tenantId, actorId, action, recordId });
}
export function auditRepository(pool: Pool, tenantId: string) {
  return {
    async list() {
      const rows = await drizzle(pool)
        .select({
          id: auditEvents.id,
          recordId: auditEvents.recordId,
          actorId: auditEvents.actorId,
          action: auditEvents.action,
          occurredAt: auditEvents.occurredAt,
        })
        .from(auditEvents)
        .where(eq(auditEvents.tenantId, tenantId))
        .orderBy(desc(auditEvents.id))
        .limit(100);
      return rows.map((row) => ({
        ...row,
        id: row.id.toString(),
        occurredAt: row.occurredAt.toISOString(),
      }));
    },
  };
}
export function registerAuditRoutes(
  app: FastifyInstance,
  pool: Pool,
  tenantId: string,
) {
  app.get(
    '/api/v1/audit',
    {
      schema: {
        response: {
          200: {
            type: 'array',
            items: {
              type: 'object',
              required: ['id', 'recordId', 'actorId', 'action', 'occurredAt'],
              additionalProperties: false,
              properties: {
                id: { type: 'string' },
                recordId: {
                  anyOf: [{ type: 'string', format: 'uuid' }, { type: 'null' }],
                },
                actorId: {
                  anyOf: [{ type: 'string', format: 'uuid' }, { type: 'null' }],
                },
                action: { type: 'string' },
                occurredAt: { type: 'string', format: 'date-time' },
              },
            },
          },
        },
      },
    },
    async () => auditRepository(pool, tenantId).list(),
  );
}
