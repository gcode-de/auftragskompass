import { afterAll, beforeAll, expect, test } from 'vitest';
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { migrate } from '../../packages/core/src/identity.js';
import {
  bootstrapAccess,
  accessRepository,
} from '../../packages/core/src/access.js';
import {
  documentLayoutRepository,
  registerDocumentLayoutRoutes,
  renderDocumentHtml,
  logoLimit,
  type DocumentLayoutInput,
} from '../../packages/core/src/document-layouts.js';
import type { StorageAdapter } from '../../packages/core/src/storage.js';
import {
  createHealthServer,
  loadRuntimeConfig,
} from '../../packages/core/src/runtime.js';
import { registerAuth, digest } from '../../packages/core/src/auth.js';
import { syntheticGoogle } from '../helpers/oidc.js';

let container: StartedPostgreSqlContainer,
  pool: Pool,
  actorId: string,
  otherActorId: string;
const tenantId = randomUUID(),
  otherTenantId = randomUUID();

function memoryStore() {
  const files = new Map<string, Buffer>();
  const adapter: StorageAdapter = {
    async put(key, bytes) {
      files.set(key, Buffer.from(bytes));
    },
    async read(key) {
      const bytes = files.get(key);
      if (!bytes) throw new Error('missing');
      return bytes;
    },
    async remove(key) {
      files.delete(key);
    },
  };
  return { files, adapter };
}
const store = memoryStore(),
  otherStore = memoryStore();
const layout: DocumentLayoutInput = {
  senderName: 'Fictional Studio',
  senderStreet: 'Synthetic Street 1',
  senderPostalCode: '12345',
  senderCity: 'Fictional Town',
  primaryColor: '#2f6f4f',
  textColor: '#1b1b1b',
  fontFamily: 'serif',
  showPageNumbers: false,
  showPositionNumbers: true,
};
beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:17.6-alpine').start();
  pool = new Pool({ connectionString: container.getConnectionUri() });
  await migrate(pool);
  await bootstrapAccess(
    pool,
    tenantId,
    'layout@example.invalid',
    'Synthetic layout',
    'Europe/Berlin',
  );
  await accessRepository(pool, tenantId).issueSession(
    { subject: 'layout', email: 'layout@example.invalid' },
    digest('synthetic-layout'),
  );
  actorId = (await accessRepository(pool, tenantId).list())[0]!.userId!;
  await bootstrapAccess(
    pool,
    otherTenantId,
    'other-layout@example.invalid',
    'Synthetic other',
    'Europe/Berlin',
  );
  // An allowed account only has a user id once it has actually signed in.
  await accessRepository(pool, otherTenantId).issueSession(
    { subject: 'other-layout', email: 'other-layout@example.invalid' },
    digest('synthetic-other-layout'),
  );
  otherActorId = (await accessRepository(pool, otherTenantId).list())[0]!
    .userId!;
});
afterAll(async () => {
  await pool?.end();
  await container?.stop();
});
test('a layout is stored per tenant, versioned and rendered deterministically', async () => {
  const repo = documentLayoutRepository(pool, tenantId, store.adapter);
  expect(await repo.get()).toBeNull();
  const created = await repo.save(actorId, layout);
  expect(created.version).toBe(1);
  expect(created.senderName).toBe('Fictional Studio');
  const updated = await repo.save(
    actorId,
    { ...layout, senderCity: 'Other Town' },
    1,
  );
  expect(updated.version).toBe(2);
  await expect(repo.save(actorId, layout, 1)).rejects.toMatchObject({
    reason: 'conflict',
  });
  const html = renderDocumentHtml({
    layout: {
      ...updated,
      fontFamily: updated.fontFamily as DocumentLayoutInput['fontFamily'],
    },
    documentNumber: 'RE-2030-0001',
    issuedAt: new Date('2030-10-26T10:00:00Z'),
    timeZone: 'Europe/Berlin',
    recipientName: 'Fictional Customer',
    recipientAddress: 'Example Street 2',
    subject: 'Rechnung {{contact}}',
    introText: 'Hallo {{contact}},',
    outroText: 'Zahlbar innerhalb von 14 Tagen.',
    lines: [
      {
        description: 'Fictional box',
        unit: 'Stück',
        quantity: 1,
        unitPriceMinor: 19900,
        taxBasisPoints: 1900,
        discountBasisPoints: 0,
      },
    ],
    values: { contact: 'Fictional Customer' },
  });
  expect(html).toContain('Other Town');
  expect(html).toContain('Georgia, "Times New Roman", serif');
  expect(html).toContain('class="page-numbers" hidden');
  expect(html).toContain('199,00');
});
test('layouts stay inside their tenant', async () => {
  const other = documentLayoutRepository(
    pool,
    otherTenantId,
    otherStore.adapter,
  );
  expect(await other.get()).toBeNull();
  const created = await other.save(otherActorId, {
    ...layout,
    senderName: 'Other Studio',
  });
  expect(created.senderName).toBe('Other Studio');
  expect(
    (await documentLayoutRepository(pool, tenantId, store.adapter).get())
      ?.senderName,
  ).toBe('Fictional Studio');
});
test('the layout API requires auth, validates colours and reports conflicts', async () => {
  const config = {
    origin: 'https://admin.example.invalid',
    tenantId,
    clientId: 'synthetic',
    clientSecret: 'synthetic',
  };
  const app = createHealthServer(
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
  registerDocumentLayoutRoutes(app, pool, tenantId, store.adapter);
  const cookies = { '__Host-ak-session': 'synthetic-layout' },
    headers = {
      origin: config.origin,
      'x-csrf-token': digest('csrf:synthetic-layout'),
    };
  try {
    expect((await app.inject('/api/v1/document-layout')).statusCode).toBe(401);
    const invalid = await app.inject({
      method: 'PUT',
      url: '/api/v1/document-layout',
      cookies,
      headers,
      payload: { ...layout, primaryColor: 'green', version: 2 },
    });
    expect(invalid.statusCode).toBe(400);
    const stale = await app.inject({
      method: 'PUT',
      url: '/api/v1/document-layout',
      cookies,
      headers,
      payload: { ...layout, version: 1 },
    });
    expect(stale.statusCode).toBe(409);
    const current = await app.inject({
      method: 'PUT',
      url: '/api/v1/document-layout',
      cookies,
      headers,
      payload: { ...layout, version: 2 },
    });
    expect(current.statusCode).toBe(200);
    expect(current.json().version).toBe(3);
    const read = await app.inject({
      method: 'GET',
      url: '/api/v1/document-layout',
      cookies,
    });
    expect(read.statusCode).toBe(200);
    expect(read.json().senderName).toBe('Fictional Studio');
  } finally {
    await app.close();
  }
});

const logoPng = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from('synthetic png body'),
  ]),
  logoJpeg = Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
    Buffer.from('synthetic jpeg body'),
  ]);
