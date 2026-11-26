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
import { eventRepository } from '../../packages/core/src/events.js';
import {
  calendarFeedRepository,
  registerCalendarFeedRoutes,
} from '../../packages/core/src/calendar-feeds.js';
import {
  createHealthServer,
  loadRuntimeConfig,
} from '../../packages/core/src/runtime.js';
let container: StartedPostgreSqlContainer, pool: Pool;
const tenant = randomUUID(),
  foreign = randomUUID(),
  event = randomUUID(),
  otherEvent = randomUUID(),
  location = randomUUID(),
  cookie = 'fictional-feed-session',
  origin = 'https://admin.example.invalid';
const app = createHealthServer(
  loadRuntimeConfig(
    {
      AK_DB_HOST: 'synthetic',
      AK_DB_NAME: 'synthetic',
      AK_DB_USER: 'synthetic',
      AK_DB_PASSWORD_FILE: 'synthetic',
      AK_LOG_LEVEL: 'silent',
    },
    () => 'synthetic-long-password',
  ),
  { database: async () => true, worker: async () => true },
);
const cookies = { '__Host-ak-session': cookie },
  headers = { origin, 'x-csrf-token': digest('csrf:' + cookie) },
  tls = { 'x-forwarded-proto': 'https' };
const input = {
  resourceId: null as string | null,
  description: false,
  eventType: false,
  internalLink: false,
  // These cases follow one event through cancellation, so they carry every
  // status; the defaults have their own case below.
  statuses: ['inquiry', 'option', 'booked', 'unavailable', 'cancelled'],
};
let actor: string, resource: string, unit: string, foreignResource: string;
beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:17.6-alpine').start();
  pool = new Pool({ connectionString: container.getConnectionUri() });
  await migrate(pool);
  for (const t of [tenant, foreign]) {
    await bootstrapAccess(
      pool,
      t,
      'fictional.calendar@example.invalid',
      'Fictional calendar',
      'Europe/Berlin',
    );
    await accessRepository(pool, t).issueSession(
      {
        subject: 'fictional-feed',
        email: 'fictional.calendar@example.invalid',
      },
      digest(cookie + t),
    );
  }
  actor = (
    await pool.query('SELECT id FROM users WHERE tenant_id=$1', [tenant])
  ).rows[0].id;
  await accessRepository(pool, tenant).grant(
    actor,
    'fictional.backup@example.invalid',
  );
  await accessRepository(pool, tenant).issueSession(
    { subject: 'fictional-backup', email: 'fictional.backup@example.invalid' },
    digest('fictional-backup-session'),
  );
  await pool.query(
    "INSERT INTO sessions(tenant_id,user_id,token_hash,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",
    [tenant, actor, digest(cookie)],
  );
  await registerAuth(app, pool, { mode: 'password', origin, tenantId: tenant });
  registerCalendarFeedRoutes(app, pool, tenant, origin);
  const r = await pool.query(
    "SELECT r.id,u.id AS unit FROM resources r JOIN resource_units u ON u.tenant_id=r.tenant_id AND u.resource_id=r.id WHERE r.tenant_id=$1 AND r.code='FB1'",
    [tenant],
  );
  resource = r.rows[0].id;
  unit = r.rows[0].unit;
  foreignResource = (
    await pool.query('SELECT id FROM resources WHERE tenant_id=$1 LIMIT 1', [
      foreign,
    ])
  ).rows[0].id;
  await pool.query(
    "INSERT INTO locations(tenant_id,id,name,street,postal_code,city,country,state) VALUES($1,$2,'Fictional hall','Fictional street','00000','Fictional town','DE','active')",
    [tenant, location],
  );
  for (const [t, id, name] of [
    [tenant, event, 'Fictional event'],
    [tenant, otherEvent, 'Fictional unassigned'],
    [foreign, randomUUID(), 'Fictional foreign event'],
  ])
    await pool.query(
      "INSERT INTO events(tenant_id,id,name,status,source,event_date,starts_at,ends_at,time_zone,description,notes_html,location_id) VALUES($1,$2,$3,'option','Fictional source','2030-10-27','2030-10-27T00:00Z','2030-10-27T03:00Z','Europe/Berlin','Fictional optional description','NEVER_EXPORT_INTERNAL_NOTE',$4)",
      [t, id, name, t === tenant ? location : null],
    );
  await pool.query(
    "INSERT INTO reservations(tenant_id,id,request_id,request_hash,event_id,unit_id,state,period_source,base_start,base_end,time_zone,before_days,after_days,starts_at,ends_at) VALUES($1,$2,$2,$3,$4,$5,'hold','event','2030-10-27T00:00Z','2030-10-27T03:00Z','Europe/Berlin',0,0,'2030-10-27T00:00Z','2030-10-27T03:00Z')",
    [tenant, randomUUID(), 'a'.repeat(64), event, unit],
  );
});
afterAll(async () => {
  await app.close();
  await pool?.end();
  await container?.stop();
});
const create = (data = input) =>
  app.inject({
    method: 'POST',
    url: '/api/v1/calendar-feeds',
    cookies,
    headers,
    payload: data,
  });
