import { expireTenant } from './reservations.js';
import { createHash, randomUUID } from 'node:crypto';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { and, asc, eq, sql } from 'drizzle-orm';
import { reservations, resources, resourceUnits } from './schema.js';
import type { Transaction } from './access.js';
import { appendAudit } from './audit.js';
import { bufferedPeriod } from './reservation-rules.js';

export type ResourceAssignment = {
  unitId: string;
  periodSource: 'event' | 'manual';
  baseStart?: string;
  baseEnd?: string;
};
export type ReservableEvent = {
  id: string;
  status: string;
  startsAt: Date | null;
  endsAt: Date | null;
  timeZone: string;
};
export class ResourcePlanError extends Error {}
export async function resourcePlan(
  db: Pick<NodePgDatabase, 'select'>,
  tenantId: string,
  event: ReservableEvent,
  assignments?: ResourceAssignment[],
) {
  const now = new Date();
  const requested = new Map(
    assignments?.map((row) => [row.unitId.toLowerCase(), row]),
  );
  if (
    assignments &&
    (assignments.length > 50 || requested.size !== assignments.length)
  )
    throw new ResourcePlanError('invalid_assignments');
  const units = await db
    .select({ unit: resourceUnits, resource: resources })
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
  if (
    assignments?.some(
      (row) => !units.some(({ unit }) => unit.id === row.unitId.toLowerCase()),
    )
  )
    throw new ResourcePlanError('invalid_reference');
  const active = await db
    .select()
    .from(reservations)
    .where(
      and(
        eq(reservations.tenantId, tenantId),
        sql`reservation_is_active(${reservations.state},${reservations.expiresAt},statement_timestamp())`,
      ),
    );
  return units.map(({ unit, resource }) => {
    const old = active.find(
      (row) =>
        row.eventId === event.id &&
        row.unitId === unit.id &&
        row.endsAt > now &&
        row.state !== 'blocked',
    );
    const request = requested.get(unit.id);
    const selected = assignments ? Boolean(request) : Boolean(old);
    const periodSource = request?.periodSource ?? old?.periodSource ?? 'event';
    const baseStart =
      periodSource === 'event'
        ? (event.startsAt?.toISOString() ?? null)
        : (request?.baseStart ?? old?.baseStart.toISOString() ?? null);
    const baseEnd =
      periodSource === 'event'
        ? (event.endsAt?.toISOString() ?? null)
        : (request?.baseEnd ?? old?.baseEnd.toISOString() ?? null);
    const beforeDays = old?.beforeDays ?? resource.beforeDays,
      afterDays = old?.afterDays ?? resource.afterDays;
    let period: ReturnType<typeof bufferedPeriod> | null = null;
    let reason: string | null = null;
    try {
      period = bufferedPeriod(
        baseStart,
        baseEnd,
        event.timeZone,
        beforeDays,
        afterDays,
      );
    } catch {
      reason = 'invalid_period';
    }
    if (!unit.enabled || resource.state !== 'active' || resource.blocked)
      reason = 'unit_unavailable';
    const conflicts = period
      ? active
          .filter(
            (row) =>
              row.unitId === unit.id &&
              (row.eventId !== event.id ||
                row.state === 'blocked' ||
                row.endsAt <= now) &&
              row.startsAt < period.endsAt &&
              row.endsAt > period.startsAt,
          )
          .map((row) => ({
            id: row.id,
            eventId: row.eventId,
            state: row.state,
            startsAt: row.startsAt.toISOString(),
            endsAt: row.endsAt.toISOString(),
          }))
      : [];
    return {
      unitId: unit.id,
      resourceId: resource.id,
      name: resource.name,
      code: resource.code,
      category: resource.category,
      ordinal: unit.ordinal,
      selected,
      periodSource,
      baseStart: period ? new Date(baseStart!).toISOString() : baseStart,
      baseEnd: period ? new Date(baseEnd!).toISOString() : baseEnd,
      beforeDays,
      afterDays,
      startsAt: period?.startsAt.toISOString() ?? null,
      endsAt: period?.endsAt.toISOString() ?? null,
      reason,
      conflicts,
      available:
        reason === null &&
        !conflicts.some(
          (row) => row.state === 'booked' || row.state === 'blocked',
        ),
      old,
    };
  });
}

