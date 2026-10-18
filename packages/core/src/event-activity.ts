import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { and, asc, eq } from 'drizzle-orm';
import { eventActivities } from './schema.js';
import { eventStatuses } from './master-data.js';
export async function appendEventActivity(
  db: Pick<NodePgDatabase, 'insert'>,
  tenantId: string,
  eventId: string,
  actorId: string,
  version: number,
  status: string,
  previousStatus?: string,
  resourcesChanged = false,
) {
  await db.insert(eventActivities).values({
    tenantId,
    eventId,
    actorId,
    eventVersion: version,
    kind:
      previousStatus === undefined
        ? 'created'
        : previousStatus === status
          ? resourcesChanged
            ? 'resources_changed'
            : 'updated'
          : 'status_changed',
    previousStatus: previousStatus ?? null,
    nextStatus: status,
  });
}
export async function readEventActivities(
  db: Pick<NodePgDatabase, 'select'>,
  tenantId: string,
  eventId: string,
) {
  const rows = await db
    .select()
    .from(eventActivities)
    .where(
      and(
        eq(eventActivities.tenantId, tenantId),
        eq(eventActivities.eventId, eventId),
      ),
    )
    .orderBy(asc(eventActivities.occurredAt), asc(eventActivities.id));
  return rows.map((row) => ({
    id: row.id.toString(),
    actorId: row.actorId,
    eventVersion: row.eventVersion,
    kind: row.kind,
    previousStatus: row.previousStatus,
    nextStatus: row.nextStatus,
    occurredAt: row.occurredAt.toISOString(),
    description:
      row.kind === 'website_received'
        ? 'Website-Anfrage empfangen: ' + row.source + '.'
        : row.kind === 'created'
          ? 'Event angelegt.'
          : row.kind === 'resources_changed'
            ? 'Ressourcenzuordnung und Dispositionszeitraum geändert.'
            : row.kind === 'updated'
              ? 'Event geändert.'
              : `Status von ${eventStatuses.find((s) => s.code === row.previousStatus)!.label} auf ${eventStatuses.find((s) => s.code === row.nextStatus)!.label} geändert.`,
  }));
}