const feed = (url: string) =>
  app.inject({ url: new URL(url).pathname, headers: tls });
test('protected management, validation, scoped metadata and hashed, expiring bearer links', async () => {
  expect((await app.inject({ url: '/api/v1/calendar-feeds' })).statusCode).toBe(
    401,
  );
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/api/v1/calendar-feeds',
        cookies,
        payload: input,
      })
    ).statusCode,
  ).toBe(403);
  expect(
    (await create({ ...input, resourceId: foreignResource })).statusCode,
  ).toBe(404);
  expect((await create({ ...input, resourceId: 'bad' })).statusCode).toBe(400);
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/api/v1/calendar-feeds',
        cookies,
        headers,
        payload: { resourceId: null },
      })
    ).statusCode,
  ).toBe(400);
  const response = await create();
  expect(response.statusCode).toBe(201);
  const saved = response.json();
  expect(saved.url).toMatch(
    /^https:\/\/admin\.example\.invalid\/feeds\/v1\/[A-Za-z0-9_-]{43}\.ics$/,
  );
  const token = saved.url.split('/').at(-1).slice(0, -4);
  const row = (
    await pool.query(
      'SELECT * FROM calendar_feeds WHERE tenant_id=$1 AND id=$2',
      [tenant, saved.id],
    )
  ).rows[0];
  expect(row.token_hash).toBe(digest(token));
  expect(JSON.stringify(row)).not.toContain(token);
  const list = await app.inject({ url: '/api/v1/calendar-feeds', cookies });
  expect(list.statusCode).toBe(200);
  expect(list.body).not.toContain(token);
  expect(list.body).not.toContain('tokenHash');
  expect(list.body).not.toContain(actor);
  expect(
    (await app.inject({ url: new URL(saved.url).pathname })).statusCode,
  ).toBe(403);
  const out = await feed(saved.url);
  expect(out.statusCode).toBe(200);
  expect(out.headers['content-type']).toBe('text/calendar; charset=utf-8');
  expect(out.headers['cache-control']).toBe('no-store');
  expect(out.body).toContain('Fictional event');
  expect(out.body).toContain('Fictional unassigned');
  expect(out.body).toContain('Fictional hall');
  expect(out.body).toContain('FB1 #1');
  expect(out.body).not.toContain('Fictional foreign');
  expect(out.body).not.toContain('NEVER_EXPORT');
  expect(out.body).not.toContain('Fictional optional');
  expect(out.body).not.toContain('@example.invalid');
  for (const tokenValue of ['bad', 'a'.repeat(43)])
    expect(
      (await feed(origin + '/feeds/v1/' + tokenValue + '.ics')).statusCode,
    ).toBe(404);
  await pool.query(
    "UPDATE calendar_feeds SET created_at=now()-interval '2 years',expires_at=now()-interval '1 year' WHERE id=$1",
    [saved.id],
  );
  // Feeds no longer expire: a legacy row with a past date keeps working until deleted.
  expect((await feed(saved.url)).statusCode).toBe(200);
  expect(
    (await app.inject({ url: '/api/v1/calendar-feeds', cookies })).json(),
  ).toHaveLength(1);
});
test('resource scope, stable UIDs, increasing sequence for updates, cancellations and renamed lookups', async () => {
  const saved = (
    await create({
      ...input,
      resourceId: resource,
      description: true,
      eventType: true,
      internalLink: true,
    })
  ).json();
  const original = (await feed(saved.url)).body.replace(/\r\n /g, '');
  expect(original).not.toContain('Fictional unassigned');
  expect(original).toContain('Fictional optional description');
  expect(original).toContain('URL:' + origin + '/#event-' + event);
  expect(original).toContain('Eventart: Offen');
  const seq = (text: string) => Number(text.match(/SEQUENCE:(\d+)/)![1]),
    uid = (text: string) => text.match(/UID:([^\r]+)/)![1];
  await pool.query(
    "UPDATE locations SET name='Fictional renamed hall' WHERE tenant_id=$1 AND id=$2",
    [tenant, location],
  );
  const renamed = (await feed(saved.url)).body.replace(/\r\n /g, '');
  expect(renamed).toContain('Fictional renamed hall');
  expect(seq(renamed)).toBeGreaterThan(seq(original));
  await pool.query(
    "UPDATE events SET name='Fictional changed event',version=version+1,status='cancelled' WHERE tenant_id=$1 AND id=$2",
    [tenant, event],
  );
  await pool.query(
    "UPDATE reservations SET state='released' WHERE tenant_id=$1 AND event_id=$2",
    [tenant, event],
  );
  const cancelled = (await feed(saved.url)).body.replace(/\r\n /g, '');
  expect(cancelled).toContain('STATUS:CANCELLED');
  expect(cancelled).toContain('Fictional changed event');
  expect(uid(cancelled)).toBe(uid(original));
  expect(seq(cancelled)).toBeGreaterThan(seq(renamed));
  const revision = (
    await pool.query(
      'SELECT revision FROM calendar_revisions WHERE tenant_id=$1',
      [tenant],
    )
  ).rows[0].revision;
  const transaction = await pool.connect();
  await transaction.query('BEGIN');
  await transaction.query(
    "UPDATE events SET name='Fictional rolled back' WHERE tenant_id=$1 AND id=$2",
    [tenant, event],
  );
  await transaction.query('ROLLBACK');
  transaction.release();
  expect(
    (
      await pool.query(
        'SELECT revision FROM calendar_revisions WHERE tenant_id=$1',
        [tenant],
      )
    ).rows[0].revision,
  ).toBe(revision);
  const other = calendarFeedRepository(pool, foreign, origin);
  const foreignActor = (
    await pool.query('SELECT id FROM users WHERE tenant_id=$1', [foreign])
  ).rows[0].id;
  const foreignFeed = await other.save(foreignActor, input);
  expect((await feed(foreignFeed.url)).statusCode).toBe(404);
  await expect(other.save(actor, input)).rejects.toThrow('forbidden');
  await expect(other.revoke(foreignActor, saved.id)).rejects.toThrow(
    'not_found',
  );
});
test('rotation and revocation are atomic, owner access is checked on every fetch and audit failure rolls back', async () => {
  const saved = (await create()).json();
  expect(
    (
      await app.inject({
        method: 'PUT',
        url: '/api/v1/calendar-feeds/' + randomUUID(),
        cookies,
        headers,
        payload: input,
      })
    ).statusCode,
  ).toBe(404);
  const previousSequence = Number(
    (await feed(saved.url)).body.match(/SEQUENCE:(\d+)/)![1],
  );
  const rotated = await app.inject({
    method: 'PUT',
    url: '/api/v1/calendar-feeds/' + saved.id,
    cookies,
    headers,
    payload: { ...input, description: true },
  });
  expect(rotated.statusCode).toBe(200);
  const current = rotated.json();
  expect(current.id).toBe(saved.id);
  const currentFeed = (await feed(current.url)).body;
  expect(currentFeed).toContain('Fictional optional description');
  expect(Number(currentFeed.match(/SEQUENCE:(\d+)/)![1])).toBeGreaterThan(
    previousSequence,
  );
  expect((await feed(saved.url)).statusCode).toBe(404);
  expect((await feed(current.url)).statusCode).toBe(200);
  await pool.query(
    'UPDATE memberships SET active=false WHERE tenant_id=$1 AND user_id=$2',
    [tenant, actor],
  );
  expect((await feed(current.url)).statusCode).toBe(404);
  await expect(
    calendarFeedRepository(pool, tenant, origin).revoke(actor, saved.id),
  ).rejects.toThrow('forbidden');
  await pool.query('UPDATE memberships SET active=true WHERE tenant_id=$1', [
    tenant,
  ]);
  await pool.query(
    'UPDATE allowed_accounts SET active=false WHERE tenant_id=$1 AND user_id=$2',
    [tenant, actor],
  );
  expect((await feed(current.url)).statusCode).toBe(404);
  await pool.query(
    'UPDATE allowed_accounts SET active=true WHERE tenant_id=$1 AND user_id=$2',
    [tenant, actor],
  );
  await pool.query('ALTER TABLE audit_events RENAME TO unavailable_feed_audit');
  try {
    const failed = await app.inject({
      method: 'DELETE',
      url: '/api/v1/calendar-feeds/' + saved.id,
      cookies,
      headers,
    });
    expect(failed.statusCode).toBe(500);
  } finally {
    await pool.query(
      'ALTER TABLE unavailable_feed_audit RENAME TO audit_events',
    );
  }
  expect((await feed(current.url)).statusCode).toBe(200);
  expect(
    (
      await app.inject({
        method: 'DELETE',
        url: '/api/v1/calendar-feeds/' + saved.id,
        cookies,
        headers,
      })
    ).statusCode,
  ).toBe(204);
  expect((await feed(current.url)).statusCode).toBe(404);
  expect(
    (
      await app.inject({
        method: 'DELETE',
        url: '/api/v1/calendar-feeds/' + saved.id,
        cookies,
        headers,
      })
    ).statusCode,
  ).toBe(404);
  const actions = (
    await pool.query(
      "SELECT action FROM audit_events WHERE tenant_id=$1 AND action LIKE 'feed.%'",
      [tenant],
    )
  ).rows.map((row) => row.action);
  expect(actions).toContain('feed.created');
  expect(actions).toContain('feed.rotated');
  expect(actions).toContain('feed.revoked');
});
test('database keys reject cross-tenant resources and concurrent rotations leave one valid token', async () => {
  const repo = calendarFeedRepository(pool, tenant, origin),
    saved = await repo.save(actor, input);
  await expect(
    pool.query(
      'UPDATE calendar_feeds SET resource_id=$1 WHERE tenant_id=$2 AND id=$3',
      [foreignResource, tenant, saved.id],
    ),
  ).rejects.toMatchObject({ code: '23503' });
  await expect(
    pool.query(
      "UPDATE calendar_feeds SET token_hash='unsafe' WHERE tenant_id=$1 AND id=$2",
      [tenant, saved.id],
    ),
  ).rejects.toMatchObject({ code: '23514' });
  const rotations = await Promise.all([
    repo.save(actor, input, saved.id),
    repo.save(actor, input, saved.id),
  ]);
  const results = await Promise.all(rotations.map((row) => feed(row.url)));
  expect(results.map((r) => r.statusCode).sort()).toEqual([200, 404]);
  expect((await feed(saved.url)).statusCode).toBe(404);
  await pool.query('ALTER TABLE audit_events RENAME TO unavailable_feed_audit');
  try {
    await expect(repo.save(actor, input, saved.id)).rejects.toThrow();
    await expect(repo.save(actor, input)).rejects.toThrow();
  } finally {
    await pool.query(
      'ALTER TABLE unavailable_feed_audit RENAME TO audit_events',
    );
  }
  const after = await Promise.all(rotations.map((row) => feed(row.url)));
  expect(after.map((r) => r.statusCode).sort()).toEqual([200, 404]);
});

