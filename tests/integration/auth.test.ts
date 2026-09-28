import { afterAll, beforeAll, expect, test } from 'vitest';
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { Pool } from 'pg';
import type { FastifyInstance } from 'fastify';
import {
  createHealthServer,
  loadRuntimeConfig,
} from '../../packages/core/src/runtime.js';
import { randomUUID } from 'node:crypto';
import {
  migrate,
  identityRepository,
} from '../../packages/core/src/identity.js';
import { registerAuth } from '../../packages/core/src/auth.js';
import { syntheticGoogle } from '../helpers/oidc.js';
let container: StartedPostgreSqlContainer;
let pool: Pool;
const config = {
  origin: 'https://admin.example.invalid',
  tenantId: randomUUID(),
  clientId: 'synthetic',
  clientSecret: 'synthetic-secret',
};
let google: Awaited<ReturnType<typeof syntheticGoogle>>;
let app: FastifyInstance;
beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:17.6-alpine').start();
  pool = new Pool({ connectionString: container.getConnectionUri() });
  await migrate(pool);
  const identities = identityRepository(pool, config.tenantId);
  await identities.createTenant('Synthetic auth', 'Europe/Berlin');
  await identities.addAdministrator(
    'synthetic-subject',
    'synthetic@example.invalid',
  );
  google = await syntheticGoogle(config);
});
afterAll(async () => {
  await app?.close();
  await pool?.end();
  await container?.stop();
});
async function server(enabled = true, tenantId = config.tenantId) {
  await app?.close();
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
    enabled ? { ...config, tenantId } : undefined,
    enabled ? google.provider : undefined,
  );
  app.post(
    '/api/test',
    {
      schema: {
        body: { type: 'object', properties: {}, additionalProperties: false },
      },
    },
    async () => ({ ok: true }),
  );
  return app;
}
async function start(overrides?: Record<string, unknown>) {
  const response = await app.inject(
    '/auth/login?returnTo=https://evil.invalid',
  );
  expect(response.statusCode).toBe(302);
  expect(
    new URL(response.headers.location!).searchParams.get('redirect_uri'),
  ).toBe(`${config.origin}/auth/callback`);
  const binding = response.cookies.find(
    (c) => c.name === '__Host-ak-flow',
  )!.value;
  const url = google.code(response.headers.location!, overrides);
  return {
    url: new URL(url).pathname + new URL(url).search,
    cookies: { '__Host-ak-flow': binding },
  };
}
test('full signed OIDC flow, cookies, authenticated writes, CSRF, logout and replay', async () => {
  await server();
  expect((await app.inject('/auth/me')).statusCode).toBe(401);
  const flow = await start();
  const callback = await app.inject(flow);
  expect(callback.statusCode).toBe(302);
  expect(callback.headers.location).toBe('/');
  const session = callback.cookies.find((c) => c.name === '__Host-ak-session')!;
  expect(session).toMatchObject({
    secure: true,
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
  });
  expect((await app.inject(flow)).statusCode).toBe(400);
  const cookies = { '__Host-ak-session': session.value };
  const me = await app.inject({ url: '/auth/me', cookies });
  expect(me.statusCode).toBe(200);
  expect(me.headers['cache-control']).toBe('no-store');
  await server(true, randomUUID());
  expect((await app.inject({ url: '/auth/me', cookies })).statusCode).toBe(401);
  await server();
  const headers = {
    origin: config.origin,
    'x-csrf-token': me.json().csrfToken,
  };
  expect(
    (await app.inject({ method: 'POST', url: '/api/test', cookies }))
      .statusCode,
  ).toBe(403);
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/api/test',
        cookies,
        headers: { ...headers, origin: 'https://evil.invalid' },
      })
    ).statusCode,
  ).toBe(403);
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/api/test',
        cookies,
        headers,
        payload: [],
      })
    ).statusCode,
  ).toBe(400);
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/api/test',
        cookies,
        headers,
        payload: {},
      })
    ).statusCode,
  ).toBe(200);
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/auth/logout',
        cookies,
        headers,
      })
    ).statusCode,
  ).toBe(204);
  expect((await app.inject({ url: '/auth/me', cookies })).statusCode).toBe(401);
  expect((await pool.query('SELECT * FROM sessions')).rowCount).toBe(0);
});
test('rejects forged claims, nonce, signature, subject, state, binding, expiry and duplicates', async () => {
  for (const overrides of [
    { nonce: 'wrong' },
    { aud: 'wrong' },
    { iss: 'https://evil.invalid' },
    { exp: 1 },
    { email_verified: false },
    { email: 1 },
    { email: 'bad' },
    { badSignature: true },
    { sub: 'unknown' },
  ]) {
    await server();
    expect([400, 403]).toContain(
      (await app.inject(await start(overrides))).statusCode,
    );
  }
  await server();
  const flow = await start();
  expect((await app.inject({ ...flow, cookies: {} })).statusCode).toBe(400);
  expect(
    (await app.inject({ ...flow, cookies: { '__Host-ak-flow': 'wrong' } }))
      .statusCode,
  ).toBe(400);
  expect(
    (await app.inject({ ...flow, url: flow.url.replace('state=', 'missing=') }))
      .statusCode,
  ).toBe(400);
  expect(
    (await app.inject({ ...flow, url: flow.url + '&state=duplicate' }))
      .statusCode,
  ).toBe(400);
  await pool.query(
    "UPDATE login_attempts SET expires_at = now() - interval '1 second'",
  );
  expect((await app.inject(flow)).statusCode).toBe(400);
  const next = await app.inject(await start());
  const cookies = {
    '__Host-ak-session': next.cookies.find(
      (c) => c.name === '__Host-ak-session',
    )!.value,
  };
  await pool.query(
    "UPDATE sessions SET expires_at = now() - interval '1 second'",
  );
  expect((await app.inject({ url: '/auth/me', cookies })).statusCode).toBe(401);
  await expect(
    google.provider.redeem(new URL('https://evil.invalid/auth/callback'), {
      state: '',
      verifier: '',
      nonce: '',
    }),
  ).rejects.toThrow('Invalid callback');
  await expect(
    google.provider.redeem(new URL(config.origin + '/other'), {
      state: '',
      verifier: '',
      nonce: '',
    }),
  ).rejects.toThrow('Invalid callback');
});
test('rate limit and unconfigured authentication fail closed', async () => {
  await server();
  for (let i = 0; i < 20; i++)
    expect((await app.inject('/auth/login')).statusCode).toBe(302);
  expect((await app.inject('/auth/login')).statusCode).toBe(429);
  await server(false);
  expect((await app.inject('/auth/login')).statusCode).toBe(503);
  expect(
    (await app.inject({ method: 'POST', url: '/api/test' })).statusCode,
  ).toBe(503);
});
