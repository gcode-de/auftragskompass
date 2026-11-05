import { afterAll, beforeAll, expect, test, vi } from 'vitest';
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
import {
  registerTelegramSettingsRoutes,
  startTelegramNotifications,
} from '../../packages/core/src/telegram.js';

const tenantId = randomUUID(),
  email = 'telegram.owner@example.invalid',
  password = 'Fictional password 123!';
const telegramEncryptionKey = Buffer.alloc(32, 7);
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
  registerTelegramSettingsRoutes(app, pool, tenantId, telegramEncryptionKey);
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
  ).toEqual({ configured: false, chatId: '', topicId: '' });
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
          topicId: '12345',
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
          topicId: '-12',
        },
      })
    ).statusCode,
  ).toBe(400);
  expect(
    (
      await app.inject({
        method: 'PUT',
        url: '/api/v1/settings/telegram',
        headers: { ...headers, ...csrf },
        payload: {
          botToken: '123456:abcdefghijklmnopqrstuvwxyz_ABCDEF',
          chatId: 'fictional-chat',
          topicId: '12345',
        },
      })
    ).statusCode,
  ).toBe(204);
  const saved = await app.inject({ url: '/api/v1/settings/telegram', headers });
  expect(saved.json()).toEqual({
    configured: true,
    chatId: 'fictional-chat',
    topicId: '12345',
  });
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
  ).toEqual({ configured: false, chatId: 'fictional-chat', topicId: '12345' });
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

