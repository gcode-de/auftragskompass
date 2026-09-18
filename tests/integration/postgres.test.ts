import { afterAll, beforeAll, expect, test } from 'vitest';
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { Client } from 'pg';

let container: StartedPostgreSqlContainer | undefined;
let client: Client | undefined;
beforeAll(async () => {
  // Always a fresh container: never accept a production DATABASE_URL.
  container = await new PostgreSqlContainer('postgres:17.6-alpine').start();
  client = new Client({ connectionString: container.getConnectionUri() });
  await client.connect();
});
afterAll(async () => {
  try {
    await client?.end();
  } finally {
    await container?.stop();
  }
});
test('real PostgreSQL rolls back synthetic writes and enforces uniqueness', async () => {
  if (!client) throw new Error('Test database did not start');
  await client.query(
    'CREATE TABLE harness_example (id integer PRIMARY KEY, label text NOT NULL)',
  );
  await client.query('BEGIN');
  await client.query('INSERT INTO harness_example VALUES ($1, $2)', [
    1,
    'Synthetic test record',
  ]);
  await client.query('ROLLBACK');
  expect((await client.query('SELECT * FROM harness_example')).rows).toEqual(
    [],
  );
  await client.query('INSERT INTO harness_example VALUES ($1, $2)', [
    1,
    'Synthetic test record',
  ]);
  await expect(
    client.query('INSERT INTO harness_example VALUES ($1, $2)', [
      1,
      'Synthetic duplicate',
    ]),
  ).rejects.toMatchObject({ code: '23505' });
});
