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
test('90-day session survives restart without sliding expiry and still rejects an expired token', async () => {
  await server();
  const response = await login();
  expect(response.statusCode).toBe(204);
  const cookie = response.cookies[0]!;
  expect(cookie.maxAge).toBe(90 * 24 * 60 * 60);
  const hash = digest(cookie.value);
  const readExpiry = async () =>
    (
      await pool.query(
        'SELECT expires_at FROM sessions WHERE tenant_id=$1 AND token_hash=$2',
        [tenantId, hash],
      )
    ).rows[0].expires_at as Date;
  expect(
    Math.abs(
      (await readExpiry()).getTime() - Date.now() - 90 * 24 * 60 * 60_000,
    ),
  ).toBeLessThan(5000);
  // Represent the last day of the session without advancing the real database clock.
  await pool.query(
    "UPDATE sessions SET expires_at=now()+interval '1 day' WHERE tenant_id=$1 AND token_hash=$2",
    [tenantId, hash],
  );
  const expiry = await readExpiry();
  await server();
  const cookies = { '__Host-ak-session': cookie.value };
  expect((await app.inject({ url: '/auth/me', cookies })).statusCode).toBe(200);
  expect(await readExpiry()).toEqual(expiry);
  await pool.query(
    "UPDATE sessions SET expires_at=now()-interval '1 second' WHERE tenant_id=$1 AND token_hash=$2",
    [tenantId, hash],
  );
  expect((await app.inject({ url: '/auth/me', cookies })).statusCode).toBe(401);
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

test('password changes verify the current secret and revoke every session atomically', async () => {
  await server();
  const first = await login();
  const second = await login();
  const cookie = (response: typeof first) => ({
    cookie: `${response.cookies[0]!.name}=${response.cookies[0]!.value}`,
  });
  const headers = cookie(first);
  const me = (await app.inject({ url: '/auth/me', headers })).json();
  const auth = {
    ...headers,
    origin: config.origin,
    'x-csrf-token': me.csrfToken,
  };
  const next = 'Fictional replacement password 456!';
  const change = (currentPassword: string, newPassword = next, extra = auth) =>
    app.inject({
      method: 'POST',
      url: '/auth/password',
      headers: extra,
      payload: { currentPassword, newPassword },
    });
  expect((await change('incorrect')).statusCode).toBe(403);
  expect((await change(password, 'short')).statusCode).toBe(400);
  expect(
    (
      await change(password, next, {
        ...auth,
        origin: 'https://attacker.invalid',
      })
    ).statusCode,
  ).toBe(403);
  const result = await change(password);
  expect(result.statusCode).toBe(204);
  expect(result.cookies[0]!.value).toBe('');
  for (const h of [headers, cookie(second)])
    expect((await app.inject({ url: '/auth/me', headers: h })).statusCode).toBe(
      401,
    );
  expect((await login()).statusCode).toBe(401);
  const loggedIn = await login(undefined, next);
  expect(loggedIn.statusCode).toBe(204);
  const currentHeaders = cookie(loggedIn);
  const csrf = (
    await app.inject({ url: '/auth/me', headers: currentHeaders })
  ).json().csrfToken;
  const row = (
    await pool.query(
      'SELECT password_hash,user_id FROM password_credentials WHERE tenant_id=$1',
      [tenantId],
    )
  ).rows[0];
  expect(row.password_hash).not.toContain(next);
  await pool.query('ALTER TABLE audit_events RENAME TO unavailable_audit');
  try {
    expect(
      (
        await change(next, password, {
          ...currentHeaders,
          origin: config.origin,
          'x-csrf-token': csrf,
        })
      ).statusCode,
    ).toBe(500);
  } finally {
    await pool.query('ALTER TABLE unavailable_audit RENAME TO audit_events');
  }
  expect(
    (await app.inject({ url: '/auth/me', headers: currentHeaders })).statusCode,
  ).toBe(200);
  expect(
    (
      await pool.query(
        'SELECT password_hash FROM password_credentials WHERE tenant_id=$1',
        [tenantId],
      )
    ).rows[0].password_hash,
  ).toBe(row.password_hash);
  expect(
    (
      await change(next, password, {
        ...currentHeaders,
        origin: config.origin,
        'x-csrf-token': csrf,
      })
    ).statusCode,
  ).toBe(204);
});

test('password changes share persistent locks, reject foreign identities and serialize revocation', async () => {
  await server();
  const user = (
    await pool.query(
      'SELECT user_id FROM password_credentials WHERE tenant_id=$1',
      [tenantId],
    )
  ).rows[0].user_id;
  const repo = passwordAccess(pool, tenantId);
  expect(
    await repo.changePassword(
      randomUUID(),
      password,
      'Fictional next password',
    ),
  ).toBe(false);
  const other = (
    await pool.query(
      'SELECT tenant_id FROM password_credentials WHERE tenant_id<>$1',
      [tenantId],
    )
  ).rows[0].tenant_id;
  expect(
    await passwordAccess(pool, other).changePassword(
      user,
      password,
      'Fictional next password',
    ),
  ).toBe(false);
  const session = await login();
  const headers = {
    cookie: `${session.cookies[0]!.name}=${session.cookies[0]!.value}`,
  };
  const csrf = (await app.inject({ url: '/auth/me', headers })).json()
    .csrfToken;
  const auth = { ...headers, origin: config.origin, 'x-csrf-token': csrf };
  const next = 'Fictional next password';
  const change = (currentPassword: string, newPassword = next) =>
    app.inject({
      method: 'POST',
      url: '/auth/password',
      headers: auth,
      payload: { currentPassword, newPassword },
    });
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/auth/password',
        payload: { currentPassword: password, newPassword: next },
      })
    ).statusCode,
  ).toBe(401);
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/auth/password',
        headers,
        payload: { currentPassword: password, newPassword: next },
      })
    ).statusCode,
  ).toBe(403);
  expect((await change(password, '🔐'.repeat(70))).statusCode).toBe(400);
  expect((await change('x'.repeat(129))).statusCode).toBe(400);
  for (let i = 0; i < 5; i++)
    expect((await change('incorrect')).statusCode).toBe(403);
  await server();
  expect((await change(password)).statusCode).toBe(403);
  await pool.query(
    "UPDATE password_credentials SET locked_until=now()-interval '1 second' WHERE tenant_id=$1",
    [tenantId],
  );
  const concurrent = await Promise.all([change(password), change(password)]);
  expect(concurrent.map((r) => r.statusCode).sort()).toEqual([204, 429]);
  const second = (
    await pool.query('SELECT id FROM users WHERE tenant_id=$1 AND email=$2', [
      tenantId,
      'fictional.second@example.invalid',
    ])
  ).rows[0].id;
  const access = accessRepository(pool, tenantId),
    account = (await access.list()).find((a) => a.email === email)!;
  const third = 'Fictional third password';
  const [changed] = await Promise.all([
    repo.changePassword(user, next, third),
    access.change(second, account.id, false),
  ]);
  expect((await access.list()).find((a) => a.id === account.id)!.active).toBe(
    false,
  );
  expect(
    await repo.changePassword(user, changed ? third : next, password),
  ).toBe(false);
  expect(
    (
      await pool.query(
        'SELECT * FROM sessions WHERE tenant_id=$1 AND user_id=$2',
        [tenantId, user],
      )
    ).rowCount,
  ).toBe(0);
  await access.change(second, account.id, true);
  expect(
    await repo.changePassword(user, changed ? third : next, password),
  ).toBe(true);
  const audit = (
    await pool.query(
      "SELECT action FROM audit_events WHERE tenant_id=$1 AND action LIKE 'password.%'",
      [tenantId],
    )
  ).rows;
  expect(audit.some((a) => a.action === 'password.changed')).toBe(true);
  expect(audit.some((a) => a.action === 'password.change_denied')).toBe(true);
});

