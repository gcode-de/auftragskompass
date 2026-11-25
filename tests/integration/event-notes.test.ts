import { afterAll, beforeAll, expect, test } from 'vitest';
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import Fastify, { type FastifyInstance } from 'fastify';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { migrate } from '../../packages/core/src/identity.js';
import { bootstrapAccess } from '../../packages/core/src/access.js';
import { bootstrapPassword } from '../../packages/core/src/password-access.js';
import { registerAuth } from '../../packages/core/src/auth.js';
import { eventRepository } from '../../packages/core/src/events.js';
import {
  eventNoteRepository,
  noteHasText,
  registerEventNoteRoutes,
} from '../../packages/core/src/event-notes.js';

// QW3: dated event notes with synthetic tenants, people and texts only.
const tenantId = randomUUID(),
  otherTenantId = randomUUID(),
  email = 'notes.owner@example.invalid',
  password = 'Fictional password 123!';
const config = {
  mode: 'password' as const,
  origin: 'https://admin.example.invalid',
  tenantId,
};
const input = {
  name: 'Synthetic notes event',
  status: 'inquiry' as const,
  eventTypeId: null,
  packageId: null,
  locationId: null,
  primaryContactId: null,
  additionalContactIds: [],
  source: 'Manual synthetic fixture',
  eventDate: null,
  startsAt: null,
  endsAt: null,
  description: 'Fictional event',
  notesHtml: '',
};
let container: StartedPostgreSqlContainer,
  pool: Pool,
  app: FastifyInstance,
  actorId: string,
  otherActorId: string;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:17.6-alpine').start();
  pool = new Pool({ connectionString: container.getConnectionUri() });
  await migrate(pool);
  for (const [id, mail, login] of [
    [tenantId, email, 'fictional.notes.owner'],
    [otherTenantId, 'other.notes@example.invalid', 'fictional.other.notes'],
  ] as const) {
    await bootstrapAccess(pool, id, mail, 'Synthetic tenant', 'Europe/Berlin');
    await bootstrapPassword(pool, id, mail, login, () => password);
  }
  const owners = await pool.query<{ tenant_id: string; user_id: string }>(
    'SELECT tenant_id,user_id FROM allowed_accounts WHERE tenant_id=ANY($1)',
    [[tenantId, otherTenantId]],
  );
  actorId = owners.rows.find((row) => row.tenant_id === tenantId)!.user_id;
  otherActorId = owners.rows.find(
    (row) => row.tenant_id === otherTenantId,
  )!.user_id;
  app = Fastify();
  await registerAuth(app, pool, config);
  registerEventNoteRoutes(app, pool, tenantId);
}, 120000);
afterAll(async () => {
  await app?.close();
  await pool?.end();
  await container?.stop();
});

async function signedIn() {
  const login = await app.inject({
    method: 'POST',
    url: '/auth/login',
    headers: { origin: config.origin },
    payload: { identifier: 'fictional.notes.owner', password },
  });
  const cookie = login.cookies[0]!,
    headers = {
      cookie: `${cookie.name}=${cookie.value}`,
      origin: config.origin,
    };
  const csrf = {
    'x-csrf-token': (await app.inject({ url: '/auth/me', headers })).json()
      .csrfToken,
  };
  return { headers, write: { ...headers, ...csrf } };
}

