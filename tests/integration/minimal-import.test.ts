import { importRepository } from '../../packages/core/src/import-repository.js';
import { Writable } from 'node:stream';
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
import { registerImportRoutes } from '../../packages/core/src/import-routes.js';
import {
  createHealthServer,
  loadRuntimeConfig,
} from '../../packages/core/src/runtime.js';
import { syntheticGoogle } from '../helpers/oidc.js';
import { fictionalImport } from '../fixtures/minimal-import.js';
let container: StartedPostgreSqlContainer, pool: Pool;
const tenantId = randomUUID(),
  foreign = randomUUID();
const logs: string[] = [];
let revokeBeforePreview = false;
const app = createHealthServer(
  loadRuntimeConfig(
    {
      AK_DB_HOST: 'synthetic',
      AK_DB_NAME: 'synthetic',
      AK_DB_USER: 'synthetic',
      AK_DB_PASSWORD_FILE: 'synthetic',
      AK_LOG_LEVEL: 'info',
    },
    () => 'synthetic-long-secret',
  ),
  { database: async () => true, worker: async () => true },
  new Writable({
    write(chunk, _encoding, done) {
      logs.push(String(chunk));
      done();
    },
  }),
);
const url = '/api/v1/imports/bookitup/preview',
  cookies = { '__Host-ak-session': 'fictional-import-session' };
const headers = {
  origin: 'https://admin.example.invalid',
  'x-csrf-token': digest('csrf:fictional-import-session'),
};
beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:17.6-alpine').start();
  pool = new Pool({ connectionString: container.getConnectionUri() });
  await migrate(pool);
  for (const owner of [tenantId, foreign]) {
    await bootstrapAccess(
      pool,
      owner,
      'fictional@example.invalid',
      'Fictional import',
      owner === tenantId ? 'Europe/Berlin' : 'UTC',
    );
    await accessRepository(pool, owner).issueSession(
      { subject: 'fictional-subject', email: 'fictional@example.invalid' },
      digest(
        owner === tenantId
          ? 'fictional-import-session'
          : 'fictional-foreign-session',
      ),
    );
  }
  const actor = (
    await pool.query('SELECT id FROM users WHERE tenant_id=$1', [tenantId])
  ).rows[0].id as string;
  await accessRepository(pool, tenantId).grant(
    actor,
    'fictional-second@example.invalid',
  );
  await accessRepository(pool, tenantId).issueSession(
    { subject: 'fictional-second', email: 'fictional-second@example.invalid' },
    digest('fictional-second-session'),
  );
  const config = {
    origin: headers.origin,
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
  app.addHook('preHandler', async () => {
    if (revokeBeforePreview)
      await pool.query(
        "UPDATE memberships SET active=false WHERE tenant_id=$1 AND user_id=(SELECT id FROM users WHERE tenant_id=$1 AND google_subject='fictional-subject')",
        [tenantId],
      );
  });
  registerImportRoutes(app, pool, tenantId);
});
afterAll(async () => {
  await app.close();
  await pool?.end();
  await container?.stop();
});
async function snapshot() {
  return (
    await pool.query(`SELECT
    (SELECT count(*) FROM contacts) AS contacts,
    (SELECT count(*) FROM locations) AS locations,
    (SELECT count(*) FROM master_data) AS master_data,
    (SELECT count(*) FROM events) AS events,
    (SELECT count(*) FROM audit_events) AS audit,
    (SELECT count(*) FROM import_records) AS mappings,
    (SELECT count(*) FROM import_promises) AS promises,
    (SELECT count(*) FROM reservations) AS reservations,
    (SELECT count(*) FROM event_contacts) AS links,
    (SELECT count(*) FROM event_activities) AS activities`)
  ).rows;
}
test('authenticated preview reads tenant timezone, leaves all business/audit tables unchanged, and never logs contents', async () => {
  const before = await snapshot();
  const response = await app.inject({
    method: 'POST',
    url,
    cookies,
    headers,
    payload: fictionalImport(),
  });
  expect(response.statusCode).toBe(200);
  expect(response.headers['cache-control']).toBe('no-store');
  expect(response.json()).toMatchObject({
    valid: true,
    timeZone: 'Europe/Berlin',
    pendingPromises: 1,
    counts: { events: { accepted: 1 } },
  });
  expect(response.json().events[0]).toMatchObject({
    sourceStatus: 'Gebucht',
    requiresResourceReview: true,
  });
  expect(await snapshot()).toEqual(before);
  const bad = await app.inject({
    method: 'POST',
    url,
    cookies,
    headers,
    payload: {
      ...fictionalImport(),
      tenantId: foreign,
      privateField: 'fictional-secret-content',
    },
  });
  expect(bad.json().errors).toEqual([
    { section: 'manifest', row: 0, code: 'invalid_format' },
  ]);
  expect(bad.body).not.toContain('fictional-secret-content');
  const log = logs.join('');
  for (const value of [
    'fictional-secret-content',
    'fictional@example.invalid',
    'Fictional Future Event',
    'fictional-import-session',
    headers['x-csrf-token'],
  ])
    expect(log).not.toContain(value);
});
test('rejects anonymous, cross-tenant and CSRF requests and malformed/excessive bodies', async () => {
  const request = {
    method: 'POST' as const,
    url,
    headers,
    cookies,
    payload: fictionalImport(),
  };
  expect((await app.inject({ ...request, cookies: {} })).statusCode).toBe(401);
  expect(
    (
      await app.inject({
        ...request,
        cookies: { '__Host-ak-session': 'fictional-foreign-session' },
      })
    ).statusCode,
  ).toBe(401);
  expect((await app.inject({ ...request, headers: {} })).statusCode).toBe(403);
  expect(
    (
      await app.inject({
        ...request,
        headers: { ...headers, origin: 'https://foreign.example.invalid' },
      })
    ).statusCode,
  ).toBe(403);
  expect(
    (
      await app.inject({
        ...request,
        headers: { ...headers, 'content-type': 'application/json' },
        payload: '{private-value',
      })
    ).json(),
  ).toEqual({ error: 'invalid_request' });
  expect(
    (
      await app.inject({
        ...request,
        headers: { ...headers, 'content-type': 'application/json' },
        payload: JSON.stringify('x'.repeat(4 * 1024 * 1024)),
      })
    ).statusCode,
  ).toBe(413);
});

