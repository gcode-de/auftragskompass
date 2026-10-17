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
import { migrate } from '../../packages/core/src/identity.js';
import {
  accessRepository,
  bootstrapAccess,
} from '../../packages/core/src/access.js';
import { registerAccessRoutes } from '../../packages/core/src/access-routes.js';
import { registerAuditRoutes } from '../../packages/core/src/audit.js';
import { digest, registerAuth } from '../../packages/core/src/auth.js';
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
  await bootstrapAccess(
    pool,
    config.tenantId,
    'synthetic@example.invalid',
    'Synthetic auth',
    'Europe/Berlin',
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
  if (enabled) {
    registerAccessRoutes(app, pool, tenantId);
    registerAuditRoutes(app, pool, tenantId);
  }
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
  expect(
    (await app.inject({ url: '/api/v1/audit', cookies })).json().slice(0, 2),
  ).toMatchObject([{ action: 'login.failed' }, { action: 'login.succeeded' }]);
  expect(me.headers['cache-control']).toBe('no-store');
  await server(true, randomUUID());
  expect((await app.inject({ url: '/auth/me', cookies })).statusCode).toBe(401);
  await server();
  const headers = {
    origin: config.origin,
    'x-csrf-token': me.json().csrfToken,
  };
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/auth/password',
        cookies,
        headers,
        payload: {
          currentPassword: 'Fictional current password',
          newPassword: 'Fictional new password',
        },
      })
    ).statusCode,
  ).toBe(404);

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
  const audit = await pool.query(
    'SELECT action FROM audit_events ORDER BY id DESC LIMIT 1',
  );
  expect(audit.rows).toEqual([{ action: 'logout' }]);
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

test('access API validates input, prevents lockout and revokes blocked sessions', async () => {
  await server();
  expect((await app.inject('/api/v1/access')).statusCode).toBe(401);
  expect((await app.inject('/api/v1/audit')).statusCode).toBe(401);
  const login = await app.inject(await start());
  const cookies = {
    '__Host-ak-session': login.cookies.find(
      (c) => c.name === '__Host-ak-session',
    )!.value,
  };
  const me = await app.inject({ url: '/auth/me', cookies });
  const headers = {
    origin: config.origin,
    'x-csrf-token': me.json().csrfToken,
  };
  const change = (id: string, active: boolean) =>
    app.inject({
      method: 'PATCH',
      url: '/api/v1/access/' + id,
      headers,
      cookies,
      payload: { active },
    });
  const grant = (email: string) =>
    app.inject({
      method: 'POST',
      url: '/api/v1/access',
      headers,
      cookies,
      payload: { email },
    });
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/api/v1/access',
        cookies,
        payload: { email: 'bad' },
      })
    ).statusCode,
  ).toBe(403);
  expect((await grant('bad')).statusCode).toBe(400);
  for (const [payload, contentType, expected] of [
    ['{', 'application/json', 400],
    ['unknown', 'application/octet-stream', 415],
    ['x'.repeat(1024 * 1024 + 1), 'text/plain', 413],
  ] as const) {
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/access',
          cookies,
          headers: { ...headers, 'content-type': contentType },
          payload,
        })
      ).statusCode,
    ).toBe(expected);
  }
  const first = (
    await app.inject({ url: '/api/v1/access', cookies })
  ).json()[0];
  expect((await change(first.id, false)).json()).toEqual({
    error: 'last_administrator',
  });
  expect((await change('bad', false)).statusCode).toBe(400);
  expect((await change(randomUUID(), false)).statusCode).toBe(404);
  expect((await grant('synthetic@example.invalid')).statusCode).toBe(409);
  expect((await grant('api-second@example.invalid')).statusCode).toBe(201);
  const secondLogin = await app.inject(
    await start({ sub: 'api-second', email: 'api-second@example.invalid' }),
  );
  const secondCookies = {
    '__Host-ak-session': secondLogin.cookies.find(
      (c) => c.name === '__Host-ak-session',
    )!.value,
  };
  const second = (await app.inject({ url: '/api/v1/access', cookies }))
    .json()
    .find((a: { email: string }) => a.email === 'api-second@example.invalid');
  expect((await change(second.id, false)).statusCode).toBe(204);
  expect(
    (await app.inject({ url: '/auth/me', cookies: secondCookies })).statusCode,
  ).toBe(401);
  expect(
    (
      await app.inject(
        await start({ sub: 'api-second', email: 'api-second@example.invalid' }),
      )
    ).statusCode,
  ).toBe(403);
  expect((await change(second.id, true)).statusCode).toBe(204);
  expect(
    (await app.inject({ url: '/auth/me', cookies: secondCookies })).statusCode,
  ).toBe(401);
  await pool.query(
    'ALTER TABLE access_audit RENAME TO temporarily_unavailable_audit',
  );
  try {
    expect((await grant('rollback@example.invalid')).statusCode).toBe(500);
  } finally {
    await pool.query(
      'ALTER TABLE temporarily_unavailable_audit RENAME TO access_audit',
    );
  }
  expect(
    (await app.inject({ url: '/api/v1/access', cookies }))
      .json()
      .find((a: { email: string }) => a.email === 'rollback@example.invalid'),
  ).toBeUndefined();
});

