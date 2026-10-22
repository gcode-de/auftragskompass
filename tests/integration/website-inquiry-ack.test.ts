import { acknowledgeWebsiteInquiries } from '../../packages/core/src/website-inquiry-ack-send.js';
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
import {
  importStagedWebsiteInquiry,
  stageWebsiteInquiry,
} from '../../packages/core/src/website-inquiry-deliveries.js';
import {
  prepareWebsiteInquiryAcknowledgement,
  receiveWebsiteInquiryAcknowledgement,
} from '../../packages/core/src/website-inquiry-ack.js';
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
      lastName: 'Acknowledgement',
      email: 'ack@example.invalid',
      eventDate: '2030-10-27',
    },
  },
  privacyNotice: inquiryFormV1.privacyNotice,
  privacyUrl: inquiryFormV1.privacyUrl,
});
async function owner(tenant: string) {
  await bootstrapAccess(
    pool,
    tenant,
    'fictional.owner@example.invalid',
    'Fictional ACK',
    'Europe/Berlin',
  );
  await accessRepository(pool, tenant).issueSession(
    { subject: 'fictional', email: 'fictional.owner@example.invalid' },
    digest(randomUUID()),
  );
  return (await accessRepository(pool, tenant).list())[0]!.userId!;
}
const prepare = (actor = actorId, tenant = tenantId, connection = pool) =>
  prepareWebsiteInquiryAcknowledgement(connection, tenant, actor, now);
function receipt(
  requestId: string,
  count = 1,
  payload?: Record<string, unknown>,
) {
  return signGatewayMessage(
    {
      version: 1,
      tenantId,
      messageId: randomUUID(),
      operationId: randomUUID(),
      issuedAt: now.getTime() / 1000,
      kind: 'inquiries.receipt',
      payload: payload ?? { requestId, acknowledgedCount: count },
    },
    key,
  );
}
const receive = (packet: unknown, actor = actorId, tenant = tenantId) =>
  receiveWebsiteInquiryAcknowledgement(pool, tenant, actor, packet, {
    keys: [key],
    at: now,
  });