test('rechecks administrator access after session authentication', async () => {
  revokeBeforePreview = true;
  try {
    expect(
      (
        await app.inject({
          method: 'POST',
          url,
          cookies,
          headers,
          payload: fictionalImport(),
        })
      ).statusCode,
    ).toBe(403);
  } finally {
    revokeBeforePreview = false;
    await pool.query('UPDATE memberships SET active=true WHERE tenant_id=$1', [
      tenantId,
    ]);
  }
});

test('dry-run rolls back mappings, promises, entities and audit; apply is repeatable', async () => {
  const actorId = (
    await pool.query(
      "SELECT id FROM users WHERE tenant_id=$1 AND google_subject='fictional-subject'",
      [tenantId],
    )
  ).rows[0].id as string;
  const request = {
    manifest: fictionalImport(),
    mode: 'dry_run',
    allowUpdates: false,
    decisions: [],
  };
  const before = await snapshot();
  const report = await importRepository(pool, tenantId).run(actorId, request);
  expect(report.applied).toBe(false);
  expect(report.counts.events.created).toBe(1);
  expect(await snapshot()).toEqual(before);
  expect((await pool.query('SELECT * FROM import_records')).rowCount).toBe(0);
  expect((await pool.query('SELECT * FROM import_promises')).rowCount).toBe(0);
  const first = await importRepository(pool, tenantId).run(actorId, {
    ...request,
    mode: 'apply',
  });
  expect(first.applied).toBe(true);
  expect(first.pendingPromises).toBe(1);
  expect((await pool.query('SELECT * FROM events')).rowCount).toBe(0);
  expect((await pool.query('SELECT * FROM import_promises')).rowCount).toBe(1);
  const after = await snapshot();
  const second = await importRepository(pool, tenantId).run(actorId, {
    ...request,
    mode: 'apply',
  });
  expect(second.counts.contacts.unchanged).toBe(1);
  expect(second.counts.events.unchanged).toBe(1);
  expect(await snapshot()).toEqual(after);
});

