import { resourceBlockRepository } from '../../packages/core/src/resource-blocks.js';
import { drizzle } from 'drizzle-orm/node-postgres';
import { afterAll, beforeAll, expect, test } from 'vitest';
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { migrate } from '../../packages/core/src/identity.js';
import {
  lockTenant,
  bootstrapAccess,
  accessRepository,
} from '../../packages/core/src/access.js';
import {
  eventRepository,
  registerEventRoutes,
} from '../../packages/core/src/events.js';
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
  name: 'Synthetic event',
  status: 'inquiry' as const,
  eventTypeId: null as string | null,
  packageId: null as string | null,
  locationId: null as string | null,
  primaryContactId: null as string | null,
  additionalContactIds: [] as string[],
  source: 'Manual synthetic fixture',
  eventDate: null as string | null,
  startsAt: null as string | null,
  endsAt: null as string | null,
  description: 'Fictional event',
  notesHtml: '<strong>Fictional note</strong>',
};
beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:17.6-alpine').start();
  pool = new Pool({ connectionString: container.getConnectionUri() });
  await migrate(pool);
  await bootstrapAccess(
    pool,
    tenantId,
    'events@example.invalid',
    'Synthetic events',
    'Europe/Berlin',
  );
  await accessRepository(pool, tenantId).issueSession(
    { subject: 'events', email: 'events@example.invalid' },
    digest('synthetic-events'),
  );
  actorId = (await accessRepository(pool, tenantId).list())[0]!.userId!;
});
afterAll(async () => {
  await pool?.end();
  await container?.stop();
});

import {
  reservationRepository,
  expireReservations,
} from '../../packages/core/src/reservations.js';
import {
  resourceRepository,
  registerResourceRoutes,
} from '../../packages/core/src/resources.js';
const resourceInput = {
  name: 'Synthetic reservable resource',
  code: 'SYNTH-RES',
  category: 'Fictional equipment',
  description: 'Fictional fixture',
  quantity: 2,
  beforeDays: 2,
  afterDays: 2,
  blocked: false,
  state: 'active' as const,
  position: 0,
};
let resourceId: string, unitId: string, eventId: string;
const start = new Date(Date.now() + 10 * 86400000);
start.setUTCHours(12, 0, 0, 0);
const end = new Date(start.getTime() + 7200000),
  eventInput = {
    ...input,
    eventDate: start.toISOString().slice(0, 10),
    startsAt: start.toISOString(),
    endsAt: end.toISOString(),
  };
