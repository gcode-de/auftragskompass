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
import { digest, registerAuth } from '../../packages/core/src/auth.js';
import { importRepository } from '../../packages/core/src/import-repository.js';
import { importReviewRepository } from '../../packages/core/src/import-review.js';
import { registerImportRoutes } from '../../packages/core/src/import-routes.js';
import { registerEventRoutes } from '../../packages/core/src/events.js';
import {
  createHealthServer,
  loadRuntimeConfig,
} from '../../packages/core/src/runtime.js';
import { fictionalImport } from '../fixtures/minimal-import.js';
import { syntheticGoogle } from '../helpers/oidc.js';
let container: StartedPostgreSqlContainer,
  pool: Pool,
  actorId: string,
  promiseId: string,
  unitId: string;
const tenantId = randomUUID();
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
const cookies = { '__Host-ak-session': 'fictional-review' },
  headers = {
    origin: 'https://admin.example.invalid',
    'x-csrf-token': digest('csrf:fictional-review'),
  };
beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:17.6-alpine').start();
  pool = new Pool({ connectionString: container.getConnectionUri() });
  await migrate(pool);
  await bootstrapAccess(
    pool,
    tenantId,
    'fictional-review@example.invalid',
    'Fictional review',
    'Europe/Berlin',
  );
  await accessRepository(pool, tenantId).issueSession(
    { subject: 'fictional-review', email: 'fictional-review@example.invalid' },
    digest('fictional-review'),
  );
  actorId = (
    await pool.query('SELECT id FROM users WHERE tenant_id=$1', [tenantId])
  ).rows[0].id as string;
  const manifest = fictionalImport();
  manifest.events[0]!.data.startsAt = '2030-10-27T17:00:00Z';
  manifest.events[0]!.data.endsAt = '2030-10-27T20:00:00Z';
  await importRepository(pool, tenantId).run(actorId, {
    manifest,
    mode: 'apply',
    allowUpdates: false,
    decisions: [],
  });
  promiseId = (
    await pool.query('SELECT id FROM import_promises WHERE tenant_id=$1', [
      tenantId,
    ])
  ).rows[0].id as string;
  unitId = (
    await pool.query(
      "SELECT u.id FROM resource_units u JOIN resources r ON r.tenant_id=u.tenant_id AND r.id=u.resource_id WHERE u.tenant_id=$1 AND r.code='FB1'",
      [tenantId],
    )
  ).rows[0].id as string;
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
  registerImportRoutes(app, pool, tenantId);
  registerEventRoutes(app, pool, tenantId);
});
afterAll(async () => {
  await app.close();
  await pool?.end();
  await container?.stop();
});
async function input(id = promiseId) {
  const detail = await importReviewRepository(pool, tenantId).read(actorId, id);
  const fields = Object.fromEntries(
    Object.entries(detail.event).filter(
      ([key]) => !['id', 'timeZone'].includes(key),
    ),
  );
  return { ...fields, assignments: [{ unitId, periodSource: 'event' }] };
}
test('explicit review confirms resources and target mapping atomically, is repeatable, and clears the booking gate', async () => {
  const repo = importReviewRepository(pool, tenantId),
    payload = await input();
  const first = await repo.review(actorId, promiseId, payload);
  expect(first.eventId).toBeTruthy();
  expect(first.excluded).toBe(false);
  const event = (
    await pool.query('SELECT * FROM events WHERE tenant_id=$1 AND id=$2', [
      tenantId,
      first.eventId,
    ])
  ).rows[0];
  expect(event.status).toBe('booked');
  expect(
    (
      await pool.query(
        "SELECT * FROM reservations WHERE tenant_id=$1 AND event_id=$2 AND state='booked'",
        [tenantId, first.eventId],
      )
    ).rowCount,
  ).toBe(1);
  expect(
    (await importRepository(pool, tenantId).overview(actorId)).pendingPromises,
  ).toBe(0);
  const mapping = (
    await pool.query(
      "SELECT * FROM import_records WHERE tenant_id=$1 AND section='events'",
      [tenantId],
    )
  ).rows[0];
  expect(mapping.event_id).toBe(first.eventId);
  expect(mapping.promise_id).toBeNull();
  const count = (await pool.query('SELECT count(*) FROM audit_events')).rows[0]
    .count;
  expect(await repo.review(actorId, promiseId, payload)).toEqual(first);
  expect(
    (await pool.query('SELECT count(*) FROM audit_events')).rows[0].count,
  ).toBe(count);
  const calendar = (
    await app.inject({
      url: '/api/v1/calendar?date=2030-10-27&view=day',
      cookies,
    })
  ).json();
  expect(calendar.pendingPromises).toBe(0);
  expect(calendar.reservations).toHaveLength(1);
});

