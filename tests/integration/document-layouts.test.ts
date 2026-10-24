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
  AccessError,
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
  expect(html).not.toContain('@page');
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
test('logo uploads are referenced by new immutable keys and retain old bytes', async () => {
  const repo = documentLayoutRepository(pool, tenantId, store.adapter),
    before = (await repo.get())!.version,
    saved = await repo.saveLogo(actorId, logoPng, 'image/png');
  expect(saved).toMatchObject({
    logoMediaType: 'image/png',
    version: before + 1,
  });
  expect(saved.logoKey).toMatch(
    new RegExp(`^logo-${tenantId}-[0-9a-f-]{36}[.]png$`),
  );
  const oldKey = saved.logoKey!;
  expect(store.files.get(oldKey)).toEqual(logoPng);
  const replaced = await repo.saveLogo(actorId, logoJpeg, 'image/jpeg');
  expect(replaced.logoKey).toMatch(
    new RegExp(`^logo-${tenantId}-[0-9a-f-]{36}[.]jpg$`),
  );
  expect(replaced.logoKey).not.toBe(oldKey);
  expect(store.files.get(oldKey)).toEqual(logoPng);
  expect(store.files.get(replaced.logoKey!)).toEqual(logoJpeg);
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

test('a rejected logo upload cannot overwrite an existing logo before authorization', async () => {
  const repo = documentLayoutRepository(pool, tenantId, store.adapter),
    original = await repo.saveLogo(actorId, logoPng, 'image/png'),
    originalBytes = store.files.get(original.logoKey!)!,
    auditBefore = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM audit_events WHERE tenant_id=$1 AND action='document_layout.updated'",
      [tenantId],
    ),
    writes: string[] = [],
    trackedStore: StorageAdapter = {
      ...store.adapter,
      async put(key, bytes) {
        writes.push(key);
        await store.adapter.put(key, bytes);
      },
    };
  await expect(
    documentLayoutRepository(pool, tenantId, trackedStore).saveLogo(
      otherActorId,
      Buffer.concat([logoPng, Buffer.from('unauthorized replacement')]),
      'image/png',
    ),
  ).rejects.toBeInstanceOf(AccessError);
  expect(writes).toEqual([]);
  expect(store.files.get(original.logoKey!)).toEqual(originalBytes);
  expect(await repo.get()).toMatchObject({
    logoKey: original.logoKey,
    logoMediaType: original.logoMediaType,
    version: original.version,
  });
  expect(
    (
      await pool.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM audit_events WHERE tenant_id=$1 AND action='document_layout.updated'",
        [tenantId],
      )
    ).rows[0]!.count,
  ).toBe(auditBefore.rows[0]!.count);
});

test('storage failure cannot replace the active logo bytes or row', async () => {
  const repo = documentLayoutRepository(pool, tenantId, store.adapter),
    original = await repo.saveLogo(actorId, logoPng, 'image/png'),
    originalBytes = store.files.get(original.logoKey!)!,
    unreliableStore: StorageAdapter = {
      ...store.adapter,
      async put(key, bytes) {
        await store.adapter.put(key, bytes);
        throw new Error('synthetic storage failure after write');
      },
    };
  await expect(
    documentLayoutRepository(pool, tenantId, unreliableStore).saveLogo(
      actorId,
      Buffer.concat([logoPng, Buffer.from('new upload')]),
      'image/png',
    ),
  ).rejects.toThrow('synthetic storage failure after write');
  expect(store.files.get(original.logoKey!)).toEqual(originalBytes);
  expect(await repo.get()).toMatchObject({
    logoKey: original.logoKey,
    logoMediaType: original.logoMediaType,
    version: original.version,
  });
});

test('a database failure leaves the active logo immutable and rolls back metadata', async () => {
  const repo = documentLayoutRepository(pool, tenantId, store.adapter),
    original = await repo.saveLogo(actorId, logoPng, 'image/png'),
    originalBytes = store.files.get(original.logoKey!)!,
    auditBefore = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM audit_events WHERE tenant_id=$1 AND action='document_layout.updated'",
      [tenantId],
    );
  await pool.query(`
    CREATE FUNCTION reject_document_layout_audit() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.action = 'document_layout.updated' THEN
        RAISE EXCEPTION 'synthetic layout audit failure';
      END IF;
      RETURN NEW;
    END $$;
  `);
  await pool.query(`
    CREATE TRIGGER reject_document_layout_audit
    BEFORE INSERT ON audit_events FOR EACH ROW
    EXECUTE FUNCTION reject_document_layout_audit()
  `);
  try {
    await expect(
      repo.saveLogo(
        actorId,
        Buffer.concat([logoPng, Buffer.from('database failure')]),
        'image/png',
      ),
    ).rejects.toThrow();
  } finally {
    await pool.query(
      'DROP TRIGGER reject_document_layout_audit ON audit_events',
    );
    await pool.query('DROP FUNCTION reject_document_layout_audit()');
  }
  expect(store.files.get(original.logoKey!)).toEqual(originalBytes);
  expect(await repo.get()).toMatchObject({
    logoKey: original.logoKey,
    logoMediaType: original.logoMediaType,
    version: original.version,
  });
  expect(
    (
      await pool.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM audit_events WHERE tenant_id=$1 AND action='document_layout.updated'",
        [tenantId],
      )
    ).rows[0]!.count,
  ).toBe(auditBefore.rows[0]!.count);
});

