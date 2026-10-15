import { afterAll, beforeAll, expect, test } from 'vitest';
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { drizzle } from 'drizzle-orm/node-postgres';
import {
  migrate,
  identityRepository,
} from '../../packages/core/src/identity.js';
import { appendAudit, auditRepository } from '../../packages/core/src/audit.js';
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
test('audit is append-only, tenant-bound and part of its transaction', async () => {
  const tenantId = randomUUID(),
    other = randomUUID();
  const identity = identityRepository(pool, tenantId);
  await identity.createTenant('Synthetic audit', 'Europe/Berlin');
  await identityRepository(pool, other).createTenant(
    'Synthetic other',
    'Europe/Berlin',
  );
  const actor = await identity.addAdministrator(
    'audit-sub',
    'audit@example.invalid',
  );
  const db = drizzle(pool);
  await appendAudit(db, tenantId, 'login.succeeded', actor!.id);
  await expect(
    db.transaction(async (tx) => {
      await appendAudit(tx, tenantId, 'logout', actor!.id);
      throw new Error('rollback');
    }),
  ).rejects.toThrow('rollback');
  expect(
    (await auditRepository(pool, other).list()).every(
      (e) => e.action === 'master_data.created',
    ),
  ).toBe(true);
  expect(
    (await auditRepository(pool, tenantId).list()).filter(
      (e) => e.action !== 'master_data.created',
    ),
  ).toMatchObject([{ action: 'login.succeeded', actorId: actor!.id }]);
  await expect(
    appendAudit(db, other, 'login.succeeded', actor!.id),
  ).rejects.toThrow();
  for (const command of [
    'UPDATE audit_events SET action = action',
    'DELETE FROM audit_events',
    'TRUNCATE audit_events',
  ])
    await expect(pool.query(command)).rejects.toMatchObject({ code: '23514' });
  for (let i = 0; i < 105; i++) await appendAudit(db, tenantId, 'login.failed');
  const rows = await auditRepository(pool, tenantId).list();
  expect(rows).toHaveLength(100);
  expect(BigInt(rows[0]!.id)).toBeGreaterThan(BigInt(rows[99]!.id));
  expect(rows[0]!.occurredAt).toMatch(/Z$/);
});
