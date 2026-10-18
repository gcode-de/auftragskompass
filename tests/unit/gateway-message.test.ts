import { createHmac } from 'node:crypto';
import { expect, test } from 'vitest';
import {
  signGatewayMessage,
  verifyGatewayMessage,
  type GatewayKey,
  type GatewayMessage,
} from '../../packages/core/src/gateway-message.js';

const now = 1_792_329_000;
const tenantId = '00000000-0000-4000-8000-000000000201';
const key: GatewayKey = {
  id: 'fictional-current',
  tenantId,
  direction: 'core-to-gateway',
  secret: Buffer.alloc(32, 33),
  notBefore: now - 1000,
  expiresAt: now + 1000,
};
const message = (): GatewayMessage => ({
  version: 1,
  tenantId,
  messageId: '00000000-0000-4000-8000-000000000202',
  operationId: '00000000-0000-4000-8000-000000000203',
  issuedAt: now,
  kind: 'inquiries.pull',
  payload: { limit: 20 },
});
const context = () => ({
  tenantId,
  direction: key.direction,
  kind: 'inquiries.pull' as const,
  keys: [key],
  now,
});

test('round trip binds the exact bytes and returns only the verified message', () => {
  const input = message();
  const packet = signGatewayMessage(input, key);
  expect(packet.body).toBe(JSON.stringify(input));
  expect(packet.signature).toBe(
    createHmac('sha256', key.secret)
      .update(
        'AK-GATEWAY-V1\ncore-to-gateway\nfictional-current\n' + packet.body,
      )
      .digest('base64url'),
  );
  expect(verifyGatewayMessage(packet, context())).toEqual(input);
  expect(input).toEqual(message());
});

test('gateway responses require their own direction and expected purpose', () => {
  const response = {
    ...message(),
    kind: 'inquiries.batch' as const,
    payload: { inquiries: [] },
  };
  const responseKey = { ...key, direction: 'gateway-to-core' as const };
  const packet = signGatewayMessage(response, responseKey);
  expect(
    verifyGatewayMessage(packet, {
      ...context(),
      direction: responseKey.direction,
      kind: response.kind,
      keys: [responseKey],
    }),
  ).toEqual(response);
  expect(verifyGatewayMessage(packet, context())).toBeNull();
  expect(() => signGatewayMessage(response, key)).toThrow(
    'Invalid gateway message',
  );
  const ack = { ...message(), kind: 'inquiries.ack' as const };
  expect(
    verifyGatewayMessage(signGatewayMessage(ack, key), {
      ...context(),
      kind: ack.kind,
    }),
  ).toEqual(ack);
});

test('scope, key ID, signature and any body edit cannot be substituted', () => {
  const packet = signGatewayMessage(message(), key);
  for (const changed of [
    { ...packet, body: packet.body.replace('"limit":20', '"limit":21') },
    { ...packet, body: ' ' + packet.body },
    { ...packet, signature: 'A'.repeat(43) },
    { ...packet, signature: 'short' },
    { ...packet, keyId: 'unknown' },
    { ...packet, extra: 'fictional-private-content' },
    null,
    {},
    { ...packet, body: 'x'.repeat(65537) },
    { ...packet, body: 'ä'.repeat(32769) },
  ])
    expect(verifyGatewayMessage(changed, context())).toBeNull();
  expect(
    verifyGatewayMessage(packet, {
      ...context(),
      tenantId: '00000000-0000-4000-8000-000000000299',
    }),
  ).toBeNull();
  expect(
    verifyGatewayMessage(packet, { ...context(), kind: 'inquiries.ack' }),
  ).toBeNull();
  expect(
    verifyGatewayMessage(packet, {
      ...context(),
      keys: [{ ...key, secret: Buffer.alloc(32, 34) }],
    }),
  ).toBeNull();
  const renamed = { ...key, id: 'fictional-renamed' };
  expect(
    verifyGatewayMessage(
      { ...packet, keyId: renamed.id },
      { ...context(), keys: [renamed] },
    ),
  ).toBeNull();
});

test.each([
  [-300, true],
  [-301, false],
  [30, true],
  [31, false],
])('bounded clock window: offset %s accepted=%s', (offset, accepted) => {
  const packet = signGatewayMessage(
    { ...message(), issuedAt: now + offset },
    key,
  );
  expect(verifyGatewayMessage(packet, context()) !== null).toBe(accepted);
});

test('overlapping rotation permits either configured key, never revoked or ambiguous ones', () => {
  const next = { ...key, id: 'fictional-next', secret: Buffer.alloc(32, 35) };
  const packet = signGatewayMessage(message(), next);
  expect(
    verifyGatewayMessage(packet, { ...context(), keys: [key, next] }),
  ).toEqual(message());
  expect(
    verifyGatewayMessage(signGatewayMessage(message(), key), {
      ...context(),
      keys: [key, next],
    }),
  ).toEqual(message());
  expect(verifyGatewayMessage(packet, context())).toBeNull();
  expect(
    verifyGatewayMessage(packet, { ...context(), keys: [next, next] }),
  ).toBeNull();
  expect(
    verifyGatewayMessage(packet, {
      ...context(),
      keys: [{ ...next, expiresAt: now }],
    }),
  ).toBeNull();
  expect(
    verifyGatewayMessage(packet, {
      ...context(),
      keys: [{ ...next, notBefore: now + 1 }],
    }),
  ).toBeNull();
});

