import { createHash, randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import { AccessError, lockTenant, requireAdministrator } from './access.js';
import { StorageError, type StorageAdapter } from './storage.js';

// One size limit for every type, matching the storage adapter default.
export const libraryFileMaxBytes = 10 * 1024 * 1024;
export const libraryMediaTypes = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'application/zip',
] as const;
export type LibraryMediaType = (typeof libraryMediaTypes)[number];
export type LibraryFileState = 'available' | 'archived';

export class LibraryFileError extends Error {
  constructor(
    readonly reason:
      | 'not_found'
      | 'invalid_name'
      | 'invalid_content'
      | 'type_mismatch'
      | 'too_large'
      | 'conflict'
      | 'storage_failed',
  ) {
    super('Library file rejected');
  }
}

const pngMagic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Only the four documented signatures count. The declared type never decides
// what the bytes are.
export function sniffLibraryMediaType(bytes: Buffer): LibraryMediaType | null {
  if (!Buffer.isBuffer(bytes) || bytes.byteLength < 3) return null;
  if (bytes.subarray(0, 5).toString('latin1') === '%PDF-')
    return 'application/pdf';
  if (bytes.subarray(0, 8).equals(pngMagic)) return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return 'image/jpeg';
  if (
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    [0x03, 0x05, 0x07].includes(bytes[2]!) &&
    [0x04, 0x06, 0x08].includes(bytes[3]!)
  )
    return 'application/zip';
  return null;
}

function isControlCharacter(character: string): boolean {
  const code = character.codePointAt(0)!;
  return code < 0x20 || (code >= 0x7f && code <= 0x9f);
}

export function checkLibraryBytes(
  bytes: unknown,
  declared: unknown,
): LibraryMediaType {
  if (!Buffer.isBuffer(bytes) || bytes.byteLength === 0)
    throw new LibraryFileError('invalid_content');
  if (bytes.byteLength > libraryFileMaxBytes)
    throw new LibraryFileError('too_large');
  const sniffed = sniffLibraryMediaType(bytes);
  if (!sniffed) throw new LibraryFileError('invalid_content');
  if (
    typeof declared !== 'string' ||
    !(libraryMediaTypes as readonly string[]).includes(declared) ||
    declared !== sniffed
  )
    throw new LibraryFileError('type_mismatch');
  return sniffed;
}

// The name is stored as data. It never becomes a path, and it is rejected only
// where PostgreSQL text or the audit trail could not carry it safely.
export function normalizeLibraryDisplayName(value: unknown): string {
  if (typeof value !== 'string') throw new LibraryFileError('invalid_name');
  const trimmed = value.trim();
  if (
    !trimmed ||
    [...trimmed].some(isControlCharacter) ||
    [...trimmed].length > 200
  )
    throw new LibraryFileError('invalid_name');
  return trimmed;
}

export function libraryFileExtension(mediaType: LibraryMediaType): string {
  return {
    'application/pdf': 'pdf',
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'application/zip': 'zip',
  }[mediaType];
}

// Keys are generated, never derived from the display name.
export function libraryStorageKey(mediaType: LibraryMediaType): string {
  return `library-${randomUUID()}.${libraryFileExtension(mediaType)}`;
}

export function decodeLibraryBase64(value: unknown): Buffer {
  if (
    typeof value !== 'string' ||
    !value ||
    value.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(value)
  )
    throw new LibraryFileError('invalid_content');
  const bytes = Buffer.from(value, 'base64');
  // Re-encoding rejects non-canonical padding and stray bits that the lenient
  // base64 decoder would otherwise accept.
  if (bytes.toString('base64') !== value)
    throw new LibraryFileError('invalid_content');
  return bytes;
}

function ensureExtension(name: string, mediaType: LibraryMediaType): string {
  const suffix = '.' + libraryFileExtension(mediaType);
  if (name.toLowerCase().endsWith(suffix)) return name;
  // A download never claims a different format than its bytes: a file called
  // x.html and holding a PDF becomes x.pdf instead of x.html.pdf.
  const stem = name.replace(/\.[A-Za-z0-9]{1,10}$/, '');
  return (stem || name) + suffix;
}

