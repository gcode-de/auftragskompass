import { acknowledgeWebsiteInquiries } from '../../packages/core/src/website-inquiry-ack-send.js';
import { pullWebsiteInquiries } from '../../packages/core/src/website-inquiry-pull.js';
import { startWebsiteInquirySync } from '../../packages/core/src/inquiry-sync-worker.js';
import {
  beforeAll,
  beforeEach,
  afterEach,
  afterAll,
  test,
  expect,
  vi,
} from 'vitest';
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { migrate } from '../../packages/core/src/identity.js';
import { migrateGateway } from '../../packages/core/src/gateway-operations.js';
import {
  bootstrapAccess,
  accessRepository,
} from '../../packages/core/src/access.js';
import { digest } from '../../packages/core/src/auth.js';
import {
  signGatewayMessage,
  type GatewayKey,
} from '../../packages/core/src/gateway-message.js';
import { inquiryFormV1 } from '../../packages/core/src/inquiry-form.js';
import { receiveWebsiteInquiryBatch } from '../../packages/core/src/website-inquiry-sync.js';
let container: StartedPostgreSqlContainer,
  pool: Pool,
  tenantId: string,
  actorId: string,
  key: GatewayKey;
const now = new Date('2030-10-26T10:00:00.000Z');
const entry = () => ({
  id: randomUUID(),
  receivedAt: now.toISOString(),
  expiresAt: '2030-10-27T10:00:00.000Z',
  submission: {
    formId: 'fotobox-bw-main',
    formVersion: 1,
    fields: {
      firstName: 'Fictional',
      lastName: 'Sync',
      email: 'sync@example.invalid',
      eventDate: '2030-10-27',
    },
  },
  privacyNotice: inquiryFormV1.privacyNotice,
  privacyUrl: inquiryFormV1.privacyUrl,
});
function batch(
  inquiries: unknown[] = [entry()],
  requestId = randomUUID(),
  operationId = randomUUID(),
) {
  const message = {
    version: 1 as const,
    tenantId,
    messageId: randomUUID(),
    operationId,
    issuedAt: now.getTime() / 1000,
    kind: 'inquiries.batch' as const,
    payload: { requestId, inquiries },
  };
  return { packet: signGatewayMessage(message, key), message, requestId };
}
const receive = (
  b: ReturnType<typeof batch>,
  actor = actorId,
  connection = pool,
) =>
  receiveWebsiteInquiryBatch(connection, tenantId, actor, b.packet, {
    requestId: b.requestId,
    keys: [key],
    at: now,
  });
const counts = async () => {
  const result: Record<string, number> = {};
  for (const table of [
    'website_inquiry_deliveries',
    'ak_gateway_messages',
    'ak_gateway_operations',
    'contacts',
    'events',
  ])
    result[table] = Number(
      (
        await pool.query(
          'SELECT count(*) FROM ' + table + ' WHERE tenant_id=$1',
          [tenantId],
        )
      ).rows[0].count,
    );
  return result;
};
beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:17.6-alpine').start();
  pool = new Pool({ connectionString: container.getConnectionUri() });
  await migrate(pool);
  await migrateGateway(pool);
});
beforeEach(async () => {
  tenantId = randomUUID();
  await bootstrapAccess(
    pool,
    tenantId,
    'fictional.owner@example.invalid',
    'Fictional sync',
    'Europe/Berlin',
  );
  await accessRepository(pool, tenantId).issueSession(
    { subject: 'fictional', email: 'fictional.owner@example.invalid' },
    digest(randomUUID()),
  );
  actorId = (await accessRepository(pool, tenantId).list())[0]!.userId!;
  key = {
    id: 'fictional-sync',
    tenantId,
    direction: 'gateway-to-core',
    secret: Buffer.alloc(32, 7),
    notBefore: now.getTime() / 1000 - 60,
    expiresAt: now.getTime() / 1000 + 3600,
  };
});
afterAll(async () => {
  await pool?.end();
  await container?.stop();
});

