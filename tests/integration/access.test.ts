import { afterAll, beforeAll, expect, test } from 'vitest';
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { identityRepository } from '../../packages/core/src/identity.js';
import { migrate } from '../../packages/core/src/identity.js';
import {
  accessRepository,
  bootstrapAccess,
} from '../../packages/core/src/access.js';
let container: StartedPostgreSqlContainer;
let pool: Pool;
beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:17.6-alpine').start();
  pool = new Pool({ connectionString: container.getConnectionUri() });
  await migrate(pool);
});
afterAll(async () => {
  await pool?.end();
  await container?.stop();
});
test('bootstrap is explicit and one-time; claims are restricted and bound to subject', async () => {
  const tenantId = randomUUID();
  const repo = accessRepository(pool, tenantId);
  await expect(
    bootstrapAccess(pool, tenantId, undefined, 'Synthetic', 'Europe/Berlin'),
  ).rejects.toThrow('Bootstrap required');
  await expect(
    bootstrapAccess(pool, tenantId, 'bad', 'Synthetic', 'Europe/Berlin'),
  ).rejects.toThrow('Invalid email');
  await Promise.all([
    bootstrapAccess(
      pool,
      tenantId,
      'synthetic@example.invalid',
      'Synthetic',
      'Europe/Berlin',
    ),
    bootstrapAccess(
      pool,
      tenantId,
      'synthetic@example.invalid',
      'Synthetic',
      'Europe/Berlin',
    ),
  ]);
  await bootstrapAccess(
    pool,
    tenantId,
    'attacker@example.invalid',
    'Synthetic',
    'Europe/Berlin',
  );
  expect(await repo.list()).toHaveLength(1);
  expect(
    await repo.issueSession(
      { subject: 'other', email: 'other@example.invalid' },
      'hash-other',
    ),
  ).toBe(false);
  expect(
    await repo.issueSession(
      { subject: 'synthetic-sub', email: 'synthetic@example.invalid' },
      'hash-first',
    ),
  ).toBe(true);
  expect(
    await repo.issueSession(
      { subject: 'wrong-sub', email: 'synthetic@example.invalid' },
      'hash-wrong',
    ),
  ).toBe(false);
  const userId = (await repo.list())[0]!.userId!;
  await expect(
    repo.change(
      userId,
      (await repo.list()).find((a) => a.userId === userId)!.id,
      false,
    ),
  ).rejects.toThrow('last_administrator');
  await expect(
    pool.query('UPDATE allowed_accounts SET active=false WHERE tenant_id=$1', [
      tenantId,
    ]),
  ).rejects.toMatchObject({ code: '23514' });
  await expect(
    pool.query('UPDATE memberships SET active=false WHERE tenant_id=$1', [
      tenantId,
    ]),
  ).rejects.toMatchObject({ code: '23514' });
  const pending = await repo.grant(userId, 'pending@example.invalid');
  expect(
    await repo.issueSession(
      { subject: 'synthetic-sub', email: 'pending@example.invalid' },
      'attempt-new-email',
    ),
  ).toBe(false);
  await expect(
    repo.change(
      userId,
      (await repo.list()).find((a) => a.userId === userId)!.id,
      false,
    ),
  ).rejects.toThrow('last_administrator');
  await repo.change(userId, pending.id, false);
  await repo.change(userId, pending.id, false);
  await bootstrapAccess(
    pool,
    tenantId,
    'pending@example.invalid',
    'Synthetic',
    'Europe/Berlin',
  );
  expect((await repo.list()).find((a) => a.id === pending.id)!.active).toBe(
    false,
  );
  expect(
    await repo.issueSession(
      { subject: 'pending', email: 'pending@example.invalid' },
      'pending',
    ),
  ).toBe(false);
  await expect(repo.grant(randomUUID(), 'new@example.invalid')).rejects.toThrow(
    'forbidden',
  );
  await expect(repo.change(userId, randomUUID(), false)).rejects.toThrow(
    'not_found',
  );
  await expect(repo.grant(userId, 'synthetic@example.invalid')).rejects.toThrow(
    'already_exists',
  );
  await expect(repo.grant(userId, 'bad')).rejects.toThrow('Invalid email');
  const audit = await pool.query(
    'SELECT action FROM access_audit WHERE tenant_id = $1 ORDER BY id',
    [tenantId],
  );
  expect(audit.rows.map((r) => r.action)).toEqual([
    'bootstrap',
    'claim',
    'grant',
    'disable',
  ]);
  await expect(
    pool.query('UPDATE access_audit SET action = action'),
  ).rejects.toMatchObject({ code: '23514' });
  await expect(pool.query('DELETE FROM access_audit')).rejects.toMatchObject({
    code: '23514',
  });
  await expect(pool.query('TRUNCATE access_audit')).rejects.toMatchObject({
    code: '23514',
  });
});
test('concurrent disable and login revoke sessions without removing the last real administrator', async () => {
  const tenantId = randomUUID();
  const repo = accessRepository(pool, tenantId);
  await bootstrapAccess(
    pool,
    tenantId,
    'first@example.invalid',
    'Synthetic concurrent',
    'Europe/Berlin',
  );
  await repo.issueSession(
    { subject: 'first', email: 'first@example.invalid' },
    'first-session',
  );
  const first = (await repo.list())[0]!;
  const second = await repo.grant(first.userId!, 'second@example.invalid');
  await repo.issueSession(
    { subject: 'second', email: 'second@example.invalid' },
    'second-session',
  );
  const results = await Promise.allSettled([
    repo.change(first.userId!, first.id, false),
    repo.change(first.userId!, second.id, false),
  ]);
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  const active = (await repo.list()).find((a) => a.active)!;
  const disabled = (await repo.list()).find((a) => !a.active)!;
  expect(
    (
      await pool.query(
        'SELECT * FROM sessions WHERE tenant_id=$1 AND user_id=$2',
        [tenantId, disabled.userId],
      )
    ).rowCount,
  ).toBe(0);
  await repo.change(active.userId!, disabled.id, true);
  // Re-enabling must never resurrect an old session.
  expect(
    (
      await pool.query(
        'SELECT * FROM sessions WHERE tenant_id=$1 AND user_id=$2',
        [tenantId, disabled.userId],
      )
    ).rowCount,
  ).toBe(0);
  await Promise.all([
    repo.issueSession(
      { subject: disabled.email.split('@')[0]!, email: disabled.email },
      'racing-session',
    ),
    repo.change(active.userId!, disabled.id, false),
  ]);
  expect(
    (
      await pool.query(
        'SELECT * FROM sessions WHERE tenant_id=$1 AND user_id=$2',
        [tenantId, disabled.userId],
      )
    ).rowCount,
  ).toBe(0);
  const foreign = accessRepository(pool, randomUUID());
  expect(await foreign.list()).toEqual([]);
  await expect(
    foreign.change(active.userId!, active.id, false),
  ).rejects.toThrow('forbidden');
  await expect(
    foreign.grant(active.userId!, 'foreign@example.invalid'),
  ).rejects.toThrow('forbidden');
});

