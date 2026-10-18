import { beforeAll, beforeEach, afterAll, test, expect } from 'vitest';
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
import { digest } from '../../packages/core/src/auth.js';
import { receiveWebsiteInquiry } from '../../packages/core/src/website-inquiries.js';
import { inquiryFormV1 } from '../../packages/core/src/inquiry-form.js';
import { contactRepository } from '../../packages/core/src/contacts.js';
import { eventRepository } from '../../packages/core/src/events.js';
import { readEventActivities } from '../../packages/core/src/event-activity.js';
import Fastify from 'fastify';
import { registerAuth } from '../../packages/core/src/auth.js';
import { registerEventRoutes } from '../../packages/core/src/events.js';
import { registerWebsiteInquiryRoutes } from '../../packages/core/src/website-inquiry-routes.js';
import { drizzle } from 'drizzle-orm/node-postgres';
let container: StartedPostgreSqlContainer,
  pool: Pool,
  tenantId: string,
  actorId: string;
const now = new Date('2030-10-26T10:00:00.000Z');
const entry = () => ({
  id: randomUUID(),
  receivedAt: now.toISOString(),
  expiresAt: '2030-10-27T10:00:00.000Z',
  submission: {
    formId: 'fotobox-bw-main',
    formVersion: 1,
    fields: {
      firstName: 'Fictional',
      lastName: 'Example',
      email: 'fictional@example.invalid',
      eventDate: '2030-10-27',
      phone: '+49 555 01000',
      location: 'Fictional venue',
      package: 'easy-print-plus',
      comment: 'Fictional <script>comment</script>',
    },
  },
  privacyNotice: inquiryFormV1.privacyNotice,
  privacyUrl: inquiryFormV1.privacyUrl,
});
const person = {
  kind: 'private' as const,
  name: 'Fictional Example',
  contactPerson: '',
  street: '',
  postalCode: '',
  city: '',
  country: 'DE',
  email: 'fictional@example.invalid',
  phone: '',
  mobile: '',
  state: 'active' as const,
};
const receive = (
  value: unknown,
  country: string | undefined = 'DE',
  at = now,
) =>
  receiveWebsiteInquiry(pool, tenantId, actorId, value, at, {
    newContactCountry: country,
  });
const counts = async () => {
  const result: Record<string, number> = {};
  for (const table of [
    'contacts',
    'events',
    'website_inquiries',
    'event_activities',
    'audit_events',
    'reservations',
  ])
    result[table] = Number(
      (
        await pool.query(
          'SELECT count(*) FROM ' + table + ' WHERE tenant_id=$1',
          [tenantId],
        )
      ).rows[0].count,
    );
  return result;
};
beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:17.6-alpine').start();
  pool = new Pool({ connectionString: container.getConnectionUri() });
  await migrate(pool);
});
beforeEach(async () => {
  tenantId = randomUUID();
  await bootstrapAccess(
    pool,
    tenantId,
    'fictional.owner@example.invalid',
    'Fictional business',
    'Europe/Berlin',
  );
  await accessRepository(pool, tenantId).issueSession(
    { subject: 'fictional', email: 'fictional.owner@example.invalid' },
    digest(randomUUID()),
  );
  actorId = (await accessRepository(pool, tenantId).list())[0]!.userId!;
});
afterAll(async () => {
  await pool?.end();
  await container?.stop();
});

