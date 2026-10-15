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
import { contactRepository } from '../../packages/core/src/contacts.js';
import { locationRepository } from '../../packages/core/src/locations.js';
import { masterDataRepository } from '../../packages/core/src/master-data.js';
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
test('events link only tenant-owned active records, preserve archived references and serialize changes', async () => {
  const repo = eventRepository(pool, tenantId),
    masters = masterDataRepository(pool, tenantId);
  const person = {
    kind: 'private' as const,
    name: 'Fictional event contact',
    contactPerson: '',
    street: '',
    postalCode: '',
    city: '',
    country: 'DE',
    email: 'event-contact@example.invalid',
    phone: '',
    mobile: '',
    state: 'active' as const,
  };
  const primary = await contactRepository(pool, tenantId).save(actorId, person),
    additional = await contactRepository(pool, tenantId).save(actorId, {
      ...person,
      name: 'Fictional additional contact',
    });
  const venue = await locationRepository(pool, tenantId).save(actorId, {
    name: 'Synthetic event venue',
    street: '',
    postalCode: '',
    city: '',
    country: 'DE',
    state: 'active',
  });
  const type = (await masters.list('event_type'))[0]!,
    pack = await masters.create(actorId, 'package', {
      name: 'Synthetic event package',
      position: 0,
      state: 'active',
    });
  Object.assign(input, {
    primaryContactId: primary.id,
    additionalContactIds: [additional.id],
    eventTypeId: type.id,
    packageId: pack.id,
    locationId: venue.id,
    eventDate: '2026-10-16',
    startsAt: '2026-10-16T18:00:00Z',
    endsAt: '2026-10-17T01:00:00Z',
  });
  const row = await repo.save(actorId, input);
  const detail = await repo.detail(row.id);
  expect(detail.contacts.map((row) => row.role).sort()).toEqual([
    'additional',
    'primary',
  ]);
  expect(detail.location!.id).toBe(venue.id);
  expect(detail.eventType!.id).toBe(type.id);
  expect(detail.package!.id).toBe(pack.id);
  expect(row.primaryContactId).toBe(primary.id);
  expect(row.additionalContactIds).toEqual([additional.id]);
  expect(row.startsAt).toBe('2026-10-16T18:00:00.000Z');
  await expect(
    pool.query(
      "UPDATE event_contacts SET role='primary' WHERE tenant_id=$1 AND role='additional'",
      [tenantId],
    ),
  ).rejects.toMatchObject({ code: '23505' });
  await expect(
    pool.query('UPDATE events SET event_type_id=$1 WHERE tenant_id=$2', [
      pack.id,
      tenantId,
    ]),
  ).rejects.toMatchObject({ code: '23503' });
  await expect(
    pool.query("UPDATE events SET status='booked' WHERE tenant_id=$1", [
      tenantId,
    ]),
  ).rejects.toMatchObject({ code: '23514' });
  expect(await eventRepository(pool, randomUUID()).list()).toEqual([]);
  expect(await repo.list(primary.id)).toHaveLength(1);
  expect(await repo.list(additional.id)).toHaveLength(1);
  expect(await repo.list(randomUUID())).toEqual([]);
  for (const bad of [
    { eventTypeId: pack.id },
    { packageId: type.id },
    { locationId: randomUUID() },
    { primaryContactId: randomUUID() },
    { additionalContactIds: [primary.id] },
    { additionalContactIds: [additional.id, additional.id] },
  ])
    await expect(repo.save(actorId, { ...input, ...bad })).rejects.toThrow(
      'invalid_reference',
    );
  await contactRepository(pool, tenantId).save(
    actorId,
    { ...person, state: 'archived' },
    primary.id,
    1,
  );
  await locationRepository(pool, tenantId).save(
    actorId,
    {
      name: venue.name,
      street: '',
      postalCode: '',
      city: '',
      country: 'DE',
      state: 'archived',
    },
    venue.id,
    1,
  );
  await masters.update(actorId, 'package', pack.id, {
    name: pack.name,
    position: 0,
    state: 'archived',
    version: 1,
  });
  await expect(repo.save(actorId, input)).rejects.toThrow('invalid_reference');
  const attempts = await Promise.allSettled([
    repo.save(actorId, { ...input, status: 'option' }, row.id, 1),
    repo.save(actorId, { ...input, status: 'cancelled' }, row.id, 1),
  ]);
  expect(attempts.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  expect(attempts.filter((r) => r.status === 'rejected')).toHaveLength(1);
  await expect(repo.save(actorId, input, row.id, 1)).rejects.toThrow(
    'conflict',
  );
  await expect(repo.save(actorId, input, randomUUID(), 1)).rejects.toThrow(
    'not_found',
  );
  await expect(repo.save(randomUUID(), input)).rejects.toThrow('forbidden');
  await expect(
    repo.save(actorId, { ...input, status: 'booked' }),
  ).rejects.toThrow('booking_required');
  await expect(
    pool.query('DELETE FROM contacts WHERE tenant_id=$1 AND id=$2', [
      tenantId,
      primary.id,
    ]),
  ).rejects.toMatchObject({ code: '23503' });
  await expect(
    pool.query('UPDATE events SET ends_at=starts_at WHERE tenant_id=$1', [
      tenantId,
    ]),
  ).rejects.toMatchObject({ code: '23514' });
});
test('event API validates schedule, prevents unauthenticated access and rolls back audit failures', async () => {
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
  const cookies = { '__Host-ak-session': 'synthetic-events' },
    headers = {
      origin: config.origin,
      'x-csrf-token': digest('csrf:synthetic-events'),
    };
  const create = (payload: unknown) =>
    app.inject({
      method: 'POST',
      url: '/api/v1/events',
      cookies,
      headers,
      payload: payload as Record<string, unknown>,
    });
  const simple = {
    ...input,
    primaryContactId: null,
    additionalContactIds: [],
    eventTypeId: null,
    packageId: null,
    locationId: null,
  };
  try {
    expect((await app.inject('/api/v1/events')).statusCode).toBe(401);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/events',
          cookies,
          payload: simple,
        })
      ).statusCode,
    ).toBe(403);
    for (const bad of [
      { name: ' ' },
      { status: 'deleted' },
      { eventDate: '2026-02-30' },
      { endsAt: null },
      { primaryContactId: 'bad' },
    ])
      expect((await create({ ...simple, ...bad })).statusCode).toBe(400);
    expect((await create({ ...simple, status: 'booked' })).statusCode).toBe(
      409,
    );
    expect(
      (await create({ ...simple, eventTypeId: randomUUID() })).statusCode,
    ).toBe(400);
    const created = await create({
      ...simple,
      notesHtml: '<script>bad()</script><p>Safe</p>',
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().notesHtml).toBe('<p>Safe</p>');
    expect(created.json()).not.toHaveProperty('tenantId');
    const listed = await app.inject({ url: '/api/v1/events', cookies });
    expect(listed.json().timeZone).toBe('Europe/Berlin');
    expect(listed.json().events).toHaveLength(2);
    const linked = (
      await eventRepository(pool, tenantId).list(input.primaryContactId!)
    )[0]!;
    const rich = (
      await app.inject({ url: '/api/v1/events/' + linked.id, cookies })
    ).json();
    expect(rich.contacts).toHaveLength(2);
    for (const record of [
      ...rich.contacts,
      rich.location,
      rich.eventType,
      rich.package,
    ])
      expect(record).not.toHaveProperty('tenantId');
    expect(
      (
        await app.inject({
          url: '/api/v1/contacts/' + input.primaryContactId + '/events',
          cookies,
        })
      ).json(),
    ).toHaveLength(1);
    const update = (id: string, version: number) =>
      app.inject({
        method: 'PUT',
        url: '/api/v1/events/' + id,
        cookies,
        headers,
        payload: { ...simple, status: 'unavailable', version },
      });
    expect((await update(created.json().id, 1)).statusCode).toBe(200);
    expect((await update(created.json().id, 1)).statusCode).toBe(409);
    expect((await update(randomUUID(), 1)).statusCode).toBe(404);
    await pool.query(
      'ALTER TABLE audit_events RENAME TO temporarily_missing_audit',
    );
    try {
      expect(
        (await create({ ...simple, name: 'Must roll back' })).statusCode,
      ).toBe(500);
    } finally {
      await pool.query(
        'ALTER TABLE temporarily_missing_audit RENAME TO audit_events',
      );
    }
    expect(
      (await eventRepository(pool, tenantId).list()).some(
        (row) => row.name === 'Must roll back',
      ),
    ).toBe(false);
  } finally {
    await app.close();
  }
});
