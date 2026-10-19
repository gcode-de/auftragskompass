import type { GatewayKey } from './gateway-message.js';
import type { InquiryInboxConfig } from './inquiry-inbox.js';

const keyId = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function readJson<T>(path: string, readSecret: (p: string) => string): T {
  const raw = readSecret(path);
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(`Cannot parse JSON from ${path}`);
  }
}

type SyncKeyJson = {
  id: string;
  secret: string;
  tenantId: string;
  direction: 'core-to-gateway' | 'gateway-to-core';
  notBefore: number;
  expiresAt: number;
};

function parseSyncKeys(
  path: string,
  readSecret: (p: string) => string,
): GatewayKey[] {
  return readJson<SyncKeyJson[]>(path, readSecret).map<GatewayKey>((k) => {
    if (!keyId.test(k.id)) throw new Error(`Invalid sync key id: ${k.id}`);
    const secret = Buffer.from(k.secret, 'hex');
    if (secret.byteLength !== 32)
      throw new Error(`Invalid sync key length for ${k.id}`);
    return {
      id: k.id,
      secret,
      tenantId: k.tenantId,
      direction: k.direction,
      notBefore: k.notBefore,
      expiresAt: k.expiresAt,
    };
  });
}

function parseStorageKeys(
  path: string,
  readSecret: (p: string) => string,
): Array<{ id: string; secret: Buffer }> {
  return readJson<Array<{ id: string; secret: string }>>(path, readSecret).map(
    (k) => {
      if (!keyId.test(k.id)) throw new Error(`Invalid storage key id: ${k.id}`);
      const secret = Buffer.from(k.secret, 'hex');
      if (secret.byteLength !== 32)
        throw new Error(`Invalid storage key length for ${k.id}`);
      return { id: k.id, secret };
    },
  );
}

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];
  if (!value?.trim()) throw new Error(`Missing configuration: ${key}`);
  return value;
}

export type InquiryConfig = {
  storage: InquiryInboxConfig;
  syncKeys: readonly GatewayKey[];
  responseKeyId: string;
  allowedOrigins: readonly string[];
  tenantId: string;
};

export function loadInquiryConfig(
  env: NodeJS.ProcessEnv,
  readSecret: (path: string) => string,
): InquiryConfig {
  const tenantId = required(env, 'AK_INQUIRY_TENANT_ID');
  if (!uuid.test(tenantId)) throw new Error('Invalid AK_INQUIRY_TENANT_ID');
  const allowedOrigins = required(env, 'AK_INQUIRY_ALLOWED_ORIGINS')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (!allowedOrigins.length)
    throw new Error('Invalid AK_INQUIRY_ALLOWED_ORIGINS');
  const maxStored = Number(env.AK_INQUIRY_MAX_STORED ?? '100');
  const retentionHours = Number(env.AK_INQUIRY_RETENTION_HOURS ?? '24');
  const responseKeyId = required(env, 'AK_INQUIRY_RESPONSE_KEY_ID');
  const storageKeys = parseStorageKeys(
    required(env, 'AK_INQUIRY_STORAGE_KEYS_FILE'),
    readSecret,
  );
  const syncKeys = parseSyncKeys(
    required(env, 'AK_INQUIRY_SYNC_KEYS_FILE'),
    readSecret,
  );
  if (
    !storageKeys.some((k) => k.id === responseKeyId) &&
    !syncKeys.some((k) => k.id === responseKeyId)
  )
    throw new Error('AK_INQUIRY_RESPONSE_KEY_ID must match a configured key');
  const storage: InquiryInboxConfig = {
    tenantId,
    keys: storageKeys,
    activeKeyId: storageKeys[0]!.id,
    retentionHours,
    maxStored,
  };
  return { storage, syncKeys, responseKeyId, allowedOrigins, tenantId };
}

export type InquirySyncConfig = {
  tenantId: string;
  actorId: string;
  origin: string;
  requestKey: GatewayKey;
  responseKeys: readonly GatewayKey[];
  intervalMs: number;
};

// The worker reads the gateway over its public HTTPS origin, so the transport
// keeps rejecting plain HTTP even for a loopback deployment.
export function loadInquirySyncConfig(
  env: NodeJS.ProcessEnv,
  readSecret: (path: string) => string,
): InquirySyncConfig {
  const tenantId = required(env, 'AK_INQUIRY_TENANT_ID');
  if (!uuid.test(tenantId)) throw new Error('Invalid AK_INQUIRY_TENANT_ID');
  const actorId = required(env, 'AK_INQUIRY_OPERATOR_ID');
  if (!uuid.test(actorId)) throw new Error('Invalid AK_INQUIRY_OPERATOR_ID');
  const rawOrigin = required(env, 'AK_GATEWAY_ORIGIN');
  let origin: string;
  try {
    const url = new URL(rawOrigin);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    )
      throw new Error();
    origin = url.origin;
  } catch {
    throw new Error('Invalid AK_GATEWAY_ORIGIN');
  }
  const requestKeyId = required(env, 'AK_GATEWAY_REQUEST_KEY_ID');
  const syncKeys = parseSyncKeys(
    required(env, 'AK_INQUIRY_SYNC_KEYS_FILE'),
    readSecret,
  );
  if (syncKeys.some((k) => k.tenantId !== tenantId))
    throw new Error('Sync key tenant mismatch');
  const requestKey = syncKeys.find(
    (k) => k.id === requestKeyId && k.direction === 'core-to-gateway',
  );
  if (!requestKey)
    throw new Error('AK_GATEWAY_REQUEST_KEY_ID must be a core-to-gateway key');
  const intervalMs = Number(env.AK_INQUIRY_SYNC_INTERVAL_MS ?? '30000');
  if (!Number.isInteger(intervalMs) || intervalMs < 5000 || intervalMs > 600000)
    throw new Error('Invalid AK_INQUIRY_SYNC_INTERVAL_MS');
  return {
    tenantId,
    actorId,
    origin,
    requestKey,
    responseKeys: syncKeys,
    intervalMs,
  };
}
