import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import {
  and,
  eq,
  inArray,
  asc,
  or,
  ilike,
  gte,
  lte,
  isNull,
  sql,
} from 'drizzle-orm';
import { Temporal } from '@js-temporal/polyfill';
import sanitizeHtml from 'sanitize-html';
import {
  events,
  eventContacts,
  tenants,
  contacts,
  locations,
  masterData,
} from './schema.js';
import { AccessError, lockTenant, requireAdministrator } from './access.js';
import { appendAudit } from './audit.js';
import { eventStatuses } from './master-data.js';
export type EventInput = {
  name: string;
  status: 'inquiry' | 'option' | 'booked' | 'unavailable' | 'cancelled';
  eventTypeId: string | null;
  packageId: string | null;
  locationId: string | null;
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
async function readRows(
  db: Pick<NodePgDatabase, 'select'>,
  tenantId: string,
  contactId?: string,
  id?: string,
  filters: EventFilters = {},
) {
  validateFilters(filters);
  const pattern = '%' + (filters.q ?? '').replace(/[\\%_]/g, '\\$&') + '%';
  const rows = await db
    .select()
    .from(events)
    .where(
      and(
        eq(events.tenantId, tenantId),
        filters.status ? eq(events.status, filters.status) : undefined,
        filters.eventTypeId
          ? eq(events.eventTypeId, filters.eventTypeId)
          : undefined,
        filters.undated ? isNull(events.eventDate) : undefined,
        filters.from
          ? gte(
              sql<string>`coalesce(((${events.endsAt} - interval '1 millisecond') AT TIME ZONE ${events.timeZone})::date,${events.eventDate})`,
              filters.from,
            )
          : undefined,
        filters.to ? lte(events.eventDate, filters.to) : undefined,
        filters.q
          ? or(
              ...[events.name, events.description, events.source].map((field) =>
                ilike(field, pattern),
              ),
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
export function eventRepository(pool: Pool, tenantId: string) {
  const db = drizzle(pool);
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
    ) {
      return db.transaction(async (tx) => {
        await lockTenant(tx, tenantId);
        await requireAdministrator(tx, tenantId, actorId);
        const old = id
          ? (await readRows(tx, tenantId, undefined, id))[0]
          : undefined;
        if (id && !old) throw new EventError('not_found');
        if (old && old.version !== version) throw new EventError('conflict');
        if (input.status === 'booked') throw new EventError('booking_required');
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

        const eventId = id ?? randomUUID(),
          values = {
            ...fields,
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
          await tx.insert(events).values({ ...values, tenantId, id: eventId });
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
        await appendAudit(
          tx,
          tenantId,
          id ? 'event.updated' : 'event.created',
          actorId,
          eventId,
        );
        return (await readRows(tx, tenantId, undefined, eventId))[0]!;
      });
    },
  };
}
export function registerEventRoutes(
  app: FastifyInstance,
  pool: Pool,
  tenantId: string,
) {
  const repo = eventRepository(pool, tenantId),
    nullableId = {
      anyOf: [{ type: 'string', format: 'uuid' }, { type: 'null' }],
    };
  const fields = {
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
  const version = { type: 'integer', minimum: 1 },
    row = {
      type: 'object',
      additionalProperties: false,
      required: [...Object.keys(fields), 'id', 'version', 'timeZone'],
      properties: {
        ...fields,
        id: { type: 'string', format: 'uuid' },
        version,
        timeZone: { type: 'string' },
      },
    };
  function failure(error: unknown, reply: FastifyReply) {
    if (error instanceof AccessError)
      return reply.code(403).send({ error: 'forbidden' });
    if (error instanceof EventError)
      return reply
        .code(
          error.message === 'not_found'
            ? 404
            : ['conflict', 'booking_required'].includes(error.message)
              ? 409
              : 400,
        )
        .send({ error: error.message });
    throw error;
  }
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
            required: ['timeZone', 'events'],
            properties: {
              timeZone: { type: 'string' },
              events: { type: 'array', items: row },
            },
          },
        },
      },
    },
    async (request, reply) => {
      try {
        return {
          timeZone: await repo.timeZone(),
          events: await repo.list(undefined, request.query as EventFilters),
        };
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
  app.put<{ Params: { id: string }; Body: EventInput & { version: number } }>(
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