const importUrl = '/api/v1/imports/bookitup';
async function actor(owner = tenantId) {
  return (
    await pool.query(
      "SELECT id FROM users WHERE tenant_id=$1 AND google_subject='fictional-subject'",
      [owner],
    )
  ).rows[0].id as string;
}
function request(manifest: unknown, extra: object = {}) {
  return {
    manifest,
    mode: 'apply',
    allowUpdates: false,
    decisions: [],
    ...extra,
  };
}
function distinctImport(suffix: string) {
  const manifest = fictionalImport();
  for (const entry of manifest.contacts) {
    entry.externalId += suffix;
    entry.data.name += suffix;
    entry.data.email = 'fictional' + suffix + '@example.invalid';
  }
  for (const list of [
    manifest.locations,
    manifest.eventTypes,
    manifest.packages,
  ])
    for (const entry of list) {
      entry.externalId += suffix;
      entry.data.name += suffix;
    }
  for (const entry of manifest.events) {
    entry.externalId += suffix;
    entry.data.name += suffix;
    entry.data.eventTypeId += suffix;
    entry.data.packageId += suffix;
    entry.data.locationId += suffix;
    entry.data.primaryContactId += suffix;
  }
  return manifest;
}
test('strict API validates requests, checks authorization, and returns safe reports', async () => {
  const base = { method: 'POST' as const, url: importUrl, cookies, headers };
  expect(
    (
      await app.inject({
        ...base,
        cookies: {},
        payload: request(fictionalImport()),
      })
    ).statusCode,
  ).toBe(401);
  expect(
    (
      await app.inject({
        ...base,
        headers: {},
        payload: request(fictionalImport()),
      })
    ).statusCode,
  ).toBe(403);
  for (const payload of [
    {},
    request({}, { unknown: 'fictional-private' }),
    request({}, { allowUpdates: 'true' }),
    request({}, { mode: 'guess' }),
    request(
      {},
      {
        decisions: [
          {
            section: 'contacts',
            externalId: 'fictional',
            action: 'bind',
            targetId: 'not-uuid',
            version: 1,
          },
        ],
      },
    ),
  ]) {
    const response = await app.inject({ ...base, payload });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('invalid_request');
    expect(response.body).not.toContain('fictional-private');
  }
  const response = await app.inject({
    ...base,
    payload: request(distinctImport('-api'), { mode: 'dry_run' }),
  });
  expect(response.statusCode).toBe(200);
  expect(response.json().applied).toBe(false);
  expect(response.headers['cache-control']).toBe('no-store');
});

test('delta needs explicit review and never overwrites local edits; unchanged exports preserve edits', async () => {
  const repo = importRepository(pool, tenantId),
    id = await actor(),
    manifest = fictionalImport();
  const target = (
    await pool.query(
      "SELECT contact_id FROM import_records WHERE tenant_id=$1 AND section='contacts' AND external_id='fictional-contact'",
      [tenantId],
    )
  ).rows[0].contact_id as string;
  manifest.contacts[0]!.data.name = 'Fictional source change';
  await expect(repo.run(id, request(manifest))).rejects.toMatchObject({
    message: 'delta_review_required',
    section: 'contacts',
    row: 1,
  });
  const updated = await repo.run(id, request(manifest, { allowUpdates: true }));
  expect(updated.counts.contacts.updated).toBe(1);
  await pool.query(
    "UPDATE contacts SET name='Fictional local edit',version=version+1 WHERE tenant_id=$1 AND id=$2",
    [tenantId, target],
  );
  expect(
    (await repo.run(id, request(manifest))).counts.contacts.unchanged,
  ).toBe(1);
  manifest.contacts[0]!.data.name = 'Fictional second source change';
  await expect(
    repo.run(id, request(manifest, { allowUpdates: true })),
  ).rejects.toMatchObject({ message: 'target_conflict' });
  expect(
    (
      await pool.query(
        'SELECT name FROM contacts WHERE tenant_id=$1 AND id=$2',
        [tenantId, target],
      )
    ).rows[0].name,
  ).toBe('Fictional local edit');
});

