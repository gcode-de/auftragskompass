import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { migrate } from '../../packages/core/src/identity.js';
import {
  bootstrapAccess,
  accessRepository,
} from '../../packages/core/src/access.js';
import {
  createHealthServer,
  loadRuntimeConfig,
} from '../../packages/core/src/runtime.js';
import { registerAuth, digest } from '../../packages/core/src/auth.js';
import {
  StorageError,
  type StorageAdapter,
} from '../../packages/core/src/storage.js';
import {
  libraryFileMaxBytes,
  libraryFileRepository,
  registerLibraryFileRoutes,
} from '../../packages/core/src/library-files.js';
import { syntheticGoogle } from '../helpers/oidc.js';

let container: StartedPostgreSqlContainer,
  pool: Pool,
  app: FastifyInstance,
  otherActorId: string;
const tenantId = randomUUID(),
  otherTenantId = randomUUID(),
  site = 'https://admin.example.invalid';
const cookies = { '__Host-ak-session': 'synthetic-library' },
  headers = {
    origin: site,
    'x-csrf-token': digest('csrf:synthetic-library'),
  };

const pdfBytes = Buffer.from('%PDF-1.4 synthetic invoice\n%%EOF\n', 'latin1'),
  pngBytes = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  ]),
  jpegBytes = Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00,
  ]),
  zipBytes = Buffer.concat([
    Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    Buffer.from('../synthetic-escape.txt inside a zip that is never unpacked'),
  ]);

const files = new Map<string, Buffer>(),
  putKeys: string[] = [];
let failPut: 'failed' | null = null;
const store: StorageAdapter = {
  async put(key, bytes) {
    if (failPut) throw new StorageError(failPut);
    putKeys.push(key);
    files.set(key, Buffer.from(bytes));
  },
  async read(key) {
    const bytes = files.get(key);
    if (!bytes) throw new StorageError('missing');
    return bytes;
  },
  async remove(key) {
    files.delete(key);
  },
};

function upload(
  overrides: Record<string, unknown> = {},
  transport: { cookies?: typeof cookies; headers?: typeof headers } = {},
) {
  return app.inject({
    method: 'POST',
    url: '/api/v1/library-files',
    cookies: transport.cookies ?? cookies,
    headers: transport.headers ?? headers,
    payload: {
      displayName: 'synthetic-invoice.pdf',
      mediaType: 'application/pdf',
      contentBase64: pdfBytes.toString('base64'),
      ...overrides,
    },
  });
}

async function auditCount(action: string, id?: string) {
  const result = await pool.query<{ n: number }>(
    id
      ? 'SELECT count(*)::int AS n FROM audit_events WHERE tenant_id=$1 AND action=$2 AND record_id=$3'
      : 'SELECT count(*)::int AS n FROM audit_events WHERE tenant_id=$1 AND action=$2',
    id ? [tenantId, action, id] : [tenantId, action],
  );
  return result.rows[0]!.n;
}

async function rowCount() {
  const result = await pool.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM library_files WHERE tenant_id=$1',
    [tenantId],
  );
  return result.rows[0]!.n;
}

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:17.6-alpine').start();
  pool = new Pool({ connectionString: container.getConnectionUri() });
  await migrate(pool);
  await bootstrapAccess(
    pool,
    tenantId,
    'library@example.invalid',
    'Synthetic library',
    'Europe/Berlin',
  );
  await accessRepository(pool, tenantId).issueSession(
    { subject: 'library', email: 'library@example.invalid' },
    digest('synthetic-library'),
  );
  await bootstrapAccess(
    pool,
    otherTenantId,
    'other-library@example.invalid',
    'Synthetic other library',
    'Europe/Berlin',
  );
  await accessRepository(pool, otherTenantId).issueSession(
    { subject: 'other-library', email: 'other-library@example.invalid' },
    digest('synthetic-other-library'),
  );
  otherActorId = (await accessRepository(pool, otherTenantId).list())[0]!
    .userId!;
  const config = {
    origin: site,
    tenantId,
    clientId: 'synthetic',
    clientSecret: 'synthetic',
  };
  app = createHealthServer(
    loadRuntimeConfig(
      {
        AK_DB_HOST: 'synthetic',
        AK_DB_NAME: 'synthetic',
        AK_DB_USER: 'synthetic',
        AK_DB_PASSWORD_FILE: 'synthetic',
        AK_LOG_LEVEL: 'silent',
      },
      () => 'synthetic-long-secret',
    ),
    { database: async () => true, worker: async () => true },
  );
  await registerAuth(
    app,
    pool,
    config,
    (await syntheticGoogle(config)).provider,
  );
  registerLibraryFileRoutes(app, pool, tenantId, store);
});

