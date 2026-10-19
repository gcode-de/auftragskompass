import { beforeEach, describe, expect, test } from 'vitest';
import {
  loadInquiryConfig,
  loadInquirySyncConfig,
} from '../../packages/core/src/inquiry-config.js';

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

describe('loadInquirySyncConfig', () => {
  const operatorId = '00000000-0000-4000-8000-000000000432';
  const syncEnv = {
    AK_INQUIRY_TENANT_ID: tenantId,
    AK_INQUIRY_OPERATOR_ID: operatorId,
    AK_GATEWAY_ORIGIN: 'https://auftragskompass.example.invalid',
    AK_GATEWAY_REQUEST_KEY_ID: 'sync-a',
    AK_INQUIRY_SYNC_KEYS_FILE: '/run/secrets/gateway_sync_keys',
    AK_INQUIRY_SYNC_INTERVAL_MS: '45000',
  };
  const read = (files: Record<string, string>) => (path: string) => {
    const value = files[path];
    if (!value) throw new Error(`Missing fixture for ${path}`);
    return value;
  };
  let files: Record<string, string>;
  beforeEach(() => {
    files = { '/run/secrets/gateway_sync_keys': baseSync };
  });
  test('builds the worker sync configuration from the gateway origin', () => {
    const config = loadInquirySyncConfig(syncEnv, read(files));
    expect(config.tenantId).toBe(tenantId);
    expect(config.actorId).toBe(operatorId);
    expect(config.origin).toBe('https://auftragskompass.example.invalid');
    expect(config.requestKey.id).toBe('sync-a');
    expect(config.requestKey.direction).toBe('core-to-gateway');
    expect(config.responseKeys).toHaveLength(2);
    expect(config.intervalMs).toBe(45000);
  });
  test('normalises the origin to its bare form', () => {
    const config = loadInquirySyncConfig(
      {
        ...syncEnv,
        AK_GATEWAY_ORIGIN: 'https://Gateway.Example.Invalid:8443/',
      },
      read(files),
    );
    expect(config.origin).toBe('https://gateway.example.invalid:8443');
  });
  test('defaults the interval to 30 seconds', () => {
    const withoutInterval: Record<string, string> = { ...syncEnv };
    delete withoutInterval.AK_INQUIRY_SYNC_INTERVAL_MS;
    expect(loadInquirySyncConfig(withoutInterval, read(files)).intervalMs).toBe(
      30000,
    );
  });
  test('rejects a plain HTTP origin', () => {
    expect(() =>
      loadInquirySyncConfig(
        { ...syncEnv, AK_GATEWAY_ORIGIN: 'http://127.0.0.1:3002' },
        read(files),
      ),
    ).toThrow(/AK_GATEWAY_ORIGIN/);
  });
  test('rejects an origin carrying a path or credentials', () => {
    for (const origin of [
      'https://fictional.example.invalid/sync/v1',
      'https://user:pass@fictional.example.invalid',
    ])
      expect(() =>
        loadInquirySyncConfig(
          { ...syncEnv, AK_GATEWAY_ORIGIN: origin },
          read(files),
        ),
      ).toThrow(/AK_GATEWAY_ORIGIN/);
  });
  test('rejects a missing or malformed operator id', () => {
    expect(() =>
      loadInquirySyncConfig(
        { ...syncEnv, AK_INQUIRY_OPERATOR_ID: '' },
        read(files),
      ),
    ).toThrow(/AK_INQUIRY_OPERATOR_ID/);
    expect(() =>
      loadInquirySyncConfig(
        { ...syncEnv, AK_INQUIRY_OPERATOR_ID: 'not-a-uuid' },
        read(files),
      ),
    ).toThrow(/AK_INQUIRY_OPERATOR_ID/);
  });
  test('rejects a request key that is not a core-to-gateway key', () => {
    expect(() =>
      loadInquirySyncConfig(
        { ...syncEnv, AK_GATEWAY_REQUEST_KEY_ID: 'sync-b' },
        read(files),
      ),
    ).toThrow(/core-to-gateway/);
  });
  test('rejects an unknown request key', () => {
    expect(() =>
      loadInquirySyncConfig(
        { ...syncEnv, AK_GATEWAY_REQUEST_KEY_ID: 'missing' },
        read(files),
      ),
    ).toThrow(/core-to-gateway/);
  });
  test('rejects a sync key belonging to another tenant', () => {
    files['/run/secrets/gateway_sync_keys'] = JSON.stringify([
      { ...JSON.parse(baseSync)[0], tenantId: operatorId },
    ]);
    expect(() => loadInquirySyncConfig(syncEnv, read(files))).toThrow(
      /tenant mismatch/,
    );
  });
  test('rejects an out-of-range interval', () => {
    for (const interval of ['4999', '600001', 'abc'])
      expect(() =>
        loadInquirySyncConfig(
          { ...syncEnv, AK_INQUIRY_SYNC_INTERVAL_MS: interval },
          read(files),
        ),
      ).toThrow(/AK_INQUIRY_SYNC_INTERVAL_MS/);
  });
});
