import {
  inquirySyncOptions,
  postInquiryGatewayPacket,
  type InquirySyncOptions,
} from './website-inquiry-http.js';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { database } from './database.js';
import { AccessError, requireAdministrator } from './access.js';
import { signGatewayMessage } from './gateway-message.js';
import { GatewayOperationError } from './gateway-operations.js';
import { WebsiteInquiryError } from './website-inquiries.js';
import { receiveWebsiteInquiryBatch } from './website-inquiry-sync.js';

export async function pullWebsiteInquiries(
  pool: Pool,
  tenantId: string,
  actorId: string,
  options: InquirySyncOptions,
) {
  const requestId = randomUUID(),
    config = inquirySyncOptions(options);
  let packet: ReturnType<typeof signGatewayMessage>;
  try {
    packet = signGatewayMessage(
      {
        version: 1,
        tenantId,
        messageId: requestId,
        operationId: randomUUID(),
        issuedAt: Math.floor(config.now().getTime() / 1000),
        kind: 'inquiries.pull',
        payload: { limit: 100 },
      },
      config.requestKey,
    );
  } catch {
    throw new WebsiteInquiryError('invalid');
  }
  try {
    await database(pool).transaction(
      async (tx) => requireAdministrator(tx, tenantId, actorId),
      { accessMode: 'read only' },
    );
    const body = await postInquiryGatewayPacket(config.origin, 'pull', packet);
    return await receiveWebsiteInquiryBatch(pool, tenantId, actorId, body, {
      requestId,
      keys: config.keys,
      at: config.now(),
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
