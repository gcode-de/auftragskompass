import { randomUUID } from 'node:crypto';
import { and, asc, eq, isNull, notExists } from 'drizzle-orm';
import { database, type Connection } from './database.js';
import { AccessError, lockTenant, requireAdministrator } from './access.js';
import { verifyGatewayMessage, type GatewayKey } from './gateway-message.js';
import {
  processGatewayOperation,
  GatewayOperationError,
} from './gateway-operations.js';
import { WebsiteInquiryError } from './website-inquiries.js';
import {
  websiteInquiryDeliveries,
  websiteInquiryAckOperations as operations,
  websiteInquiryAckItems as items,
  websiteInquiryAckAttempts as attempts,
} from './schema.js';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export async function prepareWebsiteInquiryAcknowledgement(
  connection: Connection,
  tenantId: string,
  actorId: string,
  at: Date,
): Promise<{
  operationId: string;
  messageId: string;
  inquiryIds: string[];
} | null> {
  if (
    !uuid.test(tenantId) ||
    !uuid.test(actorId) ||
    !(at instanceof Date) ||
    !Number.isFinite(at.getTime())
  )
    throw new WebsiteInquiryError('invalid');
  const clock = new Date(at.getTime());
  try {
    return await database(connection).transaction(async (tx) => {
      await lockTenant(tx, tenantId);
      await requireAdministrator(tx, tenantId, actorId);
      let [operation] = await tx
        .select()
        .from(operations)
        .where(
          and(
            eq(operations.tenantId, tenantId),
            isNull(operations.completedAt),
          ),
        );
      if (!operation) {
        const originals = await tx
          .select({ id: websiteInquiryDeliveries.id })
          .from(websiteInquiryDeliveries)
          .where(
            and(
              eq(websiteInquiryDeliveries.tenantId, tenantId),
              notExists(
                tx
                  .select({ id: items.inquiryId })
                  .from(items)
                  .where(
                    and(
                      eq(items.tenantId, tenantId),
                      eq(items.inquiryId, websiteInquiryDeliveries.id),
                    ),
                  ),
              ),
            ),
          )
          .orderBy(
            asc(websiteInquiryDeliveries.stagedAt),
            asc(websiteInquiryDeliveries.id),
          )
          .limit(100);
        if (!originals.length) return null;
        [operation] = await tx
          .insert(operations)
          .values({ tenantId, id: randomUUID(), createdAt: clock })
          .returning();
        await tx.insert(items).values(
          originals.map((original) => ({
            tenantId,
            operationId: operation!.id,
            inquiryId: original.id,
          })),
        );
      }
      const originals = await tx
        .select({ id: items.inquiryId })
        .from(items)
        .where(
          and(
            eq(items.tenantId, tenantId),
            eq(items.operationId, operation!.id),
          ),
        )
        .orderBy(asc(items.inquiryId));
      if (!originals.length || originals.length > 100)
        throw new WebsiteInquiryError('invalid');
      const messageId = randomUUID();
      await tx.insert(attempts).values({
        tenantId,
        messageId,
        operationId: operation!.id,
        createdAt: clock,
      });
      return {
        operationId: operation!.id,
        messageId,
        inquiryIds: originals.map((original) => original.id),
      };
    });
  } catch (error) {
    if (error instanceof WebsiteInquiryError) throw error;
    if (error instanceof AccessError)
      throw new WebsiteInquiryError('forbidden');
    throw new WebsiteInquiryError('failed');
  }
}
export async function receiveWebsiteInquiryAcknowledgement(
  connection: Connection,
  tenantId: string,
  actorId: string,
  packet: unknown,
  options: { keys: readonly GatewayKey[]; at: Date },
) {
  if (
    !uuid.test(tenantId) ||
    !uuid.test(actorId) ||
    !(options.at instanceof Date) ||
    !Number.isFinite(options.at.getTime())
  )
    throw new WebsiteInquiryError('invalid');
  const at = new Date(options.at.getTime()),
    context = {
      tenantId,
      direction: 'gateway-to-core' as const,
      kind: 'inquiries.receipt' as const,
      keys: options.keys.map((key) => ({
        ...key,
        secret: Buffer.from(key.secret),
      })),
      now: Math.floor(at.getTime() / 1000),
    };
  const message = verifyGatewayMessage(packet, context);
  if (!message) throw new GatewayOperationError('unauthorized');
  const { requestId, acknowledgedCount } = message.payload;
  if (
    Object.keys(message.payload).sort().join(',') !==
      'acknowledgedCount,requestId' ||
    typeof requestId !== 'string' ||
    !uuid.test(requestId) ||
    typeof acknowledgedCount !== 'number' ||
    !Number.isSafeInteger(acknowledgedCount) ||
    acknowledgedCount < 0 ||
    acknowledgedCount > 100
  )
    throw new WebsiteInquiryError('invalid');
  const snapshot = structuredClone(packet);
  try {
    return await database(connection).transaction(async (tx) => {
      await lockTenant(tx, tenantId);
      await requireAdministrator(tx, tenantId, actorId);
      const [attempt] = await tx
        .select()
        .from(attempts)
        .where(
          and(
            eq(attempts.tenantId, tenantId),
            eq(attempts.messageId, requestId),
          ),
        );
      if (!attempt) throw new WebsiteInquiryError('not_found');
      const originals = await tx
        .select({ id: items.inquiryId })
        .from(items)
        .where(
          and(
            eq(items.tenantId, tenantId),
            eq(items.operationId, attempt.operationId),
          ),
        );
      if (
        !originals.length ||
        originals.length > 100 ||
        acknowledgedCount > originals.length
      )
        throw new WebsiteInquiryError('invalid');
      return processGatewayOperation(tx, snapshot, context, async (conn) => {
        await database(conn)
          .update(operations)
          .set({ completedAt: at })
          .where(
            and(
              eq(operations.tenantId, tenantId),
              eq(operations.id, attempt.operationId),
              isNull(operations.completedAt),
            ),
          );
        return acknowledgedCount;
      });
    });
  } catch (error) {
    if (
      error instanceof WebsiteInquiryError ||
      error instanceof GatewayOperationError
    )
      throw error;
    if (error instanceof AccessError)
      throw new WebsiteInquiryError('forbidden');
    throw new WebsiteInquiryError('failed');
  }
}