test('concurrent repeated imports serialize, survive repository restart, and isolate source IDs by tenant', async () => {
  const manifest = distinctImport('-concurrent'),
    id = await actor();
  manifest.events[0]!.data.status = 'Option';
  const [a, b] = await Promise.all([
    importRepository(pool, tenantId).run(id, request(manifest)),
    importRepository(pool, tenantId).run(id, request(manifest)),
  ]);
  expect(a.counts.events.created + b.counts.events.created).toBe(1);
  expect(a.counts.events.unchanged + b.counts.events.unchanged).toBe(1);
  expect(
    (await importRepository(pool, tenantId).run(id, request(manifest))).counts
      .events.unchanged,
  ).toBe(1);
  expect(
    (
      await importRepository(pool, foreign).run(
        await actor(foreign),
        request(manifest),
      )
    ).counts.events.created,
  ).toBe(1);
  await expect(
    importRepository(pool, foreign).run(id, request(manifest)),
  ).rejects.toMatchObject({ message: 'forbidden' });
  const links = (
    await pool.query(
      "SELECT tenant_id,event_id FROM import_records WHERE section='events' AND external_id=$1",
      [manifest.events[0]!.externalId],
    )
  ).rows;
  expect(links).toHaveLength(2);
  expect(links[0].event_id).not.toBe(links[1].event_id);
});

test('one bad late row rolls back earlier entities, mappings and audit even with nested repository saves', async () => {
  const manifest = distinctImport('-rollback');
  manifest.eventTypes[0]!.data.name = 'Hochzeit'; // Seeded name deliberately collides at the database boundary.
  const before = await snapshot();
  await expect(
    importRepository(pool, tenantId).run(
      await actor(),
      request(manifest, {
        decisions: [
          {
            section: 'eventTypes',
            externalId: manifest.eventTypes[0]!.externalId,
            action: 'create',
          },
        ],
      }),
    ),
  ).rejects.toMatchObject({ message: 'database_conflict' });
  expect(await snapshot()).toEqual(before);
  expect(
    (
      await pool.query('SELECT * FROM import_records WHERE external_id=$1', [
        manifest.contacts[0]!.externalId,
      ])
    ).rowCount,
  ).toBe(0);
});

test('duplicate candidates need an explicit create or versioned binding; no name or email auto-merge', async () => {
  const manifest = distinctImport('-duplicates');
  manifest.events = [];
  manifest.locations = [];
  manifest.eventTypes = [];
  manifest.packages = [];
  manifest.contacts[0]!.data.email = 'fictional@example.invalid';
  const repo = importRepository(pool, tenantId),
    id = await actor();
  let candidates: { id: string; version: number }[] = [];
  try {
    await repo.run(id, request(manifest));
    throw Error('expected duplicate');
  } catch (error) {
    expect(error).toMatchObject({
      message: 'duplicate_review_required',
      section: 'contacts',
      row: 1,
    });
    candidates = (error as { candidates: typeof candidates }).candidates;
  }
  expect(candidates.length).toBeGreaterThan(0);
  expect(
    (
      await repo.run(
        id,
        request(manifest, {
          decisions: [
            {
              section: 'contacts',
              externalId: manifest.contacts[0]!.externalId,
              action: 'create',
            },
          ],
        }),
      )
    ).counts.contacts.created,
  ).toBe(1);
  const binding = distinctImport('-binding');
  binding.events = [];
  binding.contacts = [];
  binding.locations = [];
  binding.packages = [];
  binding.eventTypes[0]!.data.name = 'Hochzeit';
  const seed = (
    await pool.query(
      "SELECT id,version FROM master_data WHERE tenant_id=$1 AND kind='event_type' AND name='Hochzeit'",
      [tenantId],
    )
  ).rows[0];
  const decision = {
    section: 'eventTypes',
    externalId: binding.eventTypes[0]!.externalId,
    action: 'bind',
    targetId: seed.id,
    version: seed.version,
  };
  await expect(
    repo.run(id, request(binding, { decisions: [decision] })),
  ).rejects.toMatchObject({ message: 'binding_review_required' });
  await expect(
    repo.run(
      id,
      request(binding, {
        allowUpdates: true,
        decisions: [{ ...decision, version: seed.version + 100 }],
      }),
    ),
  ).rejects.toMatchObject({ message: 'target_conflict' });
  expect(
    (
      await repo.run(
        id,
        request(binding, { allowUpdates: true, decisions: [decision] }),
      )
    ).counts.eventTypes.bound,
  ).toBe(1);
  expect(
    (
      await repo.run(
        id,
        request(binding, { allowUpdates: true, decisions: [decision] }),
      )
    ).counts.eventTypes.unchanged,
  ).toBe(1);
});

