import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { database } from './database.js';
import { AccessError, requireAdministrator } from './access.js';
import { signGatewayMessage, type GatewayKey } from './gateway-message.js';
import { GatewayOperationError } from './gateway-operations.js';
import { WebsiteInquiryError } from './website-inquiries.js';
import { receiveWebsiteInquiryBatch } from './website-inquiry-sync.js';

export async function pullWebsiteInquiries(
  pool: Pool,
  tenantId: string,
  actorId: string,
  options: {
    origin: string;
    requestKey: GatewayKey;
    responseKeys: readonly GatewayKey[];
    now?: () => Date;
  },
) {
  const requestId = randomUUID();
  let endpoint: string,
    packet: ReturnType<typeof signGatewayMessage>,
    keys: GatewayKey[],
    now: () => Date;
  try {
    const origin = new URL(options.origin);
    if (
      origin.protocol !== 'https:' ||
      origin.username ||
      origin.password ||
      origin.pathname !== '/' ||
      origin.search ||
      origin.hash ||
      !options.responseKeys.length
    )
      throw new Error();
    endpoint = origin.origin + '/sync/v1/inquiries/pull';
    now = options.now ?? (() => new Date());
    keys = options.responseKeys.map((key) => ({
      ...key,
      secret: Buffer.from(key.secret),
    }));
    packet = signGatewayMessage(
      {
        version: 1,
        tenantId,
        messageId: requestId,
        operationId: randomUUID(),
        issuedAt: Math.floor(now().getTime() / 1000),
        kind: 'inquiries.pull',
        payload: { limit: 100 },
      },
      { ...options.requestKey, secret: Buffer.from(options.requestKey.secret) },
    );
  } catch {
    throw new WebsiteInquiryError('invalid');
  }
  try {
    await database(pool).transaction(
      async (tx) => requireAdministrator(tx, tenantId, actorId),
      { accessMode: 'read only' },
    );
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(packet),
      credentials: 'omit',
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    });
    if (
      response.status !== 200 ||
      response.headers
        .get('content-type')
        ?.split(';')[0]!
        .trim()
        .toLowerCase() !== 'application/json' ||
      !response.body
    ) {
      await response.body?.cancel();
      throw new Error();
    }
    const reader = response.body.getReader(),
      chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      if (Number(response.headers.get('content-length')) > 132096)
        throw new Error();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > 132096) throw new Error();
        chunks.push(value);
      }
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
    const body = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)),
    );
    return await receiveWebsiteInquiryBatch(pool, tenantId, actorId, body, {
      requestId,
      keys,
      at: now(),
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
