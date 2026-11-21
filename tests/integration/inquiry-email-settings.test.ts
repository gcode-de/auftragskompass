import { afterAll, beforeAll, expect, test } from 'vitest';
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import Fastify, { type FastifyInstance } from 'fastify';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { migrate } from '../../packages/core/src/identity.js';
import { bootstrapAccess } from '../../packages/core/src/access.js';
import { bootstrapPassword } from '../../packages/core/src/password-access.js';
import { registerAuth } from '../../packages/core/src/auth.js';
import { registerInquiryEmailSettingsRoutes } from '../../packages/core/src/inquiry-email.js';

// MAIL-NOTIFY-01: synthetic tenant and addresses only, no mail is ever sent.
const tenantId = randomUUID(),
  otherTenantId = randomUUID(),
  email = 'notify.settings@example.invalid',
  password = 'Fictional password 123!';
const config = {
  mode: 'password' as const,
  origin: 'https://admin.example.invalid',
  tenantId,
};
let container: StartedPostgreSqlContainer, pool: Pool, app: FastifyInstance;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:17.6-alpine').start();
  pool = new Pool({ connectionString: container.getConnectionUri() });
  await migrate(pool);
  for (const [tenant, owner, label] of [
    [tenantId, email, 'Fictional notify settings'],
    [otherTenantId, 'other.notify.settings@example.invalid', 'Fictional other'],
  ] as const)
    await bootstrapAccess(pool, tenant, owner, label, 'Europe/Berlin');
  await bootstrapPassword(
    pool,
    tenantId,
    email,
    'fictional.notify.settings',
    () => password,
  );
  app = Fastify();
  await registerAuth(app, pool, config);
  registerInquiryEmailSettingsRoutes(app, pool, tenantId);
});
afterAll(async () => {
  await app?.close();
  await pool?.end();
  await container?.stop();
});

async function signedIn() {
  const login = await app.inject({
    method: 'POST',
    url: '/auth/login',
    headers: { origin: config.origin },
    payload: { identifier: 'fictional.notify.settings', password },
  });
  const cookie = login.cookies[0]!,
    headers = {
      cookie: `${cookie.name}=${cookie.value}`,
      origin: config.origin,
    };
  const csrf = {
    'x-csrf-token': (await app.inject({ url: '/auth/me', headers })).json()
      .csrfToken,
  };
  return { headers, csrf };
}

test('settings need a session and CSRF, validate addresses and keep the stored form', async () => {
  expect((await app.inject('/api/v1/settings/inquiry-email')).statusCode).toBe(
    401,
  );
  const { headers, csrf } = await signedIn();
  expect(
    (
      await app.inject({ url: '/api/v1/settings/inquiry-email', headers })
    ).json(),
  ).toEqual({ enabled: false, recipients: '' });
  expect(
    (
      await app.inject({
        method: 'PUT',
        url: '/api/v1/settings/inquiry-email',
        payload: {
          enabled: true,
          recipients: 'fictional.inbox@example.invalid',
        },
      })
    ).statusCode,
  ).toBe(401);
  expect(
    (
      await app.inject({
        method: 'PUT',
        url: '/api/v1/settings/inquiry-email',
        headers,
        payload: {
          enabled: true,
          recipients: 'fictional.inbox@example.invalid',
        },
      })
    ).statusCode,
  ).toBe(403);
  for (const recipients of [
    'not-an-address',
    'two@@example.invalid',
    'ok@example.invalid, broken',
    'x'.repeat(4000) + '@example.invalid',
    // 50 valid addresses that only exceed the stored limit after normalizing.
    Array.from({ length: 50 }, () => 'a'.repeat(63) + '@example.invalid').join(
      ',',
    ),
  ])
    expect(
      (
        await app.inject({
          method: 'PUT',
          url: '/api/v1/settings/inquiry-email',
          headers: { ...headers, ...csrf },
          payload: { enabled: true, recipients },
        })
      ).statusCode,
    ).toBe(400);
  expect(
    (
      await app.inject({
        method: 'PUT',
        url: '/api/v1/settings/inquiry-email',
        headers: { ...headers, ...csrf },
        payload: { enabled: true, recipients: '   ' },
      })
    ).statusCode,
  ).toBe(400);
  expect(
    (
      await app.inject({
        method: 'PUT',
        url: '/api/v1/settings/inquiry-email',
        headers: { ...headers, ...csrf },
        payload: {
          enabled: true,
          recipients:
            'fictional.inbox@example.invalid, second.inbox@example.invalid',
        },
      })
    ).statusCode,
  ).toBe(204);
  expect(
    (
      await app.inject({ url: '/api/v1/settings/inquiry-email', headers })
    ).json(),
  ).toEqual({
    enabled: true,
    recipients: 'fictional.inbox@example.invalid, second.inbox@example.invalid',
  });
  // Switching off keeps the address for a later re-activation.
  expect(
    (
      await app.inject({
        method: 'PUT',
        url: '/api/v1/settings/inquiry-email',
        headers: { ...headers, ...csrf },
        payload: {
          enabled: false,
          recipients:
            'fictional.inbox@example.invalid, second.inbox@example.invalid',
        },
      })
    ).statusCode,
  ).toBe(204);
  expect(
    (
      await app.inject({ url: '/api/v1/settings/inquiry-email', headers })
    ).json(),
  ).toEqual({
    enabled: false,
    recipients: 'fictional.inbox@example.invalid, second.inbox@example.invalid',
  });
});

