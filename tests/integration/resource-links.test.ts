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

// RES-BKP-04: accessories, alternatives, components and products of a resource.
const tenantId = randomUUID(),
  otherTenant = randomUUID(),
  email = 'links.owner@example.invalid',
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
    'fictional.links',
    () => password,
  );
  app = Fastify();
  await registerAuth(app, pool, config);
  registerResourceRoutes(app, pool, tenantId);
  const logged = await app.inject({
    method: 'POST',
    url: '/auth/login',
    headers: { origin: config.origin },
    payload: { identifier: 'fictional.links', password },
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

test('links are replaced per card, read both ways and guarded', async () => {
  const { rows } = await pool.query(
    'SELECT id, code FROM resources WHERE tenant_id=$1',
    [tenantId],
  );
  const id = (code: string) => rows.find((row) => row.code === code)!.id;
  const [fb1, fb2, glamour, forest] = [
    id('FB1'),
    id('FB2'),
    id('GLAMOUR'),
    id('SCHWARZWALD'),
  ];
  const put = (resource: string, relation: string, ids: string[]) =>
    app.inject({
      method: 'PUT',
      url: `/api/v1/resources/${resource}/links/${relation}`,
      headers,
      payload: { ids },
    });
  expect(
    (await app.inject({ url: `/api/v1/resources/${fb1}/links` })).statusCode,
  ).toBe(401);
  const empty = await app.inject({
    url: `/api/v1/resources/${fb1}/links`,
    headers,
  });
  expect(empty.json()).toEqual({
    accessories: [],
    alternatives: [],
    components: [],
    inCases: [],
    inSets: [],
    products: [],
  });
  const accessories = await put(fb1, 'accessories', [glamour, fb1]);
  expect(accessories.json().accessories).toEqual([
    { id: glamour, name: 'Glamour-Paket', kind: 'item', category: 'Zubehör' },
  ]);
  expect((await put(fb1, 'alternatives', [fb2])).json().alternatives).toEqual([
    { id: fb2, name: 'FB2', kind: 'item', category: 'Fotobox' },
  ]);
  // Only a Set or a Case has components.
  expect((await put(fb1, 'components', [glamour])).json()).toEqual({
    error: 'not_a_collection',
  });
  await pool.query(
    "UPDATE resources SET kind='set' WHERE tenant_id=$1 AND id=$2",
    [tenantId, forest],
  );
  await pool.query(
    "UPDATE resources SET kind='case' WHERE tenant_id=$1 AND id=$2",
    [tenantId, glamour],
  );
  expect((await put(forest, 'components', [fb1, glamour])).statusCode).toBe(
    200,
  );
  expect((await put(glamour, 'components', [fb2])).statusCode).toBe(200);
  // The glamour case is inside the forest set; the set cannot go inside it.
  expect((await put(glamour, 'components', [forest])).json()).toEqual({
    error: 'component_cycle',
  });
  const reverse = (
    await app.inject({ url: `/api/v1/resources/${fb2}/links`, headers })
  ).json();
  expect(reverse.inCases.map((row: { id: string }) => row.id)).toEqual([
    glamour,
  ]);
  expect(
    (
      await app.inject({ url: `/api/v1/resources/${fb1}/links`, headers })
    ).json().inSets,
  ).toEqual([
    { id: forest, name: 'Schwarzwald-Paket', kind: 'set', category: 'Zubehör' },
  ]);
  expect((await put(fb1, 'accessories', [randomUUID()])).json()).toEqual({
    error: 'unknown_target',
  });
  expect((await put(randomUUID(), 'accessories', [])).statusCode).toBe(404);
  // Products: linked, cleared, and gone with a deleted product.
  const product = randomUUID();
  await pool.query(
    "INSERT INTO products(tenant_id,id,name,description,unit,price_minor,price_basis,tax_basis_points,state,position) VALUES($1,$2,'Fictional rental','','Stück',1000,'gross',1900,'active',0)",
    [tenantId, product],
  );
  expect((await put(fb1, 'products', [product])).json().products).toEqual([
    { id: product, name: 'Fictional rental' },
  ]);
  await pool.query('DELETE FROM products WHERE tenant_id=$1 AND id=$2', [
    tenantId,
    product,
  ]);
  expect(
    (
      await app.inject({ url: `/api/v1/resources/${fb1}/links`, headers })
    ).json().products,
  ).toEqual([]);
  expect((await put(fb1, 'accessories', [])).json().accessories).toEqual([]);
  const withoutCsrf = await app.inject({
    method: 'PUT',
    url: `/api/v1/resources/${fb1}/links/accessories`,
    headers: { cookie: headers.cookie!, origin: config.origin },
    payload: { ids: [] },
  });
  expect(withoutCsrf.statusCode).toBe(403);
});
