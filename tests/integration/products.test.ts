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
  productRepository,
  registerProductRoutes,
} from '../../packages/core/src/products.js';
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
  name: 'Synthetic product',
  description: 'Fictional service',
  unit: 'Stück',
  priceMinor: 1999,
  priceBasis: 'gross' as const,
  taxBasisPoints: 1900,
  state: 'active' as const,
  position: 0,
};
beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:17.6-alpine').start();
  pool = new Pool({ connectionString: container.getConnectionUri() });
  await migrate(pool);
  await bootstrapAccess(
    pool,
    tenantId,
    'products@example.invalid',
    'Synthetic products',
    'Europe/Berlin',
  );
  await accessRepository(pool, tenantId).issueSession(
    { subject: 'products', email: 'products@example.invalid' },
    digest('synthetic-products'),
  );
  actorId = (await accessRepository(pool, tenantId).list())[0]!.userId!;
});
afterAll(async () => {
  await pool?.end();
  await container?.stop();
});
test('product prices are exact and history survives archive; copies are independent', async () => {
  const repo = productRepository(pool, tenantId);
  const row = await repo.save(actorId, input);
  expect(row.priceMinor).toBe(1999);
  const copy = await repo.save(actorId, {
    ...input,
    priceMinor: 1,
    priceBasis: 'net',
    taxBasisPoints: 700,
  });
  expect(copy.id).not.toBe(row.id);
  await pool.query(
    'CREATE TABLE synthetic_product_history(tenant_id uuid, product_id uuid, FOREIGN KEY(tenant_id,product_id) REFERENCES products(tenant_id,id))',
  );
  await pool.query('INSERT INTO synthetic_product_history VALUES($1,$2)', [
    tenantId,
    row.id,
  ]);
  await repo.save(
    actorId,
    { ...input, state: 'archived', priceMinor: Number.MAX_SAFE_INTEGER },
    row.id,
    1,
  );
  expect((await repo.list()).find((r) => r.id === row.id)!.priceMinor).toBe(
    Number.MAX_SAFE_INTEGER,
  );
  expect((await repo.list()).find((r) => r.id === copy.id)!.priceMinor).toBe(1);
  await expect(repo.save(actorId, input, row.id, 1)).rejects.toThrow(
    'conflict',
  );
  await expect(repo.save(actorId, input, randomUUID(), 1)).rejects.toThrow(
    'not_found',
  );
  await expect(repo.save(randomUUID(), input)).rejects.toThrow('forbidden');
  for (const priceMinor of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1])
    await expect(
      repo.save(actorId, { ...input, priceMinor }),
    ).rejects.toThrow();
  await expect(
    repo.save(actorId, { ...input, taxBasisPoints: 10001 }),
  ).rejects.toThrow();
  expect(await productRepository(pool, randomUUID()).list()).toEqual([]);
  await expect(
    pool.query('DELETE FROM products WHERE tenant_id=$1 AND id=$2', [
      tenantId,
      row.id,
    ]),
  ).rejects.toMatchObject({ code: '23503' });
});
test('product API rejects invalid money, requires auth and persists net/gross and archive', async () => {
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
  registerProductRoutes(app, pool, tenantId);
  const cookies = { '__Host-ak-session': 'synthetic-products' },
    headers = {
      origin: config.origin,
      'x-csrf-token': digest('csrf:synthetic-products'),
    };
  const create = (payload: unknown) =>
    app.inject({
      method: 'POST',
      url: '/api/v1/products',
      cookies,
      headers,
      payload: payload as Record<string, unknown>,
    });
  try {
    for (const url of ['/api/v1/products', '/api/v1/products/export.csv'])
      expect((await app.inject(url)).statusCode).toBe(401);
    expect(
      (await app.inject({ url: '/api/v1/products', cookies })).json(),
    ).toHaveLength(2);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/products',
          cookies,
          payload: input,
        })
      ).statusCode,
    ).toBe(403);
    for (const bad of [
      { priceMinor: 0.01 },
      { priceMinor: -1 },
      { priceMinor: Number.MAX_SAFE_INTEGER + 1 },
      { taxBasisPoints: 10001 },
      { priceBasis: 'unknown' },
      { unit: ' ' },
    ])
      expect((await create({ ...input, ...bad })).statusCode).toBe(400);
    const created = await create(input);
    expect(created.statusCode).toBe(201);
    expect(created.json()).not.toHaveProperty('tenantId');
    const formula = await create({
      ...input,
      name: '+Fictional,"quoted"',
      description: 'Fictional\nservice',
      state: 'inactive',
      priceMinor: 0,
      taxBasisPoints: 0,
    });
    expect(formula.statusCode).toBe(201);
    const foreignTenant = randomUUID();
    await bootstrapAccess(
      pool,
      foreignTenant,
      'foreign-product@example.invalid',
      'Fictional foreign catalog',
      'UTC',
    );
    const foreignAccess = accessRepository(pool, foreignTenant);
    await foreignAccess.issueSession(
      { subject: 'foreign-product', email: 'foreign-product@example.invalid' },
      digest('synthetic-foreign-product'),
    );
    await productRepository(pool, foreignTenant).save(
      (await foreignAccess.list())[0]!.userId!,
      { ...input, name: 'Fictional foreign product' },
    );
    expect(
      (
        await app.inject({
          url: '/api/v1/products/export.csv',
          cookies: { '__Host-ak-session': 'synthetic-foreign-product' },
        })
      ).statusCode,
    ).toBe(401);
    const exported = await app.inject({
      url: '/api/v1/products/export.csv',
      cookies,
    });
    expect(exported.statusCode).toBe(200);
    expect(exported.headers['content-type']).toContain('text/csv');
    expect(exported.headers['cache-control']).toBe('no-store');
    expect(exported.headers['content-disposition']).toContain('products.csv');
    expect(exported.body).toMatch(/^\uFEFF"id","version"/);
    expect(exported.body).toContain(
      '"priceMinor","priceBasis","taxBasisPoints"',
    );
    expect(exported.body).toContain('"9007199254740991"');
    expect(exported.body).toContain('"1","net","700"');
    expect(exported.body).toContain('"1999","gross","1900"');
    expect(exported.body).toContain('"archived"');
    expect(exported.body).toContain('"inactive"');
    expect(exported.body).toContain('"\'+Fictional,""quoted"""');
    expect(exported.body).toContain('"Fictional\nservice"');
    expect(exported.body).toContain('"Stück"');
    expect(exported.body).not.toContain('Fictional foreign product');
    expect(exported.body).not.toContain(tenantId);
    const update = (id: string, version: number) =>
      app.inject({
        method: 'PUT',
        url: '/api/v1/products/' + id,
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
      (await productRepository(pool, tenantId).list()).some(
        (p) => p.name === 'Must roll back',
      ),
    ).toBe(false);
  } finally {
    await app.close();
  }
});