test('a logo is stored, referenced and replaced without leftovers', async () => {
  const repo = documentLayoutRepository(pool, tenantId, store.adapter),
    before = (await repo.get())!.version,
    saved = await repo.saveLogo(actorId, logoPng, 'image/png');
  expect(saved).toMatchObject({
    logoKey: `logo-${tenantId}.png`,
    logoMediaType: 'image/png',
    version: before + 1,
  });
  expect(store.files.get(`logo-${tenantId}.png`)).toEqual(logoPng);
  const replaced = await repo.saveLogo(actorId, logoJpeg, 'image/jpeg');
  expect(replaced.logoKey).toBe(`logo-${tenantId}.jpg`);
  expect(store.files.has(`logo-${tenantId}.png`)).toBe(false);
  expect(store.files.get(`logo-${tenantId}.jpg`)).toEqual(logoJpeg);
  expect(
    (
      await documentLayoutRepository(
        pool,
        otherTenantId,
        otherStore.adapter,
      ).get()
    )?.logoKey,
  ).toBeNull();
});
test('logo uploads reject the wrong bytes and oversized bodies', async () => {
  const repo = documentLayoutRepository(pool, tenantId, store.adapter),
    before = (await repo.get())!.logoKey;
  await expect(
    repo.saveLogo(actorId, Buffer.from('%PDF-1.4'), 'image/png'),
  ).rejects.toMatchObject({ reason: 'invalid_logo' });
  await expect(
    repo.saveLogo(actorId, logoPng, 'image/jpeg'),
  ).rejects.toMatchObject({ reason: 'invalid_logo' });
  await expect(
    repo.saveLogo(actorId, Buffer.from('plain text'), 'text/plain'),
  ).rejects.toMatchObject({ reason: 'invalid_logo' });
  await expect(
    repo.saveLogo(actorId, Buffer.alloc(0), 'image/png'),
  ).rejects.toMatchObject({ reason: 'invalid_logo' });
  await expect(
    repo.saveLogo(
      actorId,
      Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        Buffer.alloc(logoLimit),
      ]),
      'image/png',
    ),
  ).rejects.toMatchObject({ reason: 'logo_too_large' });
  expect((await repo.get())!.logoKey).toBe(before);
});
test('the logo endpoint enforces auth, csrf, type and size', async () => {
  const config = {
    origin: 'https://admin.example.invalid',
    tenantId,
    clientId: 'synthetic',
    clientSecret: 'synthetic',
  };
  const app = createHealthServer(
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
  registerDocumentLayoutRoutes(app, pool, tenantId, store.adapter);
  const cookies = { '__Host-ak-session': 'synthetic-layout' },
    headers = {
      origin: config.origin,
      'x-csrf-token': digest('csrf:synthetic-layout'),
      'content-type': 'image/png',
    };
  try {
    expect(
      (
        await app.inject({
          method: 'PUT',
          url: '/api/v1/document-layout/logo',
          cookies,
          headers: { 'content-type': 'image/png' },
          payload: logoPng,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: 'PUT',
          url: '/api/v1/document-layout/logo',
          headers,
          payload: logoPng,
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: 'PUT',
          url: '/api/v1/document-layout/logo',
          cookies,
          headers: { ...headers, 'content-type': 'image/gif' },
          payload: Buffer.from('GIF89a'),
        })
      ).statusCode,
    ).toBe(415);
    expect(
      (
        await app.inject({
          method: 'PUT',
          url: '/api/v1/document-layout/logo',
          cookies,
          headers,
          payload: Buffer.from('not a png'),
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: 'PUT',
          url: '/api/v1/document-layout/logo',
          cookies,
          headers,
          payload: Buffer.concat([
            Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
            Buffer.alloc(logoLimit + 1),
          ]),
        })
      ).statusCode,
    ).toBe(413);
    const saved = await app.inject({
      method: 'PUT',
      url: '/api/v1/document-layout/logo',
      cookies,
      headers,
      payload: logoPng,
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().logoMediaType).toBe('image/png');
    expect(saved.json().logoKey).toBe(`logo-${tenantId}.png`);
    await pool.query('DELETE FROM document_layouts WHERE tenant_id=$1', [
      tenantId,
    ]);
    expect(
      (
        await app.inject({
          method: 'PUT',
          url: '/api/v1/document-layout/logo',
          cookies,
          headers,
          payload: logoPng,
        })
      ).statusCode,
    ).toBe(404);
  } finally {
    await app.close();
  }
});
