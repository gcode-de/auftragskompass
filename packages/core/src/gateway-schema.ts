import {
  bigint,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import type { GatewayDirection, GatewayKind } from './gateway-message.js';

export const gatewayMessages = pgTable(
  'ak_gateway_messages',
  {
    tenantId: uuid('tenant_id').notNull(),
    direction: text('direction').$type<GatewayDirection>().notNull(),
    messageId: uuid('message_id').notNull(),
    issuedAt: bigint('issued_at', { mode: 'number' }).notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.direction, t.messageId] })],
);

export const gatewayOperations = pgTable(
  'ak_gateway_operations',
  {
    tenantId: uuid('tenant_id').notNull(),
    direction: text('direction').$type<GatewayDirection>().notNull(),
    operationId: uuid('operation_id').notNull(),
    kind: text('kind').$type<GatewayKind>().notNull(),
    payloadHash: text('payload_hash').notNull(),
    effectCount: integer('effect_count').notNull(),
    processedAt: timestamp('processed_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.direction, t.operationId] })],
);

export const gatewayInquiries = pgTable(
  'ak_gateway_inquiries',
  {
    tenantId: uuid('tenant_id').notNull(),
    id: uuid('id').notNull(),
    formId: text('form_id').notNull(),
    formVersion: integer('form_version').notNull(),
    keyId: text('key_id').notNull(),
    payloadHash: text('payload_hash').notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }),
    ciphertext: text('ciphertext'),
    iv: text('iv'),
    tag: text('tag'),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.id] })],
);
