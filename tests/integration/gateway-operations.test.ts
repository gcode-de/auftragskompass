import { beforeAll, beforeEach, afterAll, expect, test } from 'vitest';
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { pgTable, uuid } from 'drizzle-orm/pg-core';
import { database, type Connection } from '../../packages/core/src/database.js';
import {
  signGatewayMessage,
  type GatewayMessage,
  type GatewayKey,
} from '../../packages/core/src/gateway-message.js';
import {
  migrateGateway,
  processGatewayOperation,
  GatewayOperationError,
} from '../../packages/core/src/gateway-operations.js';

let container: StartedPostgreSqlContainer, pool: Pool;
const tenantId = '00000000-0000-4000-8000-000000000211';
const now = 1_792_329_000;
const key: GatewayKey = {
  id: 'fictional-current',
  tenantId,
  direction: 'core-to-gateway',
  secret: Buffer.alloc(32, 41),
  notBefore: now - 1000,
  expiresAt: now + 1000,
};
const context = () => ({
  tenantId,
  direction: key.direction,
  kind: 'inquiries.ack' as const,
  keys: [key],
  now,
});
const message = (): GatewayMessage => ({
  version: 1,
  tenantId,
  messageId: randomUUID(),
  operationId: randomUUID(),
  issuedAt: now,
  kind: 'inquiries.ack',
  payload: { inquiryIds: ['fictional-inquiry'] },
});
const effects = pgTable('fictional_gateway_effects', {
  tenantId: uuid('tenant_id').notNull(),
  operationId: uuid('operation_id').notNull(),
});
async function applyEffect(connection: Connection, input: GatewayMessage) {
  await database(connection)
    .insert(effects)
    .values({ tenantId: input.tenantId, operationId: input.operationId });
  return 1;
}
async function counts() {
  const r = await pool.query(
    'SELECT (SELECT count(*)::int FROM ak_gateway_messages) AS messages, (SELECT count(*)::int FROM ak_gateway_operations) AS operations, (SELECT count(*)::int FROM fictional_gateway_effects) AS effects',
  );
  return r.rows[0];
}
beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:17.6-alpine').start();
  pool = new Pool({ connectionString: container.getConnectionUri() });
  await migrateGateway(pool);
  await pool.query(
    'CREATE TABLE fictional_gateway_effects (tenant_id uuid NOT NULL, operation_id uuid NOT NULL)',
  );
});
beforeEach(async () => {
  await pool.query(
    'TRUNCATE ak_gateway_messages, ak_gateway_operations, fictional_gateway_effects',
  );
});
afterAll(async () => {
  await pool?.end();
  await container?.stop();
});

test('gateway migrations remain minimal and repeatable with verified checksums', async () => {
  await migrateGateway(pool);
  expect(
    (
      await pool.query(
        "SELECT to_regclass('contacts') AS contacts, to_regclass('tenants') AS tenants",
      )
    ).rows[0],
  ).toEqual({ contacts: null, tenants: null });
  const original = (await pool.query('SELECT name,checksum FROM ak_migrations'))
    .rows[0]!;
  expect(original.name).toBe('gateway-0001-receipts.sql');
  try {
    await pool.query("UPDATE ak_migrations SET checksum='fictional-invalid'");
    await expect(migrateGateway(pool)).rejects.toThrow(
      'Migration checksum mismatch',
    );
  } finally {
    await pool.query('UPDATE ak_migrations SET checksum=$1 WHERE name=$2', [
      original.checksum,
      original.name,
    ]);
  }
});

test('one operation, a transport retry and replay are distinct and durable', async () => {
  const first = message(),
    packet = signGatewayMessage(first, key);
  expect(
    await processGatewayOperation(pool, packet, context(), applyEffect),
  ).toEqual({ status: 'applied', count: 1 });
  await expect(
    processGatewayOperation(pool, packet, context(), applyEffect),
  ).rejects.toMatchObject({
    reason: 'replay',
    message: 'Gateway operation rejected',
  });
  const restarted = new Pool({
    connectionString: container.getConnectionUri(),
  });
  try {
    await expect(
      processGatewayOperation(restarted, packet, context(), applyEffect),
    ).rejects.toMatchObject({ reason: 'replay' });
    expect(
      await processGatewayOperation(
        restarted,
        signGatewayMessage(
          { ...first, messageId: randomUUID(), issuedAt: now + 1 },
          key,
        ),
        { ...context(), now: now + 1 },
        applyEffect,
      ),
    ).toEqual({ status: 'duplicate', count: 1 });
  } finally {
    await restarted.end();
  }
  expect(await counts()).toEqual({ messages: 2, operations: 1, effects: 1 });
});