afterAll(async () => {
  await app?.close();
  await pool?.end();
  await container?.stop();
});

beforeEach(async () => {
  failPut = null;
  files.clear();
  putKeys.length = 0;
  await pool.query(
    'DELETE FROM library_file_upload_operations WHERE tenant_id IN ($1,$2)',
    [tenantId, otherTenantId],
  );
  await pool.query('DELETE FROM library_files WHERE tenant_id IN ($1,$2)', [
    tenantId,
    otherTenantId,
  ]);
});

test('uploads each allowed type with a generated key and an honest scan state', async () => {
  for (const [mediaType, bytes] of [
    ['application/pdf', pdfBytes],
    ['image/png', pngBytes],
    ['image/jpeg', jpegBytes],
    ['application/zip', zipBytes],
  ] as const) {
    const response = await upload({
      displayName: 'synthetic-' + mediaType.split('/')[1]!,
      mediaType,
      contentBase64: bytes.toString('base64'),
    });
    expect(response.statusCode).toBe(201);
    const row = response.json();
    expect(row).toMatchObject({
      displayName: 'synthetic-' + mediaType.split('/')[1]!,
      mediaType,
      sizeBytes: bytes.byteLength,
      state: 'available',
      scanState: 'not_scanned',
    });
    expect(row.uploadedDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(new Date(row.uploadedAt).toISOString()).toBe(row.uploadedAt);
    const stored = await pool.query<{
      storage_key: string;
      sha256: string;
      scan_state: string;
      display_name: string;
    }>(
      'SELECT storage_key,sha256,scan_state,display_name FROM library_files WHERE tenant_id=$1 AND id=$2',
      [tenantId, row.id],
    );
    expect(stored.rows[0]!.scan_state).toBe('not_scanned');
    expect(stored.rows[0]!.storage_key).toMatch(/^[a-z0-9][a-z0-9._-]{0,127}$/);
    expect(stored.rows[0]!.storage_key).not.toContain('synthetic');
    expect(files.get(stored.rows[0]!.storage_key)!.equals(bytes)).toBe(true);
    expect(await auditCount('file.uploaded', row.id as string)).toBe(1);
  }
  expect(await rowCount()).toBe(4);
  const list = await app.inject({ url: '/api/v1/library-files', cookies });
  expect(list.statusCode).toBe(200);
  expect(Array.isArray(list.json())).toBe(true);
  expect(list.json()).toHaveLength(4);
  for (const row of list.json() as { state: string; scanState: string }[]) {
    expect(row.state).toBe('available');
    expect(row.scanState).toBe('not_scanned');
  }
});

test('rejects MIME spoofing with 415 and leaves neither row nor bytes', async () => {
  const before = await auditCount('file.uploaded');
  const response = await upload({
    displayName: 'renamed-synthetic.png',
    mediaType: 'image/png',
    contentBase64: zipBytes.toString('base64'),
  });
  expect(response.statusCode).toBe(415);
  expect(response.json()).toEqual({ error: 'media_type_mismatch' });
  expect(await rowCount()).toBe(0);
  expect(putKeys).toEqual([]);
  expect(files.size).toBe(0);
  expect(await auditCount('file.uploaded')).toBe(before);
});

test('accepts exactly 10 MiB and rejects one byte more with 413', async () => {
  const exact = Buffer.concat([
    pdfBytes,
    Buffer.alloc(libraryFileMaxBytes - pdfBytes.byteLength, 0x20),
  ]);
  const accepted = await upload({
    displayName: 'limit-exact.pdf',
    contentBase64: exact.toString('base64'),
  });
  expect(accepted.statusCode).toBe(201);
  expect(accepted.json().sizeBytes).toBe(libraryFileMaxBytes);

  const over = Buffer.concat([exact, Buffer.from('!')]);
  const rejected = await upload({
    displayName: 'limit-over.pdf',
    contentBase64: over.toString('base64'),
  });
  expect(rejected.statusCode).toBe(413);
  expect(rejected.json()).toEqual({ error: 'file_too_large' });
  expect(await rowCount()).toBe(1);
  expect(putKeys).toHaveLength(1);

  // The transport limit answers before the route sees a body.
  const tooBig = await upload({
    displayName: 'transport-over.pdf',
    contentBase64: 'A'.repeat(14 * 1024 * 1024),
  });
  expect(tooBig.statusCode).toBe(413);
  expect(tooBig.json()).toEqual({ error: 'request_too_large' });
});

test('hostile display names stay data and never influence the key', async () => {
  const hostile = await upload({ displayName: '../../synthetic-evil.pdf' });
  expect(hostile.statusCode).toBe(201);
  expect(hostile.json().displayName).toBe('../../synthetic-evil.pdf');
  const { rows } = await pool.query<{ storage_key: string }>(
    'SELECT storage_key FROM library_files WHERE tenant_id=$1 AND id=$2',
    [tenantId, hostile.json().id],
  );
  expect(rows[0]!.storage_key).toMatch(/^library-[0-9a-f-]{36}\.pdf$/);
  expect(rows[0]!.storage_key).not.toContain('evil');

  const unicode = await upload({
    displayName: 'Ünïcode 🎉 مرحبا.pdf',
  });
  expect(unicode.statusCode).toBe(201);
  expect(unicode.json().displayName).toBe('Ünïcode 🎉 مرحبا.pdf');

  for (const displayName of [
    'synthetic\u0000nul.pdf',
    'synthetic\u001fcontrol.pdf',
    'x'.repeat(300) + '.pdf',
    '   ',
  ]) {
    const rejected = await upload({ displayName });
    expect(rejected.statusCode).toBe(400);
    expect(rejected.json()).toEqual({ error: 'invalid_name' });
  }
  expect(await rowCount()).toBe(2);
});

test('a ZIP stays opaque bytes and is never unpacked', async () => {
  const response = await upload({
    displayName: 'synthetic-archive.zip',
    mediaType: 'application/zip',
    contentBase64: zipBytes.toString('base64'),
  });
  expect(response.statusCode).toBe(201);
  expect(putKeys).toHaveLength(1);
  expect(putKeys[0]).toMatch(/^library-[0-9a-f-]{36}\.zip$/);
  // Only the generated key exists; the traversal text inside the ZIP never
  // became a file name.
  expect([...files.keys()]).toEqual([putKeys[0]]);
  expect([...files.keys()].some((key) => key.includes('escape'))).toBe(false);
  expect(files.get(putKeys[0]!)!.equals(zipBytes)).toBe(true);
});

test('another tenant sees nothing and cannot read or archive foreign ids', async () => {
  const created = await upload();
  expect(created.statusCode).toBe(201);
  const id = created.json().id as string;
  const other = libraryFileRepository(pool, otherTenantId, store);
  expect(await other.list()).toEqual([]);
  await expect(other.read(id)).rejects.toMatchObject({ reason: 'not_found' });
  await expect(other.archive(otherActorId, id)).rejects.toMatchObject({
    reason: 'not_found',
  });
  expect(
    (await app.inject({ url: '/api/v1/library-files/' + id + '/content' }))
      .statusCode,
  ).toBe(401);
  const foreign = await upload(
    {},
    {
      cookies: { '__Host-ak-session': 'synthetic-other-library' },
      headers: {
        origin: site,
        'x-csrf-token': digest('csrf:synthetic-other-library'),
      },
    },
  );
  // The other tenant's session is valid, but not for this tenant's route.
  expect(foreign.statusCode).toBe(401);
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/api/v1/library-files/' + id + '/archive',
        cookies,
        headers,
      })
    ).statusCode,
  ).toBe(200);
});