test('concurrent logo uploads use distinct immutable storage keys', async () => {
  const originalRepo = documentLayoutRepository(pool, tenantId, store.adapter),
    original = await originalRepo.saveLogo(actorId, logoPng, 'image/png'),
    auditBefore = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM audit_events WHERE tenant_id=$1 AND action='document_layout.updated'",
      [tenantId],
    );
  let entered = 0,
    signalFirst!: () => void,
    signalSecond!: () => void,
    release!: () => void;
  const firstEntered = new Promise<void>((resolve) => (signalFirst = resolve)),
    secondEntered = new Promise<void>((resolve) => (signalSecond = resolve)),
    gate = new Promise<void>((resolve) => (release = resolve)),
    delayedStore: StorageAdapter = {
      ...store.adapter,
      async put(key, bytes) {
        await store.adapter.put(key, bytes);
        entered++;
        if (entered === 1) signalFirst();
        if (entered === 2) signalSecond();
        if (entered === 1) await gate;
      },
    },
    repo = documentLayoutRepository(pool, tenantId, delayedStore),
    firstBytes = Buffer.concat([
      logoPng,
      Buffer.from('first concurrent upload'),
    ]),
    secondBytes = Buffer.concat([
      logoPng,
      Buffer.from('second concurrent upload'),
    ]);
  const firstPending = repo.saveLogo(actorId, firstBytes, 'image/png');
  await firstEntered;
  const secondPending = repo.saveLogo(actorId, secondBytes, 'image/png');
  const secondEnteredWhileFirstBlocked = await Promise.race([
    secondEntered.then(() => true),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 50)),
  ]);
  release();
  const [first, second] = await Promise.all([firstPending, secondPending]);
  expect(secondEnteredWhileFirstBlocked).toBe(false);
  expect(first.logoKey).not.toBe(second.logoKey);
  expect(first.version).toBe(original.version + 1);
  expect(second.version).toBe(original.version + 2);
  expect(store.files.get(first.logoKey!)).toEqual(firstBytes);
  expect(store.files.get(second.logoKey!)).toEqual(secondBytes);
  expect(store.files.has(original.logoKey!)).toBe(true);
  expect(await originalRepo.get()).toMatchObject({
    logoKey: second.logoKey,
    logoMediaType: 'image/png',
    version: original.version + 2,
  });
  expect(
    (
      await pool.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM audit_events WHERE tenant_id=$1 AND action='document_layout.updated'",
        [tenantId],
      )
    ).rows[0]!.count,
  ).toBe(String(Number(auditBefore.rows[0]!.count) + 2));
});

test('logo key constraints retain legacy keys and scope new UUID keys to the tenant', async () => {
  const repo = documentLayoutRepository(pool, tenantId, store.adapter);
  if (!(await repo.get())) await repo.save(actorId, layout);
  await pool.query(
    'UPDATE document_layouts SET logo_key=$1,logo_media_type=$2 WHERE tenant_id=$3',
    [`logo-${tenantId}.png`, 'image/png', tenantId],
  );
  const uploadId = randomUUID(),
    validKey = `logo-${tenantId}-${uploadId}.png`;
  await expect(
    pool.query(
      'UPDATE document_layouts SET logo_key=$1,logo_media_type=$2 WHERE tenant_id=$3',
      [validKey, 'image/png', tenantId],
    ),
  ).resolves.toBeDefined();
  await expect(
    pool.query('UPDATE document_layouts SET logo_key=$1 WHERE tenant_id=$2', [
      `logo-${otherTenantId}-${randomUUID()}.png`,
      tenantId,
    ]),
  ).rejects.toMatchObject({
    code: '23514',
    constraint: 'document_layouts_logo_key_scope',
  });
  await expect(
    pool.query('UPDATE document_layouts SET logo_key=$1 WHERE tenant_id=$2', [
      `logo-${tenantId}-${randomUUID()}.gif`,
      tenantId,
    ]),
  ).rejects.toMatchObject({
    code: '23514',
    constraint: 'document_layouts_logo_key_scope',
  });
  await expect(
    pool.query(
      'UPDATE document_layouts SET logo_key=$1,logo_media_type=$2 WHERE tenant_id=$3',
      [validKey, 'image/jpeg', tenantId],
    ),
  ).rejects.toMatchObject({
    code: '23514',
    constraint: 'document_layouts_logo_key_scope',
  });
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
    expect(saved.json().logoKey).toMatch(
      new RegExp(`^logo-${tenantId}-[0-9a-f-]{36}\\.png$`),
    );
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
