import type { GatewayKey } from './gateway-message.js';
import type { InquiryInboxConfig } from './inquiry-inbox.js';

const keyId = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;

function readJson<T>(path: string, readSecret: (p: string) => string): T {
  const raw = readSecret(path);
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(`Cannot parse JSON from ${path}`);
  }
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
  const required = (key: string) => {
    const value = env[key];
    if (!value?.trim()) throw new Error(`Missing configuration: ${key}`);
    return value;
  };
  const tenantId = required('AK_INQUIRY_TENANT_ID');
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
      tenantId,
    )
  )
    throw new Error('Invalid AK_INQUIRY_TENANT_ID');
  const allowedOrigins = required('AK_INQUIRY_ALLOWED_ORIGINS')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (!allowedOrigins.length)
    throw new Error('Invalid AK_INQUIRY_ALLOWED_ORIGINS');
  const maxStored = Number(env.AK_INQUIRY_MAX_STORED ?? '100');
  const retentionHours = Number(env.AK_INQUIRY_RETENTION_HOURS ?? '24');
  const responseKeyId = required('AK_INQUIRY_RESPONSE_KEY_ID');
  const storagePath = required('AK_INQUIRY_STORAGE_KEYS_FILE');
  const syncPath = required('AK_INQUIRY_SYNC_KEYS_FILE');
  const storageKeys = readJson<Array<{ id: string; secret: string }>>(
    storagePath,
    readSecret,
  ).map((k) => {
    if (!keyId.test(k.id)) throw new Error(`Invalid storage key id: ${k.id}`);
    const secret = Buffer.from(k.secret, 'hex');
    if (secret.byteLength !== 32)
      throw new Error(`Invalid storage key length for ${k.id}`);
    return { id: k.id, secret };
  });
  const syncKeys = readJson<
    Array<{
      id: string;
      secret: string;
      tenantId: string;
      direction: 'core-to-gateway' | 'gateway-to-core';
      notBefore: number;
      expiresAt: number;
    }>
  >(syncPath, readSecret).map<GatewayKey>((k) => {
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
