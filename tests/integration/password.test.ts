import { afterAll, beforeAll, expect, test } from 'vitest';
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { Pool } from 'pg';
import { migrate } from '../../packages/core/src/identity.js';
import {
  bootstrapAccess,
  accessRepository,
} from '../../packages/core/src/access.js';
import {
  bootstrapPassword,
  passwordAccess,
} from '../../packages/core/src/password-access.js';
import { registerAccessRoutes } from '../../packages/core/src/access-routes.js';
import { registerAuth, digest } from '../../packages/core/src/auth.js';
const tenantId = randomUUID();
const email = 'fictional.owner@example.invalid';
const password = 'Fictional password 123!';
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
});
afterAll(async () => {
  await app?.close();
  await pool?.end();
  await container?.stop();
});
async function server() {
  await app?.close();
  app = Fastify();
  await registerAuth(app, pool, config);
  registerAccessRoutes(app, pool, tenantId, 'password');
}
function login(
  identifier = 'fictional.owner',
  secret = password,
  origin: string | undefined = config.origin,
) {
  return app.inject({
    method: 'POST',
    url: '/auth/login',
    headers: origin ? { origin } : {},
    payload: { identifier, password: secret },
  });
}
test('bootstrap is atomic, one-time, tenant-scoped and never reactivates or resets credentials', async () => {
  await expect(
    bootstrapPassword(pool, tenantId, undefined, undefined, () => password),
  ).rejects.toThrow();
  await expect(
    bootstrapPassword(pool, tenantId, email, 'fictional.owner', () => 'short'),
  ).rejects.toThrow();
  expect(
    (await pool.query('SELECT * FROM password_credentials')).rowCount,
  ).toBe(0);
  await Promise.all(
    [1, 2].map(() =>
      bootstrapPassword(
        pool,
        tenantId,
        email,
        'Fictional.Owner',
        () => password,
      ),
    ),
  );
  await bootstrapPassword(pool, tenantId, undefined, undefined, () => {
    throw new Error('must not read');
  });
  const user = (
    await pool.query('SELECT * FROM users WHERE tenant_id=$1', [tenantId])
  ).rows[0];
  expect(user.google_subject).toBeNull();
  const rows = await pool.query('SELECT * FROM password_credentials');
  expect(rows.rowCount).toBe(1);
  expect(JSON.stringify(rows.rows)).not.toContain(password);
  await expect(
    bootstrapPassword(
      pool,
      randomUUID(),
      email,
      'fictional.owner',
      () => password,
    ),
  ).rejects.toThrow();
  const existing = randomUUID();
  await bootstrapAccess(
    pool,
    existing,
    email,
    'Fictional old tenant',
    'Europe/Berlin',
  );
  const { identityRepository } =
    await import('../../packages/core/src/identity.js');
  await identityRepository(pool, existing).addAdministrator(
    'fictional-existing',
    'fictional.old@example.invalid',
  );
  await expect(
    bootstrapPassword(pool, existing, email, 'fictional.owner', () => password),
  ).rejects.toThrow('fresh tenant');
  const other = randomUUID();
  await bootstrapAccess(
    pool,
    other,
    email,
    'Fictional second tenant',
    'Europe/Berlin',
  );
  await bootstrapPassword(
    pool,
    other,
    email,
    'fictional.owner',
    () => 'Other fictional password',
  );
  expect(
    await passwordAccess(pool, other).issueSession(
      email,
      password,
      digest('fictional-other'),
    ),
  ).toBe(false);
  await pool.query('DELETE FROM password_bootstrap WHERE tenant_id=$1', [
    other,
  ]);
  await expect(
    bootstrapPassword(pool, other, email, 'fictional.owner', () => password),
  ).rejects.toThrow('unclaimed');
});
test('username/email login, secure cookies, CSRF, logout and unsupported methods', async () => {
  await server();
  expect((await app.inject('/auth/me')).headers['x-auth-mode']).toBe(
    'password',
  );
  expect((await app.inject('/auth/login')).statusCode).toBe(404);
  expect((await app.inject('/auth/callback')).statusCode).toBe(404);
  expect(
    (await login(undefined, undefined, 'https://attacker.invalid')).statusCode,
  ).toBe(403);
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { identifier: email, password },
      })
    ).statusCode,
  ).toBe(403);
  const response = await login(' FICTIONAL.OWNER@EXAMPLE.INVALID ');
  expect(response.statusCode).toBe(204);
  const cookie = response.cookies[0]!;
  expect(cookie).toMatchObject({
    name: '__Host-ak-session',
    path: '/',
    secure: true,
    httpOnly: true,
    sameSite: 'Lax',
  });
  const headers = { cookie: `${cookie.name}=${cookie.value}` };
  const me = await app.inject({ url: '/auth/me', headers });
  expect(me.json().email).toBe(email);
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/api/v1/access',
        headers: {
          ...headers,
          origin: config.origin,
          'x-csrf-token': me.json().csrfToken,
        },
        payload: { email: 'fictional.new@example.invalid' },
      })
    ).statusCode,
  ).toBe(409);
  expect(
    (await app.inject({ method: 'POST', url: '/auth/logout', headers }))
      .statusCode,
  ).toBe(403);
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/auth/logout',
        headers: {
          ...headers,
          origin: config.origin,
          'x-csrf-token': me.json().csrfToken,
        },
      })
    ).statusCode,
  ).toBe(204);
  expect((await app.inject({ url: '/auth/me', headers })).statusCode).toBe(401);
  expect((await login()).statusCode).toBe(204);
});
test('persistent lockout covers both identifiers and restart; expiry restores access', async () => {
  await server();
  const repo = passwordAccess(pool, tenantId);
  for (let i = 0; i < 5; i++)
    expect(
      await repo.issueSession(
        i % 2 ? email : 'fictional.owner',
        'incorrect',
        digest(`bad-${i}`),
      ),
    ).toBe(false);
  await server();
  expect((await login()).statusCode).toBe(401);
  expect((await login('unknown.invalid')).body).toBe((await login()).body);
  await pool.query(
    "UPDATE password_credentials SET locked_until=now()-interval '1 second' WHERE tenant_id=$1",
    [tenantId],
  );
  expect((await login()).statusCode).toBe(204);
  expect(
    (
      await pool.query(
        'SELECT failures,locked_until FROM password_credentials WHERE tenant_id=$1',
        [tenantId],
      )
    ).rows[0],
  ).toEqual({ failures: 0, locked_until: null });
});
test('revocation, concurrent verification and audit failure never create usable unauthorized sessions', async () => {
  await server();
  const results = await Promise.all([login(), login()]);
  expect(results.map((r) => r.statusCode).sort()).toEqual([204, 429]);
  const [{ user_id: userId }] = (
    await pool.query(
      'SELECT user_id FROM password_credentials WHERE tenant_id=$1',
      [tenantId],
    )
  ).rows;
  const otherEmail = 'fictional.second@example.invalid';
  const repo = accessRepository(pool, tenantId);
  await repo.grant(userId, otherEmail);
  const { identityRepository } =
    await import('../../packages/core/src/identity.js');
  const second = await identityRepository(pool, tenantId).addAdministrator(
    'fictional-second-subject',
    otherEmail,
  );
  await pool.query(
    'UPDATE allowed_accounts SET user_id=$1 WHERE tenant_id=$2 AND email=$3',
    [second!.id, tenantId, otherEmail],
  );
  const account = (await repo.list()).find((a) => a.email === email)!;
  await Promise.all([
    passwordAccess(pool, tenantId).issueSession(
      email,
      password,
      digest('fictional-revocation-race'),
    ),
    repo.change(second!.id, account.id, false),
  ]);
  expect(
    (
      await pool.query(
        'SELECT * FROM sessions WHERE tenant_id=$1 AND user_id=$2',
        [tenantId, userId],
      )
    ).rowCount,
  ).toBe(0);
  expect((await login()).statusCode).toBe(401);
  await bootstrapPassword(
    pool,
    tenantId,
    email,
    'fictional.owner',
    () => password,
  );
  expect((await login()).statusCode).toBe(401);
  await repo.change(second!.id, account.id, true);
  await pool.query('ALTER TABLE audit_events RENAME TO unavailable_audit');
  try {
    expect((await login()).statusCode).toBe(500);
  } finally {
    await pool.query('ALTER TABLE unavailable_audit RENAME TO audit_events');
  }
  expect(
    (
      await pool.query(
        'SELECT * FROM sessions WHERE tenant_id=$1 AND user_id=$2',
        [tenantId, userId],
      )
    ).rowCount,
  ).toBe(0);
  expect((await login()).statusCode).toBe(204);
});
test('input limits and per-address throttling do not expose credentials', async () => {
  await server();
  for (const payload of [
    {},
    { identifier: email, password: 'x'.repeat(129) },
    { identifier: 'x'.repeat(255), password },
  ])
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/auth/login',
          headers: { origin: config.origin },
          payload,
        })
      ).statusCode,
    ).toBe(400);
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/auth/login',
        headers: { origin: config.origin, 'content-type': 'application/json' },
        payload: JSON.stringify({
          identifier: email,
          password,
          extra: 'x'.repeat(3000),
        }),
      })
    ).statusCode,
  ).toBe(413);
  await server();
  for (let i = 0; i < 20; i++)
    await login(undefined, undefined, 'https://attacker.invalid');
  expect((await login()).statusCode).toBe(429);
});

test('database rejects malformed credentials, duplicate usernames and foreign tenant references', async () => {
  const own = (
    await pool.query('SELECT * FROM password_credentials WHERE tenant_id=$1', [
      tenantId,
    ])
  ).rows[0];
  const second = (
    await pool.query('SELECT id FROM users WHERE tenant_id=$1 AND id<>$2', [
      tenantId,
      own.user_id,
    ])
  ).rows[0];
  for (const [userId, username, hash, code] of [
    [second.id, 'bad@username', own.password_hash, '23514'],
    [second.id, 'fictional.valid', 'plaintext', '23514'],
    [second.id, own.username, own.password_hash, '23505'],
    [randomUUID(), 'fictional.valid', own.password_hash, '23503'],
  ])
    await expect(
      pool.query(
        'INSERT INTO password_credentials (tenant_id,user_id,username,password_hash) VALUES ($1,$2,$3,$4)',
        [tenantId, userId, username, hash],
      ),
    ).rejects.toMatchObject({ code });
});