test('physical units, independent periods, retries and event cancellation retain reservation history', async () => {
  const repo = reservationRepository(pool, tenantId),
    resources = resourceRepository(pool, tenantId),
    events = eventRepository(pool, tenantId);
  const resource = await resources.save(actorId, resourceInput);
  resourceId = resource.id;
  const units = await repo.units(resource.id);
  expect(units).toHaveLength(2);
  unitId = units[0]!.id;
  const event = await events.save(actorId, eventInput);
  eventId = event.id;
  const request = {
    requestId: randomUUID(),
    eventId: event.id,
    unitId,
    eventVersion: 1,
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
    baseStart: new Date(start.getTime() - 86400000).toISOString(),
    baseEnd: new Date(end.getTime() + 86400000).toISOString(),
  };
  const hold = await repo.createHold(actorId, request);
  expect(hold.periodSource).toBe('manual');
  expect(hold.baseStart.toISOString()).toBe(request.baseStart);
  expect(hold.beforeDays).toBe(2);
  expect(
    await repo.active(
      unitId,
      hold.endsAt,
      new Date(hold.endsAt.getTime() + 3600000),
    ),
  ).toEqual([]);
  expect(
    await repo.active(
      unitId,
      new Date(hold.startsAt.getTime() - 3600000),
      hold.startsAt,
    ),
  ).toEqual([]);
  await resources.save(
    actorId,
    { ...resourceInput, beforeDays: 7, afterDays: 7 },
    resource.id,
    1,
  );
  const retry = await repo.createHold(actorId, request);
  expect(retry.id).toBe(hold.id);
  expect(retry.startsAt).toEqual(hold.startsAt);
  expect(retry.expiresAt).toEqual(hold.expiresAt);
  await expect(
    repo.createHold(actorId, {
      ...request,
      expiresAt: new Date(Date.now() + 7200000).toISOString(),
    }),
  ).rejects.toThrow('idempotency_conflict');
  await expect(
    repo.createHold(actorId, { ...request, requestId: randomUUID() }),
  ).rejects.toThrow('reservation_exists');
  await expect(repo.createHold(randomUUID(), request)).rejects.toThrow(
    'forbidden',
  );
  await expect(
    repo.createHold(actorId, {
      ...request,
      requestId: randomUUID(),
      eventVersion: 99,
    }),
  ).rejects.toThrow('conflict');
  await expect(
    repo.createHold(actorId, {
      ...request,
      requestId: randomUUID(),
      unitId: randomUUID(),
    }),
  ).rejects.toThrow('unit_unavailable');
  await expect(
    repo.createHold(actorId, {
      ...request,
      requestId: randomUUID(),
      expiresAt: '2000-01-01T00:00:00Z',
    }),
  ).rejects.toThrow('invalid_expiry');
  await expect(
    repo.createHold(actorId, {
      ...request,
      requestId: randomUUID(),
      baseEnd: request.baseStart,
    }),
  ).rejects.toThrow('invalid_period');
  await expect(
    repo.createHold(actorId, {
      ...request,
      requestId: randomUUID(),
      expiresAt: 'bad',
    }),
  ).rejects.toThrow('invalid_expiry');
  await expect(
    repo.createHold(actorId, {
      ...request,
      requestId: randomUUID(),
      baseStart: '2000-01-01T00:00:00Z',
      baseEnd: '2000-01-02T00:00:00Z',
    }),
  ).rejects.toThrow('invalid_period');
  const moved = new Date(start.getTime() + 86400000),
    movedEnd = new Date(end.getTime() + 86400000);
  await expect(
    events.save(
      actorId,
      {
        ...eventInput,
        eventDate: moved.toISOString().slice(0, 10),
        startsAt: moved.toISOString(),
        endsAt: movedEnd.toISOString(),
      },
      event.id,
      1,
    ),
  ).rejects.toThrow('reservations_need_review');
  expect((await events.detail(event.id)).event.version).toBe(1);
  await expect(
    resources.save(actorId, { ...resourceInput, quantity: 0 }, resource.id, 2),
  ).rejects.toThrow();
  await resources.save(
    actorId,
    { ...resourceInput, quantity: 1, beforeDays: 7, afterDays: 7 },
    resource.id,
    2,
  );
  expect((await repo.units(resource.id))[0]!.id).toBe(unitId);
  expect((await repo.units(resource.id))[1]!.enabled).toBe(false);
  await pool.query(
    "UPDATE reservations SET state='booked',expires_at=NULL WHERE tenant_id=$1 AND id=$2",
    [tenantId, hold.id],
  );
  await events.save(
    actorId,
    { ...eventInput, status: 'cancelled' },
    event.id,
    1,
  );
  expect((await repo.list(event.id))[0]!.state).toBe('released');
  await resources.save(
    actorId,
    { ...resourceInput, quantity: 1, state: 'archived' },
    resource.id,
    3,
  );
  expect((await repo.units(resource.id)).every((row) => !row.enabled)).toBe(
    true,
  );
  await resources.save(actorId, resourceInput, resource.id, 4);
  expect((await repo.units(resource.id)).map((row) => row.id)).toEqual(
    units.map((row) => row.id),
  );
  expect(
    await reservationRepository(pool, randomUUID()).units(resource.id),
  ).toEqual([]);
  expect(
    await reservationRepository(pool, randomUUID()).list(event.id),
  ).toEqual([]);
  const foreign = randomUUID();
  await pool.query(
    "INSERT INTO tenants VALUES($1,'Synthetic other tenant','Europe/Berlin')",
    [foreign],
  );
  const foreignUnit = (
    await pool.query(
      'SELECT id FROM resource_units WHERE tenant_id=$1 LIMIT 1',
      [foreign],
    )
  ).rows[0].id;
  await expect(
    pool.query(
      'UPDATE reservations SET unit_id=$1 WHERE tenant_id=$2 AND id=$3',
      [foreignUnit, tenantId, hold.id],
    ),
  ).rejects.toMatchObject({ code: '23503' });
  await expect(
    pool.query('UPDATE reservations SET starts_at=ends_at WHERE tenant_id=$1', [
      tenantId,
    ]),
  ).rejects.toMatchObject({ code: '23514' });
});
test('expired holds stop counting before worker cleanup; retries never extend expiry', async () => {
  const repo = reservationRepository(pool, tenantId),
    events = eventRepository(pool, tenantId);
  const event = await events.save(actorId, {
    ...eventInput,
    name: 'Synthetic expiring event',
  });
  eventId = event.id;
  const request = {
    requestId: randomUUID(),
    eventId: event.id,
    unitId,
    eventVersion: 1,
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
  };
  const hold = await repo.createHold(actorId, request);
  expect(hold.periodSource).toBe('event');
  await pool.query(
    "UPDATE reservations SET expires_at=clock_timestamp()-interval '1 second' WHERE tenant_id=$1 AND id=$2",
    [tenantId, hold.id],
  );
  expect(await repo.active(unitId, hold.startsAt, hold.endsAt)).toEqual([]);
  expect((await repo.list(event.id))[0]!.effectiveState).toBe('expired');
  expect(
    (await repo.createHold(actorId, request)).expiresAt!.getTime(),
  ).toBeLessThan(Date.now());
  expect(
    (
      await Promise.all([expireReservations(pool), expireReservations(pool)])
    ).sort(),
  ).toEqual([0, 1]);
  expect(await expireReservations(pool)).toBe(0);
  expect(
    (
      await pool.query(
        "SELECT * FROM audit_events WHERE action='reservation.expired' AND record_id=$1",
        [hold.id],
      )
    ).rowCount,
  ).toBe(1);
  await repo.createHold(actorId, { ...request, requestId: randomUUID() });
  const noDate = await events.save(actorId, {
    ...input,
    name: 'Synthetic undated fixture',
  });
  await expect(
    repo.createHold(actorId, {
      ...request,
      requestId: randomUUID(),
      eventId: noDate.id,
    }),
  ).rejects.toThrow('invalid_period');
  await expect(
    repo.createHold(actorId, {
      ...request,
      requestId: randomUUID(),
      eventId: randomUUID(),
    }),
  ).rejects.toThrow('not_found');
  const secondUnit = (await repo.units(resourceId))[1]!;
  const permanent = await repo.createHold(actorId, {
    ...request,
    requestId: randomUUID(),
    eventId: noDate.id,
    unitId: secondUnit.id,
    expiresAt: null,
    baseStart: start.toISOString(),
    baseEnd: end.toISOString(),
  });
  expect(permanent.expiresAt).toBeNull();
  expect(await expireReservations(pool)).toBe(0);
  expect((await events.detail(noDate.id)).event.eventDate).toBeNull();
  await events.save(actorId, { ...input, status: 'unavailable' }, noDate.id, 1);
  await expect(
    repo.createHold(actorId, {
      ...request,
      requestId: randomUUID(),
      eventId: noDate.id,
      eventVersion: 2,
    }),
  ).rejects.toThrow('event_unavailable');
  expect(
    await reservationRepository(pool, randomUUID()).active(
      unitId,
      hold.startsAt,
      hold.endsAt,
    ),
  ).toEqual([]);
});
test('existing event and resource APIs fail safely when a future reservation needs review', async () => {
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
  registerEventRoutes(app, pool, tenantId);
  registerResourceRoutes(app, pool, tenantId);
  const cookies = { '__Host-ak-session': 'synthetic-events' },
    headers = {
      origin: config.origin,
      'x-csrf-token': digest('csrf:synthetic-events'),
    };
  try {
    const resource = (await resourceRepository(pool, tenantId).list()).find(
      (row) => row.id === resourceId,
    )!;
    const shrink = await app.inject({
      method: 'PUT',
      url: '/api/v1/resources/' + resourceId,
      cookies,
      headers,
      payload: { ...resourceInput, quantity: 0, version: resource.version },
    });
    expect(shrink.statusCode).toBe(409);
    expect(shrink.json().error).toBe('resource_in_use');
    const moved = new Date(start.getTime() + 86400000),
      movedEnd = new Date(end.getTime() + 86400000);
    const move = await app.inject({
      method: 'PUT',
      url: '/api/v1/events/' + eventId,
      cookies,
      headers,
      payload: {
        ...eventInput,
        eventDate: moved.toISOString().slice(0, 10),
        startsAt: moved.toISOString(),
        endsAt: movedEnd.toISOString(),
        version: 1,
      },
    });
    expect(move.statusCode).toBe(409);
    expect(move.json().error).toBe('reservations_need_review');
  } finally {
    await app.close();
  }
});

