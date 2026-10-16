import { afterAll, beforeAll, expect, test } from 'vitest';
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
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
  await Promise.all([migrate(pool), migrate(pool)]);
  expect((await pool.query('SELECT * FROM ak_migrations')).rowCount).toBe(19);
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
