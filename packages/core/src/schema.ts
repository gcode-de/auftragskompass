import {
  boolean,
  bigint,
  foreignKey,
  pgTable,
  primaryKey,
  text,
  unique,
  uuid,
  timestamp,
} from 'drizzle-orm/pg-core';
export const tenants = pgTable('tenants', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull(),
  timezone: text('timezone').notNull(),
});
export const users = pgTable(
  'users',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    id: uuid('id').notNull(),
    googleSubject: text('google_subject').notNull(),
    email: text('email').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    unique().on(t.tenantId, t.googleSubject),
    unique().on(t.tenantId, t.email),
  ],
);
export const memberships = pgTable(
  'memberships',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    userId: uuid('user_id').notNull(),
    role: text('role').notNull().default('administrator'),
    active: boolean('active').notNull().default(true),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.userId] }),
    foreignKey({
      columns: [t.tenantId, t.userId],
      foreignColumns: [users.tenantId, users.id],
    }),
  ],
);

export const loginAttempts = pgTable('login_attempts', {
  tenantId: uuid('tenant_id').notNull(),
  stateHash: text('state_hash').notNull(),
  bindingHash: text('binding_hash').notNull(),
  verifier: text('verifier').notNull(),
  nonce: text('nonce').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
});
export const sessions = pgTable('sessions', {
  tenantId: uuid('tenant_id').notNull(),
  tokenHash: text('token_hash').notNull(),
  userId: uuid('user_id').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
});
export const allowedAccounts = pgTable('allowed_accounts', {
  tenantId: uuid('tenant_id').notNull(),
  id: uuid('id').notNull(),
  email: text('email').notNull(),
  active: boolean('active').notNull().default(true),
  userId: uuid('user_id'),
});
export const accessBootstrap = pgTable('access_bootstrap', {
  tenantId: uuid('tenant_id').primaryKey(),
});
export const accessAudit = pgTable('access_audit', {
  tenantId: uuid('tenant_id').notNull(),
  actorId: uuid('actor_id'),
  targetId: uuid('target_id').notNull(),
  action: text('action').notNull(),
});
export const auditEvents = pgTable('audit_events', {
  id: bigint('id', { mode: 'bigint' }).primaryKey().generatedAlwaysAsIdentity(),
  tenantId: uuid('tenant_id').notNull(),
  actorId: uuid('actor_id'),
  action: text('action').notNull(),
  occurredAt: timestamp('occurred_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});
