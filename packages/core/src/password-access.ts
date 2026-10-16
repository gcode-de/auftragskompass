import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { and, eq, or, sql } from 'drizzle-orm';
import {
  allowedAccounts,
  memberships,
  passwordCredentials,
  passwordBootstrap,
  users,
  sessions,
  accessAudit,
} from './schema.js';
import { appendAudit } from './audit.js';
import { hashPassword, normalizeUsername, verifyPassword } from './password.js';

export async function bootstrapPassword(
  pool: Pool,
  tenantId: string,
  email: string | undefined,
  username: string | undefined,
  readPassword: () => string,
) {
  await drizzle(pool).transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${tenantId}::text, 814022))`,
    );
    if (
      (
        await tx
          .select()
          .from(passwordBootstrap)
          .where(eq(passwordBootstrap.tenantId, tenantId))
      ).length
    )
      return;
    const [account] = await tx
      .select()
      .from(allowedAccounts)
      .where(
        and(
          eq(allowedAccounts.tenantId, tenantId),
          eq(allowedAccounts.email, (email ?? '').trim().toLowerCase()),
          eq(allowedAccounts.active, true),
        ),
      );
    if (!account || account.userId)
      throw new Error(
        'Password bootstrap requires an unclaimed allowed account',
      );
    if (
      (
        await tx
          .select({ id: users.id })
          .from(users)
          .where(eq(users.tenantId, tenantId))
          .limit(1)
      ).length
    )
      throw new Error(
        'Password bootstrap requires a fresh tenant without existing identities',
      );
    const normalized = normalizeUsername(username ?? '');
    // Read the external secret only for the first bootstrap; restarts cannot reset access.
    const passwordHash = await hashPassword(readPassword());
    const userId = randomUUID();
    await tx
      .insert(users)
      .values({ tenantId, id: userId, email: account.email });
    await tx.insert(memberships).values({ tenantId, userId });
    await tx
      .update(allowedAccounts)
      .set({ userId })
      .where(
        and(
          eq(allowedAccounts.tenantId, tenantId),
          eq(allowedAccounts.id, account.id),
        ),
      );
    await tx
      .insert(passwordCredentials)
      .values({ tenantId, userId, username: normalized, passwordHash });
    await tx.insert(accessAudit).values({
      tenantId,
      actorId: userId,
      targetId: account.id,
      action: 'claim',
    });
    await tx.insert(passwordBootstrap).values({ tenantId });
  });
}
export function passwordAccess(pool: Pool, tenantId: string) {
  return {
    async issueSession(
      identifier: string,
      password: string,
      tokenHash: string,
    ) {
      const normalized = identifier.trim().toLowerCase();
      return drizzle(pool).transaction(async (tx) => {
        // Same lock as access revocation: no successful login may race an account block.
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtextextended(${tenantId}::text, 814022))`,
        );
        const [account] = await tx
          .select({
            credential: passwordCredentials,
            allowed: allowedAccounts.active,
            member: memberships.active,
            locked: sql<boolean>`coalesce(${passwordCredentials.lockedUntil} > now(), false)`,
          })
          .from(passwordCredentials)
          .innerJoin(
            users,
            and(
              eq(users.tenantId, passwordCredentials.tenantId),
              eq(users.id, passwordCredentials.userId),
            ),
          )
          .innerJoin(
            allowedAccounts,
            and(
              eq(allowedAccounts.tenantId, users.tenantId),
              eq(allowedAccounts.userId, users.id),
            ),
          )
          .innerJoin(
            memberships,
            and(
              eq(memberships.tenantId, users.tenantId),
              eq(memberships.userId, users.id),
            ),
          )
          .where(
            and(
              eq(passwordCredentials.tenantId, tenantId),
              or(
                eq(passwordCredentials.username, normalized),
                eq(users.email, normalized),
              ),
            ),
          );
        const matches = await verifyPassword(
          password,
          account?.credential.passwordHash,
        );
        const valid = Boolean(
          matches && account?.allowed && account.member && !account.locked,
        );
        if (account && !account.locked) {
          const failures = valid
            ? 0
            : account.credential.lockedUntil
              ? 1
              : account.credential.failures + 1;
          await tx
            .update(passwordCredentials)
            .set({
              failures,
              lockedUntil:
                failures >= 5 ? sql`now() + interval '15 minutes'` : null,
            })
            .where(
              and(
                eq(passwordCredentials.tenantId, tenantId),
                eq(passwordCredentials.userId, account.credential.userId),
              ),
            );
        }
        if (!valid) {
          await appendAudit(tx, tenantId, 'login.denied');
          return false;
        }
        await tx.delete(sessions).where(sql`${sessions.expiresAt} <= now()`);
        await tx.insert(sessions).values({
          tenantId,
          userId: account!.credential.userId,
          tokenHash,
          expiresAt: new Date(Date.now() + 8 * 60 * 60_000),
        });
        await appendAudit(
          tx,
          tenantId,
          'login.succeeded',
          account!.credential.userId,
        );
        return true;
      });
    },
  };
}