test('undated rows are absent and day-only rows survive without fabricated times', async () => {
  const id = randomUUID();
  await pool.query(
    "INSERT INTO events(tenant_id,id,name,status,source,time_zone,description,notes_html) VALUES($1,$2,'Fictional undated','inquiry','Fictional','Europe/Berlin','','')",
    [tenant, id],
  );
  const saved = (await create()).json();
  expect((await feed(saved.url)).body).not.toContain('Fictional undated');
  await pool.query(
    "UPDATE events SET event_date='2030-03-31',name='Fictional day-only' WHERE tenant_id=$1 AND id=$2",
    [tenant, id],
  );
  const body = (await feed(saved.url)).body;
  expect(body).toContain('DTSTART;VALUE=DATE:20300331');
  expect(body).toContain('DTEND;VALUE=DATE:20300401');
  expect(body).toContain('Fictional day-only');
});

test('the effective place keeps ics escaping and folding for hostile text', async () => {
  const saved = (await create()).json(),
    venue =
      'Synthetic \\ Hall; Ort, "Zwei"\nZweite Zeile mit einem sehr langen Zusatz, der die Zeile sicher umbricht';
  await pool.query(
    'UPDATE events SET venue=$1, venue_override=true WHERE tenant_id=$2 AND id=$3',
    [venue, tenant, event],
  );
  const body = (await feed(saved.url)).body,
    flat = body.replace(/\r\n /g, '');
  expect(flat).toContain(
    'LOCATION:Synthetic \\\\ Hall\\; Ort\\, "Zwei"\\nZweite Zeile mit einem sehr langen Zusatz\\, der die Zeile sicher umbricht',
  );
  expect(flat).not.toContain('Synthetic \\ Hall;');
  // The logical line exceeds 75 bytes and is folded, not truncated.
  expect(body).toMatch(/LOCATION:[^\r]*\r\n /);
});