test('a foreign tenant keeps its own row and non-administrators are refused', async () => {
  await pool.query(
    'INSERT INTO inquiry_email_settings(tenant_id,recipients,enabled) VALUES($1,$2,true)',
    [otherTenantId, 'other.inbox@example.invalid'],
  );
  const { headers, csrf } = await signedIn();
  expect(
    (
      await app.inject({
        method: 'PUT',
        url: '/api/v1/settings/inquiry-email',
        headers: { ...headers, ...csrf },
        payload: { enabled: true, recipients: 'mine@example.invalid' },
      })
    ).statusCode,
  ).toBe(204);
  expect(
    (
      await pool.query(
        'SELECT recipients,enabled FROM inquiry_email_settings WHERE tenant_id=$1',
        [otherTenantId],
      )
    ).rows[0],
  ).toEqual({ recipients: 'other.inbox@example.invalid', enabled: true });
  expect(
    (
      await app.inject({ url: '/api/v1/settings/inquiry-email', headers })
    ).json(),
  ).toEqual({ enabled: true, recipients: 'mine@example.invalid' });

  // A session without an administrator account gets 403 on read and write.
  const forbidden = Fastify();
  forbidden.decorateRequest('authSession', null);
  forbidden.addHook('onRequest', async (request) => {
    request.authSession = { userId: randomUUID(), email };
  });
  registerInquiryEmailSettingsRoutes(forbidden, pool, tenantId);
  expect(
    (await forbidden.inject('/api/v1/settings/inquiry-email')).statusCode,
  ).toBe(403);
  expect(
    (
      await forbidden.inject({
        method: 'PUT',
        url: '/api/v1/settings/inquiry-email',
        payload: { enabled: true, recipients: 'mine@example.invalid' },
      })
    ).statusCode,
  ).toBe(403);
  await forbidden.close();

  // An unknown tenant fails closed without leaking details.
  const failing = Fastify();
  failing.decorateRequest('authSession', null);
  failing.addHook('onRequest', async (request) => {
    request.authSession = { userId: randomUUID(), email };
  });
  registerInquiryEmailSettingsRoutes(failing, pool, 'invalid-tenant');
  expect(
    (await failing.inject('/api/v1/settings/inquiry-email')).statusCode,
  ).toBe(500);
  expect(
    (
      await failing.inject({
        method: 'PUT',
        url: '/api/v1/settings/inquiry-email',
        payload: { enabled: false, recipients: '' },
      })
    ).statusCode,
  ).toBe(500);
  await failing.close();
});
