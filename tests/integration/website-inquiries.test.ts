import { registerWebsiteInboxRoutes } from '../../packages/core/src/website-inbox-routes.js';
import {
  stageWebsiteInquiry,
  importStagedWebsiteInquiry,
} from '../../packages/core/src/website-inquiry-deliveries.js';
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
import {
  loadWebsiteOptionConfig,
  startWebsiteOptionDrain,
  websiteOptionDependencies,
} from '../../packages/core/src/index.js';
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
  // A direct internal call keeps the legacy status; the drain and the manual
  // recovery request an Option explicitly (see the H032 cases below).
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
    venue: 'Fictional venue',
    venueOverride: true,
    source: 'Website: fotobox-bw-main (v1)',
  });
  // H034: the customer's place is a field of the booking, so the generated
  // description must not repeat it. The original payload above stays intact.
  expect(event!.description).not.toContain('Veranstaltungsort');
  expect(event!.description).toContain('Paketwunsch:');
  expect(event!.description).toContain('Kommentar:');
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

test('durable staging preserves an unresolved original without business writes and survives retries after gateway expiry', async () => {
  const value = entry(),
    before = await counts();
  const stage = (at = now) =>
    stageWebsiteInquiry(pool, tenantId, actorId, value, at);
  expect(await stage()).toEqual({ status: 'stored' });
  expect(await counts()).toEqual(before);
  const first = (
    await pool.query(
      'SELECT * FROM website_inquiry_deliveries WHERE tenant_id=$1',
      [tenantId],
    )
  ).rows[0];
  expect(first.payload).toEqual(value);
  expect(first.staged_by).toBe(actorId);
  expect(first.staged_at).toEqual(now);
  const restarted = new Pool({
    connectionString: container.getConnectionUri(),
  });
  try {
    expect(
      await stageWebsiteInquiry(
        restarted,
        tenantId,
        actorId,
        {
          ...value,
          submission: {
            fields: value.submission.fields,
            formVersion: 1,
            formId: 'fotobox-bw-main',
          },
        },
        new Date('2030-11-01T10:00:00.000Z'),
      ),
    ).toEqual({ status: 'duplicate' });
  } finally {
    await restarted.end();
  }
  expect(
    (
      await pool.query(
        'SELECT * FROM website_inquiry_deliveries WHERE tenant_id=$1',
        [tenantId],
      )
    ).rows,
  ).toEqual([first]);
  await expect(
    stageWebsiteInquiry(
      pool,
      tenantId,
      actorId,
      { ...value, privacyNotice: 'Fictional changed notice' },
      now,
    ),
  ).rejects.toMatchObject({ reason: 'conflict' });
});

test('parallel staging stores exactly once per tenant and rejects foreign or revoked actors', async () => {
  const value = entry();
  const results = await Promise.all(
    Array.from({ length: 5 }, () =>
      stageWebsiteInquiry(pool, tenantId, actorId, value, now),
    ),
  );
  expect(results.filter((row) => row.status === 'stored')).toHaveLength(1);
  expect(results.filter((row) => row.status === 'duplicate')).toHaveLength(4);
  await expect(
    stageWebsiteInquiry(pool, tenantId, randomUUID(), value, now),
  ).rejects.toMatchObject({ reason: 'forbidden' });
  const foreignTenant = randomUUID();
  await bootstrapAccess(
    pool,
    foreignTenant,
    'foreign@example.invalid',
    'Fictional foreign',
    'Europe/Berlin',
  );
  await expect(
    stageWebsiteInquiry(pool, foreignTenant, actorId, value, now),
  ).rejects.toMatchObject({ reason: 'forbidden' });
  await accessRepository(pool, foreignTenant).issueSession(
    { subject: 'fictional-foreign', email: 'foreign@example.invalid' },
    digest(randomUUID()),
  );
  const foreignActor = (await accessRepository(pool, foreignTenant).list())[0]!
    .userId!;
  expect(
    await stageWebsiteInquiry(pool, foreignTenant, foreignActor, value, now),
  ).toEqual({ status: 'stored' });
  await accessRepository(pool, tenantId).grant(
    actorId,
    'second.owner@example.invalid',
  );
  await accessRepository(pool, tenantId).issueSession(
    { subject: 'fictional-second', email: 'second.owner@example.invalid' },
    digest(randomUUID()),
  );
  await pool.query(
    'UPDATE allowed_accounts SET active=false WHERE tenant_id=$1 AND user_id=$2',
    [tenantId, actorId],
  );
  await expect(
    stageWebsiteInquiry(pool, tenantId, actorId, value, now),
  ).rejects.toMatchObject({ reason: 'forbidden' });
});

