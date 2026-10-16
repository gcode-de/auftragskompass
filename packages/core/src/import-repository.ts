import { createHash, randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { and, eq, sql } from 'drizzle-orm';
import {
  AccessError,
  lockTenant,
  requireAdministrator,
  type Transaction,
} from './access.js';
import { appendAudit } from './audit.js';
import { contactRepository, type ContactInput } from './contacts.js';
import { locationRepository, type LocationInput } from './locations.js';
import {
  masterDataRepository,
  eventStatuses,
  type MasterInput,
} from './master-data.js';
import {
  eventRepository,
  sanitizeNotes,
  validateSchedule,
  type EventInput,
} from './events.js';
import {
  contacts,
  locations,
  masterData,
  events,
  tenants,
  importRecords,
  importPromises,
} from './schema.js';
import {
  compileImportSchema,
  previewImport,
  importSections,
  type ImportManifest,
} from './minimal-import.js';
type Section = (typeof importSections)[number];
type Decision = { section: Section; externalId: string } & (
  { action: 'create' } | { action: 'bind'; targetId: string; version: number }
);
type Request = {
  manifest: unknown;
  mode: 'dry_run' | 'apply';
  allowUpdates: boolean;
  decisions: Decision[];
};
export type ImportResult = {
  applied: boolean;
  pendingPromises: number;
  counts: Record<
    Section,
    {
      created: number;
      bound: number;
      updated: number;
      unchanged: number;
      excluded: number;
    }
  >;
};
export class ImportError extends Error {
  constructor(
    code: string,
    readonly section: Section | 'manifest' = 'manifest',
    readonly row = 0,
    readonly candidates: { id: string; version: number }[] = [],
  ) {
    super(code);
  }
}
const decisionFields = {
  section: { type: 'string', enum: importSections },
  externalId: { type: 'string', minLength: 1, maxLength: 200 },
};
const validRequest = compileImportSchema({
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['manifest', 'mode', 'allowUpdates', 'decisions'],
    properties: {
      manifest: {},
      mode: { type: 'string', enum: ['dry_run', 'apply'] },
      allowUpdates: { type: 'boolean' },
      decisions: {
        type: 'array',
        maxItems: 10000,
        items: {
          oneOf: [
            {
              type: 'object',
              additionalProperties: false,
              required: ['section', 'externalId', 'action'],
              properties: { ...decisionFields, action: { const: 'create' } },
            },
            {
              type: 'object',
              additionalProperties: false,
              required: [
                'section',
                'externalId',
                'action',
                'targetId',
                'version',
              ],
              properties: {
                ...decisionFields,
                action: { const: 'bind' },
                targetId: { type: 'string', format: 'uuid' },
                version: { type: 'integer', minimum: 1 },
              },
            },
          ],
        },
      },
    },
  },
});
function hash(data: object) {
  return createHash('sha256')
    .update(
      JSON.stringify(
        Object.fromEntries(
          Object.entries(data).sort(([a], [b]) => a.localeCompare(b)),
        ),
      ),
    )
    .digest('hex');
}
function normalized<T extends { name: string }>(data: T): T {
  const value = { ...data, name: data.name.trim() };
  if ('email' in value)
    value.email = (value.email as string).trim().toLowerCase();
  if ('notesHtml' in value)
    value.notesHtml = sanitizeNotes(value.notesHtml as string);
  for (const key of ['startsAt', 'endsAt'] as const)
    if (key in value && value[key as keyof T])
      Object.assign(value, {
        [key]: new Date(value[key as keyof T] as string).toISOString(),
      });
  return value;
}
const key = (section: string, externalId: string) =>
  JSON.stringify([section, externalId]);