test('a storage failure returns 500 and leaves no available row behind', async () => {
  failPut = 'failed';
  const before = await auditCount('file.uploaded');
  const response = await upload({ displayName: 'synthetic-storage.pdf' });
  expect(response.statusCode).toBe(500);
  expect(response.json()).toEqual({ error: 'storage_failed' });
  expect(await rowCount()).toBe(0);
  const available = await pool.query(
    "SELECT count(*)::int AS n FROM library_files WHERE tenant_id=$1 AND state='available'",
    [tenantId],
  );
  expect(available.rows[0].n).toBe(0);
  expect(await auditCount('file.uploaded')).toBe(before);
  expect(files.size).toBe(0);
});

test('a retried upload with the same request id writes exactly one row', async () => {
  const requestId = randomUUID();
  const first = await upload({ requestId });
  expect(first.statusCode).toBe(201);
  const second = await upload({ requestId });
  expect(second.statusCode).toBe(201);
  expect(second.json()).toEqual(first.json());
  expect(await rowCount()).toBe(1);
  expect(putKeys).toHaveLength(1);
  expect(await auditCount('file.uploaded', first.json().id as string)).toBe(1);

  const conflict = await upload({
    requestId,
    displayName: 'different-synthetic.pdf',
  });
  expect(conflict.statusCode).toBe(409);
  expect(conflict.json()).toEqual({ error: 'conflict' });

  // Without a request id two uploads are two files: no silent dedupe.
  await upload();
  await upload();
  expect(await rowCount()).toBe(3);
});