test('payload key order is immaterial but altered content or purpose cannot reuse an operation', async () => {
  const first = { ...message(), payload: { one: 1, two: 'fictional' } };
  await processGatewayOperation(
    pool,
    signGatewayMessage(first, key),
    context(),
    applyEffect,
  );
  expect(
    await processGatewayOperation(
      pool,
      signGatewayMessage(
        {
          ...first,
          messageId: randomUUID(),
          payload: { two: 'fictional', one: 1 },
        },
        key,
      ),
      context(),
      applyEffect,
    ),
  ).toEqual({ status: 'duplicate', count: 1 });
  for (const changed of [
    {
      ...first,
      messageId: randomUUID(),
      payload: { one: 2, two: 'fictional' },
    },
    { ...first, messageId: randomUUID(), kind: 'inquiries.pull' as const },
  ]) {
    await expect(
      processGatewayOperation(
        pool,
        signGatewayMessage(changed, key),
        { ...context(), kind: changed.kind },
        applyEffect,
      ),
    ).rejects.toMatchObject({ reason: 'conflict' });
  }
  expect(await counts()).toEqual({ messages: 2, operations: 1, effects: 1 });
});

test('concurrent deliveries serialize the effect and share its committed count', async () => {
  const first = message();
  const results = await Promise.all(
    Array.from({ length: 5 }, () =>
      processGatewayOperation(
        pool,
        signGatewayMessage({ ...first, messageId: randomUUID() }, key),
        context(),
        applyEffect,
      ),
    ),
  );
  expect(results.filter((r) => r.status === 'applied')).toHaveLength(1);
  expect(results.filter((r) => r.status === 'duplicate')).toHaveLength(4);
  expect(results.every((r) => r.count === 1)).toBe(true);
  expect(await counts()).toEqual({ messages: 5, operations: 1, effects: 1 });
});

test('the identical concurrent packet can commit once only', async () => {
  const packet = signGatewayMessage(message(), key);
  const results = await Promise.allSettled(
    Array.from({ length: 3 }, () =>
      processGatewayOperation(pool, packet, context(), applyEffect),
    ),
  );
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  for (const r of results)
    if (r.status === 'rejected')
      expect(r.reason).toMatchObject({ reason: 'replay' });
  expect(await counts()).toEqual({ messages: 1, operations: 1, effects: 1 });
});