test('application and SQL triggers lock the same tenant even with uppercase UUID input', async () => {
  const synthetic = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  await drizzle(pool).transaction(async (tx) => {
    await lockTenant(tx, synthetic.toUpperCase());
    const other = await pool.connect();
    try {
      await other.query('BEGIN');
      expect(
        (
          await other.query(
            'SELECT pg_try_advisory_xact_lock(hashtextextended($1::uuid::text,814022)) AS acquired',
            [synthetic],
          )
        ).rows[0].acquired,
      ).toBe(false);
    } finally {
      await other.query('ROLLBACK');
      other.release();
    }
  });
});

async function conflictFixture() {
  const resource = await resourceRepository(pool, tenantId).save(actorId, {
    ...resourceInput,
    code: 'SYNTH-' + randomUUID().slice(0, 8).toUpperCase(),
  });
  const units = await reservationRepository(pool, tenantId).units(resource.id);
  const event = await eventRepository(pool, tenantId).save(actorId, eventInput);
  return { units, event };
}

async function insertReservation(
  client: Pick<Pool, 'query'>,
  unit: string,
  event: string | null,
  state = 'booked',
  from = start,
  to = end,
  ownerTenant = tenantId,
) {
  const id = randomUUID();
  await client.query(
    `INSERT INTO reservations(tenant_id,id,request_id,request_hash,event_id,unit_id,state,
      period_source,base_start,base_end,time_zone,before_days,after_days,starts_at,ends_at)
     VALUES($1,$2,$2,$3,$4,$5,$6,'manual',$7,$8,'Europe/Berlin',0,0,$7,$8)`,
    [ownerTenant, id, 'a'.repeat(64), event, unit, state, from, to],
  );
  return id;
}

test('confirmed bookings and maintenance blocks exclude overlap, including buffered time and historical periods', async () => {
  const { units, event } = await conflictFixture();
  const unit = units[0]!.id;
  await insertReservation(pool, unit, event.id);
  await expect(
    insertReservation(pool, unit, null, 'blocked'),
  ).rejects.toMatchObject({
    code: '23P01',
    constraint: 'reservations_no_overlap',
  });
  const otherEvent = await eventRepository(pool, tenantId).save(
    actorId,
    eventInput,
  );
  await expect(
    insertReservation(pool, unit, otherEvent.id),
  ).rejects.toMatchObject({
    code: '23P01',
  });
  // Exact half-open boundaries permit the next reservation at the previous end.
  await insertReservation(
    pool,
    unit,
    null,
    'blocked',
    end,
    new Date(end.getTime() + 3600000),
  );
  const held = await insertReservation(pool, unit, otherEvent.id, 'hold');
  await expect(
    pool.query("UPDATE reservations SET state='booked' WHERE id=$1", [held]),
  ).rejects.toMatchObject({ code: '23P01' });
  expect(
    (await pool.query('SELECT state FROM reservations WHERE id=$1', [held]))
      .rows[0].state,
  ).toBe('hold');
  for (const state of ['released', 'expired']) {
    await insertReservation(pool, unit, otherEvent.id, state);
  }
  const buffered = await insertReservation(pool, units[1]!.id, null, 'blocked');
  await pool.query(
    "UPDATE reservations SET starts_at=base_start-interval '2 days',before_days=2 WHERE id=$1",
    [buffered],
  );
  await expect(
    insertReservation(
      pool,
      units[1]!.id,
      otherEvent.id,
      'booked',
      new Date(start.getTime() - 86400000),
      start,
    ),
  ).rejects.toMatchObject({ code: '23P01' });
  const past = new Date('2000-01-01T12:00:00Z'),
    pastEnd = new Date('2000-01-01T14:00:00Z');
  await insertReservation(pool, unit, null, 'blocked', past, pastEnd);
  await expect(
    insertReservation(pool, unit, null, 'blocked', past, pastEnd),
  ).rejects.toMatchObject({ code: '23P01' });
});

test('concurrent transactions serialize the same box and retain the winner after a failed booking', async () => {
  const { units, event } = await conflictFixture();
  const otherEvent = await eventRepository(pool, tenantId).save(
    actorId,
    eventInput,
  );
  const first = await pool.connect(),
    second = await pool.connect();
  try {
    await first.query('BEGIN');
    await second.query('BEGIN');
    const winner = await insertReservation(first, units[0]!.id, event.id);
    const pid = (await second.query('SELECT pg_backend_pid() AS pid')).rows[0]
      .pid;
    const contender = insertReservation(
      second,
      units[0]!.id,
      otherEvent.id,
    ).then(
      () => null,
      (error: unknown) => error,
    );
    await expect
      .poll(
        async () =>
          (
            await pool.query(
              'SELECT cardinality(pg_blocking_pids($1)) > 0 AS waiting',
              [pid],
            )
          ).rows[0].waiting,
      )
      .toBe(true);
    await first.query('COMMIT');
    expect(await contender).toMatchObject({ code: '23P01' });
    await second.query('ROLLBACK');
    expect(
      (
        await pool.query('SELECT id FROM reservations WHERE unit_id=$1', [
          units[0]!.id,
        ])
      ).rows,
    ).toEqual([{ id: winner }]);
    // A lost transaction does not poison the connection or the other physical box.
    await insertReservation(second, units[1]!.id, otherEvent.id);
  } finally {
    await first.query('ROLLBACK');
    await second.query('ROLLBACK');
    first.release();
    second.release();
  }
});