// Caller holds the tenant lock and checks administrator rights and event version.
export async function assignEventResources(
  tx: Transaction,
  tenantId: string,
  actorId: string,
  event: ReservableEvent,
  assignments: ResourceAssignment[],
) {
  if (['cancelled', 'unavailable'].includes(event.status) && assignments.length)
    throw new ResourcePlanError('event_unavailable');
  await expireTenant(tx, tenantId);
  const plan = await resourcePlan(tx, tenantId, event, assignments);
  const selected = plan.filter((row) => row.selected);
  if (
    event.status === 'booked' &&
    !selected.some((row) => row.category.trim().toLowerCase() === 'fotobox')
  )
    throw new ResourcePlanError('booking_required');
  for (const row of selected) {
    if (row.reason) throw new ResourcePlanError(row.reason);
    if (new Date(row.endsAt!) <= new Date())
      throw new ResourcePlanError('past_reservation');
    if (event.status === 'booked' && !row.available)
      throw new ResourcePlanError('resource_conflict');
  }
  const state = event.status === 'booked' ? 'booked' : 'hold';
  for (const row of plan) {
    const old = row.old;
    const unchanged =
      old &&
      row.selected &&
      old.state === state &&
      old.periodSource === row.periodSource &&
      old.baseStart.toISOString() === row.baseStart &&
      old.baseEnd.toISOString() === row.baseEnd;
    if (unchanged) continue;
    if (old) {
      await tx
        .update(reservations)
        .set({ state: 'released' })
        .where(
          and(eq(reservations.tenantId, tenantId), eq(reservations.id, old.id)),
        );
      await appendAudit(tx, tenantId, 'reservation.updated', actorId, old.id);
    }
  }
  for (const row of selected) {
    const old = row.old;
    if (
      old &&
      old.state === state &&
      old.periodSource === row.periodSource &&
      old.baseStart.toISOString() === row.baseStart &&
      old.baseEnd.toISOString() === row.baseEnd
    )
      continue;
    const id = randomUUID();
    await tx.insert(reservations).values({
      tenantId,
      id,
      requestId: id,
      requestHash: createHash('sha256').update(id).digest('hex'),
      eventId: event.id,
      unitId: row.unitId,
      state,
      periodSource: row.periodSource,
      baseStart: new Date(row.baseStart!),
      baseEnd: new Date(row.baseEnd!),
      timeZone: event.timeZone,
      beforeDays: row.beforeDays,
      afterDays: row.afterDays,
      startsAt: new Date(row.startsAt!),
      endsAt: new Date(row.endsAt!),
      expiresAt: state === 'hold' ? (old?.expiresAt ?? null) : null,
    });
    await appendAudit(tx, tenantId, 'reservation.created', actorId, id);
  }
}
export async function hasBookedBox(
  tx: Transaction,
  tenantId: string,
  eventId: string,
) {
  const rows = await tx
    .select({ id: reservations.id })
    .from(reservations)
    .innerJoin(
      resourceUnits,
      and(
        eq(resourceUnits.tenantId, reservations.tenantId),
        eq(resourceUnits.id, reservations.unitId),
      ),
    )
    .innerJoin(
      resources,
      and(
        eq(resources.tenantId, resourceUnits.tenantId),
        eq(resources.id, resourceUnits.resourceId),
      ),
    )
    .where(
      and(
        eq(reservations.tenantId, tenantId),
        eq(reservations.eventId, eventId),
        eq(reservations.state, 'booked'),
        sql`lower(trim(${resources.category}))='fotobox'`,
      ),
    )
    .limit(1);
  return rows.length > 0;
}