async function newPromise(suffix: string, date = '2031-11-10') {
  const manifest = fictionalImport();
  manifest.events[0]!.externalId += suffix;
  manifest.events[0]!.data.name += suffix;
  Object.assign(manifest.events[0]!.data, {
    eventDate: date,
    startsAt: date + 'T17:00:00Z',
    endsAt: date + 'T20:00:00Z',
  });
  await importRepository(pool, tenantId).run(actorId, {
    manifest,
    mode: 'apply',
    allowUpdates: false,
    decisions: [],
  });
  return (
    await pool.query(
      'SELECT promise_id FROM import_records WHERE tenant_id=$1 AND external_id=$2',
      [tenantId, manifest.events[0]!.externalId],
    )
  ).rows[0].promise_id as string;
}
async function snapshot() {
  return (
    await pool.query(
      `SELECT (SELECT count(*) FROM events) AS events, (SELECT count(*) FROM reservations) AS reservations, (SELECT count(*) FROM audit_events) AS audit, (SELECT count(*) FROM import_promises WHERE reviewed_at IS NOT NULL) AS reviewed`,
    )
  ).rows;
}
test('review rejects invalid payloads, missing targets, stale source versions and altered retries', async () => {
  const repo = importReviewRepository(pool, tenantId),
    id = await newPromise('-validation'),
    payload = await input(id),
    before = await snapshot();
  for (const change of [
    { tenantId },
    { version: '1' },
    { name: ' ' },
    { assignments: [{ unitId: 'bad', periodSource: 'event' }] },
  ])
    await expect(
      repo.review(actorId, id, { ...payload, ...change }),
    ).rejects.toMatchObject({ message: 'invalid_request' });
  await expect(
    repo.review(actorId, id, { ...payload, version: 99 }),
  ).rejects.toMatchObject({ message: 'conflict' });
  await expect(repo.read(actorId, randomUUID())).rejects.toMatchObject({
    message: 'not_found',
  });
  await expect(repo.review(randomUUID(), id, payload)).rejects.toMatchObject({
    message: 'forbidden',
  });
  await expect(
    repo.review(actorId, promiseId, {
      ...(await input(promiseId)),
      description: 'Fictional changed retry',
    }),
  ).rejects.toMatchObject({ message: 'already_reviewed' });
  await expect(repo.availability(actorId, promiseId)).rejects.toMatchObject({
    message: 'already_reviewed',
  });
  for (const field of ['primaryContactId', 'packageId', 'eventDate'])
    await expect(
      repo.review(actorId, id, { ...payload, [field]: null }),
    ).rejects.toMatchObject({ message: 'incomplete_import' });
  await pool.query("UPDATE tenants SET timezone='UTC' WHERE id=$1", [tenantId]);
  try {
    await expect(repo.review(actorId, id, payload)).rejects.toMatchObject({
      message: 'timezone_changed',
    });
  } finally {
    await pool.query(
      "UPDATE tenants SET timezone='Europe/Berlin' WHERE id=$1",
      [tenantId],
    );
  }
  expect(await snapshot()).toEqual(before);
});

