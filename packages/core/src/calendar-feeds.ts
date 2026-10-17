import { randomBytes, randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { FastifyInstance } from 'fastify';
import { drizzle } from 'drizzle-orm/node-postgres';
import { and, eq, gt, sql } from 'drizzle-orm';
import { calendarFeeds, resources } from './schema.js';
import { AccessError, lockTenant, requireAdministrator } from './access.js';
import { appendAudit } from './audit.js';
import { digest } from './auth.js';
import { renderIcs, type IcsOptions, type IcsEvent } from './ics.js';
export type FeedInput = IcsOptions & { resourceId: string | null };
const metadata = {
  id: calendarFeeds.id,
  resourceId: calendarFeeds.resourceId,
  description: calendarFeeds.description,
  eventType: calendarFeeds.eventType,
  internalLink: calendarFeeds.internalLink,
  createdAt: calendarFeeds.createdAt,
  expiresAt: calendarFeeds.expiresAt,
};
export function calendarFeedRepository(
  pool: Pool,
  tenantId: string,
  origin: string,
) {
  const db = drizzle(pool),
    scoped = eq(calendarFeeds.tenantId, tenantId);
  return {
    async list() {
      return db
        .select(metadata)
        .from(calendarFeeds)
        .where(and(scoped, gt(calendarFeeds.expiresAt, sql`now()`)))
        .orderBy(calendarFeeds.createdAt);
    },
    async save(actorId: string, input: FeedInput, id?: string) {
      return db.transaction(async (tx) => {
        await lockTenant(tx, tenantId);
        await requireAdministrator(tx, tenantId, actorId);
        if (input.resourceId) {
          const [resource] = await tx
            .select()
            .from(resources)
            .where(
              and(
                eq(resources.tenantId, tenantId),
                eq(resources.id, input.resourceId),
              ),
            );
          if (!resource) throw new AccessError('not_found');
        }
        const token = randomBytes(32).toString('base64url'),
          values = {
            ...input,
            tokenHash: digest(token),
            expiresAt: sql`now()+interval '1 year'`,
          };
        const [row] = id
          ? await tx
              .update(calendarFeeds)
              .set(values)
              .where(and(scoped, eq(calendarFeeds.id, id)))
              .returning(metadata)
          : await tx
              .insert(calendarFeeds)
              .values({
                ...values,
                tenantId,
                id: randomUUID(),
                ownerId: actorId,
              })
              .returning(metadata);
        if (!row) throw new AccessError('not_found');
        await appendAudit(
          tx,
          tenantId,
          id ? 'feed.rotated' : 'feed.created',
          actorId,
          row.id,
        );
        return { ...row, url: origin + '/feeds/v1/' + token + '.ics' };
      });
    },
    async revoke(actorId: string, id: string) {
      return db.transaction(async (tx) => {
        await lockTenant(tx, tenantId);
        await requireAdministrator(tx, tenantId, actorId);
        const [row] = await tx
          .delete(calendarFeeds)
          .where(and(scoped, eq(calendarFeeds.id, id)))
          .returning({ id: calendarFeeds.id });
        if (!row) throw new AccessError('not_found');
        await appendAudit(tx, tenantId, 'feed.revoked', actorId, id);
      });
    },
    async read(token: string) {
      if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
      return db.transaction(
        async (tx) => {
          const result = await tx.execute<FeedInput & Record<string, unknown>>(
            sql`SELECT f.resource_id AS "resourceId", f.description,
              f.event_type AS "eventType", f.internal_link AS "internalLink"
            FROM calendar_feeds f
            JOIN memberships m ON m.tenant_id=f.tenant_id AND m.user_id=f.owner_id AND m.active
            JOIN allowed_accounts a ON a.tenant_id=f.tenant_id AND a.user_id=f.owner_id AND a.active
            WHERE f.tenant_id=${tenantId} AND f.token_hash=${digest(token)} AND f.expires_at>now()`,
          );
          const feed = result.rows[0];
          if (!feed) return null;
          const events = await tx.execute<
            Omit<IcsEvent, 'startsAt' | 'endsAt'> & {
              startsAt: string | null;
              endsAt: string | null;
            } & Record<string, unknown>
          >(
            sql`SELECT e.id, e.name, e.status, e.event_date AS "eventDate",
              e.starts_at AS "startsAt", e.ends_at AS "endsAt", e.description, t.name AS "eventType",
              concat_ws(', ',NULLIF(l.name,''),NULLIF(l.street,''),
                NULLIF(concat_ws(' ',NULLIF(l.postal_code,''),NULLIF(l.city,'')),''),
                NULLIF(l.country,'')) AS location,
              COALESCE((
                SELECT array_agg(DISTINCT r.code||' #'||u.ordinal ORDER BY r.code||' #'||u.ordinal)
                FROM reservations s
                JOIN resource_units u ON u.tenant_id=s.tenant_id AND u.id=s.unit_id
                JOIN resources r ON r.tenant_id=u.tenant_id AND r.id=u.resource_id
                WHERE s.tenant_id=e.tenant_id AND s.event_id=e.id
                  AND (reservation_is_active(s.state,s.expires_at,statement_timestamp())
                    OR e.status IN ('cancelled','unavailable'))
              ),ARRAY[]::text[]) AS resources
            FROM events e
            LEFT JOIN locations l ON l.tenant_id=e.tenant_id AND l.id=e.location_id
            LEFT JOIN master_data t ON t.tenant_id=e.tenant_id AND t.id=e.event_type_id
            WHERE e.tenant_id=${tenantId} AND e.event_date IS NOT NULL
              AND (${feed.resourceId}::uuid IS NULL OR EXISTS(
                SELECT 1 FROM reservations s
                JOIN resource_units u ON u.tenant_id=s.tenant_id AND u.id=s.unit_id
                WHERE s.tenant_id=e.tenant_id AND s.event_id=e.id AND u.resource_id=${feed.resourceId}::uuid
                  AND (reservation_is_active(s.state,s.expires_at,statement_timestamp())
                    OR e.status IN ('cancelled','unavailable'))
              ))
            ORDER BY e.event_date,e.id`,
          );
          const revision = await tx.execute<
            { revision: number; changed_at: string } & Record<string, unknown>
          >(
            sql`SELECT revision,changed_at FROM calendar_revisions WHERE tenant_id=${tenantId}`,
          );
          const state = revision.rows[0];
          return renderIcs(
            tenantId,
            events.rows.map((row) => ({
              ...row,
              startsAt: row.startsAt ? new Date(row.startsAt) : null,
              endsAt: row.endsAt ? new Date(row.endsAt) : null,
            })),
            state?.revision ?? 1,
            state ? new Date(state.changed_at) : new Date(0),
            feed,
            origin,
          );
        },
        { isolationLevel: 'repeatable read', accessMode: 'read only' },
      );
    },
  };
}
const inputSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['resourceId', 'description', 'eventType', 'internalLink'],
  properties: {
    resourceId: {
      anyOf: [{ type: 'string', format: 'uuid' }, { type: 'null' }],
    },
    description: { type: 'boolean' },
    eventType: { type: 'boolean' },
    internalLink: { type: 'boolean' },
  },
};
const paramsSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id'],
  properties: { id: { type: 'string', format: 'uuid' } },
};
const rowSchema = {
  ...inputSchema,
  required: [
    'id',
    'resourceId',
    'description',
    'eventType',
    'internalLink',
    'createdAt',
    'expiresAt',
  ],
  properties: {
    ...inputSchema.properties,
    id: { type: 'string', format: 'uuid' },
    createdAt: { type: 'string', format: 'date-time' },
    expiresAt: { type: 'string', format: 'date-time' },
  },
};
export function registerCalendarFeedRoutes(
  app: FastifyInstance,
  pool: Pool,
  tenantId: string,
  origin: string,
) {
  const repo = calendarFeedRepository(pool, tenantId, origin);
  app.get(
    '/api/v1/calendar-feeds',
    { schema: { response: { 200: { type: 'array', items: rowSchema } } } },
    () => repo.list(),
  );
  async function mutation(
    action: () => Promise<unknown>,
    reply: import('fastify').FastifyReply,
    code: number,
  ) {
    try {
      return reply.code(code).send(await action());
    } catch (error) {
      if (!(error instanceof AccessError)) throw error;
      return reply
        .code(error.message === 'forbidden' ? 403 : 404)
        .send({ error: error.message });
    }
  }
  const response = {
    ...rowSchema,
    required: [...rowSchema.required, 'url'],
    properties: {
      ...rowSchema.properties,
      url: { type: 'string', format: 'uri' },
    },
  };
  app.post<{ Body: FeedInput }>(
    '/api/v1/calendar-feeds',
    {
      bodyLimit: 2048,
      schema: { body: inputSchema, response: { 201: response } },
    },
    (r, p) => mutation(() => repo.save(r.authSession!.userId, r.body), p, 201),
  );
  app.put<{ Body: FeedInput; Params: { id: string } }>(
    '/api/v1/calendar-feeds/:id',
    {
      bodyLimit: 2048,
      schema: {
        body: inputSchema,
        params: paramsSchema,
        response: { 200: response },
      },
    },
    (r, p) =>
      mutation(
        () => repo.save(r.authSession!.userId, r.body, r.params.id),
        p,
        200,
      ),
  );
  app.delete<{ Params: { id: string } }>(
    '/api/v1/calendar-feeds/:id',
    { schema: { params: paramsSchema } },
    (r, p) =>
      mutation(() => repo.revoke(r.authSession!.userId, r.params.id), p, 204),
  );
  app.get<{ Params: { token: string } }>(
    '/feeds/v1/:token.ics',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (r, p) => {
      p.header('Cache-Control', 'no-store')
        .header('Referrer-Policy', 'no-referrer')
        .header('X-Content-Type-Options', 'nosniff')
        .header('X-Robots-Tag', 'noindex, nofollow');
      if (r.headers['x-forwarded-proto'] !== 'https')
        return p.code(403).send({ error: 'https_required' });
      const feed = await repo.read(r.params.token);
      if (feed === null) return p.code(404).send({ error: 'not_found' });
      return p.type('text/calendar; charset=utf-8').send(feed);
    },
  );
}