test('upgrade preserves previously provisioned accounts without reopening bootstrap', async () => {
  await pool.query('CREATE DATABASE synthetic_upgrade');
  const url = new URL(container.getConnectionUri());
  url.pathname = '/synthetic_upgrade';
  const upgrade = new Pool({ connectionString: url.href });
  try {
    const previous = await Promise.all(
      ['0001_identity.sql', '0002_auth.sql'].map(async (name) => ({
        name,
        sql: await readFile(
          new URL('../../packages/core/migrations/' + name, import.meta.url),
          'utf8',
        ),
      })),
    );
    await migrate(upgrade, previous);
    const tenantId = randomUUID();
    const identities = identityRepository(upgrade, tenantId);
    await identities.createTenant('Synthetic upgrade', 'Europe/Berlin');
    await identities.addAdministrator('existing', 'existing@example.invalid');
    await migrate(upgrade);
    await bootstrapAccess(
      upgrade,
      tenantId,
      undefined,
      'Ignored',
      'Europe/Berlin',
    );
    const repo = accessRepository(upgrade, tenantId);
    expect(await repo.list()).toHaveLength(1);
    expect(
      await repo.issueSession(
        { subject: 'existing', email: 'existing@example.invalid' },
        'upgrade-session',
      ),
    ).toBe(true);
    expect(
      (await upgrade.query('SELECT action FROM access_audit')).rows,
    ).toEqual([{ action: 'migration' }]);
  } finally {
    await upgrade.end();
  }
});