test('two simultaneous source promises cannot confirm the same box, and an explicitly chosen second box resolves the conflict', async () => {
  const a = await newPromise('-parallel-a'),
    b = await newPromise('-parallel-b');
  const repo = importReviewRepository(pool, tenantId);
  const payloadA = await input(a),
    payloadB = await input(b);
  const results = await Promise.allSettled([
    repo.review(actorId, a, payloadA),
    repo.review(actorId, b, payloadB),
  ]);
  expect(
    results.filter((result) => result.status === 'fulfilled'),
  ).toHaveLength(1);
  expect(
    (
      results.find(
        (result) => result.status === 'rejected',
      ) as PromiseRejectedResult
    ).reason,
  ).toMatchObject({ message: 'resource_conflict' });
  const remaining = results[0]!.status === 'rejected' ? a : b;
  const availability = await repo.availability(actorId, remaining);
  expect(availability.find((unit) => unit.unitId === unitId)!.available).toBe(
    false,
  );
  const secondUnit = (
    await pool.query(
      "SELECT u.id FROM resource_units u JOIN resources r ON r.tenant_id=u.tenant_id AND r.id=u.resource_id WHERE u.tenant_id=$1 AND r.code='FB2'",
      [tenantId],
    )
  ).rows[0].id as string;
  const payload = await input(remaining);
  payload.assignments[0]!.unitId = secondUnit;
  const approved = await repo.review(actorId, remaining, payload);
  expect(approved.eventId).toBeTruthy();
  expect((await repo.read(actorId, remaining)).reviewAction).toBe('event');
});

test('concurrent identical confirmations and process-style retry create one event and one review audit', async () => {
  const id = await newPromise('-same-request', '2032-02-10'),
    payload = await input(id);
  const before = (await pool.query('SELECT count(*) FROM events')).rows[0]
    .count;
  const results = await Promise.all([
    importReviewRepository(pool, tenantId).review(actorId, id, payload),
    importReviewRepository(pool, tenantId).review(actorId, id, payload),
  ]);
  expect(results[0]).toEqual(results[1]);
  expect(
    (await pool.query('SELECT count(*)::int FROM events')).rows[0].count,
  ).toBe(Number(before) + 1);
  expect(
    (
      await pool.query(
        "SELECT * FROM audit_events WHERE action='import.reviewed' AND record_id=$1",
        [id],
      )
    ).rowCount,
  ).toBe(1);
});

test('past promises require explicit exclusion, retain their proof and cannot be excluded while future', async () => {
  const repo = importReviewRepository(pool, tenantId),
    id = await newPromise('-aged');
  await expect(repo.excludePast(actorId, id, 1)).rejects.toMatchObject({
    message: 'future_promise',
  });
  for (const version of [0, 1.5, NaN])
    await expect(repo.excludePast(actorId, id, version)).rejects.toMatchObject({
      message: 'invalid_request',
    });
  // Synthetic fixture simulates a once-future source promise aging before review.
  await pool.query(
    "UPDATE import_promises SET data=data || jsonb_build_object('eventDate','2000-01-01','startsAt',NULL,'endsAt',NULL) WHERE tenant_id=$1 AND id=$2",
    [tenantId, id],
  );
  expect((await repo.read(actorId, id)).canExcludePast).toBe(true);
  const before = await snapshot(),
    result = await repo.excludePast(actorId, id, 1);
  expect(result).toEqual({ eventId: null, excluded: true });
  expect(await repo.excludePast(actorId, id, 1)).toEqual(result);
  const after = await snapshot();
  expect(after[0].events).toBe(before[0].events);
  expect(after[0].reservations).toBe(before[0].reservations);
  const proof = (
    await pool.query(
      'SELECT * FROM import_promises WHERE tenant_id=$1 AND id=$2',
      [tenantId, id],
    )
  ).rows[0];
  expect(proof.review_action).toBe('excluded_past');
  expect(proof.reviewed_by).toBe(actorId);
  expect(proof.review_hash).toMatch(/^[a-f0-9]{64}$/);
  const overview = await importRepository(pool, tenantId).overview(actorId);
  expect(overview.promises.some((promise) => promise.id === id)).toBe(false);
  expect(
    overview.mappings.find((mapping) => mapping.targetId === id)!.reviewAction,
  ).toBe('excluded_past');
  const timed = await newPromise('-aged-timed');
  await pool.query(
    "UPDATE import_promises SET data=data || jsonb_build_object('eventDate','2000-01-01','startsAt','2000-01-01T10:00:00Z','endsAt','2000-01-01T12:00:00Z') WHERE tenant_id=$1 AND id=$2",
    [tenantId, timed],
  );
  expect((await repo.read(actorId, timed)).canExcludePast).toBe(true);
  await repo.excludePast(actorId, timed, 1);
});

