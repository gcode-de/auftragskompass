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
  mailTemplateRepository,
  registerMailTemplateRoutes,
  type MailTemplateInput,
} from '../../packages/core/src/mail-templates.js';

// MAIL-TPL-01a: synthetic templates only. Every address ends in
// @example.invalid and nothing is ever sent anywhere.
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
  otherActorId: string;

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
  otherActorId = owners.rows.find(
    (row) => row.tenant_id === otherTenantId,
  )!.user_id;

  app = Fastify();
  await registerAuth(app, pool, config);
  registerMailTemplateRoutes(app, pool, tenantId);
}, 120000);

afterAll(async () => {
  await app?.close();
  await pool?.end();
  await container?.stop();
});

function templateInput(
  overrides: Partial<MailTemplateInput> = {},
): MailTemplateInput {
  return {
    name: 'Fictional template',
    subject: 'Erinnerung für {{contact}}',
    bodyHtml: '<p>Hallo <strong>{{contactFirstName}}</strong></p>',
    state: 'active',
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

test('templates are created, listed, fetched and updated with their version', async () => {
  const { headers, csrf } = await signedIn();
  const created = await app.inject({
    method: 'POST',
    url: '/api/v1/mail-templates',
    headers: { ...headers, ...csrf },
    payload: templateInput(),
  });
  expect(created.statusCode).toBe(201);
  const detail = created.json();
  expect(detail).toMatchObject({
    name: 'Fictional template',
    subject: 'Erinnerung für {{contact}}',
    bodyHtml: '<p>Hallo <strong>{{contactFirstName}}</strong></p>',
    state: 'active',
    version: 1,
  });
  expect(detail).not.toHaveProperty('tenantId');
  const id = detail.id as string;

  // The list carries summaries without bodies; the detail carries the body.
  const list = await app.inject({
    url: '/api/v1/mail-templates',
    headers,
  });
  expect(list.statusCode).toBe(200);
  expect(list.json()).toHaveLength(1);
  expect(list.json()[0]).not.toHaveProperty('bodyHtml');
  expect(
    (await app.inject({ url: '/api/v1/mail-templates/' + id, headers })).json()
      .bodyHtml,
  ).toBe('<p>Hallo <strong>{{contactFirstName}}</strong></p>');

  // Updates are complete changes with optimistic locking.
  const updated = await app.inject({
    method: 'PUT',
    url: '/api/v1/mail-templates/' + id,
    headers: { ...headers, ...csrf },
    payload: { ...templateInput({ name: 'Renamed' }), version: 1 },
  });
  expect(updated.statusCode).toBe(200);
  expect(updated.json()).toMatchObject({ name: 'Renamed', version: 2 });
  const conflict = await app.inject({
    method: 'PUT',
    url: '/api/v1/mail-templates/' + id,
    headers: { ...headers, ...csrf },
    payload: { ...templateInput({ name: 'Renamed' }), version: 1 },
  });
  expect(conflict.statusCode).toBe(409);
  expect(conflict.json()).toEqual({ error: 'conflict' });

  // Archiving is a visible state change, not a deletion.
  const archived = await app.inject({
    method: 'PUT',
    url: '/api/v1/mail-templates/' + id,
    headers: { ...headers, ...csrf },
    payload: {
      ...templateInput({ name: 'Renamed', state: 'archived' }),
      version: 2,
    },
  });
  expect(archived.statusCode).toBe(200);
  expect(archived.json()).toMatchObject({ state: 'archived', version: 3 });
  expect(
    (await app.inject({ url: '/api/v1/mail-templates/' + id, headers }))
      .statusCode,
  ).toBe(200);
  expect(
    (
      await app.inject({
        url: '/api/v1/mail-templates/' + randomUUID(),
        headers,
      })
    ).statusCode,
  ).toBe(404);
});

test('template content is sanitized and unknown placeholders are refused', async () => {
  const { headers, csrf } = await signedIn();
  const post = (payload: unknown) =>
    app.inject({
      method: 'POST',
      url: '/api/v1/mail-templates',
      headers: { ...headers, ...csrf },
      payload: payload as Record<string, unknown>,
    });
  // Unknown placeholder names are invalid content, in the subject as well;
  // schema-level refusals answer the generic Fastify error, semantic ones
  // name their closed code.
  for (const [payload, error] of [
    [templateInput({ subject: '{{Kontakt_Vorname}}' }), 'invalid_content'],
    [templateInput({ bodyHtml: '<p>{{nope}}</p>' }), 'invalid_content'],
    [templateInput({ subject: 'a\nb' }), 'invalid_subject'],
    [templateInput({ name: ' ' }), 'invalid_name'],
    [templateInput({ name: '' }), 'Bad Request'],
    [
      templateInput({
        state: 'deleted',
      } as unknown as Partial<MailTemplateInput>),
      'Bad Request',
    ],
    [templateInput({ bodyHtml: 'x'.repeat(200001) }), 'Bad Request'],
  ] as const) {
    const response = await post(payload);
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe(error);
  }
  // Markup outside the allowlist never reaches the stored row.
  const created = await post(
    templateInput({
      bodyHtml:
        '<p onclick="evil()">Hallo</p><script>evil()</script><a href="javascript:evil()">x</a>',
    }),
  );
  expect(created.statusCode).toBe(201);
  expect(created.json().bodyHtml).toBe('<p>Hallo</p><a>x</a>');
});

test('the template preview resolves with synthetic values and persists nothing', async () => {
  const { headers, csrf } = await signedIn();
  const countRows = async () =>
    (
      await pool.query(
        'SELECT (SELECT count(*) FROM mail_templates) AS templates',
      )
    ).rows[0];
  const before = await countRows();
  const preview = await app.inject({
    method: 'POST',
    url: '/api/v1/mail-templates/preview',
    headers: { ...headers, ...csrf },
    payload: {
      subject: 'Erinnerung für {{contactFirstName}}',
      bodyHtml: '<p>Hallo {{contactFirstName}} {{package}}</p>',
    },
  });
  expect(preview.statusCode).toBe(200);
  expect(preview.json()).toEqual({
    subject: 'Erinnerung für Alex',
    bodyHtml: '<p>Hallo Alex Paket Beispiel</p>',
    bodyText: 'Hallo Alex Paket Beispiel',
    missing: [],
  });
  // Session and CSRF are required like everywhere else.
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/api/v1/mail-templates/preview',
        payload: { subject: 'x', bodyHtml: '<p>x</p>' },
      })
    ).statusCode,
  ).toBe(401);
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/api/v1/mail-templates/preview',
        headers,
        payload: { subject: 'x', bodyHtml: '<p>x</p>' },
      })
    ).statusCode,
  ).toBe(403);
  const refused = await app.inject({
    method: 'POST',
    url: '/api/v1/mail-templates/preview',
    headers: { ...headers, ...csrf },
    payload: { subject: '{{nope}}', bodyHtml: '<p>x</p>' },
  });
  expect(refused.statusCode).toBe(400);
  expect(refused.json()).toEqual({ error: 'invalid_content' });
  expect(await countRows()).toEqual(before);
});

test('templates are tenant-bound and writing needs an administrator', async () => {
  const foreign = mailTemplateRepository(pool, otherTenantId);
  const own = mailTemplateRepository(pool, tenantId);
  const saved = await foreign.save(otherActorId, {
    name: 'Foreign template',
    subject: 'Fremde {{contact}}',
    bodyHtml: '<p>x</p>',
  });
  // The foreign template never shows up in this tenant's list or detail.
  const { headers } = await signedIn();
  expect(
    (await app.inject({ url: '/api/v1/mail-templates', headers })).json(),
  ).not.toContainEqual(expect.objectContaining({ id: saved.id }));
  expect(
    (
      await app.inject({
        url: '/api/v1/mail-templates/' + saved.id,
        headers,
      })
    ).statusCode,
  ).toBe(404);
  expect(await own.list()).not.toContainEqual(
    expect.objectContaining({ id: saved.id }),
  );
  await expect(
    own.save(randomUUID(), {
      name: 'Nope',
      subject: 'x',
      bodyHtml: '<p>x</p>',
    }),
  ).rejects.toThrow();
  await expect(foreign.get(saved.id)).resolves.toMatchObject({
    name: 'Foreign template',
  });
});
