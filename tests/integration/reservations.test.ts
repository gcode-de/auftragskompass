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
