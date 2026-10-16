import { createHash, randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { drizzle } from 'drizzle-orm/node-postgres';
import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import { reservations, resourceUnits, resources, tenants } from './schema.js';
import { AccessError, lockTenant, requireAdministrator } from './access.js';
import { appendAudit } from './audit.js';
import { bufferedPeriod } from './reservation-rules.js';
type BlockInput = {
  requestId: string;
  unitId: string;
  startsAt: string;
  endsAt: string;
  reason: string;
};
class BlockError extends Error {}
function view(row: typeof reservations.$inferSelect) {
  return {
    id: row.id,
    unitId: row.unitId,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    timeZone: row.timeZone,
    state: row.state,
    reason: row.blockReason,
  };
}
export function resourceBlockRepository(pool: Pool, tenantId: string) {
  const db = drizzle(pool),
    scope = eq(reservations.tenantId, tenantId);
  return {
    async overview() {
      const [tenant] = await db
        .select()
        .from(tenants)
        .where(eq(tenants.id, tenantId));
      const units = await db
        .select({
          id: resourceUnits.id,
          name: resources.name,
          code: resources.code,
          ordinal: resourceUnits.ordinal,
          enabled: resourceUnits.enabled,
          state: resources.state,
        })
        .from(resourceUnits)
        .innerJoin(
          resources,
          and(
            eq(resources.tenantId, resourceUnits.tenantId),
            eq(resources.id, resourceUnits.resourceId),
          ),
        )
        .where(eq(resourceUnits.tenantId, tenantId))
        .orderBy(
          asc(resources.position),
          asc(resources.code),
          asc(resourceUnits.ordinal),
        );
      const rows = await db
        .select()
        .from(reservations)
        .where(and(scope, isNull(reservations.eventId)))
        .orderBy(desc(reservations.startsAt), asc(reservations.id));
      return { timeZone: tenant!.timezone, units, blocks: rows.map(view) };
    },
    async create(actorId: string, input: BlockInput) {
      return db
        .transaction(async (tx) => {
          await lockTenant(tx, tenantId);
          await requireAdministrator(tx, tenantId, actorId);
          let period: ReturnType<typeof bufferedPeriod>;
          try {
            period = bufferedPeriod(input.startsAt, input.endsAt, 'UTC', 0, 0);
          } catch {
            throw new BlockError('invalid_period');
          }
          const reason = input.reason.trim();
          if (!reason || reason.length > 200)
            throw new BlockError('invalid_reason');
          const hash = createHash('sha256')
            .update(
              JSON.stringify({
                unitId: input.unitId.toLowerCase(),
                startsAt: period.startsAt.toISOString(),
                endsAt: period.endsAt.toISOString(),
                reason,
              }),
            )
            .digest('hex');
          const [existing] = await tx
            .select()
            .from(reservations)
            .where(and(scope, eq(reservations.requestId, input.requestId)));
          if (existing) {
            if (existing.requestHash !== hash || existing.eventId !== null)
              throw new BlockError('idempotency_conflict');
            return view(existing);
          }
          if (period.endsAt <= new Date())
            throw new BlockError('invalid_period');
          const [unit] = await tx
            .select({ enabled: resourceUnits.enabled, state: resources.state })
            .from(resourceUnits)
            .innerJoin(
              resources,
              and(
                eq(resources.tenantId, resourceUnits.tenantId),
                eq(resources.id, resourceUnits.resourceId),
              ),
            )
            .where(
              and(
                eq(resourceUnits.tenantId, tenantId),
                eq(resourceUnits.id, input.unitId),
              ),
            );
          if (!unit?.enabled || unit.state !== 'active')
            throw new BlockError('unit_unavailable');
          const [tenant] = await tx
            .select()
            .from(tenants)
            .where(eq(tenants.id, tenantId));
          const [row] = await tx
            .insert(reservations)
            .values({
              tenantId,
              id: randomUUID(),
              requestId: input.requestId,
              requestHash: hash,
              blockReason: reason,
              eventId: null,
              unitId: input.unitId,
              state: 'blocked',
              periodSource: 'manual',
              baseStart: period.startsAt,
              baseEnd: period.endsAt,
              timeZone: tenant!.timezone,
              beforeDays: 0,
              afterDays: 0,
              ...period,
              expiresAt: null,
            })
            .returning();
          await appendAudit(
            tx,
            tenantId,
            'reservation.created',
            actorId,
            row!.id,
          );
          return view(row!);
        })
        .catch((error: unknown) => {
          if (
            error instanceof Error &&
            ((error.cause ?? error) as { code?: string }).code === '23P01'
          )
            throw new BlockError('resource_conflict');
          throw error;
        });
    },
    async release(actorId: string, id: string) {
      return db.transaction(async (tx) => {
        await lockTenant(tx, tenantId);
        await requireAdministrator(tx, tenantId, actorId);
        const [old] = await tx
          .select()
          .from(reservations)
          .where(
            and(scope, eq(reservations.id, id), isNull(reservations.eventId)),
          );
        if (!old) throw new BlockError('not_found');
        if (old.state === 'released') return view(old);
        const [row] = await tx
          .update(reservations)
          .set({ state: 'released' })
          .where(and(scope, eq(reservations.id, id)))
          .returning();
        await appendAudit(tx, tenantId, 'reservation.updated', actorId, id);
        return view(row!);
      });
    },
  };
}
export function registerResourceBlockRoutes(
  app: FastifyInstance,
  pool: Pool,
  tenantId: string,
) {
  const repo = resourceBlockRepository(pool, tenantId),
    uuid = { type: 'string', format: 'uuid' },
    dateTime = { type: 'string', format: 'date-time' };
  const fields = {
    unitId: uuid,
    startsAt: dateTime,
    endsAt: dateTime,
    reason: { type: 'string', minLength: 1, maxLength: 200, pattern: '\\S' },
  };
  const row = {
    type: 'object',
    additionalProperties: false,
    required: [...Object.keys(fields), 'id', 'timeZone', 'state'],
    properties: {
      ...fields,
      id: uuid,
      timeZone: { type: 'string' },
      state: { type: 'string', enum: ['blocked', 'released'] },
      reason: { type: 'string', maxLength: 200 },
    },
  };
  function failure(error: unknown, reply: FastifyReply) {
    if (error instanceof AccessError)
      return reply.code(403).send({ error: 'forbidden' });
    if (error instanceof BlockError)
      return reply
        .code(
          error.message === 'not_found'
            ? 404
            : [
                  'resource_conflict',
                  'idempotency_conflict',
                  'unit_unavailable',
                ].includes(error.message)
              ? 409
              : 400,
        )
        .send({ error: error.message });
    throw error;
  }
  const unitRow = {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'name', 'code', 'ordinal', 'enabled', 'state'],
    properties: {
      id: uuid,
      name: { type: 'string' },
      code: { type: 'string' },
      ordinal: { type: 'integer' },
      enabled: { type: 'boolean' },
      state: { type: 'string', enum: ['active', 'inactive', 'archived'] },
    },
  };
  app.get(
    '/api/v1/resource-blocks',
    {
      schema: {
        response: {
          200: {
            type: 'object',
            additionalProperties: false,
            required: ['timeZone', 'units', 'blocks'],
            properties: {
              timeZone: { type: 'string' },
              blocks: { type: 'array', items: row },
              units: { type: 'array', items: unitRow },
            },
          },
        },
      },
    },
    () => repo.overview(),
  );
  app.post<{ Body: BlockInput }>(
    '/api/v1/resource-blocks',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: [...Object.keys(fields), 'requestId'],
          properties: { ...fields, requestId: uuid },
        },
        response: { 201: row },
      },
    },
    async (request, reply) => {
      try {
        return reply
          .code(201)
          .send(await repo.create(request.authSession!.userId, request.body));
      } catch (error) {
        return failure(error, reply);
      }
    },
  );
  app.post<{ Params: { id: string } }>(
    '/api/v1/resource-blocks/:id/release',
    {
      schema: {
        params: { type: 'object', required: ['id'], properties: { id: uuid } },
        response: { 200: row },
      },
    },
    async (request, reply) => {
      try {
        return await repo.release(
          request.authSession!.userId,
          request.params.id,
        );
      } catch (error) {
        return failure(error, reply);
      }
    },
  );
}
