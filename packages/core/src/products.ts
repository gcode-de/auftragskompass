import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { drizzle } from 'drizzle-orm/node-postgres';
import { and, asc, eq } from 'drizzle-orm';
import {
  documentLines,
  documentTemplatePositions,
  products,
} from './schema.js';
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
// A foreign-key rejection while deleting a product can only mean that a
// document line or a template position still points at it: the delete is not
// safe. Both drizzle's wrapper and the driver error are inspected so the
// caller always receives the documented `product_in_use` answer.
function isForeignKeyViolation(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as { code?: string }).code;
  const cause = (error as { cause?: { code?: string } }).cause?.code;
  return code === '23503' || cause === '23503';
}
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
    /**
     * Deletes an unused catalogue product. A product that a draft, a final
     * document or a template still refers to is never deleted and never
     * silently detached: the caller receives `product_in_use` and archiving
     * stays the way to retire it.
     */
    async remove(actorId: string, id: string, version: number) {
      return db.transaction(async (tx) => {
        await lockTenant(tx, tenantId);
        await requireAdministrator(tx, tenantId, actorId);
        const [row] = await tx
          .select({ id: products.id, version: products.version })
          .from(products)
          .where(and(scope, eq(products.id, id)));
        if (!row) throw new ProductError('not_found');
        if (row.version !== version) throw new ProductError('conflict');
        const [line] = await tx
          .select({ id: documentLines.id })
          .from(documentLines)
          .where(
            and(
              eq(documentLines.tenantId, tenantId),
              eq(documentLines.productId, id),
            ),
          )
          .limit(1);
        const [position] = await tx
          .select({ id: documentTemplatePositions.id })
          .from(documentTemplatePositions)
          .where(
            and(
              eq(documentTemplatePositions.tenantId, tenantId),
              eq(documentTemplatePositions.productId, id),
            ),
          )
          .limit(1);
        if (line || position) throw new ProductError('product_in_use');
        try {
          await tx.delete(products).where(and(scope, eq(products.id, id)));
        } catch (error) {
          if (isForeignKeyViolation(error))
            throw new ProductError('product_in_use');
          throw error;
        }
        // PRODUCTS-DELETE-01: the removal has its own audit action (migration
        // 0064 extends the 0052 list additively).
        await appendAudit(tx, tenantId, 'product.deleted', actorId, id);
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
  // The confirmation lives in the UI; the version keeps the deletion from
  // removing a product that was edited after the row was read.
  app.delete<{ Params: { id: string }; Body: { version: number } }>(
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
          required: ['version'],
          properties: { version },
        },
      },
    },
    async (request, reply) => {
      try {
        await repo.remove(
          request.authSession!.userId,
          request.params.id,
          request.body.version,
        );
        return reply.code(204).send();
      } catch (error) {
        return failure(error, reply);
      }
    },
  );
}
