import { registerResourceBlockRoutes } from './resource-blocks.js';
import { registerResourceCategoryRoutes } from './resource-categories.js';
import { registerResourcePlanningRoutes } from './resource-planning.js';
import { registerResourceLinkRoutes } from './resource-links.js';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { drizzle } from 'drizzle-orm/node-postgres';
import { and, asc, eq } from 'drizzle-orm';
import { resources } from './schema.js';
import { AccessError, lockTenant, requireAdministrator } from './access.js';
import { appendAudit } from './audit.js';
export type ResourceInput = {
  name: string;
  code: string;
  category: string;
  /** RES-BKP-02: item, set or case; an older client keeps the stored one. */
  kind?: 'item' | 'set' | 'case';
  description: string;
  quantity: number;
  beforeDays: number;
  afterDays: number;
  blocked: boolean;
  state: 'active' | 'inactive' | 'archived';
  position: number;
};
class ResourceError extends Error {}
export function resourceRepository(pool: Pool, tenantId: string) {
  const db = drizzle(pool),
    scope = eq(resources.tenantId, tenantId);
  return {
    async list() {
      return db
        .select()
        .from(resources)
        .where(scope)
        .orderBy(asc(resources.position), asc(resources.code));
    },
    async save(
      actorId: string,
      input: ResourceInput,
      id?: string,
      version?: number,
    ) {
      return db.transaction(async (tx) => {
        await lockTenant(tx, tenantId);
        await requireAdministrator(tx, tenantId, actorId);
        let previous = 0,
          kept: 'item' | 'set' | 'case' = 'item';
        if (id) {
          const [old] = await tx
            .select()
            .from(resources)
            .where(and(scope, eq(resources.id, id)));
          if (!old) throw new ResourceError('not_found');
          if (old.version !== version) throw new ResourceError('conflict');
          previous = old.version;
          kept = old.kind as typeof kept;
        }
        const values = {
          ...input,
          kind: input.kind ?? kept,
          name: input.name.trim(),
          code: input.code.trim(),
          category: input.category.trim(),
          version: previous + 1,
        };
        const [row] = id
          ? await tx
              .update(resources)
              .set(values)
              .where(and(scope, eq(resources.id, id)))
              .returning()
          : await tx
              .insert(resources)
              .values({ ...values, tenantId, id: randomUUID() })
              .returning();
        await appendAudit(
          tx,
          tenantId,
          id ? 'resource.updated' : 'resource.created',
          actorId,
          row!.id,
        );
        return row!;
      });
    },
  };
}
export function registerResourceRoutes(
  app: FastifyInstance,
  pool: Pool,
  tenantId: string,
) {
  registerResourceBlockRoutes(app, pool, tenantId);
  registerResourceCategoryRoutes(app, pool, tenantId);
  registerResourcePlanningRoutes(app, pool, tenantId);
  registerResourceLinkRoutes(app, pool, tenantId);
  const repo = resourceRepository(pool, tenantId);
  const fields = {
    name: { type: 'string', minLength: 1, maxLength: 120, pattern: '\\S' },
    code: { type: 'string', minLength: 1, maxLength: 40, pattern: '\\S' },
    category: { type: 'string', minLength: 1, maxLength: 120, pattern: '\\S' },
    kind: { type: 'string', enum: ['item', 'set', 'case'] },
    description: { type: 'string', maxLength: 2000 },
    quantity: { type: 'integer', minimum: 0, maximum: 10000 },
    beforeDays: { type: 'integer', minimum: 0, maximum: 365 },
    afterDays: { type: 'integer', minimum: 0, maximum: 365 },
    blocked: { type: 'boolean' },
    state: { type: 'string', enum: ['active', 'inactive', 'archived'] },
    position: { type: 'integer', minimum: 0, maximum: 9999 },
  };
  // `kind` came later (RES-BKP-02); bodies may leave it out.
  const required = Object.keys(fields).filter((key) => key !== 'kind');
  const version = { type: 'integer', minimum: 1 },
    row = {
      type: 'object',
      additionalProperties: false,
      required: [...Object.keys(fields), 'id', 'version'],
      properties: {
        ...fields,
        id: { type: 'string', format: 'uuid' },
        version,
      },
    };
  function failure(error: unknown, reply: FastifyReply) {
    if (error instanceof AccessError)
      return reply.code(403).send({ error: 'forbidden' });
    if (
      error instanceof Error &&
      ['resource_units_in_use', 'booked_event_requires_box'].includes(
        (error.cause as { constraint?: string } | undefined)?.constraint ?? '',
      )
    )
      return reply.code(409).send({ error: 'resource_in_use' });
    if (error instanceof ResourceError)
      return reply
        .code(error.message === 'not_found' ? 404 : 409)
        .send({ error: error.message });
    if (
      error instanceof Error &&
      (error.cause as { code?: string } | undefined)?.code === '23505'
    )
      return reply.code(409).send({ error: 'code_exists' });
    throw error;
  }
  app.get(
    '/api/v1/resources',
    { schema: { response: { 200: { type: 'array', items: row } } } },
    () => repo.list(),
  );
  app.post<{ Body: ResourceInput }>(
    '/api/v1/resources',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: required,
          properties: fields,
        },
        response: { 201: row },
      },
    },
    async (request, reply) => {
      try {
        return reply
          .code(201)
          .send(await repo.save(request.authSession!.userId, request.body));
      } catch (error) {
        return failure(error, reply);
      }
    },
  );
  app.put<{
    Params: { id: string };
    Body: ResourceInput & { version: number };
  }>(
    '/api/v1/resources/:id',
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
          required: [...required, 'version'],
          properties: { ...fields, version },
        },
        response: { 200: row },
      },
    },
    async (request, reply) => {
      try {
        return await repo.save(
          request.authSession!.userId,
          request.body,
          request.params.id,
          request.body.version,
        );
      } catch (error) {
        return failure(error, reply);
      }
    },
  );
}
