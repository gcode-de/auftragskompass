import { afterAll, beforeAll, expect, test } from 'vitest';
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { drizzle } from 'drizzle-orm/node-postgres';
import {
  contacts as contactTable,
  events as eventTable,
  eventContacts as eventContactTable,
  reservations as reservationTable,
} from '../../packages/core/src/schema.js';
import { migrate } from '../../packages/core/src/identity.js';
import {
  bootstrapAccess,
  accessRepository,
} from '../../packages/core/src/access.js';
import {
  eventRepository,
  registerEventRoutes,
} from '../../packages/core/src/events.js';
import { resourceRepository } from '../../packages/core/src/resources.js';
import { reservationRepository } from '../../packages/core/src/reservations.js';
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
    name: '=Fictional event contact',
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
    for (const url of ['/api/v1/events', '/api/v1/events/export.csv'])
      expect((await app.inject(url)).statusCode).toBe(401);
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
    const foreignTenant = randomUUID();
    await bootstrapAccess(
      pool,
      foreignTenant,
      'foreign-export@example.invalid',
      'Fictional foreign tenant',
      'UTC',
    );
    const foreignAccess = accessRepository(pool, foreignTenant);
    await foreignAccess.issueSession(
      { subject: 'foreign-export', email: 'foreign-export@example.invalid' },
      digest('synthetic-foreign-export'),
    );
    const foreignActor = (await foreignAccess.list())[0]!.userId!;
    const foreignEvent = await eventRepository(pool, foreignTenant).save(
      foreignActor,
      {
        ...simple,
        name: 'Fictional foreign export event',
      },
    );
    expect(
      (
        await app.inject({
          url: '/api/v1/events/export.csv',
          cookies: { '__Host-ak-session': 'synthetic-foreign-export' },
        })
      ).statusCode,
    ).toBe(401);
    const exported = await app.inject({
      url: '/api/v1/events/export.csv',
      cookies,
    });
    expect(exported.statusCode).toBe(200);
    expect(exported.headers['content-type']).toContain('text/csv');
    expect(exported.headers['cache-control']).toBe('no-store');
    expect(exported.headers['content-disposition']).toContain('events.csv');
    expect(exported.body).toContain('"additionalContactIds"');
    expect(exported.body).toContain('"Europe/Berlin"');
    expect(exported.body).toContain('"2026-10-16T18:00:00.000Z"');
    expect(exported.body).toContain('"<p>Safe</p>"');
    expect(exported.body).toContain(input.primaryContactId!);
    expect(exported.body).toContain(
      '"eventTypeName","packageName","locationName","primaryContactName","additionalContactNames"',
    );
    expect(exported.body).toContain('"\'=Fictional event contact"');
    expect(exported.body).toContain('Fictional additional contact');
    expect(exported.body).toContain('Synthetic event package');
    expect(exported.body).toContain('Synthetic event venue');
    expect(await eventRepository(pool, randomUUID()).exportRows()).toEqual([]);

    expect(exported.body).not.toContain(tenantId);
    expect(exported.body).not.toContain('Fictional foreign export event');
    expect(exported.body).toMatch(/^\uFEFF"id","version"/);
    const formula = await create({
      ...simple,
      name: '=Fictional,"quoted"',
      status: 'cancelled',
      eventDate: null,
      startsAt: null,
      endsAt: null,
      source: 'line one\nline two',
    });
    expect(formula.statusCode).toBe(201);
    const complete = await app.inject({
      url: '/api/v1/events/export.csv?q=ignored',
      cookies,
    });
    expect(complete.body).toContain('"\'=Fictional,""quoted"""');
    expect(complete.body).toContain('"line one\nline two"');
    expect(complete.body).toContain(created.json().id);
    expect(complete.body).toContain('"cancelled","","",""');
    expect(complete.body).toContain('"","","","","[]"\r\n');
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
    // The notes editor writes through the full versioned event PUT. Server
    // sanitization and authorization must hold on that path as well as POST.
    const noteEvent = await create({
      ...simple,
      name: 'Fictional notes event',
    });
    expect(noteEvent.statusCode).toBe(201);
    const notesPut = (
      id: string,
      version: number,
      extra: Record<string, unknown> = {},
    ) =>
      app.inject({
        method: 'PUT',
        url: '/api/v1/events/' + id,
        cookies,
        headers,
        payload: {
          ...simple,
          name: 'Fictional notes event',
          version,
          notesHtml:
            '<p>Fictional <strong>safe</strong><script>bad()</script><a href="javascript:bad()" onclick="bad()">link</a></p>',
          ...extra,
        },
      });
    const savedNotes = await notesPut(noteEvent.json().id, 1);
    expect(savedNotes.statusCode).toBe(200);
    expect(savedNotes.json()).toMatchObject({
      version: 2,
      notesHtml: '<p>Fictional <strong>safe</strong><a>link</a></p>',
    });
    const detailNotes = await app.inject({
      url: '/api/v1/events/' + noteEvent.json().id,
      cookies,
    });
    expect(detailNotes.json().event.notesHtml).toBe(
      savedNotes.json().notesHtml,
    );
    const staleNotes = await notesPut(noteEvent.json().id, 1, {
      notesHtml: '<p>Fictional stale</p>',
    });
    expect(staleNotes.statusCode).toBe(409);
    const foreignNotes = await notesPut(foreignEvent.id, 1);
    expect(foreignNotes.statusCode).toBe(404);
    const missingCsrf = await app.inject({
      method: 'PUT',
      url: '/api/v1/events/' + noteEvent.json().id,
      cookies,
      payload: { ...simple, version: 2, notesHtml: '<p>Fictional blocked</p>' },
    });
    expect(missingCsrf.statusCode).toBe(403);
    const unauthenticated = await app.inject({
      method: 'PUT',
      url: '/api/v1/events/' + noteEvent.json().id,
      payload: { ...simple, version: 2, notesHtml: '<p>Fictional blocked</p>' },
    });
    expect(unauthenticated.statusCode).toBe(401);
    expect(
      (await eventRepository(pool, tenantId).detail(noteEvent.json().id)).event,
    ).toMatchObject({ version: 2, notesHtml: savedNotes.json().notesHtml });
    expect(
      (await eventRepository(pool, foreignTenant).detail(foreignEvent.id))
        .event,
    ).toMatchObject({ version: 1, notesHtml: simple.notesHtml });

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

    const fictionalContact = (name: string) => ({
      kind: 'private' as const,
      name,
      contactPerson: '',
      street: '',
      postalCode: '',
      city: '',
      country: 'DE',
      email: '',
      phone: '',
      mobile: '',
      state: 'active' as const,
    });
    const contacts = contactRepository(pool, tenantId);
    const [firstPrimary, nextPrimary, additional, historical, archivedNew] =
      await Promise.all([
        contacts.save(actorId, fictionalContact('Fictional first primary')),
        contacts.save(actorId, fictionalContact('Fictional next primary')),
        contacts.save(actorId, fictionalContact('Fictional additional')),
        contacts.save(
          actorId,
          fictionalContact('Fictional historical primary'),
        ),
        contacts.save(
          actorId,
          fictionalContact('Fictional archived new contact'),
        ),
      ]);
    const foreignContact = await contactRepository(pool, foreignTenant).save(
      foreignActor,
      fictionalContact('Fictional foreign contact'),
    );
    const putContacts = (
      version: number,
      primaryContactId: string | null,
      additionalContactIds: string[],
    ) =>
      app.inject({
        method: 'PUT',
        url: '/api/v1/events/' + created.json().id,
        cookies,
        headers,
        payload: {
          ...simple,
          status: 'unavailable',
          primaryContactId,
          additionalContactIds,
          version,
        },
      });
    const readContacts = async () =>
      app.inject({
        url: '/api/v1/events/' + created.json().id,
        cookies,
      });

    const first = await putContacts(2, firstPrimary.id, [additional.id]);
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({
      primaryContactId: firstPrimary.id,
      additionalContactIds: [additional.id],
      version: 3,
    });
    const changed = await putContacts(3, nextPrimary.id, [additional.id]);
    expect(changed.statusCode).toBe(200);
    expect(changed.json()).toMatchObject({
      primaryContactId: nextPrimary.id,
      additionalContactIds: [additional.id],
      version: 4,
    });
    expect(
      (await (await readContacts()).json()).contacts.map(
        (person: { id: string; role: string }) => [person.id, person.role],
      ),
    ).toEqual(
      expect.arrayContaining([
        [nextPrimary.id, 'primary'],
        [additional.id, 'additional'],
      ]),
    );

    const duplicate = await putContacts(4, nextPrimary.id, [
      nextPrimary.id,
      additional.id,
    ]);
    expect(duplicate.statusCode).toBe(400);
    expect(duplicate.json().error).toBe('invalid_reference');
    expect((await (await readContacts()).json()).event).toMatchObject({
      primaryContactId: nextPrimary.id,
      additionalContactIds: [additional.id],
      version: 4,
    });

    const foreign = await putContacts(4, foreignContact.id, [additional.id]);
    expect(foreign.statusCode).toBe(400);
    expect(foreign.json().error).toBe('invalid_reference');
    expect((await (await readContacts()).json()).event).toMatchObject({
      primaryContactId: nextPrimary.id,
      additionalContactIds: [additional.id],
      version: 4,
    });

    const historicalAssignment = await putContacts(4, historical.id, [
      additional.id,
    ]);
    expect(historicalAssignment.statusCode).toBe(200);
    await contacts.save(
      actorId,
      {
        ...fictionalContact('Fictional historical primary'),
        state: 'archived',
      },
      historical.id,
      1,
    );
    const preservedArchive = await putContacts(5, historical.id, [
      additional.id,
    ]);
    expect(preservedArchive.statusCode).toBe(200);
    expect(preservedArchive.json()).toMatchObject({
      primaryContactId: historical.id,
      additionalContactIds: [additional.id],
      version: 6,
    });

    await contacts.save(
      actorId,
      {
        ...fictionalContact('Fictional archived new contact'),
        state: 'archived',
      },
      archivedNew.id,
      1,
    );
    const newArchive = await putContacts(6, archivedNew.id, [additional.id]);
    expect(newArchive.statusCode).toBe(400);
    expect(newArchive.json().error).toBe('invalid_reference');
    expect((await (await readContacts()).json()).event).toMatchObject({
      primaryContactId: historical.id,
      additionalContactIds: [additional.id],
      version: 6,
    });

    const stale = await putContacts(5, nextPrimary.id, [additional.id]);
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error).toBe('conflict');
    expect((await (await readContacts()).json()).event).toMatchObject({
      primaryContactId: historical.id,
      additionalContactIds: [additional.id],
      version: 6,
    });

    const cleared = await putContacts(6, null, [additional.id]);
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json()).toMatchObject({
      primaryContactId: null,
      additionalContactIds: [additional.id],
      version: 7,
    });
    expect((await (await readContacts()).json()).contacts).toMatchObject([
      { id: additional.id, role: 'additional' },
    ]);

    // Additional contacts have the same isolation and archive rules as the
    // primary contact, even when several links change in one event version.
    const secondAdditional = await contacts.save(
      actorId,
      fictionalContact('Fictional second additional'),
    );
    const expanded = await putContacts(7, null, [
      additional.id,
      secondAdditional.id,
    ]);
    expect(expanded.statusCode).toBe(200);
    expect(expanded.json()).toMatchObject({
      additionalContactIds: expect.arrayContaining([
        additional.id,
        secondAdditional.id,
      ]),
      version: 8,
    });
    await contacts.save(
      actorId,
      { ...fictionalContact('Fictional additional'), state: 'archived' },
      additional.id,
      1,
    );
    const preserveAdditional = await putContacts(8, null, [
      additional.id,
      secondAdditional.id,
    ]);
    expect(preserveAdditional.statusCode).toBe(200);
    expect(preserveAdditional.json().version).toBe(9);
    for (const [rejected, error] of [
      [[additional.id, foreignContact.id], 'invalid_reference'],
      [[additional.id, archivedNew.id], 'invalid_reference'],
      [[additional.id, additional.id], 'invalid_request'],
    ] as const) {
      const response = await putContacts(9, null, [...rejected]);
      expect(response.statusCode).toBe(400);
      expect(response.json().error).toBe(error);
      expect((await (await readContacts()).json()).event).toMatchObject({
        additionalContactIds: expect.arrayContaining([
          additional.id,
          secondAdditional.id,
        ]),
        version: 9,
      });
    }
    const [removeFirst, removeSecond] = await Promise.all([
      putContacts(9, null, [secondAdditional.id]),
      putContacts(9, null, [additional.id]),
    ]);
    expect([removeFirst.statusCode, removeSecond.statusCode].sort()).toEqual([
      200, 409,
    ]);
    const winner =
      removeFirst.statusCode === 200 ? secondAdditional.id : additional.id;
    expect((await (await readContacts()).json()).event).toMatchObject({
      additionalContactIds: [winner],
      version: 10,
    });
    const clearedAdditional = await putContacts(10, null, []);
    expect(clearedAdditional.statusCode).toBe(200);
    expect(clearedAdditional.json()).toMatchObject({
      additionalContactIds: [],
      version: 11,
    });
    expect((await (await readContacts()).json()).contacts).toEqual([]);

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