test('unreviewed promises preserve source status and sanitized notes through reviewed deltas', async () => {
  const manifest = distinctImport('-promise-delta'),
    repo = importRepository(pool, tenantId),
    id = await actor();
  manifest.events[0]!.data.notesHtml =
    '<b>Fictional</b><script>fictional-private</script>';
  await repo.run(id, request(manifest));
  manifest.events[0]!.data.notesHtml = '<b>Fictional</b>';
  expect((await repo.run(id, request(manifest))).counts.events.unchanged).toBe(
    1,
  );
  manifest.events[0]!.data.description = 'Fictional changed description';
  expect(
    (await repo.run(id, request(manifest, { allowUpdates: true }))).counts
      .events.updated,
  ).toBe(1);
  const promise = (
    await pool.query(
      'SELECT p.* FROM import_promises p JOIN import_records r ON r.tenant_id=p.tenant_id AND r.promise_id=p.id WHERE r.tenant_id=$1 AND r.external_id=$2',
      [tenantId, manifest.events[0]!.externalId],
    )
  ).rows[0];
  expect(promise.version).toBe(2);
  expect(promise.data.status).toBe('booked');
  expect(promise.data.notesHtml).toBe('<b>Fictional</b>');
  manifest.events[0]!.data.status = 'Annulliert';
  await expect(
    repo.run(id, request(manifest, { allowUpdates: true })),
  ).rejects.toMatchObject({ message: 'status_review_required' });
});

test('operative events keep resolved contacts and nullable references and use normal update rules', async () => {
  const manifest = distinctImport('-operative'),
    repo = importRepository(pool, tenantId),
    id = await actor();
  const additional = structuredClone(manifest.contacts[0]!);
  additional.externalId += '-additional';
  additional.data.email = 'fictional-additional@example.invalid';
  additional.data.name += ' additional';
  manifest.contacts.push(additional);
  manifest.events[0]!.data.status = 'Anfrage';
  manifest.events[0]!.data.startsAt = '2030-10-27T18:00:00+01:00';
  manifest.events[0]!.data.endsAt = '2030-10-27T20:00:00+01:00';
  manifest.events[0]!.data.additionalContactIds = [additional.externalId];
  const withoutReferences = {
    ...structuredClone(manifest.events[0]!),
    externalId: 'fictional-without-references',
  };
  Object.assign(withoutReferences.data, {
    name: 'Fictional Unlinked',
    eventTypeId: null,
    packageId: null,
    locationId: null,
    primaryContactId: null,
    additionalContactIds: [],
    status: 'Nicht verfügbar',
  });
  manifest.events.push(withoutReferences);
  expect((await repo.run(id, request(manifest))).counts.events.created).toBe(2);
  const stored = (
    await pool.query(
      'SELECT event_id FROM import_records WHERE tenant_id=$1 AND external_id=$2',
      [tenantId, manifest.events[0]!.externalId],
    )
  ).rows[0].event_id;
  expect(
    (
      await pool.query(
        'SELECT role FROM event_contacts WHERE tenant_id=$1 AND event_id=$2 ORDER BY role',
        [tenantId, stored],
      )
    ).rows.map((r) => r.role),
  ).toEqual(['additional', 'primary']);
  manifest.events[0]!.data.startsAt = '2030-10-27T17:00:00Z';
  manifest.events[0]!.data.endsAt = '2030-10-27T19:00:00Z';
  expect((await repo.run(id, request(manifest))).counts.events.unchanged).toBe(
    2,
  );
  manifest.events[0]!.data.status = 'Option';
  expect(
    (await repo.run(id, request(manifest, { allowUpdates: true }))).counts
      .events.updated,
  ).toBe(1);
  expect(
    (
      await pool.query(
        'SELECT status FROM events WHERE tenant_id=$1 AND id=$2',
        [tenantId, stored],
      )
    ).rows[0].status,
  ).toBe('option');
  const partial = { ...manifest, events: [] };
  await repo.run(id, request(partial)); // Missing rows are never deletion instructions.
  expect(
    (
      await pool.query('SELECT id FROM events WHERE tenant_id=$1 AND id=$2', [
        tenantId,
        stored,
      ])
    ).rowCount,
  ).toBe(1);
});

