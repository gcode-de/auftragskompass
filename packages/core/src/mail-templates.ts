import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { sql } from 'drizzle-orm';
import { database, type Connection } from './database.js';
import { AccessError, lockTenant, requireAdministrator } from './access.js';
import { appendAudit } from './audit.js';
import {
  assertMailPlaceholders,
  escapeMailHtmlText,
  mailBodyTextFromHtml,
  MailContentError,
  resolveMailPlaceholders,
  resolveMailSubject,
  sanitizeMailHtml,
  type MailPlaceholder,
} from './mail-content.js';

// MAIL-TPL-01a: reusable mail templates. Like the other mail tables the rows
// live in reviewed SQL (0074) with no ORM mirror. A template stores a subject
// and a formatted body with the documented placeholders; applying one is a
// later slice and never re-reads the template behind the user's back.
export const mailTemplateStates = ['active', 'inactive', 'archived'] as const;
export type MailTemplateState = (typeof mailTemplateStates)[number];

export type MailTemplateErrorReason =
  | 'not_found'
  | 'conflict'
  | 'invalid_name'
  | 'invalid_subject'
  | 'invalid_body'
  | 'invalid_state'
  | 'invalid_content';
export class MailTemplateError extends Error {
  constructor(readonly reason: MailTemplateErrorReason) {
    super('Mail template rejected');
  }
}

export type MailTemplateInput = {
  name: string;
  subject: string;
  bodyHtml: string;
  /** Omitted means `active`; updates send the state explicitly. */
  state?: MailTemplateState;
};
export type MailTemplateSummary = {
  id: string;
  name: string;
  subject: string;
  state: MailTemplateState;
  version: number;
  createdAt: string;
  updatedAt: string;
};
export type MailTemplateDetail = MailTemplateSummary & { bodyHtml: string };
export type MailTemplatePreview = {
  subject: string;
  bodyHtml: string;
  bodyText: string;
  /** Names of known placeholders without a value; they stay visible. */
  missing: string[];
};

/**
 * The fixed example values of the template preview. They are deliberately,
 * visibly fictional (docs/mail-templates.md lists them) and never derive from
 * real records: a template belongs to no customer, so the preview pretends to
 * be none.
 */
export const mailTemplateExampleValues: Partial<
  Record<MailPlaceholder, string>
> = {
  contact: 'Alex Beispiel',
  contactFirstName: 'Alex',
  event: 'Fiktives Sommerfest',
  date: '26.10.2030',
  location: 'Beispielsaal',
  eventType: 'Feier',
  package: 'Paket Beispiel',
  total: '119,00 €',
  documentLink: 'https://example.invalid/vorschau',
};

function controlCharacters(value: string) {
  return [...value].some((character) => {
    const code = character.codePointAt(0)!;
    return code < 0x20 || (code >= 0x7f && code <= 0x9f);
  });
}

// One validation path for creating and changing a template. The body is
// always sanitized here - the stored HTML is never what the client sent.
function mailTemplateContent(subject: string, bodyHtml: string) {
  if (
    typeof subject !== 'string' ||
    subject.length > 998 ||
    controlCharacters(subject)
  )
    throw new MailTemplateError('invalid_subject');
  if (typeof bodyHtml !== 'string' || bodyHtml.length > 200000)
    throw new MailTemplateError('invalid_body');
  try {
    assertMailPlaceholders(subject, bodyHtml);
  } catch (error) {
    if (error instanceof MailContentError)
      throw new MailTemplateError('invalid_content');
    throw error;
  }
  return { subject, bodyHtml: sanitizeMailHtml(bodyHtml) };
}

export function mailTemplateFields(input: {
  name: string;
  subject: string;
  bodyHtml: string;
  state?: string;
}): {
  name: string;
  subject: string;
  bodyHtml: string;
  state: MailTemplateState;
} {
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name || name.length > 120 || controlCharacters(name))
    throw new MailTemplateError('invalid_name');
  const state = input.state ?? 'active';
  if (!(mailTemplateStates as readonly string[]).includes(state))
    throw new MailTemplateError('invalid_state');
  return {
    name,
    ...mailTemplateContent(input.subject, input.bodyHtml),
    state: state as MailTemplateState,
  };
}

