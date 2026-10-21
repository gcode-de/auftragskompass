import { afterAll, beforeAll, expect, test } from 'vitest';
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
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
import { locationRepository } from '../../packages/core/src/locations.js';

let container: StartedPostgreSqlContainer;
let pool: Pool;
const tenantId = randomUUID(),
  otherTenantId = randomUUID();
let actorId: string, otherActorId: string;

const input = {
  name: 'Synthetic venue event',
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
  notesHtml: '',
};

async function createTenant(id: string, email: string) {
  await bootstrapAccess(pool, id, email, 'Synthetic venue', 'Europe/Berlin');
  await accessRepository(pool, id).issueSession(
    { subject: email, email },
    `${email}-digest`,
  );
  return (await accessRepository(pool, id).list())[0]!.userId!;
}

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:17.6-alpine').start();
  pool = new Pool({ connectionString: container.getConnectionUri() });
  await migrate(pool);
  actorId = await createTenant(tenantId, 'venue@example.invalid');
  otherActorId = await createTenant(
    otherTenantId,
    'other-venue@example.invalid',
  );
});
afterAll(async () => {
  await pool?.end();
  await container?.stop();
});

async function rawEvent(id: string) {
  return (
    await pool.query<{
      venue: string | null;
      venue_override: boolean;
      location_id: string | null;
    }>(
      'SELECT venue, venue_override, location_id FROM events WHERE tenant_id=$1 AND id=$2',
      [tenantId, id],
    )
  ).rows[0]!;
}

test('a fresh booking stores no place and exports the legacy columns empty', async () => {
  const repo = eventRepository(pool, tenantId),
    row = await repo.save(actorId, input);
  expect(row).toMatchObject({
    venue: null,
    venueOverride: false,
    locationId: null,
  });
  expect((await repo.detail(row.id)).location).toBeNull();
  const exported = (await repo.exportRows()).find(
    (entry) => entry.id === row.id,
  )!;
  expect(exported.locationId).toBe('');
  expect(exported.locationName).toBe('');
  expect(await rawEvent(row.id)).toEqual({
    venue: null,
    venue_override: false,
    location_id: null,
  });
});

test('a freeform place is trimmed, keeps line breaks and is visible everywhere', async () => {
  const repo = eventRepository(pool, tenantId),
    row = await repo.save(actorId, {
      ...input,
      name: 'Synthetic freeform',
      venue: '  Fictional Hall\nSide entrance, second floor  ',
    });
  expect(row.venue).toBe('Fictional Hall\nSide entrance, second floor');
  expect(row.venueOverride).toBe(true);
  const exported = (await repo.exportRows()).find(
    (entry) => entry.id === row.id,
  )!;
  expect(exported.locationName).toBe(
    'Fictional Hall\nSide entrance, second floor',
  );
  expect(exported.locationId).toBe('');
  expect(
    (await repo.list(undefined, { q: 'Side entrance' })).map((r) => r.id),
  ).toEqual([row.id]);
});

test('the documented length bound is enforced and leaves the row untouched', async () => {
  const repo = eventRepository(pool, tenantId),
    row = await repo.save(actorId, {
      ...input,
      venue: 'Fictional bounded hall',
    });
  await expect(
    repo.save(
      actorId,
      { ...input, venue: 'x'.repeat(1001) },
      row.id,
      row.version,
    ),
  ).rejects.toThrow('invalid_fields');
  expect((await rawEvent(row.id)).venue).toBe('Fictional bounded hall');
  await expect(
    pool.query('UPDATE events SET venue=$1 WHERE tenant_id=$2 AND id=$3', [
      'x'.repeat(1001),
      tenantId,
      row.id,
    ]),
  ).rejects.toMatchObject({ code: '23514' });
  await expect(
    repo.save(
      actorId,
      { ...input, venue: 'ü'.repeat(1000) },
      row.id,
      row.version,
    ),
  ).resolves.toMatchObject({ venue: 'ü'.repeat(1000), venueOverride: true });
});

test('legacy records keep their exact place, id and export values', async () => {
  const repo = eventRepository(pool, tenantId),
    venue = await locationRepository(pool, tenantId).save(actorId, {
      name: 'Synthetic Legacy Hall',
      street: 'Fictional Street 5',
      postalCode: '12345',
      city: 'Fictional Town',
      country: 'DE',
      state: 'active',
    }),
    row = await repo.save(actorId, {
      ...input,
      name: 'Synthetic legacy',
      locationId: venue.id,
    }),
    detail = await repo.detail(row.id);
  expect(row).toMatchObject({ venue: null, venueOverride: false });
  expect(detail.location).toEqual({
    id: venue.id,
    name: 'Synthetic Legacy Hall',
    street: 'Fictional Street 5',
    postalCode: '12345',
    city: 'Fictional Town',
    country: 'DE',
  });
  const exported = (await repo.exportRows()).find(
    (entry) => entry.id === row.id,
  )!;
  expect(exported.locationId).toBe(venue.id);
  expect(exported.locationName).toBe('Synthetic Legacy Hall');
});