test('hundreds of fictional contacts and events remain complete, isolated and responsive', async () => {
  const volumeTenant = randomUUID();
  await bootstrapAccess(
    pool,
    volumeTenant,
    'volume@example.invalid',
    'Fictional volume tenant',
    'UTC',
  );
  const sample = Array.from({ length: 500 }, (_, index) => ({
    id: randomUUID(),
    contactId: randomUUID(),
    suffix: String(index).padStart(4, '0'),
  }));
  const db = drizzle(pool);
  await db.insert(contactTable).values(
    sample.map((item, index) => ({
      tenantId: volumeTenant,
      id: item.contactId,
      kind: 'private',
      name: 'Fictional volume contact ' + item.suffix,
      contactPerson: '',
      street: '',
      postalCode: '',
      city: '',
      country: 'DE',
      email: 'volume-' + item.suffix + '@example.invalid',
      phone: '',
      mobile: '',
      phoneKey: '',
      mobileKey: '',
      state: index % 7 ? 'active' : 'archived',
    })),
  );
  await db.insert(eventTable).values(
    sample.map((item, index) => ({
      tenantId: volumeTenant,
      id: item.id,
      name: 'Fictional volume event ' + item.suffix,
      status: index % 5 ? 'inquiry' : 'cancelled',
      source: 'Fictional volume fixture',
      eventDate: '2030-01-01',
      startsAt: new Date('2030-01-01T18:00:00Z'),
      endsAt: new Date('2030-01-01T20:00:00Z'),
      timeZone: 'UTC',
      description: 'Fictional volume description',
      notesHtml: '<p>Fictional volume note</p>',
    })),
  );
  await db.insert(eventContactTable).values(
    sample.map((item) => ({
      tenantId: volumeTenant,
      eventId: item.id,
      contactId: item.contactId,
      role: 'primary',
    })),
  );
  const repo = eventRepository(pool, volumeTenant);
  const people = contactRepository(pool, volumeTenant);
  const times: Record<string, number[]> = {
    contacts: [],
    events: [],
    search: [],
    export: [],
  };
  const expectedNames = new Map<string, string>(
    sample.map((item) => [item.id, 'Fictional volume contact ' + item.suffix]),
  );
  for (let attempt = 0; attempt < 5; attempt++) {
    let start = performance.now();
    const listedContacts = await people.list();
    times.contacts!.push(performance.now() - start);
    expect(listedContacts).toHaveLength(500);
    start = performance.now();
    const listedEvents = await repo.list();
    times.events!.push(performance.now() - start);
    expect(listedEvents).toHaveLength(500);
    start = performance.now();
    const found = await repo.list(undefined, {
      q: 'Fictional volume contact 0499',
      from: '2030-01-01',
      to: '2030-01-01',
      status: 'inquiry',
    });
    times.search!.push(performance.now() - start);
    expect(found.map((row) => row.id)).toEqual([sample[499]!.id]);
    start = performance.now();
    const exported = await repo.exportRows();
    times.export!.push(performance.now() - start);
    expect(exported).toHaveLength(500);
    for (const row of exported)
      expect(row.primaryContactName).toBe(expectedNames.get(row.id));
  }
  for (const values of Object.values(times))
    expect(Math.max(...values)).toBeLessThan(2000);
  expect(await people.list('Fictional event contact')).toEqual([]);
  expect(await repo.list(undefined, { q: 'Synthetic event' })).toEqual([]);
  const maximumMs = Object.fromEntries(
    Object.entries(times).map(([key, values]) => [
      key,
      Math.ceil(Math.max(...values)),
    ]),
  );
  console.info(
    JSON.stringify({
      fictionalRecords: { contacts: 500, events: 500 },
      iterations: 5,
      maximumMs,
    }),
  );
});