// The read-only twin of applying a template: the very same content assembly
// with the documented synthetic values. Unknown placeholders are refused -
// the preview never invents a substitute.
export function previewMailTemplate(input: {
  subject: string;
  bodyHtml: string;
}): MailTemplatePreview {
  const content = mailTemplateContent(input.subject, input.bodyHtml);
  const subject = resolveMailSubject(
    content.subject,
    mailTemplateExampleValues,
  );
  const escaped = Object.fromEntries(
    Object.entries(mailTemplateExampleValues).map(([name, value]) => [
      name,
      escapeMailHtmlText(value),
    ]),
  ) as Partial<Record<MailPlaceholder, string>>;
  const body = resolveMailPlaceholders(content.bodyHtml, escaped),
    html = sanitizeMailHtml(body.text);
  return {
    subject: subject.subject,
    bodyHtml: html,
    bodyText: mailBodyTextFromHtml(html),
    missing: [...new Set([...subject.missing, ...body.missing])],
  };
}

type ReviewedSql = {
  execute: (query: ReturnType<typeof sql>) => Promise<unknown>;
};
function reviewed(connection: Connection): ReviewedSql {
  return database(connection) as unknown as ReviewedSql;
}

const templateColumns = sql`t.id::text AS id, t.name, t.subject,
  t.body_html, t.state, t.version,
  to_char(t.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at,
  to_char(t.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS updated_at`;
type TemplateQueryRow = {
  id: string;
  name: string;
  subject: string;
  body_html: string;
  state: MailTemplateState;
  version: number;
  created_at: string;
  updated_at: string;
};
function toDetail(row: TemplateQueryRow): MailTemplateDetail {
  return {
    id: row.id,
    name: row.name,
    subject: row.subject,
    bodyHtml: row.body_html,
    state: row.state,
    version: row.version,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}
function toSummary(row: TemplateQueryRow): MailTemplateSummary {
  return {
    id: row.id,
    name: row.name,
    subject: row.subject,
    state: row.state,
    version: row.version,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

export function mailTemplateRepository(pool: Pool, tenantId: string) {
  const db = database(pool);

  // Reads are tenant-bound by this closure; routes add the membership check.
  async function requireMember(actorId: string) {
    await db.transaction((tx) => requireAdministrator(tx, tenantId, actorId));
  }

  return {
    requireMember,

    async list(): Promise<MailTemplateSummary[]> {
      const result = (await reviewed(db).execute(sql`
        SELECT ${templateColumns} FROM mail_templates t
         WHERE t.tenant_id=${tenantId}
         ORDER BY t.name, t.id`)) as { rows: TemplateQueryRow[] };
      return result.rows.map(toSummary);
    },

    async get(id: string): Promise<MailTemplateDetail> {
      const result = (await reviewed(db).execute(sql`
        SELECT ${templateColumns} FROM mail_templates t
         WHERE t.tenant_id=${tenantId} AND t.id=${id}::uuid`)) as {
        rows: TemplateQueryRow[];
      };
      const row = result.rows[0];
      // Another tenant's template is missing, never forbidden: no leak.
      if (!row) throw new MailTemplateError('not_found');
      return toDetail(row);
    },

    async save(
      actorId: string,
      input: {
        name: string;
        subject: string;
        bodyHtml: string;
        state?: string;
      },
      id?: string,
      version?: number,
    ): Promise<MailTemplateDetail> {
      const fields = mailTemplateFields(input);
      return db.transaction(async (tx) => {
        await lockTenant(tx, tenantId);
        await requireAdministrator(tx, tenantId, actorId);
        let previous = 0;
        if (id) {
          const found = await tx.execute<{
            version: number;
          }>(
            sql`SELECT version FROM mail_templates
                 WHERE tenant_id=${tenantId} AND id=${id}::uuid FOR UPDATE`,
          );
          const old = found.rows[0];
          if (!old) throw new MailTemplateError('not_found');
          if (old.version !== version) throw new MailTemplateError('conflict');
          previous = old.version;
        }
        const result = (await reviewed(tx).execute(
          id
            ? sql`UPDATE mail_templates AS t
                     SET name=${fields.name}, subject=${fields.subject},
                         body_html=${fields.bodyHtml}, state=${fields.state},
                         version=${previous + 1}, updated_at=now()
                   WHERE t.tenant_id=${tenantId} AND t.id=${id}::uuid
                   RETURNING ${templateColumns}`
            : sql`INSERT INTO mail_templates AS t
                     (tenant_id,id,name,subject,body_html,state,version)
                   VALUES (${tenantId},${randomUUID()}::uuid,${fields.name},
                           ${fields.subject},${fields.bodyHtml},${fields.state},1)
                   RETURNING ${templateColumns}`,
        )) as { rows: TemplateQueryRow[] };
        await appendAudit(
          tx,
          tenantId,
          'mail.template_saved',
          actorId,
          result.rows[0]!.id,
        );
        return toDetail(result.rows[0]!);
      });
    },
  };
}

const templateSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'name',
    'subject',
    'bodyHtml',
    'state',
    'version',
    'createdAt',
    'updatedAt',
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    name: { type: 'string' },
    subject: { type: 'string' },
    bodyHtml: { type: 'string' },
    state: { type: 'string', enum: [...mailTemplateStates] },
    version: { type: 'integer', minimum: 1 },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
} as const;
const summarySchema = {
  type: 'object',
  additionalProperties: false,
  required: templateSchema.required.filter((key) => key !== 'bodyHtml'),
  properties: Object.fromEntries(
    Object.entries(templateSchema.properties).filter(
      ([key]) => key !== 'bodyHtml',
    ),
  ),
} as const;
const bodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'subject', 'bodyHtml'],
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 120 },
    subject: { type: 'string', maxLength: 998 },
    bodyHtml: { type: 'string', maxLength: 200000 },
    state: { type: 'string', enum: [...mailTemplateStates] },
    version: { type: 'integer', minimum: 1 },
  },
} as const;
const previewBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['subject', 'bodyHtml'],
  properties: {
    subject: { type: 'string', maxLength: 998 },
    bodyHtml: { type: 'string', maxLength: 200000 },
  },
} as const;
const previewSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['subject', 'bodyHtml', 'bodyText', 'missing'],
  properties: {
    subject: { type: 'string' },
    bodyHtml: { type: 'string' },
    bodyText: { type: 'string' },
    missing: {
      type: 'array',
      maxItems: 9,
      items: { type: 'string', maxLength: 40 },
    },
  },
} as const;

