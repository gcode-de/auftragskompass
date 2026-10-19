import type { Pool } from 'pg';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { and, asc, eq, sql } from 'drizzle-orm';
import { database, type Connection } from './database.js';
import { documentNumberSequences, tenants } from './schema.js';
import { AccessError, lockTenant, requireAdministrator } from './access.js';
import { appendAudit } from './audit.js';
import { documentKinds, type DocumentKind } from './document-templates.js';

const tokenNames = ['YYYY', 'YY', 'MM', 'DD', 'SEQ'] as const,
  token = /\{([^{}]*)\}/g;

export class DocumentNumberError extends Error {
  constructor(
    readonly reason:
      'not_found' | 'conflict' | 'not_configured' | 'invalid_pattern',
  ) {
    super('Document number rejected');
  }
}

// NK-02/NK-03: a pattern carries the date placeholders and exactly one counter.
export function assertNumberPattern(pattern: string): void {
  const found = [...pattern.matchAll(token)].map((match) => match[1]!);
  if (
    found.some((name) => !(tokenNames as readonly string[]).includes(name)) ||
    found.filter((name) => name === 'SEQ').length !== 1
  )
    throw new DocumentNumberError('invalid_pattern');
}

export function formatDocumentNumber(
  pattern: string,
  minLength: number,
  at: Date,
  timeZone: string,
  value: number,
): string {
  assertNumberPattern(pattern);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((entry) => entry.type === type)!.value;
  return pattern.replace(token, (_match, name: string) => {
    if (name === 'YYYY') return part('year');
    if (name === 'YY') return part('year').slice(-2);
    if (name === 'MM') return part('month');
    if (name === 'DD') return part('day');
    return String(value).padStart(minLength, '0');
  });
}

export type NumberSequenceInput = {
  pattern: string;
  minLength: number;
  nextValue: number;
};

export function documentNumberRepository(pool: Connection, tenantId: string) {
  const scope = eq(documentNumberSequences.tenantId, tenantId);
  async function timeZoneOf(connection: Connection) {
    const [tenant] = await database(connection)
      .select({ timezone: tenants.timezone })
      .from(tenants)
      .where(eq(tenants.id, tenantId));
    if (!tenant) throw new DocumentNumberError('not_found');
    return tenant.timezone;
  }
  return {
    async list() {
      return database(pool)
        .select()
        .from(documentNumberSequences)
        .where(scope)
        .orderBy(asc(documentNumberSequences.kind));
    },
    async save(
      actorId: string,
      kind: DocumentKind,
      input: NumberSequenceInput,
      version?: number,
    ) {
      assertNumberPattern(input.pattern);
      return database(pool).transaction(async (tx) => {
        await lockTenant(tx, tenantId);
        await requireAdministrator(tx, tenantId, actorId);
        const [old] = await tx
          .select()
          .from(documentNumberSequences)
          .where(and(scope, eq(documentNumberSequences.kind, kind)));
        if (old && old.version !== version)
          throw new DocumentNumberError('conflict');
        const values = {
          pattern: input.pattern,
          minLength: input.minLength,
          nextValue: input.nextValue,
          version: (old?.version ?? 0) + 1,
        };
        const [row] = old
          ? await tx
              .update(documentNumberSequences)
              .set(values)
              .where(and(scope, eq(documentNumberSequences.kind, kind)))
              .returning()
          : await tx
              .insert(documentNumberSequences)
              .values({ ...values, tenantId, kind })
              .returning();
        // NK-04: adopting the next number is an audited act, never a silent edit.
        // recordId is a uuid column; a number sequence is identified by its kind,
        // which the audit action already carries.
        await appendAudit(tx, tenantId, 'document_number.updated', actorId);
        return row!;
      });
    },
    // Read-only: a preview must never consume a number.
    async preview(kind: DocumentKind, at: Date) {
      const [row] = await database(pool)
        .select()
        .from(documentNumberSequences)
        .where(and(scope, eq(documentNumberSequences.kind, kind)));
      if (!row) throw new DocumentNumberError('not_configured');
      return formatDocumentNumber(
        row.pattern,
        row.minLength,
        at,
        await timeZoneOf(pool),
        row.nextValue,
      );
    },
  };
}

