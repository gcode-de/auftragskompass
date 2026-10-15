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
import {
  contactRepository,
  registerContactRoutes,
} from '../../packages/core/src/contacts.js';
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
test('event search combines date ranges, status, type, contacts and locations with literal search', async () => {
  const repo = eventRepository(pool, tenantId),
    masters = masterDataRepository(pool, tenantId),
    types = await masters.list('event_type');
  const person = await contactRepository(pool, tenantId).save(actorId, {
    kind: 'company',
    name: 'Fictional Search Company',
    contactPerson: 'Fictional Search Person',
    street: '',
    postalCode: '',
    city: '',
    country: 'DE',
    email: 'search@example.invalid',
    phone: '',
    mobile: '',
    state: 'active',
  });
  const venue = await locationRepository(pool, tenantId).save(actorId, {
    name: 'Synthetic Search Venue',
    street: '',
    postalCode: '',
    city: 'Fictional Search City',
    country: 'DE',
    state: 'active',
  });
  const early = await repo.save(actorId, {
    ...input,
    name: 'Synthetic early',
    eventDate: '2026-10-10',
    eventTypeId: types[0]!.id,
    primaryContactId: person.id,
    locationId: venue.id,
  });
  const multi = await repo.save(actorId, {
    ...input,
    name: 'Synthetic multiday',
    status: 'option',
    eventDate: '2026-10-12',
    startsAt: '2026-10-12T18:00:00Z',
    endsAt: '2026-10-15T22:00:00Z',
    eventTypeId: types[0]!.id,
  });
  const late = await repo.save(actorId, {
    ...input,
    name: 'Synthetic late',
    status: 'cancelled',
    eventDate: '2026-10-20',
    eventTypeId: types[1]!.id,
  });
  const undated = await repo.save(actorId, {
    ...input,
    name: 'Synthetic undated',
  });
  expect((await repo.list()).map((row) => row.id)).toEqual([
    early.id,
    multi.id,
    late.id,
    undated.id,
  ]);
  for (const q of [
    'early',
    'Search Company',
    'Search Person',
    'search@example.invalid',
    'Search Venue',
    'Search City',
  ])
    expect((await repo.list(undefined, { q })).map((row) => row.id)).toEqual([
      early.id,
    ]);
  for (const q of ['%', "%' OR 1=1--", 'absent'])
    expect(await repo.list(undefined, { q })).toEqual([]);
  expect(
    (
      await repo.list(undefined, {
        from: '2026-10-14',
        to: '2026-10-15',
        status: 'option',
        eventTypeId: types[0]!.id,
      })
    ).map((row) => row.id),
  ).toEqual([multi.id]);
  expect(
    await repo.list(undefined, { from: '2026-10-16', to: '2026-10-19' }),
  ).toEqual([]);
  expect(
    (await repo.list(undefined, { undated: true, status: 'inquiry' })).map(
      (row) => row.id,
    ),
  ).toEqual([undated.id]);
  expect(
    (await repo.list(undefined, { to: '2026-10-10' })).map((row) => row.id),
  ).toEqual([early.id]);
  expect(
    (await repo.list(undefined, { from: '2026-10-20' })).map((row) => row.id),
  ).toEqual([late.id]);
  for (const filters of [
    { from: '2026-02-30' },
    { from: '2026-10-20', to: '2026-10-10' },
    { undated: true, from: '2026-10-10' },
  ])
    await expect(repo.list(undefined, filters)).rejects.toThrow(
      'invalid_filters',
    );
  expect(
    await eventRepository(pool, randomUUID()).list(undefined, {
      q: 'Search Company',
    }),
  ).toEqual([]);
});
test('event filter API rejects invalid combinations and keeps URL values tenant scoped', async () => {
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
  registerContactRoutes(app, pool, tenantId);
  const cookies = { '__Host-ak-session': 'synthetic-events' };
  try {
    expect(
      (
        await app.inject({
          url: '/api/v1/events?undated=true&status=inquiry',
          cookies,
        })
      ).json().events,
    ).toHaveLength(1);
    for (const query of [
      'from=2026-02-30',
      'from=2026-10-20&to=2026-10-10',
      'undated=true&to=2026-10-10',
      'status=unknown',
      'eventTypeId=bad',
      'undated=yes',
    ])
      expect(
        (await app.inject({ url: '/api/v1/events?' + query, cookies }))
          .statusCode,
      ).toBe(400);
    await pool.query(
      "INSERT INTO events(tenant_id,id,name,status,source,event_date,time_zone,description,notes_html) SELECT $1::uuid,gen_random_uuid(),'Synthetic bulk event '||n,'inquiry','Fictional load fixture',DATE '2026-12-01'+(n%28),'Europe/Berlin','Fictional load fixture','' FROM generate_series(1,500) AS n",
      [tenantId],
    );
    await pool.query(
      "INSERT INTO contacts(tenant_id,id,kind,name,contact_person,street,postal_code,city,country,email,phone,mobile,phone_key,mobile_key,state) SELECT $1::uuid,gen_random_uuid(),'private','Synthetic bulk contact '||n,'','','','','DE','','','','','','active' FROM generate_series(1,500) AS n",
      [tenantId],
    );
    const started = performance.now(),
      [events, contacts] = await Promise.all([
        app.inject({ url: '/api/v1/events?q=Synthetic+bulk', cookies }),
        app.inject({ url: '/api/v1/contacts?q=Synthetic+bulk', cookies }),
      ]);
    expect(events.json().events).toHaveLength(500);
    expect(contacts.json()).toHaveLength(500);
    expect(performance.now() - started).toBeLessThan(2000);
  } finally {
    await app.close();
  }
});
