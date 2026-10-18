import { createInquirySubmission } from '../../apps/widget/src/inquiry-client.js';
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
import { migrateGateway } from '../../packages/core/src/gateway-operations.js';
import {
  inquiryInbox,
  type InquiryInboxConfig,
} from '../../packages/core/src/inquiry-inbox.js';
import {
  signGatewayMessage,
  verifyGatewayMessage,
  type GatewayKey,
  type GatewayMessage,
} from '../../packages/core/src/gateway-message.js';
import { createInquiryGateway } from '../../packages/core/src/inquiry-gateway.js';
import type { FastifyInstance } from 'fastify';

let container: StartedPostgreSqlContainer, pool: Pool, app: FastifyInstance;
const tenantId = '00000000-0000-4000-8000-000000000231',
  origin = 'https://fictional.example.invalid';
const now = new Date('2030-10-26T10:00:00Z'),
  epoch = Math.floor(now.getTime() / 1000);
const storage: InquiryInboxConfig = {
  tenantId,
  keys: [{ id: 'fictional-storage', secret: Buffer.alloc(32, 61) }],
  activeKeyId: 'fictional-storage',
  retentionHours: 24,
  maxStored: 100,
};
const core: GatewayKey = {
  id: 'fictional-core',
  tenantId,
  direction: 'core-to-gateway',
  secret: Buffer.alloc(32, 62),
  notBefore: epoch - 1000,
  expiresAt: epoch + 1000,
};
const gateway: GatewayKey = {
  ...core,
  id: 'fictional-gateway',
  direction: 'gateway-to-core',
  secret: Buffer.alloc(32, 63),
};
const options = () => ({
  pool,
  storage,
  syncKeys: [core, gateway],
  responseKeyId: gateway.id,
  allowedOrigins: [origin],
  now: () => now,
});
const submission = () => ({
  formId: 'fotobox-bw-main',
  formVersion: 1,
  fields: {
    firstName: 'Fictional',
    lastName: 'Example',
    email: 'fictional@example.invalid',
    eventDate: '2030-10-27',
    comment: 'Fictional private comment',
  },
});
const path = '/public/v1/forms/fotobox-bw-main/inquiries';
const post = (payload: Record<string, unknown> | string, extra = {}) =>
  app.inject({
    method: 'POST',
    url: path,
    headers: { origin },
    payload,
    ...extra,
  });
const packet = (
  kind: 'inquiries.pull' | 'inquiries.ack',
  payload: Record<string, unknown>,
  operationId = randomUUID(),
) =>
  signGatewayMessage(
    {
      version: 1,
      tenantId,
      messageId: randomUUID(),
      operationId,
      issuedAt: epoch,
      kind,
      payload,
    },
    core,
  );
beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:17.6-alpine').start();
  pool = new Pool({ connectionString: container.getConnectionUri() });
  await migrateGateway(pool);
});
beforeEach(async () => {
  await pool.query(
    'TRUNCATE ak_gateway_inquiries,ak_gateway_messages,ak_gateway_operations',
  );
  app = await createInquiryGateway(options());
});
afterEach(async () => {
  await app?.close();
});
afterAll(async () => {
  await app?.close();
  await pool?.end();
  await container?.stop();
});
const count = async () =>
  Number(
    (await pool.query('SELECT count(*) FROM ak_gateway_inquiries')).rows[0]
      .count,
  );

test('public definition keeps all fields without exposing tenant, keys or internal values', async () => {
  const r = await app.inject({
    url: '/public/v1/forms/fotobox-bw-main',
    headers: { origin },
  });
  expect(r.statusCode).toBe(200);
  expect(r.json().fields).toHaveLength(8);
  for (const text of [
    tenantId,
    'fictional-storage',
    'fictional-core',
    'fun-Paket',
  ])
    expect(r.body).not.toContain(text);
  expect(r.headers['cache-control']).toBe('no-store');
  expect(r.headers['access-control-allow-origin']).toBe(origin);
  expect(
    (await app.inject({ url: '/public/v1/forms/unknown' })).statusCode,
  ).toBe(404);
  expect((await app.inject({ url: '/health/live' })).statusCode).toBe(200);
  expect((await app.inject({ url: '/health/ready' })).statusCode).toBe(200);
});

