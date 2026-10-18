import { beforeAll, beforeEach, afterAll, test, expect } from 'vitest';
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

let container: StartedPostgreSqlContainer, pool: Pool;
const tenantId = '00000000-0000-4000-8000-000000000221';
const now = new Date('2030-10-26T10:00:00.000Z');
const config = (): InquiryInboxConfig => ({
  tenantId,
  keys: [{ id: 'fictional-current', secret: Buffer.alloc(32, 51) }],
  activeKeyId: 'fictional-current',
  retentionHours: 24,
  maxStored: 10,
});
const submission = () => ({
  formId: 'fotobox-bw-main',
  formVersion: 1,
  fields: {
    firstName: 'Fictional',
    lastName: 'Example',
    email: 'fictional@example.invalid',
    eventDate: '2030-10-27',
    phone: '+49 123 456',
    location: 'Fictional venue',
    package: 'easy-print-plus',
    comment: 'Fictional private message\nSecond line',
  },
});
beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:17.6-alpine').start();
  pool = new Pool({ connectionString: container.getConnectionUri() });
  await migrateGateway(pool);
});
beforeEach(async () => {
  await pool.query('TRUNCATE ak_gateway_inquiries');
});
afterAll(async () => {
  await pool?.end();
  await container?.stop();
});
const count = async () =>
  Number(
    (await pool.query('SELECT count(*) FROM ak_gateway_inquiries')).rows[0]
      .count,
  );

test('all fields and privacy text survive encryption, with no readable personal data in the row', async () => {
  const inbox = inquiryInbox(pool, config()),
    id = randomUUID(),
    input = submission();
  expect(await inbox.receive(id, input, now)).toEqual({ status: 'received' });
  const rows = (await pool.query('SELECT * FROM ak_gateway_inquiries')).rows;
  const raw = JSON.stringify(rows);
  for (const value of [
    'fictional@example.invalid',
    'Fictional venue',
    'Fictional private message',
  ])
    expect(raw).not.toContain(value);
  const result = await inbox.pending(10, now);
  expect(result).toHaveLength(1);
  expect(result[0]).toMatchObject({
    id,
    submission: input,
    receivedAt: now.toISOString(),
    expiresAt: '2030-10-27T10:00:00.000Z',
    privacyNotice: expect.stringContaining('Datenschutzerklärung'),
  });
  expect(await inbox.pending(10, new Date('2030-10-27T10:00:00.000Z'))).toEqual(
    [],
  );
});

test('reordered payload keys are a retry, changed content conflicts, and the input is untouched', async () => {
  const inbox = inquiryInbox(pool, config()),
    id = randomUUID(),
    input = submission(),
    before = structuredClone(input);
  await inbox.receive(id, input, now);
  const reordered = {
    ...input,
    fields: Object.fromEntries(Object.entries(input.fields).reverse()),
  };
  expect(await inbox.receive(id, reordered, now)).toEqual({
    status: 'received',
  });
  await expect(
    inbox.receive(
      id,
      {
        ...input,
        fields: { ...input.fields, comment: 'Fictional changed message' },
      },
      now,
    ),
  ).rejects.toMatchObject({ reason: 'conflict' });
  expect(await count()).toBe(1);
  expect(input).toEqual(before);
});

test('concurrent identical submissions create one encrypted inquiry', async () => {
  const inbox = inquiryInbox(pool, config()),
    id = randomUUID();
  expect(
    await Promise.all(
      Array.from({ length: 5 }, () => inbox.receive(id, submission(), now)),
    ),
  ).toHaveLength(5);
  expect(await count()).toBe(1);
});

test('capacity is serialized across different IDs, including acknowledged tombstones', async () => {
  const inbox = inquiryInbox(pool, { ...config(), maxStored: 1 });
  const results = await Promise.allSettled([
    inbox.receive(randomUUID(), submission(), now),
    inbox.receive(randomUUID(), submission(), now),
  ]);
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  expect(results.filter((r) => r.status === 'rejected')[0]).toMatchObject({
    reason: { reason: 'capacity' },
  });
  const id = (await inbox.pending(1, now))[0]!.id;
  await inbox.acknowledge([id], now);
  await expect(
    inbox.receive(randomUUID(), submission(), now),
  ).rejects.toMatchObject({ reason: 'capacity' });
  expect(await inbox.receive(id, submission(), now)).toEqual({
    status: 'received',
  });
  expect(await count()).toBe(1);
});