test('invalid, conflicting and cross-tenant binding decisions cannot mutate targets', async () => {
  const manifest = distinctImport('-decisions'),
    repo = importRepository(pool, tenantId),
    id = await actor();
  const create = {
    section: 'contacts',
    externalId: manifest.contacts[0]!.externalId,
    action: 'create',
  };
  for (const decisions of [
    [create, create],
    [{ ...create, externalId: 'fictional-missing' }],
  ])
    await expect(
      repo.run(id, request(manifest, { decisions })),
    ).rejects.toMatchObject({ message: 'invalid_decision' });
  const foreignContact = (
    await pool.query(
      'SELECT id,version FROM contacts WHERE tenant_id=$1 LIMIT 1',
      [foreign],
    )
  ).rows[0];
  await expect(
    repo.run(
      id,
      request(manifest, {
        allowUpdates: true,
        decisions: [
          {
            ...create,
            action: 'bind',
            targetId: foreignContact.id,
            version: foreignContact.version,
          },
        ],
      }),
    ),
  ).rejects.toMatchObject({ message: 'target_conflict' });
  await repo.run(id, request(manifest));
  await expect(
    repo.run(
      id,
      request(manifest, {
        decisions: [
          { ...create, action: 'bind', targetId: randomUUID(), version: 1 },
        ],
      }),
    ),
  ).rejects.toMatchObject({ message: 'mapping_conflict' });
  const changedId = structuredClone(manifest);
  changedId.contacts[0]!.externalId += '-alias';
  changedId.events = [];
  const mapped = (
    await pool.query(
      'SELECT id,version FROM contacts WHERE tenant_id=$1 AND email=$2',
      [tenantId, manifest.contacts[0]!.data.email],
    )
  ).rows[0];
  await expect(
    repo.run(
      id,
      request(changedId, {
        allowUpdates: true,
        decisions: [
          {
            ...create,
            externalId: changedId.contacts[0]!.externalId,
            action: 'bind',
            targetId: mapped.id,
            version: mapped.version,
          },
        ],
      }),
    ),
  ).rejects.toMatchObject({ message: 'target_already_mapped' });
  const promiseBinding = distinctImport('-promise-binding');
  await expect(
    repo.run(
      id,
      request(promiseBinding, {
        allowUpdates: true,
        decisions: [
          {
            section: 'events',
            externalId: promiseBinding.events[0]!.externalId,
            action: 'bind',
            targetId: randomUUID(),
            version: 1,
          },
        ],
      }),
    ),
  ).rejects.toMatchObject({ message: 'promise_binding_unsupported' });
});

test('inactive locally edited references fail safely for promises and ordinary events', async () => {
  const manifest = distinctImport('-inactive'),
    repo = importRepository(pool, tenantId),
    id = await actor();
  await repo.run(id, request(manifest));
  const target = (
    await pool.query(
      'SELECT contact_id FROM import_records WHERE tenant_id=$1 AND external_id=$2',
      [tenantId, manifest.contacts[0]!.externalId],
    )
  ).rows[0].contact_id;
  await pool.query(
    "UPDATE contacts SET state='archived',version=version+1 WHERE tenant_id=$1 AND id=$2",
    [tenantId, target],
  );
  for (const status of ['Gebucht', 'Option']) {
    const changed = structuredClone(manifest);
    changed.events[0]!.externalId += '-new-' + status;
    changed.events[0]!.data.status = status;
    await expect(repo.run(id, request(changed))).rejects.toMatchObject({
      message:
        status === 'Gebucht' ? 'inactive_reference' : 'invalid_reference',
    });
  }
});

test('dry-run executes deferred database guards before rollback', async () => {
  await pool.query(`CREATE FUNCTION fictional_import_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.external_id='fictional-event-deferred' THEN RAISE EXCEPTION 'fictional-deferred' USING ERRCODE='23514'; END IF; RETURN NEW; END; $$;
    CREATE CONSTRAINT TRIGGER fictional_import_guard AFTER INSERT ON import_records DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fictional_import_guard();`);
  const before = await snapshot();
  try {
    await expect(
      importRepository(pool, tenantId).run(
        await actor(),
        request(distinctImport('-deferred'), { mode: 'dry_run' }),
      ),
    ).rejects.toMatchObject({ message: 'database_conflict' });
    expect(await snapshot()).toEqual(before);
  } finally {
    await pool.query(
      'DROP TRIGGER fictional_import_guard ON import_records; DROP FUNCTION fictional_import_guard()',
    );
  }
});

