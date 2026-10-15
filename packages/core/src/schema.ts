import {
  boolean,
  bigint,
  integer,
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
  recordId: uuid('record_id'),
  id: bigint('id', { mode: 'bigint' }).primaryKey().generatedAlwaysAsIdentity(),
  tenantId: uuid('tenant_id').notNull(),
  actorId: uuid('actor_id'),
  action: text('action').notNull(),
  occurredAt: timestamp('occurred_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});
export const masterData = pgTable('master_data', {
  tenantId: uuid('tenant_id').notNull(),
  id: uuid('id').notNull(),
  kind: text('kind').notNull(),
  name: text('name').notNull(),
  position: integer('position').notNull(),
  state: text('state').notNull(),
  version: integer('version').notNull().default(1),
});
export const resources = pgTable('resources', {
  tenantId: uuid('tenant_id').notNull(),
  id: uuid('id').notNull(),
  name: text('name').notNull(),
  code: text('code').notNull(),
  category: text('category').notNull(),
  description: text('description').notNull(),
  quantity: integer('quantity').notNull(),
  beforeDays: integer('before_days').notNull(),
  afterDays: integer('after_days').notNull(),
  blocked: boolean('blocked').notNull(),
  state: text('state').notNull(),
  position: integer('position').notNull(),
  version: integer('version').notNull().default(1),
});
export const products = pgTable('products', {
  tenantId: uuid('tenant_id').notNull(),
  id: uuid('id').notNull(),
  name: text('name').notNull(),
  description: text('description').notNull(),
  unit: text('unit').notNull(),
  priceMinor: bigint('price_minor', { mode: 'number' }).notNull(),
  priceBasis: text('price_basis').notNull(),
  taxBasisPoints: integer('tax_basis_points').notNull(),
  state: text('state').notNull(),
  position: integer('position').notNull(),
  version: integer('version').notNull().default(1),
});

export const contacts = pgTable('contacts', {
  tenantId: uuid('tenant_id').notNull(),
  id: uuid('id').notNull(),
  kind: text('kind').notNull(),
  name: text('name').notNull(),
  contactPerson: text('contact_person').notNull(),
  street: text('street').notNull(),
  postalCode: text('postal_code').notNull(),
  city: text('city').notNull(),
  country: text('country').notNull(),
  email: text('email').notNull(),
  phone: text('phone').notNull(),
  mobile: text('mobile').notNull(),
  phoneKey: text('phone_key').notNull(),
  mobileKey: text('mobile_key').notNull(),
  state: text('state').notNull(),
  version: integer('version').notNull().default(1),
});
