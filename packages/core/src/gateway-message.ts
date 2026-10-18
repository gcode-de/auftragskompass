import { createHmac, timingSafeEqual } from 'node:crypto';
import AjvCompiler from '@fastify/ajv-compiler';

export type GatewayDirection = 'core-to-gateway' | 'gateway-to-core';
export type GatewayKind =
  'inquiries.pull' | 'inquiries.batch' | 'inquiries.ack' | 'inquiries.receipt';
export type GatewayKey = {
  id: string;
  tenantId: string;
  direction: GatewayDirection;
  secret: Uint8Array;
  notBefore: number;
  expiresAt: number;
};
export type GatewayMessage = {
  version: 1;
  tenantId: string;
  messageId: string;
  operationId: string;
  issuedAt: number;
  kind: GatewayKind;
  payload: Record<string, unknown>;
};
type Packet = { keyId: string; body: string; signature: string };
type Context = {
  tenantId: string;
  direction: GatewayDirection;
  kind: GatewayKind;
  keys: readonly GatewayKey[];
  now: number;
};
export const gatewayMessageLimit = 65_536;
const keyIdPattern = '^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$';
const uuidPattern =
  '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
const uuid = { type: 'string', pattern: uuidPattern };
const compile = AjvCompiler()(
  {},
  {
    customOptions: {
      coerceTypes: false,
      removeAdditional: false,
      useDefaults: false,
    },
  },
);
const validPacket = compile({
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['keyId', 'body', 'signature'],
    properties: {
      keyId: { type: 'string', pattern: keyIdPattern },
      body: { type: 'string', maxLength: gatewayMessageLimit },
      signature: { type: 'string', pattern: '^[A-Za-z0-9_-]{43}$' },
    },
  },
});
const validMessage = compile({
  schema: {
    type: 'object',
    additionalProperties: false,
    required: [
      'version',
      'tenantId',
      'messageId',
      'operationId',
      'issuedAt',
      'kind',
      'payload',
    ],
    properties: {
      version: { type: 'integer', const: 1 },
      tenantId: uuid,
      messageId: uuid,
      operationId: uuid,
      issuedAt: {
        type: 'integer',
        minimum: 0,
        maximum: Number.MAX_SAFE_INTEGER,
      },
      kind: {
        type: 'string',
        enum: [
          'inquiries.pull',
          'inquiries.batch',
          'inquiries.ack',
          'inquiries.receipt',
        ],
      },
      payload: { type: 'object' },
    },
  },
});

function keyActive(key: GatewayKey, time: number) {
  return (
    Number.isSafeInteger(time) &&
    typeof key.id === 'string' &&
    new RegExp(keyIdPattern).test(key.id) &&
    typeof key.tenantId === 'string' &&
    new RegExp(uuidPattern).test(key.tenantId) &&
    ['core-to-gateway', 'gateway-to-core'].includes(key.direction) &&
    key.secret instanceof Uint8Array &&
    key.secret.byteLength === 32 &&
    Number.isSafeInteger(key.notBefore) &&
    Number.isSafeInteger(key.expiresAt) &&
    time >= key.notBefore &&
    time < key.expiresAt
  );
}
function permitted(direction: GatewayDirection, kind: GatewayKind) {
  return direction === 'gateway-to-core'
    ? kind === 'inquiries.batch' || kind === 'inquiries.receipt'
    : kind === 'inquiries.pull' || kind === 'inquiries.ack';
}
function mac(body: string, key: GatewayKey) {
  return createHmac('sha256', key.secret)
    .update(`AK-GATEWAY-V1\n${key.direction}\n${key.id}\n${body}`)
    .digest();
}

export function signGatewayMessage(
  message: GatewayMessage,
  key: GatewayKey,
): Packet {
  if (
    !validMessage(message) ||
    message.tenantId !== key.tenantId ||
    !keyActive(key, message.issuedAt) ||
    !permitted(key.direction, message.kind)
  )
    throw new Error('Invalid gateway message');
  let body: string;
  try {
    body = JSON.stringify(message);
  } catch {
    throw new Error('Invalid gateway message');
  }
  if (
    Buffer.byteLength(body, 'utf8') > gatewayMessageLimit ||
    !validMessage(JSON.parse(body))
  )
    throw new Error('Invalid gateway message');
  return {
    keyId: key.id,
    body,
    signature: mac(body, key).toString('base64url'),
  };
}

// Authentication only: durable nonce/operation checks must precede any side effect.
export function verifyGatewayMessage(
  input: unknown,
  context: Context,
): GatewayMessage | null {
  if (!validPacket(input)) return null;
  const packet = input as Packet;
  if (Buffer.byteLength(packet.body, 'utf8') > gatewayMessageLimit) return null;
  const keys = context.keys.filter(
    (key) =>
      key.id === packet.keyId &&
      key.tenantId === context.tenantId &&
      key.direction === context.direction,
  );
  if (keys.length !== 1 || !keyActive(keys[0]!, context.now)) return null;
  const key = keys[0]!;
  const signature = Buffer.from(packet.signature, 'base64url');
  if (
    signature.toString('base64url') !== packet.signature ||
    !timingSafeEqual(signature, mac(packet.body, key))
  )
    return null;
  let message: GatewayMessage;
  try {
    const parsed: unknown = JSON.parse(packet.body);
    if (!validMessage(parsed)) return null;
    message = parsed as GatewayMessage;
  } catch {
    return null;
  }
  if (
    message.tenantId !== context.tenantId ||
    message.kind !== context.kind ||
    !permitted(context.direction, message.kind) ||
    !keyActive(key, message.issuedAt) ||
    context.now - message.issuedAt > 300 ||
    message.issuedAt - context.now > 30
  )
    return null;
  return message;
}
