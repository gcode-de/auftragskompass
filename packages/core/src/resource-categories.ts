import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool } from 'pg';
import { sql } from 'drizzle-orm';
import { AccessError, lockTenant, requireAdministrator } from './access.js';
import { appendAudit } from './audit.js';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';

type Tx = Pick<NodePgDatabase, 'execute' | 'insert'>;

// RES-BKP-01: Bookitup's settings page for resources - the managed category
// list (optionally nested) and the switch that hides the resources entry in
// the main navigation. A resource keeps its category as text; renaming a
// category renames it on its resources in the same transaction, and a
// category in use or with sub-categories cannot be deleted.

export type ResourceCategory = {
  id: string;
  name: string;
  parentId: string | null;
  version: number;
  usage: number;
};

class CategoryError extends Error {}

const uuid = { type: 'string', format: 'uuid' } as const;
const categoryBody = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'parentId'],
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 120, pattern: '\\S' },
    parentId: { anyOf: [uuid, { type: 'null' }] },
  },
} as const;

async function listCategories(
  tx: Tx,
  tenantId: string,
): Promise<ResourceCategory[]> {
  const { rows } = await tx.execute<{
    id: string;
    name: string;
    parent_id: string | null;
    version: number;
    usage: number;
  }>(sql`
    SELECT c.id, c.name, c.parent_id, c.version,
      (SELECT count(*)::int FROM resources r
        WHERE r.tenant_id = c.tenant_id
          AND lower(trim(r.category)) = lower(c.name)) AS usage
    FROM resource_categories c
    WHERE c.tenant_id = ${tenantId}
    ORDER BY lower(c.name)`);
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    parentId: row.parent_id,
    version: row.version,
    usage: row.usage,
  }));
}

/** A parent must exist and must not be the category itself or below it. */
async function checkParent(
  tx: Tx,
  tenantId: string,
  parentId: string | null,
  id?: string,
) {
  if (!parentId) return;
  const { rows } = await tx.execute<{ id: string }>(sql`
    WITH RECURSIVE chain(id, parent_id) AS (
      SELECT id, parent_id FROM resource_categories
       WHERE tenant_id = ${tenantId} AND id = ${parentId}
      UNION ALL
      SELECT c.id, c.parent_id FROM resource_categories c
        JOIN chain ON c.id = chain.parent_id
       WHERE c.tenant_id = ${tenantId}
    ) SELECT id FROM chain`);
  if (!rows.length) throw new CategoryError('parent_not_found');
  if (id && rows.some((row) => row.id === id))
    throw new CategoryError('parent_cycle');
}

