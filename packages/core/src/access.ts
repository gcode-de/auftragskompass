import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { and, eq, sql } from 'drizzle-orm';
import {
  tenants,
  users,
  memberships,
  sessions,
  allowedAccounts,
  accessBootstrap,
  accessAudit,
} from './schema.js';
import type { GoogleIdentity } from './oidc.js';
type Transaction = Parameters<Parameters<NodePgDatabase['transaction']>[0]>[0];
async function lockTenant(tx: Transaction, tenantId: string) {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${tenantId}, 814022))`,
  );
}
export class AccessError extends Error {}
function normalizeEmail(value: string) {
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new AccessError('Invalid email');
  return email;
}
export async function bootstrapAccess(
  pool: Pool,
  tenantId: string,
  initialEmail: string | undefined,
  name: string,
  timezone: string,
) {
  return drizzle(pool).transaction(async (tx) => {
    await lockTenant(tx, tenantId);
    const [done] = await tx
      .select()
      .from(accessBootstrap)
      .where(eq(accessBootstrap.tenantId, tenantId));
    if (done) return;
    if (!initialEmail) throw new AccessError('Bootstrap required');
    const email = normalizeEmail(initialEmail);
    new Intl.DateTimeFormat('de-DE', { timeZone: timezone });
    await tx
      .insert(tenants)
      .values({ id: tenantId, name, timezone })
      .onConflictDoNothing();
    const targetId = randomUUID();
    await tx.insert(allowedAccounts).values({ tenantId, id: targetId, email });
    await tx
      .insert(accessAudit)
      .values({ tenantId, targetId, action: 'bootstrap' });
    await tx.insert(accessBootstrap).values({ tenantId });
  });
}
export function accessRepository(pool: Pool, tenantId: string) {
  const db = drizzle(pool);
  const scoped = eq(allowedAccounts.tenantId, tenantId);
  async function requireActor(tx: Transaction, actorId: string) {
    const [actor] = await tx
      .select()
      .from(allowedAccounts)
      .innerJoin(
        memberships,
        and(
          eq(memberships.tenantId, allowedAccounts.tenantId),
          eq(memberships.userId, allowedAccounts.userId),
        ),
      )
      .where(
        and(
          scoped,
          eq(allowedAccounts.userId, actorId),
          eq(allowedAccounts.active, true),
          eq(memberships.active, true),
        ),
      );
    if (!actor) throw new AccessError('forbidden');
  }
  return {
    async list() {
      return db
        .select({
          id: allowedAccounts.id,
          email: allowedAccounts.email,
          active: allowedAccounts.active,
          userId: allowedAccounts.userId,
        })
        .from(allowedAccounts)
        .where(scoped)
        .orderBy(allowedAccounts.email);
    },
    async issueSession(identity: GoogleIdentity, tokenHash: string) {
      return db.transaction(async (tx) => {
        await lockTenant(tx, tenantId);
        const [account] = await tx
          .select()
          .from(allowedAccounts)
          .where(
            and(
              scoped,
              eq(allowedAccounts.email, normalizeEmail(identity.email)),
              eq(allowedAccounts.active, true),
            ),
          );
        if (!account) return false;
        let userId = account.userId;
        if (userId) {
          const [user] = await tx
            .select()
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
                eq(users.id, userId),
                eq(users.googleSubject, identity.subject),
                eq(memberships.active, true),
              ),
            );
          if (!user) return false;
        } else {
          // A Google subject already bound elsewhere may not claim another email.
          const [existing] = await tx
            .select()
            .from(users)
            .where(
              and(
                eq(users.tenantId, tenantId),
                eq(users.googleSubject, identity.subject),
              ),
            );
          if (existing) return false;
          userId = randomUUID();
          await tx.insert(users).values({
            tenantId,
            id: userId,
            googleSubject: identity.subject,
            email: account.email,
          });
          await tx.insert(memberships).values({ tenantId, userId });
          await tx
            .update(allowedAccounts)
            .set({ userId })
            .where(and(scoped, eq(allowedAccounts.id, account.id)));
          await tx
            .insert(accessAudit)
            .values({ tenantId, targetId: account.id, action: 'claim' });
        }
        await tx.insert(sessions).values({
          tenantId,
          tokenHash,
          userId,
          expiresAt: new Date(Date.now() + 8 * 60 * 60_000),
        });
        return true;
      });
    },
    async grant(actorId: string, value: string) {
      const email = normalizeEmail(value);
      return db.transaction(async (tx) => {
        await lockTenant(tx, tenantId);
        await requireActor(tx, actorId);
        const [existing] = await tx
          .select()
          .from(allowedAccounts)
          .where(and(scoped, eq(allowedAccounts.email, email)));
        if (existing) throw new AccessError('already_exists');
        const [account] = await tx
          .insert(allowedAccounts)
          .values({ tenantId, id: randomUUID(), email })
          .returning();
        await tx.insert(accessAudit).values({
          tenantId,
          actorId,
          targetId: account!.id,
          action: 'grant',
        });
        return account!;
      });
    },
    async change(actorId: string, id: string, active: boolean) {
      return db.transaction(async (tx) => {
        await lockTenant(tx, tenantId);
        await requireActor(tx, actorId);
        const [account] = await tx
          .select()
          .from(allowedAccounts)
          .where(and(scoped, eq(allowedAccounts.id, id)));
        if (!account) throw new AccessError('not_found');
        if (account.active === active) return;
        if (!active && account.userId) {
          const admins = await tx
            .select()
            .from(allowedAccounts)
            .innerJoin(
              memberships,
              and(
                eq(memberships.tenantId, allowedAccounts.tenantId),
                eq(memberships.userId, allowedAccounts.userId),
              ),
            )
            .where(
              and(
                scoped,
                eq(allowedAccounts.active, true),
                eq(memberships.active, true),
              ),
            );
          if (admins.length <= 1) throw new AccessError('last_administrator');
        }
        await tx
          .update(allowedAccounts)
          .set({ active })
          .where(and(scoped, eq(allowedAccounts.id, id)));
        if (account.userId) {
          await tx
            .update(memberships)
            .set({ active })
            .where(
              and(
                eq(memberships.tenantId, tenantId),
                eq(memberships.userId, account.userId),
              ),
            );
          await tx
            .delete(sessions)
            .where(
              and(
                eq(sessions.tenantId, tenantId),
                eq(sessions.userId, account.userId),
              ),
            );
        }
        await tx.insert(accessAudit).values({
          tenantId,
          actorId,
          targetId: id,
          action: active ? 'enable' : 'disable',
        });
      });
    },
  };
}
