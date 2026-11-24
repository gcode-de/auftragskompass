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
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { localStorageAdapter } from '../../packages/core/src/storage.js';
import {
  mailSignatureRepository,
  registerMailSignatureRoutes,
} from '../../packages/core/src/mail-signatures.js';

// MAIL-SIG-01a: synthetic signatures and a synthetic 1x1 logo only.
const tenantId = randomUUID(),
  otherTenantId = randomUUID(),
  email = 'mail.templates.owner@example.invalid',
  password = 'Fictional password 123!';
const config = {
  mode: 'password' as const,
  origin: 'https://admin.example.invalid',
  tenantId,
};
let container: StartedPostgreSqlContainer,
  pool: Pool,
  app: FastifyInstance,
  actorId: string,
  otherActorId: string,
  storeRoot: string,
  store: ReturnType<typeof localStorageAdapter>;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:17.6-alpine').start();
  pool = new Pool({ connectionString: container.getConnectionUri() });
  await migrate(pool);
  await bootstrapAccess(
    pool,
    tenantId,
    email,
    'Fictional template business',
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

  storeRoot = mkdtempSync(join(tmpdir(), 'ak-mail-signatures-'));
  store = localStorageAdapter({ root: storeRoot });
  app = Fastify();
  await registerAuth(app, pool, config);
  registerMailSignatureRoutes(app, pool, tenantId, store);
}, 120000);

afterAll(async () => {
  await app?.close();
  await pool?.end();
  await container?.stop();
  if (storeRoot) rmSync(storeRoot, { recursive: true, force: true });
});

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

// A synthetic 1x1 PNG: the signature bytes of the format and nothing else.
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);
const input = {
  name: 'Fiktive Signatur',
  bodyHtml: '<p>Viele Grüße</p><p>{{logo}}</p><script>alert(1)</script>',
  logoLink: 'https://example.invalid/',
  isDefault: true,
};

test('signatures are created, listed, updated and removed with one standard', async () => {
  const { headers, csrf } = await signedIn();
  const write = { ...headers, ...csrf };
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/api/v1/mail-signatures',
        headers,
        payload: input,
      })
    ).statusCode,
  ).toBe(403);
  const first = await app.inject({
    method: 'POST',
    url: '/api/v1/mail-signatures',
    headers: write,
    payload: input,
  });
  expect(first.statusCode).toBe(201);
  // The allowlist runs on the server; the logo token survives as text.
  expect(first.json()).toMatchObject({
    name: 'Fiktive Signatur',
    bodyHtml: '<p>Viele Grüße</p><p>{{logo}}</p>',
    isDefault: true,
    hasLogo: false,
  });
  const second = await app.inject({
    method: 'POST',
    url: '/api/v1/mail-signatures',
    headers: write,
    payload: { ...input, name: 'Zweite', logoLink: '' },
  });
  // A new standard: the old one steps down in the same transaction.
  const list = (
    await app.inject({ url: '/api/v1/mail-signatures', headers })
  ).json() as { id: string; isDefault: boolean }[];
  expect(list.map((row) => [row.id, row.isDefault])).toEqual([
    [second.json().id, true],
    [first.json().id, false],
  ]);
  const updated = await app.inject({
    method: 'PUT',
    url: '/api/v1/mail-signatures/' + first.json().id,
    headers: write,
    payload: { ...input, name: '  Erste  ', isDefault: false },
  });
  expect(updated.json()).toMatchObject({ name: 'Erste', isDefault: false });
  expect(
    (
      await app.inject({
        method: 'DELETE',
        url: '/api/v1/mail-signatures/' + second.json().id,
        headers: write,
      })
    ).statusCode,
  ).toBe(204);
  expect(
    (await app.inject({ url: '/api/v1/mail-signatures', headers })).json(),
  ).toHaveLength(1);
  expect(
    (
      await pool.query(
        "SELECT count(*) FROM audit_events WHERE tenant_id=$1 AND action='mail.signature_saved'",
        [tenantId],
      )
    ).rows[0].count,
  ).toBe('4');
});

test('invalid input is refused with its own code', async () => {
  const { headers, csrf } = await signedIn();
  const post = (payload: Record<string, unknown>) =>
    app.inject({
      method: 'POST',
      url: '/api/v1/mail-signatures',
      headers: { ...headers, ...csrf },
      payload: { ...input, isDefault: false, ...payload },
    });
  expect((await post({ name: '   ' })).json()).toEqual({
    error: 'invalid_name',
  });
  expect((await post({ bodyHtml: '<p>{{contact}}</p>' })).json()).toEqual({
    error: 'invalid_content',
  });
  expect((await post({ logoLink: 'javascript:alert(1)' })).json()).toEqual({
    error: 'invalid_link',
  });
  expect((await post({ logoLink: 'kein link' })).json()).toEqual({
    error: 'invalid_link',
  });
  const missing = await app.inject({
    method: 'PUT',
    url: '/api/v1/mail-signatures/' + randomUUID(),
    headers: { ...headers, ...csrf },
    payload: input,
  });
  expect(missing.statusCode).toBe(404);
});

test('the logo is checked by its bytes, stored and read back', async () => {
  const { headers, csrf } = await signedIn();
  const created = (
    await app.inject({
      method: 'POST',
      url: '/api/v1/mail-signatures',
      headers: { ...headers, ...csrf },
      payload: { ...input, isDefault: false, name: 'Mit Logo' },
    })
  ).json();
  const url = '/api/v1/mail-signatures/' + created.id + '/logo';
  // A renamed text file is not an image.
  const fake = await app.inject({
    method: 'PUT',
    url,
    headers: { ...headers, ...csrf, 'content-type': 'image/png' },
    payload: Buffer.from('not an image'),
  });
  expect(fake.json()).toEqual({ error: 'invalid_logo' });
  const saved = await app.inject({
    method: 'PUT',
    url,
    headers: { ...headers, ...csrf, 'content-type': 'image/png' },
    payload: png,
  });
  expect(saved.statusCode).toBe(200);
  expect(saved.json().hasLogo).toBe(true);
  const read = await app.inject({ url, headers });
  expect(read.headers['content-type']).toBe('image/png');
  expect(read.rawPayload.equals(png)).toBe(true);
  const row = (
    await pool.query(
      'SELECT logo_size_bytes, logo_sha256 FROM mail_signatures WHERE tenant_id=$1 AND id=$2',
      [tenantId, created.id],
    )
  ).rows[0];
  expect(row.logo_size_bytes).toBe(png.byteLength);
  expect(row.logo_sha256).toMatch(/^[a-f0-9]{64}$/);
  const cleared = await app.inject({
    method: 'DELETE',
    url,
    headers: { ...headers, ...csrf },
  });
  expect(cleared.json().hasLogo).toBe(false);
  expect((await app.inject({ url, headers })).statusCode).toBe(404);
});

test('a foreign tenant never sees or changes these signatures', async () => {
  const foreign = mailSignatureRepository(pool, otherTenantId, store);
  expect(await foreign.list()).toEqual([]);
  const own = await mailSignatureRepository(pool, tenantId, store).list();
  await expect(
    foreign.update(otherActorId, own[0]!.id, { ...input, isDefault: false }),
  ).rejects.toMatchObject({ reason: 'not_found' });
  // The database itself holds the one-standard rule.
  await expect(
    pool.query(
      `INSERT INTO mail_signatures (tenant_id,id,name,is_default)
       VALUES ($1,$2,'A',true),($1,$3,'B',true)`,
      [otherTenantId, randomUUID(), randomUUID()],
    ),
  ).rejects.toThrow();
  expect(actorId).toBeTruthy();
});
