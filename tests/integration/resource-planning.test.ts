import { afterAll, beforeAll, expect, test } from 'vitest';
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import Fastify, { type FastifyInstance } from 'fastify';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { migrate } from '../../packages/core/src/identity.js';
import { bootstrapAccess } from '../../packages/core/src/access.js';
import { bootstrapPassword } from '../../packages/core/src/password-access.js';
import { registerAuth } from '../../packages/core/src/auth.js';
import { registerResourceRoutes } from '../../packages/core/src/resources.js';

// RES-BKP-03: the planning of one resource, read for its record.
const tenantId = randomUUID(),
  otherTenant = randomUUID(),
  email = 'planning.owner@example.invalid',
  password = 'Fictional password 123!';
const config = {
  mode: 'password' as const,
  origin: 'https://admin.example.invalid',
  tenantId,
};
let container: StartedPostgreSqlContainer, pool: Pool, app: FastifyInstance;
let headers: Record<string, string>;
beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:17.6-alpine').start();
  pool = new Pool({ connectionString: container.getConnectionUri() });
  await migrate(pool);
  await bootstrapAccess(
    pool,
    tenantId,
    email,
    'Fictional tenant',
    'Europe/Berlin',
  );
  await bootstrapAccess(
    pool,
    otherTenant,
    'other.owner@example.invalid',
    'Fictional other tenant',
    'Europe/Berlin',
  );
  await bootstrapPassword(
    pool,
    tenantId,
    email,
    'fictional.planning',
    () => password,
  );
  app = Fastify();
  await registerAuth(app, pool, config);
  registerResourceRoutes(app, pool, tenantId);
  const logged = await app.inject({
    method: 'POST',
    url: '/auth/login',
    headers: { origin: config.origin },
    payload: { identifier: 'fictional.planning', password },
  });
  const cookie = logged.cookies[0]!;
  const session = {
    cookie: `${cookie.name}=${cookie.value}`,
    origin: config.origin,
  };
  const me = await app.inject({ url: '/auth/me', headers: session });
  headers = { ...session, 'x-csrf-token': me.json().csrfToken };
});
afterAll(async () => {
  await app?.close();
  await pool?.end();
  await container?.stop();
});

test('a resource lists its units and the live plans per event and period', async () => {
  const { rows: units } = await pool.query(
    `SELECT u.id, r.id AS resource_id FROM resource_units u
       JOIN resources r ON r.tenant_id=u.tenant_id AND r.id=u.resource_id
      WHERE u.tenant_id=$1 AND r.code='FB1'`,
    [tenantId],
  );
  const resourceId = units[0].resource_id as string;
  expect(
    (await app.inject({ url: `/api/v1/resources/${resourceId}/planning` }))
      .statusCode,
  ).toBe(401);
  const empty = await app.inject({
    url: `/api/v1/resources/${resourceId}/planning`,
    headers,
  });
  expect(empty.json()).toEqual({
    timeZone: 'Europe/Berlin',
    units: [{ id: units[0].id, ordinal: 1, enabled: true }],
    plans: [],
  });
  const event = randomUUID(),
    other = randomUUID();
  for (const [id, name, status] of [
    [event, 'Fictional planned wedding', 'booked'],
    [other, 'Fictional option party', 'option'],
  ])
    await pool.query(
      `INSERT INTO events(tenant_id,id,name,status,source,event_date,time_zone,description,notes_html)
       VALUES($1,$2,$3,$4,'Fictional',DATE '2031-10-31','Europe/Berlin','','')`,
      [tenantId, id, name, status],
    );
  const reserve = (eventId: string, state: string, expires: string | null) =>
    pool.query(
      `INSERT INTO reservations(tenant_id,id,request_id,request_hash,event_id,unit_id,state,period_source,base_start,base_end,time_zone,before_days,after_days,starts_at,ends_at,expires_at)
       VALUES($1,gen_random_uuid(),gen_random_uuid(),repeat('a',64),$2,$3,$4,'event','2031-10-31T16:00:00Z','2031-10-31T22:00:00Z','Europe/Berlin',0,0,'2031-10-31T16:00:00Z','2031-10-31T22:00:00Z',$5)`,
      [tenantId, eventId, units[0].id, state, expires],
    );
  await reserve(event, 'booked', null);
  // An expired hold is no plan; a live one is, but not confirmed.
  await reserve(other, 'hold', '2000-01-01T00:00:00Z');
  const planned = await app.inject({
    url: `/api/v1/resources/${resourceId}/planning`,
    headers,
  });
  expect(planned.json().plans).toEqual([
    {
      eventId: event,
      eventName: 'Fictional planned wedding',
      eventDate: '2031-10-31',
      eventStatus: 'booked',
      startsAt: '2031-10-31T16:00:00.000Z',
      endsAt: '2031-10-31T22:00:00.000Z',
      quantity: 1,
      confirmed: true,
    },
  ]);
  const missing = await app.inject({
    url: `/api/v1/resources/${randomUUID()}/planning`,
    headers,
  });
  expect(missing.statusCode).toBe(404);
});
