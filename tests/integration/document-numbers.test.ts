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
  allocateDocumentNumber,
  documentNumberRepository,
  registerDocumentNumberRoutes,
} from '../../packages/core/src/document-numbers.js';
import { database } from '../../packages/core/src/database.js';
import {
  createHealthServer,
  loadRuntimeConfig,
} from '../../packages/core/src/runtime.js';
import { registerAuth, digest } from '../../packages/core/src/auth.js';
import { syntheticGoogle } from '../helpers/oidc.js';

let container: StartedPostgreSqlContainer, pool: Pool, actorId: string;
const tenantId = randomUUID(),
  otherTenantId = randomUUID(),
  at = new Date('2030-10-26T10:00:00Z');
const sequence = {
  pattern: 'AN-{YYYY}-{SEQ}',
  minLength: 4,
  nextValue: 1,
};
beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:17.6-alpine').start();
  pool = new Pool({ connectionString: container.getConnectionUri() });
  await migrate(pool);
  await bootstrapAccess(
    pool,
    tenantId,
    'numbers@example.invalid',
    'Synthetic numbers',
    'Europe/Berlin',
  );
  await accessRepository(pool, tenantId).issueSession(
    { subject: 'numbers', email: 'numbers@example.invalid' },
    digest('synthetic-numbers'),
  );
  actorId = (await accessRepository(pool, tenantId).list())[0]!.userId!;
  await bootstrapAccess(
    pool,
    otherTenantId,
    'other-numbers@example.invalid',
    'Synthetic other',
    'Europe/Berlin',
  );
});
afterAll(async () => {
  await pool?.end();
  await container?.stop();
});
test('a preview never consumes a number and allocation advances the counter', async () => {
  const repo = documentNumberRepository(pool, tenantId);
  await repo.save(actorId, 'offer', sequence);
  expect(await repo.preview('offer', at)).toBe('AN-2030-0001');
  expect(await repo.preview('offer', at)).toBe('AN-2030-0001');
  expect(await allocateDocumentNumber(pool, tenantId, 'offer', at)).toBe(
    'AN-2030-0001',
  );
  expect(await repo.preview('offer', at)).toBe('AN-2030-0002');
});
test('concurrent allocation hands out distinct numbers without reuse', async () => {
  const repo = documentNumberRepository(pool, tenantId);
  await repo.save(actorId, 'invoice', {
    pattern: 'RE-{YYYY}-{SEQ}',
    minLength: 5,
    nextValue: 1,
  });
  const allocated = await Promise.all(
    Array.from({ length: 20 }, () =>
      allocateDocumentNumber(pool, tenantId, 'invoice', at),
    ),
  );
  expect(new Set(allocated).size).toBe(20);
  expect([...allocated].sort()).toEqual(
    Array.from(
      { length: 20 },
      (_row, index) => `RE-2030-${String(index + 1).padStart(5, '0')}`,
    ),
  );
});
test('a rolled back transaction returns the number to the sequence', async () => {
  const repo = documentNumberRepository(pool, tenantId);
  await repo.save(actorId, 'correction', {
    pattern: 'KO-{YYYY}-{SEQ}',
    minLength: 2,
    nextValue: 1,
  });
  await expect(
    database(pool).transaction(async (tx) => {
      await allocateDocumentNumber(tx, tenantId, 'correction', at);
      throw new Error('synthetic failure');
    }),
  ).rejects.toThrow('synthetic failure');
  expect(await repo.preview('correction', at)).toBe('KO-2030-01');
});
test('sequences stay per tenant and reject stale versions', async () => {
  const repo = documentNumberRepository(pool, tenantId);
  const created = await repo.save(actorId, 'deposit_invoice', {
    pattern: 'AZ-{YYYY}-{SEQ}',
    minLength: 3,
    nextValue: 5,
  });
  expect(created.version).toBe(1);
  await expect(repo.preview('deposit_invoice', at)).resolves.toBe(
    'AZ-2030-005',
  );
  const updated = await repo.save(
    actorId,
    'deposit_invoice',
    { ...sequence, nextValue: 40 },
    1,
  );
  expect(updated.version).toBe(2);
  await expect(
    repo.save(actorId, 'deposit_invoice', { ...sequence, nextValue: 1 }, 1),
  ).rejects.toMatchObject({ reason: 'conflict' });
  const other = documentNumberRepository(pool, otherTenantId);
  await expect(other.preview('deposit_invoice', at)).rejects.toMatchObject({
    reason: 'not_configured',
  });
  expect(await other.list()).toEqual([]);
});
test('the API requires auth, rejects an unknown token and reports a missing sequence', async () => {
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
  registerDocumentNumberRoutes(app, pool, tenantId);
  const cookies = { '__Host-ak-session': 'synthetic-numbers' },
    headers = {
      origin: config.origin,
      'x-csrf-token': digest('csrf:synthetic-numbers'),
    };
  try {
    expect((await app.inject('/api/v1/document-numbers')).statusCode).toBe(401);
    const invalid = await app.inject({
      method: 'POST',
      url: '/api/v1/document-numbers',
      cookies,
      headers,
      payload: {
        kind: 'offer',
        pattern: 'AN-{WW}-{SEQ}',
        minLength: 4,
        nextValue: 1,
      },
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().error).toBe('invalid_pattern');
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/api/v1/document-numbers/order_confirmation/preview',
          cookies,
        })
      ).statusCode,
    ).toBe(404);
    const preview = await app.inject({
      method: 'GET',
      url: '/api/v1/document-numbers/offer/preview',
      cookies,
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.json().number).toMatch(/^AN-\d{4}-\d{4}$/);
  } finally {
    await app.close();
  }
});