test('migration enforces tenant-bound targets, correct master kind and promise status', async () => {
  const other = (
    await pool.query('SELECT id FROM contacts WHERE tenant_id=$1 LIMIT 1', [
      foreign,
    ])
  ).rows[0].id;
  const insert =
    "INSERT INTO import_records(tenant_id,section,external_id,content_hash,target_version,contact_id) VALUES($1,'contacts','fictional-cross-tenant',$2,1,$3)";
  await expect(
    pool.query(insert, [tenantId, 'a'.repeat(64), other]),
  ).rejects.toMatchObject({ code: '23503' });
  const seed = (
    await pool.query(
      "SELECT m.id FROM master_data m WHERE m.tenant_id=$1 AND m.kind='event_type' AND NOT EXISTS(SELECT 1 FROM import_records r WHERE r.tenant_id=m.tenant_id AND r.master_id=m.id) LIMIT 1",
      [tenantId],
    )
  ).rows[0].id;
  await expect(
    pool.query(
      "INSERT INTO import_records(tenant_id,section,external_id,content_hash,target_version,master_id) VALUES($1,'packages','fictional-wrong-kind',$2,1,$3)",
      [tenantId, 'a'.repeat(64), seed],
    ),
  ).rejects.toMatchObject({ code: '23503' });
  for (const data of [{}, { status: 'option' }])
    await expect(
      pool.query(
        "INSERT INTO import_promises(tenant_id,id,data,time_zone) VALUES($1,$2,$3,'Europe/Berlin')",
        [tenantId, randomUUID(), data],
      ),
    ).rejects.toMatchObject({ code: '23514' });
});

test('invalid source rows and historical events are rejected or excluded without writes', async () => {
  const manifest = distinctImport('-past');
  manifest.events[0]!.data.eventDate = '2000-01-01';
  const result = await importRepository(pool, tenantId).run(
    await actor(),
    request(manifest),
  );
  expect(result.counts.events).toEqual({
    created: 0,
    bound: 0,
    updated: 0,
    unchanged: 0,
    excluded: 1,
  });
  const before = await snapshot();
  manifest.events[0]!.data.eventDate = null;
  await expect(
    importRepository(pool, tenantId).run(await actor(), request(manifest)),
  ).rejects.toMatchObject({ message: 'missing_date' });
  expect(await snapshot()).toEqual(before);
});

test('API returns actionable import conflicts and rechecks revoked access', async () => {
  const base = {
    method: 'POST' as const,
    url: importUrl,
    cookies,
    headers,
    remoteAddress: '192.0.2.40',
  };
  const invalid = await app.inject({ ...base, payload: request({}) });
  expect(invalid.statusCode).toBe(400);
  expect(invalid.json().error).toBe('invalid_format');
  const changed = fictionalImport();
  changed.contacts[0]!.data.name = 'Fictional API delta';
  const response = await app.inject({ ...base, payload: request(changed) });
  expect(response.statusCode).toBe(409);
  expect(response.json()).toMatchObject({
    error: 'delta_review_required',
    section: 'contacts',
    row: 1,
  });
  revokeBeforePreview = true;
  try {
    expect(
      (
        await app.inject({
          ...base,
          payload: request(distinctImport('-revoked')),
        })
      ).statusCode,
    ).toBe(403);
  } finally {
    revokeBeforePreview = false;
    await pool.query('UPDATE memberships SET active=true WHERE tenant_id=$1', [
      tenantId,
    ]);
  }
});

test('unexpected database errors fail atomically without leaking source values', async () => {
  await pool.query(`CREATE FUNCTION fictional_import_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.external_id='fictional-event-failure' THEN RAISE EXCEPTION 'fictional-private-database-error'; END IF; RETURN NEW; END; $$;
    CREATE TRIGGER fictional_import_failure BEFORE INSERT ON import_records FOR EACH ROW EXECUTE FUNCTION fictional_import_failure();`);
  const before = await snapshot();
  try {
    const response = await app.inject({
      method: 'POST',
      url: importUrl,
      cookies,
      headers,
      remoteAddress: '192.0.2.41',
      payload: request(distinctImport('-failure')),
    });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: 'internal_error' });
    expect(await snapshot()).toEqual(before);
    expect(logs.join('')).not.toContain('fictional-private-database-error');
  } finally {
    await pool.query(
      'DROP TRIGGER fictional_import_failure ON import_records; DROP FUNCTION fictional_import_failure()',
    );
  }
});