test('signed batches are durable, atomic and idempotent across restart without creating contacts or events', async () => {
  const value = batch([entry(), entry()]);
  expect(await receive(value)).toEqual({ status: 'applied', count: 2 });
  expect(await counts()).toEqual({
    website_inquiry_deliveries: 2,
    ak_gateway_messages: 1,
    ak_gateway_operations: 1,
    contacts: 0,
    events: 0,
  });
  const first = (
    await pool.query(
      'SELECT id,staged_at FROM website_inquiry_deliveries WHERE tenant_id=$1 ORDER BY id',
      [tenantId],
    )
  ).rows;
  await expect(receive(value)).rejects.toMatchObject({ reason: 'replay' });
  const retry = batch(
    value.message.payload.inquiries,
    value.requestId,
    value.message.operationId,
  );
  const restarted = new Pool({
    connectionString: container.getConnectionUri(),
  });
  try {
    expect(await receive(retry, actorId, restarted)).toEqual({
      status: 'duplicate',
      count: 2,
    });
  } finally {
    await restarted.end();
  }
  expect(
    (
      await pool.query(
        'SELECT id,staged_at FROM website_inquiry_deliveries WHERE tenant_id=$1 ORDER BY id',
        [tenantId],
      )
    ).rows,
  ).toEqual(first);
  const another = batch(value.message.payload.inquiries);
  expect(await receive(another)).toEqual({ status: 'applied', count: 2 });
  const changed = batch([entry()], value.requestId, value.message.operationId);
  await expect(receive(changed)).rejects.toMatchObject({ reason: 'conflict' });
  expect((await counts()).website_inquiry_deliveries).toBe(2);
});

test('authentication, request correlation and strict batches fail closed before persistence', async () => {
  const good = batch();
  for (const bad of [
    { ...good.packet, signature: 'A'.repeat(43) },
    { ...good.packet, body: good.packet.body + ' ' },
  ])
    await expect(receive({ ...good, packet: bad })).rejects.toMatchObject({
      reason: 'unauthorized',
    });
  await expect(
    receive({ ...good, requestId: randomUUID() }),
  ).rejects.toMatchObject({ reason: 'invalid' });
  const e = entry();
  for (const entries of [
    [e, e],
    [{ ...e, unknown: 'fictional' }],
    Array.from({ length: 101 }, entry),
  ])
    await expect(receive(batch(entries))).rejects.toMatchObject({
      reason: 'invalid',
    });
  const extra = {
    ...good.message,
    payload: { ...good.message.payload, unknown: 'fictional' },
  };
  await expect(
    receive({ ...good, packet: signGatewayMessage(extra, key) }),
  ).rejects.toMatchObject({ reason: 'invalid' });
  expect(Object.values(await counts())).toEqual([0, 0, 0, 0, 0]);
  expect(await receive(batch([]))).toEqual({ status: 'applied', count: 0 });
});

test('one expired or conflicting item rolls back the entire batch and its replay receipts', async () => {
  const expired = {
      ...entry(),
      receivedAt: '2030-10-25T09:00:00.000Z',
      expiresAt: now.toISOString(),
    },
    value = batch([entry(), expired]);
  await expect(receive(value)).rejects.toMatchObject({ reason: 'failed' });
  expect(Object.values(await counts())).toEqual([0, 0, 0, 0, 0]);
  // A failed nonce remains retryable; no partial operation record is retained.
  await expect(receive(value)).rejects.toMatchObject({ reason: 'failed' });
  const original = entry();
  await receive(batch([original]));
  const before = await counts();
  await expect(
    receive(
      batch([
        entry(),
        { ...original, privacyNotice: 'Fictional changed notice' },
      ]),
    ),
  ).rejects.toMatchObject({ reason: 'failed' });
  expect(await counts()).toEqual(before);
});

