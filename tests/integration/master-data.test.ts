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
  masterDataRepository,
  registerMasterDataRoutes,
} from '../../packages/core/src/master-data.js';
import {
  createHealthServer,
  loadRuntimeConfig,
} from '../../packages/core/src/runtime.js';
import { registerAuth, digest } from '../../packages/core/src/auth.js';
import { syntheticGoogle } from '../helpers/oidc.js';
let container: StartedPostgreSqlContainer;
let pool: Pool;
const tenantId = randomUUID();
let userId: string;
beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:17.6-alpine').start();
  pool = new Pool({ connectionString: container.getConnectionUri() });
  await migrate(pool);
  await bootstrapAccess(
    pool,
    tenantId,
    'master@example.invalid',
    'Synthetic master',
    'Europe/Berlin',
  );
  await accessRepository(pool, tenantId).issueSession(
    { subject: 'master', email: 'master@example.invalid' },
    digest('synthetic-session'),
  );
  userId = (await accessRepository(pool, tenantId).list())[0]!.userId!;
});
afterAll(async () => {
  await pool?.end();
  await container?.stop();
});
test('seven configurable types, packages, versions, sorting and historic references', async () => {
  const repo = masterDataRepository(pool, tenantId);
  expect((await repo.list('event_type')).map((r) => r.name)).toEqual([
    'Hochzeit',
    'Geburtstag',
    'Firmenfeier',
    'Weihnachtsfeier',
    'sonstiges',
  ]);
  for (let i = 0; i < 7; i++)
    await repo.create(userId, 'event_type', {
      name: `Synthetic type ${i}`,
      position: 7 - i,
      state: 'active',
    });
  const types = await repo.list('event_type');
  expect(types).toHaveLength(12);
  expect(types.find((t) => t.name.startsWith('Synthetic'))!.name).toBe(
    'Synthetic type 6',
  );
  const pkg = await repo.create(userId, 'package', {
    name: 'Synthetic package',
    position: 0,
    state: 'active',
  });
  await pool.query(
    'CREATE TABLE synthetic_history (tenant_id uuid, master_id uuid, FOREIGN KEY(tenant_id,master_id) REFERENCES master_data(tenant_id,id))',
  );
  await pool.query('INSERT INTO synthetic_history VALUES ($1,$2)', [
    tenantId,
    pkg.id,
  ]);
  const archived = await repo.update(userId, 'package', pkg.id, {
    name: 'Renamed synthetic',
    position: 2,
    state: 'archived',
    version: 1,
  });
  expect(archived.version).toBe(2);
  expect((await pool.query('SELECT * FROM synthetic_history')).rowCount).toBe(
    1,
  );
  await expect(
    repo.update(userId, 'package', pkg.id, {
      name: 'Stale',
      position: 0,
      state: 'active',
      version: 1,
    }),
  ).rejects.toThrow('conflict');
  const attempts = await Promise.allSettled([
    repo.update(userId, 'package', pkg.id, {
      name: 'Concurrent A',
      position: 0,
      state: 'inactive',
      version: 2,
    }),
    repo.update(userId, 'package', pkg.id, {
      name: 'Concurrent B',
      position: 0,
      state: 'active',
      version: 2,
    }),
  ]);
  expect(attempts.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  expect(
    await masterDataRepository(pool, randomUUID()).list('package'),
  ).toEqual([]);
  await expect(
    repo.update(userId, 'event_type', pkg.id, {
      name: 'Wrong kind',
      position: 0,
      state: 'active',
      version: 3,
    }),
  ).rejects.toThrow('not_found');
  await expect(
    repo.create(randomUUID(), 'package', {
      name: 'Forbidden',
      position: 0,
      state: 'active',
    }),
  ).rejects.toThrow('forbidden');
  await expect(
    repo.create(userId, 'package', {
      name: ' ',
      position: -1,
      state: 'active',
    }),
  ).rejects.toThrow();
  await expect(
    pool.query('DELETE FROM master_data WHERE id=$1', [pkg.id]),
  ).rejects.toThrow();
});
test('authenticated API validates, isolates and exposes fixed statuses', async () => {
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
  registerMasterDataRoutes(app, pool, tenantId);
  const cookies = { '__Host-ak-session': 'synthetic-session' },
    headers = {
      origin: config.origin,
      'x-csrf-token': digest('csrf:synthetic-session'),
    };
  try {
    expect((await app.inject('/api/v1/master-data/package')).statusCode).toBe(
      401,
    );
    const create = (name: string) =>
      app.inject({
        method: 'POST',
        url: '/api/v1/master-data/package',
        cookies,
        headers,
        payload: { name, position: 0, state: 'active' },
      });
    expect((await create('')).statusCode).toBe(400);
    const created = await create('API synthetic');
    expect(created.statusCode).toBe(201);
    expect(created.json()).not.toHaveProperty('tenantId');
    expect((await create(' api SYNTHETIC ')).statusCode).toBe(409);
    const put = (id: string, version: number) =>
      app.inject({
        method: 'PUT',
        url: '/api/v1/master-data/package/' + id,
        cookies,
        headers,
        payload: {
          name: 'API edited',
          position: 1,
          state: 'archived',
          version,
        },
      });
    expect((await put(created.json().id, 1)).statusCode).toBe(200);
    expect((await put(created.json().id, 1)).statusCode).toBe(409);
    expect((await put(randomUUID(), 1)).statusCode).toBe(404);
    expect(
      (await app.inject({ url: '/api/v1/master-data/unknown', cookies }))
        .statusCode,
    ).toBe(400);
    expect(
      (await app.inject({ url: '/api/v1/statuses', cookies }))
        .json()
        .map((s: { label: string }) => s.label),
    ).toEqual([
      'Anfrage',
      'Option',
      'Gebucht',
      'Nicht verfügbar',
      'Annulliert',
    ]);
    expect(
      (
        await app.inject({
          method: 'PUT',
          url: '/api/v1/statuses',
          cookies,
          headers,
          payload: {},
        })
      ).statusCode,
    ).toBe(404);
    await pool.query(
      'ALTER TABLE audit_events RENAME TO temporarily_missing_audit',
    );
    try {
      expect((await create('Must roll back')).statusCode).toBe(500);
    } finally {
      await pool.query(
        'ALTER TABLE temporarily_missing_audit RENAME TO audit_events',
      );
    }
    expect(
      (await masterDataRepository(pool, tenantId).list('package')).some(
        (p) => p.name === 'Must roll back',
      ),
    ).toBe(false);
  } finally {
    await app.close();
  }
});