test('public receive is encrypted, idempotent and confirms only receipt', async () => {
  const body = {
    submissionId: randomUUID(),
    submission: submission(),
    website: '',
  };
  const first = await post(body),
    retry = await post(body);
  expect(first.statusCode).toBe(202);
  expect(first.json()).toEqual({ status: 'received' });
  expect(retry.statusCode).toBe(202);
  expect(await count()).toBe(1);
  expect(first.headers['set-cookie']).toBeUndefined();
  expect(first.headers['access-control-allow-credentials']).toBeUndefined();
  const changed = await post({
    ...body,
    submission: {
      ...submission(),
      fields: { ...submission().fields, comment: 'Fictional changed' },
    },
  });
  expect(changed.statusCode).toBe(409);
  expect(changed.json()).toEqual({ error: 'inquiry_conflict' });
  expect(
    JSON.stringify(
      (await pool.query('SELECT * FROM ak_gateway_inquiries')).rows,
    ),
  ).not.toContain('fictional@example.invalid');
});

test('unknown fields, invalid dates and malicious metadata never create an inquiry', async () => {
  const base = { submissionId: randomUUID(), submission: submission() };
  for (const payload of [
    { ...base, tenantId },
    {
      ...base,
      submission: {
        ...submission(),
        fields: { ...submission().fields, status: 'booked' },
      },
    },
    {
      ...base,
      submission: {
        ...submission(),
        fields: { ...submission().fields, eventDate: '2030-02-30' },
      },
    },
    { ...base, submissionId: 'invalid' },
    { submissionId: randomUUID() },
  ]) {
    const r = await post(payload);
    expect(r.statusCode).toBe(400);
    expect(r.body).not.toContain('Fictional');
    expect(r.body).not.toContain('booked');
  }
  expect(await count()).toBe(0);
});

test('only exact configured browser origins and bounded JSON are accepted', async () => {
  const body = { submissionId: randomUUID(), submission: submission() };
  for (const headers of [
    {},
    { origin: 'https://fictional.example.invalid.attacker.invalid' },
    { origin: 'null' },
  ])
    expect((await post(body, { headers })).statusCode).toBe(403);
  expect(
    (
      await post('fictional-private-body', {
        headers: { origin, 'content-type': 'text/plain' },
      })
    ).statusCode,
  ).toBe(415);
  expect((await post({ ...body, website: 'x'.repeat(40000) })).statusCode).toBe(
    413,
  );
  const preflight = await app.inject({
    method: 'OPTIONS',
    url: path,
    headers: {
      origin,
      'access-control-request-method': 'POST',
      'access-control-request-headers': 'content-type',
    },
  });
  expect(preflight.statusCode).toBe(204);
  expect(preflight.headers['access-control-allow-methods']).toBe('POST');
  expect(
    (
      await app.inject({
        method: 'OPTIONS',
        url: path,
        headers: { origin, 'access-control-request-method': 'DELETE' },
      })
    ).statusCode,
  ).toBe(403);
  expect(await count()).toBe(0);
});

test('honeypot and per-address rate limiting create no false stored data', async () => {
  const honey = await post({
    submissionId: randomUUID(),
    submission: submission(),
    website: 'fictional-bot.invalid',
  });
  expect(honey.statusCode).toBe(202);
  expect(await count()).toBe(0);
  for (let i = 0; i < 10; i++)
    await post({ submissionId: randomUUID(), submission: submission() });
  const r = await post({
    submissionId: randomUUID(),
    submission: submission(),
  });
  expect(r.statusCode).toBe(429);
  expect(r.json()).toEqual({ error: 'rate_limited' });
});