test('atomically creates a dated inquiry and contact, preserving every source field and its privacy notice', async () => {
  const input = entry();
  const result = await receive(input);
  expect(result.status).toBe('created');
  const [contact] = await contactRepository(pool, tenantId).list();
  expect(contact).toMatchObject({
    name: 'Fictional Example',
    email: 'fictional@example.invalid',
    phone: '+49 555 01000',
    country: 'DE',
  });
  const [event] = await eventRepository(pool, tenantId).list();
  expect(event).toMatchObject({
    id: result.eventId,
    status: 'inquiry',
    eventDate: '2030-10-27',
    startsAt: null,
    endsAt: null,
    timeZone: 'Europe/Berlin',
    primaryContactId: contact!.id,
    eventTypeId: null,
    packageId: null,
    locationId: null,
    source: 'Website: fotobox-bw-main (v1)',
  });
  const snapshot = (
    await pool.query('SELECT * FROM website_inquiries WHERE tenant_id=$1', [
      tenantId,
    ])
  ).rows[0];
  expect(snapshot.payload).toEqual(input);
  expect(snapshot.contact_id).toBe(contact!.id);
  expect(snapshot.event_id).toBe(result.eventId);
  const activities = await readEventActivities(
    drizzle(pool),
    tenantId,
    result.eventId,
  );
  expect(activities.map((row) => row.description)).toContain(
    'Website-Anfrage empfangen: fotobox-bw-main (v1).',
  );
  expect((await counts()).reservations).toBe(0);
});
test('retains maximum-length hostile comments without overflowing or interpreting event text', async () => {
  const input = entry();
  input.submission.fields.comment = '<&😀'.repeat(1666) + '!!';
  const result = await receive(input);
  expect(result.status).toBe('created');
  expect(
    (
      await pool.query(
        'SELECT payload FROM website_inquiries WHERE tenant_id=$1',
        [tenantId],
      )
    ).rows[0].payload,
  ).toEqual(input);
  const [event] = await eventRepository(pool, tenantId).list();
  expect(Array.from(event!.description).length).toBeLessThanOrEqual(4000);
  expect(event!.notesHtml).toBe('');
  expect(event!.description).toContain('vollständigen Anfrage');
});
test('reuses one active exact email/name match without overwriting its current details or requiring a new-contact country', async () => {
  const existing = await contactRepository(pool, tenantId).save(actorId, {
    ...person,
    street: 'Fictional existing street',
    phone: '+49 555 99999',
  });
  const result = await receiveWebsiteInquiry(
    pool,
    tenantId,
    actorId,
    entry(),
    now,
    {},
  );
  expect(result.contactId).toBe(existing!.id);
  expect((await counts()).contacts).toBe(1);
  expect((await contactRepository(pool, tenantId).list())[0]).toEqual(existing);
});
test('a new contact needs an explicit operator country; public data cannot choose it', async () => {
  const before = await counts();
  await expect(
    receiveWebsiteInquiry(pool, tenantId, actorId, entry(), now, {}),
  ).rejects.toMatchObject({ reason: 'contact_review' });
  expect(await counts()).toEqual(before);
  const input = entry();
  (input.submission.fields as Record<string, unknown>).country = 'DE';
  await expect(receive(input)).rejects.toMatchObject({ reason: 'invalid' });
});
test('ambiguous, archived or mismatching contact matches require review without partial writes', async () => {
  for (const candidate of [
    { ...person, name: 'Fictional Other' },
    { ...person, state: 'archived' as const },
  ]) {
    const tenant = randomUUID();
    await bootstrapAccess(
      pool,
      tenant,
      'fictional.owner@example.invalid',
      'Fictional',
      'UTC',
    );
    await accessRepository(pool, tenant).issueSession(
      { subject: 'fictional', email: 'fictional.owner@example.invalid' },
      digest(randomUUID()),
    );
    const actor = (await accessRepository(pool, tenant).list())[0]!.userId!;
    await contactRepository(pool, tenant).save(actor, candidate);
    await expect(
      receiveWebsiteInquiry(pool, tenant, actor, entry(), now, {
        newContactCountry: 'DE',
      }),
    ).rejects.toMatchObject({ reason: 'contact_review' });
    expect(
      (
        await pool.query('SELECT count(*) FROM events WHERE tenant_id=$1', [
          tenant,
        ])
      ).rows[0].count,
    ).toBe('0');
  }
  await contactRepository(pool, tenantId).save(actorId, person);
  await contactRepository(pool, tenantId).save(actorId, {
    ...person,
    name: 'Fictional Other',
  });
  const before = await counts();
  await expect(receive(entry())).rejects.toMatchObject({
    reason: 'contact_review',
  });
  expect(await counts()).toEqual(before);
});
test('phone collisions do not merge unrelated identities', async () => {
  await contactRepository(pool, tenantId).save(actorId, {
    ...person,
    email: 'other@example.invalid',
    phone: '+49 555 01000',
  });
  await expect(receive(entry())).rejects.toMatchObject({
    reason: 'contact_review',
  });
});
test('retries survive restart and expiry but changed content cannot rewrite an accepted inquiry', async () => {
  const input = entry(),
    first = await receive(input),
    before = await counts();
  const restarted = new Pool({
    connectionString: container.getConnectionUri(),
  });
  try {
    expect(
      await receiveWebsiteInquiry(
        restarted,
        tenantId,
        actorId,
        JSON.parse(JSON.stringify(input)),
        new Date('2030-10-29T10:00:00Z'),
        {},
      ),
    ).toEqual({ ...first, status: 'duplicate' });
  } finally {
    await restarted.end();
  }
  const reordered = {
    ...input,
    submission: {
      ...input.submission,
      fields: Object.fromEntries(
        Object.entries(input.submission.fields).reverse(),
      ),
    },
  };
  expect((await receive(reordered)).status).toBe('duplicate');
  await expect(
    receive({ ...input, privacyNotice: 'Fictional changed privacy notice' }),
  ).rejects.toMatchObject({ reason: 'conflict' });
  expect(await counts()).toEqual(before);
});
test('concurrent duplicate deliveries create exactly one event, contact and source receipt', async () => {
  const input = entry();
  const results = await Promise.all(
    Array.from({ length: 5 }, () => receive(input)),
  );
  expect(results.filter((r) => r.status === 'created')).toHaveLength(1);
  expect(new Set(results.map((r) => r.eventId)).size).toBe(1);
  expect(await counts()).toMatchObject({
    contacts: 1,
    events: 1,
    website_inquiries: 1,
    event_activities: 2,
    reservations: 0,
  });
});
test('separate simultaneous inquiries can share a newly created contact without collapsing their events', async () => {
  const results = await Promise.all([receive(entry()), receive(entry())]);
  expect(new Set(results.map((r) => r.eventId)).size).toBe(2);
  expect(new Set(results.map((r) => r.contactId)).size).toBe(1);
});
test('unauthorized and foreign-tenant actors cannot read retry results or write records', async () => {
  const input = entry();
  await receive(input);
  const before = await counts();
  await expect(
    receiveWebsiteInquiry(pool, tenantId, randomUUID(), input, now, {}),
  ).rejects.toMatchObject({ reason: 'forbidden' });
  await expect(
    receiveWebsiteInquiry(pool, randomUUID(), actorId, input, now, {}),
  ).rejects.toMatchObject({ reason: 'forbidden' });
  expect(await counts()).toEqual(before);
});
test('invalid envelopes, impossible times, unknown fields and invalid configuration fail without effects', async () => {
  const input = entry(),
    before = await counts();
  for (const change of [
    null,
    { ...input, unknown: true },
    { ...input, id: 'invalid' },
    { ...input, receivedAt: '2030-02-30T10:00:00.000Z' },
    { ...input, receivedAt: '2030-10-26T10:01:00.000Z' },
    { ...input, expiresAt: '2030-11-20T10:00:00.000Z' },
    { ...input, privacyUrl: 'javascript:alert(1)' },
    { ...input, privacyNotice: 'bad\u0000value' },
  ])
    await expect(receive(change)).rejects.toMatchObject({ reason: 'invalid' });
  await expect(receive(input, 'invalid')).rejects.toMatchObject({
    reason: 'invalid',
  });
  await expect(receive(input, 'DE', new Date('invalid'))).rejects.toMatchObject(
    { reason: 'invalid' },
  );
  await expect(
    receive(input, 'DE', new Date('2030-10-28T10:00:00Z')),
  ).rejects.toMatchObject({ reason: 'expired' });
  expect(await counts()).toEqual(before);
});
test('a receipt failure rolls back nested contact/event saves and their immutable audit entries', async () => {
  const before = await counts(),
    input = entry();
  await pool.query(
    "CREATE FUNCTION fictional_reject_inquiry() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fictional-private-value'; END; $$; CREATE TRIGGER fictional_reject BEFORE INSERT ON website_inquiries FOR EACH ROW EXECUTE FUNCTION fictional_reject_inquiry()",
  );
  try {
    await expect(receive(input)).rejects.toMatchObject({
      reason: 'failed',
      message: 'Website inquiry unavailable',
    });
    expect(await counts()).toEqual(before);
  } finally {
    await pool.query(
      'DROP TRIGGER fictional_reject ON website_inquiries; DROP FUNCTION fictional_reject_inquiry()',
    );
  }
  expect((await receive(input)).status).toBe('created');
});

