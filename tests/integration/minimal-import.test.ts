import { Writable } from 'node:stream';
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
import { registerAuth, digest } from '../../packages/core/src/auth.js';
import { registerImportRoutes } from '../../packages/core/src/import-routes.js';
import {
  createHealthServer,
  loadRuntimeConfig,
} from '../../packages/core/src/runtime.js';
import { syntheticGoogle } from '../helpers/oidc.js';
import { fictionalImport } from '../fixtures/minimal-import.js';
let container: StartedPostgreSqlContainer, pool: Pool;
const tenantId = randomUUID(),
  foreign = randomUUID();
const logs: string[] = [];
let revokeBeforePreview = false;
const app = createHealthServer(
  loadRuntimeConfig(
    {
      AK_DB_HOST: 'synthetic',
      AK_DB_NAME: 'synthetic',
      AK_DB_USER: 'synthetic',
      AK_DB_PASSWORD_FILE: 'synthetic',
      AK_LOG_LEVEL: 'info',
    },
    () => 'synthetic-long-secret',
  ),
  { database: async () => true, worker: async () => true },
  new Writable({
    write(chunk, _encoding, done) {
      logs.push(String(chunk));
      done();
    },
  }),
);
const url = '/api/v1/imports/bookitup/preview',
  cookies = { '__Host-ak-session': 'fictional-import-session' };
const headers = {
  origin: 'https://admin.example.invalid',
  'x-csrf-token': digest('csrf:fictional-import-session'),
};
beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:17.6-alpine').start();
  pool = new Pool({ connectionString: container.getConnectionUri() });
  await migrate(pool);
  for (const owner of [tenantId, foreign]) {
    await bootstrapAccess(
      pool,
      owner,
      'fictional@example.invalid',
      'Fictional import',
      owner === tenantId ? 'Europe/Berlin' : 'UTC',
    );
    await accessRepository(pool, owner).issueSession(
      { subject: 'fictional-subject', email: 'fictional@example.invalid' },
      digest(
        owner === tenantId
          ? 'fictional-import-session'
          : 'fictional-foreign-session',
      ),
    );
  }
  const actor = (
    await pool.query('SELECT id FROM users WHERE tenant_id=$1', [tenantId])
  ).rows[0].id as string;
  await accessRepository(pool, tenantId).grant(
    actor,
    'fictional-second@example.invalid',
  );
  await accessRepository(pool, tenantId).issueSession(
    { subject: 'fictional-second', email: 'fictional-second@example.invalid' },
    digest('fictional-second-session'),
  );
  const config = {
    origin: headers.origin,
    tenantId,
    clientId: 'synthetic',
    clientSecret: 'synthetic',
  };
  await registerAuth(
    app,
    pool,
    config,
    (await syntheticGoogle(config)).provider,
  );
  app.addHook('preHandler', async () => {
    if (revokeBeforePreview)
      await pool.query(
        "UPDATE memberships SET active=false WHERE tenant_id=$1 AND user_id=(SELECT id FROM users WHERE tenant_id=$1 AND google_subject='fictional-subject')",
        [tenantId],
      );
  });
  registerImportRoutes(app, pool, tenantId);
});
afterAll(async () => {
  await app.close();
  await pool?.end();
  await container?.stop();
});
async function snapshot() {
  return (
    await pool.query(`SELECT
    (SELECT count(*) FROM contacts) AS contacts,
    (SELECT count(*) FROM locations) AS locations,
    (SELECT count(*) FROM master_data) AS master_data,
    (SELECT count(*) FROM events) AS events,
    (SELECT count(*) FROM audit_events) AS audit`)
  ).rows;
}
test('authenticated preview reads tenant timezone, leaves all business/audit tables unchanged, and never logs contents', async () => {
  const before = await snapshot();
  const response = await app.inject({
    method: 'POST',
    url,
    cookies,
    headers,
    payload: fictionalImport(),
  });
  expect(response.statusCode).toBe(200);
  expect(response.headers['cache-control']).toBe('no-store');
  expect(response.json()).toMatchObject({
    valid: true,
    timeZone: 'Europe/Berlin',
    pendingPromises: 1,
    counts: { events: { accepted: 1 } },
  });
  expect(response.json().events[0]).toMatchObject({
    sourceStatus: 'Gebucht',
    requiresResourceReview: true,
  });
  expect(await snapshot()).toEqual(before);
  const bad = await app.inject({
    method: 'POST',
    url,
    cookies,
    headers,
    payload: {
      ...fictionalImport(),
      tenantId: foreign,
      privateField: 'fictional-secret-content',
    },
  });
  expect(bad.json().errors).toEqual([
    { section: 'manifest', row: 0, code: 'invalid_format' },
  ]);
  expect(bad.body).not.toContain('fictional-secret-content');
  const log = logs.join('');
  for (const value of [
    'fictional-secret-content',
    'fictional@example.invalid',
    'Fictional Future Event',
    'fictional-import-session',
    headers['x-csrf-token'],
  ])
    expect(log).not.toContain(value);
});
test('rejects anonymous, cross-tenant and CSRF requests and malformed/excessive bodies', async () => {
  const request = {
    method: 'POST' as const,
    url,
    headers,
    cookies,
    payload: fictionalImport(),
  };
  expect((await app.inject({ ...request, cookies: {} })).statusCode).toBe(401);
  expect(
    (
      await app.inject({
        ...request,
        cookies: { '__Host-ak-session': 'fictional-foreign-session' },
      })
    ).statusCode,
  ).toBe(401);
  expect((await app.inject({ ...request, headers: {} })).statusCode).toBe(403);
  expect(
    (
      await app.inject({
        ...request,
        headers: { ...headers, origin: 'https://foreign.example.invalid' },
      })
    ).statusCode,
  ).toBe(403);
  expect(
    (
      await app.inject({
        ...request,
        headers: { ...headers, 'content-type': 'application/json' },
        payload: '{private-value',
      })
    ).json(),
  ).toEqual({ error: 'invalid_request' });
  expect(
    (
      await app.inject({
        ...request,
        headers: { ...headers, 'content-type': 'application/json' },
        payload: JSON.stringify('x'.repeat(4 * 1024 * 1024)),
      })
    ).statusCode,
  ).toBe(413);
});

test('rechecks administrator access after session authentication', async () => {
  revokeBeforePreview = true;
  try {
    expect(
      (
        await app.inject({
          method: 'POST',
          url,
          cookies,
          headers,
          payload: fictionalImport(),
        })
      ).statusCode,
    ).toBe(403);
  } finally {
    revokeBeforePreview = false;
    await pool.query('UPDATE memberships SET active=true WHERE tenant_id=$1', [
      tenantId,
    ]);
  }
});