// Allocation stays a single statement so two concurrent documents can never
// share a number; the caller's transaction decides whether it is kept.
export async function allocateDocumentNumber(
  connection: Connection,
  tenantId: string,
  kind: DocumentKind,
  at: Date,
): Promise<string> {
  const [row] = await database(connection)
    .update(documentNumberSequences)
    .set({ nextValue: sql`${documentNumberSequences.nextValue} + 1` })
    .where(
      and(
        eq(documentNumberSequences.tenantId, tenantId),
        eq(documentNumberSequences.kind, kind),
      ),
    )
    .returning({
      value: sql<number>`${documentNumberSequences.nextValue} - 1`,
      pattern: documentNumberSequences.pattern,
      minLength: documentNumberSequences.minLength,
    });
  if (!row) throw new DocumentNumberError('not_configured');
  const [tenant] = await database(connection)
    .select({ timezone: tenants.timezone })
    .from(tenants)
    .where(eq(tenants.id, tenantId));
  if (!tenant) throw new DocumentNumberError('not_found');
  return formatDocumentNumber(
    row.pattern,
    row.minLength,
    at,
    tenant.timezone,
    row.value,
  );
}

export function registerDocumentNumberRoutes(
  app: FastifyInstance,
  pool: Pool,
  tenantId: string,
) {
  const repo = documentNumberRepository(pool, tenantId);
  const fields = {
    pattern: { type: 'string', minLength: 1, maxLength: 60, pattern: '\\S' },
    minLength: { type: 'integer', minimum: 1, maximum: 12 },
    nextValue: { type: 'integer', minimum: 1, maximum: 2147483647 },
  };
  const version = { type: 'integer', minimum: 1 },
    row = {
      type: 'object',
      additionalProperties: false,
      required: ['kind', ...Object.keys(fields), 'version'],
      properties: {
        ...fields,
        kind: { type: 'string', enum: [...documentKinds] },
        version,
      },
    },
    params = {
      type: 'object',
      required: ['kind'],
      properties: { kind: { type: 'string', enum: [...documentKinds] } },
    };
  function failure(error: unknown, reply: FastifyReply) {
    if (error instanceof AccessError)
      return reply.code(403).send({ error: 'forbidden' });
    if (error instanceof DocumentNumberError) {
      if (error.reason === 'not_found')
        return reply.code(404).send({ error: 'not_found' });
      if (error.reason === 'not_configured')
        return reply.code(404).send({ error: 'not_configured' });
      if (error.reason === 'conflict')
        return reply.code(409).send({ error: 'conflict' });
      return reply.code(400).send({ error: error.reason });
    }
    throw error;
  }
  app.get(
    '/api/v1/document-numbers',
    { schema: { response: { 200: { type: 'array', items: row } } } },
    () => repo.list(),
  );
  app.get<{ Params: { kind: DocumentKind } }>(
    '/api/v1/document-numbers/:kind/preview',
    {
      schema: {
        params,
        response: {
          200: {
            type: 'object',
            additionalProperties: false,
            required: ['number'],
            properties: { number: { type: 'string' } },
          },
        },
      },
    },
    async (request, reply) => {
      try {
        return { number: await repo.preview(request.params.kind, new Date()) };
      } catch (error) {
        return failure(error, reply);
      }
    },
  );
  app.post<{ Body: NumberSequenceInput & { kind: DocumentKind } }>(
    '/api/v1/document-numbers',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['kind', ...Object.keys(fields)],
          properties: {
            ...fields,
            kind: { type: 'string', enum: [...documentKinds] },
          },
        },
        response: { 201: row },
      },
    },
    async (request, reply) => {
      try {
        const { kind, ...input } = request.body;
        return reply
          .code(201)
          .send(await repo.save(request.authSession!.userId, kind, input));
      } catch (error) {
        return failure(error, reply);
      }
    },
  );
  app.put<{
    Params: { kind: DocumentKind };
    Body: NumberSequenceInput & { version: number };
  }>(
    '/api/v1/document-numbers/:kind',
    {
      schema: {
        params,
        body: {
          type: 'object',
          additionalProperties: false,
          required: [...Object.keys(fields), 'version'],
          properties: { ...fields, version },
        },
        response: { 200: row },
      },
    },
    async (request, reply) => {
      try {
        return await repo.save(
          request.authSession!.userId,
          request.params.kind,
          request.body,
          request.body.version,
        );
      } catch (error) {
        return failure(error, reply);
      }
    },
  );
}