test('rollback frees the time slot and migration restart preserves the exclusion constraint', async () => {
  const { units, event } = await conflictFixture();
  const first = await pool.connect(),
    second = await pool.connect();
  try {
    await first.query('BEGIN');
    await second.query('BEGIN');
    await insertReservation(first, units[0]!.id, null, 'blocked');
    const pid = (await second.query('SELECT pg_backend_pid() AS pid')).rows[0]
      .pid;
    const pending = insertReservation(second, units[0]!.id, event.id);
    await expect
      .poll(
        async () =>
          (
            await pool.query(
              'SELECT cardinality(pg_blocking_pids($1)) > 0 AS waiting',
              [pid],
            )
          ).rows[0].waiting,
      )
      .toBe(true);
    await first.query('ROLLBACK');
    await pending;
    await second.query('COMMIT');
  } finally {
    await first.query('ROLLBACK');
    await second.query('ROLLBACK');
    first.release();
    second.release();
  }
  await migrate(pool);
  await expect(
    insertReservation(pool, units[0]!.id, null, 'blocked'),
  ).rejects.toMatchObject({ code: '23P01' });
});

test('independent boxes and tenants can reserve identical periods; releasing a block frees the slot', async () => {
  const { units, event } = await conflictFixture();
  const first = await pool.connect(),
    second = await pool.connect();
  let block: string;
  try {
    await first.query('BEGIN');
    await second.query('BEGIN');
    block = await insertReservation(first, units[0]!.id, null, 'blocked');
    const pending = insertReservation(second, units[1]!.id, event.id);
    await first.query('COMMIT');
    await pending;
    await second.query('COMMIT');
  } finally {
    await first.query('ROLLBACK');
    await second.query('ROLLBACK');
    first.release();
    second.release();
  }
  await expect(
    insertReservation(pool, units[0]!.id, event.id),
  ).rejects.toMatchObject({ code: '23P01' });
  await pool.query("UPDATE reservations SET state='released' WHERE id=$1", [
    block,
  ]);
  await insertReservation(pool, units[0]!.id, event.id);
  const foreign = randomUUID();
  await pool.query(
    "INSERT INTO tenants VALUES($1,'Fictional concurrent tenant','Europe/Berlin')",
    [foreign],
  );
  const foreignUnit = (
    await pool.query(
      'SELECT id FROM resource_units WHERE tenant_id=$1 LIMIT 1',
      [foreign],
    )
  ).rows[0].id;
  // The same physical-unit identifier in another tenant must not collide.
  await pool.query(
    'UPDATE resource_units SET id=$1 WHERE tenant_id=$2 AND id=$3',
    [units[0]!.id, foreign, foreignUnit],
  );
  await insertReservation(
    pool,
    units[0]!.id,
    null,
    'blocked',
    start,
    end,
    foreign,
  );
});

test('manual booking assigns a box and accessories atomically; failed changes preserve the old booking', async () => {
  const resources = resourceRepository(pool, tenantId),
    events = eventRepository(pool, tenantId);
  const box = await resources.save(actorId, {
    ...resourceInput,
    code: 'SYNTH-BOOK',
    category: 'Fotobox',
  });
  const accessory = await resources.save(actorId, {
    ...resourceInput,
    code: 'SYNTH-ACC',
    category: 'Zubehör',
    quantity: 1,
    beforeDays: 0,
    afterDays: 0,
  });
  const repo = reservationRepository(pool, tenantId);
  const units = await repo.units(box.id),
    accessoryUnit = (await repo.units(accessory.id))[0]!;
  const event = await events.save(actorId, eventInput);
  const selection = [
    { unitId: units[0]!.id, periodSource: 'event' as const },
    {
      unitId: accessoryUnit.id,
      periodSource: 'manual' as const,
      baseStart: start.toISOString(),
      baseEnd: end.toISOString(),
    },
  ];
  const booked = await events.save(
    actorId,
    { ...eventInput, status: 'booked' },
    event.id,
    1,
    selection,
  );
  expect(booked.status).toBe('booked');
  expect(booked.version).toBe(2);
  expect(
    (await repo.list(event.id)).filter((row) => row.state === 'booked'),
  ).toHaveLength(2);
  const other = await events.save(actorId, eventInput);
  await expect(
    events.save(
      actorId,
      { ...eventInput, status: 'booked' },
      other.id,
      1,
      selection,
    ),
  ).rejects.toThrow('resource_conflict');
  expect((await events.detail(other.id)).event.status).toBe('inquiry');
  expect(await repo.list(other.id)).toEqual([]);
  // A conflicting box change must not drop the existing accessory assignment.
  await insertReservation(pool, units[1]!.id, null, 'blocked');
  await expect(
    events.save(actorId, { ...eventInput, status: 'booked' }, event.id, 2, [
      { unitId: units[1]!.id, periodSource: 'event' },
    ]),
  ).rejects.toThrow('resource_conflict');
  expect(
    (await repo.list(event.id))
      .filter((row) => row.state === 'booked')
      .map((row) => row.unitId)
      .sort(),
  ).toEqual(selection.map((row) => row.unitId).sort());
  expect((await events.detail(event.id)).event.version).toBe(2);
});

