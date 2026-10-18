import { readdir, readFile } from 'node:fs/promises';
import { and, eq, sql } from 'drizzle-orm';
import type { Pool } from 'pg';
import { database, type Connection } from './database.js';
import { migrate } from './identity.js';
import {
  verifyGatewayMessage,
  type GatewayMessage,
} from './gateway-message.js';
import { gatewayMessages, gatewayOperations } from './gateway-schema.js';

export async function migrateGateway(pool: Pool) {
  const directory = new URL('../gateway-migrations/', import.meta.url);
  const migrations = await Promise.all(
    (await readdir(directory))
      .filter((n) => n.endsWith('.sql'))
      .sort()
      .map(async (name) => ({
        name,
        sql: await readFile(new URL(name, directory), 'utf8'),
      })),
  );
  await migrate(pool, migrations);
}

export class GatewayOperationError extends Error {
  constructor(
    readonly reason:
      'unauthorized' | 'replay' | 'conflict' | 'invalid_result' | 'failed',
  ) {
    super('Gateway operation rejected');
  }
}

export async function processGatewayOperation(
  pool: Pool,
  packet: unknown,
  context: Parameters<typeof verifyGatewayMessage>[1],
  apply: (
    connection: Connection,
    message: Readonly<GatewayMessage>,
  ) => Promise<number>,
): Promise<{ status: 'applied' | 'duplicate'; count: number }> {
  const message = verifyGatewayMessage(packet, context);
  if (!message) throw new GatewayOperationError('unauthorized');
  Object.freeze(message);
  const direction = context.direction;
  try {
    return await database(pool).transaction(async (tx) => {
      const [nonce] = await tx
        .insert(gatewayMessages)
        .values({
          tenantId: message.tenantId,
          direction,
          messageId: message.messageId,
          issuedAt: message.issuedAt,
        })
        .onConflictDoNothing()
        .returning({ id: gatewayMessages.messageId });
      if (!nonce) throw new GatewayOperationError('replay');
      // Serialize only the same tenant/direction/operation; hash collisions merely serialize extra work.
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${message.tenantId + ':' + direction + ':' + message.operationId}, 0))`,
      );
      const fingerprint = await tx.execute<{ hash: string }>(
        sql`SELECT encode(sha256(convert_to(${JSON.stringify([message.kind, message.payload])}::jsonb::text, 'UTF8')), 'hex') AS hash`,
      );
      const hash = fingerprint.rows[0]!.hash;
      const [previous] = await tx
        .select()
        .from(gatewayOperations)
        .where(
          and(
            eq(gatewayOperations.tenantId, message.tenantId),
            eq(gatewayOperations.direction, direction),
            eq(gatewayOperations.operationId, message.operationId),
          ),
        );
      if (previous) {
        if (previous.kind !== message.kind || previous.payloadHash !== hash)
          throw new GatewayOperationError('conflict');
        return { status: 'duplicate', count: previous.effectCount };
      }
      const count = await apply(tx, message);
      if (!Number.isSafeInteger(count) || count < 0 || count > 100)
        throw new GatewayOperationError('invalid_result');
      await tx.insert(gatewayOperations).values({
        tenantId: message.tenantId,
        direction,
        operationId: message.operationId,
        kind: message.kind,
        payloadHash: hash,
        effectCount: count,
      });
      return { status: 'applied', count };
    });
  } catch (error) {
    if (error instanceof GatewayOperationError) throw error;
    throw new GatewayOperationError('failed');
  }
}
