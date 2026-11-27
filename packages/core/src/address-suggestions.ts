import type { FastifyInstance } from 'fastify';

const fields = {
  formatted: 400,
  attribution: 240,
  name: 200,
  street: 200,
  postalCode: 20,
  city: 120,
  country: 2,
} as const;
const clean = (value: unknown, length: number) =>
  typeof value === 'string' ? value.trim().slice(0, length) : '';

export function registerAddressSuggestionRoute(
  app: FastifyInstance,
  key?: string,
) {
  app.post<{ Body: { query: string } }>(
    '/api/v1/address-suggestions',
    {
      bodyLimit: 2048,
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['query'],
          properties: {
            query: { type: 'string', minLength: 3, maxLength: 200 },
          },
        },
        response: {
          200: {
            type: 'array',
            items: {
              type: 'object',
              required: Object.keys(fields),
              properties: Object.fromEntries(
                Object.entries(fields).map(([name, maxLength]) => [
                  name,
                  { type: 'string', maxLength },
                ]),
              ),
            },
          },
        },
      },
    },
    async (request, reply) => {
      const query = request.body.query.trim();
      if (!key || query.length < 3) return [];
      const url = new URL('https://api.geoapify.com/v1/geocode/autocomplete');
      url.search = new URLSearchParams({
        text: query,
        format: 'json',
        limit: '5',
        lang: 'de',
        bias: 'countrycode:de',
        apiKey: key,
      }).toString();
      try {
        const response = await fetch(url, {
          signal: AbortSignal.timeout(3000),
          redirect: 'error',
        });
        if (!response.ok) throw new Error('Address provider unavailable');
        const { results } = (await response.json()) as {
          results?: Record<string, unknown>[];
        };
        if (!Array.isArray(results))
          throw new Error('Invalid address provider response');
        return results
          .slice(0, 5)
          .map((item) => ({
            formatted: clean(item.formatted, fields.formatted),
            attribution: [
              'Geoapify',
              clean(
                (item.datasource as { attribution?: unknown } | undefined)
                  ?.attribution,
                228,
              ) || '© OpenStreetMap-Mitwirkende',
            ].join(' · '),
            name: clean(item.name, fields.name),
            street: [
              clean(item.street, fields.street),
              clean(item.housenumber, 30),
            ]
              .join(' ')
              .trim()
              .slice(0, fields.street),
            postalCode: clean(item.postcode, fields.postalCode),
            city: clean(item.city, fields.city),
            country: clean(item.country_code, fields.country).toUpperCase(),
          }))
          .filter((item) => item.formatted);
      } catch {
        return reply
          .code(502)
          .send({ error: 'address_suggestions_unavailable' });
      }
    },
  );
}
