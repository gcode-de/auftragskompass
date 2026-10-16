import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { and, eq } from 'drizzle-orm';
import { Temporal } from '@js-temporal/polyfill';
import {
  AccessError,
  lockTenant,
  requireAdministrator,
  type Transaction,
} from './access.js';
import { appendAudit } from './audit.js';
import {
  eventFields,
  eventRepository,
  resourceAssignmentSchema,
  type EventInput,
} from './events.js';
import { resourcePlan, type ResourceAssignment } from './event-reservations.js';
import { compileImportSchema } from './minimal-import.js';
import { importPromises, importRecords, tenants } from './schema.js';
export class ImportReviewError extends Error {}
type Input = EventInput & {
  version: number;
  assignments: ResourceAssignment[];
};
const validInput = compileImportSchema({
  schema: {
    type: 'object',
    additionalProperties: false,
    required: [...Object.keys(eventFields), 'version', 'assignments'],
    properties: {
      ...eventFields,
      version: { type: 'integer', minimum: 1 },
      assignments: {
        type: 'array',
        maxItems: 50,
        items: resourceAssignmentSchema,
      },
    },
  },
});
function hash(input: object) {
  return createHash('sha256')
    .update(
      JSON.stringify(
        Object.fromEntries(
          Object.entries(input).sort(([a], [b]) => a.localeCompare(b)),
        ),
      ),
    )
    .digest('hex');
}
function past(promise: typeof importPromises.$inferSelect) {
  const today = Temporal.Now.plainDateISO(promise.timeZone).toString();
  return promise.data.endsAt
    ? Date.parse(promise.data.endsAt) <= Date.now()
    : Boolean(promise.data.eventDate && promise.data.eventDate < today);
}
async function read(tx: Transaction, tenantId: string, id: string) {
  const [row] = await tx
    .select()
    .from(importPromises)
    .where(
      and(eq(importPromises.tenantId, tenantId), eq(importPromises.id, id)),
    );
  if (!row) throw new ImportReviewError('not_found');
  return row;
}
export function importReviewRepository(pool: Pool, tenantId: string) {
  async function finish(
    actorId: string,
    id: string,
    input: Input | { version: number },
    exclude: boolean,
  ) {
    const requestHash = hash({
      ...input,
      operation: exclude ? 'exclude' : 'event',
    });
    try {
      return await drizzle(pool).transaction(async (tx) => {
        await lockTenant(tx, tenantId);
        await requireAdministrator(tx, tenantId, actorId);
        const promise = await read(tx, tenantId, id);
        if (promise.reviewedAt) {
          if (promise.reviewHash !== requestHash)
            throw new ImportReviewError('already_reviewed');
          return {
            eventId: promise.reviewedEventId,
            excluded: promise.reviewAction === 'excluded_past',
          };
        }
        if (promise.version !== input.version)
          throw new ImportReviewError('conflict');
        const [mapping] = await tx
          .select()
          .from(importRecords)
          .where(
            and(
              eq(importRecords.tenantId, tenantId),
              eq(importRecords.promiseId, id),
            ),
          );
        if (!mapping) throw new ImportReviewError('mapping_missing');
        let eventId: string | null = null;
        let targetVersion = promise.version + 1;
        if (exclude) {
          if (!past(promise)) throw new ImportReviewError('future_promise');
        } else {
          const [tenant] = await tx
            .select()
            .from(tenants)
            .where(eq(tenants.id, tenantId));
          if (tenant!.timezone !== promise.timeZone)
            throw new ImportReviewError('timezone_changed');
          const { version: _version, assignments, ...event } = input as Input;
          if (
            event.status === 'booked' &&
            (!event.primaryContactId || !event.packageId || !event.eventDate)
          )
            throw new ImportReviewError('incomplete_import');
          void _version;
          // Explicit import review uses the same booking service and database invariants.
          const saved = await eventRepository(tx, tenantId).save(
            actorId,
            event,
            undefined,
            undefined,
            assignments,
          );
          eventId = saved.id;
          targetVersion = saved.version;
        }
        await tx
          .update(importRecords)
          .set({ eventId, promiseId: exclude ? id : null, targetVersion })
          .where(
            and(
              eq(importRecords.tenantId, tenantId),
              eq(importRecords.source, 'bookitup'),
              eq(importRecords.section, 'events'),
              eq(importRecords.externalId, mapping.externalId),
            ),
          );
        await tx
          .update(importPromises)
          .set({
            version: promise.version + 1,
            reviewedAt: new Date(),
            reviewedBy: actorId,
            reviewHash: requestHash,
            reviewAction: exclude ? 'excluded_past' : 'event',
            reviewedEventId: eventId,
          })
          .where(
            and(
              eq(importPromises.tenantId, tenantId),
              eq(importPromises.id, id),
            ),
          );
        await appendAudit(tx, tenantId, 'import.reviewed', actorId, id);
        return { eventId, excluded: exclude };
      });
    } catch (error) {
      if (error instanceof ImportReviewError || error instanceof AccessError)
        throw error;
      if (
        error instanceof Error &&
        ['invalid_reference', 'invalid_schedule', 'invalid_notes'].includes(
          error.message,
        )
      )
        throw new ImportReviewError(error.message);
      const cause =
        error instanceof Error
          ? ((error.cause ?? error) as { code?: string })
          : undefined;
      if (cause?.code?.startsWith('23'))
        throw new ImportReviewError('conflict');
      throw error;
    }
  }
  return {
    async read(actorId: string, id: string) {
      return drizzle(pool).transaction(
        async (tx) => {
          await requireAdministrator(tx, tenantId, actorId);
          const promise = await read(tx, tenantId, id);
          return {
            event: {
              ...promise.data,
              id: promise.id,
              version: promise.version,
              timeZone: promise.timeZone,
            },
            reviewAction: promise.reviewAction,
            reviewedEventId: promise.reviewedEventId,
            canExcludePast: !promise.reviewedAt && past(promise),
          };
        },
        { accessMode: 'read only' },
      );
    },
    async availability(
      actorId: string,
      id: string,
      query: { unitId?: string; baseStart?: string; baseEnd?: string } = {},
    ) {
      return drizzle(pool).transaction(
        async (tx) => {
          await requireAdministrator(tx, tenantId, actorId);
          const promise = await read(tx, tenantId, id);
          if (promise.reviewedAt)
            throw new ImportReviewError('already_reviewed');
          if (
            Boolean(query.unitId) !==
              Boolean(query.baseStart && query.baseEnd) ||
            (!query.unitId && (query.baseStart || query.baseEnd))
          )
            throw new ImportReviewError('invalid_period');
          const rows = await resourcePlan(
            tx,
            tenantId,
            {
              id,
              status: promise.data.status,
              startsAt: promise.data.startsAt
                ? new Date(promise.data.startsAt)
                : null,
              endsAt: promise.data.endsAt
                ? new Date(promise.data.endsAt)
                : null,
              timeZone: promise.timeZone,
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
              : [],
          );
          return query.unitId
            ? rows.filter((row) => row.unitId === query.unitId!.toLowerCase())
            : rows;
        },
        { accessMode: 'read only', isolationLevel: 'repeatable read' },
      );
    },
    async review(actorId: string, id: string, input: unknown) {
      if (!validInput(input)) throw new ImportReviewError('invalid_request');
      return finish(actorId, id, input as Input, false);
    },
    async excludePast(actorId: string, id: string, version: number) {
      if (!Number.isInteger(version) || version < 1)
        throw new ImportReviewError('invalid_request');
      return finish(actorId, id, { version }, true);
    },
  };
}