async function pending() {
  return (
    await pool.query(
      'SELECT count(*) FROM website_inquiry_ack_operations WHERE tenant_id=$1 AND completed_at IS NULL',
      [tenantId],
    )
  ).rows[0].count;
}
beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:17.6-alpine').start();
  pool = new Pool({ connectionString: container.getConnectionUri() });
  await migrate(pool);
  await migrateGateway(pool);
});
beforeEach(async () => {
  tenantId = randomUUID();
  actorId = await owner(tenantId);
  key = {
    id: 'fictional-ack',
    tenantId,
    direction: 'gateway-to-core',
    secret: Buffer.alloc(32, 9),
    notBefore: now.getTime() / 1000 - 60,
    expiresAt: now.getTime() / 1000 + 3600,
  };
});
afterAll(async () => {
  await pool?.end();
  await container?.stop();
});
test('only durable local originals enter a stable pending batch; restart and parallel retries create fresh bound attempts', async () => {
  expect(await prepare()).toBeNull();
  const values = [entry(), entry()];
  for (const value of values)
    await stageWebsiteInquiry(pool, tenantId, actorId, value, now);
  const first = (await prepare())!;
  expect(first.inquiryIds).toEqual(values.map((v) => v.id).sort());
  const restarted = new Pool({
    connectionString: container.getConnectionUri(),
  });
  try {
    const retries = await Promise.all([
      prepare(),
      prepare(actorId, tenantId, restarted),
    ]);
    for (const retry of retries) {
      expect(retry!.operationId).toBe(first.operationId);
      expect(retry!.inquiryIds).toEqual(first.inquiryIds);
    }
    expect(
      new Set([first.messageId, ...retries.map((r) => r!.messageId)]).size,
    ).toBe(3);
    expect(await pending()).toBe('1');
    expect(
      (
        await pool.query('SELECT count(*) FROM events WHERE tenant_id=$1', [
          tenantId,
        ])
      ).rows[0].count,
    ).toBe('0');
  } finally {
    await restarted.end();
  }
});
test('a receipt completes only its durable attempt; replay is rejected and later new originals form a separate operation', async () => {
  const original = entry();
  await stageWebsiteInquiry(pool, tenantId, actorId, original, now);
  const job = (await prepare())!;
  const packet = receipt(job.messageId);
  expect(await receive(packet)).toEqual({ status: 'applied', count: 1 });
  expect(await pending()).toBe('0');
  expect(await prepare()).toBeNull();
  await expect(receive(packet)).rejects.toMatchObject({ reason: 'replay' });
  expect(
    (
      await pool.query(
        'SELECT payload FROM website_inquiry_deliveries WHERE tenant_id=$1 AND id=$2',
        [tenantId, original.id],
      )
    ).rows[0].payload,
  ).toEqual(original);
  const fresh = entry();
  await stageWebsiteInquiry(pool, tenantId, actorId, fresh, now);
  const next = (await prepare())!;
  expect(next.operationId).not.toBe(job.operationId);
  expect(next.inquiryIds).toEqual([fresh.id]);
  // A late response to an earlier attempt must not complete the newer operation.
  expect(await receive(receipt(job.messageId))).toEqual({
    status: 'applied',
    count: 1,
  });
  expect(await pending()).toBe('1');
});
test('invalid, oversized, unrelated, expired or unauthorized receipts leave pending work untouched', async () => {
  await stageWebsiteInquiry(pool, tenantId, actorId, entry(), now);
  const job = (await prepare())!;
  for (const payload of [
    { requestId: job.messageId, acknowledgedCount: 1, extra: true },
    { requestId: job.messageId, acknowledgedCount: -1 },
    { requestId: job.messageId, acknowledgedCount: 1.5 },
    { requestId: job.messageId, acknowledgedCount: 101 },
    { requestId: 'invalid', acknowledgedCount: 1 },
  ])
    await expect(
      receive(receipt(job.messageId, 1, payload)),
    ).rejects.toMatchObject({ reason: 'invalid' });
  await expect(receive(receipt(randomUUID()))).rejects.toMatchObject({
    reason: 'not_found',
  });
  await expect(receive(receipt(job.messageId, 2))).rejects.toMatchObject({
    reason: 'invalid',
  });
  await expect(receive({})).rejects.toMatchObject({ reason: 'unauthorized' });
  const packet = receipt(job.messageId);
  await expect(
    receiveWebsiteInquiryAcknowledgement(pool, tenantId, actorId, packet, {
      keys: [key],
      at: new Date(now.getTime() + 3601000),
    }),
  ).rejects.toMatchObject({ reason: 'unauthorized' });
  await expect(receive(packet, randomUUID())).rejects.toMatchObject({
    reason: 'forbidden',
  });
  expect(await pending()).toBe('1');
  expect(await receive(packet)).toEqual({ status: 'applied', count: 1 });
});
test('zero-count receipt after remote expiry is valid; parallel receipt attempts complete once without deleting the local original', async () => {
  await stageWebsiteInquiry(pool, tenantId, actorId, entry(), now);
  const [a, b] = await Promise.all([prepare(), prepare()]);
  const results = await Promise.all([
    receive(receipt(a!.messageId, 0)),
    receive(receipt(b!.messageId, 0)),
  ]);
  expect(results).toEqual([
    { status: 'applied', count: 0 },
    { status: 'applied', count: 0 },
  ]);
  expect(await pending()).toBe('0');
  expect(
    (
      await pool.query(
        'SELECT count(*) FROM website_inquiry_deliveries WHERE tenant_id=$1',
        [tenantId],
      )
    ).rows[0].count,
  ).toBe('1');
});
test('tenant and active-operator boundaries apply to preparation and completion; malformed clocks never write', async () => {
  await stageWebsiteInquiry(pool, tenantId, actorId, entry(), now);
  const job = (await prepare())!;
  const foreign = randomUUID(),
    other = await owner(foreign);
  expect(await prepare(other, foreign)).toBeNull();
  await expect(prepare(other)).rejects.toMatchObject({ reason: 'forbidden' });
  await expect(receive(receipt(job.messageId), other)).rejects.toMatchObject({
    reason: 'forbidden',
  });
  await expect(
    receive(receipt(job.messageId), other, foreign),
  ).rejects.toMatchObject({ reason: 'unauthorized' });
  await expect(
    prepareWebsiteInquiryAcknowledgement(
      pool,
      tenantId,
      actorId,
      new Date(NaN),
    ),
  ).rejects.toMatchObject({ reason: 'invalid' });
  await expect(
    prepareWebsiteInquiryAcknowledgement(pool, 'invalid', actorId, now),
  ).rejects.toMatchObject({ reason: 'invalid' });
  expect(await pending()).toBe('1');
});
test('database relationships reject ACK items that were never durably received or belong to another tenant', async () => {
  await stageWebsiteInquiry(pool, tenantId, actorId, entry(), now);
  const job = (await prepare())!;
  await expect(
    pool.query(
      'INSERT INTO website_inquiry_ack_items(tenant_id,operation_id,inquiry_id) VALUES($1,$2,$3)',
      [tenantId, job.operationId, randomUUID()],
    ),
  ).rejects.toMatchObject({ code: '23503' });
  const foreign = randomUUID(),
    other = await owner(foreign);
  await stageWebsiteInquiry(pool, foreign, other, entry(), now);
  const otherJob = (await prepare(other, foreign))!;
  await expect(
    pool.query(
      'INSERT INTO website_inquiry_ack_attempts(tenant_id,message_id,operation_id,created_at) VALUES($1,$2,$3,$4)',
      [tenantId, randomUUID(), otherJob.operationId, now],
    ),
  ).rejects.toMatchObject({ code: '23503' });
});

