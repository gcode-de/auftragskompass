import { afterAll, beforeAll, expect, test } from 'vitest';
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
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
  const directory = new URL('../../packages/core/migrations/', import.meta.url);
  const earlier = await Promise.all(
    (await readdir(directory))
      .filter((name) => name.endsWith('.sql') && name < '0012_')
      .sort()
      .map(async (name) => ({
        name,
        sql: await readFile(new URL(name, directory), 'utf8'),
      })),
  );
  await migrate(pool, earlier);
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
  const legacyId = randomUUID();
  await pool.query(
    "INSERT INTO events(tenant_id,id,name,status,source,time_zone,description,notes_html) VALUES($1,$2,'Synthetic legacy event','inquiry','Fictional source','Europe/Berlin','','')",
    [tenantId, legacyId],
  );
  await pool.query(
    "INSERT INTO audit_events(tenant_id,actor_id,record_id,action) VALUES($1,$2,$3,'event.created'),($1,$2,$3,'event.updated')",
    [tenantId, actorId, legacyId],
  );
  await migrate(pool);
  const legacy = await eventRepository(pool, tenantId).detail(legacyId);
  expect(legacy.activities.map((row) => row.kind)).toEqual([
    'created',
    'updated',
  ]);
  expect(
    legacy.activities.every(
      (row) => row.eventVersion === null && row.nextStatus === null,
    ),
  ).toBe(true);
  await migrate(pool);
  expect(
    (await eventRepository(pool, tenantId).detail(legacyId)).activities,
  ).toHaveLength(2);
});
afterAll(async () => {
  await pool?.end();
  await container?.stop();
});

test('event details collect current data and immutable activities with status transitions', async () => {
  const repo = eventRepository(pool, tenantId),
    row = await repo.save(actorId, input);
  await repo.save(actorId, { ...input, status: 'option' }, row.id, 1);
  await repo.save(actorId, { ...input, status: 'cancelled' }, row.id, 2);
  await repo.save(
    actorId,
    {
      ...input,
      status: 'cancelled',
      description: 'Synthetic revised description',
    },
    row.id,
    3,
  );
  const detail = await repo.detail(row.id);
  expect(detail.event.version).toBe(4);
  expect(detail.contacts).toEqual([]);
  expect(detail.location).toBeNull();
  expect(detail.eventType).toBeNull();
  expect(detail.package).toBeNull();
  expect(detail.activities.map((row) => row.kind)).toEqual([
    'created',
    'status_changed',
    'status_changed',
    'updated',
  ]);
  expect(detail.activities.map((row) => row.eventVersion)).toEqual([
    1, 2, 3, 4,
  ]);
  expect(detail.activities[1]!.description).toBe(
    'Status von Anfrage auf Option geändert.',
  );
  expect(detail.activities[2]!.description).toBe(
    'Status von Option auf Annulliert geändert.',
  );
  expect(JSON.stringify(detail.activities)).not.toContain(
    'Synthetic revised description',
  );
  for (const statement of [
    'UPDATE event_activities SET kind=kind',
    'DELETE FROM event_activities',
    'TRUNCATE event_activities',
  ])
    await expect(pool.query(statement)).rejects.toMatchObject({
      code: '23514',
    });
  await expect(
    eventRepository(pool, randomUUID()).detail(row.id),
  ).rejects.toThrow('not_found');
  await expect(repo.detail(randomUUID())).rejects.toThrow('not_found');
});
test('detail API requires auth, returns safe errors and rolls back when activity persistence fails', async () => {
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
  try {
    const row = (await eventRepository(pool, tenantId).list())[0]!;
    expect((await app.inject('/api/v1/events/' + row.id)).statusCode).toBe(401);
    const detail = await app.inject({
      url: '/api/v1/events/' + row.id,
      cookies,
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().event).not.toHaveProperty('tenantId');
    expect(detail.json().activities[0]).not.toHaveProperty('tenantId');
    expect(
      (await app.inject({ url: '/api/v1/events/' + randomUUID(), cookies }))
        .statusCode,
    ).toBe(404);
    expect(
      (await app.inject({ url: '/api/v1/events/invalid', cookies })).statusCode,
    ).toBe(400);
    const before = (await pool.query('SELECT count(*) FROM audit_events'))
      .rows[0].count;
    await pool.query(
      'ALTER TABLE event_activities RENAME TO temporarily_missing_activities',
    );
    try {
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/api/v1/events',
            cookies,
            headers,
            payload: { ...input, name: 'Must roll back' },
          })
        ).statusCode,
      ).toBe(500);
    } finally {
      await pool.query(
        'ALTER TABLE temporarily_missing_activities RENAME TO event_activities',
      );
    }
    expect(
      (await eventRepository(pool, tenantId).list()).some(
        (row) => row.name === 'Must roll back',
      ),
    ).toBe(false);
    expect(
      (await pool.query('SELECT count(*) FROM audit_events')).rows[0].count,
    ).toBe(before);
  } finally {
    await app.close();
  }
});
