import Fastify, {
  LogController,
  type FastifyError,
  type FastifyInstance,
} from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import {
  inquiryFormV1,
  inquirySubmissionSchema,
  type InquirySubmission,
} from './inquiry-form.js';
import {
  inquiryInbox,
  InquiryInboxError,
  type InquiryInboxConfig,
} from './inquiry-inbox.js';
import {
  processGatewayOperation,
  GatewayOperationError,
} from './gateway-operations.js';
import {
  signGatewayMessage,
  verifyGatewayMessage,
  type GatewayKey,
  type GatewayMessage,
} from './gateway-message.js';
import AjvCompiler from '@fastify/ajv-compiler';

type Options = {
  pool: Pool;
  storage: InquiryInboxConfig;
  syncKeys: readonly GatewayKey[];
  responseKeyId: string;
  allowedOrigins: readonly string[];
  now?: () => Date;
};
const uuid = { type: 'string', format: 'uuid' };
const errors = {
  type: 'object',
  additionalProperties: false,
  required: ['error'],
  properties: {
    error: {
      type: 'string',
      enum: [
        'invalid_request',
        'forbidden',
        'rate_limited',
        'request_too_large',
        'unsupported_media_type',
        'inquiry_conflict',
        'inquiry_expired',
        'unavailable',
        'unauthorized',
        'replay',
        'operation_conflict',
        'not_found',
      ],
    },
  },
};
const status = (value: string) => ({
  type: 'object',
  additionalProperties: false,
  required: ['status'],
  properties: { status: { type: 'string', const: value } },
});
const packetSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['keyId', 'body', 'signature'],
  properties: {
    keyId: { type: 'string' },
    body: { type: 'string', maxLength: 65536 },
    signature: { type: 'string' },
  },
};
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
const pull = compile({
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['limit'],
    properties: { limit: { type: 'integer', minimum: 1, maximum: 100 } },
  },
});
const ack = compile({
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['inquiryIds'],
    properties: {
      inquiryIds: {
        type: 'array',
        maxItems: 100,
        uniqueItems: true,
        items: uuid,
      },
    },
  },
});
function safeOrigin(value: string) {
  try {
    const u = new URL(value);
    return (
      u.origin === value &&
      (u.protocol === 'https:' ||
        (u.protocol === 'http:' &&
          ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)))
    );
  } catch {
    return false;
  }
}
const responseErrors = { '4xx': errors, '5xx': errors };
const definitionSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'version',
    'title',
    'submitLabel',
    'privacyNotice',
    'privacyUrl',
    'fields',
  ],
  properties: {
    id: { type: 'string' },
    version: { type: 'integer' },
    title: { type: 'string' },
    submitLabel: { type: 'string' },
    privacyNotice: { type: 'string' },
    privacyUrl: { type: 'string' },
    fields: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'label', 'type', 'required'],
        properties: {
          name: { type: 'string' },
          label: { type: 'string' },
          type: { type: 'string' },
          required: { type: 'boolean' },
          options: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['value', 'label'],
              properties: {
                value: { type: 'string' },
                label: { type: 'string' },
              },
            },
          },
        },
      },
    },
  },
};