test('a new place replaces only the effective venue and keeps the raw legacy link', async () => {
  const repo = eventRepository(pool, tenantId),
    venue = await locationRepository(pool, tenantId).save(actorId, {
      name: 'Synthetic Replaced Hall',
      street: 'Fictional Street 6',
      postalCode: '12345',
      city: 'Fictional Town',
      country: 'DE',
      state: 'active',
    }),
    row = await repo.save(actorId, {
      ...input,
      name: 'Synthetic replaced',
      locationId: venue.id,
    }),
    saved = await repo.save(
      actorId,
      {
        ...input,
        name: 'Synthetic replaced',
        locationId: venue.id,
        venue: 'Fictional Garden',
        venueOverride: true,
      },
      row.id,
      row.version,
    );
  expect(saved).toMatchObject({
    venue: 'Fictional Garden',
    venueOverride: true,
  });
  expect((await rawEvent(row.id)).location_id).toBe(venue.id);
  const exported = (await repo.exportRows()).find(
    (entry) => entry.id === row.id,
  )!;
  expect(exported.locationName).toBe('Fictional Garden');
  expect(exported.locationId).toBe('');
});

test('an intentional clear shows nothing while the legacy data survives', async () => {
  const repo = eventRepository(pool, tenantId),
    venue = await locationRepository(pool, tenantId).save(actorId, {
      name: 'Synthetic Cleared Hall',
      street: 'Fictional Street 7',
      postalCode: '12345',
      city: 'Fictional Town',
      country: 'DE',
      state: 'active',
    }),
    row = await repo.save(actorId, {
      ...input,
      name: 'Synthetic cleared',
      locationId: venue.id,
    }),
    saved = await repo.save(
      actorId,
      {
        ...input,
        name: 'Synthetic cleared',
        locationId: venue.id,
        venue: '',
        venueOverride: true,
      },
      row.id,
      row.version,
    );
  expect(saved).toMatchObject({ venue: '', venueOverride: true });
  expect((await rawEvent(row.id)).location_id).toBe(venue.id);
  const exported = (await repo.exportRows()).find(
    (entry) => entry.id === row.id,
  )!;
  expect(exported.locationName).toBe('');
  expect(exported.locationId).toBe('');
  expect(await repo.list(undefined, { q: 'Synthetic Cleared Hall' })).toEqual(
    [],
  );
  expect(await repo.list(undefined, { q: 'Fictional Street 7' })).toEqual([]);
});

test('an old full write without the new properties keeps text and override', async () => {
  const repo = eventRepository(pool, tenantId),
    row = await repo.save(actorId, {
      ...input,
      name: 'Synthetic old client',
      venue: 'Fictional Old Client Hall',
      venueOverride: true,
    }),
    saved = await repo.save(
      actorId,
      { ...input, name: 'Synthetic old client renamed' },
      row.id,
      row.version,
    );
  expect(saved).toMatchObject({
    name: 'Synthetic old client renamed',
    venue: 'Fictional Old Client Hall',
    venueOverride: true,
  });
});

test('an old full write that changes the legacy link drops only the override', async () => {
  const repo = eventRepository(pool, tenantId),
    first = await locationRepository(pool, tenantId).save(actorId, {
      name: 'Synthetic First Hall',
      street: '',
      postalCode: '',
      city: '',
      country: 'DE',
      state: 'active',
    }),
    second = await locationRepository(pool, tenantId).save(actorId, {
      name: 'Synthetic Second Hall',
      street: '',
      postalCode: '',
      city: '',
      country: 'DE',
      state: 'active',
    }),
    row = await repo.save(actorId, {
      ...input,
      name: 'Synthetic link change',
      locationId: first.id,
      venue: 'Fictional Hidden Hall',
      venueOverride: true,
    }),
    saved = await repo.save(
      actorId,
      { ...input, name: 'Synthetic link change', locationId: second.id },
      row.id,
      row.version,
    );
  expect(saved).toMatchObject({
    venue: 'Fictional Hidden Hall',
    venueOverride: false,
  });
  const exported = (await repo.exportRows()).find(
    (entry) => entry.id === row.id,
  )!;
  expect(exported.locationId).toBe(second.id);
  expect(exported.locationName).toBe('Synthetic Second Hall');
});