test('acknowledgment erases encrypted personal data and retains retry protection', async () => {
  const inbox = inquiryInbox(pool, config()),
    id = randomUUID();
  await inbox.receive(id, submission(), now);
  expect(await inbox.acknowledge([id], now)).toBe(1);
  expect(await inbox.acknowledge([id], new Date(now.getTime() + 1000))).toBe(0);
  expect(await inbox.pending(10, now)).toEqual([]);
  const row = (
    await pool.query(
      'SELECT ciphertext,iv,tag,acknowledged_at FROM ak_gateway_inquiries',
    )
  ).rows[0];
  expect(row).toEqual({
    ciphertext: null,
    iv: null,
    tag: null,
    acknowledged_at: now,
  });
  expect(await inbox.receive(id, submission(), now)).toEqual({
    status: 'received',
  });
  await expect(
    inbox.receive(
      id,
      {
        ...submission(),
        fields: { ...submission().fields, comment: 'Fictional changed' },
      },
      now,
    ),
  ).rejects.toMatchObject({ reason: 'conflict' });
});

test('tenant boundaries protect reads, acknowledgments, capacity and cleanup', async () => {
  const own = inquiryInbox(pool, config()),
    foreign = inquiryInbox(pool, { ...config(), tenantId: randomUUID() }),
    id = randomUUID();
  await own.receive(id, submission(), now);
  expect(await foreign.pending(10, now)).toEqual([]);
  expect(await foreign.acknowledge([id], now)).toBe(0);
  expect(await foreign.prune(new Date('2030-10-28T10:00:00Z'))).toEqual({
    removed: 0,
    unacknowledged: 0,
  });
  await foreign.receive(id, submission(), now);
  expect(await own.pending(10, now)).toHaveLength(1);
  expect(await foreign.pending(10, now)).toHaveLength(1);
});

test('only expired own entries are explicitly pruned, freeing capacity', async () => {
  const inbox = inquiryInbox(pool, { ...config(), maxStored: 1 }),
    id = randomUUID();
  await inbox.receive(id, submission(), now);
  expect(await inbox.prune(new Date('2030-10-27T09:59:59.999Z'))).toEqual({
    removed: 0,
    unacknowledged: 0,
  });
  expect(await inbox.prune(new Date('2030-10-27T10:00:00.000Z'))).toEqual({
    removed: 1,
    unacknowledged: 1,
  });
  expect(await inbox.prune(new Date('2030-10-27T10:00:00.000Z'))).toEqual({
    removed: 0,
    unacknowledged: 0,
  });
  expect(await inbox.receive(randomUUID(), submission(), now)).toEqual({
    status: 'received',
  });
});

test('storage key rotation reads old data and checks retries with the original key', async () => {
  const first = config(),
    id = randomUUID();
  await inquiryInbox(pool, first).receive(id, submission(), now);
  const next = { id: 'fictional-next', secret: Buffer.alloc(32, 52) };
  const rotated = inquiryInbox(pool, {
    ...first,
    keys: [...first.keys, next],
    activeKeyId: next.id,
  });
  expect(await rotated.pending(10, now)).toHaveLength(1);
  expect(await rotated.receive(id, submission(), now)).toEqual({
    status: 'received',
  });
  await rotated.receive(randomUUID(), submission(), now);
  expect(await rotated.pending(10, now)).toHaveLength(2);
  const missingOld = inquiryInbox(pool, {
    ...first,
    keys: [next],
    activeKeyId: next.id,
  });
  await expect(missingOld.pending(10, now)).rejects.toMatchObject({
    reason: 'unavailable',
  });
  await expect(missingOld.receive(id, submission(), now)).rejects.toMatchObject(
    { reason: 'unavailable' },
  );
});

test('ciphertext tampering or moving it to another ID is never returned as plaintext', async () => {
  const inbox = inquiryInbox(pool, config()),
    id = randomUUID();
  await inbox.receive(id, submission(), now);
  const original = (await pool.query('SELECT * FROM ak_gateway_inquiries'))
    .rows[0];
  await pool.query(
    "UPDATE ak_gateway_inquiries SET ciphertext=(CASE WHEN left(ciphertext,1)='A' THEN 'B' ELSE 'A' END) || substring(ciphertext FROM 2)",
  );
  await expect(inbox.pending(10, now)).rejects.toMatchObject({
    reason: 'unavailable',
  });
  await expect(inbox.receive(id, submission(), now)).rejects.toMatchObject({
    reason: 'unavailable',
  });
  await pool.query('UPDATE ak_gateway_inquiries SET ciphertext=$1,id=$2', [
    original.ciphertext,
    randomUUID(),
  ]);
  await expect(inbox.pending(10, now)).rejects.toMatchObject({
    reason: 'unavailable',
  });
});