test('token route throttles repeated invalid reads without a session', async () => {
  for (let i = 0; i < 60; i++)
    await app.inject({
      url: '/feeds/v1/bad.ics',
      headers: tls,
      remoteAddress: '192.0.2.55',
    });
  expect(
    (
      await app.inject({
        url: '/feeds/v1/bad.ics',
        headers: tls,
        remoteAddress: '192.0.2.55',
      })
    ).statusCode,
  ).toBe(429);
});

test('the ics location is the effective place only', async () => {
  const saved = (await create()).json(),
    block = async () => {
      const body = (await feed(saved.url)).body.split('BEGIN:VEVENT');
      return body.find((entry) => entry.includes('Fictional changed event'))!;
    };
  await pool.query(
    "UPDATE events SET venue='Fictional Freeform Hall, Side entrance', venue_override=true WHERE tenant_id=$1 AND id=$2",
    [tenant, event],
  );
  let entry = await block();
  expect(entry).toContain('LOCATION:Fictional Freeform Hall\\, Side entrance');
  expect(entry).not.toContain('Fictional street');
  await pool.query(
    "UPDATE events SET venue='', venue_override=true WHERE tenant_id=$1 AND id=$2",
    [tenant, event],
  );
  entry = await block();
  expect(entry).toContain('LOCATION:\r\n');
  expect(entry).not.toContain('Fictional renamed hall');
  expect(entry).not.toContain('Fictional street');
});

