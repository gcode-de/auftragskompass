import { afterAll, beforeAll, expect, test } from 'vitest';
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { migrate } from '../../packages/core/src/identity.js';
import {
  bootstrapAccess,
  accessRepository,
} from '../../packages/core/src/access.js';
import {
  contactRepository,
  registerContactRoutes,
} from '../../packages/core/src/contacts.js';
import {
  createHealthServer,
  loadRuntimeConfig,
} from '../../packages/core/src/runtime.js';
import { registerAuth, digest } from '../../packages/core/src/auth.js';
import { syntheticGoogle } from '../helpers/oidc.js';
let container: StartedPostgreSqlContainer;
let pool: Pool;
const tenantId = randomUUID();
let actorId: string;
const input = {
  kind: 'company' as const,
  name: 'Synthetic Company',
  contactPerson: 'Fictional contact',
  street: 'Synthetic street',
  postalCode: '00000',
  city: 'Fictional city',
  country: 'DE',
  email: ' Synthetic@Example.Invalid ',
  phone: '030 000000',
  mobile: '',
  state: 'active' as const,
};
beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:17.6-alpine').start();
  pool = new Pool({ connectionString: container.getConnectionUri() });
  await migrate(pool);
  await bootstrapAccess(
    pool,
    tenantId,
    'contacts@example.invalid',
    'Synthetic contacts',
    'Europe/Berlin',
  );
  await accessRepository(pool, tenantId).issueSession(
    { subject: 'contacts', email: 'contacts@example.invalid' },
    digest('synthetic-contacts'),
  );
  actorId = (await accessRepository(pool, tenantId).list())[0]!.userId!;
});
afterAll(async () => {
  await pool?.end();
  await container?.stop();
});
test('contacts normalize, suggest duplicates across phone fields and keep archive references', async () => {
  const repo = contactRepository(pool, tenantId);
  const row = await repo.save(actorId, input);
  expect(row.email).toBe('synthetic@example.invalid');
  expect(
    await repo.duplicates({
      email: 'SYNTHETIC@example.invalid',
      phone: '',
      mobile: '',
      country: 'DE',
    }),
  ).toHaveLength(1);
  expect(
    await repo.duplicates({
      ...input,
      email: '',
      phone: '',
      mobile: '+49 (0)30 000000',
    }),
  ).toHaveLength(1);
  expect(
    await repo.duplicates({ ...input, email: '', phone: '', mobile: '' }),
  ).toEqual([]);
  expect(await repo.duplicates(input, row.id)).toEqual([]);
  expect(await repo.list('Synthetic')).toHaveLength(1);
  expect(await repo.list('%')).toEqual([]);
  expect(await repo.list('absent')).toEqual([]);
  await pool.query(
    'CREATE TABLE synthetic_contact_history(tenant_id uuid, contact_id uuid, FOREIGN KEY(tenant_id,contact_id) REFERENCES contacts(tenant_id,id))',
  );
  await pool.query('INSERT INTO synthetic_contact_history VALUES($1,$2)', [
    tenantId,
    row.id,
  ]);
  await repo.save(actorId, { ...input, state: 'archived' }, row.id, 1);
  expect((await repo.list())[0]!.state).toBe('archived');
  await expect(repo.save(actorId, input, row.id, 1)).rejects.toThrow(
    'conflict',
  );
  await expect(repo.save(actorId, input, randomUUID(), 1)).rejects.toThrow(
    'not_found',
  );
  await expect(repo.save(randomUUID(), input)).rejects.toThrow('forbidden');
  expect(await contactRepository(pool, randomUUID()).list()).toEqual([]);
  expect(await contactRepository(pool, randomUUID()).duplicates(input)).toEqual(
    [],
  );
  await expect(
    pool.query('DELETE FROM contacts WHERE tenant_id=$1 AND id=$2', [
      tenantId,
      row.id,
    ]),
  ).rejects.toMatchObject({ code: '23503' });
});
test('contact API authorizes reads, export and writes, validates and rolls back unaudited changes', async () => {
  const config = {
    origin: 'https://admin.example.invalid',
    tenantId,
    clientId: 'synthetic',
    clientSecret: 'synthetic',
  };
  const app = createHealthServer(
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
    config,
    (await syntheticGoogle(config)).provider,
  );
  registerContactRoutes(app, pool, tenantId);
  const cookies = { '__Host-ak-session': 'synthetic-contacts' },
    headers = {
      origin: config.origin,
      'x-csrf-token': digest('csrf:synthetic-contacts'),
    };
  const create = (payload: unknown) =>
    app.inject({
      method: 'POST',
      url: '/api/v1/contacts',
      cookies,
      headers,
      payload: payload as Record<string, unknown>,
    });
  try {
    for (const url of ['/api/v1/contacts', '/api/v1/contacts/export.csv'])
      expect((await app.inject(url)).statusCode).toBe(401);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/contacts',
          cookies,
          payload: input,
        })
      ).statusCode,
    ).toBe(403);
    for (const bad of [
      { name: ' ' },
      { email: 'bad' },
      { phone: 'javascript:bad' },
      { kind: 'unknown' },
      { country: 'Germany' },
      { state: 'deleted' },
    ])
      expect((await create({ ...input, ...bad })).statusCode).toBe(400);
    const created = await create({ ...input, name: '=Synthetic formula' });
    expect(created.statusCode).toBe(201);
    expect(created.json()).not.toHaveProperty('tenantId');
    expect(created.json()).not.toHaveProperty('phoneKey');
    expect(
      (
        await app.inject({ url: '/api/v1/contacts?q=%3DSynthetic', cookies })
      ).json(),
    ).toHaveLength(1);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/contacts/duplicates',
          cookies,
          headers,
          payload: {
            email: 'synthetic@example.invalid',
            phone: '',
            mobile: '',
            country: 'DE',
            excludeId: created.json().id,
          },
        })
      ).json(),
    ).toHaveLength(1);
    const exported = await app.inject({
      url: '/api/v1/contacts/export.csv',
      cookies,
    });
    expect(exported.headers['content-type']).toContain('text/csv');
    expect(exported.body).toContain("'=Synthetic formula");
    expect(exported.body).not.toContain('tenant_id');
    const update = (id: string, version: number) =>
      app.inject({
        method: 'PUT',
        url: '/api/v1/contacts/' + id,
        cookies,
        headers,
        payload: { ...input, state: 'archived', version },
      });
    expect((await update(created.json().id, 1)).statusCode).toBe(200);
    expect((await update(created.json().id, 1)).statusCode).toBe(409);
    expect((await update(randomUUID(), 1)).statusCode).toBe(404);
    await pool.query(
      'ALTER TABLE audit_events RENAME TO temporarily_missing_audit',
    );
    try {
      expect(
        (await create({ ...input, name: 'Must roll back' })).statusCode,
      ).toBe(500);
    } finally {
      await pool.query(
        'ALTER TABLE temporarily_missing_audit RENAME TO audit_events',
      );
    }
    expect(
      await contactRepository(pool, tenantId).list('Must roll back'),
    ).toEqual([]);
  } finally {
    await app.close();
  }
});
