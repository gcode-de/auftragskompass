import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import {
  signGatewayMessage,
  verifyGatewayMessage,
  type GatewayMessage,
} from './gateway-message.js';
import { GatewayOperationError } from './gateway-operations.js';
import { WebsiteInquiryError } from './website-inquiries.js';
import {
  prepareWebsiteInquiryAcknowledgement,
  receiveWebsiteInquiryAcknowledgement,
} from './website-inquiry-ack.js';
import {
  inquirySyncOptions,
  postInquiryGatewayPacket,
  type InquirySyncOptions,
} from './website-inquiry-http.js';

export async function acknowledgeWebsiteInquiries(
  pool: Pool,
  tenantId: string,
  actorId: string,
  options: InquirySyncOptions,
) {
  const config = inquirySyncOptions(options);
  let template: GatewayMessage;
  try {
    template = {
      version: 1,
      tenantId,
      messageId: randomUUID(),
      operationId: randomUUID(),
      issuedAt: Math.floor(config.now().getTime() / 1000),
      kind: 'inquiries.ack',
      payload: { inquiryIds: [] },
    };
    signGatewayMessage(template, config.requestKey);
  } catch {
    throw new WebsiteInquiryError('invalid');
  }
  try {
    // Preparation owns its transaction: no HTTP side effect precedes its commit.
    const attempt = await prepareWebsiteInquiryAcknowledgement(
      pool,
      tenantId,
      actorId,
      config.now(),
    );
    if (!attempt) return { status: 'idle' as const, count: 0 };
    const packet = signGatewayMessage(
      {
        ...template,
        messageId: attempt.messageId,
        operationId: attempt.operationId,
        issuedAt: Math.floor(config.now().getTime() / 1000),
        payload: { inquiryIds: attempt.inquiryIds },
      },
      config.requestKey,
    );
    const response = await postInquiryGatewayPacket(
        config.origin,
        'ack',
        packet,
      ),
      at = config.now();
    const receipt = verifyGatewayMessage(response, {
      tenantId,
      direction: 'gateway-to-core',
      kind: 'inquiries.receipt',
      keys: config.keys,
      now: Math.floor(at.getTime() / 1000),
    });
    if (!receipt) throw new GatewayOperationError('unauthorized');
    if (receipt.payload.requestId !== attempt.messageId)
      throw new WebsiteInquiryError('invalid');
    return await receiveWebsiteInquiryAcknowledgement(
      pool,
      tenantId,
      actorId,
      response,
      { keys: config.keys, at },
    );
  } catch (error) {
    if (
      error instanceof WebsiteInquiryError ||
      error instanceof GatewayOperationError
    )
      throw error;
    throw new WebsiteInquiryError('failed');
  }
}