async function targetRows(tx: Transaction, tenantId: string, section: Section) {
  const scope = (
    table:
      typeof contacts | typeof locations | typeof masterData | typeof events,
  ) => eq(table.tenantId, tenantId);
  if (section === 'contacts')
    return tx.select().from(contacts).where(scope(contacts));
  if (section === 'locations')
    return tx.select().from(locations).where(scope(locations));
  if (section === 'events')
    return tx
      .select({
        id: events.id,
        name: events.name,
        version: events.version,
        state: sql<null>`NULL`,
      })
      .from(events)
      .where(scope(events));
  return tx
    .select()
    .from(masterData)
    .where(
      and(
        scope(masterData),
        eq(
          masterData.kind,
          section === 'eventTypes' ? 'event_type' : 'package',
        ),
      ),
    );
}
export function importRepository(pool: Pool, tenantId: string) {
  return {
    async overview(actorId: string) {
      return drizzle(pool).transaction(
        async (tx) => {
          await requireAdministrator(tx, tenantId, actorId);
          const records = await tx
            .select()
            .from(importRecords)
            .where(eq(importRecords.tenantId, tenantId))
            .orderBy(importRecords.section, importRecords.externalId);
          const promises = await tx
            .select()
            .from(importPromises)
            .where(eq(importPromises.tenantId, tenantId))
            .orderBy(importPromises.id);
          const targets = new Map<
            Section,
            Map<string, { name: string; version: number }>
          >();
          for (const section of importSections)
            targets.set(
              section,
              new Map(
                (await targetRows(tx, tenantId, section)).map((row) => [
                  row.id,
                  row,
                ]),
              ),
            );
          const name = (section: Section, id: string | null) =>
            id ? (targets.get(section)!.get(id)?.name ?? null) : null;
          return {
            checkedAt: new Date().toISOString(),
            pendingPromises: promises.length,
            counts: Object.fromEntries(
              importSections.map((section) => [
                section,
                records.filter((row) => row.section === section).length,
              ]),
            ),
            mappings: records.map((row) => {
              const targetId = (row.contactId ??
                row.locationId ??
                row.masterId ??
                row.eventId ??
                row.promiseId)!;
              const target = row.promiseId
                ? promises.find((promise) => promise.id === row.promiseId)!
                : targets.get(row.section as Section)!.get(targetId)!;
              return {
                section: row.section,
                externalId: row.externalId,
                targetId,
                name: 'data' in target ? target.data.name : target.name,
                sourceStatus: row.sourceStatus,
                targetVersion: row.targetVersion,
                currentVersion: target.version,
                locallyChanged: row.targetVersion !== target.version,
                pendingResourceReview: Boolean(row.promiseId),
              };
            }),
            promises: promises.map((promise) => ({
              id: promise.id,
              version: promise.version,
              externalId:
                records.find((row) => row.promiseId === promise.id)
                  ?.externalId ?? null,
              name: promise.data.name,
              eventDate: promise.data.eventDate,
              startsAt: promise.data.startsAt,
              endsAt: promise.data.endsAt,
              timeZone: promise.timeZone,
              contact: name('contacts', promise.data.primaryContactId),
              location: name('locations', promise.data.locationId),
              package: name('packages', promise.data.packageId),
              description: promise.data.description,
              notesHtml: promise.data.notesHtml,
            })),
          };
        },
        { accessMode: 'read only', isolationLevel: 'repeatable read' },
      );
    },
    async run(actorId: string, input: unknown): Promise<ImportResult> {
      if (!validRequest(input)) throw new ImportError('invalid_request');
      const request = input as Request;
      let dryRunResult: ImportResult | undefined;
      const rollback = new Error('import_dry_run');
      try {
        return await drizzle(pool).transaction(async (tx) => {
          await lockTenant(tx, tenantId);
          await requireAdministrator(tx, tenantId, actorId);
          const [tenant] = await tx
            .select()
            .from(tenants)
            .where(eq(tenants.id, tenantId));
          const preview = previewImport(request.manifest, tenant!.timezone);
          if (!preview.valid) {
            const issue = preview.errors[0]!;
            throw new ImportError(issue.code, issue.section, issue.row);
          }
          const manifest = request.manifest as ImportManifest;
          const decisions = new Map<string, Decision>();
          for (const decision of request.decisions) {
            const decisionKey = key(decision.section, decision.externalId);
            if (
              decisions.has(decisionKey) ||
              !manifest[decision.section].some(
                (entry) => entry.externalId === decision.externalId,
              )
            )
              throw new ImportError('invalid_decision');
            decisions.set(decisionKey, decision);
          }
          const result: ImportResult = {
            applied: request.mode === 'apply',
            pendingPromises: 0,
            counts: Object.fromEntries(
              importSections.map((section) => [
                section,
                {
                  created: 0,
                  bound: 0,
                  updated: 0,
                  unchanged: 0,
                  excluded: preview.counts[section].excluded,
                },
              ]),
            ) as ImportResult['counts'],
          };
          const refs = new Map<string, string>();
          const scope = eq(importRecords.tenantId, tenantId);
          const rows = await tx.select().from(importRecords).where(scope);
          const acceptedEvents = new Set(
            preview.events.map((event) => event.row),
          );
          for (const section of importSections) {
            const entries = manifest[section];
            for (const [index, entry] of entries.entries()) {
              if (section === 'events' && !acceptedEvents.has(index + 1))
                continue;
              const fail = (
                code: string,
                candidates: { id: string; version: number }[] = [],
              ): never => {
                throw new ImportError(code, section, index + 1, candidates);
              };
              const data = normalized(entry.data),
                contentHash = hash(data);
              const old = rows.find(
                (row) =>
                  row.section === section &&
                  row.externalId === entry.externalId,
              );
              const decision = decisions.get(key(section, entry.externalId));
              const targetId = old
                ? (old.contactId ??
                    old.locationId ??
                    old.masterId ??
                    old.eventId ??
                    old.promiseId)!
                : decision?.action === 'bind'
                  ? decision.targetId.toLowerCase()
                  : undefined;
              if (
                old &&
                decision?.action === 'bind' &&
                decision.targetId.toLowerCase() !== targetId
              )
                fail('mapping_conflict');
              if (old && old.contentHash === contentHash) {
                refs.set(key(section, entry.externalId), targetId!);
                result.counts[section].unchanged++;
                continue;
              }
              if (old && !request.allowUpdates) fail('delta_review_required');
              const booked =
                section === 'events' &&
                (data as ImportManifest['events'][number]['data']).status ===
                  'Gebucht';
              if (old && Boolean(old.promiseId) !== booked)
                fail('status_review_required');
              if (booked && decision?.action === 'bind')
                fail('promise_binding_unsupported');
              const targets = await targetRows(tx, tenantId, section);
              const target = booked
                ? targetId
                  ? (
                      await tx
                        .select()
                        .from(importPromises)
                        .where(
                          and(
                            eq(importPromises.tenantId, tenantId),
                            eq(importPromises.id, targetId),
                          ),
                        )
                    )[0]
                  : undefined
                : targets.find((row) => row.id === targetId);
              const version =
                old?.targetVersion ??
                (decision?.action === 'bind' ? decision.version : undefined);
              if (targetId && (!target || target.version !== version))
                fail('target_conflict');
              if (!old && decision?.action === 'bind') {
                if (
                  rows.some((row) =>
                    [
                      row.contactId,
                      row.locationId,
                      row.masterId,
                      row.eventId,
                      row.promiseId,
                    ].includes(targetId!),
                  )
                )
                  fail('target_already_mapped');
                if (!request.allowUpdates) fail('binding_review_required');
              }
              if (!targetId && decision?.action !== 'create' && !booked) {
                let duplicates: { id: string; version: number }[];
                if (section === 'contacts') {
                  const contact = data as ContactInput;
                  const matches = await contactRepository(
                    tx,
                    tenantId,
                  ).duplicates(contact);
                  duplicates = targets.filter(
                    (row) =>
                      row.name.trim().toLowerCase() ===
                        contact.name.toLowerCase() ||
                      matches.some((match) => match.id === row.id),
                  );
                } else
                  duplicates = targets.filter(
                    (row) =>
                      row.name.trim().toLowerCase() === data.name.toLowerCase(),
                  );
                if (duplicates.length)
                  fail(
                    'duplicate_review_required',
                    duplicates.map(({ id, version }) => ({ id, version })),
                  );
              }
              let saved: { id: string; version: number };
              if (section === 'contacts')
                saved = await contactRepository(tx, tenantId).save(
                  actorId,
                  data as ContactInput,
                  targetId,
                  version,
                );
              else if (section === 'locations')
                saved = await locationRepository(tx, tenantId).save(
                  actorId,
                  data as LocationInput,
                  targetId,
                  version,
                );
              else if (section === 'eventTypes' || section === 'packages') {
                const kind =
                  section === 'eventTypes' ? 'event_type' : 'package';
                const repo = masterDataRepository(tx, tenantId);
                saved = targetId
                  ? await repo.update(actorId, kind, targetId, {
                      ...(data as MasterInput),
                      version: version!,
                    })
                  : await repo.create(actorId, kind, data as MasterInput);
              } else {
                const source = data as ImportManifest['events'][number]['data'];
                const resolve = (section: Section, id: string | null) =>
                  id
                    ? (refs.get(key(section, id)) ?? fail('missing_reference'))
                    : null;
                const event: EventInput = {
                  ...source,
                  status: eventStatuses.find(
                    (status) => status.label === source.status,
                  )!.code,
                  eventTypeId: resolve('eventTypes', source.eventTypeId),
                  packageId: resolve('packages', source.packageId),
                  locationId: resolve('locations', source.locationId),
                  primaryContactId: resolve(
                    'contacts',
                    source.primaryContactId,
                  ),
                  additionalContactIds: source.additionalContactIds.map((id) =>
                    resolve('contacts', id)!,
                  ),
                };
                if (booked) {
                  // Source references are revalidated on final confirmation as well.
                  for (const [section, ids] of [
                    ['eventTypes', [event.eventTypeId]],
                    ['packages', [event.packageId]],
                    ['locations', [event.locationId]],
                    [
                      'contacts',
                      [event.primaryContactId, ...event.additionalContactIds],
                    ],
                  ] as const) {
                    const active = await targetRows(tx, tenantId, section);
                    if (
                      ids.some(
                        (id) =>
                          id &&
                          !active.some(
                            (row) => row.id === id && row.state === 'active',
                          ),
                      )
                    )
                      fail('inactive_reference');
                  }
                  validateSchedule(
                    event.eventDate,
                    event.startsAt,
                    event.endsAt,
                    target && 'timeZone' in target
                      ? target.timeZone
                      : tenant!.timezone,
                  );
                  const values = { data: event, version: (version ?? 0) + 1 };
                  const [promise] = targetId
                    ? await tx
                        .update(importPromises)
                        .set(values)
                        .where(
                          and(
                            eq(importPromises.tenantId, tenantId),
                            eq(importPromises.id, targetId),
                          ),
                        )
                        .returning()
                    : await tx
                        .insert(importPromises)
                        .values({
                          ...values,
                          tenantId,
                          id: randomUUID(),
                          timeZone: tenant!.timezone,
                        })
                        .returning();
                  saved = promise!;
                } else
                  saved = await eventRepository(tx, tenantId).save(
                    actorId,
                    event,
                    targetId,
                    version,
                  );
              }
              const mapping = {
                contentHash,
                targetVersion: saved.version,
                sourceStatus:
                  section === 'events'
                    ? (data as ImportManifest['events'][number]['data']).status
                    : '',
                contactId: section === 'contacts' ? saved.id : null,
                locationId: section === 'locations' ? saved.id : null,
                masterId:
                  section === 'eventTypes' || section === 'packages'
                    ? saved.id
                    : null,
                eventId: section === 'events' && !booked ? saved.id : null,
                promiseId: booked ? saved.id : null,
              };
              if (old)
                await tx
                  .update(importRecords)
                  .set(mapping)
                  .where(
                    and(
                      scope,
                      eq(importRecords.source, 'bookitup'),
                      eq(importRecords.section, section),
                      eq(importRecords.externalId, entry.externalId),
                    ),
                  );
              else
                await tx.insert(importRecords).values({
                  ...mapping,
                  tenantId,
                  section,
                  externalId: entry.externalId,
                });
              await appendAudit(
                tx,
                tenantId,
                old ? 'import.updated' : 'import.created',
                actorId,
                saved.id,
              );
              refs.set(key(section, entry.externalId), saved.id);
              result.counts[section][
                old
                  ? 'updated'
                  : decision?.action === 'bind'
                    ? 'bound'
                    : 'created'
              ]++;
            }
          }
          result.pendingPromises = (
            await tx
              .select()
              .from(importPromises)
              .where(eq(importPromises.tenantId, tenantId))
          ).length;
          await tx.execute(sql`SET CONSTRAINTS ALL IMMEDIATE`);
          if (request.mode === 'dry_run') {
            dryRunResult = result;
            throw rollback;
          }
          return result;
        });
      } catch (error) {
        if (error === rollback) return dryRunResult!;
        if (error instanceof ImportError || error instanceof AccessError)
          throw error;
        const cause =
          error instanceof Error
            ? ((error.cause ?? error) as { code?: string })
            : undefined;
        if (
          error instanceof Error &&
          [
            'invalid_reference',
            'invalid_schedule',
            'invalid_notes',
            'conflict',
            'booking_required',
            'reservations_need_review',
            'resource_conflict',
            'unit_unavailable',
          ].includes(error.message)
        )
          throw new ImportError(error.message);
        if (cause?.code?.startsWith('23'))
          throw new ImportError('database_conflict');
        throw error;
      }
    },
  };
}