test('explicit cancellation uses the normal event rules and never creates a resource reservation', async () => {
  const id = await newPromise('-cancelled'),
    payload = await input(id),
    before = (await pool.query('SELECT count(*) FROM reservations')).rows[0]
      .count;
  const result = await importReviewRepository(pool, tenantId).review(
    actorId,
    id,
    { ...payload, status: 'cancelled', assignments: [] },
  );
  expect(
    (
      await pool.query(
        'SELECT status FROM events WHERE tenant_id=$1 AND id=$2',
        [tenantId, result.eventId],
      )
    ).rows[0].status,
  ).toBe('cancelled');
  expect(
    (await pool.query('SELECT count(*) FROM reservations')).rows[0].count,
  ).toBe(before);
});

test.each(['23514', 'P0001'])(
  'late database failure %s rolls back event, assignments, mapping, review metadata and audit',
  async (code) => {
    const id = await newPromise('-rollback-' + code, '2033-03-10'),
      payload = await input(id),
      before = await snapshot();
    await pool.query(`CREATE FUNCTION fictional_review_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.reviewed_at IS NOT NULL AND OLD.id='${id}'::uuid THEN RAISE EXCEPTION 'fictional-private-failure' USING ERRCODE='${code}'; END IF; RETURN NEW; END; $$;
    CREATE TRIGGER fictional_review_failure BEFORE UPDATE ON import_promises FOR EACH ROW EXECUTE FUNCTION fictional_review_failure();`);
    try {
      const response = await app.inject({
        method: 'PUT',
        url: '/api/v1/imports/bookitup/promises/' + id,
        cookies,
        headers,
        payload,
      });
      expect(response.statusCode).toBe(code === '23514' ? 409 : 500);
      expect(response.json().error).toBe(
        code === '23514' ? 'conflict' : 'internal_error',
      );
      expect(await snapshot()).toEqual(before);
      expect(
        (await importReviewRepository(pool, tenantId).read(actorId, id))
          .reviewAction,
      ).toBeNull();
    } finally {
      await pool.query(
        'DROP TRIGGER fictional_review_failure ON import_promises; DROP FUNCTION fictional_review_failure()',
      );
    }
  },
);

