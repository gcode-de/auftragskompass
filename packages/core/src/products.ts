import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { drizzle } from 'drizzle-orm/node-postgres';
import { and, asc, eq } from 'drizzle-orm';
import { products } from './schema.js';
import { AccessError, lockTenant, requireAdministrator } from './access.js';
import { appendAudit } from './audit.js';
import { csv } from './contacts.js';
export type ProductInput = {
  name: string;
  description: string;
  unit: string;
  priceMinor: number;
  priceBasis: 'net' | 'gross';
  taxBasisPoints: number;
  state: 'active' | 'inactive' | 'archived';
  position: number;
};
class ProductError extends Error {}
export function productRepository(pool: Pool, tenantId: string) {
  const db = drizzle(pool),
    scope = eq(products.tenantId, tenantId);
  return {
    async list() {
      return db
        .select()
        .from(products)
        .where(scope)
        .orderBy(asc(products.position), asc(products.name));
    },
    async save(
      actorId: string,
      input: ProductInput,
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
            .from(products)
            .where(and(scope, eq(products.id, id)));
          if (!old) throw new ProductError('not_found');
          if (old.version !== version) throw new ProductError('conflict');
          previous = old.version;
        }
        const values = {
          ...input,
          name: input.name.trim(),
          unit: input.unit.trim(),
          version: previous + 1,
        };
        const [row] = id
          ? await tx
              .update(products)
              .set(values)
              .where(and(scope, eq(products.id, id)))
              .returning()
          : await tx
              .insert(products)
              .values({ ...values, tenantId, id: randomUUID() })
              .returning();
        await appendAudit(
          tx,
          tenantId,
          id ? 'product.updated' : 'product.created',
          actorId,
          row!.id,
        );
        return row!;
      });
    },
  };
}
export function registerProductRoutes(
  app: FastifyInstance,
  pool: Pool,
  tenantId: string,
) {
  const repo = productRepository(pool, tenantId);
  const fields = {
    name: { type: 'string', minLength: 1, maxLength: 120, pattern: '\\S' },
    description: { type: 'string', maxLength: 2000 },
    unit: { type: 'string', minLength: 1, maxLength: 40, pattern: '\\S' },
    priceMinor: {
      type: 'integer',
      minimum: 0,
      maximum: Number.MAX_SAFE_INTEGER,
    },
    priceBasis: { type: 'string', enum: ['net', 'gross'] },
    taxBasisPoints: { type: 'integer', minimum: 0, maximum: 10000 },
    state: { type: 'string', enum: ['active', 'inactive', 'archived'] },
    position: { type: 'integer', minimum: 0, maximum: 9999 },
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
    if (error instanceof ProductError)
      return reply
        .code(error.message === 'not_found' ? 404 : 409)
        .send({ error: error.message });
    throw error;
  }
  app.get(
    '/api/v1/products',
    { schema: { response: { 200: { type: 'array', items: row } } } },
    () => repo.list(),
  );
  app.get('/api/v1/products/export.csv', async (_request, reply) => {
    const rows = await repo.list();
    const columns = [
      'id',
      'version',
      'name',
      'description',
      'unit',
      'priceMinor',
      'priceBasis',
      'taxBasisPoints',
      'state',
      'position',
    ] as const;
    return reply
      .type('text/csv; charset=utf-8')
      .header('content-disposition', 'attachment; filename="products.csv"')
      .header('cache-control', 'no-store')
      .send(
        csv([
          columns.slice(),
          ...rows.map((row) => columns.map((key) => String(row[key]))),
        ]),
      );
  });
  app.post<{ Body: ProductInput }>(
    '/api/v1/products',
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
    Body: ProductInput & { version: number };
  }>(
    '/api/v1/products/:id',
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