test('callback failure rolls back effect, nonce and receipt; a safe retry can succeed', async () => {
  const packet = signGatewayMessage(message(), key);
  let caught: unknown;
  try {
    await processGatewayOperation(pool, packet, context(), async (tx, msg) => {
      await applyEffect(tx, msg);
      throw new Error('fictional.private@example.invalid');
    });
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(GatewayOperationError);
  expect(caught).toMatchObject({
    reason: 'failed',
    message: 'Gateway operation rejected',
  });
  expect(String(caught)).not.toContain('fictional.private');
  expect(await counts()).toEqual({ messages: 0, operations: 0, effects: 0 });
  expect(
    await processGatewayOperation(pool, packet, context(), applyEffect),
  ).toEqual({ status: 'applied', count: 1 });
});

test.each([-1, 101, 1.5, NaN, Infinity])(
  'invalid effect count %s rolls everything back',
  async (count) => {
    await expect(
      processGatewayOperation(
        pool,
        signGatewayMessage(message(), key),
        context(),
        async (tx, msg) => {
          await applyEffect(tx, msg);
          return count;
        },
      ),
    ).rejects.toMatchObject({ reason: 'invalid_result' });
    expect(await counts()).toEqual({ messages: 0, operations: 0, effects: 0 });
  },
);

test('invalid signature and foreign context produce no database effects', async () => {
  const packet = signGatewayMessage(message(), key);
  for (const [input, ctx] of [
    [{ ...packet, signature: 'A'.repeat(43) }, context()],
    [packet, { ...context(), tenantId: randomUUID() }],
  ] as const) {
    await expect(
      processGatewayOperation(pool, input, ctx, applyEffect),
    ).rejects.toMatchObject({ reason: 'unauthorized' });
  }
  expect(await counts()).toEqual({ messages: 0, operations: 0, effects: 0 });
});

test('the same IDs in another tenant are independent; no foreign receipt is reused', async () => {
  const first = message();
  await processGatewayOperation(
    pool,
    signGatewayMessage(first, key),
    context(),
    applyEffect,
  );
  const foreign = randomUUID(),
    foreignKey = { ...key, tenantId: foreign, secret: Buffer.alloc(32, 42) };
  expect(
    await processGatewayOperation(
      pool,
      signGatewayMessage(
        { ...first, tenantId: foreign, payload: { fictional: 'other' } },
        foreignKey,
      ),
      { ...context(), tenantId: foreign, keys: [foreignKey] },
      applyEffect,
    ),
  ).toEqual({ status: 'applied', count: 1 });
  expect(await counts()).toEqual({ messages: 2, operations: 2, effects: 2 });
});

test('SQL constraints reject invalid direction, count and digest', async () => {
  const id = randomUUID(),
    hash = '0'.repeat(64);
  for (const [direction, kind, digest, count] of [
    ['unknown', 'inquiries.ack', hash, 1],
    ['gateway-to-core', 'inquiries.ack', hash, 1],
    ['core-to-gateway', 'inquiries.ack', 'invalid', 1],
    ['core-to-gateway', 'inquiries.ack', hash, 101],
  ]) {
    await expect(
      pool.query(
        'INSERT INTO ak_gateway_operations (tenant_id,direction,operation_id,kind,payload_hash,effect_count) VALUES ($1,$2,$3,$4,$5,$6)',
        [tenantId, direction, id, kind, digest, count],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  }
});

test('database failure is neutral and does not expose connection details', async () => {
  const closed = new Pool({ connectionString: container.getConnectionUri() });
  await closed.end();
  await expect(
    processGatewayOperation(
      closed,
      signGatewayMessage(message(), key),
      context(),
      applyEffect,
    ),
  ).rejects.toMatchObject({
    reason: 'failed',
    message: 'Gateway operation rejected',
  });
});

test.each([0, 100])(
  'valid result boundary %s is cached unchanged',
  async (count) => {
    const first = message();
    const apply = async (tx: Connection, msg: GatewayMessage) => {
      await applyEffect(tx, msg);
      return count;
    };
    expect(
      await processGatewayOperation(
        pool,
        signGatewayMessage(first, key),
        context(),
        apply,
      ),
    ).toEqual({ status: 'applied', count });
    expect(
      await processGatewayOperation(
        pool,
        signGatewayMessage({ ...first, messageId: randomUUID() }, key),
        context(),
        apply,
      ),
    ).toEqual({ status: 'duplicate', count });
    expect(await counts()).toEqual({ messages: 2, operations: 1, effects: 1 });
  },
);

test('message and operation IDs are isolated by direction as well as tenant', async () => {
  const first = message();
  await processGatewayOperation(
    pool,
    signGatewayMessage(first, key),
    context(),
    applyEffect,
  );
  const reverseKey = {
    ...key,
    direction: 'gateway-to-core' as const,
    secret: Buffer.alloc(32, 43),
  };
  const reverse = { ...first, kind: 'inquiries.batch' as const };
  expect(
    await processGatewayOperation(
      pool,
      signGatewayMessage(reverse, reverseKey),
      {
        ...context(),
        direction: reverseKey.direction,
        kind: reverse.kind,
        keys: [reverseKey],
      },
      applyEffect,
    ),
  ).toEqual({ status: 'applied', count: 1 });
  expect(await counts()).toEqual({ messages: 2, operations: 2, effects: 2 });
});

test('a callback cannot rewrite verified envelope metadata after applying an effect', async () => {
  await expect(
    processGatewayOperation(
      pool,
      signGatewayMessage(message(), key),
      context(),
      async (tx, msg) => {
        await applyEffect(tx, msg);
        (msg as GatewayMessage).operationId = randomUUID();
        return 1;
      },
    ),
  ).rejects.toMatchObject({
    reason: 'failed',
    message: 'Gateway operation rejected',
  });
  expect(await counts()).toEqual({ messages: 0, operations: 0, effects: 0 });
});
