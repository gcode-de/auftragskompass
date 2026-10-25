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
  AccessError,
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

let container: StartedPostgreSqlContainer,
  pool: Pool,
  actorId: string,
  otherActorId: string;
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
  await accessRepository(pool, otherTenantId).issueSession(
    {
      subject: 'other-templates',
      email: 'other-templates@example.invalid',
    },
    digest('synthetic-other-templates'),
  );
  otherActorId = (await accessRepository(pool, otherTenantId).list())[0]!
    .userId!;
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

test('create request IDs replay the immutable receipt after later edits and archive', async () => {
  const repo = documentTemplateRepository(pool, tenantId),
    requestId = randomUUID(),
    original = await repo.save(
      actorId,
      input(),
      undefined,
      undefined,
      requestId,
    );
  expect(original.version).toBe(1);
  const replay = await repo.save(
    actorId,
    input(),
    undefined,
    undefined,
    requestId,
  );
  expect(replay).toEqual(original);

  const edited = await repo.save(
    actorId,
    {
      ...input(),
      name: 'Fictional later edit',
      positions: [
        { ...input().positions[0]!, description: 'Fictional later A' },
      ],
    },
    original.id,
    1,
  );
  expect(edited.version).toBe(2);
  const archived = await repo.save(
    actorId,
    { ...input(), state: 'archived', name: 'Fictional archived edit' },
    original.id,
    2,
  );
  expect(archived.version).toBe(3);
  expect((await repo.get(original.id))?.name).toBe('Fictional archived edit');
  await expect(
    repo.save(actorId, input(), original.id, 1, requestId),
  ).rejects.toMatchObject({ reason: 'conflict' });
  expect((await repo.get(original.id))?.version).toBe(3);

  const restartedPool = new Pool({
    connectionString: container.getConnectionUri(),
  });
  try {
    const delayedReplay = await documentTemplateRepository(
      restartedPool,
      tenantId,
    ).save(actorId, input(), undefined, undefined, requestId);
    expect(delayedReplay).toEqual(original);
  } finally {
    await restartedPool.end();
  }
  const receipt = (
    await pool.query<{ response: unknown }>(
      'SELECT response FROM document_template_create_operations WHERE tenant_id=$1 AND request_id=$2',
      [tenantId, requestId],
    )
  ).rows[0];
  expect(receipt?.response).toEqual(original);
  expect(receipt?.response).not.toEqual(archived);
  expect(
    (
      await pool.query(
        "SELECT action FROM audit_events WHERE tenant_id=$1 AND record_id=$2 AND action LIKE 'document_template.%' ORDER BY id",
        [tenantId, original.id],
      )
    ).rows.map((row) => row.action),
  ).toEqual([
    'document_template.created',
    'document_template.updated',
    'document_template.updated',
  ]);
});

test('create request IDs reject changed payloads and serialize concurrent retries', async () => {
  const repo = documentTemplateRepository(pool, tenantId),
    requestId = randomUUID(),
    source = input();
  const [first, second] = await Promise.all([
    repo.save(actorId, source, undefined, undefined, requestId),
    repo.save(actorId, source, undefined, undefined, requestId),
  ]);
  expect(second).toEqual(first);
  await expect(
    repo.save(
      actorId,
      { ...source, name: 'Fictional changed payload' },
      undefined,
      undefined,
      requestId,
    ),
  ).rejects.toMatchObject({ reason: 'conflict' });
  expect(
    (
      await pool.query(
        'SELECT count(*)::int AS count FROM document_templates WHERE tenant_id=$1 AND id=$2',
        [tenantId, first.id],
      )
    ).rows[0]!.count,
  ).toBe(1);
  expect(
    (
      await pool.query(
        "SELECT count(*)::int AS count FROM audit_events WHERE tenant_id=$1 AND record_id=$2 AND action='document_template.created'",
        [tenantId, first.id],
      )
    ).rows[0]!.count,
  ).toBe(1);
});

