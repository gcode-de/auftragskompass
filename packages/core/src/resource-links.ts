import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { AccessError, lockTenant, requireAdministrator } from './access.js';
import { appendAudit } from './audit.js';

// RES-BKP-04: the right-hand cards of Bookitup's resource record. Each card
// is replaced as a whole from its picker ("Zubehör hinzufügen" and so on).

type Tx = Pick<NodePgDatabase, 'execute' | 'insert'>;
export type LinkedResource = {
  id: string;
  name: string;
  kind: string;
  category: string;
};
export type ResourceLinks = {
  accessories: LinkedResource[];
  alternatives: LinkedResource[];
  components: LinkedResource[];
  inCases: LinkedResource[];
  inSets: LinkedResource[];
  products: { id: string; name: string }[];
};
const relations = {
  accessories: 'accessory',
  alternatives: 'alternative',
  components: 'component',
} as const;
type Relation = keyof typeof relations | 'products';

class LinkError extends Error {}

async function readLinks(
  tx: Tx,
  tenantId: string,
  id: string,
): Promise<ResourceLinks> {
  const own = await tx.execute<LinkedResource & { relation: string }>(sql`
    SELECT r.id, r.name, r.kind, r.category, l.relation
      FROM resource_links l
      JOIN resources r ON r.tenant_id = l.tenant_id AND r.id = l.related_id
     WHERE l.tenant_id = ${tenantId} AND l.resource_id = ${id}
     ORDER BY lower(r.name)`);
  const parents = await tx.execute<LinkedResource>(sql`
    SELECT r.id, r.name, r.kind, r.category
      FROM resource_links l
      JOIN resources r ON r.tenant_id = l.tenant_id AND r.id = l.resource_id
     WHERE l.tenant_id = ${tenantId} AND l.related_id = ${id}
       AND l.relation = 'component'
     ORDER BY lower(r.name)`);
  const products = await tx.execute<{ id: string; name: string }>(sql`
    SELECT p.id, p.name
      FROM resource_products l
      JOIN products p ON p.tenant_id = l.tenant_id AND p.id = l.product_id
     WHERE l.tenant_id = ${tenantId} AND l.resource_id = ${id}
     ORDER BY lower(p.name)`);
  const pick = (relation: string) =>
    own.rows
      .filter((row) => row.relation === relation)
      .map(({ id, name, kind, category }) => ({ id, name, kind, category }));
  return {
    accessories: pick('accessory'),
    alternatives: pick('alternative'),
    components: pick('component'),
    inCases: parents.rows.filter((row) => row.kind === 'case'),
    inSets: parents.rows.filter((row) => row.kind === 'set'),
    products: products.rows,
  };
}

export function registerResourceLinkRoutes(
  app: FastifyInstance,
  pool: Pool,
  tenantId: string,
) {
  const params = {
    type: 'object',
    required: ['id'],
    properties: { id: { type: 'string', format: 'uuid' } },
  } as const;
  app.get<{ Params: { id: string } }>(
    '/api/v1/resources/:id/links',
    { schema: { params } },
    async (request, reply) => {
      if (!request.authSession)
        return reply.code(401).send({ error: 'unauthorized' });
      const db = drizzle(pool);
      const found = await db.execute(sql`
        SELECT 1 FROM resources
         WHERE tenant_id = ${tenantId} AND id = ${request.params.id}`);
      if (!found.rows.length)
        return reply.code(404).send({ error: 'not_found' });
      return readLinks(db, tenantId, request.params.id);
    },
  );
  app.put<{
    Params: { id: string; relation: Relation };
    Body: { ids: string[] };
  }>(
    '/api/v1/resources/:id/links/:relation',
    {
      schema: {
        params: {
          type: 'object',
          required: ['id', 'relation'],
          properties: {
            id: { type: 'string', format: 'uuid' },
            relation: {
              type: 'string',
              enum: ['accessories', 'alternatives', 'components', 'products'],
            },
          },
        },
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['ids'],
          properties: {
            ids: {
              type: 'array',
              maxItems: 200,
              uniqueItems: true,
              items: { type: 'string', format: 'uuid' },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const actor = request.authSession!.userId,
        { id, relation } = request.params,
        ids = request.body.ids.filter((value) => value !== id);
      try {
        return await drizzle(pool).transaction(async (tx) => {
          await lockTenant(tx, tenantId);
          await requireAdministrator(tx, tenantId, actor);
          const { rows } = await tx.execute<{ kind: string }>(sql`
            SELECT kind FROM resources
             WHERE tenant_id = ${tenantId} AND id = ${id} FOR UPDATE`);
          if (!rows.length) throw new LinkError('not_found');
          if (relation === 'components' && rows[0]!.kind === 'item')
            throw new LinkError('not_a_collection');
          const table =
            relation === 'products' ? sql`products` : sql`resources`;
          if (ids.length) {
            const known = await tx.execute<{ n: number }>(sql`
              SELECT count(*)::int AS n FROM ${table}
               WHERE tenant_id = ${tenantId} AND id = ANY(${sql.param(ids)}::uuid[])`);
            if (known.rows[0]!.n !== ids.length)
              throw new LinkError('unknown_target');
          }
          if (relation === 'components' && ids.length) {
            // A collection cannot contain something that contains it.
            const cycle = await tx.execute(sql`
              WITH RECURSIVE inside(id) AS (
                SELECT related_id FROM resource_links
                 WHERE tenant_id = ${tenantId} AND relation = 'component'
                   AND resource_id = ANY(${sql.param(ids)}::uuid[])
                UNION
                SELECT l.related_id FROM resource_links l
                  JOIN inside ON l.resource_id = inside.id
                 WHERE l.tenant_id = ${tenantId} AND l.relation = 'component'
              ) SELECT 1 FROM inside WHERE id = ${id} LIMIT 1`);
            if (cycle.rows.length) throw new LinkError('component_cycle');
          }
          if (relation === 'products') {
            await tx.execute(sql`
              DELETE FROM resource_products
               WHERE tenant_id = ${tenantId} AND resource_id = ${id}`);
            if (ids.length)
              await tx.execute(sql`
                INSERT INTO resource_products (tenant_id, resource_id, product_id)
                SELECT ${tenantId}, ${id}, unnest(${sql.param(ids)}::uuid[])`);
          } else {
            const kind = relations[relation];
            await tx.execute(sql`
              DELETE FROM resource_links
               WHERE tenant_id = ${tenantId} AND resource_id = ${id}
                 AND relation = ${kind}`);
            if (ids.length)
              await tx.execute(sql`
                INSERT INTO resource_links (tenant_id, resource_id, related_id, relation)
                SELECT ${tenantId}, ${id}, unnest(${sql.param(ids)}::uuid[]), ${kind}`);
          }
          await appendAudit(tx, tenantId, 'resource.updated', actor, id);
          return readLinks(tx, tenantId, id);
        });
      } catch (error) {
        if (error instanceof AccessError)
          return reply.code(403).send({ error: 'forbidden' });
        if (error instanceof LinkError)
          return reply
            .code(error.message === 'not_found' ? 404 : 409)
            .send({ error: error.message });
        throw error;
      }
    },
  );
}
