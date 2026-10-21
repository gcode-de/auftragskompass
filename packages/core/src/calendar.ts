import { Temporal } from '@js-temporal/polyfill';
import type { Pool } from 'pg';
import type { FastifyInstance } from 'fastify';
import { drizzle } from 'drizzle-orm/node-postgres';
import { effectiveVenue } from './venue.js';
import { and, asc, eq, gte, lte, lt, gt, sql, isNull } from 'drizzle-orm';
import {
  tenants,
  importPromises,
  events,
  masterData,
  contacts,
  eventContacts,
  locations,
  reservations,
  resourceUnits,
  resources,
} from './schema.js';
type View = 'day' | 'week' | 'month';
export function calendarWindow(date: string, view: View, timeZone: string) {
  try {
    const anchor = Temporal.PlainDate.from(date);
    if (anchor.year < 1 || anchor.year > 9999) throw Error();
    const first =
      view === 'day'
        ? anchor
        : view === 'week'
          ? anchor.subtract({ days: anchor.dayOfWeek - 1 })
          : anchor.with({ day: 1 });
    const last =
      view === 'day'
        ? first
        : view === 'week'
          ? first.add({ days: 6 })
          : first.add({ months: 1 }).subtract({ days: 1 });
    if (first.year < 1 || last.year > 9999) throw Error();
    const shift =
      view === 'day'
        ? { days: 1 }
        : view === 'week'
          ? { days: 7 }
          : { months: 1 };
    const previous = anchor.subtract(shift),
      next = anchor.add(shift);
    const days = [];
    for (
      let day = first;
      Temporal.PlainDate.compare(day, last) <= 0;
      day = day.add({ days: 1 })
    )
      days.push({
        date: day.toString(),
        startsAt: day.toZonedDateTime(timeZone).toInstant().toString(),
        endsAt: day
          .add({ days: 1 })
          .toZonedDateTime(timeZone)
          .toInstant()
          .toString(),
      });
    return {
      date: anchor.toString(),
      view,
      timeZone,
      from: first.toString(),
      to: last.toString(),
      previousDate: previous.year >= 1 ? previous.toString() : null,
      nextDate: next.year <= 9999 ? next.toString() : null,
      days,
    };
  } catch {
    throw Error('invalid_calendar_period');
  }
}
export function calendarRepository(pool: Pool, tenantId: string) {
  return {
    async read(date: string | undefined, view: View) {
      return drizzle(pool).transaction(
        async (tx) => {
          const [tenant] = await tx
            .select()
            .from(tenants)
            .where(eq(tenants.id, tenantId));
          const window = calendarWindow(
            date ?? Temporal.Now.plainDateISO(tenant!.timezone).toString(),
            view,
            tenant!.timezone,
          );
          const rows = await tx
            .select({
              id: events.id,
              name: events.name,
              status: events.status,
              eventDate: events.eventDate,
              startsAt: events.startsAt,
              endsAt: events.endsAt,
              eventType: masterData.name,
              contact: contacts.name,
              legacyLocation: locations.name,
              venue: events.venue,
              venueOverride: events.venueOverride,
            })
            .from(events)
            .leftJoin(
              masterData,
              and(
                eq(masterData.tenantId, events.tenantId),
                eq(masterData.id, events.eventTypeId),
              ),
            )
            .leftJoin(
              eventContacts,
              and(
                eq(eventContacts.tenantId, events.tenantId),
                eq(eventContacts.eventId, events.id),
                eq(eventContacts.role, 'primary'),
              ),
            )
            .leftJoin(
              contacts,
              and(
                eq(contacts.tenantId, eventContacts.tenantId),
                eq(contacts.id, eventContacts.contactId),
              ),
            )
            .leftJoin(
              locations,
              and(
                eq(locations.tenantId, events.tenantId),
                eq(locations.id, events.locationId),
              ),
            )
            .where(
              and(
                eq(events.tenantId, tenantId),
                lte(events.eventDate, window.to),
                gte(
                  sql<string>`coalesce(((${events.endsAt}-interval '1 millisecond') AT TIME ZONE ${events.timeZone})::date,${events.eventDate})`,
                  window.from,
                ),
              ),
            )
            .orderBy(
              asc(events.eventDate),
              asc(events.startsAt),
              asc(events.name),
              asc(events.id),
            );
          const slots = await tx
            .select({
              id: reservations.id,
              eventId: reservations.eventId,
              unitId: reservations.unitId,
              state: reservations.state,
              startsAt: reservations.startsAt,
              endsAt: reservations.endsAt,
              baseStart: reservations.baseStart,
              baseEnd: reservations.baseEnd,
              reason: reservations.blockReason,
              eventName: events.name,
            })
            .from(reservations)
            .leftJoin(
              events,
              and(
                eq(events.tenantId, reservations.tenantId),
                eq(events.id, reservations.eventId),
              ),
            )
            .where(
              and(
                eq(reservations.tenantId, tenantId),
                lt(reservations.startsAt, new Date(window.days.at(-1)!.endsAt)),
                gt(reservations.endsAt, new Date(window.days[0]!.startsAt)),
                sql`reservation_is_active(${reservations.state},${reservations.expiresAt},statement_timestamp())`,
              ),
            )
            .orderBy(asc(reservations.startsAt), asc(reservations.id));
          const units = await tx
            .select({
              id: resourceUnits.id,
              name: resources.name,
              code: resources.code,
              ordinal: resourceUnits.ordinal,
              enabled: resourceUnits.enabled,
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
            .where(eq(resourceUnits.tenantId, tenantId))
            .orderBy(
              asc(resources.position),
              asc(resources.code),
              asc(resourceUnits.ordinal),
            );
          const [pending] = await tx
            .select({ count: sql<number>`count(*)::int` })
            .from(importPromises)
            .where(
              and(
                eq(importPromises.tenantId, tenantId),
                isNull(importPromises.reviewedAt),
              ),
            );
          return {
            ...window,
            pendingPromises: pending!.count,
            events: rows.map(
              ({ venue, venueOverride, legacyLocation, ...row }) => ({
                ...row,
                // H034: one effective place; legacy formatting is unchanged.
                location: effectiveVenue(
                  { venue, venueOverride },
                  legacyLocation,
                ),
                startsAt: row.startsAt?.toISOString() ?? null,
                endsAt: row.endsAt?.toISOString() ?? null,
              }),
            ),
            units: units.filter(
              (unit) =>
                unit.enabled || slots.some((slot) => slot.unitId === unit.id),
            ),
            reservations: slots.map((slot) => ({
              ...slot,
              startsAt: slot.startsAt.toISOString(),
              endsAt: slot.endsAt.toISOString(),
              baseStart: slot.baseStart.toISOString(),
              baseEnd: slot.baseEnd.toISOString(),
              conflict: slots.some(
                (other) =>
                  other.id !== slot.id &&
                  other.unitId === slot.unitId &&
                  other.startsAt < slot.endsAt &&
                  other.endsAt > slot.startsAt,
              ),
            })),
          };
        },
        { isolationLevel: 'repeatable read', accessMode: 'read only' },
      );
    },
  };
}
export function registerCalendarRoutes(
  app: FastifyInstance,
  pool: Pool,
  tenantId: string,
) {
  const string = { type: 'string' },
    nullable = { type: ['string', 'null'] };
  const eventFields = {
    id: string,
    name: string,
    status: string,
    eventDate: nullable,
    startsAt: nullable,
    endsAt: nullable,
    eventType: nullable,
    contact: nullable,
    location: nullable,
  };
  const unitFields = {
    id: string,
    name: string,
    code: string,
    ordinal: { type: 'integer' },
    enabled: { type: 'boolean' },
    blocked: { type: 'boolean' },
  };
  const slotFields = {
    id: string,
    eventId: nullable,
    eventName: nullable,
    unitId: string,
    state: { type: 'string', enum: ['hold', 'booked', 'blocked'] },
    startsAt: string,
    endsAt: string,
    baseStart: string,
    baseEnd: string,
    reason: string,
    conflict: { type: 'boolean' },
  };
  const object = (properties: Record<string, unknown>) => ({
    type: 'object',
    additionalProperties: false,
    required: Object.keys(properties),
    properties,
  });
  const response = object({
    pendingPromises: { type: 'integer', minimum: 0 },
    date: string,
    view: { type: 'string', enum: ['day', 'week', 'month'] },
    timeZone: string,
    from: string,
    to: string,
    previousDate: nullable,
    nextDate: nullable,
    days: {
      type: 'array',
      items: object({ date: string, startsAt: string, endsAt: string }),
    },
    events: { type: 'array', items: object(eventFields) },
    units: { type: 'array', items: object(unitFields) },
    reservations: { type: 'array', items: object(slotFields) },
  });
  app.get<{ Querystring: { date?: string; view?: View } }>(
    '/api/v1/calendar',
    {
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            date: { type: 'string', format: 'date' },
            view: { type: 'string', enum: ['day', 'week', 'month'] },
          },
        },
        response: { 200: response },
      },
    },
    async (request, reply) => {
      try {
        return await calendarRepository(pool, tenantId).read(
          request.query.date,
          request.query.view ?? 'week',
        );
      } catch (error) {
        if (
          error instanceof Error &&
          error.message === 'invalid_calendar_period'
        )
          return reply.code(400).send({ error: error.message });
        throw error;
      }
    },
  );
}