test('private pull requires authentication, rejects browser access and returns a correlated bounded signed batch', async () => {
  await inquiryInbox(pool, storage).receive(randomUUID(), submission(), now);
  const url = '/sync/v1/inquiries/pull';
  expect(
    (await app.inject({ method: 'POST', url, payload: {} })).statusCode,
  ).toBe(401);
  expect(
    (
      await app.inject({
        method: 'POST',
        url,
        headers: { origin },
        payload: packet('inquiries.pull', { limit: 10 }),
      })
    ).statusCode,
  ).toBe(403);
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/%73ync/v1/inquiries/pull',
        headers: { origin },
        payload: packet('inquiries.pull', { limit: 10 }),
      })
    ).statusCode,
  ).toBe(403);
  const request = packet('inquiries.pull', { limit: 10 });
  const r = await app.inject({ method: 'POST', url, payload: request });
  expect(r.statusCode).toBe(200);
  const verified = verifyGatewayMessage(r.json(), {
    tenantId,
    direction: 'gateway-to-core',
    kind: 'inquiries.batch',
    keys: [gateway],
    now: epoch,
  })!;
  expect(verified).not.toBeNull();
  expect(verified.payload.requestId).toBe(
    (JSON.parse(request.body) as GatewayMessage).messageId,
  );
  expect(verified.payload.inquiries).toHaveLength(1);
  expect(r.headers['cache-control']).toBe('no-store');
  expect(r.headers['access-control-allow-origin']).toBeUndefined();
  expect(
    (await app.inject({ method: 'POST', url, payload: request })).statusCode,
  ).toBe(409);
  expect(
    (
      await app.inject({
        method: 'POST',
        url,
        payload: packet('inquiries.pull', { limit: 1000 }),
      })
    ).statusCode,
  ).toBe(400);
});

test('a key that expires during operation makes readiness and intake fail closed', async () => {
  let clock = now;
  await app.close();
  app = await createInquiryGateway({ ...options(), now: () => clock });
  clock = new Date((gateway.expiresAt + 1) * 1000);
  expect((await app.inject({ url: '/health/ready' })).statusCode).toBe(503);
  expect(
    (await post({ submissionId: randomUUID(), submission: submission() }))
      .statusCode,
  ).toBe(503);
  expect(await count()).toBe(0);
});

test('signed acknowledgments use the same transaction as receipt protection', async () => {
  const inbox = inquiryInbox(pool, storage),
    id = randomUUID();
  await inbox.receive(id, submission(), now);
  const operation = randomUUID(),
    request = packet('inquiries.ack', { inquiryIds: [id] }, operation),
    url = '/sync/v1/inquiries/ack';
  const first = await app.inject({ method: 'POST', url, payload: request });
  expect(first.statusCode).toBe(200);
  const receipt = verifyGatewayMessage(first.json(), {
    tenantId,
    direction: 'gateway-to-core',
    kind: 'inquiries.receipt' as GatewayMessage['kind'],
    keys: [gateway],
    now: epoch,
  });
  expect(receipt?.payload).toEqual({
    requestId: JSON.parse(request.body).messageId,
    acknowledgedCount: 1,
  });
  const retry = await app.inject({
    method: 'POST',
    url,
    payload: packet('inquiries.ack', { inquiryIds: [id] }, operation),
  });
  expect(
    verifyGatewayMessage(retry.json(), {
      tenantId,
      direction: 'gateway-to-core',
      kind: 'inquiries.receipt' as GatewayMessage['kind'],
      keys: [gateway],
      now: epoch,
    })?.payload.acknowledgedCount,
  ).toBe(1);
  expect(await inbox.pending(10, now)).toEqual([]);
  expect(
    (
      await app.inject({
        method: 'POST',
        url,
        payload: packet(
          'inquiries.ack',
          { inquiryIds: [randomUUID()] },
          operation,
        ),
      })
    ).statusCode,
  ).toBe(409);
  expect(
    (
      await app.inject({
        method: 'POST',
        url,
        payload: packet('inquiries.ack', { inquiryIds: ['not-an-id'] }),
      })
    ).statusCode,
  ).toBe(400);
});

test('large pending batches stay below the signed payload cap without losing queued requests', async () => {
  const inbox = inquiryInbox(pool, storage);
  for (let i = 0; i < 6; i++)
    await inbox.receive(
      randomUUID(),
      {
        ...submission(),
        fields: { ...submission().fields, comment: '😀'.repeat(5000) },
      },
      now,
    );
  const r = await app.inject({
    method: 'POST',
    url: '/sync/v1/inquiries/pull',
    payload: packet('inquiries.pull', { limit: 100 }),
  });
  expect(r.statusCode).toBe(200);
  const verified = verifyGatewayMessage(r.json(), {
    tenantId,
    direction: 'gateway-to-core',
    kind: 'inquiries.batch',
    keys: [gateway],
    now: epoch,
  })!;
  const list = verified.payload.inquiries as unknown[];
  expect(list.length).toBeGreaterThan(0);
  expect(list.length).toBeLessThan(6);
  expect(Buffer.byteLength(r.json().body)).toBeLessThanOrEqual(65536);
  expect(await count()).toBe(6);
});