test('parallel delivery applies once and authorization is checked even for cached operations', async () => {
  const value = batch();
  const results = await Promise.all(
    Array.from({ length: 4 }, () =>
      receive(
        batch(
          value.message.payload.inquiries,
          value.requestId,
          value.message.operationId,
        ),
      ),
    ),
  );
  expect(results.filter((row) => row.status === 'applied')).toHaveLength(1);
  expect(results.filter((row) => row.status === 'duplicate')).toHaveLength(3);
  await expect(
    receive(
      batch(
        value.message.payload.inquiries,
        value.requestId,
        value.message.operationId,
      ),
      randomUUID(),
    ),
  ).rejects.toMatchObject({ reason: 'forbidden' });
  await accessRepository(pool, tenantId).grant(
    actorId,
    'second.owner@example.invalid',
  );
  await accessRepository(pool, tenantId).issueSession(
    { subject: 'fictional-second', email: 'second.owner@example.invalid' },
    digest(randomUUID()),
  );
  await pool.query(
    'UPDATE allowed_accounts SET active=false WHERE tenant_id=$1 AND user_id=$2',
    [tenantId, actorId],
  );
  await expect(
    receive(
      batch(
        value.message.payload.inquiries,
        value.requestId,
        value.message.operationId,
      ),
    ),
  ).rejects.toMatchObject({ reason: 'forbidden' });
  expect((await counts()).website_inquiry_deliveries).toBe(1);
  const foreignKey = { ...key, tenantId: randomUUID() };
  const foreign = signGatewayMessage(
    { ...value.message, tenantId: foreignKey.tenantId },
    foreignKey,
  );
  await expect(receive({ ...value, packet: foreign })).rejects.toMatchObject({
    reason: 'unauthorized',
  });
});

test('bounded payloads, wrong purposes, invalid caller context and unavailable storage are neutral', async () => {
  const good = batch(),
    base = { requestId: good.requestId, keys: [key], at: now };
  for (const [actor, options] of [
    ['invalid', base],
    [actorId, { ...base, requestId: 'invalid' }],
    [actorId, { ...base, at: new Date('invalid') }],
  ] as const)
    await expect(
      receiveWebsiteInquiryBatch(pool, tenantId, actor, good.packet, options),
    ).rejects.toMatchObject({ reason: 'invalid' });
  const tooLarge = Array.from({ length: 11 }, () => {
    const value = entry();
    return {
      ...value,
      submission: {
        ...value.submission,
        fields: { ...value.submission.fields, comment: 'x'.repeat(5000) },
      },
    };
  });
  await expect(receive(batch(tooLarge))).rejects.toMatchObject({
    reason: 'invalid',
  });
  const wrongPurpose = signGatewayMessage(
    {
      ...good.message,
      kind: 'inquiries.receipt',
      payload: { requestId: good.requestId, acknowledgedCount: 1 },
    },
    key,
  );
  await expect(
    receive({ ...good, packet: wrongPurpose }),
  ).rejects.toMatchObject({ reason: 'unauthorized' });
  const broken = new Pool({ connectionString: container.getConnectionUri() });
  await broken.end();
  await expect(receive(good, actorId, broken)).rejects.toMatchObject({
    reason: 'failed',
    message: 'Website inquiry unavailable',
  });
  expect(Object.values(await counts())).toEqual([0, 0, 0, 0, 0]);
});

test('validated packet, key and time cannot be mutated while waiting for the local lock', async () => {
  const value = batch(),
    at = new Date(now),
    client = await pool.connect();
  await client.query('BEGIN');
  await client.query(
    'SELECT pg_advisory_xact_lock(hashtextextended($1::uuid::text,814022))',
    [tenantId],
  );
  const pending = receiveWebsiteInquiryBatch(
    pool,
    tenantId,
    actorId,
    value.packet,
    { requestId: value.requestId, keys: [key], at },
  );
  value.packet.body = 'fictional mutated packet';
  key.secret.fill(0);
  at.setUTCFullYear(2040);
  await client.query('COMMIT');
  client.release();
  expect(await pending).toEqual({ status: 'applied', count: 1 });
  expect(
    (
      await pool.query(
        'SELECT staged_at FROM website_inquiry_deliveries WHERE tenant_id=$1',
        [tenantId],
      )
    ).rows[0].staged_at,
  ).toEqual(now);
});