test('booking changes preserve buffer snapshots, history, and versions; manual and event periods move independently', async () => {
  const repo = reservationRepository(pool, tenantId),
    events = eventRepository(pool, tenantId),
    resources = resourceRepository(pool, tenantId);
  const box = await resources.save(actorId, {
    ...resourceInput,
    code: 'SYNTH-MOVE',
    category: 'Fotobox',
  });
  const units = await repo.units(box.id),
    event = await events.save(actorId, eventInput);
  const selection = [{ unitId: units[0]!.id, periodSource: 'event' as const }];
  await events.save(
    actorId,
    { ...eventInput, status: 'booked' },
    event.id,
    1,
    selection,
  );
  const original = (await repo.list(event.id))[0]!;
  await resources.save(
    actorId,
    {
      ...resourceInput,
      code: 'SYNTH-MOVE',
      category: 'Fotobox',
      beforeDays: 7,
      afterDays: 7,
    },
    box.id,
    1,
  );
  await events.save(
    actorId,
    {
      ...eventInput,
      status: 'booked',
      description: 'Fictional metadata update',
    },
    event.id,
    2,
  );
  await events.save(
    actorId,
    { ...eventInput, status: 'booked' },
    event.id,
    3,
    selection,
  );
  expect(await repo.list(event.id)).toHaveLength(1);
  expect((await repo.list(event.id))[0]!.id).toBe(original.id);
  const movedStart = new Date(start.getTime() + 20 * 86400000),
    movedEnd = new Date(end.getTime() + 20 * 86400000);
  const moved = {
    ...eventInput,
    eventDate: movedStart.toISOString().slice(0, 10),
    startsAt: movedStart.toISOString(),
    endsAt: movedEnd.toISOString(),
    status: 'booked' as const,
  };
  await insertReservation(
    pool,
    units[0]!.id,
    null,
    'blocked',
    movedStart,
    movedEnd,
  );
  await expect(
    events.save(actorId, moved, event.id, 4, selection),
  ).rejects.toThrow('resource_conflict');
  expect((await events.detail(event.id)).event.startsAt).toBe(
    eventInput.startsAt,
  );
  expect((await repo.list(event.id))[0]!.state).toBe('booked');
  await events.save(actorId, moved, event.id, 4, [
    {
      unitId: units[1]!.id,
      periodSource: 'manual',
      baseStart: original.baseStart.toISOString(),
      baseEnd: original.baseEnd.toISOString(),
    },
  ]);
  const rows = await repo.list(event.id);
  expect(rows.find((row) => row.id === original.id)!.state).toBe('released');
  const current = rows.find((row) => row.state === 'booked')!;
  expect(current.beforeDays).toBe(7); // A new physical unit uses its current defaults.
  expect(current.baseStart).toEqual(original.baseStart);
  await events.save(actorId, { ...moved, status: 'option' }, event.id, 5);
  expect(
    (await repo.list(event.id)).find((row) => row.id === current.id)!.state,
  ).toBe('hold');
  const results = await Promise.allSettled([
    events.save(actorId, { ...moved, status: 'option' }, event.id, 6, [
      { unitId: units[1]!.id, periodSource: 'event' },
    ]),
    events.save(actorId, { ...moved, status: 'option' }, event.id, 6, []),
  ]);
  expect(results.filter((row) => row.status === 'fulfilled')).toHaveLength(1);
  expect(
    (results.find((row) => row.status === 'rejected') as PromiseRejectedResult)
      .reason.message,
  ).toBe('conflict');
  expect(
    (await events.detail(event.id)).activities.some(
      (row) => row.kind === 'resources_changed',
    ),
  ).toBe(true);
});

test('assignment validation rejects duplicate, missing and unavailable units, missing periods, and accessory-only bookings', async () => {
  const repo = reservationRepository(pool, tenantId),
    events = eventRepository(pool, tenantId),
    resources = resourceRepository(pool, tenantId);
  const box = await resources.save(actorId, {
    ...resourceInput,
    code: 'SYNTH-VALIDATE',
    category: 'Fotobox',
  });
  const units = await repo.units(box.id),
    event = await events.save(actorId, eventInput);
  const assignment = { unitId: units[0]!.id, periodSource: 'event' as const };
  await expect(
    events.save(actorId, { ...eventInput, status: 'booked' }, event.id, 1, []),
  ).rejects.toThrow('booking_required');
  await expect(
    events.save(actorId, eventInput, event.id, 1, [
      assignment,
      { ...assignment, unitId: assignment.unitId.toUpperCase() },
    ]),
  ).rejects.toThrow('invalid_assignments');
  await expect(
    events.save(actorId, eventInput, event.id, 1, [
      { ...assignment, unitId: randomUUID() },
    ]),
  ).rejects.toThrow('invalid_reference');
  const undated = await events.save(actorId, input);
  await expect(
    events.save(actorId, input, undated.id, 1, [assignment]),
  ).rejects.toThrow('invalid_period');
  await expect(
    events.save(actorId, { ...eventInput, status: 'cancelled' }, event.id, 1, [
      assignment,
    ]),
  ).rejects.toThrow('event_unavailable');
  await resources.save(
    actorId,
    {
      ...resourceInput,
      code: 'SYNTH-VALIDATE',
      category: 'Fotobox',
      blocked: true,
    },
    box.id,
    1,
  );
  await expect(
    events.save(actorId, eventInput, event.id, 1, [assignment]),
  ).rejects.toThrow('unit_unavailable');
  const accessory = (await resources.list()).find(
    (row) => row.code === 'GLAMOUR',
  )!;
  await expect(
    events.save(actorId, { ...eventInput, status: 'booked' }, event.id, 1, [
      {
        unitId: (await repo.units(accessory.id))[0]!.id,
        periodSource: 'event',
      },
    ]),
  ).rejects.toThrow('booking_required');
  const past = {
    unitId: (await repo.units(accessory.id))[0]!.id,
    periodSource: 'manual' as const,
    baseStart: '2000-01-01T12:00:00Z',
    baseEnd: '2000-01-01T13:00:00Z',
  };
  await expect(
    events.save(actorId, eventInput, event.id, 1, [past]),
  ).rejects.toThrow('past_reservation');
  await expect(
    events.save(randomUUID(), eventInput, event.id, 1, []),
  ).rejects.toThrow('forbidden');
  expect(await repo.list(event.id)).toEqual([]);
  expect((await events.detail(event.id)).event.version).toBe(1);
});