test('create request IDs are tenant-scoped and authorization precedes receipt lookup', async () => {
  const requestId = randomUUID(),
    myRepo = documentTemplateRepository(pool, tenantId),
    myReceipt = await myRepo.save(
      actorId,
      input(),
      undefined,
      undefined,
      requestId,
    );
  await expect(
    myRepo.save(otherActorId, input(), undefined, undefined, requestId),
  ).rejects.toBeInstanceOf(AccessError);

  const otherReceipt = await documentTemplateRepository(
    pool,
    otherTenantId,
  ).save(otherActorId, input(), undefined, undefined, requestId);
  expect(otherReceipt.id).not.toBe(myReceipt.id);
  expect(
    (
      await pool.query(
        'SELECT count(*)::int AS count FROM document_template_create_operations WHERE request_id=$1',
        [requestId],
      )
    ).rows[0]!.count,
  ).toBe(2);
});

test('create receipt table enforces tenant key, hash, and template foreign key', async () => {
  const requestId = randomUUID(),
    receipt = await documentTemplateRepository(pool, tenantId).save(
      actorId,
      input(),
      undefined,
      undefined,
      requestId,
    ),
    other = await documentTemplateRepository(pool, otherTenantId).save(
      otherActorId,
      input(),
    );
  const persisted = (
    await pool.query<{
      tenant_id: string;
      request_id: string;
      template_id: string;
      request_hash: string;
      response: unknown;
    }>(
      'SELECT tenant_id,request_id,template_id,request_hash,response FROM document_template_create_operations WHERE tenant_id=$1 AND request_id=$2',
      [tenantId, requestId],
    )
  ).rows[0]!;
  expect(persisted.tenant_id).toBe(tenantId);
  expect(persisted.request_id).toBe(requestId);
  expect(persisted.template_id).toBe(receipt.id);
  expect(persisted.request_hash).toMatch(/^[a-f0-9]{64}$/);
  expect(persisted.response).toEqual(receipt);

  await expect(
    pool.query(
      'INSERT INTO document_template_create_operations(tenant_id,request_id,template_id,request_hash,response) VALUES($1,$2,$3,$4,$5)',
      [tenantId, requestId, receipt.id, persisted.request_hash, receipt],
    ),
  ).rejects.toMatchObject({ code: '23505' });
  await expect(
    pool.query(
      'INSERT INTO document_template_create_operations(tenant_id,request_id,template_id,request_hash,response) VALUES($1,$2,$3,$4,$5)',
      [tenantId, randomUUID(), receipt.id, 'z'.repeat(64), receipt],
    ),
  ).rejects.toMatchObject({ code: '23514' });
  await expect(
    pool.query(
      'INSERT INTO document_template_create_operations(tenant_id,request_id,template_id,request_hash,response) VALUES($1,$2,$3,$4,$5)',
      [tenantId, randomUUID(), receipt.id, 'a'.repeat(64), JSON.stringify([])],
    ),
  ).rejects.toMatchObject({ code: '23514' });
  await expect(
    pool.query(
      'INSERT INTO document_template_create_operations(tenant_id,request_id,template_id,request_hash,response) VALUES($1,$2,$3,$4,$5)',
      [tenantId, randomUUID(), other.id, 'a'.repeat(64), other],
    ),
  ).rejects.toMatchObject({ code: '23503' });
});

