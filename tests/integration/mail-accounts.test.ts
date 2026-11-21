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
import {
  mailRepository,
  registerMailRoutes,
  type MailAccountInput,
} from '../../packages/core/src/mail.js';

// MAIL-ACCOUNT-01: synthetic tenants, accounts and secrets only. Every address
// ends in @example.invalid and no provider is contacted at any point.
const tenantId = randomUUID(),
  otherTenantId = randomUUID(),
  email = 'mail.settings.owner@example.invalid',
  password = 'Fictional password 123!',
  encryptionKey = Buffer.alloc(32, 7);
const config = {
  mode: 'password' as const,
  origin: 'https://admin.example.invalid',
  tenantId,
};
let container: StartedPostgreSqlContainer,
  pool: Pool,
  app: FastifyInstance,
  actorId: string,
  otherActorId: string;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:17.6-alpine').start();
  pool = new Pool({ connectionString: container.getConnectionUri() });
  await migrate(pool);
  await bootstrapAccess(
    pool,
    tenantId,
    email,
    'Fictional mail business',
    'Europe/Berlin',
  );
  await bootstrapAccess(
    pool,
    otherTenantId,
    'other.mail.owner@example.invalid',
    'Fictional other tenant',
    'Europe/Berlin',
  );
  await bootstrapPassword(
    pool,
    tenantId,
    email,
    'fictional.mail.owner',
    () => password,
  );
  await bootstrapPassword(
    pool,
    otherTenantId,
    'other.mail.owner@example.invalid',
    'fictional.other.mail.owner',
    () => password,
  );
  const owners = await pool.query<{ tenant_id: string; user_id: string }>(
    'SELECT tenant_id,user_id FROM allowed_accounts WHERE tenant_id=ANY($1)',
    [[tenantId, otherTenantId]],
  );
  actorId = owners.rows.find((row) => row.tenant_id === tenantId)!.user_id;
  otherActorId = owners.rows.find(
    (row) => row.tenant_id === otherTenantId,
  )!.user_id;

  app = Fastify();
  await registerAuth(app, pool, config);
  registerMailRoutes(app, pool, tenantId, { key: encryptionKey });
}, 120000);

afterAll(async () => {
  await app?.close();
  await pool?.end();
  await container?.stop();
});

function accountInput(
  overrides: Partial<MailAccountInput> = {},
): MailAccountInput {
  return {
    name: 'Fictional sending account',
    fromName: 'Fotobox Muster',
    fromAddress: 'versand@example.invalid',
    smtpHost: 'smtp.example.invalid',
    smtpPort: 587,
    smtpSecurity: 'starttls',
    username: 'synthetic.sender@example.invalid',
    secret: 'synthetic-smtp-secret',
    ...overrides,
  };
}

