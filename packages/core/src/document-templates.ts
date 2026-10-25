import { createHash, randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { drizzle } from 'drizzle-orm/node-postgres';
import { and, asc, eq } from 'drizzle-orm';
import {
  documentTemplateCreateOperations,
  documentTemplatePositions,
  documentTemplates,
} from './schema.js';
import { AccessError, lockTenant, requireAdministrator } from './access.js';
import { appendAudit } from './audit.js';

export const documentKinds = [
  'offer',
  'order_confirmation',
  'deposit_invoice',
  'invoice',
  'correction',
] as const;
export type DocumentKind = (typeof documentKinds)[number];

// ET-02: the placeholders a stored template may reference.
export const templatePlaceholders = [
  'contact',
  'event',
  'date',
  'location',
  'eventType',
  'package',
  'total',
  'documentLink',
] as const;
export type TemplatePlaceholder = (typeof templatePlaceholders)[number];

export class DocumentTemplateError extends Error {
  constructor(
    readonly reason:
      'not_found' | 'conflict' | 'unknown_placeholder' | 'missing_value',
  ) {
    super('Document template rejected');
  }
}

const token = /\{\{\s*([a-zA-Z]+)\s*\}\}/g;

export function templateTokens(text: string): string[] {
  return [...text.matchAll(token)].map((match) => match[1]!);
}

// Rejecting unknown placeholders at save time keeps a typo from silently
// reaching a customer-facing document.
export function assertTemplateText(...texts: string[]): void {
  for (const text of texts)
    for (const name of templateTokens(text))
      if (!(templatePlaceholders as readonly string[]).includes(name))
        throw new DocumentTemplateError('unknown_placeholder');
}

export function renderTemplate(
  text: string,
  values: Partial<Record<TemplatePlaceholder, string>>,
): string {
  return text.replace(token, (_match, name: string) => {
    const value = values[name as TemplatePlaceholder];
    if (value === undefined) throw new DocumentTemplateError('missing_value');
    return value;
  });
}

export type TemplatePositionInput = {
  productId?: string | null;
  description: string;
  quantity: number;
  unit: string;
  unitPriceMinor: number;
  taxBasisPoints: number;
  discountBasisPoints: number;
};
export type DocumentTemplateInput = {
  kind: DocumentKind;
  name: string;
  subject: string;
  introText: string;
  outroText: string;
  validityDays: number;
  state: 'active' | 'inactive' | 'archived';
  positions: TemplatePositionInput[];
};

function documentTemplateRequestHash(input: DocumentTemplateInput): string {
  const canonical = {
    kind: input.kind,
    name: input.name.trim(),
    subject: input.subject,
    introText: input.introText,
    outroText: input.outroText,
    validityDays: input.validityDays,
    state: input.state,
    positions: input.positions.map((position) => ({
      productId: position.productId ?? null,
      description: position.description.trim(),
      quantity: position.quantity,
      unit: position.unit.trim(),
      unitPriceMinor: position.unitPriceMinor,
      taxBasisPoints: position.taxBasisPoints,
      discountBasisPoints: position.discountBasisPoints,
    })),
  };
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

export function documentTemplateRepository(pool: Pool, tenantId: string) {
  const db = drizzle(pool),
    scope = eq(documentTemplates.tenantId, tenantId),
    positionScope = eq(documentTemplatePositions.tenantId, tenantId);
  async function positionsOf(
    connection: Pick<ReturnType<typeof drizzle>, 'select'>,
    templateId?: string,
  ) {
    const rows = templateId
      ? await connection
          .select()
          .from(documentTemplatePositions)
          .where(
            and(
              positionScope,
              eq(documentTemplatePositions.templateId, templateId),
            ),
          )
          .orderBy(asc(documentTemplatePositions.position))
      : await connection
          .select()
          .from(documentTemplatePositions)
          .where(positionScope)
          .orderBy(
            asc(documentTemplatePositions.templateId),
            asc(documentTemplatePositions.position),
          );
    return rows;
  }
  function clone(positions: Awaited<ReturnType<typeof positionsOf>>) {
    return positions.map((row) => ({
      id: row.id,
      productId: row.productId,
      description: row.description,
      quantity: row.quantity,
      unit: row.unit,
      unitPriceMinor: row.unitPriceMinor,
      taxBasisPoints: row.taxBasisPoints,
      discountBasisPoints: row.discountBasisPoints,
    }));
  }
  // Read through the same connection: reading the pool inside the write
  // transaction would not see the uncommitted row.
  async function readOne(
    connection: Pick<ReturnType<typeof drizzle>, 'select'>,
    id: string,
  ) {
    const [template] = await connection
      .select()
      .from(documentTemplates)
      .where(and(scope, eq(documentTemplates.id, id)));
    if (!template) return null;
    return { ...template, positions: clone(await positionsOf(connection, id)) };
  }
  return {
    async list() {
      return db.transaction(
        async (tx) => {
          const [templates, positions] = await Promise.all([
            tx
              .select()
              .from(documentTemplates)
              .where(scope)
              .orderBy(
                asc(documentTemplates.kind),
                asc(documentTemplates.name),
              ),
            positionsOf(tx),
          ]);
          return templates.map((template) => ({
            ...template,
            positions: clone(
              positions.filter((row) => row.templateId === template.id),
            ),
          }));
        },
        { isolationLevel: 'repeatable read', accessMode: 'read only' },
      );
    },
    async get(id: string) {
      return readOne(db, id);
    },
    async save(
      actorId: string,
      input: DocumentTemplateInput,
      id?: string,
      version?: number,
      requestId?: string,
    ) {
      assertTemplateText(input.subject, input.introText, input.outroText);
      const requestHash = requestId
        ? documentTemplateRequestHash(input)
        : undefined;
      const outcome = await db.transaction(async (tx) => {
        await lockTenant(tx, tenantId);
        await requireAdministrator(tx, tenantId, actorId);
        if (id && requestId) throw new DocumentTemplateError('conflict');
        if (requestId && requestHash) {
          const [receipt] = await tx
            .select()
            .from(documentTemplateCreateOperations)
            .where(
              and(
                eq(documentTemplateCreateOperations.tenantId, tenantId),
                eq(documentTemplateCreateOperations.requestId, requestId),
              ),
            );
          if (receipt) {
            if (receipt.requestHash !== requestHash)
              throw new DocumentTemplateError('conflict');
            return { response: receipt.response };
          }
        }
        let previous = 0;
        if (id) {
          const [old] = await tx
            .select()
            .from(documentTemplates)
            .where(and(scope, eq(documentTemplates.id, id)));
          if (!old) throw new DocumentTemplateError('not_found');
          if (old.version !== version)
            throw new DocumentTemplateError('conflict');
          previous = old.version;
        }
        const values = {
          kind: input.kind,
          name: input.name.trim(),
          subject: input.subject,
          introText: input.introText,
          outroText: input.outroText,
          validityDays: input.validityDays,
          state: input.state,
          version: previous + 1,
        };
        const [row] = id
          ? await tx
              .update(documentTemplates)
              .set(values)
              .where(and(scope, eq(documentTemplates.id, id)))
              .returning()
          : await tx
              .insert(documentTemplates)
              .values({ ...values, tenantId, id: randomUUID() })
              .returning();
        const templateId = row!.id;
        await tx
          .delete(documentTemplatePositions)
          .where(
            and(
              positionScope,
              eq(documentTemplatePositions.templateId, templateId),
            ),
          );
        if (input.positions.length)
          await tx.insert(documentTemplatePositions).values(
            input.positions.map((position, index) => ({
              tenantId,
              templateId,
              id: randomUUID(),
              position: index,
              productId: position.productId ?? null,
              description: position.description.trim(),
              quantity: position.quantity,
              unit: position.unit.trim(),
              unitPriceMinor: position.unitPriceMinor,
              taxBasisPoints: position.taxBasisPoints,
              discountBasisPoints: position.discountBasisPoints,
            })),
          );
        await appendAudit(
          tx,
          tenantId,
          id ? 'document_template.updated' : 'document_template.created',
          actorId,
          templateId,
        );
        if (requestId && requestHash) {
          const response = (await readOne(tx, templateId))!;
          await tx.insert(documentTemplateCreateOperations).values({
            tenantId,
            requestId,
            templateId,
            requestHash,
            response,
          });
          return { response };
        }
        return { id: templateId };
      });
      if ('response' in outcome) return outcome.response;
      return (await readOne(db, outcome.id))!;
    },
  };
}

export function registerDocumentTemplateRoutes(
  app: FastifyInstance,
  pool: Pool,
  tenantId: string,
) {
  const repo = documentTemplateRepository(pool, tenantId);
  const position = {
    type: 'object',
    additionalProperties: false,
    required: [
      'description',
      'quantity',
      'unit',
      'unitPriceMinor',
      'taxBasisPoints',
      'discountBasisPoints',
    ],
    properties: {
      productId: {
        anyOf: [{ type: 'string', format: 'uuid' }, { type: 'null' }],
      },
      description: {
        type: 'string',
        minLength: 1,
        maxLength: 300,
        pattern: '\\S',
      },
      quantity: { type: 'integer', minimum: 1, maximum: 100000 },
      unit: { type: 'string', minLength: 1, maxLength: 40, pattern: '\\S' },
      unitPriceMinor: {
        type: 'integer',
        minimum: 0,
        maximum: Number.MAX_SAFE_INTEGER,
      },
      taxBasisPoints: { type: 'integer', minimum: 0, maximum: 10000 },
      discountBasisPoints: { type: 'integer', minimum: 0, maximum: 10000 },
    },
  };
  const fields = {
    kind: { type: 'string', enum: [...documentKinds] },
    name: { type: 'string', minLength: 1, maxLength: 120, pattern: '\\S' },
    subject: { type: 'string', maxLength: 200 },
    introText: { type: 'string', maxLength: 4000 },
    outroText: { type: 'string', maxLength: 4000 },
    validityDays: { type: 'integer', minimum: 1, maximum: 365 },
    state: { type: 'string', enum: ['active', 'inactive', 'archived'] },
    positions: { type: 'array', maxItems: 200, items: position },
  };
  const version = { type: 'integer', minimum: 1 },
    row = {
      type: 'object',
      additionalProperties: false,
      required: [...Object.keys(fields), 'id', 'version'],
      properties: {
        ...fields,
        id: { type: 'string', format: 'uuid' },
        version,
      },
    };
  function failure(error: unknown, reply: FastifyReply) {
    if (error instanceof AccessError)
      return reply.code(403).send({ error: 'forbidden' });
    if (error instanceof DocumentTemplateError) {
      if (error.reason === 'not_found')
        return reply.code(404).send({ error: 'not_found' });
      if (error.reason === 'conflict')
        return reply.code(409).send({ error: 'conflict' });
      return reply.code(400).send({ error: error.reason });
    }
    throw error;
  }
  app.get(
    '/api/v1/document-templates',
    { schema: { response: { 200: { type: 'array', items: row } } } },
    () => repo.list(),
  );
  app.get<{ Params: { id: string } }>(
    '/api/v1/document-templates/:id',
    {
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string', format: 'uuid' } },
        },
        response: { 200: row },
      },
    },
    async (request, reply) =>
      (await repo.get(request.params.id)) ??
      reply.code(404).send({ error: 'not_found' }),
  );
  app.post<{ Body: DocumentTemplateInput & { requestId?: string } }>(
    '/api/v1/document-templates',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: Object.keys(fields),
          properties: {
            ...fields,
            requestId: { type: 'string', format: 'uuid' },
          },
        },
        response: { 201: row },
      },
    },
    async (request, reply) => {
      try {
        return reply
          .code(201)
          .send(
            await repo.save(
              request.authSession!.userId,
              request.body,
              undefined,
              undefined,
              request.body.requestId,
            ),
          );
      } catch (error) {
        return failure(error, reply);
      }
    },
  );
  app.put<{
    Params: { id: string };
    Body: DocumentTemplateInput & { version: number };
  }>(
    '/api/v1/document-templates/:id',
    {
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string', format: 'uuid' } },
        },
        body: {
          type: 'object',
          additionalProperties: false,
          required: [...Object.keys(fields), 'version'],
          properties: { ...fields, version, requestId: false },
        },
        response: { 200: row },
      },
    },
    async (request, reply) => {
      try {
        return await repo.save(
          request.authSession!.userId,
          request.body,
          request.params.id,
          request.body.version,
        );
      } catch (error) {
        return failure(error, reply);
      }
    },
  );
}