test('deferred database checks protect booked events when assignments or resource categories are changed directly', async () => {
  const { units, event } = await conflictFixture();
  const unit = units[0]!.id;
  await pool.query(
    "UPDATE resources SET category='Fotobox' WHERE tenant_id=$1 AND id=$2",
    [tenantId, units[0]!.resourceId],
  );
  const reservation = await insertReservation(pool, unit, event.id);
  await pool.query(
    "UPDATE events SET status='booked' WHERE tenant_id=$1 AND id=$2",
    [tenantId, event.id],
  );
  await expect(
    pool.query("UPDATE reservations SET state='released' WHERE id=$1", [
      reservation,
    ]),
  ).rejects.toMatchObject({
    code: '23514',
    constraint: 'booked_event_requires_box',
  });
  await expect(
    pool.query(
      "UPDATE resources SET category='Zubehör' WHERE tenant_id=$1 AND id=$2",
      [tenantId, units[0]!.resourceId],
    ),
  ).rejects.toMatchObject({ constraint: 'booked_event_requires_box' });
  await expect(
    pool.query('DELETE FROM reservations WHERE id=$1', [reservation]),
  ).rejects.toMatchObject({ constraint: 'booked_event_requires_box' });
  expect(
    (await reservationRepository(pool, tenantId).list(event.id))[0]!.state,
  ).toBe('booked');
});

