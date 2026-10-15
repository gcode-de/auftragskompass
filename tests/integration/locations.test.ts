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
  locationRepository,
  registerLocationRoutes,
} from '../../packages/core/src/locations.js';
import {
  createHealthServer,
  loadRuntimeConfig,
} from '../../packages/core/src/runtime.js';
import { registerAuth, digest } from '../../packages/core/src/auth.js';
import { syntheticGoogle } from '../helpers/oidc.js';
let container: StartedPostgreSqlContainer;
let pool: Pool;
const tenantId = randomUUID();
let actorId: string;
const input = {
  name: 'Synthetic venue',
  street: 'Fictional street',
  postalCode: '00000',
  city: 'Synthetic city',
  country: 'DE',
  state: 'active' as const,
};
beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:17.6-alpine').start();
  pool = new Pool({ connectionString: container.getConnectionUri() });
  await migrate(pool);
  await bootstrapAccess(
    pool,
    tenantId,
    'locations@example.invalid',
    'Synthetic locations',
    'Europe/Berlin',
  );
  await accessRepository(pool, tenantId).issueSession(
    { subject: 'locations', email: 'locations@example.invalid' },
    digest('synthetic-locations'),
  );
  actorId = (await accessRepository(pool, tenantId).list())[0]!.userId!;
});
afterAll(async () => {
  await pool?.end();
  await container?.stop();
});
test('locations search literally, preserve archived references and reject stale changes', async () => {
  const repo = locationRepository(pool, tenantId),
    row = await repo.save(actorId, input);
  expect(await repo.list('SYNTHETIC')).toHaveLength(1);
  expect(await repo.list('%')).toEqual([]);
  await pool.query(
    'CREATE TABLE synthetic_location_history(tenant_id uuid, location_id uuid, FOREIGN KEY(tenant_id,location_id) REFERENCES locations(tenant_id,id))',
  );
  await pool.query('INSERT INTO synthetic_location_history VALUES($1,$2)', [
    tenantId,
    row.id,
  ]);
  await repo.save(actorId, { ...input, state: 'archived' }, row.id, 1);
  expect((await repo.list())[0]!.state).toBe('archived');
  await expect(repo.save(actorId, input, row.id, 1)).rejects.toThrow(
    'conflict',
  );
  await expect(repo.save(actorId, input, randomUUID(), 1)).rejects.toThrow(
    'not_found',
  );
  await expect(repo.save(randomUUID(), input)).rejects.toThrow('forbidden');
  await expect(repo.save(actorId, { ...input, name: ' ' })).rejects.toThrow();
  expect(await locationRepository(pool, randomUUID()).list()).toEqual([]);
  await expect(
    pool.query('DELETE FROM locations WHERE tenant_id=$1 AND id=$2', [
      tenantId,
      row.id,
    ]),
  ).rejects.toMatchObject({ code: '23503' });
});
test('location API validates, authorizes and keeps audit atomic', async () => {
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
  registerLocationRoutes(app, pool, tenantId);
  const cookies = { '__Host-ak-session': 'synthetic-locations' },
    headers = {
      origin: config.origin,
      'x-csrf-token': digest('csrf:synthetic-locations'),
    };
  const create = (payload: unknown) =>
    app.inject({
      method: 'POST',
      url: '/api/v1/locations',
      cookies,
      headers,
      payload: payload as Record<string, unknown>,
    });
  try {
    expect((await app.inject('/api/v1/locations')).statusCode).toBe(401);
    expect(
      (
        await app.inject({ url: '/api/v1/locations?q=Synthetic', cookies })
      ).json(),
    ).toHaveLength(1);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/locations',
          cookies,
          payload: input,
        })
      ).statusCode,
    ).toBe(403);
    for (const bad of [
      { name: ' ' },
      { country: 'invalid' },
      { state: 'deleted' },
      { street: 'x'.repeat(201) },
    ])
      expect((await create({ ...input, ...bad })).statusCode).toBe(400);
    const created = await create(input);
    expect(created.statusCode).toBe(201);
    expect(created.json()).not.toHaveProperty('tenantId');
    const update = (id: string, version: number) =>
      app.inject({
        method: 'PUT',
        url: '/api/v1/locations/' + id,
        cookies,
        headers,
        payload: { ...input, state: 'archived', version },
      });
    expect((await update(created.json().id, 1)).statusCode).toBe(200);
    expect((await update(created.json().id, 1)).statusCode).toBe(409);
    expect((await update(randomUUID(), 1)).statusCode).toBe(404);
    await pool.query(
      'ALTER TABLE audit_events RENAME TO temporarily_missing_audit',
    );
    try {
      expect(
        (await create({ ...input, name: 'Must roll back' })).statusCode,
      ).toBe(500);
    } finally {
      await pool.query(
        'ALTER TABLE temporarily_missing_audit RENAME TO audit_events',
      );
    }
    expect(
      await locationRepository(pool, tenantId).list('Must roll back'),
    ).toEqual([]);
  } finally {
    await app.close();
  }
});
