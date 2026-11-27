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
import { registerResourceRoutes } from '../../packages/core/src/resources.js';

// RES-BKP-01: the managed resource categories and the navigation switch.
const tenantId = randomUUID(),
  otherTenant = randomUUID(),
  email = 'categories.owner@example.invalid',
  password = 'Fictional password 123!';
const config = {
  mode: 'password' as const,
  origin: 'https://admin.example.invalid',
  tenantId,
};
let container: StartedPostgreSqlContainer, pool: Pool, app: FastifyInstance;
let headers: Record<string, string>;
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
  await bootstrapAccess(
    pool,
    otherTenant,
    'other.owner@example.invalid',
    'Fictional other tenant',
    'Europe/Berlin',
  );
  await bootstrapPassword(
    pool,
    tenantId,
    email,
    'fictional.categories',
    () => password,
  );
  app = Fastify();
  await registerAuth(app, pool, config);
  registerResourceRoutes(app, pool, tenantId);
  const logged = await app.inject({
    method: 'POST',
    url: '/auth/login',
    headers: { origin: config.origin },
    payload: { identifier: 'fictional.categories', password },
  });
  const cookie = logged.cookies[0]!;
  const session = {
    cookie: `${cookie.name}=${cookie.value}`,
    origin: config.origin,
  };
  const me = await app.inject({ url: '/auth/me', headers: session });
  headers = { ...session, 'x-csrf-token': me.json().csrfToken };
});
afterAll(async () => {
  await app?.close();
  await pool?.end();
  await container?.stop();
});

type Category = {
  id: string;
  name: string;
  parentId: string | null;
  version: number;
  usage: number;
};
const list = async () =>
  (
    await app.inject({ url: '/api/v1/resource-categories', headers })
  ).json() as Category[];

test('existing resource categories are known, scoped to the tenant and counted', async () => {
  expect(
    (await app.inject({ url: '/api/v1/resource-categories' })).statusCode,
  ).toBe(401);
  const rows = await list();
  expect(rows.map((row) => [row.name, row.usage])).toEqual([
    ['Fotobox', 2],
    ['Zubehör', 2],
  ]);
  // The other tenant's seeded categories exist but never show up here.
  const { rows: other } = await pool.query(
    'SELECT count(*)::int AS n FROM resource_categories WHERE tenant_id=$1',
    [otherTenant],
  );
  expect(other[0].n).toBe(2);
});

test('a resource saved with a new category creates it; a rename follows to the resources', async () => {
  const created = await app.inject({
    method: 'POST',
    url: '/api/v1/resources',
    headers,
    payload: {
      name: 'Synthetic backdrop',
      code: 'SYN-BACK',
      category: '  Hintergründe ',
      description: '',
      quantity: 1,
      beforeDays: 0,
      afterDays: 0,
      blocked: false,
      state: 'active',
      position: 9,
    },
  });
  expect(created.statusCode).toBe(201);
  const backdrops = (await list()).find((row) => row.name === 'Hintergründe')!;
  expect(backdrops).toMatchObject({ usage: 1, parentId: null, version: 1 });
  const fotobox = (await list()).find((row) => row.name === 'Fotobox')!;
  const renamed = await app.inject({
    method: 'PUT',
    url: `/api/v1/resource-categories/${backdrops.id}`,
    headers,
    payload: { name: 'Fotowände', parentId: fotobox.id, version: 1 },
  });
  expect(renamed.statusCode).toBe(200);
  expect(renamed.json()).toMatchObject({
    name: 'Fotowände',
    parentId: fotobox.id,
    version: 2,
    usage: 1,
  });
  const { rows } = await pool.query(
    'SELECT category, version FROM resources WHERE tenant_id=$1 AND code=$2',
    [tenantId, 'SYN-BACK'],
  );
  expect(rows[0]).toEqual({ category: 'Fotowände', version: 2 });
  // A stale version, a duplicate name and a cycle are refused.
  const stale = await app.inject({
    method: 'PUT',
    url: `/api/v1/resource-categories/${backdrops.id}`,
    headers,
    payload: { name: 'Fotowände', parentId: null, version: 1 },
  });
  expect(stale.json()).toEqual({ error: 'conflict' });
  const duplicate = await app.inject({
    method: 'PUT',
    url: `/api/v1/resource-categories/${backdrops.id}`,
    headers,
    payload: { name: 'fotobox', parentId: null, version: 2 },
  });
  expect([duplicate.statusCode, duplicate.json()]).toEqual([
    409,
    { error: 'name_exists' },
  ]);
  const cycle = await app.inject({
    method: 'PUT',
    url: `/api/v1/resource-categories/${fotobox.id}`,
    headers,
    payload: { name: 'Fotobox', parentId: backdrops.id, version: 1 },
  });
  expect([cycle.statusCode, cycle.json()]).toEqual([
    400,
    { error: 'parent_cycle' },
  ]);
  const missing = await app.inject({
    method: 'PUT',
    url: `/api/v1/resource-categories/${randomUUID()}`,
    headers,
    payload: { name: 'Nirgends', parentId: null, version: 1 },
  });
  expect(missing.statusCode).toBe(404);
});

