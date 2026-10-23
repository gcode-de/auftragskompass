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

// BKP007.2: the counters answer "how many would this option show?" over the
// whole tenant, so they must see the undated events and inquiries that the
// applied date bounds keep out of the rows. The client helper used to count the
// already filtered response rows and therefore silently reported zero.
test('the event list counters never depend on the date bounds and stay tenant scoped', async () => {
  const countsTenant = randomUUID();
  await bootstrapAccess(
    pool,
    countsTenant,
    'counts@example.invalid',
    'Synthetic counters',
    'Europe/Berlin',
  );
  await accessRepository(pool, countsTenant).issueSession(
    { subject: 'counts', email: 'counts@example.invalid' },
    digest('synthetic-counts'),
  );
  const actor = (await accessRepository(pool, countsTenant).list())[0]!.userId!;
  const repo = eventRepository(pool, countsTenant),
    types = await masterDataRepository(pool, countsTenant).list('event_type');
  const undatedInquiry = await repo.save(actor, {
      ...input,
      name: 'Synthetic counter undated inquiry',
    }),
    insideInquiry = await repo.save(actor, {
      ...input,
      name: 'Synthetic counter october inquiry',
      eventDate: '2026-10-10',
      eventTypeId: types[0]!.id,
    }),
    outsideInquiry = await repo.save(actor, {
      ...input,
      name: 'Synthetic counter december inquiry',
      eventDate: '2026-12-20',
      eventTypeId: types[1]!.id,
    }),
    undatedCancelled = await repo.save(actor, {
      ...input,
      name: 'Synthetic counter undated cancelled',
      status: 'cancelled',
    }),
    insideOption = await repo.save(actor, {
      ...input,
      name: 'Synthetic counter october option',
      status: 'option',
      eventDate: '2026-10-12',
      eventTypeId: types[0]!.id,
    });
  // A second tenant keeps an undated inquiry of its own; it counts nowhere in
  // the answer above and is never part of the aggregate.
  const foreignTenant = randomUUID();
  await bootstrapAccess(
    pool,
    foreignTenant,
    'foreign@example.invalid',
    'Synthetic foreign',
    'Europe/Berlin',
  );
  await pool.query(
    "INSERT INTO events(tenant_id,id,name,status,source,event_date,time_zone,description,notes_html) VALUES ($1::uuid,gen_random_uuid(),'Synthetic foreign undated','inquiry','Fictional counter fixture',NULL,'Europe/Berlin','Fictional counter fixture','')",
    [foreignTenant],
  );
  const config = {
    origin: 'https://admin.example.invalid',
    tenantId: countsTenant,
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
  registerEventRoutes(app, pool, countsTenant);
  const cookies = { '__Host-ak-session': 'synthetic-counts' };
  // Every statement that reads the event table is recorded, so the answer can
  // prove it costs one aggregate instead of one query per listed event.
  const statements: string[] = [],
    connect = pool.connect.bind(pool),
    query = pool.query.bind(pool);
  const record = (statement: unknown) =>
    statements.push(
      String(
        typeof statement === 'string'
          ? statement
          : ((statement as { text?: string })?.text ?? ''),
      ),
    );
  // A pooled client is handed out more than once, so it is wrapped only once.
  const wrapped = new WeakSet<PoolClient>();
  pool.connect = ((...args: unknown[]) => {
    // `pg` also offers a callback form; only the promise form is counted.
    if (typeof args[0] === 'function')
      return (connect as (...rest: unknown[]) => unknown)(...args);
    return (async () => {
      const client = await (connect as () => Promise<PoolClient>)();
      if (wrapped.has(client)) return client;
      wrapped.add(client);
      const send = client.query.bind(client) as (...sent: unknown[]) => unknown;
      Object.assign(client, {
        query: (...sent: unknown[]) => {
          record(sent[0]);
          return send(...sent);
        },
      });
      return client;
    })();
  }) as typeof pool.connect;
  pool.query = ((...args: unknown[]) => {
    record(args[0]);
    return (query as (...rest: unknown[]) => unknown)(...args);
  }) as typeof pool.query;
  try {
    const listing = await app.inject({
        url: '/api/v1/events?from=2026-10-01&to=2026-10-31',
        cookies,
      }),
      body = listing.json();
    // The rows keep the old contract: only the window is listed.
    expect(listing.statusCode).toBe(200);
    expect(body.timeZone).toBe('Europe/Berlin');
    expect(body.events.map((row: { id: string }) => row.id)).toEqual([
      insideInquiry.id,
      insideOption.id,
    ]);
    // The counters are unchanged by the window and see the whole tenant: two
    // undated events and three inquiries, one of them in December.
    expect(body.filterCounts).toEqual({ undated: 2, inquiries: 3 });
    // Additive only: the established fields still carry the whole answer.
    expect(Object.keys(body).sort()).toEqual([
      'events',
      'filterCounts',
      'timeZone',
    ]);
    // The list part is byte-identical to the established contract: the same rows
    // the repository returns, minus the internal tenant id the route strips.
    const listed = await repo.list(undefined, {
      from: '2026-10-01',
      to: '2026-10-31',
    });
    expect(body.events).toEqual(
      listed.map((entry) =>
        Object.fromEntries(
          Object.entries(entry).filter(([key]) => key !== 'tenantId'),
        ),
      ),
    );

    const counted = async (query_: string) =>
      (await app.inject({ url: '/api/v1/events?' + query_, cookies })).json();
    // The undated sort never narrows a counter.
    const undatedList = await counted('undated=true');
    expect(undatedList.filterCounts).toEqual({ undated: 2, inquiries: 3 });
    // Both undated events are listed, the inquiry and the cancelled one.
    expect(
      undatedList.events.map((row: { id: string }) => row.id).sort(),
    ).toEqual([undatedInquiry.id, undatedCancelled.id].sort());
    // Status, event type and search still narrow both counters.
    const inquiries = await counted(
      'from=2026-10-01&to=2026-10-31&status=inquiry',
    );
    expect(inquiries.events.map((row: { id: string }) => row.id)).toEqual([
      insideInquiry.id,
    ]);
    expect(inquiries.filterCounts).toEqual({ undated: 1, inquiries: 3 });
    expect((await counted('eventTypeId=' + types[0]!.id)).filterCounts).toEqual(
      {
        undated: 0,
        inquiries: 1,
      },
    );
    const searched = await counted('q=december+inquiry');
    expect(searched.events.map((row: { id: string }) => row.id)).toEqual([
      outsideInquiry.id,
    ]);
    expect(searched.filterCounts).toEqual({ undated: 0, inquiries: 1 });
    // The undated counter is not a status counter: it also answers a status
    // that no undated inquiry carries.
    const cancelled = await counted('status=cancelled');
    expect(cancelled.events.map((row: { id: string }) => row.id)).toEqual([
      undatedCancelled.id,
    ]);
    expect(cancelled.filterCounts).toEqual({ undated: 1, inquiries: 0 });

    // One aggregate beside the list, never one query per event.
    const before = statements.length;
    await app.inject({
      url: '/api/v1/events?from=2026-10-01&to=2026-10-31',
      cookies,
    });
    const reads = statements
      .slice(before)
      .filter((statement) => /from\s+"events"/i.test(statement));
    expect(reads).toHaveLength(2);
    expect(
      reads.filter((statement) => /count\(/i.test(statement)),
    ).toHaveLength(1);
  } finally {
    pool.connect = connect;
    pool.query = query;
    await app.close();
  }
  // A tenant without events sees zero counters instead of another tenant's.
  expect(
    (await eventRepository(pool, randomUUID()).listWithCounts()).filterCounts,
  ).toEqual({ undated: 0, inquiries: 0 });
  // The foreign tenant counts only its own single undated inquiry.
  expect(
    (await eventRepository(pool, foreignTenant).listWithCounts()).filterCounts,
  ).toEqual({ undated: 1, inquiries: 1 });
});
