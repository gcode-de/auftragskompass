import { database, type Connection } from './database.js';
import { registerCalendarRoutes } from './calendar.js';
import { csv } from './contacts.js';
import {
  assignEventResources,
  hasBookedBox,
  resourcePlan,
  ResourcePlanError,
  type ResourceAssignment,
} from './event-reservations.js';
import { transitionEventReservations } from './reservations.js';
import { appendEventActivity, readEventActivities } from './event-activity.js';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import {
  and,
  eq,
  exists,
  inArray,
  asc,
  or,
  ilike,
  gte,
  gt,
  lt,
  lte,
  isNull,
  sql,
} from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { Temporal } from '@js-temporal/polyfill';
import sanitizeHtml from 'sanitize-html';
import {
  events,
  importPromises,
  eventContacts,
  tenants,
  contacts,
  locations,
  masterData,
  websiteInquiries,
  reservations,
  resourceUnits,
  resources,
} from './schema.js';
import { AccessError, lockTenant, requireAdministrator } from './access.js';
import { appendAudit } from './audit.js';
import { eventStatuses } from './master-data.js';
import {
  effectiveVenue,
  resolveVenueWrite,
  VenueError,
  venueMaxLength,
} from './venue.js';
export type EventInput = {
  name: string;
  status: 'inquiry' | 'option' | 'booked' | 'unavailable' | 'cancelled';
  eventTypeId: string | null;
  packageId: string | null;
  locationId: string | null;
  venue?: string | null;
  venueOverride?: boolean;
  primaryContactId: string | null;
  additionalContactIds: string[];
  source: string;
  eventDate: string | null;
  startsAt: string | null;
  endsAt: string | null;
  description: string;
  notesHtml: string;
};
export type EventFilters = {
  q?: string;
  from?: string;
  to?: string;
  status?: string;
  eventTypeId?: string;
  undated?: boolean;
};
function validateFilters(filters: EventFilters) {
  try {
    for (const date of [filters.from, filters.to])
      if (date) validateSchedule(date, null, null, 'UTC');
    if (
      (filters.from && filters.to && filters.from > filters.to) ||
      (filters.undated && (filters.from || filters.to))
    )
      throw Error();
  } catch {
    throw new EventError('invalid_filters');
  }
}
class EventError extends Error {}
export function sanitizeNotes(value: string) {
  const clean = sanitizeHtml(value, {
    allowedTags: [
      'p',
      'br',
      'strong',
      'b',
      'em',
      'i',
      'u',
      'ul',
      'ol',
      'li',
      'a',
    ],
    allowedAttributes: { a: ['href', 'title'] },
    allowedSchemes: ['https', 'http', 'mailto'],
    allowProtocolRelative: false,
  });
  if (clean.length > 20000) throw new EventError('invalid_notes');
  return clean;
}
export function validateSchedule(
  date: string | null,
  start: string | null,
  end: string | null,
  timeZone: string,
) {
  try {
    if (date) {
      const parsed = Temporal.PlainDate.from(date);
      if (parsed.year < 1 || parsed.year > 9999) throw Error();
    }
    if (!start && !end) return;
    if (!date || !start || !end) throw Error();
    const beginning = Temporal.Instant.from(start),
      ending = Temporal.Instant.from(end);
    if (
      Temporal.Instant.compare(beginning, ending) >= 0 ||
      beginning.toZonedDateTimeISO(timeZone).toPlainDate().toString() !== date
    )
      throw Error();
  } catch {
    throw new EventError('invalid_schedule');
  }
}
type Reads = Pick<NodePgDatabase, 'select'>;
// Search, status and event type narrow the rows and both result counters alike;
// the date bounds, the undated sort and the order never narrow a counter (H041).
// One shared list keeps the two answers from drifting apart.
function narrowing(db: Reads, tenantId: string, filters: EventFilters) {
  const pattern = '%' + (filters.q ?? '').replace(/[\\%_]/g, '\\$&') + '%';
  return [
    eq(events.tenantId, tenantId),
    filters.status ? eq(events.status, filters.status) : undefined,
    filters.eventTypeId
      ? eq(events.eventTypeId, filters.eventTypeId)
      : undefined,
    filters.q
      ? or(
          ...[events.name, events.description, events.source].map((field) =>
            ilike(field, pattern),
          ),
          // The effective place only: a free-form booking is found by its
          // own text, a legacy booking by its master-data address.
          and(eq(events.venueOverride, true), ilike(events.venue, pattern)),
          and(
            eq(events.venueOverride, false),
            inArray(
              events.locationId,
              db
                .select({ id: locations.id })
                .from(locations)
                .where(
                  and(
                    eq(locations.tenantId, tenantId),
                    or(
                      ...[
                        locations.name,
                        locations.street,
                        locations.city,
                        locations.postalCode,
                      ].map((field) => ilike(field, pattern)),
                    ),
                  ),
                ),
            ),
          ),
          inArray(
            events.id,
            db
              .select({ id: eventContacts.eventId })
              .from(eventContacts)
              .innerJoin(
                contacts,
                and(
                  eq(eventContacts.tenantId, contacts.tenantId),
                  eq(eventContacts.contactId, contacts.id),
                ),
              )
              .where(
                and(
                  eq(eventContacts.tenantId, tenantId),
                  or(
                    ...[
                      contacts.name,
                      contacts.contactPerson,
                      contacts.email,
                      contacts.phone,
                      contacts.mobile,
                    ].map((field) => ilike(field, pattern)),
                  ),
                ),
              ),
          ),
        )
      : undefined,
  ];
}
async function readRows(
  db: Reads,
  tenantId: string,
  contactId?: string,
  id?: string,
  filters: EventFilters = {},
) {
  validateFilters(filters);
  const rows = await db
    .select()
    .from(events)
    .where(
      and(
        ...narrowing(db, tenantId, filters),
        filters.undated ? isNull(events.eventDate) : undefined,
        filters.from
          ? gte(
              sql<string>`coalesce(((${events.endsAt} - interval '1 millisecond') AT TIME ZONE ${events.timeZone})::date,${events.eventDate})`,
              filters.from,
            )
          : undefined,
        filters.to ? lte(events.eventDate, filters.to) : undefined,

        id ? eq(events.id, id) : undefined,
        contactId
          ? inArray(
              events.id,
              db
                .select({ id: eventContacts.eventId })
                .from(eventContacts)
                .where(
                  and(
                    eq(eventContacts.tenantId, tenantId),
                    eq(eventContacts.contactId, contactId),
                  ),
                ),
            )
          : undefined,
      ),
    )
    .orderBy(
      asc(events.eventDate),
      asc(events.startsAt),
      asc(events.name),
      asc(events.id),
    );
  if (!rows.length) return [];
  const links = await db
    .select()
    .from(eventContacts)
    .where(
      and(
        eq(eventContacts.tenantId, tenantId),
        inArray(
          eventContacts.eventId,
          rows.map((row) => row.id),
        ),
      ),
    );
  return rows.map((row) => ({
    ...row,
    startsAt: row.startsAt?.toISOString() ?? null,
    endsAt: row.endsAt?.toISOString() ?? null,
    primaryContactId:
      links.find((link) => link.eventId === row.id && link.role === 'primary')
        ?.contactId ?? null,
    additionalContactIds: links
      .filter((link) => link.eventId === row.id && link.role === 'additional')
      .map((link) => link.contactId)
      .sort(),
  }));
}
// BKP007.2: the result counters answer "how many would this option show?" over
// the whole tenant, so they must also see the undated events and the inquiries
// that the applied date bounds keep out of the rows. One aggregate statement
// beside the list keeps that at a constant cost — never one query per event and
// never the unrestricted list itself.
async function readFilterCounts(
  db: Reads,
  tenantId: string,
  filters: EventFilters = {},
) {
  validateFilters(filters);
  const [counted] = await db
    .select({
      undated:
        sql<number>`count(*) filter (where ${events.eventDate} is null)`.mapWith(
          Number,
        ),
      inquiries:
        sql<number>`count(*) filter (where ${events.status} = 'inquiry')`.mapWith(
          Number,
        ),
    })
    .from(events)
    .where(and(...narrowing(db, tenantId, filters)));
  return {
    undated: counted?.undated ?? 0,
    inquiries: counted?.inquiries ?? 0,
  };
}
// BKP014.2: the event list names the physical units an event holds. One
// statement beside the list answers every listed event, so the cost does not
// grow with the number of rows. It reads stored reservations only: an expired
// hold is reported as the lapsed fact it is, and an overlap is reported only
// where two stored reservations really intersect — never as an estimate of
// availability.
export type EventResourceUnit = {
  unitId: string;
  name: string;
  code: string;
  ordinal: number;
  state: 'hold' | 'booked';
  stale: boolean;
  unitEnabled: boolean;
  resourceState: string;
  resourceBlocked: boolean;
  conflict: boolean;
};
export type EventResources = {
  units: EventResourceUnit[];
  assigned: number;
  booked: number;
  hold: number;
  conflict: boolean;
};
function emptyResources(): EventResources {
  return { units: [], assigned: 0, booked: 0, hold: 0, conflict: false };
}
async function readResourceSummaries(
  db: Reads,
  tenantId: string,
  eventIds: string[],
) {
  if (!eventIds.length) return new Map<string, EventResources>();
  // A second reference to the same table names the neighbour that a row
  // conflicts with; the alias keeps the outer row addressable.
  const neighbour = alias(reservations, 'neighbour_reservation');
  const conflict = sql<boolean>`${exists(
    db
      .select({ id: neighbour.id })
      .from(neighbour)
      .where(
        and(
          eq(neighbour.tenantId, reservations.tenantId),
          eq(neighbour.unitId, resourceUnits.id),
          sql`${neighbour.id} <> ${reservations.id}`,
          sql`${neighbour.eventId} is distinct from ${reservations.eventId}`,
          sql`reservation_is_active(${neighbour.state},${neighbour.expiresAt},statement_timestamp())`,
          lt(neighbour.startsAt, reservations.endsAt),
          gt(neighbour.endsAt, reservations.startsAt),
        ),
      ),
  )}`.mapWith(Boolean);
  const rows = await db
    .select({
      eventId: reservations.eventId,
      unitId: resourceUnits.id,
      name: resources.name,
      code: resources.code,
      ordinal: resourceUnits.ordinal,
      state: reservations.state,
      active:
        sql<boolean>`reservation_is_active(${reservations.state},${reservations.expiresAt},statement_timestamp())`.mapWith(
          Boolean,
        ),
      unitEnabled: resourceUnits.enabled,
      resourceState: resources.state,
      resourceBlocked: resources.blocked,
      conflict,
    })
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
        inArray(reservations.eventId, eventIds),
        inArray(reservations.state, ['hold', 'booked']),
      ),
    )
    .orderBy(
      asc(resources.position),
      asc(resources.code),
      asc(resourceUnits.ordinal),
      asc(reservations.id),
    );
  const summaries = new Map<string, EventResources>();
  for (const row of rows) {
    if (!row.eventId) continue;
    const summary = summaries.get(row.eventId) ?? emptyResources();
    // A hold whose expiry passed is a stale statement, not a current
    // assignment; it stays visible and carries the mark.
    const stale = row.state === 'hold' && !row.active;
    summary.units.push({
      unitId: row.unitId,
      name: row.name,
      code: row.code,
      ordinal: row.ordinal,
      state: row.state as 'hold' | 'booked',
      stale,
      unitEnabled: row.unitEnabled,
      resourceState: row.resourceState,
      resourceBlocked: row.resourceBlocked,
      conflict: row.conflict,
    });
    if (!stale) {
      summary.assigned += 1;
      if (row.state === 'booked') summary.booked += 1;
      else summary.hold += 1;
      if (row.conflict) summary.conflict = true;
    }
    summaries.set(row.eventId, summary);
  }
  return summaries;
}
async function withResourceSummaries<T extends { id: string }>(
  db: Reads,
  tenantId: string,
  rows: T[],
) {
  if (!rows.length)
    return rows.map((row) => ({ ...row, resources: emptyResources() }));
  const summaries = await readResourceSummaries(
    db,
    tenantId,
    rows.map((row) => row.id),
  );
  return rows.map((row) => ({
    ...row,
    resources: summaries.get(row.id) ?? emptyResources(),
  }));
}
export function eventRepository(pool: Connection, tenantId: string) {
  const db = database(pool);
  return {
    async list(contactId?: string, filters: EventFilters = {}) {
      return db.transaction(
        (tx) => readRows(tx, tenantId, contactId, undefined, filters),
        {
          isolationLevel: 'repeatable read',
          accessMode: 'read only',
        },
      );
    },
    // The list and its counters come from one snapshot, so a booking between the
    // two statements can never answer a filter with a mismatched count.
    async listWithCounts(contactId?: string, filters: EventFilters = {}) {
      return db.transaction(
        async (tx) => {
          const rows = await readRows(
            tx,
            tenantId,
            contactId,
            undefined,
            filters,
          );
          return {
            events: await withResourceSummaries(tx, tenantId, rows),
            filterCounts: await readFilterCounts(tx, tenantId, filters),
          };
        },
        {
          isolationLevel: 'repeatable read',
          accessMode: 'read only',
        },
      );
    },
    async exportRows() {
      return db.transaction(
        async (tx) => {
          const rows = await readRows(tx, tenantId);
          if (!rows.length) return [];
          const kinds = await tx
            .select({ id: masterData.id, name: masterData.name })
            .from(masterData)
            .where(eq(masterData.tenantId, tenantId));
          const venues = await tx
            .select({ id: locations.id, name: locations.name })
            .from(locations)
            .where(eq(locations.tenantId, tenantId));
          const people = await tx
            .select({ id: contacts.id, name: contacts.name })
            .from(contacts)
            .where(eq(contacts.tenantId, tenantId));
          const kindNames = new Map(kinds.map((row) => [row.id, row.name]));
          const venueNames = new Map(venues.map((row) => [row.id, row.name]));
          const contactNames = new Map(people.map((row) => [row.id, row.name]));
          return rows.map((row) => ({
            ...row,
            eventTypeName: kindNames.get(row.eventTypeId ?? '') ?? '',
            packageName: kindNames.get(row.packageId ?? '') ?? '',
            // Effective place: a free-form booking exports its own text and no
            // legacy id, so a deliberate clear never leaks the old address.
            locationId: row.venueOverride ? '' : (row.locationId ?? ''),
            locationName:
              effectiveVenue(row, venueNames.get(row.locationId ?? '')) ?? '',
            primaryContactName:
              contactNames.get(row.primaryContactId ?? '') ?? '',
            additionalContactNames: row.additionalContactIds.map((id) =>
              contactNames.get(id)!,
            ),
          }));
        },
        { isolationLevel: 'repeatable read', accessMode: 'read only' },
      );
    },
    async detail(id: string) {
      return db.transaction(
        async (tx) => {
          const event = (await readRows(tx, tenantId, undefined, id))[0];
          if (!event) throw new EventError('not_found');
          const ids = [
            ...(event.primaryContactId ? [event.primaryContactId] : []),
            ...event.additionalContactIds,
          ];
          const people = ids.length
            ? await tx
                .select({
                  id: contacts.id,
                  name: contacts.name,
                  contactPerson: contacts.contactPerson,
                  email: contacts.email,
                  phone: contacts.phone,
                  mobile: contacts.mobile,
                })
                .from(contacts)
                .where(
                  and(
                    eq(contacts.tenantId, tenantId),
                    inArray(contacts.id, ids),
                  ),
                )
                .orderBy(asc(contacts.name))
            : [];
          const venue = event.locationId
            ? (
                await tx
                  .select({
                    id: locations.id,
                    name: locations.name,
                    street: locations.street,
                    postalCode: locations.postalCode,
                    city: locations.city,
                    country: locations.country,
                  })
                  .from(locations)
                  .where(
                    and(
                      eq(locations.tenantId, tenantId),
                      eq(locations.id, event.locationId),
                    ),
                  )
              )[0]!
            : null;
          const masters = await tx
            .select({ id: masterData.id, name: masterData.name })
            .from(masterData)
            .where(
              and(
                eq(masterData.tenantId, tenantId),
                inArray(
                  masterData.id,
                  [event.eventTypeId, event.packageId].filter(
                    (id): id is string => id !== null,
                  ),
                ),
              ),
            );
          const inquiry = await tx
            .select({ id: websiteInquiries.id })
            .from(websiteInquiries)
            .where(
              and(
                eq(websiteInquiries.tenantId, tenantId),
                eq(websiteInquiries.eventId, id),
              ),
            );
          return {
            event,
            websiteInquiryAvailable: inquiry.length > 0,
            contacts: people.map((person) => ({
              ...person,
              role:
                person.id === event.primaryContactId ? 'primary' : 'additional',
            })),
            location: venue,
            eventType:
              masters.find((row) => row.id === event.eventTypeId) ?? null,
            package: masters.find((row) => row.id === event.packageId) ?? null,
            activities: await readEventActivities(tx, tenantId, id),
          };
        },
        { isolationLevel: 'repeatable read', accessMode: 'read only' },
      );
    },
    async timeZone() {
      const [tenant] = await db
        .select()
        .from(tenants)
        .where(eq(tenants.id, tenantId));
      return tenant!.timezone;
    },
    async save(
      actorId: string,
      input: EventInput,
      id?: string,
      version?: number,
      assignments?: ResourceAssignment[],
    ) {
      return db
        .transaction(async (tx) => {
          await lockTenant(tx, tenantId);
          await requireAdministrator(tx, tenantId, actorId);
          const old = id
            ? (await readRows(tx, tenantId, undefined, id))[0]
            : undefined;
          if (id && !old) throw new EventError('not_found');
          if (old && old.version !== version) throw new EventError('conflict');
          if (
            input.status === 'booked' &&
            !assignments &&
            (!old ||
              old.status !== 'booked' ||
              !(await hasBookedBox(tx, tenantId, old.id)))
          )
            throw new EventError('booking_required');
          const [tenant] = await tx
            .select()
            .from(tenants)
            .where(eq(tenants.id, tenantId));
          const timeZone = old?.timeZone ?? tenant!.timezone;
          validateSchedule(
            input.eventDate,
            input.startsAt,
            input.endsAt,
            timeZone,
          );
          if (old) {
            const remaining = await transitionEventReservations(
              tx,
              tenantId,
              old.id,
              actorId,
              old.status,
              input.status,
            );
            if (
              remaining &&
              !assignments &&
              (old.eventDate !== input.eventDate ||
                old.startsAt !==
                  (input.startsAt
                    ? new Date(input.startsAt).toISOString()
                    : null) ||
                old.endsAt !==
                  (input.endsAt ? new Date(input.endsAt).toISOString() : null))
            )
              throw new EventError('reservations_need_review');
          }
          for (const [key, kind] of [
            ['eventTypeId', 'event_type'],
            ['packageId', 'package'],
          ] as const) {
            if (!input[key]) continue;
            const [row] = await tx
              .select()
              .from(masterData)
              .where(
                and(
                  eq(masterData.tenantId, tenantId),
                  eq(masterData.id, input[key]!),
                ),
              );
            if (
              !row ||
              row.kind !== kind ||
              (row.state !== 'active' && old?.[key] !== row.id)
            )
              throw new EventError('invalid_reference');
          }
          if (input.locationId) {
            const [row] = await tx
              .select()
              .from(locations)
              .where(
                and(
                  eq(locations.tenantId, tenantId),
                  eq(locations.id, input.locationId),
                ),
              );
            if (!row || (row.state !== 'active' && old?.locationId !== row.id))
              throw new EventError('invalid_reference');
          }
          const { primaryContactId, additionalContactIds, ...fields } = input;
          const contactIds = [
            ...(primaryContactId ? [primaryContactId] : []),
            ...additionalContactIds,
          ];
          if (new Set(contactIds).size !== contactIds.length)
            throw new EventError('invalid_reference');
          if (contactIds.length) {
            const people = await tx
              .select()
              .from(contacts)
              .where(
                and(
                  eq(contacts.tenantId, tenantId),
                  inArray(contacts.id, contactIds),
                ),
              );
            if (
              people.length !== contactIds.length ||
              people.some(
                (person) =>
                  person.state !== 'active' &&
                  old?.primaryContactId !== person.id &&
                  !old?.additionalContactIds.includes(person.id),
              )
            )
              throw new EventError('invalid_reference');
          }

          let venueState: ReturnType<typeof resolveVenueWrite>;
          try {
            venueState = resolveVenueWrite(input, old);
          } catch (error) {
            if (error instanceof VenueError)
              throw new EventError('invalid_fields');
            throw error;
          }
          const eventId = id ?? randomUUID(),
            values = {
              ...fields,
              venue: venueState.venue,
              venueOverride: venueState.venueOverride,
              name: input.name.trim(),
              timeZone,
              notesHtml: sanitizeNotes(input.notesHtml),
              startsAt: input.startsAt ? new Date(input.startsAt) : null,
              endsAt: input.endsAt ? new Date(input.endsAt) : null,
              version: (old?.version ?? 0) + 1,
            };
          if (id)
            await tx
              .update(events)
              .set(values)
              .where(and(eq(events.tenantId, tenantId), eq(events.id, id)));
          else
            await tx
              .insert(events)
              .values({ ...values, tenantId, id: eventId });
          await tx
            .delete(eventContacts)
            .where(
              and(
                eq(eventContacts.tenantId, tenantId),
                eq(eventContacts.eventId, eventId),
              ),
            );
          if (contactIds.length)
            await tx.insert(eventContacts).values(
              contactIds.map((contactId) => ({
                tenantId,
                eventId,
                contactId,
                role: contactId === primaryContactId ? 'primary' : 'additional',
              })),
            );
          if (assignments)
            await assignEventResources(
              tx,
              tenantId,
              actorId,
              { id: eventId, ...values },
              assignments,
            );
          await appendAudit(
            tx,
            tenantId,
            id ? 'event.updated' : 'event.created',
            actorId,
            eventId,
          );
          await appendEventActivity(
            tx,
            tenantId,
            eventId,
            actorId,
            values.version,
            input.status,
            old?.status,
            assignments !== undefined,
          );
          return (await readRows(tx, tenantId, undefined, eventId))[0]!;
        })
        .catch((error: unknown) => {
          const cause =
            error instanceof Error
              ? ((error.cause ?? error) as
                  { code?: string; constraint?: string } | undefined)
              : undefined;
          if (cause?.constraint === 'reservations_event_unit_live_idx')
            throw new ResourcePlanError('reservations_need_review');
          if (cause?.code === '23P01')
            throw new ResourcePlanError('resource_conflict');
          if (cause?.constraint === 'booked_event_requires_box')
            throw new ResourcePlanError('booking_required');
          throw error;
        });
    },
  };
}
const nullableId = {
  anyOf: [{ type: 'string', format: 'uuid' }, { type: 'null' }],
};
export const eventFields = {
  name: { type: 'string', minLength: 1, maxLength: 200, pattern: '\\S' },
  status: { type: 'string', enum: eventStatuses.map((s) => s.code) },
  eventTypeId: nullableId,
  packageId: nullableId,
  locationId: nullableId,
  primaryContactId: nullableId,
  additionalContactIds: {
    type: 'array',
    maxItems: 50,
    uniqueItems: true,
    items: { type: 'string', format: 'uuid' },
  },
  source: { type: 'string', maxLength: 200 },
  eventDate: {
    anyOf: [{ type: 'string', format: 'date' }, { type: 'null' }],
  },
  startsAt: {
    anyOf: [
      {
        type: 'string',
        format: 'date-time',
        pattern:
          '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{1,3})?(Z|[+-]\\d{2}:\\d{2})$',
      },
      { type: 'null' },
    ],
  },
  endsAt: {
    anyOf: [
      {
        type: 'string',
        format: 'date-time',
        pattern:
          '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{1,3})?(Z|[+-]\\d{2}:\\d{2})$',
      },
      { type: 'null' },
    ],
  },
  description: { type: 'string', maxLength: 4000 },
  notesHtml: { type: 'string', maxLength: 20000 },
};
// H034: additive, optional request properties. Keep `eventFields` unchanged so
// the import manifest and import-review contracts keep their required keys.
export const eventVenueFields = {
  // A union type keeps an explicit JSON null distinct from an empty string;
  // AJV would coerce null into '' for an anyOf of separate branches.
  venue: { type: ['string', 'null'], maxLength: venueMaxLength },
  venueOverride: { type: 'boolean' },
};
export const resourceAssignmentSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['unitId', 'periodSource'],
  properties: {
    unitId: { type: 'string', format: 'uuid' },
    periodSource: { type: 'string', enum: ['event', 'manual'] },
    baseStart: { type: 'string', format: 'date-time' },
    baseEnd: { type: 'string', format: 'date-time' },
  },
  allOf: [
    {
      if: { properties: { periodSource: { const: 'manual' } } },
      then: { required: ['baseStart', 'baseEnd'] },
    },
  ],
};
const timestampOrNull = { type: ['string', 'null'] };
export const resourceAvailabilitySchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'unitId',
    'resourceId',
    'name',
    'code',
    'category',
    'ordinal',
    'selected',
    'periodSource',
    'baseStart',
    'baseEnd',
    'beforeDays',
    'afterDays',
    'startsAt',
    'endsAt',
    'reason',
    'conflicts',
    'available',
  ],
  properties: {
    unitId: { type: 'string' },
    resourceId: { type: 'string' },
    name: { type: 'string' },
    code: { type: 'string' },
    category: { type: 'string' },
    ordinal: { type: 'integer' },
    selected: { type: 'boolean' },
    periodSource: { type: 'string' },
    baseStart: timestampOrNull,
    baseEnd: timestampOrNull,
    beforeDays: { type: 'integer' },
    afterDays: { type: 'integer' },
    startsAt: timestampOrNull,
    endsAt: timestampOrNull,
    reason: timestampOrNull,
    available: { type: 'boolean' },
    conflicts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'eventId', 'state', 'startsAt', 'endsAt'],
        properties: {
          id: { type: 'string' },
          eventId: timestampOrNull,
          state: { type: 'string' },
          startsAt: { type: 'string' },
          endsAt: { type: 'string' },
        },
      },
    },
  },
};
export function registerEventRoutes(
  app: FastifyInstance,
  pool: Pool,
  tenantId: string,
) {
  registerCalendarRoutes(app, pool, tenantId);
  const repo = eventRepository(pool, tenantId);
  const fields = eventFields;
  const version = { type: 'integer', minimum: 1 },
    row = {
      type: 'object',
      additionalProperties: false,
      required: [
        ...Object.keys(fields),
        ...Object.keys(eventVenueFields),
        'id',
        'version',
        'timeZone',
      ],
      properties: {
        ...fields,
        ...eventVenueFields,
        id: { type: 'string', format: 'uuid' },
        version,
        timeZone: { type: 'string' },
      },
    },
    // BKP014.2: the list row carries the projected assignment beside the
    // unchanged event fields. The row has no additional properties, so the
    // field needs its own shape here or the serializer drops it.
    listRow = {
      ...row,
      required: [...row.required, 'resources'],
      properties: {
        ...row.properties,
        resources: {
          type: 'object',
          additionalProperties: false,
          required: ['units', 'assigned', 'booked', 'hold', 'conflict'],
          properties: {
            units: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: [
                  'unitId',
                  'name',
                  'code',
                  'ordinal',
                  'state',
                  'stale',
                  'unitEnabled',
                  'resourceState',
                  'resourceBlocked',
                  'conflict',
                ],
                properties: {
                  unitId: { type: 'string', format: 'uuid' },
                  name: { type: 'string' },
                  code: { type: 'string' },
                  ordinal: { type: 'integer' },
                  state: { type: 'string' },
                  stale: { type: 'boolean' },
                  unitEnabled: { type: 'boolean' },
                  resourceState: { type: 'string' },
                  resourceBlocked: { type: 'boolean' },
                  conflict: { type: 'boolean' },
                },
              },
            },
            assigned: { type: 'integer', minimum: 0 },
            booked: { type: 'integer', minimum: 0 },
            hold: { type: 'integer', minimum: 0 },
            conflict: { type: 'boolean' },
          },
        },
      },
    };
  function failure(error: unknown, reply: FastifyReply) {
    if (error instanceof AccessError)
      return reply.code(403).send({ error: 'forbidden' });
    if (error instanceof EventError || error instanceof ResourcePlanError)
      return reply
        .code(
          error.message === 'not_found'
            ? 404
            : [
                  'conflict',
                  'import_review_required',
                  'booking_required',
                  'reservations_need_review',
                  'resource_conflict',
                  'unit_unavailable',
                ].includes(error.message)
              ? 409
              : 400,
        )
        .send({ error: error.message });
    throw error;
  }
  const assignmentSchema = resourceAssignmentSchema,
    availabilityRow = resourceAvailabilitySchema;
  app.get<{
    Params: { id: string };
    Querystring: { unitId?: string; baseStart?: string; baseEnd?: string };
  }>(
    '/api/v1/events/:id/availability',
    {
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string', format: 'uuid' } },
        },
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            unitId: assignmentSchema.properties.unitId,
            baseStart: assignmentSchema.properties.baseStart,
            baseEnd: assignmentSchema.properties.baseEnd,
          },
        },
        response: { 200: { type: 'array', items: availabilityRow } },
      },
    },
    async (request, reply) => {
      try {
        const detail = await repo.detail(request.params.id),
          query = request.query;
        if (
          (query.unitId && (!query.baseStart || !query.baseEnd)) ||
          (!query.unitId && (query.baseStart || query.baseEnd))
        )
          throw new ResourcePlanError('invalid_period');
        const event = detail.event;
        const rows = await resourcePlan(
          drizzle(pool),
          tenantId,
          {
            ...event,
            startsAt: event.startsAt ? new Date(event.startsAt) : null,
            endsAt: event.endsAt ? new Date(event.endsAt) : null,
          },
          query.unitId
            ? [
                {
                  unitId: query.unitId,
                  periodSource: 'manual',
                  baseStart: query.baseStart!,
                  baseEnd: query.baseEnd!,
                },
              ]
            : undefined,
        );
        const [pending] = await drizzle(pool)
          .select({ id: importPromises.id })
          .from(importPromises)
          .where(
            and(
              eq(importPromises.tenantId, tenantId),
              isNull(importPromises.reviewedAt),
            ),
          )
          .limit(1);
        if (pending)
          for (const row of rows) {
            row.available = false;
            row.reason = 'import_review_required';
          }
        return query.unitId
          ? rows.filter((row) => row.unitId === query.unitId?.toLowerCase())
          : rows;
      } catch (error) {
        return failure(error, reply);
      }
    },
  );
  app.get('/api/v1/events/export.csv', async (_request, reply) => {
    const rows = await repo.exportRows();
    const columns = [
      'id',
      'version',
      'name',
      'status',
      'eventDate',
      'startsAt',
      'endsAt',
      'timeZone',
      'eventTypeId',
      'packageId',
      'locationId',
      'primaryContactId',
      'additionalContactIds',
      'source',
      'description',
      'notesHtml',
      'eventTypeName',
      'packageName',
      'locationName',
      'primaryContactName',
      'additionalContactNames',
    ] as const;
    return reply
      .type('text/csv; charset=utf-8')
      .header('content-disposition', 'attachment; filename="events.csv"')
      .header('cache-control', 'no-store')
      .send(
        csv([
          columns.slice(),
          ...rows.map((row) =>
            columns.map((key) =>
              key === 'additionalContactIds' || key === 'additionalContactNames'
                ? JSON.stringify(row[key])
                : String(row[key] ?? ''),
            ),
          ),
        ]),
      );
  });
  app.get(
    '/api/v1/events',
    {
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            q: { type: 'string', maxLength: 200 },
            from: { type: 'string', format: 'date' },
            to: { type: 'string', format: 'date' },
            status: fields.status,
            eventTypeId: { type: 'string', format: 'uuid' },
            undated: { type: 'boolean' },
          },
        },
        response: {
          200: {
            type: 'object',
            additionalProperties: false,
            required: ['timeZone', 'events', 'filterCounts'],
            properties: {
              timeZone: { type: 'string' },
              events: { type: 'array', items: listRow },
              // BKP007.2: additive counters for the two filter options that the
              // rows alone cannot answer once a date window is applied.
              filterCounts: {
                type: 'object',
                additionalProperties: false,
                required: ['undated', 'inquiries'],
                properties: {
                  undated: { type: 'integer', minimum: 0 },
                  inquiries: { type: 'integer', minimum: 0 },
                },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      try {
        const listing = await repo.listWithCounts(
          undefined,
          request.query as EventFilters,
        );
        return { timeZone: await repo.timeZone(), ...listing };
      } catch (error) {
        return failure(error, reply);
      }
    },
  );
  const named = {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'name'],
    properties: {
      id: { type: 'string', format: 'uuid' },
      name: { type: 'string' },
    },
  };
  const contact = {
    type: 'object',
    additionalProperties: false,
    required: [
      'id',
      'name',
      'contactPerson',
      'email',
      'phone',
      'mobile',
      'role',
    ],
    properties: {
      ...named.properties,
      contactPerson: { type: 'string' },
      email: { type: 'string' },
      phone: { type: 'string' },
      mobile: { type: 'string' },
      role: { type: 'string', enum: ['primary', 'additional'] },
    },
  };
  const venue = {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'name', 'street', 'postalCode', 'city', 'country'],
    properties: {
      ...named.properties,
      street: { type: 'string' },
      postalCode: { type: 'string' },
      city: { type: 'string' },
      country: { type: 'string' },
    },
  };
  const nullableStatus = { anyOf: [fields.status, { type: 'null' }] };
  const activity = {
    type: 'object',
    additionalProperties: false,
    required: [
      'id',
      'actorId',
      'eventVersion',
      'kind',
      'previousStatus',
      'nextStatus',
      'occurredAt',
      'description',
    ],
    properties: {
      id: { type: 'string' },
      actorId: nullableId,
      eventVersion: { anyOf: [version, { type: 'null' }] },
      kind: {
        type: 'string',
        enum: [
          'created',
          'updated',
          'status_changed',
          'resources_changed',
          'website_received',
        ],
      },
      previousStatus: nullableStatus,
      nextStatus: nullableStatus,
      occurredAt: { type: 'string', format: 'date-time' },
      description: { type: 'string' },
    },
  };
  app.get<{ Params: { id: string } }>(
    '/api/v1/events/:id',
    {
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string', format: 'uuid' } },
        },
        response: {
          200: {
            type: 'object',
            additionalProperties: false,
            required: [
              'event',
              'contacts',
              'location',
              'eventType',
              'package',
              'activities',
              'websiteInquiryAvailable',
            ],
            properties: {
              event: row,
              websiteInquiryAvailable: { type: 'boolean' },
              contacts: { type: 'array', items: contact },
              location: { anyOf: [venue, { type: 'null' }] },
              eventType: { anyOf: [named, { type: 'null' }] },
              package: { anyOf: [named, { type: 'null' }] },
              activities: { type: 'array', items: activity },
            },
          },
        },
      },
    },
    async (request, reply) => {
      try {
        return await repo.detail(request.params.id);
      } catch (error) {
        return failure(error, reply);
      }
    },
  );
  app.get<{ Params: { id: string } }>(
    '/api/v1/contacts/:id/events',
    {
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string', format: 'uuid' } },
        },
        response: { 200: { type: 'array', items: row } },
      },
    },
    (request) => repo.list(request.params.id),
  );
  app.post<{ Body: EventInput }>(
    '/api/v1/events',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: Object.keys(fields),
          properties: { ...fields, ...eventVenueFields },
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
    Body: EventInput & { version: number; assignments?: ResourceAssignment[] };
  }>(
    '/api/v1/events/:id',
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
          properties: {
            ...fields,
            ...eventVenueFields,
            version,
            assignments: {
              type: 'array',
              maxItems: 50,
              items: assignmentSchema,
            },
          },
        },
        response: { 200: row },
      },
    },
    async (request, reply) => {
      try {
        return await drizzle(pool).transaction(async (tx) => {
          await lockTenant(tx, tenantId);
          await requireAdministrator(tx, tenantId, request.authSession!.userId);
          if (request.body.status === 'booked') {
            const [pending] = await tx
              .select({ id: importPromises.id })
              .from(importPromises)
              .where(
                and(
                  eq(importPromises.tenantId, tenantId),
                  isNull(importPromises.reviewedAt),
                ),
              )
              .limit(1);
            if (pending) throw new ResourcePlanError('import_review_required');
          }
          return await eventRepository(tx, tenantId).save(
            request.authSession!.userId,
            request.body,
            request.params.id,
            request.body.version,
            request.body.assignments,
          );
        });
      } catch (error) {
        return failure(error, reply);
      }
    },
  );
}
