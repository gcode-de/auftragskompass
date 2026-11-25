import type { Pool } from 'pg';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { randomUUID } from 'node:crypto';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { database } from './database.js';
import { AccessError, lockTenant, requireAdministrator } from './access.js';
import { appendAudit } from './audit.js';
import { eventNotes, events, users } from './schema.js';
import { sanitizeNotes } from './events.js';

// QW3: dated notes of an event, newest first, like Bookitup's note list. The
// text runs through the notes allowlist; removal leaves a tombstone with the
// remover so nothing silently disappears from the history.

export type EventNote = {
  id: string;
  bodyHtml: string;
  createdAt: string;
  author: string | null;
  /** UI-BKP-04: when the note was last edited; null while unchanged. */
  updatedAt: string | null;
};
export class EventNoteError extends Error {}

type Db = ReturnType<typeof database>;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/** True when sanitized HTML carries visible text, not only empty markup. */
export function noteHasText(html: string) {
  return (
    html
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/g, ' ')
      .trim() !== ''
  );
}

/** Adds one note inside a running transaction; the caller checked access. */
export async function insertEventNote(
  tx: Tx,
  tenantId: string,
  actorId: string,
  eventId: string,
  bodyHtml: string,
) {
  const [note] = await tx
    .insert(eventNotes)
    .values({
      tenantId,
      id: randomUUID(),
      eventId,
      bodyHtml,
      createdBy: actorId,
    })
    .returning();
  await appendAudit(tx, tenantId, 'event_note.created', actorId, note!.id);
  return note!;
}

export function eventNoteRepository(pool: Pool, tenantId: string) {
  const db = database(pool);
  async function liveEvent(tx: Tx, eventId: string) {
    const [event] = await tx
      .select({ id: events.id })
      .from(events)
      .where(
        and(
          eq(events.tenantId, tenantId),
          eq(events.id, eventId),
          isNull(events.deletedAt),
        ),
      );
    if (!event) throw new EventNoteError('not_found');
  }
  return {
    async list(eventId: string): Promise<EventNote[]> {
      return db.transaction(
        async (tx) => {
          await liveEvent(tx, eventId);
          const rows = await tx
            .select({
              id: eventNotes.id,
              bodyHtml: eventNotes.bodyHtml,
              createdAt: eventNotes.createdAt,
              updatedAt: eventNotes.updatedAt,
              author: users.email,
            })
            .from(eventNotes)
            .leftJoin(
              users,
              and(
                eq(users.tenantId, eventNotes.tenantId),
                eq(users.id, eventNotes.createdBy),
              ),
            )
            .where(
              and(
                eq(eventNotes.tenantId, tenantId),
                eq(eventNotes.eventId, eventId),
                isNull(eventNotes.deletedAt),
              ),
            )
            .orderBy(desc(eventNotes.createdAt), desc(eventNotes.id));
          return rows.map((row) => ({
            ...row,
            createdAt: row.createdAt.toISOString(),
            updatedAt: row.updatedAt?.toISOString() ?? null,
          }));
        },
        { isolationLevel: 'repeatable read', accessMode: 'read only' },
      );
    },
    async add(actorId: string, eventId: string, html: string) {
      let bodyHtml: string;
      try {
        bodyHtml = sanitizeNotes(html);
      } catch {
        throw new EventNoteError('invalid_note');
      }
      if (!noteHasText(bodyHtml)) throw new EventNoteError('empty_note');
      return db.transaction(async (tx) => {
        await lockTenant(tx, tenantId);
        await requireAdministrator(tx, tenantId, actorId);
        await liveEvent(tx, eventId);
        await insertEventNote(tx, tenantId, actorId, eventId, bodyHtml);
      });
    },
    // UI-BKP-04: an existing note keeps its time and author; the text is
    // replaced through the same allowlist and the edit is recorded.
    async update(
      actorId: string,
      eventId: string,
      noteId: string,
      html: string,
    ) {
      let bodyHtml: string;
      try {
        bodyHtml = sanitizeNotes(html);
      } catch {
        throw new EventNoteError('invalid_note');
      }
      if (!noteHasText(bodyHtml)) throw new EventNoteError('empty_note');
      return db.transaction(async (tx) => {
        await lockTenant(tx, tenantId);
        await requireAdministrator(tx, tenantId, actorId);
        await liveEvent(tx, eventId);
        const [updated] = await tx
          .update(eventNotes)
          .set({ bodyHtml, updatedAt: new Date(), updatedBy: actorId })
          .where(
            and(
              eq(eventNotes.tenantId, tenantId),
              eq(eventNotes.eventId, eventId),
              eq(eventNotes.id, noteId),
              isNull(eventNotes.deletedAt),
            ),
          )
          .returning({ id: eventNotes.id });
        if (!updated) throw new EventNoteError('not_found');
        await appendAudit(tx, tenantId, 'event_note.updated', actorId, noteId);
      });
    },
    async remove(actorId: string, eventId: string, noteId: string) {
      return db.transaction(async (tx) => {
        await lockTenant(tx, tenantId);
        await requireAdministrator(tx, tenantId, actorId);
        await liveEvent(tx, eventId);
        const [removed] = await tx
          .update(eventNotes)
          .set({ deletedAt: new Date(), deletedBy: actorId })
          .where(
            and(
              eq(eventNotes.tenantId, tenantId),
              eq(eventNotes.eventId, eventId),
              eq(eventNotes.id, noteId),
              isNull(eventNotes.deletedAt),
            ),
          )
          .returning({ id: eventNotes.id });
        if (!removed) throw new EventNoteError('not_found');
        await appendAudit(tx, tenantId, 'event_note.removed', actorId, noteId);
      });
    },
  };
}