test('the contact event projection never answers with a foreign tenant record', async () => {
  // BKP011.1: the reading contact record asks this projection for the events of
  // one contact. Two tenants each own one linked event, so an empty answer for
  // the foreign contact id is a real isolation proof and not a node without
  // data. The route stays a plain 200 with `[]` – no 404, no foreign row.
  const local = { tenant: randomUUID(), slug: 'local-contact-events' },
    foreign = { tenant: randomUUID(), slug: 'foreign-contact-events' };
  const people: Record<string, string> = {};
  const events: Record<string, string> = {};
  for (const tenant of [local, foreign]) {
    const email = tenant.slug + '@example.invalid';
    await bootstrapAccess(
      pool,
      tenant.tenant,
      email,
      'Fictional ' + tenant.slug,
      'Europe/Berlin',
    );
    const access = accessRepository(pool, tenant.tenant);
    await access.issueSession(
      { subject: tenant.slug, email },
      digest('synthetic-' + tenant.slug),
    );
    // The first sign-in creates the user, so the actor exists only afterwards.
    const actor = (await access.list())[0]!.userId!;
    const contact = await contactRepository(pool, tenant.tenant).save(actor, {
      kind: 'company' as const,
      name: 'Fictional ' + tenant.slug,
      contactPerson: '',
      street: '',
      postalCode: '',
      city: '',
      country: 'DE',
      email,
      phone: '',
      mobile: '',
      state: 'active' as const,
    });
    people[tenant.slug] = contact.id;
    const event = await eventRepository(pool, tenant.tenant).save(actor, {
      ...input,
      name: 'Fictional ' + tenant.slug + ' event',
      notesHtml: '',
      eventDate: '2026-11-20',
      startsAt: null,
      endsAt: null,
      primaryContactId: contact.id,
      additionalContactIds: [],
      eventTypeId: null,
      packageId: null,
      locationId: null,
    });
    events[tenant.slug] = event.id;
  }
  const config = {
    origin: 'https://admin.example.invalid',
    tenantId: local.tenant,
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
  registerEventRoutes(app, pool, local.tenant);
  const cookies = { '__Host-ak-session': 'synthetic-' + local.slug };
  try {
    const own = await app.inject({
      url: '/api/v1/contacts/' + people[local.slug] + '/events',
      cookies,
    });
    expect(own.statusCode).toBe(200);
    expect(own.json().map((row: { id: string }) => row.id)).toEqual([
      events[local.slug],
    ]);
    // The foreign event exists and is reachable only inside its own tenant.
    expect(
      await eventRepository(pool, foreign.tenant).list(people[foreign.slug]!),
    ).toHaveLength(1);
    for (const contactId of [people[foreign.slug]!, randomUUID()]) {
      const answer = await app.inject({
        url: '/api/v1/contacts/' + contactId + '/events',
        cookies,
      });
      expect(answer.statusCode).toBe(200);
      expect(answer.json()).toEqual([]);
    }
    expect(
      (
        await app.inject({
          url: '/api/v1/contacts/' + people[local.slug] + '/events',
        })
      ).statusCode,
    ).toBe(401);
  } finally {
    await app.close();
  }
});

// BKP014.2: the event list names the physical units an event holds. The
// projection is additive (one extra field per row), tenant-scoped and derived
// from stored reservations only — never from an estimated availability. A hold
// that lapsed and an archived unit stay visible but marked, and an overlap is
// reported only where two stored reservations really intersect.
test('the event list projects assigned units and marks stale, archived and overlapping ones', async () => {
  const own = randomUUID(),
    foreign = randomUUID();
  const startTenant = async (tenant: string, slug: string) => {
    const email = slug + '@example.invalid';
    await bootstrapAccess(
      pool,
      tenant,
      email,
      'Fictional ' + slug,
      'Europe/Berlin',
    );
    const access = accessRepository(pool, tenant);
    await access.issueSession(
      { subject: slug, email },
      digest('synthetic-' + slug),
    );
    return (await access.list())[0]!.userId!;
  };
  const actor = await startTenant(own, 'projection-units'),
    foreignActor = await startTenant(foreign, 'projection-foreign');
  const repo = eventRepository(pool, own),
    reservationsRepo = reservationRepository(pool, own),
    resources = resourceRepository(pool, own);
  const resource = async (
    name: string,
    code: string,
    category: string,
    quantity: number,
    position: number,
  ) =>
    resources.save(actor, {
      name,
      code,
      category,
      description: 'Fictional fixture',
      quantity,
      beforeDays: 0,
      afterDays: 0,
      blocked: false,
      state: 'active',
      position,
    });
  const box = await resource('FB9', 'FB9', 'Fotobox', 2, 0),
    light = await resource('LAMP9', 'LAMP9', 'Licht', 1, 1),
    old = await resource('ALT9', 'ALT9', 'Fotobox', 1, 2);
  const units = {
    box1: (await reservationsRepo.units(box.id))[0]!.id,
    box2: (await reservationsRepo.units(box.id))[1]!.id,
    light1: (await reservationsRepo.units(light.id))[0]!.id,
    old1: (await reservationsRepo.units(old.id))[0]!.id,
  };
  const eventInput = (name: string, eventDate: string) => ({
    ...input,
    name,
    status: 'option' as const,
    eventDate,
    startsAt: null,
    endsAt: null,
    primaryContactId: null,
    additionalContactIds: [],
    eventTypeId: null,
    packageId: null,
    locationId: null,
    notesHtml: '',
  });
  const db = drizzle(pool);
  const assign = async (
    eventId: string,
    unitId: string,
    state: 'hold' | 'booked',
    window: [string, string],
    expiresAt: Date | null = null,
  ) => {
    const id = randomUUID();
    await db.insert(reservationTable).values({
      tenantId: own,
      id,
      requestId: id,
      requestHash: '0'.repeat(64),
      eventId,
      unitId,
      state,
      periodSource: 'event',
      baseStart: new Date(window[0]),
      baseEnd: new Date(window[1]),
      timeZone: 'Europe/Berlin',
      beforeDays: 0,
      afterDays: 0,
      startsAt: new Date(window[0]),
      endsAt: new Date(window[1]),
      expiresAt: state === 'hold' ? expiresAt : null,
    });
    return id;
  };
  const bookedEvent = async (
    name: string,
    window: [string, string],
    unitId: string,
  ) =>
    repo.save(
      actor,
      {
        ...eventInput(name, window[0].slice(0, 10)),
        status: 'booked',
        startsAt: window[0],
        endsAt: window[1],
      },
      undefined,
      undefined,
      [
        {
          unitId,
          periodSource: 'manual',
          baseStart: window[0],
          baseEnd: window[1],
        },
      ],
    );

  await repo.save(
    actor,
    eventInput('Fictional event without a unit', '2031-04-01'),
  );
  await bookedEvent(
    'Fictional event with one box',
    ['2031-05-01T18:00:00Z', '2031-05-01T22:00:00Z'],
    units.box1,
  );
  // Two options, each holding a different unit, keep the order of the plan.
  const many = await repo.save(
    actor,
    eventInput('Fictional event with two units', '2031-05-03'),
  );
  await assign(
    many.id,
    units.box2,
    'hold',
    ['2031-05-03T10:00:00Z', '2031-05-03T14:00:00Z'],
    new Date(Date.now() + 86400000),
  );
  await assign(
    many.id,
    units.light1,
    'hold',
    ['2031-05-03T10:00:00Z', '2031-05-03T14:00:00Z'],
    new Date(Date.now() + 86400000),
  );
  const archived = await bookedEvent(
    'Fictional event on an archived unit',
    ['2031-09-01T10:00:00Z', '2031-09-01T12:00:00Z'],
    units.old1,
  );
  // Time passes: the stored booking of this event moves into the past, which is
  // what lets the unit be retired. Both rows stay one consistent pair.
  await pool.query(
    "UPDATE events SET event_date='2026-05-02', starts_at='2026-05-02T10:00:00Z', ends_at='2026-05-02T12:00:00Z' WHERE tenant_id=$1 AND id=$2",
    [own, archived.id],
  );
  await pool.query(
    "UPDATE reservations SET base_start='2026-05-02T10:00:00Z', base_end='2026-05-02T12:00:00Z', starts_at='2026-05-02T10:00:00Z', ends_at='2026-05-02T12:00:00Z' WHERE tenant_id=$1 AND event_id=$2",
    [own, archived.id],
  );
  // A retired unit keeps its historical assignment: the past reservation does
  // not block the archive step, and the unit itself turns inactive.
  await resources.save(
    actor,
    {
      name: 'ALT9',
      code: 'ALT9',
      category: 'Fotobox',
      description: 'Fictional fixture',
      quantity: 0,
      beforeDays: 0,
      afterDays: 0,
      blocked: false,
      state: 'archived',
      position: 2,
    },
    old.id,
    1,
  );
  // Two stored reservations on one unit really intersect: a booked box and an
  // option's hold. Both rows name the overlap; no row invents availability.
  await bookedEvent(
    'Fictional booked box',
    ['2031-06-01T10:00:00Z', '2031-06-01T14:00:00Z'],
    units.box1,
  );
  const overlapHold = await repo.save(
    actor,
    eventInput('Fictional overlapping option', '2031-06-01'),
  );
  await assign(
    overlapHold.id,
    units.box1,
    'hold',
    ['2031-06-01T13:00:00Z', '2031-06-01T17:00:00Z'],
    new Date(Date.now() + 86400000),
  );
  // A closed period on the same unit is not an overlap.
  await db.insert(reservationTable).values({
    tenantId: own,
    id: randomUUID(),
    requestId: randomUUID(),
    requestHash: '1'.repeat(64),
    eventId: null,
    unitId: units.box1,
    state: 'blocked',
    periodSource: 'manual',
    baseStart: new Date('2031-07-01T00:00:00Z'),
    baseEnd: new Date('2031-07-02T00:00:00Z'),
    timeZone: 'Europe/Berlin',
    beforeDays: 0,
    afterDays: 0,
    startsAt: new Date('2031-07-01T00:00:00Z'),
    endsAt: new Date('2031-07-02T00:00:00Z'),
    expiresAt: null,
  });
  // The lapsed hold is written last: every later event save sweeps expired
  // holds, and this row has to stay the unswept stored fact it is.
  const stale = await repo.save(
    actor,
    eventInput('Fictional event with a lapsed hold', '2031-05-04'),
  );
  await assign(
    stale.id,
    units.light1,
    'hold',
    ['2031-08-01T10:00:00Z', '2031-08-01T14:00:00Z'],
    new Date(Date.now() - 3600000),
  );

  const listing = await repo.listWithCounts();
  const byName = new Map(listing.events.map((row) => [row.name, row]));
  const summary = (name: string) => {
    const found = byName.get(name);
    expect(found, 'listed event ' + name).toBeDefined();
    return found!.resources;
  };
  // Without an assignment the projection answers an empty list, not a guess.
  expect(summary('Fictional event without a unit')).toEqual({
    units: [],
    assigned: 0,
    booked: 0,
    hold: 0,
    conflict: false,
  });
  // One physical box, named with its resource and ordinal.
  expect(summary('Fictional event with one box')).toMatchObject({
    assigned: 1,
    booked: 1,
    hold: 0,
    conflict: false,
  });
  expect(summary('Fictional event with one box').units).toEqual([
    {
      unitId: units.box1,
      name: 'FB9',
      code: 'FB9',
      ordinal: 1,
      state: 'booked',
      stale: false,
      unitEnabled: true,
      resourceState: 'active',
      resourceBlocked: false,
      conflict: false,
    },
  ]);
  // Several units keep the stable resource order of the plan view.
  expect(
    summary('Fictional event with two units').units.map((unit) => [
      unit.code,
      unit.ordinal,
      unit.state,
    ]),
  ).toEqual([
    ['FB9', 2, 'hold'],
    ['LAMP9', 1, 'hold'],
  ]);
  expect(summary('Fictional event with two units')).toMatchObject({
    assigned: 2,
    booked: 0,
    hold: 2,
    conflict: false,
  });
  // A lapsed hold stays visible as the stored fact it is, marked stale, and it
  // counts as no current assignment.
  expect(summary('Fictional event with a lapsed hold').units).toMatchObject([
    { code: 'LAMP9', ordinal: 1, state: 'hold', stale: true },
  ]);
  expect(summary('Fictional event with a lapsed hold')).toMatchObject({
    assigned: 0,
    booked: 0,
    hold: 0,
  });
  // The archived unit keeps the assignment and says so.
  expect(summary('Fictional event on an archived unit').units).toMatchObject([
    {
      code: 'ALT9',
      ordinal: 1,
      state: 'booked',
      stale: false,
      unitEnabled: false,
      resourceState: 'archived',
    },
  ]);
  expect(summary('Fictional event on an archived unit').assigned).toBe(1);
  // Only the real intersection reports a conflict, on both affected events.
  expect(summary('Fictional booked box').conflict).toBe(true);
  expect(summary('Fictional booked box').units[0]!.conflict).toBe(true);
  expect(summary('Fictional overlapping option').conflict).toBe(true);
  expect(summary('Fictional overlapping option').units[0]!.conflict).toBe(true);
  // The closed July period on the same unit does not reach the May booking.
  expect(summary('Fictional event with one box').conflict).toBe(false);

  // The foreign tenant sees its own assignment only, never this tenant's.
  const foreignResource = await resourceRepository(pool, foreign).save(
    foreignActor,
    {
      name: 'FREMDE9',
      code: 'FREMDE9',
      category: 'Fotobox',
      description: 'Fictional fixture',
      quantity: 1,
      beforeDays: 0,
      afterDays: 0,
      blocked: false,
      state: 'active',
      position: 0,
    },
  );
  const foreignUnit = (
    await reservationRepository(pool, foreign).units(foreignResource.id)
  )[0]!.id;
  const foreignEvent = await eventRepository(pool, foreign).save(foreignActor, {
    ...eventInput('Fictional foreign event', '2031-05-01'),
    source: 'Fictional foreign fixture',
  });
  const foreignDb = drizzle(pool);
  await foreignDb.insert(reservationTable).values({
    tenantId: foreign,
    id: randomUUID(),
    requestId: randomUUID(),
    requestHash: '2'.repeat(64),
    eventId: foreignEvent.id,
    unitId: foreignUnit,
    state: 'booked',
    periodSource: 'event',
    baseStart: new Date('2031-05-01T08:00:00Z'),
    baseEnd: new Date('2031-05-01T09:00:00Z'),
    timeZone: 'Europe/Berlin',
    beforeDays: 0,
    afterDays: 0,
    startsAt: new Date('2031-05-01T08:00:00Z'),
    endsAt: new Date('2031-05-01T09:00:00Z'),
    expiresAt: null,
  });
  const ours = await repo.listWithCounts();
  expect(
    ours.events.some((row) => row.name === 'Fictional foreign event'),
  ).toBe(false);
  const ownUnitIds = new Set(Object.values(units));
  for (const row of ours.events)
    for (const unit of row.resources.units) {
      expect(ownUnitIds.has(unit.unitId)).toBe(true);
      expect(unit.unitId).not.toBe(foreignUnit);
      expect(unit.name).not.toBe('FREMDE9');
    }
  expect(
    (await eventRepository(pool, foreign).listWithCounts()).events.map(
      (row) => [row.name, row.resources.units.map((unit) => unit.code)],
    ),
  ).toEqual([['Fictional foreign event', ['FREMDE9']]]);

  // The wire answer carries the same projection and keeps the rest of the row.
  const config = {
    origin: 'https://admin.example.invalid',
    tenantId: own,
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
  registerEventRoutes(app, pool, own);
  try {
    const answer = await app.inject({
      url: '/api/v1/events?from=2031-05-01&to=2031-05-31',
      cookies: { '__Host-ak-session': 'synthetic-projection-units' },
    });
    expect(answer.statusCode).toBe(200);
    const body = answer.json();
    expect(Object.keys(body).sort()).toEqual([
      'events',
      'filterCounts',
      'timeZone',
    ]);
    expect(body.events.map((row: { name: string }) => row.name)).toEqual([
      'Fictional event with one box',
      'Fictional event with two units',
      'Fictional event with a lapsed hold',
    ]);
    for (const row of body.events) {
      expect(row).toMatchObject({
        name: expect.any(String),
        status: expect.any(String),
        resources: { assigned: expect.any(Number) },
      });
      expect(row.tenantId).toBeUndefined();
    }
    const wire = body.events.find(
      (row: { name: string }) => row.name === 'Fictional event with one box',
    );
    expect(wire.resources).toEqual(summary('Fictional event with one box'));
    expect(Object.keys(wire.resources.units[0]).sort()).toEqual([
      'code',
      'conflict',
      'name',
      'ordinal',
      'resourceBlocked',
      'resourceState',
      'stale',
      'state',
      'unitEnabled',
      'unitId',
    ]);
  } finally {
    await app.close();
  }
});

// The projection is one statement beside the list. One event and fifty events
// cost the same single reservation read — never one query per listed event.
test('the resident list reads the reservations once for one and for fifty events', async () => {
  const tenant = randomUUID(),
    email = 'projection-volume@example.invalid';
  await bootstrapAccess(
    pool,
    tenant,
    email,
    'Fictional volume',
    'Europe/Berlin',
  );
  const access = accessRepository(pool, tenant);
  await access.issueSession(
    { subject: 'projection-volume', email },
    digest('synthetic-projection-volume'),
  );
  const actor = (await access.list())[0]!.userId!;
  const repo = eventRepository(pool, tenant),
    resources = resourceRepository(pool, tenant);
  const box = await resources.save(actor, {
    name: 'VOL9',
    code: 'VOL9',
    category: 'Fotobox',
    description: 'Fictional fixture',
    quantity: 1,
    beforeDays: 0,
    afterDays: 0,
    blocked: false,
    state: 'active',
    position: 0,
  });
  const unitId = (await reservationRepository(pool, tenant).units(box.id))[0]!
    .id;
  const db = drizzle(pool);
  const create = async (index: number) => {
    const row = await repo.save(actor, {
      ...input,
      name: 'Fictional volume event ' + String(index).padStart(3, '0'),
      status: 'option',
      eventDate: '2032-01-01',
      startsAt: null,
      endsAt: null,
      primaryContactId: null,
      additionalContactIds: [],
      eventTypeId: null,
      packageId: null,
      locationId: null,
      notesHtml: '',
    });
    // One shared unit, one distinct minute per event: the bookings never
    // overlap, so the exclusion constraint stays satisfied.
    const begins = new Date(Date.UTC(2032, 0, 1, 10, index)),
      ends = new Date(begins.getTime() + 60000);
    await db.insert(reservationTable).values({
      tenantId: tenant,
      id: randomUUID(),
      requestId: randomUUID(),
      requestHash: String(index).padStart(64, '0').slice(0, 64),
      eventId: row.id,
      unitId,
      state: 'booked',
      periodSource: 'event',
      baseStart: begins,
      baseEnd: ends,
      timeZone: 'Europe/Berlin',
      beforeDays: 0,
      afterDays: 0,
      startsAt: begins,
      endsAt: ends,
      expiresAt: null,
    });
    return row;
  };
  const config = {
    origin: 'https://admin.example.invalid',
    tenantId: tenant,
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
  registerEventRoutes(app, pool, tenant);
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
  const wrapped = new WeakSet<object>();
  pool.connect = ((...args: unknown[]) => {
    if (typeof args[0] === 'function')
      return (connect as (...rest: unknown[]) => unknown)(...args);
    return (async () => {
      const client = await (connect as () => Promise<unknown>)();
      const target = client as { query: (...sent: unknown[]) => unknown };
      if (wrapped.has(target)) return client;
      wrapped.add(target);
      const send = target.query.bind(target);
      target.query = (...sent: unknown[]) => {
        record(sent[0]);
        return send(...sent);
      };
      return client;
    })();
  }) as typeof pool.connect;
  pool.query = ((...args: unknown[]) => {
    record(args[0]);
    return (query as (...rest: unknown[]) => unknown)(...args);
  }) as typeof pool.query;
  const readsFor = async () => {
    const before = statements.length;
    const answer = await app.inject({
      url: '/api/v1/events?from=2032-01-01&to=2032-01-01',
      cookies: { '__Host-ak-session': 'synthetic-projection-volume' },
    });
    expect(answer.statusCode).toBe(200);
    return {
      listed: answer.json().events.length,
      reservations: statements
        .slice(before)
        .filter((statement) => /from\s+"reservations"/i.test(statement)).length,
    };
  };
  try {
    await create(1);
    expect(await readsFor()).toEqual({ listed: 1, reservations: 1 });
    for (let index = 2; index <= 50; index += 1) await create(index);
    expect(await readsFor()).toEqual({ listed: 50, reservations: 1 });
  } finally {
    pool.connect = connect;
    pool.query = query;
    await app.close();
  }
});