test('invalid or expired first deliveries fail without storing and failed persistence has neutral errors', async () => {
  const value = entry();
  for (const [input, at] of [
    [{ ...value, unknown: 'fictional' }, now],
    [value, new Date('invalid')],
    [value, new Date('2030-10-25T10:00:00.000Z')],
  ] as const)
    await expect(
      stageWebsiteInquiry(pool, tenantId, actorId, input, at),
    ).rejects.toMatchObject({ reason: 'invalid' });
  await expect(
    stageWebsiteInquiry(pool, 'invalid', actorId, value, now),
  ).rejects.toMatchObject({ reason: 'invalid' });
  await expect(
    stageWebsiteInquiry(pool, tenantId, 'invalid', value, now),
  ).rejects.toMatchObject({ reason: 'invalid' });
  await expect(
    stageWebsiteInquiry(
      pool,
      tenantId,
      actorId,
      value,
      new Date(value.expiresAt),
    ),
  ).rejects.toMatchObject({ reason: 'expired' });
  expect(
    (
      await pool.query(
        'SELECT * FROM website_inquiry_deliveries WHERE tenant_id=$1',
        [tenantId],
      )
    ).rows,
  ).toEqual([]);
  const broken = new Pool({ connectionString: container.getConnectionUri() });
  await broken.end();
  await expect(
    stageWebsiteInquiry(broken, tenantId, actorId, value, now),
  ).rejects.toMatchObject({
    reason: 'failed',
    message: 'Website inquiry unavailable',
  });
});

test('staging snapshots callers before lock waits, supports outer rollback and enforces database integrity', async () => {
  const value = entry(),
    at = new Date(now);
  const client = await pool.connect();
  await client.query('BEGIN');
  await client.query(
    'SELECT pg_advisory_xact_lock(hashtextextended($1::uuid::text,814022))',
    [tenantId],
  );
  const pending = stageWebsiteInquiry(pool, tenantId, actorId, value, at);
  (value as { privacyNotice: string }).privacyNotice =
    'Fictional mutated caller';
  at.setUTCFullYear(2040);
  await client.query('COMMIT');
  client.release();
  await pending;
  const row = (
    await pool.query(
      'SELECT * FROM website_inquiry_deliveries WHERE tenant_id=$1',
      [tenantId],
    )
  ).rows[0];
  expect(row.payload.privacyNotice).toBe(inquiryFormV1.privacyNotice);
  expect(row.staged_at).toEqual(now);
  await expect(
    pool.query(
      'UPDATE website_inquiry_deliveries SET staged_by=$2 WHERE tenant_id=$1',
      [tenantId, randomUUID()],
    ),
  ).rejects.toMatchObject({ code: '23503' });
  await expect(
    pool.query(
      'UPDATE website_inquiry_deliveries SET staged_at=expires_at WHERE tenant_id=$1',
      [tenantId],
    ),
  ).rejects.toMatchObject({ code: '23514' });
  await expect(
    pool.query(
      'INSERT INTO website_inquiry_deliveries SELECT * FROM website_inquiry_deliveries WHERE tenant_id=$1',
      [tenantId],
    ),
  ).rejects.toMatchObject({ code: '23505' });

  await expect(
    pool.query(
      'UPDATE website_inquiry_deliveries SET payload=payload||\'{"unknown":true}\'::jsonb WHERE tenant_id=$1',
      [tenantId],
    ),
  ).rejects.toMatchObject({ code: '23514' });
  await expect(
    drizzle(pool).transaction(async (tx) => {
      await stageWebsiteInquiry(tx, tenantId, actorId, entry(), now);
      throw new Error('fictional rollback');
    }),
  ).rejects.toThrow('fictional rollback');
  expect(
    (
      await pool.query(
        'SELECT * FROM website_inquiry_deliveries WHERE tenant_id=$1',
        [tenantId],
      )
    ).rowCount,
  ).toBe(1);
});

test('a durably received inquiry can be processed after its gateway deadline and retried without changing the original', async () => {
  const value = {
    ...entry(),
    receivedAt: '2020-10-26T10:00:00.000Z',
    expiresAt: '2020-10-27T10:00:00.000Z',
  };
  await stageWebsiteInquiry(
    pool,
    tenantId,
    actorId,
    value,
    new Date(value.receivedAt),
  );
  await expect(
    importStagedWebsiteInquiry(pool, tenantId, actorId, value.id, {}),
  ).rejects.toMatchObject({ reason: 'contact_review' });
  expect((await counts()).events).toBe(0);
  const imported = await importStagedWebsiteInquiry(
    pool,
    tenantId,
    actorId,
    value.id,
    { newContactCountry: 'DE' },
  );
  expect(imported.status).toBe('created');
  const restarted = new Pool({
    connectionString: container.getConnectionUri(),
  });
  try {
    expect(
      await importStagedWebsiteInquiry(
        restarted,
        tenantId,
        actorId,
        value.id,
        {},
      ),
    ).toEqual({ ...imported, status: 'duplicate' });
  } finally {
    await restarted.end();
  }
  expect((await counts()).events).toBe(1);
  expect(
    (
      await pool.query(
        'SELECT payload FROM website_inquiry_deliveries WHERE tenant_id=$1',
        [tenantId],
      )
    ).rows[0].payload,
  ).toEqual(value);
  expect(
    (
      await pool.query(
        'SELECT payload FROM website_inquiries WHERE tenant_id=$1',
        [tenantId],
      )
    ).rows[0].payload,
  ).toEqual(value);
});

