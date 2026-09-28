import { expect, test } from 'vitest';
import { loadAuthConfig } from '../../packages/core/src/auth-config.js';
test('authentication is disabled unless explicitly configured, and fails closed', () => {
  expect(loadAuthConfig({}, () => '')).toBeUndefined();
  const env = {
    AK_AUTH_ENABLED: 'true',
    AK_AUTH_ORIGIN: 'https://admin.example.invalid',
    AK_TENANT_ID: '11111111-1111-4111-8111-111111111111',
    AK_GOOGLE_CLIENT_ID: 'synthetic',
    AK_GOOGLE_SECRET_FILE: '/external/synthetic',
  };
  expect(loadAuthConfig(env, () => 'synthetic-secret')).toMatchObject({
    origin: env.AK_AUTH_ORIGIN,
  });
  for (const [key, value] of Object.entries({
    AK_AUTH_ENABLED: 'yes',
    AK_AUTH_ORIGIN: 'http://insecure.invalid',
    AK_TENANT_ID: 'bad',
    AK_GOOGLE_CLIENT_ID: '',
    AK_GOOGLE_SECRET_FILE: '',
  })) {
    expect(() =>
      loadAuthConfig({ ...env, [key]: value }, () => 'synthetic-secret'),
    ).toThrow();
  }
  for (const origin of [
    'https://admin.invalid/path',
    'https://user:pass@admin.invalid',
    'https://admin.invalid/?x=1',
    'https://admin.invalid/#x',
  ])
    expect(() =>
      loadAuthConfig({ ...env, AK_AUTH_ORIGIN: origin }, () => 'synthetic'),
    ).toThrow();
  expect(() => loadAuthConfig(env, () => '')).toThrow();
  expect(() =>
    loadAuthConfig(env, () => {
      throw new Error('private');
    }),
  ).toThrow('Cannot read Google secret');
});