test('the actual gateway receive, pull and restart-safe ACK retain local originals after a lost remote response', async () => {
  const { createInquiryGateway } =
    await import('../../packages/core/src/inquiry-gateway.js');
  await pool.query('CREATE DATABASE fictional_gateway_contract');
  const uri = new URL(container.getConnectionUri());
  uri.pathname = '/fictional_gateway_contract';
  const gatewayPool = new Pool({ connectionString: uri.toString() });
  await migrateGateway(gatewayPool);
  const coreKey: GatewayKey = {
    ...key,
    id: 'fictional-outgoing',
    direction: 'core-to-gateway',
    secret: Buffer.alloc(32, 8),
  };
  const app = await createInquiryGateway({
    pool: gatewayPool,
    storage: {
      tenantId,
      keys: [{ id: 'fictional-storage', secret: Buffer.alloc(32, 9) }],
      activeKeyId: 'fictional-storage',
      retentionHours: 24,
      maxStored: 100,
    },
    syncKeys: [coreKey, key],
    responseKeyId: key.id,
    allowedOrigins: ['https://fictional.example.invalid'],
    now: () => now,
  });
  try {
    const value = entry();
    const received = await app.inject({
      method: 'POST',
      url: '/public/v1/forms/fotobox-bw-main/inquiries',
      headers: { origin: 'https://fictional.example.invalid' },
      payload: { submissionId: value.id, submission: value.submission },
    });
    expect(received.statusCode).toBe(202);
    const requestId = randomUUID(),
      pull = signGatewayMessage(
        {
          version: 1,
          tenantId,
          messageId: requestId,
          operationId: randomUUID(),
          issuedAt: now.getTime() / 1000,
          kind: 'inquiries.pull',
          payload: { limit: 10 },
        },
        coreKey,
      );
    const response = await app.inject({
      method: 'POST',
      url: '/sync/v1/inquiries/pull',
      payload: pull,
    });
    expect(response.statusCode).toBe(200);
    expect(
      await receiveWebsiteInquiryBatch(
        pool,
        tenantId,
        actorId,
        response.json(),
        { requestId, keys: [key], at: now },
      ),
    ).toEqual({ status: 'applied', count: 1 });
    const stored = (
      await pool.query(
        'SELECT payload FROM website_inquiry_deliveries WHERE tenant_id=$1',
        [tenantId],
      )
    ).rows[0].payload;
    expect(stored.submission).toEqual(value.submission);
    const original = (
      await gatewayPool.query(
        'SELECT ciphertext,acknowledged_at FROM ak_gateway_inquiries WHERE tenant_id=$1',
        [tenantId],
      )
    ).rows[0];
    expect(original.ciphertext).toBeTruthy();
    expect(original.acknowledged_at).toBeNull();
    expect(
      (await gatewayPool.query("SELECT to_regclass('contacts') AS contacts"))
        .rows[0].contacts,
    ).toBeNull();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: unknown, options?: RequestInit) => {
        const result = await app.inject({
          method: 'POST',
          url: '/sync/v1/inquiries/pull',
          payload: JSON.parse(options!.body as string),
        });
        return new Response(new Uint8Array(result.rawPayload), {
          status: result.statusCode,
          headers: { 'content-type': 'application/json' },
        });
      }),
    );
    expect(
      await pullWebsiteInquiries(pool, tenantId, actorId, {
        origin: 'https://fictional-gateway.example.invalid',
        requestKey: coreKey,
        responseKeys: [key],
        now: () => now,
      }),
    ).toEqual({ status: 'applied', count: 1 });
    expect((await counts()).events).toBe(0);
    const sent: Array<{
      operationId: string;
      messageId: string;
      payload: unknown;
    }> = [];
    let loseResponse = true;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: unknown, options?: RequestInit) => {
        const packet = JSON.parse(options!.body as string);
        sent.push(JSON.parse(packet.body));
        const result = await app.inject({
          method: 'POST',
          url: new URL(String(url)).pathname,
          payload: packet,
        });
        expect(result.statusCode).toBe(200);
        if (loseResponse) {
          loseResponse = false;
          throw new Error('fictional response lost after gateway commit');
        }
        return new Response(new Uint8Array(result.rawPayload), {
          status: result.statusCode,
          headers: { 'content-type': 'application/json' },
        });
      }),
    );
    const config = {
      origin: 'https://fictional-gateway.example.invalid',
      requestKey: coreKey,
      responseKeys: [key],
      now: () => now,
    };
    await expect(
      acknowledgeWebsiteInquiries(pool, tenantId, actorId, config),
    ).rejects.toMatchObject({ reason: 'failed' });
    const acknowledged = (
      await gatewayPool.query(
        'SELECT ciphertext,acknowledged_at FROM ak_gateway_inquiries WHERE tenant_id=$1',
        [tenantId],
      )
    ).rows[0];
    expect(acknowledged.ciphertext).toBeNull();
    expect(acknowledged.acknowledged_at).toEqual(now);
    expect(
      (
        await pool.query(
          'SELECT completed_at FROM website_inquiry_ack_operations WHERE tenant_id=$1',
          [tenantId],
        )
      ).rows[0].completed_at,
    ).toBeNull();
    const restarted = new Pool({
      connectionString: container.getConnectionUri(),
    });
    try {
      expect(
        await acknowledgeWebsiteInquiries(restarted, tenantId, actorId, config),
      ).toEqual({ status: 'applied', count: 1 });
    } finally {
      await restarted.end();
    }
    expect(sent).toHaveLength(2);
    expect(sent[0]!.operationId).toBe(sent[1]!.operationId);
    expect(sent[0]!.messageId).not.toBe(sent[1]!.messageId);
    expect(sent[0]!.payload).toEqual(sent[1]!.payload);
    expect(
      (
        await gatewayPool.query(
          "SELECT count(*) FROM ak_gateway_operations WHERE tenant_id=$1 AND kind='inquiries.ack'",
          [tenantId],
        )
      ).rows[0].count,
    ).toBe('1');
    expect(
      (
        await pool.query(
          'SELECT payload FROM website_inquiry_deliveries WHERE tenant_id=$1',
          [tenantId],
        )
      ).rows[0].payload,
    ).toEqual(stored);
    expect((await counts()).events).toBe(0);
  } finally {
    await app.close();
    await gatewayPool.end();
  }
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
const pullOptions = () => ({
  origin: 'https://fictional-gateway.example.invalid',
  requestKey: {
    ...key,
    id: 'fictional-request',
    direction: 'core-to-gateway' as const,
    secret: Buffer.alloc(32, 8),
  },
  responseKeys: [key],
  now: () => now,
});
function responding(packetBody?: string) {
  return vi.fn(async (_url: unknown, options?: RequestInit) => {
    const request = JSON.parse((options as RequestInit).body as string),
      message = JSON.parse(request.body);
    const response = batch([entry()], message.messageId);
    return new Response(packetBody ?? JSON.stringify(response.packet), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
}
test('HTTPS pull uses a fresh signed request, no cookies or redirects, and persists authenticated originals before returning', async () => {
  const fetcher = responding();
  vi.stubGlobal('fetch', fetcher);
  const config = pullOptions();
  expect(await pullWebsiteInquiries(pool, tenantId, actorId, config)).toEqual({
    status: 'applied',
    count: 1,
  });
  const [url, options] = fetcher.mock.calls[0]!;
  expect(url).toBe(
    'https://fictional-gateway.example.invalid/sync/v1/inquiries/pull',
  );
  expect(options).toMatchObject({
    method: 'POST',
    redirect: 'error',
    credentials: 'omit',
    headers: { 'content-type': 'application/json' },
  });
  expect(options!.signal).toBeInstanceOf(AbortSignal);
  const { verifyGatewayMessage } =
    await import('../../packages/core/src/gateway-message.js');
  expect(
    verifyGatewayMessage(JSON.parse(options!.body as string), {
      tenantId,
      direction: 'core-to-gateway',
      kind: 'inquiries.pull',
      keys: [config.requestKey],
      now: now.getTime() / 1000,
    })?.payload,
  ).toEqual({ limit: 100 });
  expect((await counts()).website_inquiry_deliveries).toBe(1);
  expect((await counts()).events).toBe(0);
});
test('HTTPS pull rejects unsafe configuration and unauthorized actors before opening a connection', async () => {
  const fetcher = responding();
  vi.stubGlobal('fetch', fetcher);
  const config = pullOptions();
  for (const origin of [
    'http://fictional.example.invalid',
    'https://user:password@fictional.example.invalid',
    'https://fictional.example.invalid/path',
    'https://fictional.example.invalid/?secret=fictional',
    'https://fictional.example.invalid/#fragment',
    'invalid',
  ])
    await expect(
      pullWebsiteInquiries(pool, tenantId, actorId, { ...config, origin }),
    ).rejects.toMatchObject({ reason: 'invalid' });
  await expect(
    pullWebsiteInquiries(pool, tenantId, randomUUID(), config),
  ).rejects.toMatchObject({ reason: 'forbidden' });
  expect(fetcher).not.toHaveBeenCalled();
});
test('HTTPS response errors, invalid encodings and oversized streams leave no local effects or sensitive diagnostics', async () => {
  const config = pullOptions();
  const variants = [
    () => new Response('{}', { status: 503 }),
    () =>
      new Response('{}', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      }),
    () =>
      new Response(null, {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    () =>
      new Response('{broken', {
        headers: { 'content-type': 'application/json' },
      }),
    () =>
      new Response(Buffer.from([0xff]), {
        headers: { 'content-type': 'application/json' },
      }),
    () =>
      new Response('x'.repeat(132097), {
        headers: { 'content-type': 'application/json' },
      }),
    () =>
      new Response('x', {
        headers: {
          'content-type': 'application/json',
          'content-length': '132097',
        },
      }),
    () => {
      throw new Error('fictional-private-transport-details');
    },
  ];
  for (const variant of variants) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => variant()),
    );
    await expect(
      pullWebsiteInquiries(pool, tenantId, actorId, config),
    ).rejects.toMatchObject({
      reason: 'failed',
      message: 'Website inquiry unavailable',
    });
  }
  expect(Object.values(await counts())).toEqual([0, 0, 0, 0, 0]);
  vi.stubGlobal('fetch', responding());
  expect(await pullWebsiteInquiries(pool, tenantId, actorId, config)).toEqual({
    status: 'applied',
    count: 1,
  });
});

test('HTTPS pulls reject broken streams and response authentication failures without partial intake', async () => {
  const config = pullOptions();
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.error(new Error('fictional private stream error'));
            },
          }),
          { headers: { 'content-type': 'application/json' } },
        ),
    ),
  );
  await expect(
    pullWebsiteInquiries(pool, tenantId, actorId, config),
  ).rejects.toMatchObject({ reason: 'failed' });
  vi.stubGlobal('fetch', responding(JSON.stringify(batch().packet)));
  await expect(
    pullWebsiteInquiries(pool, tenantId, actorId, config),
  ).rejects.toMatchObject({ reason: 'invalid' });
  vi.stubGlobal('fetch', responding('{}'));
  await expect(
    pullWebsiteInquiries(pool, tenantId, actorId, config),
  ).rejects.toMatchObject({ reason: 'unauthorized' });
  let reads = 0;
  vi.stubGlobal('fetch', responding());
  await expect(
    pullWebsiteInquiries(pool, tenantId, actorId, {
      ...config,
      now: () => new Date(now.getTime() + (reads++ === 0 ? 0 : 3601000)),
    }),
  ).rejects.toMatchObject({ reason: 'unauthorized' });
  expect(Object.values(await counts())).toEqual([0, 0, 0, 0, 0]);
});