test('authenticated availability and assignment API validates plans, isolates tenants, and reports conflicts safely', async () => {
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
  registerEventRoutes(app, pool, tenantId);
  registerResourceRoutes(app, pool, tenantId);
  const cookies = { '__Host-ak-session': 'synthetic-events' },
    headers = {
      origin: config.origin,
      'x-csrf-token': digest('csrf:synthetic-events'),
    };
  const repo = reservationRepository(pool, tenantId),
    events = eventRepository(pool, tenantId),
    resources = resourceRepository(pool, tenantId);
  const resource = await resources.save(actorId, {
    ...resourceInput,
    code: 'SYNTH-API-BOOK',
    category: 'Fotobox',
  });
  const units = await repo.units(resource.id),
    event = await events.save(actorId, eventInput);
  const url = '/api/v1/events/' + event.id;
  const assignments = [{ unitId: units[0]!.id, periodSource: 'event' }];
  const put = (payload: Record<string, unknown>) =>
    app.inject({
      method: 'PUT',
      url,
      cookies,
      headers,
      payload: { ...eventInput, version: 1, ...payload },
    });
  try {
    expect((await app.inject({ url: url + '/availability' })).statusCode).toBe(
      401,
    );
    expect(
      (
        await app.inject({
          method: 'PUT',
          url,
          cookies,
          payload: { ...eventInput, version: 1, assignments },
        })
      ).statusCode,
    ).toBe(403);
    const response = await app.inject({ url: url + '/availability', cookies });
    expect(response.statusCode).toBe(200);
    const candidate = response
      .json()
      .find((row: { unitId: string }) => row.unitId === units[0]!.id);
    expect(candidate).toMatchObject({
      available: true,
      selected: false,
      beforeDays: 2,
      afterDays: 2,
      conflicts: [],
    });
    expect(candidate.old).toBeUndefined();
    expect(JSON.stringify(response.json())).not.toContain('requestHash');
    const query = new URLSearchParams({
      unitId: units[0]!.id,
      baseStart: start.toISOString(),
      baseEnd: end.toISOString(),
    });
    expect(
      (
        await app.inject({ url: url + '/availability?' + query, cookies })
      ).json(),
    ).toHaveLength(1);
    for (const suffix of [
      '?unitId=' + units[0]!.id,
      '?baseStart=' + encodeURIComponent(start.toISOString()),
      '?unitId=invalid',
      '?unitId=' +
        randomUUID() +
        '&baseStart=' +
        encodeURIComponent(start.toISOString()) +
        '&baseEnd=' +
        encodeURIComponent(end.toISOString()),
    ]) {
      expect(
        (await app.inject({ url: url + '/availability' + suffix, cookies }))
          .statusCode,
      ).toBe(400);
    }
    expect(
      (
        await app.inject({
          url: '/api/v1/events/' + randomUUID() + '/availability',
          cookies,
        })
      ).statusCode,
    ).toBe(404);
    expect((await put({ status: 'booked' })).statusCode).toBe(409);
    expect(
      (
        await put({
          assignments: [{ unitId: units[0]!.id, periodSource: 'manual' }],
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (await put({ assignments: [...assignments, ...assignments] })).json()
        .error,
    ).toBe('invalid_assignments');
    const hold = await repo.createHold(actorId, {
      requestId: randomUUID(),
      eventId: event.id,
      unitId: units[0]!.id,
      eventVersion: 1,
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
    });
    await pool.query(
      "UPDATE reservations SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
      [hold.id],
    );
    const booked = await put({ status: 'booked', assignments });
    expect(booked.statusCode).toBe(200);
    expect(
      (await repo.list(event.id)).find((row) => row.id === hold.id)!.state,
    ).toBe('expired');
    expect((await put({ status: 'booked', assignments })).json().error).toBe(
      'conflict',
    );
    const competitor = await events.save(actorId, eventInput);
    await events.save(
      actorId,
      { ...eventInput, status: 'option' },
      competitor.id,
      1,
      [{ unitId: units[0]!.id, periodSource: 'event' }],
    );
    const conflicts = (
      await app.inject({
        url: '/api/v1/events/' + competitor.id + '/availability',
        cookies,
      })
    )
      .json()
      .find((row: { unitId: string }) => row.unitId === units[0]!.id);
    expect(conflicts.available).toBe(false);
    expect(conflicts.conflicts[0].state).toBe('booked');
    const fail = await app.inject({
      method: 'PUT',
      url: '/api/v1/events/' + competitor.id,
      cookies,
      headers,
      payload: { ...eventInput, version: 2, status: 'booked', assignments },
    });
    expect(fail.statusCode).toBe(409);
    expect(fail.json().error).toBe('resource_conflict');
    // A different tenant's physical unit cannot be assigned through this API.
    const foreign = randomUUID();
    await pool.query(
      "INSERT INTO tenants VALUES($1,'Fictional API tenant','Europe/Berlin')",
      [foreign],
    );
    const foreignUnit = (
      await pool.query(
        'SELECT id FROM resource_units WHERE tenant_id=$1 LIMIT 1',
        [foreign],
      )
    ).rows[0].id;
    const cross = await app.inject({
      method: 'PUT',
      url,
      cookies,
      headers,
      payload: {
        ...eventInput,
        version: 2,
        status: 'booked',
        assignments: [{ unitId: foreignUnit, periodSource: 'event' }],
      },
    });
    expect(cross.statusCode).toBe(400);
    expect(cross.json().error).toBe('invalid_reference');
    const recategorize = await app.inject({
      method: 'PUT',
      url: '/api/v1/resources/' + resource.id,
      cookies,
      headers,
      payload: {
        ...resourceInput,
        code: 'SYNTH-API-BOOK',
        category: 'Zubehör',
        version: 1,
      },
    });
    expect(recategorize.statusCode).toBe(409);
    expect(recategorize.json().error).toBe('resource_in_use');
  } finally {
    await app.close();
  }
});

test('competing options remain visible and two simultaneous confirmations yield one booking', async () => {
  const resources = resourceRepository(pool, tenantId),
    events = eventRepository(pool, tenantId),
    repo = reservationRepository(pool, tenantId);
  const box = await resources.save(actorId, {
    ...resourceInput,
    code: 'SYNTH-RACE',
    category: 'Fotobox',
  });
  const unit = (await repo.units(box.id))[0]!,
    selection = [{ unitId: unit.id, periodSource: 'event' as const }];
  const first = await events.save(actorId, eventInput),
    second = await events.save(actorId, eventInput);
  await events.save(
    actorId,
    { ...eventInput, status: 'option' },
    first.id,
    1,
    selection,
  );
  await events.save(
    actorId,
    { ...eventInput, status: 'option' },
    second.id,
    1,
    selection,
  );
  expect(await repo.active(unit.id, start, end)).toHaveLength(2);
  const results = await Promise.allSettled(
    [first, second].map((event) =>
      events.save(
        actorId,
        { ...eventInput, status: 'booked' },
        event.id,
        2,
        selection,
      ),
    ),
  );
  expect(results.filter((row) => row.status === 'fulfilled')).toHaveLength(1);
  expect(
    (results.find((row) => row.status === 'rejected') as PromiseRejectedResult)
      .reason.message,
  ).toBe('resource_conflict');
  const live = await repo.active(unit.id, start, end);
  expect(live.filter((row) => row.state === 'booked')).toHaveLength(1);
  expect(live.filter((row) => row.state === 'hold')).toHaveLength(1);
  const winner = live.find((row) => row.state === 'booked')!;
  // Equivalent manual ISO timestamps retain their original reservation IDs.
  const selected = [
    {
      unitId: unit.id,
      periodSource: 'manual' as const,
      baseStart: start.toISOString(),
      baseEnd: end.toISOString(),
    },
  ];
  await events.save(
    actorId,
    { ...eventInput, status: 'booked' },
    winner.eventId!,
    3,
    selected,
  );
  const manual = (await repo.list(winner.eventId!)).find(
    (row) => row.state === 'booked',
  )!;
  await events.save(
    actorId,
    { ...eventInput, status: 'booked' },
    winner.eventId!,
    4,
    [{ ...selected[0]!, baseStart: start.toISOString().replace('.000Z', 'Z') }],
  );
  expect(
    (await repo.list(winner.eventId!)).find((row) => row.state === 'booked')!
      .id,
  ).toBe(manual.id);
});

test('maintenance blocks are idempotent, conflict with bookings, and release without deleting history', async () => {
  const repo = resourceBlockRepository(pool, tenantId),
    { units, event } = await conflictFixture();
  const input = {
    requestId: randomUUID(),
    unitId: units[0]!.id,
    startsAt: start.toISOString(),
    endsAt: end.toISOString(),
    reason: 'Fictional maintenance',
  };
  const block = await repo.create(actorId, input);
  expect(block.state).toBe('blocked');
  expect(block.reason).toBe('Fictional maintenance');
  expect((await repo.create(actorId, input)).id).toBe(block.id);
  await expect(
    repo.create(actorId, { ...input, reason: 'Fictional different reason' }),
  ).rejects.toThrow('idempotency_conflict');
  await expect(
    insertReservation(pool, units[0]!.id, event.id),
  ).rejects.toMatchObject({ code: '23P01' });
  await expect(
    repo.create(actorId, { ...input, requestId: randomUUID() }),
  ).rejects.toThrow('resource_conflict');
  const released = await repo.release(actorId, block.id);
  expect(released.state).toBe('released');
  await repo.release(actorId, block.id);
  expect((await repo.create(actorId, input)).state).toBe('released');
  await insertReservation(pool, units[0]!.id, event.id);
  expect(
    (await repo.overview()).blocks.find((row) => row.id === block.id),
  ).toMatchObject({ reason: 'Fictional maintenance', state: 'released' });
  expect(
    (
      await pool.query(
        "SELECT * FROM audit_events WHERE record_id=$1 AND action='reservation.updated'",
        [block.id],
      )
    ).rowCount,
  ).toBe(1);
});

test('maintenance validation, simultaneous creation, tenant boundaries and audit remain safe', async () => {
  const repo = resourceBlockRepository(pool, tenantId),
    resources = resourceRepository(pool, tenantId);
  const { units, event } = await conflictFixture();
  const input = {
    requestId: randomUUID(),
    unitId: units[0]!.id,
    startsAt: start.toISOString(),
    endsAt: end.toISOString(),
    reason: 'Fictional repair',
  };
  for (const values of [
    { ...input, startsAt: 'invalid' },
    { ...input, endsAt: input.startsAt },
    { ...input, reason: ' ' },
    { ...input, reason: 'x'.repeat(201) },
    {
      ...input,
      startsAt: '2000-01-01T00:00:00Z',
      endsAt: '2000-01-02T00:00:00Z',
    },
  ])
    await expect(repo.create(actorId, values)).rejects.toThrow(
      /invalid_period|invalid_reason/,
    );
  await expect(repo.create(randomUUID(), input)).rejects.toThrow('forbidden');
  await expect(repo.release(randomUUID(), randomUUID())).rejects.toThrow(
    'forbidden',
  );
  await expect(
    repo.create(actorId, { ...input, unitId: randomUUID() }),
  ).rejects.toThrow('unit_unavailable');
  await expect(repo.release(actorId, randomUUID())).rejects.toThrow(
    'not_found',
  );
  const booked = await insertReservation(pool, units[0]!.id, event.id);
  await expect(repo.release(actorId, booked)).rejects.toThrow('not_found');
  await expect(repo.create(actorId, input)).rejects.toThrow(
    'resource_conflict',
  );
  const race = await Promise.allSettled(
    [randomUUID(), randomUUID()].map((requestId) =>
      repo.create(actorId, { ...input, unitId: units[1]!.id, requestId }),
    ),
  );
  expect(race.filter((row) => row.status === 'fulfilled')).toHaveLength(1);
  expect(
    (race.find((row) => row.status === 'rejected') as PromiseRejectedResult)
      .reason.message,
  ).toBe('resource_conflict');
  const block = (
    race.find((row) => row.status === 'fulfilled') as PromiseFulfilledResult<
      Awaited<ReturnType<typeof repo.create>>
    >
  ).value;
  const foreign = randomUUID();
  await bootstrapAccess(
    pool,
    foreign,
    'blocks@example.invalid',
    'Fictional block tenant',
    'Europe/Berlin',
  );
  await accessRepository(pool, foreign).issueSession(
    { subject: 'blocks', email: 'blocks@example.invalid' },
    digest('synthetic-block-session'),
  );
  const foreignActor = (await accessRepository(pool, foreign).list())[0]!
    .userId!;
  await expect(
    resourceBlockRepository(pool, foreign).release(foreignActor, block.id),
  ).rejects.toThrow('not_found');
  const foreignUnit = (
    await pool.query(
      'SELECT id FROM resource_units WHERE tenant_id=$1 LIMIT 1',
      [foreign],
    )
  ).rows[0].id;
  await expect(
    repo.create(actorId, { ...input, unitId: foreignUnit }),
  ).rejects.toThrow('unit_unavailable');
  expect(
    (await resourceBlockRepository(pool, foreign).overview()).blocks,
  ).toEqual([]);
  const disabled = await resources.save(actorId, {
    ...resourceInput,
    code: 'SYNTH-BLOCK-DISABLED',
    state: 'inactive',
  });
  await expect(
    repo.create(actorId, {
      ...input,
      unitId: (
        await reservationRepository(pool, tenantId).units(disabled.id)
      )[0]!.id,
    }),
  ).rejects.toThrow('unit_unavailable');
  const globallyBlocked = await resources.save(actorId, {
    ...resourceInput,
    code: 'SYNTH-BLOCK-GLOBAL',
    blocked: true,
  });
  await repo.create(actorId, {
    ...input,
    unitId: (
      await reservationRepository(pool, tenantId).units(globallyBlocked.id)
    )[0]!.id,
  });
  // Reasons remain plain text and cannot be attached to customer reservations.
  await expect(
    pool.query(
      "UPDATE reservations SET block_reason='Fictional forbidden reason' WHERE id=$1",
      [booked],
    ),
  ).rejects.toMatchObject({ code: '23514' });
});

test('resource block HTTP contract requires authorization, validates fields, and retains released history', async () => {
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
  registerResourceRoutes(app, pool, tenantId);
  const cookies = { '__Host-ak-session': 'synthetic-events' },
    headers = {
      origin: config.origin,
      'x-csrf-token': digest('csrf:synthetic-events'),
    };
  const { units } = await conflictFixture();
  const input = {
    requestId: randomUUID(),
    unitId: units[0]!.id,
    startsAt: start.toISOString(),
    endsAt: end.toISOString(),
    reason: 'Fictional HTTP maintenance',
  };
  const create = (payload: Record<string, unknown>) =>
    app.inject({
      method: 'POST',
      url: '/api/v1/resource-blocks',
      cookies,
      headers,
      payload,
    });
  try {
    expect(
      (await app.inject({ url: '/api/v1/resource-blocks' })).statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/resource-blocks',
          cookies,
          payload: input,
        })
      ).statusCode,
    ).toBe(403);
    for (const values of [
      { ...input, unitId: 'invalid' },
      { ...input, reason: '' },
      { ...input, startsAt: 'invalid' },
      { ...input, reason: ' '.repeat(3) },
    ])
      expect((await create(values)).statusCode).toBe(400);
    const created = await create(input);
    expect(created.statusCode).toBe(201);
    const block = created.json();
    expect(block.reason).toBe(input.reason);
    expect(block.tenantId).toBeUndefined();
    expect(block.requestHash).toBeUndefined();
    expect(
      (await create({ ...input, reason: 'Fictional changed' })).json().error,
    ).toBe('idempotency_conflict');
    expect(
      (await create({ ...input, requestId: randomUUID() })).json().error,
    ).toBe('resource_conflict');
    expect(
      (
        await create({
          ...input,
          requestId: randomUUID(),
          unitId: randomUUID(),
        })
      ).statusCode,
    ).toBe(409);
    const missing = await app.inject({
      method: 'POST',
      url: '/api/v1/resource-blocks/' + randomUUID() + '/release',
      cookies,
      headers,
    });
    expect(missing.statusCode).toBe(404);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/resource-blocks/' + block.id + '/release',
          cookies,
          headers,
        })
      ).json().state,
    ).toBe('released');
    const listing = await app.inject({
      url: '/api/v1/resource-blocks',
      cookies,
    });
    expect(listing.statusCode).toBe(200);
    expect(
      listing.json().blocks.find((row: { id: string }) => row.id === block.id)
        .state,
    ).toBe('released');
  } finally {
    await app.close();
  }
});