test('explicit null reverts to the stored legacy place', async () => {
  const repo = eventRepository(pool, tenantId),
    venue = await locationRepository(pool, tenantId).save(actorId, {
      name: 'Synthetic Revert Hall',
      street: '',
      postalCode: '',
      city: '',
      country: 'DE',
      state: 'active',
    }),
    row = await repo.save(actorId, {
      ...input,
      name: 'Synthetic revert',
      locationId: venue.id,
      venue: 'Fictional Temporary',
      venueOverride: true,
    }),
    saved = await repo.save(
      actorId,
      {
        ...input,
        name: 'Synthetic revert',
        locationId: venue.id,
        venue: null,
        venueOverride: false,
      },
      row.id,
      row.version,
    );
  expect(saved).toMatchObject({ venue: null, venueOverride: false });
  const exported = (await repo.exportRows()).find(
    (entry) => entry.id === row.id,
  )!;
  expect(exported.locationName).toBe('Synthetic Revert Hall');
});

test('a duplicate keeps the raw flags, link and visible place', async () => {
  const repo = eventRepository(pool, tenantId),
    venue = await locationRepository(pool, tenantId).save(actorId, {
      name: 'Synthetic Duplicate Hall',
      street: '',
      postalCode: '',
      city: '',
      country: 'DE',
      state: 'active',
    }),
    source = await repo.save(actorId, {
      ...input,
      name: 'Synthetic duplicate source',
      locationId: venue.id,
      venue: 'Fictional Copy Hall',
      venueOverride: true,
    }),
    copy = await repo.save(actorId, {
      ...input,
      name: 'Synthetic duplicate source (Kopie)',
      locationId: source.locationId,
      venue: source.venue,
      venueOverride: source.venueOverride,
    });
  expect(copy).toMatchObject({
    venue: 'Fictional Copy Hall',
    venueOverride: true,
    locationId: venue.id,
  });
  expect(
    (await repo.exportRows()).find((entry) => entry.id === copy.id)!
      .locationName,
  ).toBe('Fictional Copy Hall');
});

test('a dormant free-form value is not searchable and archived legacy links stay rejected', async () => {
  const repo = eventRepository(pool, tenantId),
    dormant = await repo.save(actorId, {
      ...input,
      name: 'Synthetic dormant place',
      venue: 'Fictional Dormant Hall',
      venueOverride: false,
    });
  expect(dormant).toMatchObject({
    venue: 'Fictional Dormant Hall',
    venueOverride: false,
  });
  expect(await repo.list(undefined, { q: 'Fictional Dormant Hall' })).toEqual(
    [],
  );
  expect(
    await repo.list(undefined, { q: 'Synthetic dormant place' }),
  ).toHaveLength(1);
  const archived = await locationRepository(pool, tenantId).save(actorId, {
    name: 'Synthetic Archived Reference',
    street: '',
    postalCode: '',
    city: '',
    country: 'DE',
    state: 'archived',
  });
  await expect(
    repo.save(actorId, {
      ...input,
      name: 'Synthetic archived reference',
      locationId: archived.id,
    }),
  ).rejects.toThrow('invalid_reference');
});

test('places stay inside their tenant for reads, writes and search', async () => {
  const repo = eventRepository(pool, tenantId),
    foreign = eventRepository(pool, otherTenantId),
    row = await repo.save(actorId, {
      ...input,
      name: 'Synthetic tenant hall',
      venue: 'Fictional Tenant Hall',
    });
  expect(await foreign.list(undefined, { q: 'Fictional Tenant Hall' })).toEqual(
    [],
  );
  await expect(foreign.detail(row.id)).rejects.toThrow('not_found');
  await expect(
    foreign.save(
      otherActorId,
      {
        ...input,
        name: 'Synthetic tenant hall',
        venue: 'Fictional Tenant Hall',
      },
      row.id,
      1,
    ),
  ).rejects.toThrow('not_found');
});

