import { database, type Connection } from './database.js';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { and, asc, eq } from 'drizzle-orm';
import { masterData } from './schema.js';
import { AccessError, lockTenant, requireAdministrator } from './access.js';
import { appendAudit } from './audit.js';
export const masterKinds = [
  'event_type',
  'package',
  'cancellation_reason',
] as const;
export type MasterKind = (typeof masterKinds)[number];
export type MasterInput = {
  name: string;
  position: number;
  state: 'active' | 'inactive' | 'archived';
};
export class MasterDataError extends Error {}
export const eventStatuses = [
  { code: 'inquiry', label: 'Anfrage' },
  { code: 'option', label: 'Option' },
  { code: 'booked', label: 'Gebucht' },
  { code: 'unavailable', label: 'Nicht verfügbar' },
  { code: 'cancelled', label: 'Annulliert' },
] as const;
export function masterDataRepository(pool: Connection, tenantId: string) {
  const db = database(pool);
  const scope = eq(masterData.tenantId, tenantId);
  return {
    async list(kind: MasterKind) {
      return db
        .select()
        .from(masterData)
        .where(and(scope, eq(masterData.kind, kind)))
        .orderBy(
          asc(masterData.position),
          asc(masterData.name),
          asc(masterData.id),
        );
    },
    async create(actorId: string, kind: MasterKind, input: MasterInput) {
      return db.transaction(async (tx) => {
        await lockTenant(tx, tenantId);
        await requireAdministrator(tx, tenantId, actorId);
        const [row] = await tx
          .insert(masterData)
          .values({
            ...input,
            name: input.name.trim(),
            tenantId,
            id: randomUUID(),
            kind,
          })
          .returning();
        await appendAudit(
          tx,
          tenantId,
          'master_data.created',
          actorId,
          row!.id,
        );
        return row!;
      });
    },
    async update(
      actorId: string,
      kind: MasterKind,
      id: string,
      input: MasterInput & { version: number },
    ) {
      return db.transaction(async (tx) => {
        await lockTenant(tx, tenantId);
        await requireAdministrator(tx, tenantId, actorId);
        const where = and(
          scope,
          eq(masterData.kind, kind),
          eq(masterData.id, id),
        );
        const [old] = await tx.select().from(masterData).where(where);
        if (!old) throw new MasterDataError('not_found');
        if (old.version !== input.version)
          throw new MasterDataError('conflict');
        const [row] = await tx
          .update(masterData)
          .set({
            name: input.name.trim(),
            position: input.position,
            state: input.state,
            version: old.version + 1,
          })
          .where(where)
          .returning();
        await appendAudit(tx, tenantId, 'master_data.updated', actorId, id);
        return row!;
      });
    },
  };
}
export const masterFields = {
  name: { type: 'string', minLength: 1, maxLength: 120, pattern: '\\S' },
  position: { type: 'integer', minimum: 0, maximum: 9999 },
  state: { type: 'string', enum: ['active', 'inactive', 'archived'] },
};
export function registerMasterDataRoutes(
  app: FastifyInstance,
  pool: Pool,
  tenantId: string,
) {
  const repo = masterDataRepository(pool, tenantId);
  const fields = masterFields;
  const row = {
    type: 'object',
    required: ['id', 'kind', 'name', 'position', 'state', 'version'],
    additionalProperties: false,
    properties: {
      ...fields,
      id: { type: 'string', format: 'uuid' },
      kind: { type: 'string', enum: masterKinds },
      version: { type: 'integer', minimum: 1 },
    },
  };
  const params = {
    type: 'object',
    required: ['kind'],
    properties: {
      kind: { type: 'string', enum: masterKinds },
      id: { type: 'string', format: 'uuid' },
    },
  };
  function failure(error: unknown, reply: FastifyReply) {
    if (error instanceof AccessError)
      return reply.code(403).send({ error: 'forbidden' });
    if (error instanceof MasterDataError)
      return reply
        .code(error.message === 'not_found' ? 404 : 409)
        .send({ error: error.message });
    if (
      error instanceof Error &&
      (error.cause as { code?: string } | undefined)?.code === '23505'
    )
      return reply.code(409).send({ error: 'name_exists' });
    throw error;
  }
  app.get<{ Params: { kind: MasterKind } }>(
    '/api/v1/master-data/:kind',
    { schema: { params, response: { 200: { type: 'array', items: row } } } },
    (request) => repo.list(request.params.kind),
  );
  app.post<{ Params: { kind: MasterKind }; Body: MasterInput }>(
    '/api/v1/master-data/:kind',
    {
      schema: {
        params,
        body: {
          type: 'object',
          required: ['name', 'position', 'state'],
          additionalProperties: false,
          properties: fields,
        },
        response: { 201: row },
      },
    },
    async (request, reply) => {
      try {
        return reply
          .code(201)
          .send(
            await repo.create(
              request.authSession!.userId,
              request.params.kind,
              request.body,
            ),
          );
      } catch (error) {
        return failure(error, reply);
      }
    },
  );
  app.put<{
    Params: { kind: MasterKind; id: string };
    Body: MasterInput & { version: number };
  }>(
    '/api/v1/master-data/:kind/:id',
    {
      schema: {
        params: { ...params, required: ['kind', 'id'] },
        body: {
          type: 'object',
          required: ['name', 'position', 'state', 'version'],
          additionalProperties: false,
          properties: { ...fields, version: { type: 'integer', minimum: 1 } },
        },
        response: { 200: row },
      },
    },
    async (request, reply) => {
      try {
        return await repo.update(
          request.authSession!.userId,
          request.params.kind,
          request.params.id,
          request.body,
        );
      } catch (error) {
        return failure(error, reply);
      }
    },
  );
  app.get(
    '/api/v1/statuses',
    {
      schema: {
        response: {
          200: {
            type: 'array',
            items: {
              type: 'object',
              required: ['code', 'label'],
              properties: {
                code: { type: 'string' },
                label: { type: 'string' },
              },
              additionalProperties: false,
            },
          },
        },
      },
    },
    async () => eventStatuses,
  );
}