test('HTTPS pull snapshots destination and verification keys before awaiting local authorization', async () => {
  const config = pullOptions(),
    signingKey = { ...key, secret: Buffer.from(key.secret) };
  const fetcher = vi.fn(async (_url: unknown, options?: RequestInit) => {
    const request = JSON.parse(JSON.parse(options!.body as string).body);
    return Response.json(
      signGatewayMessage(
        {
          version: 1,
          tenantId,
          messageId: randomUUID(),
          operationId: randomUUID(),
          issuedAt: now.getTime() / 1000,
          kind: 'inquiries.batch',
          payload: { requestId: request.messageId, inquiries: [entry()] },
        },
        signingKey,
      ),
    );
  });
  vi.stubGlobal('fetch', fetcher);
  const pending = pullWebsiteInquiries(pool, tenantId, actorId, config);
  config.origin = 'https://fictional-other.example.invalid';
  key.secret.fill(0);
  expect(await pending).toEqual({ status: 'applied', count: 1 });
  expect(fetcher.mock.calls[0]![0]).toBe(
    'https://fictional-gateway.example.invalid/sync/v1/inquiries/pull',
  );
});

test('HTTPS pull binds the ten-second abort signal and leaves timed-out input retryable', async () => {
  const controller = new AbortController(),
    timeout = vi
      .spyOn(AbortSignal, 'timeout')
      .mockReturnValue(controller.signal);
  const fetcher = vi.fn(
    async (_url: unknown, options?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        options!.signal!.addEventListener(
          'abort',
          () => reject(options!.signal!.reason),
          { once: true },
        );
      }),
  );
  vi.stubGlobal('fetch', fetcher);
  const pending = pullWebsiteInquiries(pool, tenantId, actorId, pullOptions());
  const rejection = expect(pending).rejects.toMatchObject({
    reason: 'failed',
    message: 'Website inquiry unavailable',
  });
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalled());
  expect(timeout).toHaveBeenCalledWith(10000);
  controller.abort(new DOMException('fictional timeout', 'TimeoutError'));
  await rejection;
  expect(Object.values(await counts())).toEqual([0, 0, 0, 0, 0]);
});

