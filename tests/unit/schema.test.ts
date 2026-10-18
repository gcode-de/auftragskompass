import { expect, test } from 'vitest';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { tenants, users, memberships } from '../../packages/core/src/schema.js';
import {
  gatewayMessages,
  gatewayOperations,
} from '../../packages/core/src/gateway-schema.js';
test('typed schema declares tenant-bound identity keys matching SQL', () => {
  expect(getTableConfig(tenants).columns.map((c) => c.name)).toEqual([
    'id',
    'name',
    'timezone',
  ]);
  const user = getTableConfig(users);
  expect(user.primaryKeys[0]!.columns.map((c) => c.name)).toEqual([
    'tenant_id',
    'id',
  ]);
  expect(user.uniqueConstraints).toHaveLength(2);
  const member = getTableConfig(memberships);
  expect(member.primaryKeys[0]!.columns.map((c) => c.name)).toEqual([
    'tenant_id',
    'user_id',
  ]);
  expect(
    [...user.foreignKeys, ...member.foreignKeys].map((f) =>
      f.reference().columns.map((c) => c.name),
    ),
  ).toEqual([['tenant_id'], ['tenant_id'], ['tenant_id', 'user_id']]);
});

test('gateway receipt keys include tenant and direction without business foreign keys or payloads', () => {
  for (const [table, id, columns] of [
    [
      gatewayMessages,
      'message_id',
      ['tenant_id', 'direction', 'message_id', 'issued_at', 'received_at'],
    ],
    [
      gatewayOperations,
      'operation_id',
      [
        'tenant_id',
        'direction',
        'operation_id',
        'kind',
        'payload_hash',
        'effect_count',
        'processed_at',
      ],
    ],
  ] as const) {
    const definition = getTableConfig(table);
    expect(definition.primaryKeys[0]!.columns.map((c) => c.name)).toEqual([
      'tenant_id',
      'direction',
      id,
    ]);
    expect(definition.foreignKeys).toHaveLength(0);
    expect(definition.columns.map((c) => c.name)).toEqual(columns);
  }
});
