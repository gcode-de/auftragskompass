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
import { registerAuth, digest } from '../../packages/core/src/auth.js';
import { registerEventRoutes } from '../../packages/core/src/events.js';
import {
  createHealthServer,
  loadRuntimeConfig,
} from '../../packages/core/src/runtime.js';
import { syntheticGoogle } from '../helpers/oidc.js';
let container: StartedPostgreSqlContainer, pool: Pool;
const tenantId = randomUUID(),
  foreign = randomUUID();
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
beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:17.6-alpine').start();
  pool = new Pool({ connectionString: container.getConnectionUri() });
  await migrate(pool);
  await bootstrapAccess(
    pool,
    tenantId,
    'calendar@example.invalid',
    'Fictional calendar',
    'Europe/Berlin',
  );
  await accessRepository(pool, tenantId).issueSession(
    { subject: 'calendar', email: 'calendar@example.invalid' },
    digest('synthetic-calendar'),
  );
  const config = {
    origin: 'https://admin.example.invalid',
    tenantId,
    clientId: 'synthetic',
    clientSecret: 'synthetic',
  };
  await registerAuth(
    app,
    pool,
    config,
    (await syntheticGoogle(config)).provider,
  );
  registerEventRoutes(app, pool, tenantId);
  await pool.query(
    "INSERT INTO tenants VALUES($1,'Fictional foreign calendar','Europe/Berlin')",
    [foreign],
  );
  for (const owner of [tenantId, foreign])
    await pool.query(
      "INSERT INTO events(tenant_id,id,name,status,source,event_date,starts_at,ends_at,time_zone,description,notes_html) VALUES($1,$2,$3,'option','Synthetic fixture','2030-10-26','2030-10-26T20:00:00Z','2030-10-27T04:00:00Z','Europe/Berlin','','')",
      [
        owner,
        randomUUID(),
        owner === tenantId
          ? 'Fictional overnight event'
          : 'Fictional foreign event',
      ],
    );
});
afterAll(async () => {
  await app.close();
  await pool?.end();
  await container?.stop();
});
const cookies = { '__Host-ak-session': 'synthetic-calendar' };
test('calendar exposes only tenant events and uses local calendar days through DST', async () => {
  const response = await app.inject({
    url: '/api/v1/calendar?date=2030-10-27&view=day',
    cookies,
  });
  expect(response.statusCode).toBe(200);
  const data = response.json();
  expect(data.from).toBe('2030-10-27');
  expect(data.to).toBe('2030-10-27');
  expect(data.events.map((row: { name: string }) => row.name)).toEqual([
    'Fictional overnight event',
  ]);
  expect(
    Date.parse(data.days[0].endsAt) - Date.parse(data.days[0].startsAt),
  ).toBe(25 * 3600000);
  expect(data.units).toHaveLength(4);
  expect(JSON.stringify(data)).not.toContain('Fictional foreign');
  expect(
    (await app.inject({ url: '/api/v1/calendar', cookies })).statusCode,
  ).toBe(200);
  expect(
    (
      await app.inject({
        url: '/api/v1/calendar?date=2030-10-27&view=week',
        cookies,
      })
    ).json().days,
  ).toHaveLength(7);
  expect(
    (
      await app.inject({
        url: '/api/v1/calendar?date=2030-10-27&view=month',
        cookies,
      })
    ).json().days,
  ).toHaveLength(31);
  expect((await app.inject({ url: '/api/v1/calendar' })).statusCode).toBe(401);
  for (const query of [
    'date=bad',
    'date=2030-02-30',
    'view=year',
    'date=0000-01-01',
  ])
    expect(
      (await app.inject({ url: '/api/v1/calendar?' + query, cookies }))
        .statusCode,
    ).toBe(400);
});