test('audit failure prevents a new session and logout rolls back safely', async () => {
  await server();
  const flow = await start();
  await pool.query(
    'ALTER TABLE audit_events RENAME TO temporarily_missing_audit',
  );
  try {
    expect((await app.inject(flow)).statusCode).toBe(500);
  } finally {
    await pool.query(
      'ALTER TABLE temporarily_missing_audit RENAME TO audit_events',
    );
  }
  const login = await app.inject(await start());
  const cookies = {
    '__Host-ak-session': login.cookies.find(
      (c) => c.name === '__Host-ak-session',
    )!.value,
  };
  const me = await app.inject({ url: '/auth/me', cookies });
  await pool.query(
    'ALTER TABLE audit_events RENAME TO temporarily_missing_audit',
  );
  try {
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/auth/logout',
          cookies,
          headers: {
            origin: config.origin,
            'x-csrf-token': me.json().csrfToken,
          },
        })
      ).statusCode,
    ).toBe(500);
  } finally {
    await pool.query(
      'ALTER TABLE temporarily_missing_audit RENAME TO audit_events',
    );
  }
  expect((await app.inject({ url: '/auth/me', cookies })).statusCode).toBe(200);
});

test('encoded route prefixes cannot bypass authentication or CSRF', async () => {
  await server();
  const routes = [
    '/%61pi/v1/access',
    '/a%70i/v1/access',
    '/ap%69/v1/access',
    '/%61%70%69/v1/access?fictional=1',
    '/%61uth/me',
  ];
  for (const url of routes) {
    for (const cookies of [{}, { '__Host-ak-session': 'fictional-invalid' }]) {
      const response = await app.inject({ url, cookies });
      expect(response.statusCode, url).toBe(401);
      expect(response.json()).toEqual({ error: 'unauthorized' });
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.body).not.toContain('synthetic@example.invalid');
    }
  }
  expect((await app.inject('/api/v1/fictional-not-found')).statusCode).toBe(
    401,
  );
  expect((await app.inject('/%61pi/v1/fictional-not-found')).statusCode).toBe(
    404,
  );
  const token = 'fictional-encoded-route-owner';
  expect(
    await accessRepository(pool, config.tenantId).issueSession(
      { subject: 'synthetic-subject', email: 'synthetic@example.invalid' },
      digest(token),
    ),
  ).toBe(true);
  const cookies = { '__Host-ak-session': token };
  for (const url of routes)
    expect((await app.inject({ url, cookies })).statusCode, url).toBe(200);
  const me = await app.inject({ url: '/%61uth/me', cookies });
  const write = {
    method: 'POST' as const,
    url: '/%61pi/test',
    cookies,
    payload: {},
  };
  expect((await app.inject(write)).statusCode).toBe(403);
  expect(
    (
      await app.inject({
        ...write,
        headers: {
          origin: 'https://foreign.example.invalid',
          'x-csrf-token': me.json().csrfToken,
        },
      })
    ).statusCode,
  ).toBe(403);
  expect(
    (
      await app.inject({
        ...write,
        headers: { origin: config.origin, 'x-csrf-token': me.json().csrfToken },
      })
    ).statusCode,
  ).toBe(200);
  await server(true, randomUUID());
  for (const url of routes)
    expect((await app.inject({ url, cookies })).statusCode, url).toBe(401);
  await server(false);
  expect(
    (await app.inject({ method: 'POST', url: '/%61pi/test', payload: {} }))
      .statusCode,
  ).toBe(503);
});