test('review APIs enforce tenant isolation, CSRF, input validation and safe manual previews', async () => {
  const foreign = randomUUID();
  await bootstrapAccess(
    pool,
    foreign,
    'fictional-foreign-review@example.invalid',
    'Fictional foreign review',
    'Europe/Berlin',
  );
  await accessRepository(pool, foreign).issueSession(
    {
      subject: 'fictional-foreign',
      email: 'fictional-foreign-review@example.invalid',
    },
    digest('fictional-foreign-review'),
  );
  const foreignActor = (
    await pool.query('SELECT id FROM users WHERE tenant_id=$1', [foreign])
  ).rows[0].id as string;
  await importRepository(pool, foreign).run(foreignActor, {
    manifest: fictionalImport(),
    mode: 'apply',
    allowUpdates: false,
    decisions: [],
  });
  const foreignPromise = (
    await pool.query('SELECT id FROM import_promises WHERE tenant_id=$1', [
      foreign,
    ])
  ).rows[0].id as string;
  const foreignUnit = (
    await pool.query(
      'SELECT id FROM resource_units WHERE tenant_id=$1 LIMIT 1',
      [foreign],
    )
  ).rows[0].id as string;
  const foreignContact = (
    await pool.query('SELECT id FROM contacts WHERE tenant_id=$1 LIMIT 1', [
      foreign,
    ])
  ).rows[0].id as string;
  const id = await newPromise('-api', '2034-04-10'),
    path = '/api/v1/imports/bookitup/promises/' + id,
    payload = await input(id);
  expect((await app.inject({ url: path })).statusCode).toBe(401);
  expect(
    (
      await app.inject({
        url: path,
        cookies: { '__Host-ak-session': 'fictional-foreign-review' },
      })
    ).statusCode,
  ).toBe(401);
  expect(
    (
      await app.inject({
        url: '/api/v1/imports/bookitup/promises/' + foreignPromise,
        cookies,
      })
    ).statusCode,
  ).toBe(404);
  expect(
    (
      await app.inject({
        url: '/api/v1/imports/bookitup/promises/bad',
        cookies,
      })
    ).statusCode,
  ).toBe(400);
  expect(
    (await app.inject({ method: 'PUT', url: path, cookies, payload }))
      .statusCode,
  ).toBe(403);
  expect(
    (
      await app.inject({
        method: 'PUT',
        url: path,
        cookies,
        headers,
        payload: { ...payload, tenantId: foreign },
      })
    ).statusCode,
  ).toBe(400);
  expect(
    (
      await app.inject({
        method: 'PUT',
        url: path,
        cookies,
        headers,
        payload: { ...payload, primaryContactId: foreignContact },
      })
    ).json().error,
  ).toBe('invalid_reference');
  expect(
    (
      await app.inject({
        method: 'PUT',
        url: path,
        cookies,
        headers,
        payload: {
          ...payload,
          assignments: [{ unitId: foreignUnit, periodSource: 'event' }],
        },
      })
    ).json().error,
  ).toBe('invalid_reference');
  expect(
    (
      await app.inject({
        method: 'PUT',
        url: path,
        cookies,
        headers,
        payload: { ...payload, assignments: [] },
      })
    ).json().error,
  ).toBe('booking_required');
  const preview = await app.inject({
    url:
      path +
      '/availability?unitId=' +
      unitId +
      '&baseStart=2035-01-01T12:00:00Z&baseEnd=2035-01-01T14:00:00Z',
    cookies,
  });
  expect(preview.statusCode).toBe(200);
  expect(preview.json()).toHaveLength(1);
  expect(preview.json()[0].available).toBe(true);
  expect(preview.body).not.toContain('requestHash');
  expect(preview.json()[0]).not.toHaveProperty('old');
  for (const query of [
    'unitId=' + unitId,
    'baseStart=2035-01-01T12:00:00Z',
    'baseEnd=2035-01-01T14:00:00Z',
  ])
    expect(
      (
        await app.inject({ url: path + '/availability?' + query, cookies })
      ).json().error,
    ).toBe('invalid_period');
  expect(
    (
      await app.inject({
        method: 'POST',
        url: path + '/exclude-past',
        cookies,
        headers,
        payload: { version: 1 },
      })
    ).json().error,
  ).toBe('future_promise');
  const closed = '/api/v1/imports/bookitup/promises/' + promiseId;
  expect((await app.inject({ url: closed, cookies })).json().reviewAction).toBe(
    'event',
  );
  expect(
    (await app.inject({ url: closed + '/availability', cookies })).json().error,
  ).toBe('already_reviewed');
});

test('review metadata constraints reject incomplete or cross-tenant proof', async () => {
  const id = await newPromise('-proof');
  await expect(
    pool.query(
      'UPDATE import_promises SET reviewed_at=now() WHERE tenant_id=$1 AND id=$2',
      [tenantId, id],
    ),
  ).rejects.toMatchObject({ code: '23514' });
  await expect(
    pool.query(
      "UPDATE import_promises SET reviewed_at=now(),reviewed_by=$3,review_hash=$4,review_action='excluded_past' WHERE tenant_id=$1 AND id=$2",
      [tenantId, id, randomUUID(), 'a'.repeat(64)],
    ),
  ).rejects.toMatchObject({ code: '23503' });
});

test('missing source mapping blocks review and completed exclusions cannot be silently replaced by a delta', async () => {
  const id = await newPromise('-orphan'),
    payload = await input(id);
  await pool.query(
    'DELETE FROM import_records WHERE tenant_id=$1 AND promise_id=$2',
    [tenantId, id],
  );
  await expect(
    importReviewRepository(pool, tenantId).review(actorId, id, payload),
  ).rejects.toMatchObject({ message: 'mapping_missing' });
  const changed = fictionalImport();
  changed.events[0]!.externalId += '-aged';
  changed.events[0]!.data.name += '-aged';
  Object.assign(changed.events[0]!.data, {
    eventDate: '2031-11-11',
    startsAt: '2031-11-11T17:00:00Z',
    endsAt: '2031-11-11T20:00:00Z',
  });
  await expect(
    importRepository(pool, tenantId).run(actorId, {
      manifest: changed,
      mode: 'apply',
      allowUpdates: true,
      decisions: [],
    }),
  ).rejects.toMatchObject({ message: 'review_closed' });
});