test('the existing protected event detail exposes the website source in its logbook', async () => {
  const result = await receive(entry()),
    token = randomUUID();
  await accessRepository(pool, tenantId).issueSession(
    { subject: 'fictional', email: 'fictional.owner@example.invalid' },
    digest(token),
  );
  const app = Fastify();
  await registerAuth(app, pool, {
    mode: 'password',
    tenantId,
    origin: 'https://fictional.example.invalid',
  });
  registerEventRoutes(app, pool, tenantId);
  try {
    const url = '/api/v1/events/' + result.eventId;
    expect((await app.inject({ url })).statusCode).toBe(401);
    const response = await app.inject({
      url,
      headers: { cookie: '__Host-ak-session=' + token },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().activities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'website_received',
          description: 'Website-Anfrage empfangen: fotobox-bw-main (v1).',
        }),
      ]),
    );
  } finally {
    await app.close();
  }
});
test('SQL rejects cross-tenant references, duplicate receipts and source-less website activities', async () => {
  const input = entry(),
    result = await receive(input);
  const other = randomUUID();
  await bootstrapAccess(
    pool,
    other,
    'other@example.invalid',
    'Fictional other business',
    'UTC',
  );
  await expect(
    pool.query(
      'INSERT INTO website_inquiries SELECT $1,id,contact_id,event_id,payload,payload_hash,received_at,expires_at,imported_at FROM website_inquiries WHERE tenant_id=$2',
      [other, tenantId],
    ),
  ).rejects.toMatchObject({ code: '23503' });
  await expect(
    pool.query(
      'INSERT INTO website_inquiries SELECT * FROM website_inquiries WHERE tenant_id=$1',
      [tenantId],
    ),
  ).rejects.toMatchObject({ code: '23505' });
  await expect(
    pool.query(
      "INSERT INTO event_activities(tenant_id,event_id,kind) VALUES($1,$2,'website_received')",
      [tenantId, result.eventId],
    ),
  ).rejects.toMatchObject({ code: '23514' });
});
test('a caller cannot mutate fields or clock while a receive transaction awaits a database lock', async () => {
  const connection = await pool.connect(),
    input = entry(),
    clock = new Date(now);
  await connection.query('BEGIN');
  await connection.query(
    'SELECT pg_advisory_xact_lock(hashtextextended($1::uuid::text,814022))',
    [tenantId],
  );
  const pending = receiveWebsiteInquiry(pool, tenantId, actorId, input, clock, {
    newContactCountry: 'DE',
  });
  input.submission.fields.firstName = 'Fictional mutated';
  clock.setUTCFullYear(2040);
  await connection.query('COMMIT');
  connection.release();
  const result = await pending;
  expect(
    (await eventRepository(pool, tenantId).detail(result.eventId)).event.name,
  ).toBe('Fictional Example');
});

