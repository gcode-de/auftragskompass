import type { Pool } from 'pg';
import { database } from './database.js';
import { AccessError, lockTenant, requireAdministrator } from './access.js';
import { verifyGatewayMessage, type GatewayKey } from './gateway-message.js';
import {
  processGatewayOperation,
  GatewayOperationError,
} from './gateway-operations.js';
import {
  isWebsiteInquiry,
  WebsiteInquiryError,
  type WebsiteInquiry,
} from './website-inquiries.js';
import { stageWebsiteInquiry } from './website-inquiry-deliveries.js';

// Transport only: staging is durable before any later acknowledgement or contact review.
export async function receiveWebsiteInquiryBatch(
  pool: Pool,
  tenantId: string,
  actorId: string,
  packet: unknown,
  options: { requestId: string; keys: readonly GatewayKey[]; at: Date },
) {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  if (
    !uuid.test(actorId) ||
    !uuid.test(options.requestId) ||
    !(options.at instanceof Date) ||
    !Number.isFinite(options.at.getTime())
  )
    throw new WebsiteInquiryError('invalid');
  const at = new Date(options.at.getTime()),
    context = {
      tenantId,
      direction: 'gateway-to-core' as const,
      kind: 'inquiries.batch' as const,
      keys: options.keys.map((key) => ({
        ...key,
        secret: Buffer.from(key.secret),
      })),
      now: Math.floor(at.getTime() / 1000),
    };
  const message = verifyGatewayMessage(packet, context);
  if (!message) throw new GatewayOperationError('unauthorized');
  const { payload } = message;
  if (
    Object.keys(payload).sort().join(',') !== 'inquiries,requestId' ||
    payload.requestId !== options.requestId ||
    !Array.isArray(payload.inquiries) ||
    payload.inquiries.length > 100 ||
    !payload.inquiries.every(isWebsiteInquiry) ||
    new Set(payload.inquiries.map((item) => item.id)).size !==
      payload.inquiries.length ||
    Buffer.byteLength(JSON.stringify(payload.inquiries), 'utf8') > 50000
  )
    throw new WebsiteInquiryError('invalid');
  const snapshot = structuredClone(packet);
  try {
    return await database(pool).transaction(async (tx) => {
      await lockTenant(tx, tenantId);
      await requireAdministrator(tx, tenantId, actorId);
      return processGatewayOperation(
        tx,
        snapshot,
        context,
        async (connection, msg) => {
          const inquiries = msg.payload.inquiries as WebsiteInquiry[];
          for (const inquiry of inquiries)
            await stageWebsiteInquiry(
              connection,
              tenantId,
              actorId,
              inquiry,
              at,
            );
          return inquiries.length;
        },
      );
    });
  } catch (error) {
    if (error instanceof GatewayOperationError) throw error;
    if (error instanceof AccessError)
      throw new WebsiteInquiryError('forbidden');
    throw new WebsiteInquiryError('failed');
  }
}
