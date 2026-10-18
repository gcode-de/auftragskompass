import { expect, test } from 'vitest';
import Fastify from 'fastify';
import { registerInquiryPreviewRoute } from '../../packages/core/src/inquiry-gateway.js';
import { inquiryFormV1 } from '../../packages/core/src/inquiry-form.js';
test('preview reads the same versioned definition and offers no submission route', async () => {
  const app = Fastify();
  registerInquiryPreviewRoute(app);
  try {
    const result = await app.inject({
      url: '/api/v1/website-inquiries/form-definition',
    });
    expect(result.statusCode).toBe(200);
    expect(result.json()).toEqual(inquiryFormV1);
    expect(result.headers['cache-control']).toBe('no-store');
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/website-inquiries/form-definition',
          payload: {},
        })
      ).statusCode,
    ).toBe(404);
  } finally {
    await app.close();
  }
});