async function signedIn() {
  const login = await app.inject({
    method: 'POST',
    url: '/auth/login',
    headers: { origin: config.origin },
    payload: { identifier: 'fictional.mail.owner', password },
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

test('creating an account seals the secret and never answers with it', async () => {
  const repo = mailRepository(pool, tenantId, encryptionKey);
  const account = await repo.saveAccount(actorId, accountInput());
  expect(account).toMatchObject({
    name: 'Fictional sending account',
    fromName: 'Fotobox Muster',
    fromAddress: 'versand@example.invalid',
    smtpHost: 'smtp.example.invalid',
    smtpPort: 587,
    smtpSecurity: 'starttls',
    username: 'synthetic.sender@example.invalid',
    enabled: true,
    hasSecret: true,
  });
  expect(JSON.stringify(account)).not.toContain('synthetic-smtp-secret');
  const stored = await pool.query<{
    secret_ciphertext: Buffer;
    secret_nonce: Buffer;
    secret_tag: Buffer;
    from_name: string;
    from_address: string;
    smtp_security: string;
  }>(
    'SELECT secret_ciphertext, secret_nonce, secret_tag, from_name, from_address, smtp_security FROM mail_accounts WHERE tenant_id=$1 AND id=$2',
    [tenantId, account.id],
  );
  expect(stored.rows[0]).toBeTruthy();
  expect(stored.rows[0]!.secret_ciphertext.toString('utf8')).not.toContain(
    'synthetic-smtp-secret',
  );
  expect(stored.rows[0]!.from_name).toBe('Fotobox Muster');
  expect(stored.rows[0]!.from_address).toBe('versand@example.invalid');
  expect(stored.rows[0]!.smtp_security).toBe('starttls');
});

test('changing an account keeps the sealed secret until a new one arrives', async () => {
  const repo = mailRepository(pool, tenantId, encryptionKey);
  const account = await repo.saveAccount(
    actorId,
    accountInput({ name: 'Fictional change account' }),
  );
  const before = await pool.query<{ secret_ciphertext: Buffer }>(
    'SELECT secret_ciphertext FROM mail_accounts WHERE tenant_id=$1 AND id=$2',
    [tenantId, account.id],
  );
  // No password at all (the key is absent), then an empty one: both keep the
  // sealed secret untouched.
  const withoutSecret = accountInput({
    name: 'Fictional change account',
    fromName: 'Neuer Absender',
  });
  delete withoutSecret.secret;
  const changed = await repo.updateAccount(actorId, account.id, withoutSecret);
  expect(changed.fromName).toBe('Neuer Absender');
  expect(changed.hasSecret).toBe(true);
  const withEmptySecret = await repo.updateAccount(
    actorId,
    account.id,
    accountInput({
      name: 'Fictional change account',
      secret: '',
    }),
  );
  expect(withEmptySecret.hasSecret).toBe(true);
  const middle = await pool.query<{ secret_ciphertext: Buffer }>(
    'SELECT secret_ciphertext FROM mail_accounts WHERE tenant_id=$1 AND id=$2',
    [tenantId, account.id],
  );
  expect(
    middle.rows[0]!.secret_ciphertext.equals(before.rows[0]!.secret_ciphertext),
  ).toBe(true);
  // A non-empty password replaces exactly it.
  const replaced = await repo.updateAccount(
    actorId,
    account.id,
    accountInput({
      name: 'Fictional change account',
      secret: 'synthetic-new-secret',
    }),
  );
  expect(replaced.hasSecret).toBe(true);
  const after = await pool.query<{ secret_ciphertext: Buffer }>(
    'SELECT secret_ciphertext FROM mail_accounts WHERE tenant_id=$1 AND id=$2',
    [tenantId, account.id],
  );
  expect(
    after.rows[0]!.secret_ciphertext.equals(before.rows[0]!.secret_ciphertext),
  ).toBe(false);
});

test('enabling needs a secret, sender and security values are validated', async () => {
  const repo = mailRepository(pool, tenantId, encryptionKey);
  const paused = await repo.saveAccount(
    actorId,
    accountInput({
      name: 'Fictional paused account',
      enabled: false,
      secret: '',
    }),
  );
  expect(paused.enabled).toBe(false);
  expect(paused.hasSecret).toBe(false);
  // Enabling without any sealed secret is refused, never invented.
  const enableAttempt = accountInput({ name: 'Fictional paused account' });
  delete enableAttempt.secret;
  await expect(
    repo.updateAccount(actorId, paused.id, enableAttempt),
  ).rejects.toMatchObject({ reason: 'secret_required' });
  await expect(
    repo.saveAccount(
      actorId,
      accountInput({ name: 'Fictional keyless account', secret: '' }),
    ),
  ).rejects.toMatchObject({ reason: 'secret_required' });
  await expect(
    repo.saveAccount(
      actorId,
      accountInput({
        name: 'Fictional broken sender',
        fromAddress: 'not-an-address',
      }),
    ),
  ).rejects.toMatchObject({ reason: 'invalid_sender' });
  await expect(
    repo.saveAccount(
      actorId,
      accountInput({
        name: 'Fictional header name',
        fromName: 'Evil <injected@example.invalid>',
      }),
    ),
  ).rejects.toMatchObject({ reason: 'invalid_sender' });
  // 'none' protects no credential: refused together with a username.
  await expect(
    repo.saveAccount(
      actorId,
      accountInput({
        name: 'Fictional clear text',
        smtpSecurity: 'none',
      }),
    ),
  ).rejects.toMatchObject({ reason: 'invalid_security' });
  await expect(
    repo.saveAccount(
      actorId,
      accountInput({
        name: 'Fictional unknown security',
        // A hostile caller is not bound by the type union.
        smtpSecurity: 'starttls ' as NonNullable<
          MailAccountInput['smtpSecurity']
        >,
      }),
    ),
  ).rejects.toMatchObject({ reason: 'invalid_security' });
  // The local relay case: no username, so 'none' is allowed and no AUTH runs.
  const relay = await repo.saveAccount(
    actorId,
    accountInput({
      name: 'Fictional local relay',
      smtpSecurity: 'none',
      username: '',
      secret: '',
      enabled: false,
    }),
  );
  expect(relay.smtpSecurity).toBe('none');
});

test('accounts stay tenant-scoped and names stay unique per tenant', async () => {
  const repo = mailRepository(pool, tenantId, encryptionKey),
    otherRepo = mailRepository(pool, otherTenantId, encryptionKey);
  const mine = await repo.saveAccount(
    actorId,
    accountInput({ name: 'Fictional shared name' }),
  );
  await expect(
    repo.saveAccount(actorId, accountInput({ name: 'Fictional shared name' })),
  ).rejects.toMatchObject({ reason: 'already_exists' });
  // The same name in another tenant is a different account, not a conflict.
  const theirs = await otherRepo.saveAccount(
    otherActorId,
    accountInput({ name: 'Fictional shared name' }),
  );
  expect(theirs.id).not.toBe(mine.id);
  // Another tenant's account is missing here, never forbidden.
  await expect(
    repo.updateAccount(
      actorId,
      theirs.id,
      accountInput({ name: 'Fictional foreign change' }),
    ),
  ).rejects.toMatchObject({ reason: 'not_found' });
  expect((await otherRepo.listAccounts()).map((row) => row.id)).toEqual([
    theirs.id,
  ]);
  expect((await repo.listAccounts()).map((row) => row.id)).toContain(mine.id);
});

test('account routes require session and CSRF and answer without any secret', async () => {
  expect((await app.inject('/api/v1/mail/accounts')).statusCode).toBe(401);
  const { headers, csrf } = await signedIn();
  const created = await app.inject({
    method: 'POST',
    url: '/api/v1/mail/accounts',
    headers: { ...headers, ...csrf },
    payload: accountInput({ name: 'Fictional route account' }),
  });
  expect(created.statusCode).toBe(201);
  const account = created.json();
  expect(account.hasSecret).toBe(true);
  expect(created.body).not.toContain('synthetic-smtp-secret');
  expect(account).not.toHaveProperty('secret');
  expect(account).not.toHaveProperty('secretCiphertext');

  const list = await app.inject({ url: '/api/v1/mail/accounts', headers });
  expect(list.statusCode).toBe(200);
  expect(list.body).not.toContain('synthetic-smtp-secret');
  const rows = list.json();
  expect(rows.map((row: { id: string }) => row.id)).toContain(account.id);
  for (const row of rows) {
    expect(row).not.toHaveProperty('secret');
    expect(row).not.toHaveProperty('secretCiphertext');
    expect(row).not.toHaveProperty('secret_ciphertext');
    expect(typeof row.hasSecret).toBe('boolean');
  }

  const missingCsrf = await app.inject({
    method: 'PUT',
    url: `/api/v1/mail/accounts/${account.id}`,
    headers,
    payload: accountInput({ name: 'Fictional route account' }),
  });
  expect(missingCsrf.statusCode).toBe(403);
  expect(missingCsrf.json()).toEqual({ error: 'csrf_rejected' });

  const changed = await app.inject({
    method: 'PUT',
    url: `/api/v1/mail/accounts/${account.id}`,
    headers: { ...headers, ...csrf },
    payload: accountInput({
      name: 'Fictional route account',
      fromName: 'Neuer Anzeigename',
      secret: '',
    }),
  });
  expect(changed.statusCode).toBe(200);
  expect(changed.json()).toMatchObject({
    fromName: 'Neuer Anzeigename',
    hasSecret: true,
  });
  expect(changed.body).not.toContain('synthetic-smtp-secret');

  const conflict = await app.inject({
    method: 'POST',
    url: '/api/v1/mail/accounts',
    headers: { ...headers, ...csrf },
    payload: accountInput({ name: 'Fictional route account' }),
  });
  expect(conflict.statusCode).toBe(409);
  expect(conflict.json()).toEqual({ error: 'already_exists' });

  const invalid = await app.inject({
    method: 'POST',
    url: '/api/v1/mail/accounts',
    headers: { ...headers, ...csrf },
    payload: accountInput({
      name: 'Fictional invalid security',
      smtpSecurity: 'none',
    }),
  });
  expect(invalid.statusCode).toBe(400);
  expect(invalid.json()).toEqual({ error: 'invalid_security' });

  const missing = await app.inject({
    method: 'PUT',
    url: `/api/v1/mail/accounts/${randomUUID()}`,
    headers: { ...headers, ...csrf },
    payload: accountInput(),
  });
  expect(missing.statusCode).toBe(404);
  expect(missing.json()).toEqual({ error: 'not_found' });
});

test('without an encryption key the routes fail closed and store nothing', async () => {
  const keyless = Fastify();
  await registerAuth(keyless, pool, {
    ...config,
    tenantId: otherTenantId,
    origin: config.origin,
  });
  registerMailRoutes(keyless, pool, otherTenantId);
  const login = await keyless.inject({
    method: 'POST',
    url: '/auth/login',
    headers: { origin: config.origin },
    payload: { identifier: 'fictional.other.mail.owner', password },
  });
  const cookie = login.cookies[0]!,
    headers = {
      cookie: `${cookie.name}=${cookie.value}`,
      origin: config.origin,
    };
  const csrf = {
    'x-csrf-token': (await keyless.inject({ url: '/auth/me', headers })).json()
      .csrfToken,
  };
  const refused = await keyless.inject({
    method: 'POST',
    url: '/api/v1/mail/accounts',
    headers: { ...headers, ...csrf },
    payload: accountInput({ name: 'Fictional keyless route account' }),
  });
  expect(refused.statusCode).toBe(503);
  expect(refused.json()).toEqual({ error: 'encryption_unavailable' });
  const rows = await pool.query(
    'SELECT id FROM mail_accounts WHERE tenant_id=$1 AND name=$2',
    [otherTenantId, 'Fictional keyless route account'],
  );
  expect(rows.rows).toEqual([]);
  await keyless.close();
});

test('the account routes answer 403 for a session without an active membership', async () => {
  const forbidden = Fastify();
  forbidden.decorateRequest('authSession', null);
  forbidden.addHook('onRequest', async (request) => {
    request.authSession = { userId: randomUUID(), email };
  });
  registerMailRoutes(forbidden, pool, tenantId, { key: encryptionKey });
  expect((await forbidden.inject('/api/v1/mail/accounts')).statusCode).toBe(
    403,
  );
  expect(
    (
      await forbidden.inject({
        method: 'POST',
        url: '/api/v1/mail/accounts',
        payload: accountInput({ name: 'Fictional forbidden account' }),
      })
    ).statusCode,
  ).toBe(403);
  expect(
    (
      await forbidden.inject({
        method: 'PUT',
        url: `/api/v1/mail/accounts/${randomUUID()}`,
        payload: accountInput(),
      })
    ).statusCode,
  ).toBe(403);
  await forbidden.close();
});