test('preparation and receipt failures roll back all job changes and technical receipts, leaving the same packet retryable', async () => {
  await stageWebsiteInquiry(pool, tenantId, actorId, entry(), now);
  await pool.query(
    "CREATE FUNCTION fictional_ack_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fictional private failure'; END $$",
  );
  try {
    await pool.query(
      'CREATE TRIGGER fictional_ack_prepare_fail BEFORE INSERT ON website_inquiry_ack_attempts FOR EACH ROW EXECUTE FUNCTION fictional_ack_fail()',
    );
    await expect(prepare()).rejects.toMatchObject({
      reason: 'failed',
      message: 'Website inquiry unavailable',
    });
    expect(await pending()).toBe('0');
    expect(
      (
        await pool.query(
          'SELECT count(*) FROM website_inquiry_ack_items WHERE tenant_id=$1',
          [tenantId],
        )
      ).rows[0].count,
    ).toBe('0');
    await pool.query(
      'DROP TRIGGER fictional_ack_prepare_fail ON website_inquiry_ack_attempts',
    );
    const job = (await prepare())!,
      packet = receipt(job.messageId);
    await pool.query(
      'CREATE TRIGGER fictional_ack_complete_fail BEFORE UPDATE ON website_inquiry_ack_operations FOR EACH ROW EXECUTE FUNCTION fictional_ack_fail()',
    );
    await expect(receive(packet)).rejects.toMatchObject({
      reason: 'failed',
      message: 'Gateway operation rejected',
    });
    expect(await pending()).toBe('1');
    expect(
      (
        await pool.query(
          'SELECT count(*) FROM ak_gateway_messages WHERE tenant_id=$1',
          [tenantId],
        )
      ).rows[0].count,
    ).toBe('0');
    await pool.query(
      'DROP TRIGGER fictional_ack_complete_fail ON website_inquiry_ack_operations',
    );
    expect(await receive(packet)).toEqual({ status: 'applied', count: 1 });
  } finally {
    await pool.query(
      'DROP TRIGGER IF EXISTS fictional_ack_prepare_fail ON website_inquiry_ack_attempts',
    );
    await pool.query(
      'DROP TRIGGER IF EXISTS fictional_ack_complete_fail ON website_inquiry_ack_operations',
    );
    await pool.query('DROP FUNCTION fictional_ack_fail()');
  }
});
test('the persisted batch is capped at 100 and excludes newly arriving originals until its completion', async () => {
  const values = Array.from({ length: 101 }, entry);
  for (const value of values)
    await stageWebsiteInquiry(pool, tenantId, actorId, value, now);
  const job = (await prepare())!;
  expect(job.inquiryIds).toHaveLength(100);
  expect((await prepare())!.inquiryIds).toEqual(job.inquiryIds);
  expect(await receive(receipt(job.messageId, 100))).toEqual({
    status: 'applied',
    count: 100,
  });
  const next = (await prepare())!;
  expect(next.inquiryIds).toHaveLength(1);
  expect(job.inquiryIds).not.toContain(next.inquiryIds[0]);
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
  await expect(prepare()).rejects.toMatchObject({ reason: 'forbidden' });
  await expect(receive(receipt(next.messageId))).rejects.toMatchObject({
    reason: 'forbidden',
  });
});