export function registerEventNoteRoutes(
  app: FastifyInstance,
  pool: Pool,
  tenantId: string,
) {
  const repo = eventNoteRepository(pool, tenantId);
  const id = { type: 'string', format: 'uuid' };
  const note = {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'bodyHtml', 'createdAt', 'author', 'updatedAt'],
    properties: {
      id,
      bodyHtml: { type: 'string' },
      createdAt: { type: 'string' },
      author: { type: ['string', 'null'] },
      updatedAt: { type: ['string', 'null'] },
    },
  };
  const list = { type: 'array', items: note };
  function failure(error: unknown, reply: FastifyReply) {
    if (error instanceof AccessError)
      return reply.code(403).send({ error: 'forbidden' });
    if (error instanceof EventNoteError)
      return reply
        .code(error.message === 'not_found' ? 404 : 400)
        .send({ error: error.message });
    throw error;
  }
  app.get<{ Params: { id: string } }>(
    '/api/v1/events/:id/notes',
    {
      schema: {
        params: { type: 'object', required: ['id'], properties: { id } },
        response: { 200: list },
      },
    },
    async (request, reply) => {
      try {
        return await repo.list(request.params.id);
      } catch (error) {
        return failure(error, reply);
      }
    },
  );
  app.post<{ Params: { id: string }; Body: { bodyHtml: string } }>(
    '/api/v1/events/:id/notes',
    {
      schema: {
        params: { type: 'object', required: ['id'], properties: { id } },
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['bodyHtml'],
          properties: { bodyHtml: { type: 'string', maxLength: 50000 } },
        },
        response: { 201: list },
      },
    },
    async (request, reply) => {
      try {
        await repo.add(
          request.authSession!.userId,
          request.params.id,
          request.body.bodyHtml,
        );
        return reply.code(201).send(await repo.list(request.params.id));
      } catch (error) {
        return failure(error, reply);
      }
    },
  );
  app.put<{
    Params: { id: string; noteId: string };
    Body: { bodyHtml: string };
  }>(
    '/api/v1/events/:id/notes/:noteId',
    {
      schema: {
        params: {
          type: 'object',
          required: ['id', 'noteId'],
          properties: { id, noteId: id },
        },
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['bodyHtml'],
          properties: { bodyHtml: { type: 'string', maxLength: 50000 } },
        },
        response: { 200: list },
      },
    },
    async (request, reply) => {
      try {
        await repo.update(
          request.authSession!.userId,
          request.params.id,
          request.params.noteId,
          request.body.bodyHtml,
        );
        return await repo.list(request.params.id);
      } catch (error) {
        return failure(error, reply);
      }
    },
  );
  app.delete<{ Params: { id: string; noteId: string } }>(
    '/api/v1/events/:id/notes/:noteId',
    {
      schema: {
        params: {
          type: 'object',
          required: ['id', 'noteId'],
          properties: { id, noteId: id },
        },
        response: { 200: list },
      },
    },
    async (request, reply) => {
      try {
        await repo.remove(
          request.authSession!.userId,
          request.params.id,
          request.params.noteId,
        );
        return await repo.list(request.params.id);
      } catch (error) {
        return failure(error, reply);
      }
    },
  );
}
