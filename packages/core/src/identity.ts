import { createHash, randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import type { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { and, eq } from 'drizzle-orm';
import { tenants, users, memberships } from './schema.js';

export async function migrate(
  pool: Pool,
  supplied?: { name: string; sql: string }[],
) {
  const directory = new URL('../migrations/', import.meta.url);
  const migrations =
    supplied ??
    (await Promise.all(
      (await readdir(directory))
        .filter((n) => n.endsWith('.sql'))
        .sort()
        .map(async (name) => ({
          name,
          sql: await readFile(new URL(name, directory), 'utf8'),
        })),
    ));
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(814021)');
    await client.query(
      'CREATE TABLE IF NOT EXISTS ak_migrations (name text PRIMARY KEY, checksum text NOT NULL)',
    );
    for (const migration of migrations) {
      const checksum = createHash('sha256').update(migration.sql).digest('hex');
      const existing = await client.query<{ checksum: string }>(
        'SELECT checksum FROM ak_migrations WHERE name = $1',
        [migration.name],
      );
      if (existing.rows[0]) {
        if (existing.rows[0].checksum !== checksum)
          throw new Error('Migration checksum mismatch');
      } else {
        await client.query(migration.sql);
        await client.query('INSERT INTO ak_migrations VALUES ($1, $2)', [
          migration.name,
          checksum,
        ]);
      }
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export function identityRepository(pool: Pool, tenantId: string) {
  const db = drizzle(pool);
  return {
    tenantId,
    async createTenant(name: string, timezone: string) {
      new Intl.DateTimeFormat('de-DE', { timeZone: timezone });
      await db.insert(tenants).values({ id: tenantId, name, timezone });
    },
    async addAdministrator(googleSubject: string, email: string) {
      return db.transaction(async (tx) => {
        const [user] = await tx
          .insert(users)
          .values({
            tenantId,
            id: randomUUID(),
            googleSubject,
            email: email.trim().toLowerCase(),
          })
          .returning();
        await tx.insert(memberships).values({ tenantId, userId: user!.id });
        return user;
      });
    },
    async findAdministrator(subject: string) {
      const [result] = await db
        .select({ user: users })
        .from(users)
        .innerJoin(
          memberships,
          and(
            eq(memberships.tenantId, users.tenantId),
            eq(memberships.userId, users.id),
          ),
        )
        .where(
          and(
            eq(users.tenantId, tenantId),
            eq(users.googleSubject, subject),
            eq(memberships.active, true),
          ),
        );
      return result?.user;
    },
  };
}