test('notes are added newest first, sanitized, attributed and removed as tombstones', async () => {
  const { headers, write } = await signedIn();
  const event = await eventRepository(pool, tenantId).save(actorId, input);
  const url = `/api/v1/events/${event.id}/notes`;
  expect((await app.inject({ url })).statusCode).toBe(401);
  expect((await app.inject({ url, headers })).json()).toEqual([]);

  const first = await app.inject({
    method: 'POST',
    url,
    headers: write,
    payload: { bodyHtml: '<p>Erste <strong>Notiz</strong></p>' },
  });
  expect(first.statusCode).toBe(201);
  const second = await app.inject({
    method: 'POST',
    url,
    headers: write,
    payload: {
      bodyHtml:
        '<h2>Zweite</h2><script>alert(1)</script><a href="javascript:x">x</a>',
    },
  });
  const notes = second.json() as {
    id: string;
    bodyHtml: string;
    author: string | null;
    createdAt: string;
  }[];
  expect(notes.map((note) => note.bodyHtml)).toEqual([
    '<h2>Zweite</h2><a>x</a>',
    '<p>Erste <strong>Notiz</strong></p>',
  ]);
  expect(notes.every((note) => note.author === email)).toBe(true);
  expect(Date.parse(notes[0]!.createdAt)).not.toBeNaN();

  for (const bodyHtml of ['', '<p> </p>', '<script>x()</script>'])
    expect(
      (
        await app.inject({
          method: 'POST',
          url,
          headers: write,
          payload: { bodyHtml },
        })
      ).json(),
    ).toEqual({ error: 'empty_note' });
  expect(
    (
      await app.inject({
        method: 'POST',
        url,
        headers: write,
        payload: { bodyHtml: '<p>' + 'x'.repeat(20001) + '</p>' },
      })
    ).json(),
  ).toEqual({ error: 'invalid_note' });
  // Without the CSRF token nothing is written.
  expect(
    (
      await app.inject({
        method: 'POST',
        url,
        headers,
        payload: { bodyHtml: '<p>x</p>' },
      })
    ).statusCode,
  ).toBe(403);

  const removed = await app.inject({
    method: 'DELETE',
    url: `${url}/${notes[0]!.id}`,
    headers: write,
  });
  expect(removed.statusCode).toBe(200);
  expect(removed.json()).toHaveLength(1);
  expect(
    (
      await app.inject({
        method: 'DELETE',
        url: `${url}/${notes[0]!.id}`,
        headers: write,
      })
    ).statusCode,
  ).toBe(404);
  const tombstone = await pool.query(
    'SELECT deleted_by FROM event_notes WHERE tenant_id=$1 AND id=$2',
    [tenantId, notes[0]!.id],
  );
  expect(tombstone.rows).toEqual([{ deleted_by: actorId }]);
  const audit = await pool.query<{ action: string }>(
    `SELECT action FROM audit_events WHERE tenant_id=$1
      AND action LIKE 'event_note.%' ORDER BY id`,
    [tenantId],
  );
  expect(audit.rows.map((row) => row.action)).toEqual([
    'event_note.created',
    'event_note.created',
    'event_note.removed',
  ]);
});

test('foreign, removed and unknown events answer not found', async () => {
  const { headers, write } = await signedIn();
  const foreign = await eventRepository(pool, otherTenantId).save(
    otherActorId,
    input,
  );
  await eventNoteRepository(pool, otherTenantId).add(
    otherActorId,
    foreign.id,
    '<p>Fremd</p>',
  );
  for (const id of [foreign.id, randomUUID()]) {
    const url = `/api/v1/events/${id}/notes`;
    expect((await app.inject({ url, headers })).statusCode).toBe(404);
    expect(
      (
        await app.inject({
          method: 'POST',
          url,
          headers: write,
          payload: { bodyHtml: '<p>x</p>' },
        })
      ).statusCode,
    ).toBe(404);
  }
  const [foreignNote] = await eventNoteRepository(pool, otherTenantId).list(
    foreign.id,
  );
  const own = await eventRepository(pool, tenantId).save(actorId, input);
  expect(
    (
      await app.inject({
        method: 'DELETE',
        url: `/api/v1/events/${own.id}/notes/${foreignNote!.id}`,
        headers: write,
      })
    ).statusCode,
  ).toBe(404);
  await eventRepository(pool, tenantId).remove(actorId, own.id, own.version);
  expect(
    (await app.inject({ url: `/api/v1/events/${own.id}/notes`, headers }))
      .statusCode,
  ).toBe(404);
});

test('notes sent with an event become one dated note and are not repeated', async () => {
  const repo = eventRepository(pool, tenantId);
  const created = await repo.save(actorId, {
    ...input,
    notesHtml: '<p>Aus dem Anlegen</p>',
  });
  expect(created.notesHtml).toBe('');
  const again = await repo.save(
    actorId,
    { ...input, notesHtml: '<p>Aus dem Anlegen</p>' },
    created.id,
    created.version,
  );
  await repo.save(actorId, input, again.id, again.version);
  const notes = await eventNoteRepository(pool, tenantId).list(created.id);
  expect(notes.map((note) => note.bodyHtml)).toEqual([
    '<p>Aus dem Anlegen</p>',
  ]);
  expect(
    (await repo.exportRows()).find((row) => row.id === created.id)!.notesHtml,
  ).toBe('<p>Aus dem Anlegen</p>');
  expect(noteHasText('<p>&nbsp;</p>')).toBe(false);
});

