import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { drizzle } from 'drizzle-orm/node-postgres';
import { and, asc, eq, or, ilike } from 'drizzle-orm';
import { locations } from './schema.js';
import { AccessError, lockTenant, requireAdministrator } from './access.js';
import { appendAudit } from './audit.js';
export type LocationInput = {
  name: string;
  street: string;
  postalCode: string;
  city: string;
  country: string;
  state: 'active' | 'archived';
};
class LocationError extends Error {}
export function locationRepository(pool: Pool, tenantId: string) {
  const db = drizzle(pool),
    scope = eq(locations.tenantId, tenantId);
  return {
    async list(search = '') {
      const pattern = '%' + search.replace(/[\\%_]/g, '\\$&') + '%';
      return db
        .select()
        .from(locations)
        .where(
          and(
            scope,
            search
              ? or(
                  ...[
                    locations.name,
                    locations.street,
                    locations.postalCode,
                    locations.city,
                  ].map((field) => ilike(field, pattern)),
                )
              : undefined,
          ),
        )
        .orderBy(asc(locations.name), asc(locations.id));
    },
    async save(
      actorId: string,
      input: LocationInput,
      id?: string,
      version?: number,
    ) {
      return db.transaction(async (tx) => {
        await lockTenant(tx, tenantId);
        await requireAdministrator(tx, tenantId, actorId);
        let previous = 0;
        if (id) {
          const [old] = await tx
            .select()
            .from(locations)
            .where(and(scope, eq(locations.id, id)));
          if (!old) throw new LocationError('not_found');
          if (old.version !== version) throw new LocationError('conflict');
          previous = old.version;
        }
        const values = {
          ...input,
          name: input.name.trim(),

          version: previous + 1,
        };
        const [row] = id
          ? await tx
              .update(locations)
              .set(values)
              .where(and(scope, eq(locations.id, id)))
              .returning()
          : await tx
              .insert(locations)
              .values({ ...values, tenantId, id: randomUUID() })
              .returning();
        await appendAudit(
          tx,
          tenantId,
          id ? 'location.updated' : 'location.created',
          actorId,
          row!.id,
        );
        return row!;
      });
    },
  };
}
export function registerLocationRoutes(
  app: FastifyInstance,
  pool: Pool,
  tenantId: string,
) {
  const repo = locationRepository(pool, tenantId);
  const fields = {
    name: { type: 'string', minLength: 1, maxLength: 200, pattern: '\\S' },
    street: { type: 'string', maxLength: 200 },
    postalCode: { type: 'string', maxLength: 20 },
    city: { type: 'string', maxLength: 120 },
    country: { type: 'string', pattern: '^[A-Z]{2}$' },
    state: { type: 'string', enum: ['active', 'archived'] },
  };
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
    if (error instanceof LocationError)
      return reply
        .code(error.message === 'not_found' ? 404 : 409)
        .send({ error: error.message });
    throw error;
  }
  app.get(
    '/api/v1/locations',
    {
      schema: {
        querystring: {
          type: 'object',
          properties: { q: { type: 'string', maxLength: 200 } },
        },
        response: { 200: { type: 'array', items: row } },
      },
    },
    (request) => repo.list((request.query as { q?: string }).q),
  );
  app.post<{ Body: LocationInput }>(
    '/api/v1/locations',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: Object.keys(fields),
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
    Body: LocationInput & { version: number };
  }>(
    '/api/v1/locations/:id',
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
          required: [...Object.keys(fields), 'version'],
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