test('upgrading a database created before this migration keeps every legacy row', async () => {
  await pool.query('CREATE DATABASE synthetic_venue_upgrade');
  const url = new URL(container.getConnectionUri());
  url.pathname = '/synthetic_venue_upgrade';
  const upgrade = new Pool({ connectionString: url.href });
  try {
    const names = (
      await readdir(new URL('../../packages/core/migrations/', import.meta.url))
    )
      .filter((name) => name.endsWith('.sql'))
      .sort();
    const before = names.filter((name) => name < '0032');
    expect(before.at(-1)).toBe('0031_document_logos.sql');
    await migrate(
      upgrade,
      await Promise.all(
        before.map(async (name) => ({
          name,
          sql: await readFile(
            new URL('../../packages/core/migrations/' + name, import.meta.url),
            'utf8',
          ),
        })),
      ),
    );
    const upgradeTenant = randomUUID(),
      location = randomUUID(),
      event = randomUUID();
    await upgrade.query(
      'INSERT INTO tenants (id,name,timezone) VALUES ($1,$2,$3)',
      [upgradeTenant, 'Synthetic upgrade venue', 'Europe/Berlin'],
    );
    await upgrade.query(
      `INSERT INTO locations (tenant_id,id,name,street,postal_code,city,country,state,version)
       VALUES ($1,$2,'Fictional Upgrade Hall','Fictional Street 8','12345','Fictional Town','DE','active',1)`,
      [upgradeTenant, location],
    );
    await upgrade.query(
      `INSERT INTO events (tenant_id,id,name,status,location_id,source,event_date,time_zone,description,notes_html,version)
       VALUES ($1,$2,'Synthetic upgrade event','inquiry',$3,'Fictional source','2030-10-27','Europe/Berlin','Fictional description','<strong>Fictional legacy note</strong>',3)`,
      [upgradeTenant, event, location],
    );
    const countBefore = (
      await upgrade.query<{ count: string }>(
        'SELECT count(*) FROM ak_migrations',
      )
    ).rows[0]!.count;
    await migrate(upgrade);
    await migrate(upgrade);
    expect(
      (
        await upgrade.query<{ count: string }>(
          'SELECT count(*) FROM ak_migrations',
        )
      ).rows[0]!.count,
    ).toBe(String(Number(countBefore) + names.length - before.length));
    const row = (
      await upgrade.query<{
        venue: string | null;
        venue_override: boolean;
        location_id: string | null;
        name: string;
        event_date: string | null;
      }>(
        'SELECT venue, venue_override, location_id, name, event_date::text FROM events WHERE tenant_id=$1',
        [upgradeTenant],
      )
    ).rows[0]!;
    expect(row).toEqual({
      venue: null,
      venue_override: false,
      location_id: location,
      name: 'Synthetic upgrade event',
      event_date: '2030-10-27',
    });
    expect(
      (
        await upgrade.query<{ street: string; city: string; name: string }>(
          'SELECT name, street, city FROM locations WHERE tenant_id=$1',
          [upgradeTenant],
        )
      ).rows[0],
    ).toEqual({
      name: 'Fictional Upgrade Hall',
      street: 'Fictional Street 8',
      city: 'Fictional Town',
    });
  } finally {
    await upgrade.end();
  }
});

