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
import { resourceRepository } from '../../packages/core/src/resources.js';
let container: StartedPostgreSqlContainer;
let pool: Pool;
const tenantId = randomUUID();
let actorId: string;
beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:17.6-alpine').start();
  pool = new Pool({ connectionString: container.getConnectionUri() });
  await migrate(pool);
  await bootstrapAccess(
    pool,
    tenantId,
    'resources@example.invalid',
    'Synthetic resources',
    'Europe/Berlin',
  );
  await accessRepository(pool, tenantId).issueSession(
    { subject: 'resources', email: 'resources@example.invalid' },
    'synthetic-hash',
  );
  actorId = (await accessRepository(pool, tenantId).list())[0]!.userId!;
});
afterAll(async () => {
  await pool?.end();
  await container?.stop();
});
test('resource defaults, validation, isolation and historical archive', async () => {
  const repo = resourceRepository(pool, tenantId);
  const rows = await repo.list();
  expect(rows.map((r) => r.code)).toEqual([
    'FB1',
    'FB2',
    'GLAMOUR',
    'SCHWARZWALD',
  ]);
  expect(rows[0]).toMatchObject({
    quantity: 1,
    beforeDays: 2,
    afterDays: 2,
    blocked: false,
  });
  const input = {
    name: 'Synthetic resource',
    code: 'SYNTHETIC',
    category: 'Synthetic accessory',
    description: 'Fictional',
    quantity: 1,
    beforeDays: 0,
    afterDays: 0,
    blocked: false,
    state: 'active' as const,
    position: 4,
  };
  const row = await repo.save(actorId, input);
  await pool.query(
    'CREATE TABLE synthetic_resource_history(tenant_id uuid, resource_id uuid, FOREIGN KEY(tenant_id,resource_id) REFERENCES resources(tenant_id,id))',
  );
  await pool.query('INSERT INTO synthetic_resource_history VALUES($1,$2)', [
    tenantId,
    row.id,
  ]);
  const archived = await repo.save(
    actorId,
    { ...input, state: 'archived', quantity: 0, blocked: true },
    row.id,
    1,
  );
  expect(archived).toMatchObject({
    state: 'archived',
    quantity: 0,
    blocked: true,
    version: 2,
  });
  await expect(repo.save(actorId, input, row.id, 1)).rejects.toThrow(
    'conflict',
  );
  await expect(repo.save(actorId, input, randomUUID(), 1)).rejects.toThrow(
    'not_found',
  );
  await expect(repo.save(randomUUID(), input)).rejects.toThrow('forbidden');
  await expect(
    repo.save(actorId, { ...input, code: 'INVALID', quantity: -1 }),
  ).rejects.toThrow();
  await expect(repo.save(actorId, input)).rejects.toThrow();
  expect(await resourceRepository(pool, randomUUID()).list()).toEqual([]);
  await expect(
    pool.query('DELETE FROM resources WHERE tenant_id=$1 AND id=$2', [
      tenantId,
      row.id,
    ]),
  ).rejects.toMatchObject({ code: '23503' });
});

test('resource API validates writes, protects authorization and rolls back failed audit', async () => {
  const { createHealthServer, loadRuntimeConfig } =
    await import('../../packages/core/src/runtime.js');
  const { registerAuth, digest } =
    await import('../../packages/core/src/auth.js');
  const { registerResourceRoutes } =
    await import('../../packages/core/src/resources.js');
  const { syntheticGoogle } = await import('../helpers/oidc.js');
  const config = {
    origin: 'https://admin.example.invalid',
    tenantId,
    clientId: 'synthetic',
    clientSecret: 'synthetic',
  };
  await accessRepository(pool, tenantId).issueSession(
    { subject: 'resources', email: 'resources@example.invalid' },
    digest('synthetic-cookie'),
  );
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
  registerResourceRoutes(app, pool, tenantId);
  const cookies = { '__Host-ak-session': 'synthetic-cookie' },
    headers = {
      origin: config.origin,
      'x-csrf-token': digest('csrf:synthetic-cookie'),
    };
  const input = {
    name: 'Synthetic API box',
    code: 'API',
    category: 'Synthetic',
    description: '',
    quantity: 1,
    beforeDays: 2,
    afterDays: 2,
    position: 10,
    state: 'active',
    blocked: false,
  };
  try {
    expect((await app.inject('/api/v1/resources')).statusCode).toBe(401);
    expect(
      (await app.inject({ url: '/api/v1/resources', cookies })).json(),
    ).toHaveLength(5);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/resources',
          cookies,
          payload: input,
        })
      ).statusCode,
    ).toBe(403);
    const create = (payload: unknown) =>
      app.inject({
        method: 'POST',
        url: '/api/v1/resources',
        cookies,
        headers,
        payload: payload as Record<string, unknown>,
      });
    expect((await create({ ...input, quantity: -1 })).statusCode).toBe(400);
    const created = await create(input);
    expect(created.statusCode).toBe(201);
    expect(created.json()).not.toHaveProperty('tenantId');
    expect((await create(input)).statusCode).toBe(409);
    const put = (id: string, version: number) =>
      app.inject({
        method: 'PUT',
        url: '/api/v1/resources/' + id,
        cookies,
        headers,
        payload: { ...input, blocked: true, version },
      });
    expect((await put(created.json().id, 1)).statusCode).toBe(200);
    expect((await put(created.json().id, 1)).statusCode).toBe(409);
    expect((await put(randomUUID(), 1)).statusCode).toBe(404);
    await pool.query(
      'ALTER TABLE audit_events RENAME TO temporarily_missing_audit',
    );
    try {
      expect((await create({ ...input, code: 'ROLLBACK' })).statusCode).toBe(
        500,
      );
    } finally {
      await pool.query(
        'ALTER TABLE temporarily_missing_audit RENAME TO audit_events',
      );
    }
    expect(
      (await resourceRepository(pool, tenantId).list()).some(
        (r) => r.code === 'ROLLBACK',
      ),
    ).toBe(false);
  } finally {
    await app.close();
  }
});