test('password-change validation and throttling run before any credential mutation', async () => {
  await server();
  const session = await login();
  const headers = {
    cookie: `${session.cookies[0]!.name}=${session.cookies[0]!.value}`,
  };
  const csrf = (await app.inject({ url: '/auth/me', headers })).json()
    .csrfToken;
  for (let i = 0; i < 20; i++)
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/auth/password',
          headers: { ...headers, origin: config.origin, 'x-csrf-token': csrf },
          payload: {},
        })
      ).statusCode,
    ).toBe(400);
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/auth/password',
        headers: { ...headers, origin: config.origin, 'x-csrf-token': csrf },
        payload: {
          currentPassword: password,
          newPassword: 'Fictional ignored password',
        },
      })
    ).statusCode,
  ).toBe(429);
  await server();
  expect((await login()).statusCode).toBe(204);
});

test('operator recovery only resets active native accounts and preserves foreign sessions with matching user IDs', async () => {
  await server();
  const own = (
    await pool.query('SELECT * FROM password_credentials WHERE tenant_id=$1', [
      tenantId,
    ])
  ).rows[0];
  const other = (
    await pool.query(
      'SELECT tenant_id FROM password_credentials WHERE tenant_id<>$1',
      [tenantId],
    )
  ).rows[0].tenant_id;
  const foreignToken = digest('fictional-foreign-sentinel');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'INSERT INTO users(tenant_id,id,email) VALUES($1,$2,$3)',
      [other, own.user_id, 'fictional.mirror@example.invalid'],
    );
    await client.query(
      'INSERT INTO memberships(tenant_id,user_id) VALUES($1,$2)',
      [other, own.user_id],
    );
    await client.query(
      'INSERT INTO allowed_accounts(tenant_id,id,email,user_id) VALUES($1,$2,$3,$4)',
      [other, randomUUID(), 'fictional.mirror@example.invalid', own.user_id],
    );
    await client.query(
      'INSERT INTO password_credentials(tenant_id,user_id,username,password_hash) VALUES($1,$2,$3,$4)',
      [other, own.user_id, 'fictional.mirror', own.password_hash],
    );
    await client.query(
      "INSERT INTO sessions(tenant_id,user_id,token_hash,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",
      [other, own.user_id, foreignToken],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  const repo = passwordAccess(pool, tenantId),
    next = 'Fictional operator recovery password';
  expect(await repo.resetPasswordAsOperator('fictional.mirror', next)).toBe(
    false,
  );
  await expect(
    repo.resetPasswordAsOperator('bad@username', next),
  ).rejects.toThrow();
  await expect(
    repo.resetPasswordAsOperator('fictional.owner', 'short'),
  ).rejects.toThrow();
  const old = await login();
  await pool.query(
    "UPDATE password_credentials SET failures=5,locked_until=now()+interval '15 minutes' WHERE tenant_id=$1",
    [tenantId],
  );
  expect(await repo.resetPasswordAsOperator(' FICTIONAL.OWNER ', next)).toBe(
    true,
  );
  expect(
    (
      await app.inject({
        url: '/auth/me',
        headers: { cookie: `${old.cookies[0]!.name}=${old.cookies[0]!.value}` },
      })
    ).statusCode,
  ).toBe(401);
  const current = await login(undefined, next);
  expect(current.statusCode).toBe(204);
  const hash = (
    await pool.query(
      'SELECT password_hash FROM password_credentials WHERE tenant_id=$1',
      [tenantId],
    )
  ).rows[0].password_hash;
  await pool.query('ALTER TABLE audit_events RENAME TO unavailable_audit');
  try {
    await expect(
      repo.resetPasswordAsOperator('fictional.owner', password),
    ).rejects.toThrow();
  } finally {
    await pool.query('ALTER TABLE unavailable_audit RENAME TO audit_events');
  }
  expect(
    (
      await pool.query(
        'SELECT password_hash FROM password_credentials WHERE tenant_id=$1',
        [tenantId],
      )
    ).rows[0].password_hash,
  ).toBe(hash);
  expect(
    (
      await app.inject({
        url: '/auth/me',
        headers: {
          cookie: `${current.cookies[0]!.name}=${current.cookies[0]!.value}`,
        },
      })
    ).statusCode,
  ).toBe(200);
  const second = (
    await pool.query('SELECT id FROM users WHERE tenant_id=$1 AND email=$2', [
      tenantId,
      'fictional.second@example.invalid',
    ])
  ).rows[0].id;
  const access = accessRepository(pool, tenantId),
    account = (await access.list()).find((a) => a.email === email)!;
  await access.change(second, account.id, false);
  expect(await repo.resetPasswordAsOperator('fictional.owner', password)).toBe(
    false,
  );
  expect((await access.list()).find((a) => a.id === account.id)!.active).toBe(
    false,
  );
  await access.change(second, account.id, true);
  expect(await repo.resetPasswordAsOperator('fictional.owner', password)).toBe(
    true,
  );
  expect(
    (
      await pool.query(
        'SELECT password_hash FROM password_credentials WHERE tenant_id=$1 AND user_id=$2',
        [other, own.user_id],
      )
    ).rows[0].password_hash,
  ).toBe(own.password_hash);
  expect(
    (
      await pool.query(
        'SELECT * FROM sessions WHERE tenant_id=$1 AND token_hash=$2',
        [other, foreignToken],
      )
    ).rowCount,
  ).toBe(1);
  expect(
    (
      await pool.query(
        "SELECT actor_id,record_id FROM audit_events WHERE tenant_id=$1 AND action='password.reset' ORDER BY id DESC LIMIT 1",
        [tenantId],
      )
    ).rows[0],
  ).toEqual({ actor_id: null, record_id: own.user_id });
});