async function httpApp(token: string) {
  const config = {
      origin: 'https://admin.example.invalid',
      tenantId,
      clientId: 'synthetic',
      clientSecret: 'synthetic',
    },
    app = createHealthServer(
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
  await accessRepository(pool, tenantId).issueSession(
    { subject: 'venue@example.invalid', email: 'venue@example.invalid' },
    digest(token),
  );
  await registerAuth(
    app,
    pool,
    config,
    (await syntheticGoogle(config)).provider,
  );
  registerEventRoutes(app, pool, tenantId);
  return {
    app,
    cookies: { '__Host-ak-session': token },
    headers: { origin: config.origin, 'x-csrf-token': digest('csrf:' + token) },
  };
}

test('the HTTP contract keeps old full writes valid and validates the new properties', async () => {
  const { app, cookies, headers } = await httpApp('synthetic-venue-http');
  try {
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/events',
          payload: { ...input, venue: 'Fictional Hall', venueOverride: true },
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/events',
          cookies,
          payload: { ...input, venue: 'Fictional Hall', venueOverride: true },
        })
      ).statusCode,
    ).toBe(403);
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/events',
      cookies,
      headers,
      payload: { ...input, venue: 'Fictional Hall', venueOverride: true },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      venue: 'Fictional Hall',
      venueOverride: true,
    });
    const id = created.json().id as string,
      version = created.json().version as number;
    const listed = await app.inject({ url: '/api/v1/events', cookies });
    expect(listed.statusCode).toBe(200);
    expect(
      (listed.json().events as { id: string }[]).find((row) => row.id === id),
    ).toMatchObject({ venue: 'Fictional Hall', venueOverride: true });
    expect(
      (await app.inject({ url: '/api/v1/events/' + id, cookies })).json().event,
    ).toMatchObject({ venue: 'Fictional Hall', venueOverride: true });
    expect(
      (
        await app.inject({
          method: 'PUT',
          url: '/api/v1/events/' + id,
          cookies,
          headers,
          payload: {
            ...input,
            version,
            venue: 'x'.repeat(1001),
            venueOverride: true,
          },
        })
      ).statusCode,
    ).toBe(400);
    // An old client sends neither property; the stored place survives.
    const oldClient = await app.inject({
      method: 'PUT',
      url: '/api/v1/events/' + id,
      cookies,
      headers,
      payload: { ...input, name: 'Synthetic HTTP old client', version },
    });
    expect(oldClient.statusCode).toBe(200);
    expect(oldClient.json()).toMatchObject({
      name: 'Synthetic HTTP old client',
      venue: 'Fictional Hall',
      venueOverride: true,
    });
    const cleared = await app.inject({
      method: 'PUT',
      url: '/api/v1/events/' + id,
      cookies,
      headers,
      payload: {
        ...input,
        name: 'Synthetic HTTP old client',
        version: oldClient.json().version,
        venue: '',
        venueOverride: true,
      },
    });
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json()).toMatchObject({ venue: '', venueOverride: true });
    const reverted = await app.inject({
      method: 'PUT',
      url: '/api/v1/events/' + id,
      cookies,
      headers,
      payload: {
        ...input,
        name: 'Synthetic HTTP old client',
        version: cleared.json().version,
        venue: null,
        venueOverride: false,
      },
    });
    expect(reverted.statusCode).toBe(200);
    expect(reverted.json()).toMatchObject({
      venue: null,
      venueOverride: false,
    });
    // A stale version still conflicts without touching the place.
    expect(
      (
        await app.inject({
          method: 'PUT',
          url: '/api/v1/events/' + id,
          cookies,
          headers,
          payload: {
            ...input,
            version,
            venue: 'Fictional Other',
            venueOverride: true,
          },
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await app.inject({
          method: 'PUT',
          url: '/api/v1/events/' + id,
          cookies: { '__Host-ak-session': 'foreign-venue-session' },
          headers,
          payload: { ...input, version: reverted.json().version },
        })
      ).statusCode,
    ).toBe(401);
  } finally {
    await app.close();
  }
});

test('the CSV route keeps its columns and exports only the effective place', async () => {
  const { app, cookies, headers } = await httpApp('synthetic-venue-csv');
  try {
    const legacy = await locationRepository(pool, tenantId).save(actorId, {
        name: 'Synthetic CSV Legacy Hall',
        street: 'Fictional CSV Street 9',
        postalCode: '12345',
        city: 'Fictional CSV Town',
        country: 'DE',
        state: 'active',
      }),
      created = await app.inject({
        method: 'POST',
        url: '/api/v1/events',
        cookies,
        headers,
        payload: {
          ...input,
          name: 'Synthetic CSV place',
          locationId: legacy.id,
          venue: '=SUM(A1)\n"Quoted", Fictional CSV Hall',
          venueOverride: true,
        },
      });
    expect(created.statusCode).toBe(201);
    const first = await app.inject({
      url: '/api/v1/events/export.csv',
      cookies,
    });
    expect(first.statusCode).toBe(200);
    expect(first.headers['content-type']).toContain('text/csv');
    expect(first.body).toContain(
      '"eventTypeName","packageName","locationName","primaryContactName","additionalContactNames"',
    );
    expect(first.body).toContain(
      '"\'=SUM(A1)\n""Quoted"", Fictional CSV Hall"',
    );
    expect(first.body).not.toContain('Synthetic CSV Legacy Hall');
    expect(first.body).not.toContain('Fictional CSV Street 9');
    const cleared = await app.inject({
      method: 'PUT',
      url: '/api/v1/events/' + created.json().id,
      cookies,
      headers,
      payload: {
        ...input,
        name: 'Synthetic CSV place',
        locationId: legacy.id,
        version: created.json().version,
        venue: '',
        venueOverride: true,
      },
    });
    expect(cleared.statusCode).toBe(200);
    const second = await app.inject({
      url: '/api/v1/events/export.csv',
      cookies,
    });
    expect(second.body).not.toContain('Synthetic CSV Legacy Hall');
    expect(second.body).not.toContain('Fictional CSV Street 9');
    // Columns and order are unchanged; only the values are effective.
    expect(second.body.split('\r\n')[0]).toBe(first.body.split('\r\n')[0]);
  } finally {
    await app.close();
  }
});