// Independently signed malformed envelopes model a faulty or compromised known sender.
function rawPacket(body: string) {
  return {
    keyId: key.id,
    body,
    signature: createHmac('sha256', key.secret)
      .update('AK-GATEWAY-V1\ncore-to-gateway\n' + key.id + '\n' + body)
      .digest('base64url'),
  };
}
test.each([
  null,
  { ...message(), version: 2 },
  { ...message(), issuedAt: '1792329000' },
  { ...message(), issuedAt: now + 0.5 },
  { ...message(), kind: 'availability.public' },
  { ...message(), payload: [] },
  { ...message(), extra: 'fictional-private-content' },
  { ...message(), tenantId: '00000000-0000-4000-8000-000000000299' },
  { ...message(), messageId: 'not-an-id' },
  { ...message(), operationId: 'not-an-id' },
])('rejects invalid envelopes even with a valid MAC (%#)', (input) => {
  expect(
    verifyGatewayMessage(rawPacket(JSON.stringify(input)), context()),
  ).toBeNull();
  expect(() => signGatewayMessage(input as GatewayMessage, key)).toThrow(
    'Invalid gateway message',
  );
});

test('invalid JSON, key/time configuration and oversized output fail closed', () => {
  expect(verifyGatewayMessage(rawPacket('{'), context())).toBeNull();
  for (const now of [NaN, Infinity, 1.2])
    expect(
      verifyGatewayMessage(signGatewayMessage(message(), key), {
        ...context(),
        now,
      }),
    ).toBeNull();
  for (const change of [
    { secret: Buffer.alloc(31) },
    { id: 'fictional\nkey' },
    { notBefore: now + 1 },
    { expiresAt: now },
    { notBefore: 0.5 },
    { expiresAt: Infinity },
  ]) {
    const invalidKey = { ...key, ...change };
    expect(() => signGatewayMessage(message(), invalidKey)).toThrow(
      'Invalid gateway message',
    );
    expect(
      verifyGatewayMessage(signGatewayMessage(message(), key), {
        ...context(),
        keys: [invalidKey],
      }),
    ).toBeNull();
  }
  expect(() =>
    signGatewayMessage(
      { ...message(), payload: { text: 'ä'.repeat(40000) } },
      key,
    ),
  ).toThrow('Invalid gateway message');
});

test('noncanonical MAC text and a valid signature for the wrong direction fail closed', () => {
  const packet = signGatewayMessage(message(), key);
  const alphabet =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const last = alphabet.indexOf(packet.signature.at(-1)!);
  const alternate = packet.signature.slice(0, -1) + alphabet[last ^ 1];
  expect(Buffer.from(alternate, 'base64url')).toEqual(
    Buffer.from(packet.signature, 'base64url'),
  );
  expect(
    verifyGatewayMessage({ ...packet, signature: alternate }, context()),
  ).toBeNull();
  const wrong = { ...message(), kind: 'inquiries.batch' as const };
  expect(
    verifyGatewayMessage(rawPacket(JSON.stringify(wrong)), {
      ...context(),
      kind: wrong.kind,
    }),
  ).toBeNull();
  expect(
    verifyGatewayMessage(
      rawPacket(JSON.stringify({ ...message(), issuedAt: now - 10 })),
      { ...context(), keys: [{ ...key, notBefore: now - 5 }] },
    ),
  ).toBeNull();
});

test('serialization errors cannot expose private property names', () => {
  const cyclic: Record<string, unknown> = {};
  cyclic['fictional.private@example.invalid'] = cyclic;
  for (const payload of [cyclic, { value: 1n }, new Date()]) {
    expect(() =>
      signGatewayMessage(
        { ...message(), payload: payload as Record<string, unknown> },
        key,
      ),
    ).toThrow(/^Invalid gateway message$/);
  }
  for (const id of [undefined, 123]) {
    expect(() =>
      signGatewayMessage(message(), { ...key, id } as unknown as GatewayKey),
    ).toThrow(/^Invalid gateway message$/);
  }
});

test('acknowledgment receipts are separately authenticated in the return direction', () => {
  const receipt = {
    ...message(),
    kind: 'inquiries.receipt',
    payload: { requestId: message().messageId, acknowledgedCount: 1 },
  } as unknown as GatewayMessage;
  const responseKey = { ...key, direction: 'gateway-to-core' as const };
  const signed = signGatewayMessage(receipt, responseKey);
  expect(
    verifyGatewayMessage(signed, {
      ...context(),
      direction: responseKey.direction,
      kind: receipt.kind,
      keys: [responseKey],
    }),
  ).toEqual(receipt);
  expect(() => signGatewayMessage(receipt, key)).toThrow(
    'Invalid gateway message',
  );
});