test('damaged pending batch relationships fail closed and invalid receipt context never changes the outbox', async () => {
  await stageWebsiteInquiry(pool, tenantId, actorId, entry(), now);
  const job = (await prepare())!,
    packet = receipt(job.messageId);
  await expect(
    receiveWebsiteInquiryAcknowledgement(pool, tenantId, actorId, packet, {
      keys: [key],
      at: new Date(NaN),
    }),
  ).rejects.toMatchObject({ reason: 'invalid' });
  await expect(
    receiveWebsiteInquiryAcknowledgement(pool, tenantId, 'invalid', packet, {
      keys: [key],
      at: now,
    }),
  ).rejects.toMatchObject({ reason: 'invalid' });
  await pool.query('DELETE FROM website_inquiry_ack_items WHERE tenant_id=$1', [
    tenantId,
  ]);
  await expect(prepare()).rejects.toMatchObject({ reason: 'invalid' });
  await expect(receive(packet)).rejects.toMatchObject({ reason: 'invalid' });
  expect(await pending()).toBe('1');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
const syncOptions = () => ({
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
test('HTTPS ACK sends only a committed attempt with a fresh signature, then persists the bound receipt', async () => {
  const value = entry();
  await stageWebsiteInquiry(pool, tenantId, actorId, value, now);
  const config = syncOptions(),
    fetcher = vi.fn(async (url: unknown, options?: RequestInit) => {
      expect(url).toBe(
        'https://fictional-gateway.example.invalid/sync/v1/inquiries/ack',
      );
      expect(options).toMatchObject({
        method: 'POST',
        credentials: 'omit',
        redirect: 'error',
      });
      const packet = JSON.parse(options!.body as string),
        message = JSON.parse(packet.body);
      const { verifyGatewayMessage } =
        await import('../../packages/core/src/gateway-message.js');
      expect(
        verifyGatewayMessage(packet, {
          tenantId,
          direction: 'core-to-gateway',
          kind: 'inquiries.ack',
          keys: [config.requestKey],
          now: now.getTime() / 1000,
        })?.payload,
      ).toEqual({ inquiryIds: [value.id] });
      const persisted = (
        await pool.query(
          'SELECT operation_id FROM website_inquiry_ack_attempts WHERE tenant_id=$1 AND message_id=$2',
          [tenantId, message.messageId],
        )
      ).rows[0];
      expect(persisted.operation_id).toBe(message.operationId);
      return Response.json(receipt(message.messageId));
    });
  vi.stubGlobal('fetch', fetcher);
  expect(
    await acknowledgeWebsiteInquiries(pool, tenantId, actorId, config),
  ).toEqual({ status: 'applied', count: 1 });
  expect(await pending()).toBe('0');
  expect(
    await acknowledgeWebsiteInquiries(pool, tenantId, actorId, config),
  ).toEqual({ status: 'idle', count: 0 });
  expect(fetcher).toHaveBeenCalledTimes(1);
});
test('HTTP failures and unrelated signed receipts leave the same operation pending and retryable', async () => {
  await stageWebsiteInquiry(pool, tenantId, actorId, entry(), now);
  const config = syncOptions(),
    job = (await prepare())!;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('{}', { status: 503 })),
  );
  await expect(
    acknowledgeWebsiteInquiries(pool, tenantId, actorId, config),
  ).rejects.toMatchObject({
    reason: 'failed',
    message: 'Website inquiry unavailable',
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json(receipt(job.messageId))),
  );
  await expect(
    acknowledgeWebsiteInquiries(pool, tenantId, actorId, config),
  ).rejects.toMatchObject({ reason: 'invalid' });
  expect(await pending()).toBe('1');
  expect((await prepare())!.operationId).toBe(job.operationId);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({})),
  );
  await expect(
    acknowledgeWebsiteInquiries(pool, tenantId, actorId, config),
  ).rejects.toMatchObject({ reason: 'unauthorized' });
  expect(await pending()).toBe('1');
});
test('invalid transport configuration or unauthorized operator never opens a connection or prepares a job', async () => {
  await stageWebsiteInquiry(pool, tenantId, actorId, entry(), now);
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  const config = syncOptions();
  for (const invalid of [
    {
      ...config,
      now: () => {
        throw new Error('fictional private clock');
      },
    },
    { ...config, origin: 'http://fictional.example.invalid' },
    { ...config, responseKeys: [] },
    {
      ...config,
      requestKey: {
        ...config.requestKey,
        direction: 'gateway-to-core' as const,
      },
    },
  ])
    await expect(
      acknowledgeWebsiteInquiries(pool, tenantId, actorId, invalid),
    ).rejects.toMatchObject({ reason: 'invalid' });
  await expect(
    acknowledgeWebsiteInquiries(pool, tenantId, randomUUID(), config),
  ).rejects.toMatchObject({ reason: 'forbidden' });
  expect(fetcher).not.toHaveBeenCalled();
  expect(await pending()).toBe('0');
});
test('ACK timeout and signature expiry during transfer preserve the durable job for another attempt', async () => {
  await stageWebsiteInquiry(pool, tenantId, actorId, entry(), now);
  const config = syncOptions(),
    controller = new AbortController();
  vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
  const fetcher = vi.fn(
    async (_url: unknown, options?: RequestInit) =>
      new Promise<Response>((_resolve, reject) =>
        options!.signal!.addEventListener(
          'abort',
          () => reject(options!.signal!.reason),
          { once: true },
        ),
      ),
  );
  vi.stubGlobal('fetch', fetcher);
  const pendingSend = acknowledgeWebsiteInquiries(
    pool,
    tenantId,
    actorId,
    config,
  );
  const failure = expect(pendingSend).rejects.toMatchObject({
    reason: 'failed',
  });
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalled());
  controller.abort();
  await failure;
  vi.restoreAllMocks();
  const job = (await prepare())!;
  let clock = now;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: unknown, options?: RequestInit) => {
      const request = JSON.parse(JSON.parse(options!.body as string).body);
      clock = new Date(now.getTime() + 3601000);
      return Response.json(receipt(request.messageId));
    }),
  );
  await expect(
    acknowledgeWebsiteInquiries(pool, tenantId, actorId, {
      ...config,
      now: () => clock,
    }),
  ).rejects.toMatchObject({ reason: 'unauthorized' });
  expect((await prepare())!.operationId).toBe(job.operationId);
  expect(await pending()).toBe('1');
});

