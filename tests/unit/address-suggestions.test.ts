import { expect, test, vi } from 'vitest';
import { registerAddressSuggestionRoute } from '../../packages/core/src/address-suggestions.js';
import {
  createHealthServer,
  loadRuntimeConfig,
} from '../../packages/core/src/runtime.js';

test('unconfigured autocomplete leaves manual entry available without contacting a provider', async () => {
  const config = loadRuntimeConfig(
    {
      AK_DB_HOST: 'synthetic',
      AK_DB_NAME: 'synthetic',
      AK_DB_USER: 'synthetic',
      AK_DB_PASSWORD_FILE: 'synthetic',
      AK_LOG_LEVEL: 'silent',
    },
    () => 'synthetic-long-password',
  );
  const app = createHealthServer(config, {
    database: async () => true,
    worker: async () => true,
  });
  registerAddressSuggestionRoute(app);
  const upstream = vi.spyOn(globalThis, 'fetch');
  try {
    const reply = await app.inject({
      method: 'POST',
      url: '/api/v1/address-suggestions',
      payload: { query: 'Fiktiver Saal' },
    });
    expect(reply.statusCode).toBe(200);
    expect(reply.json()).toEqual([]);
    expect(upstream).not.toHaveBeenCalled();
  } finally {
    upstream.mockRestore();
    await app.close();
  }
});