test('calendar feeds omit events after their tombstone is written', async () => {
  const events = eventRepository(pool, tenant),
    created = await events.save(actor, {
      name: 'Fictional removed feed event',
      status: 'option',
      eventTypeId: null,
      packageId: null,
      locationId: null,
      primaryContactId: null,
      additionalContactIds: [],
      source: 'Synthetic fixture',
      eventDate: '2032-01-02',
      startsAt: '2032-01-02T18:00:00Z',
      endsAt: '2032-01-02T20:00:00Z',
      description: '',
      notesHtml: '',
    }),
    savedFeed = await calendarFeedRepository(pool, tenant, origin).save(
      actor,
      input,
    );
  await events.remove(actor, created.id, created.version);
  const body = (await feed(savedFeed.url)).body;
  expect(body).not.toContain('Fictional removed feed event');
});

// FEED-02: a feed leaves cancelled and unavailable events out by default,
// narrows by event type and, on request, carries the times, the primary
// contact and the newest notes for the on-site view.
test('feeds filter by status and event type and carry contact, notes and times', async () => {
  const events = eventRepository(pool, tenant),
    typeId = randomUUID(),
    otherType = randomUUID(),
    contactId = randomUUID();
  for (const [id, name] of [
    [typeId, 'Fictional wedding type'],
    [otherType, 'Fictional company type'],
  ] as const)
    await pool.query(
      `INSERT INTO master_data (tenant_id,id,kind,name,position,state)
       VALUES ($1,$2,'event_type',$3,90,'active')`,
      [tenant, id, name],
    );
  await pool.query(
    `INSERT INTO contacts (tenant_id,id,kind,name,contact_person,street,postal_code,city,country,
      email,phone,mobile,phone_key,mobile_key,state,version)
     VALUES ($1,$2,'private','Fictional On-site Person','','','','','DE',
      'onsite@example.invalid','+49 30 000001','+49 170 000002','4930000001','49170000002','active',1)`,
    [tenant, contactId],
  );
  const base = {
    packageId: null,
    locationId: null,
    additionalContactIds: [],
    source: 'Synthetic fixture',
    description: '',
    notesHtml: '',
  };
  const wanted = await events.save(actor, {
    ...base,
    name: 'Fictional on-site wedding',
    status: 'booked',
    eventTypeId: typeId,
    primaryContactId: contactId,
    eventDate: '2033-05-06',
    startsAt: '2033-05-06T16:00:00Z',
    endsAt: '2033-05-06T22:00:00Z',
  });
  await events.save(actor, {
    ...base,
    name: 'Fictional cancelled wedding',
    status: 'cancelled',
    eventTypeId: typeId,
    primaryContactId: null,
    eventDate: '2033-05-07',
    startsAt: null,
    endsAt: null,
  });
  await events.save(actor, {
    ...base,
    name: 'Fictional company party',
    status: 'booked',
    eventTypeId: otherType,
    primaryContactId: null,
    eventDate: '2033-05-08',
    startsAt: null,
    endsAt: null,
  });
  await pool.query(
    `INSERT INTO event_notes (tenant_id,id,event_id,body_html,created_by)
     VALUES ($1,$2,$3,'<p>Fictional note: <strong>side entrance</strong></p>',$4)`,
    [tenant, randomUUID(), wanted.id, actor],
  );
  // Defaults: no cancelled event, no contact and no notes.
  const plain = (
    await feed(
      (
        await create({
          resourceId: null,
          description: false,
          eventType: false,
          internalLink: false,
        } as typeof input)
      ).json().url,
    )
  ).body.replace(/\r\n /g, '');
  expect(plain).toContain('Fictional on-site wedding');
  expect(plain).not.toContain('Fictional cancelled wedding');
  expect(plain).not.toContain('Fictional On-site Person');
  expect(plain).not.toContain('side entrance');
  // The times always stand in the text, in the event's zone.
  expect(plain).toContain('Zeit: 18:00–00:00 Uhr');
  // Narrowed to one type, with contact and notes.
  const rich = (
    await feed(
      (
        await create({
          resourceId: null,
          description: false,
          eventType: true,
          internalLink: false,
          contact: true,
          notes: true,
          eventTypeIds: [typeId],
        } as typeof input)
      ).json().url,
    )
  ).body.replace(/\r\n /g, '');
  expect(rich).toContain('Fictional on-site wedding');
  expect(rich).not.toContain('Fictional company party');
  expect(rich).toContain('Ansprechpartner: Fictional On-site Person');
  expect(rich).toContain('Telefon: +49 30 000001');
  expect(rich).toContain('Mobil: +49 170 000002');
  expect(rich).toContain('E-Mail: onsite@example.invalid');
  expect(rich).toContain('Fictional note: side entrance');
  expect(rich).toContain('Eventart: Fictional wedding type');
  // A foreign or unknown event type is refused.
  expect(
    (
      await create({
        ...input,
        eventTypeIds: [randomUUID()],
      } as typeof input)
    ).statusCode,
  ).toBe(404);
  const listed = (
    await app.inject({ url: '/api/v1/calendar-feeds', cookies })
  ).json() as Array<{ statuses: string[]; contact: boolean }>;
  expect(listed.some((row) => row.contact)).toBe(true);
  expect(
    listed.some((row) => row.statuses.join() === 'inquiry,option,booked'),
  ).toBe(true);
});