test('concurrent staged processing reuses an exact contact without overwriting it', async () => {
  const personRow = await contactRepository(pool, tenantId).save(
      actorId,
      person,
    ),
    value = entry();
  await stageWebsiteInquiry(pool, tenantId, actorId, value, now);
  const results = await Promise.all(
    Array.from({ length: 5 }, () =>
      importStagedWebsiteInquiry(pool, tenantId, actorId, value.id, {}),
    ),
  );
  expect(results.filter((row) => row.status === 'created')).toHaveLength(1);
  expect(new Set(results.map((row) => row.eventId)).size).toBe(1);
  expect(results.every((row) => row.contactId === personRow!.id)).toBe(true);
  expect((await contactRepository(pool, tenantId).list())[0]!.phone).toBe('');
  expect((await counts()).reservations).toBe(0);
});

test('staged processing keeps ambiguous originals and rejects missing, foreign or corrupted inputs', async () => {
  const value = entry();
  await stageWebsiteInquiry(pool, tenantId, actorId, value, now);
  await contactRepository(pool, tenantId).save(actorId, {
    ...person,
    name: 'Fictional other person',
  });
  const before = await counts();
  await expect(
    importStagedWebsiteInquiry(pool, tenantId, actorId, value.id, {
      newContactCountry: 'DE',
    }),
  ).rejects.toMatchObject({ reason: 'contact_review' });
  expect(await counts()).toEqual(before);
  await expect(
    importStagedWebsiteInquiry(pool, tenantId, actorId, randomUUID(), {}),
  ).rejects.toMatchObject({ reason: 'not_found' });
  await expect(
    importStagedWebsiteInquiry(pool, tenantId, randomUUID(), value.id, {}),
  ).rejects.toMatchObject({ reason: 'forbidden' });
  for (const [tenant, actor, id] of [
    ['invalid', actorId, value.id],
    [tenantId, 'invalid', value.id],
    [tenantId, actorId, 'invalid'],
  ])
    await expect(
      importStagedWebsiteInquiry(pool, tenant!, actor!, id!, {}),
    ).rejects.toMatchObject({ reason: 'invalid' });
  await pool.query(
    "UPDATE website_inquiry_deliveries SET payload=jsonb_set(payload,'{id}',to_jsonb($2::text)),payload_hash=encode(sha256(convert_to(jsonb_set(payload,'{id}',to_jsonb($2::text))::text,'UTF8')),'hex') WHERE tenant_id=$1",
    [tenantId, randomUUID()],
  );
  await expect(
    importStagedWebsiteInquiry(pool, tenantId, actorId, value.id, {}),
  ).rejects.toMatchObject({ reason: 'invalid' });
  const broken = new Pool({ connectionString: container.getConnectionUri() });
  await broken.end();
  await expect(
    importStagedWebsiteInquiry(broken, tenantId, actorId, value.id, {}),
  ).rejects.toMatchObject({ reason: 'failed' });
  expect(await counts()).toEqual(before);
});

test('staged processing isolates foreign tenants and checks stored payload and time metadata before creating anything', async () => {
  const value = entry();
  await stageWebsiteInquiry(pool, tenantId, actorId, value, now);
  await expect(
    importStagedWebsiteInquiry(pool, tenantId, actorId, value.id, {
      newContactCountry: 'invalid',
    }),
  ).rejects.toMatchObject({ reason: 'invalid' });
  const foreignTenant = randomUUID();
  await bootstrapAccess(
    pool,
    foreignTenant,
    'foreign@example.invalid',
    'Fictional foreign',
    'Europe/Berlin',
  );
  await accessRepository(pool, foreignTenant).issueSession(
    { subject: 'foreign', email: 'foreign@example.invalid' },
    digest(randomUUID()),
  );
  const foreignActor = (await accessRepository(pool, foreignTenant).list())[0]!
    .userId!;
  await expect(
    importStagedWebsiteInquiry(pool, foreignTenant, foreignActor, value.id, {
      newContactCountry: 'DE',
    }),
  ).rejects.toMatchObject({ reason: 'not_found' });
  for (const change of [
    "payload=payload||'{\"unknown\":true}'::jsonb,payload_hash=encode(sha256(convert_to((payload||'{\"unknown\":true}'::jsonb)::text,'UTF8')),'hex')",
    "received_at=received_at+interval '1 second'",
    "expires_at=expires_at+interval '1 second'",
  ]) {
    await pool.query(
      'UPDATE website_inquiry_deliveries SET ' + change + ' WHERE tenant_id=$1',
      [tenantId],
    );
    await expect(
      importStagedWebsiteInquiry(pool, tenantId, actorId, value.id, {
        newContactCountry: 'DE',
      }),
    ).rejects.toMatchObject({ reason: 'invalid' });
    await pool.query(
      "UPDATE website_inquiry_deliveries SET payload=$2,payload_hash=encode(sha256(convert_to($2::jsonb::text,'UTF8')),'hex'),received_at=$3,expires_at=$4 WHERE tenant_id=$1",
      [tenantId, JSON.stringify(value), value.receivedAt, value.expiresAt],
    );
  }
  expect((await counts()).events).toBe(0);
});

