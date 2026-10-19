import { beforeEach, describe, expect, test } from 'vitest';
import { loadInquiryConfig } from '../../packages/core/src/inquiry-config.js';

const tenantId = '00000000-0000-4000-8000-000000000231';
const epoch = 1_700_000_000;

function hex(bytes: number, fill = 7) {
  return Buffer.alloc(bytes, fill).toString('hex');
}

const baseStorage = JSON.stringify([{ id: 'storage-a', secret: hex(32, 11) }]);
const baseSync = JSON.stringify([
  {
    id: 'sync-a',
    secret: hex(32, 22),
    tenantId,
    direction: 'core-to-gateway',
    notBefore: epoch - 60,
    expiresAt: epoch + 3600,
  },
  {
    id: 'sync-b',
    secret: hex(32, 33),
    tenantId,
    direction: 'gateway-to-core',
    notBefore: epoch - 60,
    expiresAt: epoch + 3600,
  },
]);

const baseEnv = {
  AK_INQUIRY_TENANT_ID: tenantId,
  AK_INQUIRY_ALLOWED_ORIGINS: 'https://fictional.example.invalid',
  AK_INQUIRY_RESPONSE_KEY_ID: 'sync-b',
  AK_INQUIRY_STORAGE_KEYS_FILE: '/run/secrets/gateway_storage_keys',
  AK_INQUIRY_SYNC_KEYS_FILE: '/run/secrets/gateway_sync_keys',
  AK_INQUIRY_MAX_STORED: '50',
  AK_INQUIRY_RETENTION_HOURS: '12',
};

describe('loadInquiryConfig', () => {
  let files: Record<string, string>;
  beforeEach(() => {
    files = {
      '/run/secrets/gateway_storage_keys': baseStorage,
      '/run/secrets/gateway_sync_keys': baseSync,
    };
  });
  test('builds gateway configuration from environment and key files', () => {
    const config = loadInquiryConfig(baseEnv, (path) => {
      const value = files[path];
      if (!value) throw new Error(`Missing fixture for ${path}`);
      return value;
    });
    expect(config.tenantId).toBe(tenantId);
    expect(config.allowedOrigins).toEqual([
      'https://fictional.example.invalid',
    ]);
    expect(config.responseKeyId).toBe('sync-b');
    expect(config.storage).toMatchObject({
      tenantId,
      retentionHours: 12,
      maxStored: 50,
      activeKeyId: 'storage-a',
    });
    expect(config.storage.keys).toHaveLength(1);
    expect(config.storage.keys[0]?.id).toBe('storage-a');
    expect(config.syncKeys).toHaveLength(2);
    expect(config.syncKeys.map((k) => k.id)).toEqual(['sync-a', 'sync-b']);
    expect(config.syncKeys[1]?.direction).toBe('gateway-to-core');
  });
  test('rejects missing tenant id', () => {
    expect(() =>
      loadInquiryConfig({ ...baseEnv, AK_INQUIRY_TENANT_ID: '' }, () => ''),
    ).toThrow(/AK_INQUIRY_TENANT_ID/);
  });
  test('rejects malformed tenant id', () => {
    expect(() =>
      loadInquiryConfig(
        { ...baseEnv, AK_INQUIRY_TENANT_ID: 'not-a-uuid' },
        () => '',
      ),
    ).toThrow(/AK_INQUIRY_TENANT_ID/);
  });
  test('rejects empty origin list', () => {
    expect(() =>
      loadInquiryConfig(
        { ...baseEnv, AK_INQUIRY_ALLOWED_ORIGINS: '   ,  ' },
        () => '',
      ),
    ).toThrow(/AK_INQUIRY_ALLOWED_ORIGINS/);
  });
  test('rejects unknown response key id', () => {
    expect(() =>
      loadInquiryConfig(
        { ...baseEnv, AK_INQUIRY_RESPONSE_KEY_ID: 'not-a-key' },
        (path) => files[path] ?? '',
      ),
    ).toThrow(/AK_INQUIRY_RESPONSE_KEY_ID/);
  });
  test('rejects invalid storage key secret length', () => {
    files['/run/secrets/gateway_storage_keys'] = JSON.stringify([
      { id: 'storage-a', secret: hex(16, 11) },
    ]);
    expect(() =>
      loadInquiryConfig(baseEnv, (path) => files[path] ?? ''),
    ).toThrow(/storage key length/);
  });
  test('rejects invalid sync key id', () => {
    files['/run/secrets/gateway_sync_keys'] = JSON.stringify([
      { ...JSON.parse(baseSync)[0], id: '' },
    ]);
    expect(() =>
      loadInquiryConfig(baseEnv, (path) => files[path] ?? ''),
    ).toThrow(/sync key id/);
  });
  test('rejects invalid sync key secret length', () => {
    files['/run/secrets/gateway_sync_keys'] = JSON.stringify([
      { ...JSON.parse(baseSync)[0], secret: hex(16, 22) },
    ]);
    expect(() =>
      loadInquiryConfig(baseEnv, (path) => files[path] ?? ''),
    ).toThrow(/sync key length/);
  });
  test('rejects invalid JSON', () => {
    files['/run/secrets/gateway_storage_keys'] = '{not json';
    expect(() =>
      loadInquiryConfig(baseEnv, (path) => files[path] ?? ''),
    ).toThrow(/Cannot parse JSON/);
  });
});