test('HTTPS pull uses the real default clock and accepts a correctly signed empty response', async () => {
  const clockKey = { ...key, notBefore: 0, expiresAt: Number.MAX_SAFE_INTEGER };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: unknown, options?: RequestInit) => {
      const request = JSON.parse(JSON.parse(options!.body as string).body);
      return Response.json(
        signGatewayMessage(
          {
            ...request,
            messageId: randomUUID(),
            operationId: randomUUID(),
            kind: 'inquiries.batch',
            payload: { requestId: request.messageId, inquiries: [] },
          },
          clockKey,
        ),
      );
    }),
  );
  const config = pullOptions();
  expect(
    await pullWebsiteInquiries(pool, tenantId, actorId, {
      origin: config.origin,
      requestKey: {
        ...config.requestKey,
        notBefore: 0,
        expiresAt: Number.MAX_SAFE_INTEGER,
      },
      responseKeys: [clockKey],
    }),
  ).toEqual({ status: 'applied', count: 0 });
});

// The loop feeds real wall-clock timestamps to the transport, so its fixtures
// are built from Date.now() rather than the frozen `now` above. The shared `key`
// only becomes valid in 2030 and would reject every live signature.
const loopKey = (): GatewayKey => {
  const at = Math.floor(Date.now() / 1000);
  return {
    ...key,
    id: 'fictional-live',
    notBefore: at - 60,
    expiresAt: at + 3600,
  };
};
const liveEntry = () => {
  const at = new Date();
  return {
    id: randomUUID(),
    receivedAt: at.toISOString(),
    expiresAt: new Date(at.getTime() + 3600_000).toISOString(),
    submission: {
      formId: 'fotobox-bw-main',
      formVersion: 1,
      fields: {
        firstName: 'Fictional',
        lastName: 'Loop',
        email: 'loop@example.invalid',
        eventDate: '2030-10-27',
      },
    },
    privacyNotice: inquiryFormV1.privacyNotice,
    privacyUrl: inquiryFormV1.privacyUrl,
  };
};
const liveBatch = (requestId: string, signingKey: GatewayKey) =>
  signGatewayMessage(
    {
      version: 1 as const,
      tenantId,
      messageId: randomUUID(),
      operationId: randomUUID(),
      issuedAt: Math.floor(Date.now() / 1000),
      kind: 'inquiries.batch' as const,
      payload: { requestId, inquiries: [liveEntry()] },
    },
    signingKey,
  );