test('website inbox API paginates pending originals and requires CSRF for an explicit non-booking import', async () => {
  const value = entry();
  for (let i = 0; i < 26; i++)
    await stageWebsiteInquiry(
      pool,
      tenantId,
      actorId,
      { ...value, id: i === 0 ? value.id : randomUUID() },
      now,
    );
  const token = randomUUID();
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
  registerWebsiteInboxRoutes(app, pool, tenantId);
  const headers = {
    cookie: '__Host-ak-session=' + token,
    origin: 'https://fictional.example.invalid',
    'x-csrf-token': digest('csrf:' + token),
  };
  try {
    expect(
      (await app.inject({ url: '/api/v1/website-inquiries' })).statusCode,
    ).toBe(401);
    const response = await app.inject({
      url: '/api/v1/website-inquiries',
      headers,
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    const body = response.json();
    expect(body.total).toBe(26);
    expect(body.limit).toBe(25);
    expect(body.items).toHaveLength(25);
    expect(body.items[0].original.fields).toHaveLength(8);
    expect(response.body).not.toContain('payloadHash');
    expect(response.body).not.toContain(tenantId);
    const second = await app.inject({
      url: '/api/v1/website-inquiries?offset=25',
      headers,
    });
    expect(second.json().items).toHaveLength(1);
    expect(
      new Set([...body.items, ...second.json().items].map((row) => row.id))
        .size,
    ).toBe(26);
    const url = '/api/v1/website-inquiries/' + value.id + '/import';
    expect(
      (
        await app.inject({
          method: 'POST',
          url,
          headers: { cookie: headers.cookie, origin: headers.origin },
          payload: { newContactCountry: 'DE' },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (await app.inject({ method: 'POST', url, headers, payload: {} })).json(),
    ).toEqual({ error: 'contact_review' });
    expect(
      (
        await app.inject({
          method: 'POST',
          url,
          headers,
          payload: { newContactCountry: 'DE', unknown: 'fictional' },
        })
      ).statusCode,
    ).toBe(400);
    const imported = await app.inject({
      method: 'POST',
      url,
      headers,
      payload: { newContactCountry: 'DE' },
    });
    expect(imported.statusCode).toBe(200);
    expect(imported.json().status).toBe('created');
    // The recovered entry is an Option; the API contract itself is unchanged.
    expect(
      (
        await pool.query(
          'SELECT e.status FROM events e JOIN website_inquiries i ON i.event_id=e.id AND i.tenant_id=e.tenant_id WHERE i.tenant_id=$1 AND i.id=$2',
          [tenantId, value.id],
        )
      ).rows[0].status,
    ).toBe('option');
    // The manual route writes the same audit line as the automatic drain.
    expect(
      (
        await pool.query(
          'SELECT next_status AS "nextStatus", source, actor_id AS "actorId", previous_status AS "previousStatus" FROM event_activities WHERE tenant_id=$1 AND event_id=$2 AND kind=\'website_received\'',
          [tenantId, imported.json().eventId],
        )
      ).rows,
    ).toEqual([
      {
        nextStatus: 'option',
        source: 'fotobox-bw-main (v1)',
        actorId,
        previousStatus: null,
      },
    ]);
    expect(
      (await app.inject({ method: 'POST', url, headers, payload: {} })).json(),
    ).toEqual({ ...imported.json(), status: 'duplicate' });
    expect(
      (await app.inject({ url: '/api/v1/website-inquiries', headers })).json()
        .total,
    ).toBe(25);
    expect((await counts()).reservations).toBe(0);
    expect(
      (
        await app.inject({
          url: '/api/v1/website-inquiries?offset=-1',
          headers,
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/website-inquiries/' + randomUUID() + '/import',
          headers,
          payload: {},
        })
      ).statusCode,
    ).toBe(404);
  } finally {
    await app.close();
  }
});

test('website inbox routes fail closed without guards or valid own permissions and hide damaged storage', async () => {
  const value = entry();
  await stageWebsiteInquiry(pool, tenantId, actorId, value, now);
  const url = '/api/v1/website-inquiries',
    action = url + '/' + value.id + '/import',
    bare = Fastify();
  registerWebsiteInboxRoutes(bare, pool, tenantId);
  try {
    expect((await bare.inject({ url })).statusCode).toBe(401);
    expect(
      (await bare.inject({ method: 'POST', url: action, payload: {} }))
        .statusCode,
    ).toBe(401);
  } finally {
    await bare.close();
  }
  let actor: string = randomUUID();
  const app = Fastify();
  app.decorateRequest('authSession', null);
  app.addHook('onRequest', async (request) => {
    request.authSession = { userId: actor, email: 'fictional@example.invalid' };
  });
  registerWebsiteInboxRoutes(app, pool, tenantId);
  try {
    expect((await app.inject({ url })).statusCode).toBe(403);
    expect(
      (await app.inject({ method: 'POST', url: action, payload: {} }))
        .statusCode,
    ).toBe(403);
    actor = actorId;
    expect((await app.inject({ url: url + '?offset=100' })).json().offset).toBe(
      0,
    );
    await pool.query(
      "UPDATE website_inquiry_deliveries SET payload=jsonb_set(payload,'{id}',to_jsonb($2::text)),payload_hash=encode(sha256(convert_to(jsonb_set(payload,'{id}',to_jsonb($2::text))::text,'UTF8')),'hex') WHERE tenant_id=$1",
      [tenantId, randomUUID()],
    );
    expect((await app.inject({ url })).json()).toEqual({
      error: 'unavailable',
    });
    expect(
      (await app.inject({ method: 'POST', url: action, payload: {} }))
        .statusCode,
    ).toBe(400);
  } finally {
    await app.close();
  }
  const broken = new Pool({ connectionString: container.getConnectionUri() });
  await broken.end();
  const unavailable = Fastify();
  unavailable.decorateRequest('authSession', null);
  unavailable.addHook('onRequest', async (request) => {
    request.authSession = {
      userId: actorId,
      email: 'fictional@example.invalid',
    };
  });
  registerWebsiteInboxRoutes(unavailable, broken, tenantId);
  try {
    expect((await unavailable.inject({ url })).statusCode).toBe(503);
    expect(
      (
        await unavailable.inject({ method: 'POST', url: action, payload: {} })
      ).json(),
    ).toEqual({ error: 'unavailable' });
  } finally {
    await unavailable.close();
  }
});

test('an inquiry without a place stores no venue and no duplicate description line', async () => {
  const value = entry();
  delete (value.submission.fields as Record<string, unknown>).location;
  const result = await receive(value);
  const event = (await eventRepository(pool, tenantId).list()).find(
    (row) => row.id === result.eventId,
  )!;
  expect(event).toMatchObject({
    locationId: null,
    venue: null,
    venueOverride: false,
  });
  expect(event.description).toContain('Paketwunsch:');
  expect(event.description).not.toContain('Veranstaltungsort');
});

// H032: one contract, one transaction. The auto path reuses the same function
// as the manual recovery; it runs through the real drain wiring below.
// Runs the real drain wiring with this database's own pool.
const drainWith = (
  pool_: Pool,
  country: string | undefined,
  tenant = tenantId,
  actor = actorId,
  codes: string[] = [],
  reports: string[] = [],
) =>
  startWebsiteOptionDrain(
    pool_,
    websiteOptionDependencies,
    {
      tenantId: tenant,
      actorId: actor,
      intervalMs: 50,
      ...(country === undefined ? {} : { newContactCountry: country }),
    },
    (code) => codes.push(code),
    () => reports.push('error'),
  );
// stop() waits for the current tick, so a single drain call acts as one run.
const settle = async (drain: { stop: () => Promise<void> }) => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await drain.stop();
};

test('A: an ordinary new entry becomes an Option without times or reservations, with one receipt and an exact source', async () => {
  const value = entry();
  await stageWebsiteInquiry(pool, tenantId, actorId, value, now);
  const codes: string[] = [],
    reports: string[] = [];
  await settle(drainWith(pool, 'DE', tenantId, actorId, codes, reports));
  expect({ codes, reports }).toEqual({ codes: [], reports: [] });
  const [event] = await eventRepository(pool, tenantId).list();
  expect(event).toMatchObject({
    status: 'option',
    eventDate: '2030-10-27',
    startsAt: null,
    endsAt: null,
    source: 'Website: fotobox-bw-main (v1)',
    venue: 'Fictional venue',
    venueOverride: true,
    eventTypeId: null,
    packageId: null,
    locationId: null,
    name: 'Fictional Example',
  });
  const [contact] = await contactRepository(pool, tenantId).list();
  expect(contact).toMatchObject({
    name: 'Fictional Example',
    email: 'fictional@example.invalid',
    country: 'DE',
    kind: 'private',
    state: 'active',
  });
  expect(await counts()).toMatchObject({
    events: 1,
    contacts: 1,
    website_inquiries: 1,
    reservations: 0,
  });
  expect(
    (
      await pool.query(
        'SELECT contact_id AS "contactId", event_id AS "eventId", payload FROM website_inquiries WHERE tenant_id=$1',
        [tenantId],
      )
    ).rows[0],
  ).toEqual({
    contactId: contact!.id,
    eventId: event!.id,
    payload: value,
  });
  expect(
    (
      await pool.query(
        'SELECT kind, next_status AS "nextStatus", source, actor_id AS "actorId", previous_status AS "previousStatus" FROM event_activities WHERE tenant_id=$1 AND kind=\'website_received\'',
        [tenantId],
      )
    ).rows,
  ).toEqual([
    {
      kind: 'website_received',
      nextStatus: 'option',
      source: 'fotobox-bw-main (v1)',
      actorId,
      previousStatus: null,
    },
  ]);
  expect(
    (await readEventActivities(drizzle(pool), tenantId, event!.id)).filter(
      (row) => row.kind === 'website_received',
    ),
  ).toEqual([
    expect.objectContaining({
      nextStatus: 'option',
      description: 'Website-Anfrage empfangen: fotobox-bw-main (v1).',
    }),
  ]);
});

test('B: an entry staged before gateway expiry is still turned into an Option after it', async () => {
  const value = {
    ...entry(),
    receivedAt: '2020-10-26T10:00:00.000Z',
    expiresAt: '2020-10-27T10:00:00.000Z',
  };
  await stageWebsiteInquiry(
    pool,
    tenantId,
    actorId,
    value,
    new Date(value.receivedAt),
  );
  await settle(drainWith(pool, 'DE'));
  expect((await eventRepository(pool, tenantId).list())[0]).toMatchObject({
    status: 'option',
    eventDate: '2030-10-27',
  });
  expect((await counts()).reservations).toBe(0);
});

test('C: duplicate ids, restarts and five parallel drains still yield one Option and one contact', async () => {
  const value = entry();
  await stageWebsiteInquiry(pool, tenantId, actorId, value, now);
  expect(
    await stageWebsiteInquiry(pool, tenantId, actorId, value, now),
  ).toEqual({ status: 'duplicate' });
  const restarted = new Pool({
    connectionString: container.getConnectionUri(),
  });
  try {
    await Promise.all([
      settle(drainWith(pool, 'DE')),
      settle(drainWith(restarted, 'DE')),
      settle(drainWith(pool, 'DE')),
      settle(drainWith(restarted, 'DE')),
      settle(drainWith(pool, 'DE')),
    ]);
  } finally {
    await restarted.end();
  }
  expect(await counts()).toMatchObject({
    events: 1,
    contacts: 1,
    website_inquiries: 1,
    reservations: 0,
  });
  expect(
    await importStagedWebsiteInquiry(pool, tenantId, actorId, value.id, {}),
  ).toMatchObject({ status: 'duplicate' });
  expect(await counts()).toMatchObject({ events: 1, contacts: 1 });
});

test('D: the drain stays inside its tenant and foreign entries stay invisible', async () => {
  const foreign = randomUUID();
  await bootstrapAccess(
    pool,
    foreign,
    'foreign@example.invalid',
    'Fictional foreign business',
    'Europe/Berlin',
  );
  // A staged entry is authenticated by an active operator of its own tenant.
  await accessRepository(pool, foreign).issueSession(
    { subject: 'foreign', email: 'foreign@example.invalid' },
    digest(randomUUID()),
  );
  const foreignActor = (await accessRepository(pool, foreign).list())[0]!
    .userId!;
  const base = entry(),
    mine = base,
    theirs = {
      ...base,
      id: randomUUID(),
      submission: {
        ...base.submission,
        fields: { ...base.submission.fields, email: 'other@example.invalid' },
      },
    };
  await stageWebsiteInquiry(pool, tenantId, actorId, mine, now);
  await stageWebsiteInquiry(pool, foreign, foreignActor, theirs, now);
  await settle(drainWith(pool, 'DE'));
  const events = await pool.query<{ tenant_id: string; source: string }>(
    "SELECT tenant_id, source FROM events WHERE source LIKE 'Website:%' AND tenant_id=$1",
    [tenantId],
  );
  expect(events.rows).toEqual([
    { tenant_id: tenantId, source: 'Website: fotobox-bw-main (v1)' },
  ]);
  expect(
    (
      await pool.query('SELECT 1 FROM website_inquiries WHERE tenant_id=$1', [
        foreign,
      ])
    ).rowCount,
  ).toBe(0);
  expect(
    (
      await pool.query(
        'SELECT 1 FROM website_inquiry_deliveries WHERE tenant_id=$1',
        [foreign],
      )
    ).rowCount,
  ).toBe(1);
  await expect(
    importStagedWebsiteInquiry(pool, foreign, foreignActor, mine.id, {
      newContactCountry: 'DE',
    }),
  ).rejects.toMatchObject({ reason: 'not_found' });
});

test('E: unsigned or malformed deliveries have no effect even after a successful auto path', async () => {
  const value = entry();
  await expect(
    stageWebsiteInquiry(
      pool,
      tenantId,
      actorId,
      { ...value, signature: 'x' },
      now,
    ),
  ).rejects.toMatchObject({ reason: 'invalid' });
  await stageWebsiteInquiry(pool, tenantId, actorId, value, now);
  await settle(drainWith(pool, 'DE'));
  const before = await counts();
  for (const broken of [
    { ...value, id: randomUUID(), extra: true },
    { ...value, id: randomUUID(), payload: 'x' },
    {
      ...value,
      id: randomUUID(),
      submission: { ...value.submission, status: 'booked' },
    },
    {
      ...value,
      id: randomUUID(),
      privacyUrl: 'http://fictional.example.invalid/privacy',
    },
  ])
    await expect(
      stageWebsiteInquiry(pool, tenantId, actorId, broken, now),
    ).rejects.toMatchObject({ reason: 'invalid' });
  expect(await counts()).toEqual(before);
  expect((await eventRepository(pool, tenantId).list())[0]!.status).toBe(
    'option',
  );
});

test('F: an ambiguous contact stays an exception while other pending entries in the same run become Options', async () => {
  const base = entry(),
    ambiguous = base,
    plain = {
      ...base,
      id: randomUUID(),
      submission: {
        ...base.submission,
        fields: {
          ...base.submission.fields,
          firstName: 'Second',
          email: 'second@example.invalid',
        },
      },
    };
  await contactRepository(pool, tenantId).save(actorId, person);
  await contactRepository(pool, tenantId).save(actorId, {
    ...person,
    name: 'Fictional Other Person',
  });
  await stageWebsiteInquiry(pool, tenantId, actorId, ambiguous, now);
  await stageWebsiteInquiry(pool, tenantId, actorId, plain, now);
  const codes: string[] = [],
    reports: string[] = [],
    drain = drainWith(pool, 'DE', tenantId, actorId, codes, reports);
  await settle(drain);
  expect(codes).toEqual(['website_option_contact_review']);
  expect(reports).toEqual([]);
  expect(drain.ready()).toBe(true);
  expect(
    (
      await pool.query<{ id: string }>(
        'SELECT id FROM website_inquiry_deliveries WHERE tenant_id=$1',
        [tenantId],
      )
    ).rows
      .map((row) => row.id)
      .sort(),
  ).toEqual([ambiguous.id, plain.id].sort());
  expect(
    (
      await pool.query('SELECT id FROM website_inquiries WHERE tenant_id=$1', [
        tenantId,
      ])
    ).rowCount,
  ).toBe(1);
  expect(
    (await eventRepository(pool, tenantId).list()).filter(
      (row) => row.source !== null,
    ),
  ).toEqual([expect.objectContaining({ status: 'option' })]);
  expect(
    await contactRepository(pool, tenantId)
      .list()
      .then(
        (rows) =>
          rows.find((row) => row.email === 'second@example.invalid')?.name,
      ),
  ).toBe('Second Example');
  // Still a visible exception after the run; no silent merge happened.
  expect(
    (await contactRepository(pool, tenantId).list()).map((row) => row.name),
  ).toEqual(['Fictional Example', 'Fictional Other Person', 'Second Example']);
  await expect(
    importStagedWebsiteInquiry(pool, tenantId, actorId, ambiguous.id, {}),
  ).rejects.toMatchObject({ reason: 'contact_review' });
});

test('G: a failure after the event was written leaves no event, receipt, logbook entry or reservation', async () => {
  await contactRepository(pool, tenantId).save(actorId, person);
  const value = entry();
  await stageWebsiteInquiry(pool, tenantId, actorId, value, now);
  await pool.query(`CREATE OR REPLACE FUNCTION fictional_h032_fail() RETURNS trigger
    LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic'; END $$`);
  await pool.query(`CREATE TRIGGER fictional_h032_fail BEFORE INSERT ON event_activities
    FOR EACH ROW EXECUTE FUNCTION fictional_h032_fail()`);
  try {
    await expect(
      importStagedWebsiteInquiry(pool, tenantId, actorId, value.id, {}),
    ).rejects.toMatchObject({ reason: 'failed' });
  } finally {
    await pool.query('DROP TRIGGER fictional_h032_fail ON event_activities');
    await pool.query('DROP FUNCTION fictional_h032_fail()');
  }
  expect(await counts()).toMatchObject({
    events: 0,
    contacts: 1,
    website_inquiries: 0,
    event_activities: 0,
    reservations: 0,
  });
  expect(
    await importStagedWebsiteInquiry(pool, tenantId, actorId, value.id, {}),
  ).toMatchObject({ status: 'created' });
  expect(await counts()).toMatchObject({ events: 1, website_inquiries: 1 });
});

test('J: without a configured country the auto path keeps new contacts in review, with one it becomes an Option', async () => {
  const base = entry(),
    // No saved contact matches these details, so only the country decides.
    unknown = {
      ...base,
      id: randomUUID(),
      submission: {
        ...base.submission,
        fields: {
          ...base.submission.fields,
          firstName: 'Unknown',
          email: 'unknown@example.invalid',
        },
      },
    },
    known = {
      ...base,
      id: randomUUID(),
      submission: {
        ...base.submission,
        fields: {
          ...base.submission.fields,
          firstName: 'Known',
          email: 'known@example.invalid',
        },
      },
    };
  expect(
    loadWebsiteOptionConfig({
      AK_INQUIRY_TENANT_ID: tenantId,
      AK_INQUIRY_OPERATOR_ID: actorId,
    })?.newContactCountry,
  ).toBeUndefined();
  expect(
    loadWebsiteOptionConfig({
      AK_INQUIRY_TENANT_ID: tenantId,
      AK_INQUIRY_OPERATOR_ID: actorId,
      AK_INQUIRY_DEFAULT_CONTACT_COUNTRY: 'DE',
    })?.newContactCountry,
  ).toBe('DE');
  // The known entry must find this exact active private contact, or the case
  // would silently test a new contact instead of reuse. It only matches
  // `known`: name and e-mail differ from the unknown entry.
  await contactRepository(pool, tenantId).save(actorId, {
    ...person,
    name: 'Known Example',
    email: 'known@example.invalid',
  });
  await stageWebsiteInquiry(pool, tenantId, actorId, unknown, now);
  await stageWebsiteInquiry(pool, tenantId, actorId, known, now);
  const codes: string[] = [],
    reports: string[] = [],
    drain = drainWith(pool, undefined, tenantId, actorId, codes, reports);
  await settle(drain);
  // Without a country only the unknown entry is refused; the known one reuses
  // its exact contact and becomes an Option without inventing a settlement.
  expect(codes).toEqual(['website_option_contact_review']);
  expect(reports).toEqual([]);
  expect(
    (await eventRepository(pool, tenantId).list()).map((row) => row.status),
  ).toEqual(['option']);
  // No new contact: the exception created none, the known entry reused one.
  expect(
    (await contactRepository(pool, tenantId).list()).map((row) => ({
      name: row.name,
      country: row.country,
    })),
  ).toEqual([{ name: 'Known Example', country: 'DE' }]);
  // The refused entry stays visible and only a country would turn it into a
  // new contact, which is the documented deployment opt-in.
  expect(
    (
      await pool.query('SELECT id FROM website_inquiries WHERE tenant_id=$1', [
        tenantId,
      ])
    ).rowCount,
  ).toBe(1);
});

test('K: the manual recovery is idempotent and yields the same Option semantics as the auto path', async () => {
  const value = entry();
  await stageWebsiteInquiry(pool, tenantId, actorId, value, now);
  await expect(
    importStagedWebsiteInquiry(pool, tenantId, actorId, value.id, {}),
  ).rejects.toMatchObject({ reason: 'contact_review' });
  const created = await importStagedWebsiteInquiry(
    pool,
    tenantId,
    actorId,
    value.id,
    { newContactCountry: 'DE' },
  );
  expect(created.status).toBe('created');
  expect(
    await importStagedWebsiteInquiry(pool, tenantId, actorId, value.id, {}),
  ).toEqual({ ...created, status: 'duplicate' });
  const detail = await eventRepository(pool, tenantId).detail(created.eventId);
  expect(detail.event).toMatchObject({
    status: 'option',
    startsAt: null,
    endsAt: null,
  });
  expect(detail.activities).toEqual([
    expect.objectContaining({ kind: 'created' }),
    expect.objectContaining({
      kind: 'website_received',
      nextStatus: 'option',
      actorId,
    }),
  ]);
  expect(await counts()).toMatchObject({ events: 1, reservations: 0 });
});

test('a direct receive call keeps the legacy inquiry status unless it asks for an Option', async () => {
  const legacy = await receiveWebsiteInquiry(
    pool,
    tenantId,
    actorId,
    entry(),
    now,
    { newContactCountry: 'DE' },
  );
  expect(
    (await eventRepository(pool, tenantId).detail(legacy.eventId)).event.status,
  ).toBe('inquiry');
  const second = entry();
  const option = await receiveWebsiteInquiry(
    pool,
    tenantId,
    actorId,
    second,
    now,
    { newContactCountry: 'DE', status: 'option' },
  );
  expect(
    (await eventRepository(pool, tenantId).detail(option.eventId)).event.status,
  ).toBe('option');
  await expect(
    receiveWebsiteInquiry(pool, tenantId, actorId, entry(), now, {
      status: 'booked',
    } as never),
  ).rejects.toMatchObject({ reason: 'invalid' });
});