test('saving credentials wakes only this tenant’s unlocked pending notifications', async () => {
  const otherTenantId = randomUUID(),
    otherActorId = randomUUID();
  const ownerActorId = (
    await pool.query<{ user_id: string }>(
      'SELECT user_id FROM allowed_accounts WHERE tenant_id=$1',
      [tenantId],
    )
  ).rows[0]!.user_id;
  await bootstrapAccess(
    pool,
    otherTenantId,
    'other.telegram.owner@example.invalid',
    'Fictional other tenant',
    'Europe/Berlin',
  );
  await pool.query('INSERT INTO users(tenant_id,id,email) VALUES($1,$2,$3)', [
    otherTenantId,
    otherActorId,
    'other.telegram.owner@example.invalid',
  ]);
  const seedJob = async (
    ownerTenant: string,
    actor: string,
    state: 'pending' | 'locked' | 'delivered' | 'cancelled',
  ) => {
    const inquiryId = randomUUID();
    await pool.query(
      `INSERT INTO website_inquiry_deliveries
        (tenant_id,id,payload,payload_hash,received_at,expires_at,staged_at,staged_by)
        VALUES($1,$2,$3::jsonb,encode(sha256(convert_to($3::jsonb::text,'UTF8')),'hex'),now(),now()+interval '24 hours',now(),$4)`,
      [ownerTenant, inquiryId, JSON.stringify({ fixture: 'fictional' }), actor],
    );
    await pool.query(
      `INSERT INTO telegram_notification_jobs
        (tenant_id,inquiry_id,available_at,attempts,locked_at,delivered_at,cancelled_at)
        VALUES($1,$2,now()+interval '6 hours',10,$3,$4,$5)`,
      [
        ownerTenant,
        inquiryId,
        state === 'locked' ? new Date() : null,
        state === 'delivered' ? new Date() : null,
        state === 'cancelled' ? new Date() : null,
      ],
    );
    return inquiryId;
  };
  const retryId = await seedJob(tenantId, ownerActorId, 'pending');
  const lockedId = await seedJob(tenantId, ownerActorId, 'locked');
  const deliveredId = await seedJob(tenantId, ownerActorId, 'delivered');
  const cancelledId = await seedJob(tenantId, ownerActorId, 'cancelled');
  const otherId = await seedJob(otherTenantId, otherActorId, 'pending');

  const logged = await app.inject({
    method: 'POST',
    url: '/auth/login',
    headers: { origin: config.origin },
    payload: { identifier: 'fictional.owner', password },
  });
  const cookie = logged.cookies[0]!;
  const headers = {
    cookie: `${cookie.name}=${cookie.value}`,
    origin: config.origin,
  };
  const csrf = (await app.inject({ url: '/auth/me', headers })).json()
    .csrfToken;
  expect(
    (
      await app.inject({
        method: 'PUT',
        url: '/api/v1/settings/telegram',
        headers: { ...headers, 'x-csrf-token': csrf },
        payload: {
          botToken: '123456:abcdefghijklmnopqrstuvwxyz_ABCDEF',
          chatId: 'fictional-chat',
        },
      })
    ).statusCode,
  ).toBe(204);

  const rows = (
    await pool.query(
      'SELECT tenant_id,inquiry_id,attempts,available_at,locked_at,delivered_at,cancelled_at FROM telegram_notification_jobs WHERE inquiry_id=ANY($1)',
      [[retryId, lockedId, deliveredId, cancelledId, otherId]],
    )
  ).rows;
  const byId = new Map(rows.map((row) => [row.inquiry_id, row]));
  const retry = byId.get(retryId)!;
  expect(retry.attempts).toBe(0);
  expect(new Date(retry.available_at).getTime()).toBeLessThanOrEqual(
    Date.now() + 1000,
  );
  expect(retry.locked_at).toBeNull();
  const locked = byId.get(lockedId)!;
  expect(locked.attempts).toBe(10);
  expect(locked.locked_at).not.toBeNull();
  expect(new Date(locked.available_at).getTime()).toBeGreaterThan(Date.now());
  expect(byId.get(deliveredId)?.delivered_at).not.toBeNull();
  expect(byId.get(cancelledId)?.cancelled_at).not.toBeNull();
  expect(byId.get(otherId)?.attempts).toBe(10);
  expect(new Date(byId.get(otherId)!.available_at).getTime()).toBeGreaterThan(
    Date.now(),
  );

  let announceFetch!: () => void,
    finishFetch!: (response: Response) => void,
    fetchReleased = false;
  const fetchStarted = new Promise<void>((resolve) => {
      announceFetch = resolve;
    }),
    blockedResponse = new Promise<Response>((resolve) => {
      finishFetch = resolve;
    });
  const fetcher = async () => {
    announceFetch();
    return blockedResponse;
  };
  const worker = startTelegramNotifications(
    pool,
    telegramEncryptionKey,
    () => {},
    fetcher,
  );
  try {
    await fetchStarted;
    const claimed = (
      await pool.query(
        'SELECT attempts,locked_at FROM telegram_notification_jobs WHERE tenant_id=$1 AND inquiry_id=$2',
        [tenantId, retryId],
      )
    ).rows[0]!;
    expect(claimed.attempts).toBe(1);
    expect(claimed.locked_at).not.toBeNull();

    expect(
      (
        await app.inject({
          method: 'PUT',
          url: '/api/v1/settings/telegram',
          headers: { ...headers, 'x-csrf-token': csrf },
          payload: {
            botToken: '123457:abcdefghijklmnopqrstuvwxyz_ABCDEF',
            chatId: 'fictional-chat',
          },
        })
      ).statusCode,
    ).toBe(204);
    const duringSave = (
      await pool.query(
        'SELECT attempts,locked_at FROM telegram_notification_jobs WHERE tenant_id=$1 AND inquiry_id=$2',
        [tenantId, retryId],
      )
    ).rows[0]!;
    expect(duringSave.attempts).toBe(1);
    expect(duringSave.locked_at).not.toBeNull();
    finishFetch(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    fetchReleased = true;
    await vi.waitFor(async () => {
      const row = (
        await pool.query(
          'SELECT attempts,delivered_at FROM telegram_notification_jobs WHERE tenant_id=$1 AND inquiry_id=$2',
          [tenantId, retryId],
        )
      ).rows[0]!;
      expect(row.attempts).toBe(1);
      expect(row.delivered_at).not.toBeNull();
    });
  } finally {
    if (!fetchReleased)
      finishFetch(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    await worker.stop();
  }
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