test('download is an attachment with a sanitised name and nosniff', async () => {
  const created = await upload();
  const id = created.json().id as string;
  const content = await app.inject({
    url: '/api/v1/library-files/' + id + '/content',
    cookies,
  });
  expect(content.statusCode).toBe(200);
  expect(content.headers['content-type']).toBe('application/pdf');
  expect(content.headers['x-content-type-options']).toBe('nosniff');
  expect(content.headers['cache-control']).toBe('private, no-store');
  expect(content.headers['content-disposition']).toBe(
    'attachment; filename="synthetic-invoice.pdf"; filename*=UTF-8\'\'synthetic-invoice.pdf',
  );
  expect(content.rawPayload.equals(pdfBytes)).toBe(true);

  const htmlNamed = await upload({ displayName: 'synthetic-invoice.html' });
  const htmlContent = await app.inject({
    url: '/api/v1/library-files/' + htmlNamed.json().id + '/content',
    cookies,
  });
  // The sniffed type wins; an HTML-sounding name never becomes text/html.
  expect(htmlContent.headers['content-type']).toBe('application/pdf');
  expect(htmlContent.headers['content-disposition']).toContain(
    'filename="synthetic-invoice.pdf"',
  );

  const umlaut = await upload({ displayName: 'Bühne 🎉.pdf' });
  const encoded = await app.inject({
    url: '/api/v1/library-files/' + umlaut.json().id + '/content',
    cookies,
  });
  expect(encoded.headers['content-disposition']).toBe(
    'attachment; filename="B_hne _.pdf"; filename*=UTF-8\'\'B%C3%BChne%20%F0%9F%8E%89.pdf',
  );
});

test('archiving twice is idempotent and stops serving the bytes', async () => {
  const created = await upload();
  const id = created.json().id as string;
  const first = await app.inject({
    method: 'POST',
    url: '/api/v1/library-files/' + id + '/archive',
    cookies,
    headers,
  });
  expect(first.statusCode).toBe(200);
  expect(first.json().state).toBe('archived');
  const archivedAt = first.json().archivedAt as string;
  expect(new Date(archivedAt).toISOString()).toBe(archivedAt);
  const second = await app.inject({
    method: 'POST',
    url: '/api/v1/library-files/' + id + '/archive',
    cookies,
    headers,
  });
  expect(second.statusCode).toBe(200);
  expect(second.json()).toEqual(first.json());
  expect(await auditCount('file.archived', id)).toBe(1);
  expect(files.size).toBe(1);
  const content = await app.inject({
    url: '/api/v1/library-files/' + id + '/content',
    cookies,
  });
  expect(content.statusCode).toBe(404);
  const list = await app.inject({ url: '/api/v1/library-files', cookies });
  expect(list.json()).toMatchObject([{ id, state: 'archived' }]);
});

test('the API rejects missing session, missing CSRF and unknown ids', async () => {
  expect((await app.inject('/api/v1/library-files')).statusCode).toBe(401);
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/api/v1/library-files',
        cookies,
        payload: {
          displayName: 'synthetic.pdf',
          mediaType: 'application/pdf',
          contentBase64: pdfBytes.toString('base64'),
        },
      })
    ).statusCode,
  ).toBe(403);
  expect(
    (
      await app.inject({
        url: '/api/v1/library-files/' + randomUUID() + '/content',
        cookies,
      })
    ).statusCode,
  ).toBe(404);
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/api/v1/library-files/' + randomUUID() + '/archive',
        cookies,
        headers,
      })
    ).statusCode,
  ).toBe(404);
  // A malformed base64 payload is an invalid request, not a stored file.
  expect((await upload({ contentBase64: 'not base64!' })).statusCode).toBe(400);
});