test('the migration moves each non-empty single note into one note', async () => {
  const scratch = new Pool({ connectionString: container.getConnectionUri() });
  const database = 'notes_migration_' + randomUUID().replace(/-/g, '');
  await scratch.query(`CREATE DATABASE ${database}`);
  const uri = new URL(container.getConnectionUri());
  uri.pathname = '/' + database;
  const old = new Pool({ connectionString: uri.toString() });
  try {
    const files = (await readdir('packages/core/migrations'))
      .filter((file) => file.endsWith('.sql'))
      .sort();
    for (const file of files.filter((file) => file < '0080')) {
      await old.query(
        await readFile('packages/core/migrations/' + file, 'utf8'),
      );
    }
    const tenant = randomUUID();
    await old.query(
      `INSERT INTO tenants (id, name, timezone)
       VALUES ($1, 'Synthetic migration', 'Europe/Berlin')`,
      [tenant],
    );
    for (const [name, notes] of [
      ['With note', '<p>Alte Notiz</p>'],
      ['Empty markup', '<p>&nbsp;</p>'],
      ['No note', ''],
    ])
      await old.query(
        `INSERT INTO events (tenant_id, id, name, status, source, time_zone,
           description, notes_html)
         VALUES ($1, gen_random_uuid(), $2, 'inquiry', '', 'Europe/Berlin',
           '', $3)`,
        [tenant, name, notes],
      );
    await old.query(
      await readFile('packages/core/migrations/0080_event_notes.sql', 'utf8'),
    );
    expect(
      (
        await old.query(
          `SELECT e.name, n.body_html, n.created_by FROM event_notes n
             JOIN events e ON e.tenant_id = n.tenant_id AND e.id = n.event_id`,
        )
      ).rows,
    ).toEqual([
      { name: 'With note', body_html: '<p>Alte Notiz</p>', created_by: null },
    ]);
    expect(
      (
        await old.query(
          `SELECT count(*)::int AS n FROM events WHERE notes_html <> ''`,
        )
      ).rows[0].n,
    ).toBe(0);
  } finally {
    await old.end();
    await scratch.query(`DROP DATABASE ${database}`);
    await scratch.end();
  }
});

// UI-BKP-04: like Bookitup an older note stays editable; it keeps its time and
// author, the edit is recorded and audited, and a removed or foreign note
// cannot be changed.
test('a note can be edited later and keeps its time and author', async () => {
  const { headers, write } = await signedIn();
  const event = await eventRepository(pool, tenantId).save(actorId, input);
  const url = `/api/v1/events/${event.id}/notes`;
  const [first] = (
    await app.inject({
      method: 'POST',
      url,
      headers: write,
      payload: { bodyHtml: '<p>Erste Fassung</p>' },
    })
  ).json() as { id: string; createdAt: string; updatedAt: string | null }[];
  expect(first!.updatedAt).toBeNull();
  const edit = (
    id: string,
    bodyHtml: string,
    extra: Record<string, string> = write,
  ) =>
    app.inject({
      method: 'PUT',
      url: `${url}/${id}`,
      headers: extra,
      payload: { bodyHtml },
    });
  const edited = await edit(
    first!.id,
    '<p>Zweite <strong>Fassung</strong></p><script>x()</script>',
  );
  expect(edited.statusCode).toBe(200);
  const [after] = edited.json() as {
    bodyHtml: string;
    createdAt: string;
    updatedAt: string | null;
    author: string | null;
  }[];
  expect(after).toMatchObject({
    bodyHtml: '<p>Zweite <strong>Fassung</strong></p>',
    createdAt: first!.createdAt,
    author: email,
  });
  expect(Date.parse(after!.updatedAt!)).not.toBeNaN();
  expect((await edit(first!.id, '<p> </p>')).json()).toEqual({
    error: 'empty_note',
  });
  expect((await edit(first!.id, '<p>x</p>', headers)).statusCode).toBe(403);
  expect((await edit(randomUUID(), '<p>x</p>')).statusCode).toBe(404);
  await app.inject({
    method: 'DELETE',
    url: `${url}/${first!.id}`,
    headers: write,
  });
  expect((await edit(first!.id, '<p>x</p>')).statusCode).toBe(404);
  const audit = await pool.query(
    `SELECT count(*)::int AS n FROM audit_events
      WHERE tenant_id=$1 AND action='event_note.updated' AND record_id=$2`,
    [tenantId, first!.id],
  );
  expect(audit.rows[0].n).toBe(1);
});