export async function createInquiryGateway(options: Options) {
  const now = options.now ?? (() => new Date());
  if (
    !Array.isArray(options.allowedOrigins) ||
    !options.allowedOrigins.length ||
    options.allowedOrigins.length > 20 ||
    options.allowedOrigins.some(
      (origin) => typeof origin !== 'string' || !safeOrigin(origin),
    ) ||
    !Array.isArray(options.syncKeys) ||
    !options.syncKeys.length ||
    options.syncKeys.length > 32
  )
    throw new Error('Invalid inquiry gateway configuration');
  const origins = new Set(options.allowedOrigins),
    pool = options.pool;
  let storage: InquiryInboxConfig, inbox: ReturnType<typeof inquiryInbox>;
  try {
    inbox = inquiryInbox(pool, options.storage);
    storage = {
      ...options.storage,
      keys: options.storage.keys.map((k) => ({
        ...k,
        secret: Buffer.from(k.secret),
      })),
    };
  } catch {
    throw new Error('Invalid inquiry gateway configuration');
  }
  const tenantId = storage.tenantId;
  const probe = (
    kind: GatewayMessage['kind'],
    issuedAt: number,
  ): GatewayMessage => ({
    version: 1,
    tenantId,
    messageId: randomUUID(),
    operationId: randomUUID(),
    issuedAt,
    kind,
    payload: {},
  });
  let responseKey: GatewayKey, keys: GatewayKey[];
  try {
    for (const key of options.syncKeys) {
      if (key.tenantId !== tenantId) throw new Error();
      signGatewayMessage(
        probe(
          key.direction === 'gateway-to-core'
            ? 'inquiries.batch'
            : 'inquiries.pull',
          Math.max(0, key.notBefore),
        ),
        key,
      );
    }
    keys = options.syncKeys.map((k) => ({
      ...k,
      secret: Buffer.from(k.secret),
    }));
    if (new Set(keys.map((k) => k.direction + ':' + k.id)).size !== keys.length)
      throw new Error();
    const matches = keys.filter(
      (k) =>
        k.id === options.responseKeyId && k.direction === 'gateway-to-core',
    );
    if (matches.length !== 1) throw new Error();
    responseKey = matches[0]!;
  } catch {
    throw new Error('Invalid inquiry gateway configuration');
  }
  function checkKeys(at: Date) {
    const timestamp = Math.floor(at.getTime() / 1000);
    if (
      !keys.some(
        (k) =>
          k.direction === 'core-to-gateway' &&
          timestamp >= k.notBefore &&
          timestamp < k.expiresAt,
      )
    )
      throw new InquiryInboxError('unavailable');
    try {
      signGatewayMessage(probe('inquiries.batch', timestamp), responseKey);
    } catch {
      throw new InquiryInboxError('unavailable');
    }
  }
  try {
    checkKeys(now());
  } catch {
    throw new Error('Invalid inquiry gateway configuration');
  }
  const app = Fastify({
    logger: false,
    logController: new LogController({ disableRequestLogging: true }),
    bodyLimit: 132096,
    ajv: {
      customOptions: {
        coerceTypes: false,
        removeAdditional: false,
        useDefaults: false,
      },
    },
    trustProxy: false,
  });
  await app.register(rateLimit, { global: false });
  app.addHook('onRequest', async (request, reply) => {
    reply
      .header('cache-control', 'no-store')
      .header('x-content-type-options', 'nosniff')
      .header('referrer-policy', 'no-referrer')
      .header('vary', 'Origin');
    const origin = request.headers.origin;
    if (request.routeOptions.url?.startsWith('/sync/v1/')) {
      if (origin !== undefined)
        return reply.code(403).send({ error: 'forbidden' });
    } else if (origin !== undefined) {
      if (typeof origin !== 'string' || !origins.has(origin))
        return reply.code(403).send({ error: 'forbidden' });
      reply.header('access-control-allow-origin', origin);
    } else if (request.method === 'POST' || request.method === 'OPTIONS')
      return reply.code(403).send({ error: 'forbidden' });
    if (request.method === 'POST') {
      const type = request.headers['content-type'];
      if (
        typeof type !== 'string' ||
        type.split(';')[0]!.trim().toLowerCase() !== 'application/json'
      )
        return reply.code(415).send({ error: 'unsupported_media_type' });
    }
  });
  app.setNotFoundHandler((_request, reply) =>
    reply.code(404).send({ error: 'not_found' }),
  );
  app.setErrorHandler<FastifyError>((error, _request, reply) => {
    if (error instanceof InquiryInboxError) {
      const code = {
        invalid: 400,
        conflict: 409,
        expired: 410,
        capacity: 503,
        unavailable: 503,
      }[error.reason];
      return reply.code(code).send({
        error:
          error.reason === 'invalid'
            ? 'invalid_request'
            : error.reason === 'conflict'
              ? 'inquiry_conflict'
              : error.reason === 'expired'
                ? 'inquiry_expired'
                : 'unavailable',
      });
    }
    if (error instanceof GatewayOperationError) {
      const code =
        error.reason === 'unauthorized'
          ? 401
          : ['replay', 'conflict'].includes(error.reason)
            ? 409
            : 503;
      return reply.code(code).send({
        error:
          error.reason === 'unauthorized'
            ? 'unauthorized'
            : error.reason === 'replay'
              ? 'replay'
              : error.reason === 'conflict'
                ? 'operation_conflict'
                : 'unavailable',
      });
    }
    if (error.statusCode === 429)
      return reply.code(429).send({ error: 'rate_limited' });
    if (error.statusCode === 413)
      return reply.code(413).send({ error: 'request_too_large' });
    if (error.statusCode === 415)
      return reply.code(415).send({ error: 'unsupported_media_type' });
    if (error.statusCode === 400 || error.validation)
      return reply.code(400).send({ error: 'invalid_request' });
    return reply.code(503).send({ error: 'unavailable' });
  });
  const params = {
    type: 'object',
    additionalProperties: false,
    required: ['formId'],
    properties: { formId: { type: 'string' } },
  };
  const base = '/public/v1/forms/:formId';
  app.get<{ Params: { formId: string } }>(
    base,
    {
      schema: {
        params,
        response: { 200: definitionSchema, ...responseErrors },
      },
    },
    async (request, reply) => {
      if (request.params.formId !== inquiryFormV1.id)
        return reply.code(404).send({ error: 'not_found' });
      return inquiryFormV1;
    },
  );
  app.options(
    base + '/inquiries',
    { schema: { params, response: responseErrors } },
    async (request, reply) => {
      const method = request.headers['access-control-request-method'];
      const headers = request.headers['access-control-request-headers'];
      if (
        method !== 'POST' ||
        (typeof headers === 'string' &&
          headers
            .split(',')
            .some((h) => h.trim().toLowerCase() !== 'content-type'))
      )
        return reply.code(403).send({ error: 'forbidden' });
      return reply
        .header('access-control-allow-methods', 'POST')
        .header('access-control-allow-headers', 'content-type')
        .code(204)
        .send();
    },
  );
  type Input = {
    submissionId: string;
    submission: InquirySubmission;
    website?: string;
  };
  app.post<{ Params: { formId: string }; Body: Input }>(
    base + '/inquiries',
    {
      bodyLimit: 32768,
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: {
        params,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['submissionId', 'submission'],
          properties: {
            submissionId: uuid,
            submission: inquirySubmissionSchema,
            website: { type: 'string', maxLength: 200 },
          },
        },
        response: { 202: status('received'), ...responseErrors },
      },
    },
    async (request, reply) => {
      if (request.params.formId !== inquiryFormV1.id)
        return reply.code(404).send({ error: 'not_found' });
      const at = now();
      checkKeys(at);
      if (request.body.website?.trim())
        return reply.code(202).send({ status: 'received' });
      await inbox.receive(
        request.body.submissionId,
        request.body.submission,
        at,
      );
      return reply.code(202).send({ status: 'received' });
    },
  );
  for (const kind of ['inquiries.pull', 'inquiries.ack'] as const) {
    const url =
      kind === 'inquiries.pull'
        ? '/sync/v1/inquiries/pull'
        : '/sync/v1/inquiries/ack';
    app.post(
      url,
      {
        config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
        schema: {
          response: {
            200: packetSchema,
            ...responseErrors,
          },
        },
      },
      async (request, reply) => {
        const at = now();
        checkKeys(at);
        const context = {
          tenantId,
          direction: 'core-to-gateway' as const,
          kind,
          keys,
          now: Math.floor(at.getTime() / 1000),
        };
        const message = verifyGatewayMessage(request.body, context);
        if (!message) throw new GatewayOperationError('unauthorized');
        if (
          !(kind === 'inquiries.pull'
            ? pull(message.payload)
            : ack(message.payload))
        )
          return reply.code(400).send({ error: 'invalid_request' });
        const result = await processGatewayOperation(
          pool,
          request.body,
          context,
          async (tx, msg) =>
            kind === 'inquiries.pull'
              ? 0
              : inquiryInbox(tx, storage).acknowledge(
                  msg.payload.inquiryIds as string[],
                  at,
                ),
        );
        if (kind === 'inquiries.ack')
          return signGatewayMessage(
            {
              ...probe('inquiries.receipt', context.now),
              payload: {
                requestId: message.messageId,
                acknowledgedCount: result.count,
              },
            },
            responseKey,
          );
        const pending = await inbox.pending(
          message.payload.limit as number,
          at,
        );
        const inquiries: typeof pending = [];
        for (const item of pending) {
          const candidate = [...inquiries, item];
          if (Buffer.byteLength(JSON.stringify(candidate), 'utf8') > 50000)
            break;
          inquiries.push(item);
        }
        return signGatewayMessage(
          {
            ...probe('inquiries.batch', context.now),
            payload: { requestId: message.messageId, inquiries },
          },
          responseKey,
        );
      },
    );
  }
  app.get(
    '/health/live',
    { schema: { response: { 200: status('up') } } },
    async () => ({ status: 'up' }),
  );
  app.get(
    '/health/ready',
    {
      schema: {
        response: { 200: status('ready'), 503: status('unavailable') },
      },
    },
    async (_request, reply) => {
      try {
        checkKeys(now());
        await pool.query(
          'SELECT 1 FROM ak_gateway_inquiries,ak_gateway_messages,ak_gateway_operations LIMIT 1',
        );
        return { status: 'ready' };
      } catch {
        return reply.code(503).send({ status: 'unavailable' });
      }
    },
  );
  return app;
}

// Registered only after the administrative API's session guard. Never accepts input.
export function registerInquiryPreviewRoute(app: FastifyInstance) {
  app.get(
    '/api/v1/website-inquiries/form-definition',
    {
      schema: { response: { 200: definitionSchema } },
    },
    async (_request, reply) =>
      reply.header('cache-control', 'no-store').send(inquiryFormV1),
  );
}