test('invalid input and method bounds produce neutral errors without storing data', async () => {
  const inbox = inquiryInbox(pool, config());
  for (const input of [
    null,
    { ...submission(), formVersion: 2 },
    {
      ...submission(),
      fields: { ...submission().fields, comment: 'Fictional\0message' },
    },
  ])
    await expect(inbox.receive(randomUUID(), input, now)).rejects.toMatchObject(
      { reason: 'invalid' },
    );
  await expect(
    inbox.receive('not-an-id', submission(), now),
  ).rejects.toMatchObject({ reason: 'invalid' });
  await expect(
    inbox.receive(randomUUID(), submission(), new Date(NaN)),
  ).rejects.toMatchObject({ reason: 'invalid' });
  for (const limit of [0, 101, 1.5])
    await expect(inbox.pending(limit, now)).rejects.toMatchObject({
      reason: 'invalid',
    });
  await expect(inbox.acknowledge(['invalid'], now)).rejects.toMatchObject({
    reason: 'invalid',
  });
  await expect(
    inbox.acknowledge(
      Array.from({ length: 101 }, () => randomUUID()),
      now,
    ),
  ).rejects.toMatchObject({ reason: 'invalid' });
  expect(await inbox.acknowledge([], now)).toBe(0);
  expect(await count()).toBe(0);
});

test('invalid configuration fails before accessing the database', () => {
  for (const change of [
    { tenantId: 'invalid' },
    { retentionHours: 0 },
    { retentionHours: 169 },
    { maxStored: 0 },
    { maxStored: 10001 },
    { activeKeyId: 'missing' },
    { keys: [] },
    { keys: [{ id: 'bad\nkey', secret: Buffer.alloc(32) }] },
    { keys: [{ id: 'fictional-current', secret: Buffer.alloc(31) }] },
  ])
    expect(() => inquiryInbox(pool, { ...config(), ...change })).toThrow(
      'Invalid inquiry inbox configuration',
    );
});

test('retention is an exact UTC duration across the spring DST change', async () => {
  const berlin = new Pool({
    connectionString: container.getConnectionUri(),
    options: '-c timezone=Europe/Berlin',
  });
  try {
    const inbox = inquiryInbox(berlin, { ...config(), retentionHours: 168 });
    await inbox.receive(
      randomUUID(),
      submission(),
      new Date('2030-03-30T10:00:00.000Z'),
    );
    expect(
      (await inbox.pending(1, new Date('2030-03-30T10:00:00.000Z')))[0]!
        .expiresAt,
    ).toBe('2030-04-06T10:00:00.000Z');
  } finally {
    await berlin.end();
  }
});

test('an expired request cannot falsely report a successful transport retry', async () => {
  const inbox = inquiryInbox(pool, config()),
    id = randomUUID();
  await inbox.receive(id, submission(), now);
  await expect(
    inbox.receive(id, submission(), new Date('2030-10-27T10:00:00.000Z')),
  ).rejects.toMatchObject({ reason: 'expired' });
  expect(await count()).toBe(1);
});

test('the storage schema permits future form identities without weakening the current input catalog', async () => {
  await pool.query(
    "INSERT INTO ak_gateway_inquiries (tenant_id,id,form_id,form_version,key_id,payload_hash,received_at,expires_at,acknowledged_at) VALUES ($1,$2,'fictional-second-form',2,'fictional-current',$3,$4,$5,$4)",
    [
      tenantId,
      randomUUID(),
      '0'.repeat(64),
      now,
      new Date(now.getTime() + 3600000),
    ],
  );
  expect(await count()).toBe(1);
});

test('the total byte limit also bounds heavily escaped but individually valid fields', async () => {
  const control = String.fromCharCode(1);
  const input = {
    ...submission(),
    fields: {
      firstName: control.repeat(99),
      lastName: control.repeat(100),
      email:
        'fictional' +
        'x'.repeat(54) +
        '@' +
        'a'.repeat(63) +
        '.' +
        'b'.repeat(63) +
        '.' +
        'c'.repeat(54) +
        '.invalid',
      eventDate: '2030-10-27',
      phone: '1'.repeat(60),
      location: control.repeat(200),
      comment: control.repeat(5000),
    },
  };
  expect(Buffer.byteLength(JSON.stringify(input))).toBeGreaterThan(32768);
  await expect(
    inquiryInbox(pool, config()).receive(randomUUID(), input, now),
  ).rejects.toMatchObject({ reason: 'invalid' });
  expect(await count()).toBe(0);
});

test('SQL constraints preserve ciphertext state, time bounds and safe metadata', async () => {
  await inquiryInbox(pool, config()).receive(randomUUID(), submission(), now);
  for (const [column, value] of [
    ['form_id', 'bad\nform'],
    ['form_version', 0],
    ['key_id', 'bad\nkey'],
    ['payload_hash', 'invalid'],
    ['expires_at', new Date(now.getTime() + 169 * 3600000)],
    ['ciphertext', null],
    ['iv', 'invalid'],
    ['tag', 'invalid'],
  ] as const)
    await expect(
      pool.query('UPDATE ak_gateway_inquiries SET ' + column + '=$1', [value]),
    ).rejects.toMatchObject({ code: '23514' });
});