test('the database rejects a changed original payload that no longer matches its receipt fingerprint', async () => {
  await receive(entry());
  await expect(
    pool.query(
      "UPDATE website_inquiries SET payload=jsonb_set(payload,'{privacyNotice}','\"Fictional tamper\"'::jsonb) WHERE tenant_id=$1",
      [tenantId],
    ),
  ).rejects.toMatchObject({ code: '23514' });
});

test('original inquiry endpoint is tenant-scoped, read-only and keeps complete submitted values after contact edits', async () => {
  const value = entry();
  value.submission.fields.comment = 'Fictional original\n' + 'x'.repeat(4900);
  const result = await receive(value),
    token = randomUUID();
  await accessRepository(pool, tenantId).issueSession(
    { subject: 'fictional', email: 'fictional.owner@example.invalid' },
    digest(token),
  );
  const app = Fastify();
  await registerAuth(app, pool, {
    mode: 'password',
    tenantId,
    origin: 'https://fictional.example.invalid',
  });
  registerWebsiteInquiryRoutes(app, pool, tenantId);
  try {
    const url = '/api/v1/events/' + result.eventId + '/website-inquiry';
    expect((await app.inject({ url })).statusCode).toBe(401);
    await contactRepository(pool, tenantId).save(
      actorId,
      {
        ...person,
        name: 'Fictional edited contact',
        email: 'edited@example.invalid',
      },
      result.contactId,
      1,
    );
    const response = await app.inject({
      url,
      headers: { cookie: '__Host-ak-session=' + token },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.fields).toHaveLength(8);
    expect(
      body.fields.find((field: { label: string }) => field.label === 'Vorname')
        .value,
    ).toBe('Fictional');
    expect(
      body.fields.find(
        (field: { label: string }) => field.label === 'Kommentar',
      ).value,
    ).toBe(value.submission.fields.comment);
    expect(body.privacyNotice).toBe(value.privacyNotice);
    expect(body.privacyUrl).toBe(value.privacyUrl);
    expect(
      body.fields.find(
        (field: { label: string }) =>
          field.label === 'Gewünschtes Fotobox-Paket',
      ).value,
    ).toBe('easy print+ (400 Ausdrucke, Drucklayout)');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).not.toContain('payloadHash');
    expect(response.body).not.toContain(tenantId);
    expect(response.body).not.toContain('Fictional edited contact');
    expect(
      (
        await app.inject({
          method: 'POST',
          url,
          headers: {
            cookie: '__Host-ak-session=' + token,
            origin: 'https://fictional.example.invalid',
            'x-csrf-token': 'fictional',
          },
          payload: {},
        })
      ).statusCode,
    ).not.toBe(200);
    expect(
      (
        await app.inject({
          url: '/api/v1/events/' + randomUUID() + '/website-inquiry',
          headers: { cookie: '__Host-ak-session=' + token },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (await eventRepository(pool, tenantId).detail(result.eventId))
        .websiteInquiryAvailable,
    ).toBe(true);
  } finally {
    await app.close();
  }
  const foreign = Fastify();
  try {
    await registerAuth(foreign, pool, {
      mode: 'password',
      tenantId: randomUUID(),
      origin: 'https://fictional.example.invalid',
    });
    registerWebsiteInquiryRoutes(foreign, pool, tenantId);
    expect(
      (
        await foreign.inject({
          url: '/api/v1/events/' + result.eventId + '/website-inquiry',
          headers: { cookie: '__Host-ak-session=' + token },
        })
      ).statusCode,
    ).toBe(401);
  } finally {
    await foreign.close();
  }
});

test('original inquiry reads reject missing actors, foreign permissions, broken storage and corrupted metadata neutrally', async () => {
  const value = entry();
  delete (value.submission.fields as Record<string, unknown>).phone;
  delete (value.submission.fields as Record<string, unknown>).package;
  delete (value.submission.fields as Record<string, unknown>).location;
  delete (value.submission.fields as Record<string, unknown>).comment;
  const result = await receive(value),
    url = '/api/v1/events/' + result.eventId + '/website-inquiry';
  const bare = Fastify();
  registerWebsiteInquiryRoutes(bare, pool, tenantId);
  try {
    expect((await bare.inject({ url })).statusCode).toBe(401);
  } finally {
    await bare.close();
  }
  const app = Fastify();
  let actor = actorId;
  app.decorateRequest('authSession', null);
  app.addHook('onRequest', async (request) => {
    request.authSession = {
      userId: actor,
      email: 'fictional.owner@example.invalid',
    };
  });
  registerWebsiteInquiryRoutes(app, pool, tenantId);
  try {
    const empty = await app.inject({ url });
    expect(empty.statusCode).toBe(200);
    expect(
      empty
        .json()
        .fields.filter((field: { value: string }) => field.value === ''),
    ).toHaveLength(4);
    actor = randomUUID();
    expect((await app.inject({ url })).statusCode).toBe(403);
    actor = actorId;
    await pool.query(
      'UPDATE website_inquiries SET payload=payload||\'{"unknown":"fictional-private-value"}\'::jsonb,payload_hash=encode(sha256(convert_to((payload||\'{"unknown":"fictional-private-value"}\'::jsonb)::text,\'UTF8\')),\'hex\') WHERE tenant_id=$1',
      [tenantId],
    );
    const broken = await app.inject({ url });
    expect(broken.statusCode).toBe(503);
    expect(broken.json()).toEqual({ error: 'unavailable' });
    expect(broken.body).not.toContain('fictional-private');
  } finally {
    await app.close();
  }
  const closed = new Pool({ connectionString: container.getConnectionUri() });
  await closed.end();
  const unavailable = Fastify();
  unavailable.decorateRequest('authSession', null);
  unavailable.addHook('onRequest', async (request) => {
    request.authSession = {
      userId: actorId,
      email: 'fictional.owner@example.invalid',
    };
  });
  registerWebsiteInquiryRoutes(unavailable, closed, tenantId);
  try {
    expect((await unavailable.inject({ url })).statusCode).toBe(503);
  } finally {
    await unavailable.close();
  }
});
