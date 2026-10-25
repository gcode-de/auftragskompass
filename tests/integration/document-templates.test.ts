import { afterAll, beforeAll, expect, test } from 'vitest';
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { Pool, type PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import { migrate } from '../../packages/core/src/identity.js';
import {
  bootstrapAccess,
  accessRepository,
} from '../../packages/core/src/access.js';
import {
  documentTemplateRepository,
  registerDocumentTemplateRoutes,
  type DocumentTemplateInput,
} from '../../packages/core/src/document-templates.js';
import {
  createHealthServer,
  loadRuntimeConfig,
} from '../../packages/core/src/runtime.js';
import { registerAuth, digest } from '../../packages/core/src/auth.js';
import { syntheticGoogle } from '../helpers/oidc.js';

let container: StartedPostgreSqlContainer, pool: Pool, actorId: string;
const tenantId = randomUUID(),
  otherTenantId = randomUUID();
const input = (): DocumentTemplateInput => ({
  kind: 'offer',
  name: 'Fictional offer template',
  subject: 'Angebot für {{contact}}',
  introText: 'Hallo {{contact}}, anbei unser Angebot.',
  outroText: 'Der Termin ist am {{date}}.',
  validityDays: 14,
  state: 'active',
  positions: [
    {
      description: 'Fictional box',
      quantity: 1,
      unit: 'Stück',
      unitPriceMinor: 19900,
      taxBasisPoints: 1900,
      discountBasisPoints: 0,
    },
    {
      description: 'Fictional extra hour',
      quantity: 2,
      unit: 'Stunde',
      unitPriceMinor: 5000,
      taxBasisPoints: 1900,
      discountBasisPoints: 500,
    },
  ],
});
beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:17.6-alpine').start();
  pool = new Pool({ connectionString: container.getConnectionUri() });
  await migrate(pool);
  await bootstrapAccess(
    pool,
    tenantId,
    'templates@example.invalid',
    'Synthetic templates',
    'Europe/Berlin',
  );
  await accessRepository(pool, tenantId).issueSession(
    { subject: 'templates', email: 'templates@example.invalid' },
    digest('synthetic-templates'),
  );
  actorId = (await accessRepository(pool, tenantId).list())[0]!.userId!;
  await bootstrapAccess(
    pool,
    otherTenantId,
    'other-templates@example.invalid',
    'Synthetic other',
    'Europe/Berlin',
  );
});
afterAll(async () => {
  await pool?.end();
  await container?.stop();
});
test('templates keep ordered positions, bump the version and survive archiving', async () => {
  const repo = documentTemplateRepository(pool, tenantId);
  const created = await repo.save(actorId, input());
  expect(created.version).toBe(1);
  expect(created.positions.map((row) => row.description)).toEqual([
    'Fictional box',
    'Fictional extra hour',
  ]);
  expect(created.positions[1]!.quantity).toBe(2);
  expect(created.positions[1]!.discountBasisPoints).toBe(500);
  const updated = await repo.save(
    actorId,
    {
      ...input(),
      state: 'archived',
      positions: [input().positions[0]!],
    },
    created.id,
    1,
  );
  expect(updated.version).toBe(2);
  expect(updated.state).toBe('archived');
  expect(updated.positions).toHaveLength(1);
  await expect(
    repo.save(actorId, input(), created.id, 1),
  ).rejects.toMatchObject({ reason: 'conflict' });
  const reread = await repo.get(created.id);
  expect(reread?.state).toBe('archived');
  expect(reread?.positions).toHaveLength(1);
});
test('template lists pair versions and positions from one database snapshot', async () => {
  const writer = documentTemplateRepository(pool, tenantId),
    source = input(),
    created = await writer.save(actorId, {
      ...source,
      positions: [{ ...source.positions[0]!, description: 'Fictional old A' }],
    }),
    readPool = new Pool({ connectionString: container.getConnectionUri() }),
    reader = documentTemplateRepository(readPool, tenantId),
    originalQuery = readPool.query.bind(readPool) as (
      ...args: unknown[]
    ) => Promise<unknown>,
    originalQueryCall = readPool.query.bind(readPool),
    originalConnect = readPool.connect.bind(readPool);
  let templateReached!: () => void,
    positionsCaptured!: () => void,
    releaseTemplate!: () => void;
  const templateQueryReached = new Promise<void>(
      (resolve) => (templateReached = resolve),
    ),
    positionsQueryCaptured = new Promise<void>(
      (resolve) => (positionsCaptured = resolve),
    ),
    templateQueryRelease = new Promise<void>(
      (resolve) => (releaseTemplate = resolve),
    );
  let templateGateUsed = false,
    positionsGateUsed = false,
    poolQueryDelegation = 0;
  const interleave = async (query: unknown, execute: () => unknown) => {
    const sql =
      typeof query === 'string'
        ? query
        : query && typeof query === 'object' && 'text' in query
          ? String(query.text)
          : '';
    if (!templateGateUsed && /document_templates/.test(sql)) {
      templateGateUsed = true;
      templateReached();
      await templateQueryRelease;
    }
    const result = await execute();
    if (!positionsGateUsed && /document_template_positions/.test(sql)) {
      positionsGateUsed = true;
      positionsCaptured();
    }
    return result;
  };
  readPool.query = ((...args: unknown[]) => {
    if (args.some((argument) => typeof argument === 'function'))
      return Reflect.apply(originalQueryCall, undefined, args);
    return interleave(args[0], () => {
      poolQueryDelegation += 1;
      return originalQuery(...args).finally(() => {
        poolQueryDelegation -= 1;
      });
    });
  }) as typeof readPool.query;
  readPool.connect = ((...args: unknown[]) => {
    if (args.some((argument) => typeof argument === 'function'))
      return Reflect.apply(originalConnect, undefined, args);
    return (originalConnect() as Promise<PoolClient>).then((client) => {
      const clientQuery = client.query.bind(client) as (
        ...queryArgs: unknown[]
      ) => Promise<unknown>;
      client.query = ((...queryArgs: unknown[]) => {
        if (
          poolQueryDelegation > 0 ||
          queryArgs.some((argument) => typeof argument === 'function')
        )
          return clientQuery(...queryArgs);
        return interleave(queryArgs[0], () => clientQuery(...queryArgs));
      }) as typeof client.query;
      return client;
    });
  }) as typeof readPool.connect;

  let listing: ReturnType<typeof reader.list> | undefined;
  let gateTimeout: ReturnType<typeof setTimeout> | undefined;
  try {
    listing = reader.list();
    await Promise.race([
      Promise.all([templateQueryReached, positionsQueryCaptured]),
      new Promise<never>((_resolve, reject) => {
        gateTimeout = setTimeout(
          () => reject(new Error('Template list query interleaving timed out')),
          5000,
        );
      }),
    ]);
    if (gateTimeout) clearTimeout(gateTimeout);
    gateTimeout = undefined;
    const updated = await writer.save(
      actorId,
      {
        ...source,
        positions: [
          { ...source.positions[0]!, description: 'Fictional new B' },
        ],
      },
      created.id,
      1,
    );
    expect(updated.version).toBe(2);
    expect(updated.positions.map((position) => position.description)).toEqual([
      'Fictional new B',
    ]);
    releaseTemplate();

    const snapshot = (await listing).find(
      (template) => template.id === created.id,
    )!;
    let staleArchiveError: unknown;
    try {
      await writer.save(
        actorId,
        {
          ...source,
          state: 'archived',
          positions: snapshot.positions,
        },
        snapshot.id,
        snapshot.version,
      );
    } catch (error) {
      staleArchiveError = error;
    }
    const final = await writer.get(created.id);
    expect(final?.positions.map((position) => position.description)).toEqual([
      'Fictional new B',
    ]);
    expect(staleArchiveError).toMatchObject({ reason: 'conflict' });
    expect(final?.version).toBe(2);
    expect(snapshot.version).toBe(1);
    expect(snapshot.positions.map((position) => position.description)).toEqual([
      'Fictional old A',
    ]);
  } finally {
    releaseTemplate();
    if (gateTimeout) clearTimeout(gateTimeout);
    if (listing) await listing.catch(() => undefined);
    readPool.query = originalQueryCall;
    readPool.connect = originalConnect;
    await readPool.end();
  }
});
test('templates stay inside their tenant', async () => {
  const mine = await documentTemplateRepository(pool, tenantId).save(
    actorId,
    input(),
  );
  const other = documentTemplateRepository(pool, otherTenantId);
  expect(await other.list()).toEqual([]);
  expect(await other.get(mine.id)).toBeNull();
  await expect(
    pool.query(
      'INSERT INTO document_template_positions(tenant_id,template_id,id,position,description,quantity,unit,unit_price_minor,tax_basis_points) VALUES($1,$2,$3,9,$4,1,$5,100,1900)',
      [otherTenantId, mine.id, randomUUID(), 'Cross tenant', 'Stück'],
    ),
  ).rejects.toMatchObject({ code: '23503' });
});
test('the API rejects unknown placeholders, requires auth and enforces versions', async () => {
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
  registerDocumentTemplateRoutes(app, pool, tenantId);
  const cookies = { '__Host-ak-session': 'synthetic-templates' },
    headers = {
      origin: config.origin,
      'x-csrf-token': digest('csrf:synthetic-templates'),
    },
    create = (payload: unknown) =>
      app.inject({
        method: 'POST',
        url: '/api/v1/document-templates',
        cookies,
        headers,
        payload: payload as Record<string, unknown>,
      });
  try {
    expect((await app.inject('/api/v1/document-templates')).statusCode).toBe(
      401,
    );
    expect(
      (await create({ ...input(), introText: 'Hallo {{kontakt}}' })).statusCode,
    ).toBe(400);
    const created = await create(input());
    expect(created.statusCode).toBe(201);
    const body = created.json();
    expect(body.version).toBe(1);
    expect(body.positions).toHaveLength(2);
    const stale = await app.inject({
      method: 'PUT',
      url: '/api/v1/document-templates/' + body.id,
      cookies,
      headers,
      payload: { ...input(), version: 99 } as Record<string, unknown>,
    });
    expect(stale.statusCode).toBe(409);
    const updated = await app.inject({
      method: 'PUT',
      url: '/api/v1/document-templates/' + body.id,
      cookies,
      headers,
      payload: { ...input(), version: 1 } as Record<string, unknown>,
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().version).toBe(2);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/api/v1/document-templates/' + randomUUID(),
          cookies,
        })
      ).statusCode,
    ).toBe(404);
  } finally {
    await app.close();
  }
});