test('a contactless Option is acknowledged without inventing a contact and keeps its receipt', async () => {
  const original = entry();
  await stageWebsiteInquiry(pool, tenantId, actorId, original, now);
  const imported = await importStagedWebsiteInquiry(
    pool,
    tenantId,
    actorId,
    original.id,
    {},
  );
  expect(imported).toMatchObject({ status: 'created', contactId: null });
  const job = (await prepare())!;
  expect(job.inquiryIds).toEqual([original.id]);
  expect(await receive(receipt(job.messageId))).toEqual({
    status: 'applied',
    count: 1,
  });
  expect(await pending()).toBe('0');
  // The gateway receipt and the local Option keep the open relation untouched.
  expect(
    (
      await pool.query('SELECT count(*) FROM contacts WHERE tenant_id=$1', [
        tenantId,
      ])
    ).rows[0].count,
  ).toBe('0');
  const row = (
    await pool.query(
      'SELECT contact_id,payload FROM website_inquiries WHERE tenant_id=$1 AND id=$2',
      [tenantId, original.id],
    )
  ).rows[0];
  expect(row.contact_id).toBeNull();
  expect(row.payload).toEqual(original);
  expect(
    (
      await pool.query('SELECT count(*) FROM events WHERE tenant_id=$1', [
        tenantId,
      ])
    ).rows[0].count,
  ).toBe('1');
});
