import { afterAll, beforeAll, expect, test } from 'vitest';
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { createHash, randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import {
  migrate,
  identityRepository,
} from '../../packages/core/src/identity.js';
let container: StartedPostgreSqlContainer;
let pool: Pool;
beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:17.6-alpine').start();
  pool = new Pool({ connectionString: container.getConnectionUri() });
});
afterAll(async () => {
  await pool?.end();
  await container?.stop();
});
test('migrations serialize, restart safely and detect changed history', async () => {
  const directory = new URL('../../packages/core/migrations/', import.meta.url),
    names = (await readdir(directory))
      .filter((name) => name.endsWith('.sql'))
      .sort(),
    expected = await Promise.all(
      names.map(async (name) => ({
        name,
        checksum: createHash('sha256')
          .update(await readFile(new URL(name, directory), 'utf8'))
          .digest('hex'),
      })),
    );
  await Promise.all([migrate(pool), migrate(pool)]);
  const applied = (
    await pool.query<{ name: string; checksum: string }>(
      'SELECT name, checksum FROM ak_migrations ORDER BY name',
    )
  ).rows;
  expect(applied).toEqual(expected);
  // H034 adds the optional place without touching existing data.
  expect(applied.at(-1)!.name).toBe('0032_event_venue.sql');
  const columns = (
    await pool.query<{
      column_name: string;
      data_type: string;
      is_nullable: string;
      column_default: string | null;
    }>(
      "SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema='public' AND table_name='events' AND column_name IN ('venue','venue_override') ORDER BY column_name",
    )
  ).rows;
  expect(columns).toEqual([
    {
      column_name: 'venue',
      data_type: 'text',
      is_nullable: 'YES',
      column_default: null,
    },
    {
      column_name: 'venue_override',
      data_type: 'boolean',
      is_nullable: 'NO',
      column_default: 'false',
    },
  ]);
  const constraints = (
    await pool.query<{ def: string }>(
      "SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid='events'::regclass AND pg_get_constraintdef(oid) ILIKE '%venue%'",
    )
  ).rows.map((row) => row.def);
  expect(constraints).toContain(
    'CHECK (((venue IS NULL) OR (length(venue) <= 1000)))',
  );
  await migrate(pool);
  expect((await pool.query('SELECT * FROM ak_migrations')).rowCount).toBe(
    names.length,
  );
  await pool.query("UPDATE ak_migrations SET checksum = 'tampered'");
  await expect(migrate(pool)).rejects.toThrow('Migration checksum mismatch');
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
  await expect(
    migrate(pool, [
      {
        name: 'broken.sql',
        sql: 'CREATE TABLE partial(id int); SELECT missing FROM partial',
      },
    ]),
  ).rejects.toThrow();
  expect(
    (await pool.query("SELECT to_regclass('partial') AS table")).rows[0].table,
  ).toBeNull();
  await migrate(pool);
});
test('repositories isolate tenants, enforce uniqueness and compound foreign keys', async () => {
  const a = identityRepository(pool, randomUUID());
  const b = identityRepository(pool, randomUUID());
  await a.createTenant('Synthetic A', 'Europe/Berlin');
  await b.createTenant('Synthetic B', 'Europe/Berlin');
  const user = await a.addAdministrator(
    'synthetic-subject',
    'synthetic@example.invalid',
  );
  expect(await a.findAdministrator('synthetic-subject')).toEqual(user);
  expect(await b.findAdministrator('synthetic-subject')).toBeUndefined();
  await b.addAdministrator('synthetic-subject', 'synthetic@example.invalid');
  await expect(
    a.addAdministrator('other', 'synthetic@example.invalid'),
  ).rejects.toThrow();
  await expect(
    a.addAdministrator('synthetic-subject', 'other@example.invalid'),
  ).rejects.toThrow();
  await expect(
    pool.query('INSERT INTO memberships (tenant_id, user_id) VALUES ($1, $2)', [
      b.tenantId,
      user!.id,
    ]),
  ).rejects.toMatchObject({ code: '23503' });
  await expect(
    pool.query(
      'INSERT INTO users (tenant_id, id, google_subject, email) VALUES ($1,$2,$3,$4)',
      [a.tenantId, randomUUID(), 'bad', 'UPPER@example.invalid'],
    ),
  ).rejects.toMatchObject({ code: '23514' });
  await pool.query(
    'UPDATE memberships SET active = false WHERE tenant_id = $1',
    [a.tenantId],
  );
  expect(await a.findAdministrator('synthetic-subject')).toBeUndefined();
});