function headerSafeName(name: string): string {
  return [...name]
    .filter((character) => !isControlCharacter(character))
    .join('')
    .replace(/["\\]/g, '_')
    .trim();
}

export function contentDispositionHeader(
  displayName: string,
  mediaType: LibraryMediaType,
): string {
  const base = headerSafeName(displayName) || 'datei',
    name = ensureExtension(base, mediaType),
    ascii = [...name]
      .map((character) =>
        character.codePointAt(0)! >= 0x20 && character.codePointAt(0)! <= 0x7e
          ? character
          : '_',
      )
      .join(''),
    encoded = encodeURIComponent(name).replace(
      /['()*]/g,
      (character) => '%' + character.charCodeAt(0).toString(16).toUpperCase(),
    );
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

export type LibraryFileRow = {
  id: string;
  displayName: string;
  mediaType: LibraryMediaType;
  sizeBytes: number;
  state: LibraryFileState;
  scanState: 'not_scanned';
  uploadedAt: string;
  uploadedDate: string;
  archivedAt: string | null;
};

export type LibraryFileUploadInput = {
  displayName: unknown;
  mediaType: unknown;
  contentBase64: unknown;
  requestId?: string;
};

type DbRow = {
  id: string;
  display_name: string;
  media_type: LibraryMediaType;
  size_bytes: number;
  state: LibraryFileState;
  scan_state: 'not_scanned';
  uploaded_at: Date;
  uploaded_date: string;
  archived_at: Date | null;
};

const rowSelect = sql`
  SELECT f.id, f.display_name, f.media_type, f.size_bytes::integer AS size_bytes,
         f.state, f.scan_state, f.uploaded_at, f.archived_at,
         to_char(f.uploaded_at AT TIME ZONE t.timezone, 'YYYY-MM-DD') AS uploaded_date
  FROM library_files f JOIN tenants t ON t.id = f.tenant_id
`;

function mapRow(row: DbRow): LibraryFileRow {
  return {
    id: row.id,
    displayName: row.display_name,
    mediaType: row.media_type,
    sizeBytes: row.size_bytes,
    state: row.state,
    scanState: row.scan_state,
    uploadedAt: new Date(row.uploaded_at).toISOString(),
    uploadedDate: row.uploaded_date,
    archivedAt: row.archived_at
      ? new Date(row.archived_at).toISOString()
      : null,
  };
}

export function libraryFileRepository(
  pool: Pool,
  tenantId: string,
  store: StorageAdapter,
) {
  const db = drizzle(pool);
  async function readRow(
    executor: { execute: (query: ReturnType<typeof sql>) => Promise<unknown> },
    id: string,
  ): Promise<LibraryFileRow> {
    const result = (await executor.execute(
      sql`${rowSelect} WHERE f.tenant_id = ${tenantId} AND f.id = ${id} AND f.state <> 'rejected'`,
    )) as unknown as { rows: DbRow[] };
    const row = result.rows[0];
    if (!row) throw new LibraryFileError('not_found');
    return mapRow(row);
  }
  return {
    async listForEvent(eventId: string): Promise<LibraryFileRow[]> {
      const event = await db.execute(
        sql`SELECT id FROM events WHERE tenant_id = ${tenantId} AND id = ${eventId}`,
      );
      if (!event.rows.length) throw new LibraryFileError('not_found');
      const result = (await db.execute(
        sql`${rowSelect} JOIN event_library_files l ON l.tenant_id = f.tenant_id AND l.file_id = f.id WHERE l.tenant_id = ${tenantId} AND l.event_id = ${eventId} AND f.state <> 'rejected' ORDER BY f.uploaded_at DESC, f.id DESC`,
      )) as unknown as { rows: DbRow[] };
      return result.rows.map(mapRow);
    },
    async changeEventLink(
      actorId: string,
      eventId: string,
      fileId: string,
      link: boolean,
    ): Promise<LibraryFileRow | null> {
      return db.transaction(async (tx) => {
        await lockTenant(tx, tenantId);
        await requireAdministrator(tx, tenantId, actorId);
        const event = await tx.execute(
          sql`SELECT id FROM events WHERE tenant_id = ${tenantId} AND id = ${eventId}`,
        );
        if (!event.rows.length) throw new LibraryFileError('not_found');
        const file = await readRow(tx, fileId);
        const existing = await tx.execute(
          sql`SELECT 1 FROM event_library_files WHERE tenant_id = ${tenantId} AND event_id = ${eventId} AND file_id = ${fileId}`,
        );
        if (link && !existing.rows.length && file.state !== 'available')
          throw new LibraryFileError('conflict');
        const changed = link
          ? await tx.execute(
              sql`INSERT INTO event_library_files (tenant_id,event_id,file_id) VALUES (${tenantId},${eventId},${fileId}) ON CONFLICT DO NOTHING RETURNING file_id`,
            )
          : await tx.execute(
              sql`DELETE FROM event_library_files WHERE tenant_id = ${tenantId} AND event_id = ${eventId} AND file_id = ${fileId} RETURNING file_id`,
            );
        if (changed.rows.length)
          await tx.execute(
            sql`INSERT INTO audit_events (tenant_id,actor_id,action,record_id,related_record_id) VALUES (${tenantId},${actorId},${link ? 'file.event_linked' : 'file.event_unlinked'},${eventId},${fileId})`,
          );
        return link ? file : null;
      });
    },
    async list(): Promise<LibraryFileRow[]> {
      const result = (await db.execute(
        sql`${rowSelect} WHERE f.tenant_id = ${tenantId} AND f.state <> 'rejected' ORDER BY f.uploaded_at DESC, f.id DESC`,
      )) as unknown as { rows: DbRow[] };
      return result.rows.map(mapRow);
    },
    async upload(
      actorId: string,
      input: LibraryFileUploadInput,
    ): Promise<LibraryFileRow> {
      // Every check runs before the transaction: a rejected upload must not
      // leave a row, a file or a receipt behind.
      const bytes = decodeLibraryBase64(input.contentBase64),
        mediaType = checkLibraryBytes(bytes, input.mediaType),
        displayName = normalizeLibraryDisplayName(input.displayName),
        id = randomUUID(),
        storageKey = libraryStorageKey(mediaType),
        sha256 = createHash('sha256').update(bytes).digest('hex'),
        requestHash = createHash('sha256')
          .update(JSON.stringify([displayName, mediaType, sha256]))
          .digest('hex'),
        requestId = input.requestId;
      return db.transaction(async (tx) => {
        await lockTenant(tx, tenantId);
        await requireAdministrator(tx, tenantId, actorId);
        if (requestId) {
          const receipt = (await tx.execute(
            sql`SELECT request_hash, response FROM library_file_upload_operations WHERE tenant_id = ${tenantId} AND request_id = ${requestId}`,
          )) as unknown as {
            rows: { request_hash: string; response: LibraryFileRow }[];
          };
          const previous = receipt.rows[0];
          if (previous) {
            if (previous.request_hash !== requestHash)
              throw new LibraryFileError('conflict');
            return previous.response;
          }
        }
        try {
          await store.put(storageKey, bytes);
        } catch (error) {
          if (error instanceof StorageError && error.reason === 'too_large')
            throw new LibraryFileError('too_large');
          throw new LibraryFileError('storage_failed');
        }
        // Bytes are written first; a failed insert rolls the row back and
        // leaves only an unreferenced, uniquely named file.
        await tx.execute(
          sql`INSERT INTO library_files (tenant_id,id,display_name,media_type,size_bytes,sha256,storage_key,state,scan_state,uploaded_at,uploaded_by)
              VALUES (${tenantId},${id},${displayName},${mediaType},${bytes.byteLength},${sha256},${storageKey},'available','not_scanned',now(),${actorId})`,
        );
        // The audit action is part of the migration's CHECK, not of appendAudit's
        // narrower union, so it is written directly inside the same transaction.
        await tx.execute(
          sql`INSERT INTO audit_events (tenant_id,actor_id,action,record_id) VALUES (${tenantId},${actorId},'file.uploaded',${id})`,
        );
        const row = await readRow(tx, id);
        if (requestId)
          await tx.execute(
            sql`INSERT INTO library_file_upload_operations (tenant_id,request_id,request_hash,response)
                VALUES (${tenantId},${requestId},${requestHash},${JSON.stringify(row)}::jsonb)`,
          );
        return row;
      });
    },
    async read(id: string): Promise<{
      displayName: string;
      mediaType: LibraryMediaType;
      bytes: Buffer;
    }> {
      if (!uuidPattern.test(id)) throw new LibraryFileError('not_found');
      const result = (await db.execute(
        sql`SELECT display_name, media_type, storage_key, state FROM library_files
            WHERE tenant_id = ${tenantId} AND id = ${id} AND state <> 'rejected'`,
      )) as unknown as {
        rows: {
          display_name: string;
          media_type: LibraryMediaType;
          storage_key: string;
          state: LibraryFileState;
        }[];
      };
      const row = result.rows[0];
      // Archived bytes stay stored but are no longer served; the row itself
      // stays visible in the list.
      if (!row || row.state !== 'available')
        throw new LibraryFileError('not_found');
      try {
        return {
          displayName: row.display_name,
          mediaType: row.media_type,
          bytes: await store.read(row.storage_key),
        };
      } catch (error) {
        if (error instanceof StorageError && error.reason === 'invalid_key')
          throw new LibraryFileError('storage_failed');
        if (error instanceof StorageError && error.reason === 'missing')
          throw new LibraryFileError('not_found');
        throw new LibraryFileError('storage_failed');
      }
    },
    async archive(actorId: string, id: string): Promise<LibraryFileRow> {
      if (!uuidPattern.test(id)) throw new LibraryFileError('not_found');
      return db.transaction(async (tx) => {
        await lockTenant(tx, tenantId);
        await requireAdministrator(tx, tenantId, actorId);
        const current = await readRow(tx, id);
        // Archiving twice is the same result and writes no second audit row.
        if (current.state === 'archived') return current;
        await tx.execute(
          sql`UPDATE library_files SET state = 'archived', archived_at = now()
              WHERE tenant_id = ${tenantId} AND id = ${id} AND state = 'available'`,
        );
        await tx.execute(
          sql`INSERT INTO audit_events (tenant_id,actor_id,action,record_id) VALUES (${tenantId},${actorId},'file.archived',${id})`,
        );
        return readRow(tx, id);
      });
    },
  };
}

export function registerLibraryFileRoutes(
  app: FastifyInstance,
  pool: Pool,
  tenantId: string,
  store: StorageAdapter,
) {
  const repo = libraryFileRepository(pool, tenantId, store),
    // Base64 grows the body by 4/3; the margin covers the JSON envelope.
    bodyLimit = Math.ceil((libraryFileMaxBytes * 4) / 3) + 4096,
    row = {
      type: 'object',
      additionalProperties: false,
      required: [
        'id',
        'displayName',
        'mediaType',
        'sizeBytes',
        'state',
        'scanState',
        'uploadedAt',
        'uploadedDate',
        'archivedAt',
      ],
      properties: {
        id: { type: 'string', format: 'uuid' },
        displayName: { type: 'string' },
        mediaType: { type: 'string', enum: [...libraryMediaTypes] },
        sizeBytes: {
          type: 'integer',
          minimum: 1,
          maximum: libraryFileMaxBytes,
        },
        state: { type: 'string', enum: ['available', 'archived'] },
        scanState: { type: 'string', enum: ['not_scanned'] },
        uploadedAt: { type: 'string', format: 'date-time' },
        uploadedDate: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
        archivedAt: {
          anyOf: [{ type: 'string', format: 'date-time' }, { type: 'null' }],
        },
      },
    },
    params = {
      type: 'object',
      required: ['id'],
      properties: { id: { type: 'string', format: 'uuid' } },
    };
  function failure(error: unknown, reply: FastifyReply) {
    if (error instanceof AccessError)
      return reply.code(403).send({ error: 'forbidden' });
    if (!(error instanceof LibraryFileError)) throw error;
    if (error.reason === 'not_found')
      return reply.code(404).send({ error: 'not_found' });
    if (error.reason === 'conflict')
      return reply.code(409).send({ error: 'conflict' });
    if (error.reason === 'type_mismatch')
      return reply.code(415).send({ error: 'media_type_mismatch' });
    if (error.reason === 'too_large')
      return reply.code(413).send({ error: 'file_too_large' });
    if (error.reason === 'storage_failed')
      return reply.code(500).send({ error: 'storage_failed' });
    return reply.code(400).send({ error: error.reason });
  }
  app.get(
    '/api/v1/library-files',
    {
      schema: {
        response: { 200: { type: 'array', items: row } },
      },
    },
    async () => repo.list(),
  );
  const eventFileParams = {
    type: 'object',
    required: ['eventId', 'fileId'],
    properties: {
      eventId: { type: 'string', format: 'uuid' },
      fileId: { type: 'string', format: 'uuid' },
    },
  };
  app.get<{ Params: { eventId: string } }>(
    '/api/v1/events/:eventId/library-files',
    {
      schema: {
        params: {
          type: 'object',
          required: ['eventId'],
          properties: { eventId: { type: 'string', format: 'uuid' } },
        },
        response: { 200: { type: 'array', items: row } },
      },
    },
    async (request, reply) => {
      try {
        return await repo.listForEvent(request.params.eventId);
      } catch (error) {
        return failure(error, reply);
      }
    },
  );
  app.put<{ Params: { eventId: string; fileId: string } }>(
    '/api/v1/events/:eventId/library-files/:fileId',
    {
      schema: { params: eventFileParams, response: { 200: row } },
    },
    async (request, reply) => {
      try {
        return await repo.changeEventLink(
          request.authSession!.userId,
          request.params.eventId,
          request.params.fileId,
          true,
        );
      } catch (error) {
        return failure(error, reply);
      }
    },
  );
  app.delete<{ Params: { eventId: string; fileId: string } }>(
    '/api/v1/events/:eventId/library-files/:fileId',
    {
      schema: { params: eventFileParams },
    },
    async (request, reply) => {
      try {
        await repo.changeEventLink(
          request.authSession!.userId,
          request.params.eventId,
          request.params.fileId,
          false,
        );
        return reply.code(204).send();
      } catch (error) {
        return failure(error, reply);
      }
    },
  );
  app.post<{
    Body: {
      displayName: string;
      mediaType: string;
      contentBase64: string;
      requestId?: string;
    };
  }>(
    '/api/v1/library-files',
    {
      bodyLimit,
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['displayName', 'mediaType', 'contentBase64'],
          properties: {
            displayName: { type: 'string', minLength: 1 },
            mediaType: { type: 'string', enum: [...libraryMediaTypes] },
            contentBase64: { type: 'string', minLength: 1 },
            requestId: { type: 'string', format: 'uuid' },
          },
        },
        response: { 201: row },
      },
    },
    async (request, reply) => {
      try {
        return reply
          .code(201)
          .send(await repo.upload(request.authSession!.userId, request.body));
      } catch (error) {
        return failure(error, reply);
      }
    },
  );
  app.get<{ Params: { id: string } }>(
    '/api/v1/library-files/:id/content',
    { schema: { params } },
    async (request, reply) => {
      try {
        const file = await repo.read(request.params.id);
        return reply
          .type(file.mediaType)
          .header('X-Content-Type-Options', 'nosniff')
          .header('Cache-Control', 'private, no-store')
          .header(
            'Content-Disposition',
            contentDispositionHeader(file.displayName, file.mediaType),
          )
          .send(file.bytes);
      } catch (error) {
        return failure(error, reply);
      }
    },
  );
  app.post<{ Params: { id: string } }>(
    '/api/v1/library-files/:id/archive',
    { schema: { params, response: { 200: row } } },
    async (request, reply) => {
      try {
        return await repo.archive(
          request.authSession!.userId,
          request.params.id,
        );
      } catch (error) {
        return failure(error, reply);
      }
    },
  );
}