test('resource timeline includes buffers and soft conflicts, ignores expired holds and freed blocks, and retains inactive history', async () => {
  const unit = (
    await pool.query(
      "SELECT u.id FROM resource_units u JOIN resources r ON r.tenant_id=u.tenant_id AND r.id=u.resource_id WHERE u.tenant_id=$1 AND r.code='FB1'",
      [tenantId],
    )
  ).rows[0].id;
  const event = (
    await pool.query('SELECT id FROM events WHERE tenant_id=$1', [tenantId])
  ).rows[0].id;
  const second = randomUUID();
  await pool.query(
    "INSERT INTO events(tenant_id,id,name,status,source,event_date,time_zone,description,notes_html) VALUES($1,$2,'Fictional undated event','inquiry','Synthetic',NULL,'Europe/Berlin','','')",
    [tenantId, second],
  );
  const insert = async (
    owner: string,
    eventId: string | null,
    state: string,
    from: string,
    to: string,
    expiry: string | null = null,
  ) => {
    const id = randomUUID();
    await pool.query(
      "INSERT INTO reservations(tenant_id,id,request_id,request_hash,event_id,unit_id,state,period_source,base_start,base_end,time_zone,before_days,after_days,starts_at,ends_at,expires_at) VALUES($1,$2,$2,$3,$4,$5,$6,'manual',$7,$8,'Europe/Berlin',0,0,$7,$8,$9)",
      [owner, id, 'a'.repeat(64), eventId, unit, state, from, to, expiry],
    );
    return id;
  };
  const booked = await insert(
    tenantId,
    event,
    'booked',
    '2030-10-25T10:00:00Z',
    '2030-10-27T10:00:00Z',
  );
  await pool.query(
    "UPDATE reservations SET base_start='2030-10-26T20:00:00Z',base_end='2030-10-27T04:00:00Z',before_days=1,after_days=1 WHERE id=$1",
    [booked],
  );
  await insert(
    tenantId,
    second,
    'hold',
    '2030-10-26T10:00:00Z',
    '2030-10-26T11:00:00Z',
  );
  const expired = await insert(
    tenantId,
    second,
    'expired',
    '2030-10-26T10:00:00Z',
    '2030-10-26T11:00:00Z',
  );
  await insert(
    tenantId,
    null,
    'released',
    '2030-10-26T10:00:00Z',
    '2030-10-26T11:00:00Z',
  );
  const response = await app.inject({
    url: '/api/v1/calendar?date=2030-10-26&view=day',
    cookies,
  });
  expect(response.statusCode).toBe(200);
  const data = response.json();
  expect(data.reservations).toHaveLength(2);
  expect(
    data.reservations.every((slot: { conflict: boolean }) => slot.conflict),
  ).toBe(true);
  expect(
    data.reservations.find((slot: { id: string }) => slot.id === booked),
  ).toMatchObject({
    eventName: 'Fictional overnight event',
    baseStart: '2030-10-26T20:00:00.000Z',
  });
  expect(
    data.reservations.some((slot: { id: string }) => slot.id === expired),
  ).toBe(false);
  expect(data.events).toHaveLength(1); // Undated events stay in the dedicated list.
  const historicalUnit = (
    await pool.query(
      "SELECT u.id,u.resource_id FROM resource_units u JOIN resources r ON r.tenant_id=u.tenant_id AND r.id=u.resource_id WHERE u.tenant_id=$1 AND r.code='FB2'",
      [tenantId],
    )
  ).rows[0];
  await pool.query(
    "INSERT INTO reservations(tenant_id,id,request_id,request_hash,unit_id,state,period_source,base_start,base_end,time_zone,before_days,after_days,starts_at,ends_at) VALUES($1,$2,$2,$3,$4,'blocked','manual','2000-01-01T10:00Z','2000-01-01T11:00Z','Europe/Berlin',0,0,'2000-01-01T10:00Z','2000-01-01T11:00Z')",
    [tenantId, randomUUID(), 'b'.repeat(64), historicalUnit.id],
  );
  await pool.query(
    "UPDATE resources SET state='archived' WHERE tenant_id=$1 AND id=$2",
    [tenantId, historicalUnit.resource_id],
  );
  const history = (
    await app.inject({
      url: '/api/v1/calendar?date=2000-01-01&view=day',
      cookies,
    })
  ).json();
  expect(
    history.units.find((row: { id: string }) => row.id === historicalUnit.id)
      .enabled,
  ).toBe(false);
  expect(history.reservations[0].state).toBe('blocked');
});

test('the calendar returns the effective place and never the hidden legacy address', async () => {
  const location = randomUUID(),
    replaced = randomUUID(),
    cleared = randomUUID();
  await pool.query(
    "INSERT INTO locations(tenant_id,id,name,street,postal_code,city,country,state) VALUES($1,$2,'Fictional Calendar Hall','Fictional Calendar Street','00000','Fictional Calendar Town','DE','active')",
    [tenantId, location],
  );
  for (const [id, name, venue, override] of [
    [replaced, 'Fictional replaced place', 'Fictional Terrace', true],
    [cleared, 'Fictional cleared place', '', true],
  ] as const)
    await pool.query(
      "INSERT INTO events(tenant_id,id,name,status,source,event_date,starts_at,ends_at,time_zone,description,notes_html,location_id,venue,venue_override) VALUES($1,$2,$3,'option','Synthetic fixture','2030-10-27','2030-10-27T20:00:00Z','2030-10-27T22:00:00Z','Europe/Berlin','','',$4,$5,$6)",
      [tenantId, id, name, location, venue, override],
    );
  const response = await app.inject({
      url: '/api/v1/calendar?date=2030-10-27&view=day',
      cookies,
    }),
    events = response.json().events as {
      name: string;
      location: string | null;
    }[];
  expect(
    events.find((entry) => entry.name === 'Fictional replaced place')!.location,
  ).toBe('Fictional Terrace');
  expect(
    events.find((entry) => entry.name === 'Fictional cleared place')!.location,
  ).toBeNull();
  expect(JSON.stringify(events)).not.toContain('Fictional Calendar Hall');
});