test('create request receipts roll back with position or audit failures', async () => {
  const repo = documentTemplateRepository(pool, tenantId),
    foreignKeyRequest = randomUUID(),
    badInput = input();
  badInput.positions[0]!.productId = randomUUID();
  const beforeForeignKeyFailure = (
    await pool.query<{ templates: number; audits: number }>(
      "SELECT (SELECT count(*)::int FROM document_templates WHERE tenant_id=$1) AS templates, (SELECT count(*)::int FROM audit_events WHERE tenant_id=$1 AND action='document_template.created') AS audits",
      [tenantId],
    )
  ).rows[0]!;
  await expect(
    repo.save(actorId, badInput, undefined, undefined, foreignKeyRequest),
  ).rejects.toMatchObject({ cause: { code: '23503' } });
  expect(
    (
      await pool.query(
        'SELECT count(*)::int AS count FROM document_template_create_operations WHERE tenant_id=$1 AND request_id=$2',
        [tenantId, foreignKeyRequest],
      )
    ).rows[0]!.count,
  ).toBe(0);
  expect(
    (
      await pool.query<{ templates: number; audits: number }>(
        "SELECT (SELECT count(*)::int FROM document_templates WHERE tenant_id=$1) AS templates, (SELECT count(*)::int FROM audit_events WHERE tenant_id=$1 AND action='document_template.created') AS audits",
        [tenantId],
      )
    ).rows[0],
  ).toEqual(beforeForeignKeyFailure);
  const corrected = await repo.save(
    actorId,
    input(),
    undefined,
    undefined,
    foreignKeyRequest,
  );
  expect(
    (await repo.save(actorId, input(), undefined, undefined, foreignKeyRequest))
      .id,
  ).toBe(corrected.id);

  const auditRequest = randomUUID();
  const beforeAuditFailure = (
    await pool.query<{ templates: number; audits: number }>(
      "SELECT (SELECT count(*)::int FROM document_templates WHERE tenant_id=$1) AS templates, (SELECT count(*)::int FROM audit_events WHERE tenant_id=$1 AND action='document_template.created') AS audits",
      [tenantId],
    )
  ).rows[0]!;
  await pool.query(`
    CREATE FUNCTION reject_template_create_for_test() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.action='document_template.created' THEN RAISE EXCEPTION 'synthetic audit failure'; END IF;
      RETURN NEW;
    END $$
  `);
  await pool.query(`
    CREATE TRIGGER reject_template_create_for_test
    BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION reject_template_create_for_test()
  `);
  try {
    await expect(
      repo.save(actorId, input(), undefined, undefined, auditRequest),
    ).rejects.toThrow();
  } finally {
    await pool.query(
      'DROP TRIGGER reject_template_create_for_test ON audit_events',
    );
    await pool.query('DROP FUNCTION reject_template_create_for_test()');
  }
  expect(
    (
      await pool.query(
        'SELECT count(*)::int AS count FROM document_template_create_operations WHERE tenant_id=$1 AND request_id=$2',
        [tenantId, auditRequest],
      )
    ).rows[0]!.count,
  ).toBe(0);
  expect(
    (
      await pool.query<{ templates: number; audits: number }>(
        "SELECT (SELECT count(*)::int FROM document_templates WHERE tenant_id=$1) AS templates, (SELECT count(*)::int FROM audit_events WHERE tenant_id=$1 AND action='document_template.created') AS audits",
        [tenantId],
      )
    ).rows[0],
  ).toEqual(beforeAuditFailure);
  const afterAuditRecovery = await repo.save(
    actorId,
    input(),
    undefined,
    undefined,
    auditRequest,
  );
  expect(
    (
      await pool.query(
        "SELECT count(*)::int AS count FROM audit_events WHERE tenant_id=$1 AND record_id=$2 AND action='document_template.created'",
        [tenantId, afterAuditRecovery.id],
      )
    ).rows[0]!.count,
  ).toBe(1);
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
    const idempotentPayload = { ...input(), requestId: randomUUID() };
    const idempotentCreate = await create(idempotentPayload);
    expect(idempotentCreate.statusCode).toBe(201);
    const unauthorizedReplay = await app.inject({
      method: 'POST',
      url: '/api/v1/document-templates',
      payload: idempotentPayload,
    });
    expect(unauthorizedReplay.statusCode).toBe(401);
    const csrfRejectedReplay = await app.inject({
      method: 'POST',
      url: '/api/v1/document-templates',
      cookies,
      headers: { origin: config.origin },
      payload: idempotentPayload,
    });
    expect(csrfRejectedReplay.statusCode).toBe(403);
    expect(
      (await create({ ...input(), requestId: 'not-a-uuid' })).statusCode,
    ).toBe(400);
    const replay = await create(idempotentPayload);
    expect(replay.statusCode).toBe(201);
    expect(replay.json()).toEqual(idempotentCreate.json());
    const reusedKey = await create({
      ...idempotentPayload,
      name: 'Fictional changed payload',
    });
    expect(reusedKey.statusCode).toBe(409);
    expect(reusedKey.json()).toEqual({ error: 'conflict' });
    const created = await create(input());
    expect(created.statusCode).toBe(201);
    const body = created.json();
    expect(body.version).toBe(1);
    expect(body.positions).toHaveLength(2);
    const legacyRepeat = await create(input());
    expect(legacyRepeat.statusCode).toBe(201);
    expect(legacyRepeat.json().id).not.toBe(body.id);
    const keyedPut = await app.inject({
      method: 'PUT',
      url: '/api/v1/document-templates/' + body.id,
      cookies,
      headers,
      payload: { ...input(), version: 1, requestId: randomUUID() },
    });
    expect(keyedPut.statusCode).toBe(400);
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