const liveReceipt = (requestId: string, signingKey: GatewayKey) =>
  signGatewayMessage(
    {
      version: 1 as const,
      tenantId,
      messageId: randomUUID(),
      operationId: randomUUID(),
      issuedAt: Math.floor(Date.now() / 1000),
      kind: 'inquiries.receipt' as const,
      payload: { requestId, acknowledgedCount: 1 },
    },
    signingKey,
  );
const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
function gatewayLoop(signingKey: GatewayKey) {
  return vi.fn(async (url: unknown, options?: RequestInit) => {
    const request = JSON.parse((options as RequestInit).body as string),
      message = JSON.parse(request.body);
    return String(url).endsWith('/pull')
      ? json(liveBatch(message.messageId, signingKey))
      : json(liveReceipt(message.messageId, signingKey));
  });
}
const loopConfig = (signingKey: GatewayKey) => ({
  tenantId,
  actorId,
  origin: 'https://fictional-gateway.example.invalid',
  requestKey: {
    ...signingKey,
    id: 'fictional-request',
    direction: 'core-to-gateway' as const,
  },
  responseKeys: [signingKey],
  intervalMs: 3_600_000,
});
test('the sync loop pulls, acknowledges and becomes ready until it is stopped', async () => {
  const signingKey = loopKey(),
    fetcher = gatewayLoop(signingKey);
  vi.stubGlobal('fetch', fetcher);
  const errors = vi.fn();
  const loop = startWebsiteInquirySync(pool, loopConfig(signingKey), errors);
  try {
    await vi.waitFor(() => expect(loop.ready()).toBe(true));
    expect(fetcher.mock.calls.map((call) => call[0])).toEqual([
      'https://fictional-gateway.example.invalid/sync/v1/inquiries/pull',
      'https://fictional-gateway.example.invalid/sync/v1/inquiries/ack',
    ]);
    expect(errors).not.toHaveBeenCalled();
    expect((await counts()).website_inquiry_deliveries).toBe(1);
  } finally {
    await loop.stop();
  }
});
test('a failing cycle stays unready and reports instead of throwing', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new Error('gateway unreachable');
    }),
  );
  const errors = vi.fn();
  const loop = startWebsiteInquirySync(pool, loopConfig(loopKey()), errors);
  try {
    await vi.waitFor(() => expect(errors).toHaveBeenCalled());
    expect(loop.ready()).toBe(false);
  } finally {
    await loop.stop();
  }
});
test('the loop requires an active administrator and pulls nothing otherwise', async () => {
  const signingKey = loopKey(),
    fetcher = gatewayLoop(signingKey);
  vi.stubGlobal('fetch', fetcher);
  const errors = vi.fn();
  const loop = startWebsiteInquirySync(
    pool,
    { ...loopConfig(signingKey), actorId: randomUUID() },
    errors,
  );
  try {
    await vi.waitFor(() => expect(errors).toHaveBeenCalled());
    expect(loop.ready()).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  } finally {
    await loop.stop();
  }
});