export function registerResourceCategoryRoutes(
  app: FastifyInstance,
  pool: Pool,
  tenantId: string,
) {
  function failure(error: unknown, reply: FastifyReply) {
    if (error instanceof AccessError)
      return reply.code(403).send({ error: 'forbidden' });
    if (error instanceof CategoryError)
      return reply
        .code(
          error.message === 'not_found'
            ? 404
            : error.message.startsWith('parent')
              ? 400
              : 409,
        )
        .send({ error: error.message });
    if ((error as { cause?: { code?: string } }).cause?.code === '23505')
      return reply.code(409).send({ error: 'name_exists' });
    throw error;
  }
  async function admin<T>(actorId: string, work: (tx: Tx) => Promise<T>) {
    return drizzle(pool).transaction(async (tx) => {
      await lockTenant(tx, tenantId);
      await requireAdministrator(tx, tenantId, actorId);
      return work(tx);
    });
  }

  app.get('/api/v1/resource-categories', async (request, reply) => {
    if (!request.authSession)
      return reply.code(401).send({ error: 'unauthorized' });
    return drizzle(pool).transaction((tx) => listCategories(tx, tenantId));
  });

  app.post<{ Body: { name: string; parentId: string | null } }>(
    '/api/v1/resource-categories',
    { schema: { body: categoryBody } },
    async (request, reply) => {
      const actor = request.authSession!.userId;
      try {
        const created = await admin(actor, async (tx) => {
          await checkParent(tx, tenantId, request.body.parentId);
          const { rows } = await tx.execute<{ id: string }>(sql`
            INSERT INTO resource_categories (tenant_id, name, parent_id)
            VALUES (${tenantId}, ${request.body.name.trim()},
                    ${request.body.parentId})
            RETURNING id`);
          await appendAudit(
            tx,
            tenantId,
            'resource_category.created',
            actor,
            rows[0]!.id,
          );
          return (await listCategories(tx, tenantId)).find(
            (row) => row.id === rows[0]!.id,
          )!;
        });
        return reply.code(201).send(created);
      } catch (error) {
        return failure(error, reply);
      }
    },
  );

  app.put<{
    Params: { id: string };
    Body: { name: string; parentId: string | null; version: number };
  }>(
    '/api/v1/resource-categories/:id',
    {
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: uuid },
        },
        body: {
          ...categoryBody,
          required: [...categoryBody.required, 'version'],
          properties: {
            ...categoryBody.properties,
            version: { type: 'integer', minimum: 1 },
          },
        },
      },
    },
    async (request, reply) => {
      const actor = request.authSession!.userId,
        { id } = request.params,
        name = request.body.name.trim();
      try {
        return await admin(actor, async (tx) => {
          const { rows } = await tx.execute<{ name: string; version: number }>(
            sql`SELECT name, version FROM resource_categories
                 WHERE tenant_id = ${tenantId} AND id = ${id} FOR UPDATE`,
          );
          const old = rows[0];
          if (!old) throw new CategoryError('not_found');
          if (old.version !== request.body.version)
            throw new CategoryError('conflict');
          await checkParent(tx, tenantId, request.body.parentId, id);
          await tx.execute(sql`
            UPDATE resource_categories
               SET name = ${name}, parent_id = ${request.body.parentId},
                   version = version + 1
             WHERE tenant_id = ${tenantId} AND id = ${id}`);
          // The resources follow the new name; their trigger finds it known.
          if (old.name !== name)
            await tx.execute(sql`
              UPDATE resources SET category = ${name}, version = version + 1
               WHERE tenant_id = ${tenantId}
                 AND lower(trim(category)) = lower(${old.name})`);
          await appendAudit(
            tx,
            tenantId,
            'resource_category.updated',
            actor,
            id,
          );
          return (await listCategories(tx, tenantId)).find(
            (row) => row.id === id,
          )!;
        });
      } catch (error) {
        return failure(error, reply);
      }
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/v1/resource-categories/:id',
    {
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: uuid },
        },
      },
    },
    async (request, reply) => {
      const actor = request.authSession!.userId,
        { id } = request.params;
      try {
        await admin(actor, async (tx) => {
          const row = (await listCategories(tx, tenantId)).find(
            (entry) => entry.id === id,
          );
          if (!row) throw new CategoryError('not_found');
          if (row.usage > 0) throw new CategoryError('category_in_use');
          const { rows } = await tx.execute<{ id: string }>(sql`
            SELECT id FROM resource_categories
             WHERE tenant_id = ${tenantId} AND parent_id = ${id} LIMIT 1`);
          if (rows.length) throw new CategoryError('category_has_children');
          await tx.execute(sql`
            DELETE FROM resource_categories
             WHERE tenant_id = ${tenantId} AND id = ${id}`);
          await appendAudit(
            tx,
            tenantId,
            'resource_category.deleted',
            actor,
            id,
          );
        });
        return reply.code(204).send();
      } catch (error) {
        return failure(error, reply);
      }
    },
  );

  // Every signed-in user reads the switch: the navigation follows it.
  app.get('/api/v1/settings/resources', async (request, reply) => {
    if (!request.authSession)
      return reply.code(401).send({ error: 'unauthorized' });
    const { rows } = await drizzle(pool).execute<{
      hide_navigation: boolean;
    }>(sql`SELECT hide_navigation FROM resource_settings
            WHERE tenant_id = ${tenantId}`);
    return { hideNavigation: rows[0]?.hide_navigation ?? false };
  });

  app.put<{ Body: { hideNavigation: boolean } }>(
    '/api/v1/settings/resources',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['hideNavigation'],
          properties: { hideNavigation: { type: 'boolean' } },
        },
      },
    },
    async (request, reply) => {
      const actor = request.authSession!.userId;
      try {
        await admin(actor, async (tx) => {
          await tx.execute(sql`
            INSERT INTO resource_settings (tenant_id, hide_navigation)
            VALUES (${tenantId}, ${request.body.hideNavigation})
            ON CONFLICT (tenant_id) DO UPDATE
              SET hide_navigation = EXCLUDED.hide_navigation,
                  updated_at = now()`);
          await appendAudit(tx, tenantId, 'resource_settings.updated', actor);
        });
        return { hideNavigation: request.body.hideNavigation };
      } catch (error) {
        return failure(error, reply);
      }
    },
  );
}