test('capacity, expired retries and a database outage return neutral failures', async () => {
  await app.close();
  app = await createInquiryGateway({
    ...options(),
    storage: { ...storage, maxStored: 1 },
  });
  const body = { submissionId: randomUUID(), submission: submission() };
  expect((await post(body)).statusCode).toBe(202);
  const full = await post({ ...body, submissionId: randomUUID() });
  expect(full.statusCode).toBe(503);
  expect(full.body).toBe('{"error":"unavailable"}');
  await app.close();
  app = await createInquiryGateway({
    ...options(),
    now: () => new Date(now.getTime() + 25 * 3600000),
    syncKeys: [
      { ...core, expiresAt: epoch + 100000 },
      { ...gateway, expiresAt: epoch + 100000 },
    ],
  });
  expect((await post(body)).statusCode).toBe(410);
  const closed = new Pool({ connectionString: container.getConnectionUri() });
  await closed.end();
  await app.close();
  app = await createInquiryGateway({ ...options(), pool: closed });
  const down = await post({ ...body, submissionId: randomUUID() });
  expect(down.statusCode).toBe(503);
  expect(down.body).not.toContain('fictional@');
  expect((await app.inject({ url: '/health/ready' })).statusCode).toBe(503);
});

test('unsafe origins or missing response keys fail configuration before serving', async () => {
  for (const change of [
    { allowedOrigins: ['https://fictional.example.invalid/path'] },
    { allowedOrigins: ['http://public.example.invalid'] },
    { allowedOrigins: [] },
    { responseKeyId: 'missing' },
  ])
    await expect(
      createInquiryGateway({ ...options(), ...change }),
    ).rejects.toThrow('Invalid inquiry gateway configuration');
});

test('changing caller configuration cannot redirect an authenticated acknowledgment into another tenant', async () => {
  const mutableStorage = {
    ...storage,
    keys: storage.keys.map((k) => ({ ...k, secret: Buffer.from(k.secret) })),
  };
  await app.close();
  app = await createInquiryGateway({ ...options(), storage: mutableStorage });
  const foreign = randomUUID(),
    id = randomUUID();
  const own = inquiryInbox(pool, storage),
    other = inquiryInbox(pool, { ...storage, tenantId: foreign });
  await own.receive(id, submission(), now);
  await other.receive(id, submission(), now);
  mutableStorage.tenantId = foreign;
  const r = await app.inject({
    method: 'POST',
    url: '/sync/v1/inquiries/ack',
    payload: packet('inquiries.ack', { inquiryIds: [id] }),
  });
  expect(r.statusCode).toBe(200);
  expect(await own.pending(10, now)).toEqual([]);
  expect(await other.pending(10, now)).toHaveLength(1);
});

test('the browser client retries a lost public response without a second encrypted intake and preserves all eight original fields', async () => {
  const fields = {
    ...submission().fields,
    phone: '+49 000 000000',
    location: 'Fictional demonstration hall',
    package: 'easy-print-plus' as const,
  };
  const attempt = createInquirySubmission(
    'https://fictional-gateway.example.invalid',
    fields,
  );
  let lose = true;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown, options?: RequestInit) => {
      const result = await app.inject({
        method: 'POST',
        url: new URL(String(url)).pathname,
        headers: { origin, 'content-type': 'application/json' },
        payload: options!.body as string,
      });
      expect(result.statusCode).toBe(202);
      if (lose) {
        lose = false;
        throw new Error('fictional response lost after intake');
      }
      return new Response(new Uint8Array(result.rawPayload), {
        status: result.statusCode,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
  try {
    await expect(attempt.send()).rejects.toMatchObject({
      reason: 'unavailable',
    });
    expect(await count()).toBe(1);
    expect(await attempt.send()).toEqual({ status: 'received' });
    expect(await count()).toBe(1);
    const [stored] = await inquiryInbox(pool, storage).pending(10, now);
    expect(stored!.submission.fields).toEqual(fields);
  } finally {
    vi.unstubAllGlobals();
  }
});
