import { createHash, randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { and, asc, eq, gt, lt, lte, inArray, sql } from 'drizzle-orm';
import { events, reservations, resourceUnits, resources } from './schema.js';
import {
  lockTenant,
  requireAdministrator,
  type Transaction,
} from './access.js';
import { appendAudit } from './audit.js';
import {
  bufferedPeriod,
  effectiveState,
  stateAfterEvent,
} from './reservation-rules.js';
export class ReservationError extends Error {}
type HoldInput = {
  requestId: string;
  eventId: string;
  unitId: string;
  eventVersion: number;
  expiresAt: string | null;
  baseStart?: string;
  baseEnd?: string;
};
const active = () =>
  sql<boolean>`reservation_is_active(${reservations.state},${reservations.expiresAt},statement_timestamp())`;
async function expireTenant(tx: Transaction, tenantId: string) {
  const expired = await tx
    .update(reservations)
    .set({ state: 'expired' })
    .where(
      and(
        eq(reservations.tenantId, tenantId),
        eq(reservations.state, 'hold'),
        lte(reservations.expiresAt, sql`clock_timestamp()`),
      ),
    )
    .returning({ id: reservations.id });
  for (const row of expired)
    await appendAudit(tx, tenantId, 'reservation.expired', null, row.id);
  return expired.length;
}
export async function expireReservations(pool: Pool) {
  const tenants = await pool.query<{ tenant_id: string }>(
    "SELECT DISTINCT tenant_id FROM reservations WHERE state='hold' AND expires_at<=clock_timestamp() ORDER BY tenant_id",
  );
  let count = 0;
  for (const row of tenants.rows)
    count += await drizzle(pool).transaction(async (tx) => {
      await lockTenant(tx, row.tenant_id);
      return expireTenant(tx, row.tenant_id);
    });
  return count;
}
export async function transitionEventReservations(
  tx: Transaction,
  tenantId: string,
  eventId: string,
  actorId: string,
  previous: string,
  next: string,
) {
  const rows = await tx
    .select()
    .from(reservations)
    .where(
      and(
        eq(reservations.tenantId, tenantId),
        eq(reservations.eventId, eventId),
        active(),
        gt(reservations.endsAt, sql`clock_timestamp()`),
      ),
    );
  let remaining = false;
  const now = new Date();
  for (const row of rows) {
    const state = stateAfterEvent(previous, next, row.state, row.endsAt, now);
    if (state !== row.state) {
      await tx
        .update(reservations)
        .set({ state })
        .where(
          and(eq(reservations.tenantId, tenantId), eq(reservations.id, row.id)),
        );
      await appendAudit(tx, tenantId, 'reservation.updated', actorId, row.id);
    }
    if (state !== 'released') remaining = true;
  }
  return remaining;
}
export function reservationRepository(pool: Pool, tenantId: string) {
  const db = drizzle(pool),
    scope = eq(reservations.tenantId, tenantId);
  return {
    async units(resourceId: string) {
      return db
        .select()
        .from(resourceUnits)
        .where(
          and(
            eq(resourceUnits.tenantId, tenantId),
            eq(resourceUnits.resourceId, resourceId),
          ),
        )
        .orderBy(asc(resourceUnits.ordinal));
    },
    async list(eventId: string) {
      const rows = await db
        .select()
        .from(reservations)
        .where(and(scope, eq(reservations.eventId, eventId)))
        .orderBy(asc(reservations.startsAt), asc(reservations.id));
      return rows.map((row) => ({
        ...row,
        effectiveState: effectiveState(row.state, row.expiresAt, new Date()),
      }));
    },
    async active(unitId: string, from: Date, to: Date) {
      bufferedPeriod(from.toISOString(), to.toISOString(), 'UTC', 0, 0);
      return db
        .select()
        .from(reservations)
        .where(
          and(
            scope,
            eq(reservations.unitId, unitId),
            active(),
            lt(reservations.startsAt, to),
            gt(reservations.endsAt, from),
          ),
        )
        .orderBy(asc(reservations.startsAt));
    },
    async createHold(actorId: string, input: HoldInput) {
      return db.transaction(async (tx) => {
        await lockTenant(tx, tenantId);
        await requireAdministrator(tx, tenantId, actorId);
        const hash = createHash('sha256')
          .update(
            JSON.stringify({
              eventId: input.eventId,
              unitId: input.unitId,
              eventVersion: input.eventVersion,
              expiresAt: input.expiresAt,
              baseStart: input.baseStart ?? null,
              baseEnd: input.baseEnd ?? null,
            }),
          )
          .digest('hex');
        const [existing] = await tx
          .select()
          .from(reservations)
          .where(and(scope, eq(reservations.requestId, input.requestId)));
        if (existing) {
          if (existing.requestHash !== hash)
            throw new ReservationError('idempotency_conflict');
          return existing;
        }
        const [event] = await tx
          .select()
          .from(events)
          .where(
            and(eq(events.tenantId, tenantId), eq(events.id, input.eventId)),
          );
        if (!event) throw new ReservationError('not_found');
        if (event.version !== input.eventVersion)
          throw new ReservationError('conflict');
        if (!['inquiry', 'option'].includes(event.status))
          throw new ReservationError('event_unavailable');
        const expiresAt =
          input.expiresAt === null ? null : new Date(input.expiresAt);
        if (
          expiresAt &&
          (!Number.isFinite(expiresAt.getTime()) || expiresAt <= new Date())
        )
          throw new ReservationError('invalid_expiry');
        const [unit] = await tx
          .select({
            enabled: resourceUnits.enabled,
            beforeDays: resources.beforeDays,
            afterDays: resources.afterDays,
            state: resources.state,
            blocked: resources.blocked,
          })
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
        if (!unit || !unit.enabled || unit.state !== 'active' || unit.blocked)
          throw new ReservationError('unit_unavailable');
        const manual =
            input.baseStart !== undefined || input.baseEnd !== undefined,
          start = manual
            ? (input.baseStart ?? null)
            : (event.startsAt?.toISOString() ?? null),
          end = manual
            ? (input.baseEnd ?? null)
            : (event.endsAt?.toISOString() ?? null);
        const period = bufferedPeriod(
          start,
          end,
          event.timeZone,
          unit.beforeDays,
          unit.afterDays,
        );
        if (period.endsAt <= new Date())
          throw new ReservationError('invalid_period');
        await expireTenant(tx, tenantId);
        const [live] = await tx
          .select({ id: reservations.id })
          .from(reservations)
          .where(
            and(
              scope,
              eq(reservations.eventId, input.eventId),
              eq(reservations.unitId, input.unitId),
              inArray(reservations.state, ['hold', 'booked']),
            ),
          );
        if (live) throw new ReservationError('reservation_exists');
        const [row] = await tx
          .insert(reservations)
          .values({
            tenantId,
            id: randomUUID(),
            requestId: input.requestId,
            requestHash: hash,
            eventId: input.eventId,
            unitId: input.unitId,
            state: 'hold',
            periodSource: manual ? 'manual' : 'event',
            baseStart: new Date(start!),
            baseEnd: new Date(end!),
            timeZone: event.timeZone,
            beforeDays: unit.beforeDays,
            afterDays: unit.afterDays,
            ...period,
            expiresAt,
          })
          .returning();
        await appendAudit(
          tx,
          tenantId,
          'reservation.created',
          actorId,
          row!.id,
        );
        return row!;
      });
    },
  };
}
