import type { GatewayKey, signGatewayMessage } from './gateway-message.js';
import { WebsiteInquiryError } from './website-inquiries.js';
export type InquirySyncOptions = {
  origin: string;
  requestKey: GatewayKey;
  responseKeys: readonly GatewayKey[];
  now?: () => Date;
};
export function inquirySyncOptions(options: InquirySyncOptions) {
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
    return {
      origin: origin.origin,
      requestKey: {
        ...options.requestKey,
        secret: Buffer.from(options.requestKey.secret),
      },
      keys: options.responseKeys.map((key) => ({
        ...key,
        secret: Buffer.from(key.secret),
      })),
      now: options.now ?? (() => new Date()),
    };
  } catch {
    throw new WebsiteInquiryError('invalid');
  }
}
export async function postInquiryGatewayPacket(
  origin: string,
  kind: 'pull' | 'ack',
  packet: ReturnType<typeof signGatewayMessage>,
) {
  const response = await fetch(origin + '/sync/v1/inquiries/' + kind, {
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
  return JSON.parse(
    new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)),
  );
}