test('categories are created nested, deleted only when unused and without children', async () => {
  const parent = (await list()).find((row) => row.name === 'Zubehör')!;
  const created = await app.inject({
    method: 'POST',
    url: '/api/v1/resource-categories',
    headers,
    payload: { name: ' Requisiten ', parentId: parent.id },
  });
  expect(created.statusCode).toBe(201);
  expect(created.json()).toMatchObject({
    name: 'Requisiten',
    parentId: parent.id,
    usage: 0,
  });
  const orphan = await app.inject({
    method: 'POST',
    url: '/api/v1/resource-categories',
    headers,
    payload: { name: 'Verwaist', parentId: randomUUID() },
  });
  expect(orphan.json()).toEqual({ error: 'parent_not_found' });
  const withoutCsrf = await app.inject({
    method: 'POST',
    url: '/api/v1/resource-categories',
    headers: { cookie: headers.cookie!, origin: config.origin },
    payload: { name: 'Ohne Token', parentId: null },
  });
  expect(withoutCsrf.statusCode).toBe(403);
  const inUse = await app.inject({
    method: 'DELETE',
    url: `/api/v1/resource-categories/${parent.id}`,
    headers,
  });
  expect(inUse.json()).toEqual({ error: 'category_in_use' });
  await pool.query(
    "UPDATE resources SET category='Fotobox' WHERE tenant_id=$1 AND category='Zubehör'",
    [tenantId],
  );
  const withChild = await app.inject({
    method: 'DELETE',
    url: `/api/v1/resource-categories/${parent.id}`,
    headers,
  });
  expect(withChild.json()).toEqual({ error: 'category_has_children' });
  const child = created.json() as Category;
  expect(
    (
      await app.inject({
        method: 'DELETE',
        url: `/api/v1/resource-categories/${child.id}`,
        headers,
      })
    ).statusCode,
  ).toBe(204);
  expect(
    (
      await app.inject({
        method: 'DELETE',
        url: `/api/v1/resource-categories/${parent.id}`,
        headers,
      })
    ).statusCode,
  ).toBe(204);
  expect(
    (
      await app.inject({
        method: 'DELETE',
        url: `/api/v1/resource-categories/${parent.id}`,
        headers,
      })
    ).statusCode,
  ).toBe(404);
  const { rows } = await pool.query(
    "SELECT action FROM audit_events WHERE tenant_id=$1 AND action LIKE 'resource_category.%' ORDER BY occurred_at",
    [tenantId],
  );
  expect(new Set(rows.map((row) => row.action))).toEqual(
    new Set([
      'resource_category.created',
      'resource_category.updated',
      'resource_category.deleted',
    ]),
  );
});

test('the navigation switch is read by every session and changed by an administrator', async () => {
  expect(
    (await app.inject({ url: '/api/v1/settings/resources' })).statusCode,
  ).toBe(401);
  expect(
    (await app.inject({ url: '/api/v1/settings/resources', headers })).json(),
  ).toEqual({ hideNavigation: false });
  const saved = await app.inject({
    method: 'PUT',
    url: '/api/v1/settings/resources',
    headers,
    payload: { hideNavigation: true },
  });
  expect(saved.json()).toEqual({ hideNavigation: true });
  expect(
    (await app.inject({ url: '/api/v1/settings/resources', headers })).json(),
  ).toEqual({ hideNavigation: true });
  const invalid = await app.inject({
    method: 'PUT',
    url: '/api/v1/settings/resources',
    headers,
    payload: { hideNavigation: 'yes' },
  });
  expect(invalid.statusCode).toBe(400);
});

// RES-BKP-02: every resource is an item, a set or a case.
test('a resource keeps its type; older clients without it keep the stored one', async () => {
  const base = {
    name: 'Synthetic wedding package',
    code: 'SYN-SET',
    category: 'Pakete',
    description: '',
    quantity: 1,
    beforeDays: 0,
    afterDays: 0,
    blocked: false,
    state: 'active',
    position: 10,
  };
  const listed = (
    await app.inject({ url: '/api/v1/resources', headers })
  ).json() as { code: string; kind: string }[];
  expect(new Set(listed.map((row) => row.kind))).toEqual(new Set(['item']));
  const created = await app.inject({
    method: 'POST',
    url: '/api/v1/resources',
    headers,
    payload: { ...base, kind: 'set' },
  });
  expect(created.statusCode).toBe(201);
  const row = created.json() as { id: string; kind: string; version: number };
  expect(row.kind).toBe('set');
  const kept = await app.inject({
    method: 'PUT',
    url: `/api/v1/resources/${row.id}`,
    headers,
    payload: { ...base, name: 'Synthetic package', version: row.version },
  });
  expect(kept.json()).toMatchObject({ kind: 'set', version: 2 });
  const changed = await app.inject({
    method: 'PUT',
    url: `/api/v1/resources/${row.id}`,
    headers,
    payload: { ...base, kind: 'case', version: 2 },
  });
  expect(changed.json()).toMatchObject({ kind: 'case', version: 3 });
  const plain = await app.inject({
    method: 'POST',
    url: '/api/v1/resources',
    headers,
    payload: { ...base, code: 'SYN-PLAIN' },
  });
  expect(plain.json()).toMatchObject({ kind: 'item' });
  const invalid = await app.inject({
    method: 'POST',
    url: '/api/v1/resources',
    headers,
    payload: { ...base, code: 'SYN-BAD', kind: 'crate' },
  });
  expect(invalid.statusCode).toBe(400);
});
