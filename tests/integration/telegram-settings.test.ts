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
import { registerTelegramSettingsRoutes } from '../../packages/core/src/telegram.js';

const tenantId = randomUUID(),
  email = 'telegram.owner@example.invalid',
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
  await bootstrapAccess(
    pool,
    tenantId,
    email,
    'Fictional tenant',
    'Europe/Berlin',
  );
  await bootstrapPassword(
    pool,
    tenantId,
    email,
    'fictional.owner',
    () => password,
  );
  app = Fastify();
  await registerAuth(app, pool, config);
  registerTelegramSettingsRoutes(app, pool, tenantId, Buffer.alloc(32, 7));
});
afterAll(async () => {
  await app?.close();
  await pool?.end();
  await container?.stop();
});

test('settings require a session and CSRF for mutation; the token is never returned or stored in plaintext', async () => {
  expect((await app.inject('/api/v1/settings/telegram')).statusCode).toBe(401);
  const logged = await app.inject({
    method: 'POST',
    url: '/auth/login',
    headers: { origin: config.origin },
    payload: { identifier: 'fictional.owner', password },
  });
  expect(logged.statusCode).toBe(204);
  const cookie = logged.cookies[0]!;
  const headers = {
    cookie: `${cookie.name}=${cookie.value}`,
    origin: config.origin,
  };
  expect(
    (
      await app.inject({
        method: 'PUT',
        url: '/api/v1/settings/telegram',
        payload: {
          botToken: '123456:abcdefghijklmnopqrstuvwxyz_ABCDEF',
          chatId: 'fictional-chat',
        },
      })
    ).statusCode,
  ).toBe(401);
  expect(
    (await app.inject({ method: 'DELETE', url: '/api/v1/settings/telegram' }))
      .statusCode,
  ).toBe(401);
  expect(
    (await app.inject({ url: '/api/v1/settings/telegram', headers })).json(),
  ).toEqual({ configured: false, chatId: '' });
  expect(
    (
      await app.inject({
        method: 'PUT',
        url: '/api/v1/settings/telegram',
        headers: {
          ...headers,
          origin: config.origin,
          'x-csrf-token': (
            await app.inject({ url: '/auth/me', headers })
          ).json().csrfToken,
        },
        payload: { botToken: 'invalid-token', chatId: 'fictional-chat' },
      })
    ).statusCode,
  ).toBe(400);
  const me = await app.inject({ url: '/auth/me', headers });
  expect(
    (
      await app.inject({
        method: 'PUT',
        url: '/api/v1/settings/telegram',
        headers,
        payload: {
          botToken: '123456:abcdefghijklmnopqrstuvwxyz_ABCDEF',
          chatId: 'fictional-chat',
        },
      })
    ).statusCode,
  ).toBe(403);
  const csrf = { 'x-csrf-token': me.json().csrfToken };
  expect(
    (
      await app.inject({
        method: 'PUT',
        url: '/api/v1/settings/telegram',
        headers: { ...headers, ...csrf },
        payload: {
          botToken: '123456:abcdefghijklmnopqrstuvwxyz_ABCDEF',
          chatId: 'fictional-chat',
        },
      })
    ).statusCode,
  ).toBe(204);
  const saved = await app.inject({ url: '/api/v1/settings/telegram', headers });
  expect(saved.json()).toEqual({ configured: true, chatId: 'fictional-chat' });
  expect(saved.body).not.toContain('abcdefghijklmnopqrstuvwxyz');
  expect(
    (
      await pool.query(
        'SELECT token_ciphertext FROM telegram_settings WHERE tenant_id=$1',
        [tenantId],
      )
    ).rows[0].token_ciphertext.toString(),
  ).not.toContain('123456:');
  expect(
    (
      await app.inject({
        method: 'DELETE',
        url: '/api/v1/settings/telegram',
        headers,
      })
    ).statusCode,
  ).toBe(403);
  expect(
    (
      await app.inject({
        method: 'DELETE',
        url: '/api/v1/settings/telegram',
        headers: { ...headers, ...csrf },
      })
    ).statusCode,
  ).toBe(204);
  expect(
    (await app.inject({ url: '/api/v1/settings/telegram', headers })).json(),
  ).toEqual({ configured: false, chatId: 'fictional-chat' });
});

test('missing encryption key fails configuration closed without returning a token', async () => {
  const unconfigured = Fastify();
  await registerAuth(unconfigured, pool, config);
  registerTelegramSettingsRoutes(unconfigured, pool, tenantId, null);
  const login = await unconfigured.inject({
    method: 'POST',
    url: '/auth/login',
    headers: { origin: config.origin },
    payload: { identifier: 'fictional.owner', password },
  });
  const cookie = login.cookies[0]!;
  const headers = {
    cookie: `${cookie.name}=${cookie.value}`,
    origin: config.origin,
  };
  expect(
    (
      await unconfigured.inject({
        method: 'PUT',
        url: '/api/v1/settings/telegram',
        payload: {
          botToken: '123456:abcdefghijklmnopqrstuvwxyz_ABCDEF',
          chatId: 'fictional-chat',
        },
      })
    ).statusCode,
  ).toBe(401);
  const csrf = (await unconfigured.inject({ url: '/auth/me', headers })).json()
    .csrfToken;
  expect(
    (
      await unconfigured.inject({
        method: 'PUT',
        url: '/api/v1/settings/telegram',
        headers: { ...headers, 'x-csrf-token': csrf },
        payload: {
          botToken: '123456:abcdefghijklmnopqrstuvwxyz_ABCDEF',
          chatId: 'fictional-chat',
        },
      })
    ).statusCode,
  ).toBe(503);
  await unconfigured.close();
});

test('settings routes reject a session without administrator access and hide database failures', async () => {
  const forbidden = Fastify();
  forbidden.decorateRequest('authSession', null);
  forbidden.addHook('onRequest', async (request) => {
    request.authSession = { userId: randomUUID(), email };
  });
  registerTelegramSettingsRoutes(
    forbidden,
    pool,
    tenantId,
    Buffer.alloc(32, 9),
  );
  expect((await forbidden.inject('/api/v1/settings/telegram')).statusCode).toBe(
    403,
  );
  expect(
    (
      await forbidden.inject({
        method: 'PUT',
        url: '/api/v1/settings/telegram',
        payload: {
          botToken: '123456:abcdefghijklmnopqrstuvwxyz_ABCDEF',
          chatId: 'fictional-chat',
        },
      })
    ).statusCode,
  ).toBe(403);
  expect(
    (
      await forbidden.inject({
        method: 'DELETE',
        url: '/api/v1/settings/telegram',
      })
    ).statusCode,
  ).toBe(403);
  await forbidden.close();

  const failing = Fastify();
  failing.decorateRequest('authSession', null);
  failing.addHook('onRequest', async (request) => {
    request.authSession = { userId: randomUUID(), email };
  });
  registerTelegramSettingsRoutes(
    failing,
    pool,
    'invalid-tenant',
    Buffer.alloc(32, 9),
  );
  expect((await failing.inject('/api/v1/settings/telegram')).statusCode).toBe(
    500,
  );
  await failing.close();
});