export function registerMailTemplateRoutes(
  app: FastifyInstance,
  pool: Pool,
  tenantId: string,
) {
  const repo = mailTemplateRepository(pool, tenantId),
    params = {
      type: 'object',
      required: ['id'],
      properties: { id: { type: 'string', format: 'uuid' } },
    };
  function failure(error: unknown, reply: FastifyReply) {
    if (error instanceof AccessError)
      return reply.code(403).send({ error: 'forbidden' });
    if (error instanceof MailTemplateError) {
      if (error.reason === 'not_found')
        return reply.code(404).send({ error: 'not_found' });
      if (error.reason === 'conflict')
        return reply.code(409).send({ error: 'conflict' });
      return reply.code(400).send({ error: error.reason });
    }
    throw error;
  }
  app.get(
    '/api/v1/mail-templates',
    { schema: { response: { 200: { type: 'array', items: summarySchema } } } },
    async (request, reply) => {
      try {
        await repo.requireMember(request.authSession!.userId);
        return await repo.list();
      } catch (error) {
        return failure(error, reply);
      }
    },
  );
  app.get<{ Params: { id: string } }>(
    '/api/v1/mail-templates/:id',
    { schema: { params, response: { 200: templateSchema } } },
    async (request, reply) => {
      try {
        await repo.requireMember(request.authSession!.userId);
        return await repo.get(request.params.id);
      } catch (error) {
        return failure(error, reply);
      }
    },
  );
  app.post(
    '/api/v1/mail-templates',
    {
      schema: {
        body: bodySchema,
        response: { 201: templateSchema },
      },
    },
    async (request, reply) => {
      try {
        const created = await repo.save(
          request.authSession!.userId,
          request.body as {
            name: string;
            subject: string;
            bodyHtml: string;
            state?: string;
          },
        );
        return reply.code(201).send(created);
      } catch (error) {
        return failure(error, reply);
      }
    },
  );
  app.put<{ Params: { id: string } }>(
    '/api/v1/mail-templates/:id',
    {
      schema: {
        params,
        body: bodySchema,
        response: { 200: templateSchema },
      },
    },
    async (request, reply) => {
      try {
        const body = request.body as {
          name: string;
          subject: string;
          bodyHtml: string;
          state?: string;
          version?: number;
        };
        return await repo.save(
          request.authSession!.userId,
          body,
          request.params.id,
          body.version,
        );
      } catch (error) {
        return failure(error, reply);
      }
    },
  );
  // MAIL-TPL-01a: the read-only synthetic preview. It runs the same content
  // assembly with the documented example values and writes nothing at all.
  app.post(
    '/api/v1/mail-templates/preview',
    {
      schema: {
        body: previewBodySchema,
        response: { 200: previewSchema },
      },
    },
    async (request, reply) => {
      try {
        await repo.requireMember(request.authSession!.userId);
        return previewMailTemplate(
          request.body as { subject: string; bodyHtml: string },
        );
      } catch (error) {
        return failure(error, reply);
      }
    },
  );
}
