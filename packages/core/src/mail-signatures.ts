import { createHash, randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { sql } from 'drizzle-orm';
import { database, type Connection } from './database.js';
import { AccessError, lockTenant, requireAdministrator } from './access.js';
import { appendAudit } from './audit.js';
import { sanitizeMailHtml } from './mail-content.js';
import {
  assertLogo,
  DocumentLayoutError,
  logoLimit,
} from './document-layouts.js';
import type { StorageAdapter } from './storage.js';

// MAIL-SIG-01a: several named signatures per tenant, one of them the standard.
// The text runs through the mail allowlist; `{{logo}}` marks where the logo
// stands and is the only token a signature knows. The logo bytes go to the
// storage adapter like the document logo - the row keeps key, type, size and
// hash, so a mail can later freeze exactly these bytes as an inline image.

export const signatureLogoToken = '{{logo}}';

export type MailSignatureErrorReason =
  | 'not_found'
  | 'invalid_name'
  | 'invalid_body'
  | 'invalid_content'
  | 'invalid_link'
  | 'invalid_logo'
  | 'logo_too_large';
export class MailSignatureError extends Error {
  constructor(readonly reason: MailSignatureErrorReason) {
    super('Mail signature rejected');
  }
}

export type MailSignatureInput = {
  name: string;
  bodyHtml: string;
  logoLink: string;
  isDefault: boolean;
};
export type MailSignature = MailSignatureInput & {
  id: string;
  hasLogo: boolean;
  updatedAt: string;
};

type Tx = Parameters<
  Parameters<ReturnType<typeof database>['transaction']>[0]
>[0];
type ReviewedSql = {
  execute: (query: ReturnType<typeof sql>) => Promise<unknown>;
};
function reviewed(connection: Connection): ReviewedSql {
  return database(connection) as unknown as ReviewedSql;
}
type Row = {
  id: string;
  name: string;
  body_html: string;
  logo_key: string | null;
  logo_link: string;
  is_default: boolean;
  updated_at: string;
};
const columns = sql`s.id::text AS id, s.name, s.body_html, s.logo_key,
  s.logo_link, s.is_default,
  to_char(s.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS updated_at`;
function toSignature(row: Row): MailSignature {
  return {
    id: row.id,
    name: row.name,
    bodyHtml: row.body_html,
    logoLink: row.logo_link,
    isDefault: row.is_default,
    hasLogo: row.logo_key !== null,
    updatedAt: row.updated_at,
  };
}

/** Validates and normalizes what the operator typed; never trusts the client. */
export function normalizeSignature(
  input: MailSignatureInput,
): MailSignatureInput {
  const name = input.name.trim();
  if (!name || name.length > 120) throw new MailSignatureError('invalid_name');
  if (input.bodyHtml.length > 50000)
    throw new MailSignatureError('invalid_body');
  const bodyHtml = sanitizeMailHtml(input.bodyHtml);
  // Any other `{{…}}` would reach the customer as literal text.
  for (const match of bodyHtml.match(/{{[^{}]*}}/g) ?? [])
    if (match !== signatureLogoToken)
      throw new MailSignatureError('invalid_content');
  const logoLink = input.logoLink.trim();
  if (logoLink) {
    let url: URL;
    try {
      url = new URL(logoLink);
    } catch {
      throw new MailSignatureError('invalid_link');
    }
    if (
      (url.protocol !== 'https:' && url.protocol !== 'http:') ||
      logoLink.length > 2000
    )
      throw new MailSignatureError('invalid_link');
  }
  return { name, bodyHtml, logoLink, isDefault: input.isDefault };
}

export function mailSignatureRepository(
  pool: Pool,
  tenantId: string,
  store: StorageAdapter,
) {
  const db = database(pool);
  async function one(connection: Connection, id: string) {
    const result = (await reviewed(connection).execute(sql`
      SELECT ${columns} FROM mail_signatures s
       WHERE s.tenant_id=${tenantId} AND s.id=${id}::uuid`)) as { rows: Row[] };
    if (!result.rows[0]) throw new MailSignatureError('not_found');
    return result.rows[0];
  }
  // Every write: tenant lock, administrator, audit - like the templates.
  function write<T>(actorId: string, work: (tx: Tx) => Promise<T>): Promise<T> {
    return db.transaction(async (tx) => {
      await lockTenant(tx, tenantId);
      await requireAdministrator(tx, tenantId, actorId);
      return work(tx);
    });
  }
  // The partial unique index allows one standard; the old one steps down first.
  async function clearDefault(tx: Tx, except: string) {
    await reviewed(tx).execute(sql`
      UPDATE mail_signatures SET is_default=false, updated_at=now()
       WHERE tenant_id=${tenantId} AND is_default AND id<>${except}::uuid`);
  }
  return {
    async requireMember(actorId: string) {
      await db.transaction((tx) => requireAdministrator(tx, tenantId, actorId));
    },
    async list(): Promise<MailSignature[]> {
      const result = (await reviewed(db).execute(sql`
        SELECT ${columns} FROM mail_signatures s
         WHERE s.tenant_id=${tenantId}
         ORDER BY s.is_default DESC, lower(s.name), s.id`)) as { rows: Row[] };
      return result.rows.map(toSignature);
    },
    async create(actorId: string, input: MailSignatureInput) {
      const value = normalizeSignature(input),
        id = randomUUID();
      return write(actorId, async (tx) => {
        if (value.isDefault) await clearDefault(tx, id);
        await reviewed(tx).execute(sql`
          INSERT INTO mail_signatures
            (tenant_id,id,name,body_html,logo_link,is_default)
          VALUES (${tenantId},${id}::uuid,${value.name},${value.bodyHtml},
                  ${value.logoLink},${value.isDefault})`);
        await appendAudit(tx, tenantId, 'mail.signature_saved', actorId, id);
        return toSignature(await one(tx, id));
      });
    },
    async update(actorId: string, id: string, input: MailSignatureInput) {
      const value = normalizeSignature(input);
      return write(actorId, async (tx) => {
        await one(tx, id);
        if (value.isDefault) await clearDefault(tx, id);
        await reviewed(tx).execute(sql`
          UPDATE mail_signatures SET name=${value.name},
                 body_html=${value.bodyHtml}, logo_link=${value.logoLink},
                 is_default=${value.isDefault}, updated_at=now()
           WHERE tenant_id=${tenantId} AND id=${id}::uuid`);
        await appendAudit(tx, tenantId, 'mail.signature_saved', actorId, id);
        return toSignature(await one(tx, id));
      });
    },
    // The row goes; the logo bytes stay, since a queued mail may hold them.
    async remove(actorId: string, id: string) {
      await write(actorId, async (tx) => {
        await one(tx, id);
        await reviewed(tx).execute(sql`
          DELETE FROM mail_signatures
           WHERE tenant_id=${tenantId} AND id=${id}::uuid`);
        await appendAudit(tx, tenantId, 'mail.signature_saved', actorId, id);
      });
    },
    async saveLogo(
      actorId: string,
      id: string,
      bytes: Buffer,
      declared: string,
    ) {
      let mediaType: 'image/png' | 'image/jpeg';
      try {
        mediaType = assertLogo(bytes, declared);
      } catch (error) {
        if (error instanceof DocumentLayoutError)
          throw new MailSignatureError(
            error.reason === 'logo_too_large'
              ? 'logo_too_large'
              : 'invalid_logo',
          );
        throw error;
      }
      // A fresh key per upload: old bytes stay readable for queued mails.
      const key = `signature-${randomUUID()}.${mediaType === 'image/png' ? 'png' : 'jpg'}`,
        sha256 = createHash('sha256').update(bytes).digest('hex');
      return write(actorId, async (tx) => {
        await one(tx, id);
        await store.put(key, bytes);
        await reviewed(tx).execute(sql`
          UPDATE mail_signatures SET logo_key=${key},
                 logo_media_type=${mediaType}, logo_size_bytes=${bytes.byteLength},
                 logo_sha256=${sha256}, updated_at=now()
           WHERE tenant_id=${tenantId} AND id=${id}::uuid`);
        await appendAudit(tx, tenantId, 'mail.signature_saved', actorId, id);
        return toSignature(await one(tx, id));
      });
    },
    async removeLogo(actorId: string, id: string) {
      return write(actorId, async (tx) => {
        await one(tx, id);
        await reviewed(tx).execute(sql`
          UPDATE mail_signatures SET logo_key=NULL, logo_media_type=NULL,
                 logo_size_bytes=NULL, logo_sha256=NULL, updated_at=now()
           WHERE tenant_id=${tenantId} AND id=${id}::uuid`);
        await appendAudit(tx, tenantId, 'mail.signature_saved', actorId, id);
        return toSignature(await one(tx, id));
      });
    },
    async readLogo(id: string) {
      const result = (await reviewed(db).execute(sql`
        SELECT logo_key, logo_media_type FROM mail_signatures
         WHERE tenant_id=${tenantId} AND id=${id}::uuid`)) as {
        rows: { logo_key: string | null; logo_media_type: string | null }[];
      };
      const row = result.rows[0];
      if (!row?.logo_key || !row.logo_media_type)
        throw new MailSignatureError('not_found');
      return {
        bytes: await store.read(row.logo_key),
        mediaType: row.logo_media_type,
      };
    },
  };
}

const signatureSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'name',
    'bodyHtml',
    'logoLink',
    'isDefault',
    'hasLogo',
    'updatedAt',
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    name: { type: 'string' },
    bodyHtml: { type: 'string' },
    logoLink: { type: 'string' },
    isDefault: { type: 'boolean' },
    hasLogo: { type: 'boolean' },
    updatedAt: { type: 'string' },
  },
} as const;
const bodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'bodyHtml', 'logoLink', 'isDefault'],
  properties: {
    name: { type: 'string', maxLength: 120 },
    bodyHtml: { type: 'string', maxLength: 50000 },
    logoLink: { type: 'string', maxLength: 2000 },
    isDefault: { type: 'boolean' },
  },
} as const;
const params = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string', format: 'uuid' } },
} as const;

export function registerMailSignatureRoutes(
  app: FastifyInstance,
  pool: Pool,
  tenantId: string,
  store: StorageAdapter,
) {
  const repo = mailSignatureRepository(pool, tenantId, store);
  // Raw image bodies never pass through JSON - the same parser as the
  // document logo, registered once for the whole server.
  for (const type of ['image/png', 'image/jpeg'])
    if (!app.hasContentTypeParser(type))
      app.addContentTypeParser(
        type,
        { parseAs: 'buffer', bodyLimit: logoLimit },
        (_request, body, done) => done(null, body),
      );
  function failure(error: unknown, reply: FastifyReply) {
    if (error instanceof AccessError)
      return reply.code(403).send({ error: 'forbidden' });
    if (error instanceof MailSignatureError) {
      if (error.reason === 'not_found')
        return reply.code(404).send({ error: 'not_found' });
      if (error.reason === 'logo_too_large')
        return reply.code(413).send({ error: 'logo_too_large' });
      return reply.code(400).send({ error: error.reason });
    }
    throw error;
  }
  const actor = (request: { authSession?: { userId: string } | null }) =>
    request.authSession!.userId;

  app.get(
    '/api/v1/mail-signatures',
    {
      schema: { response: { 200: { type: 'array', items: signatureSchema } } },
    },
    async (request, reply) => {
      try {
        await repo.requireMember(actor(request));
        return await repo.list();
      } catch (error) {
        return failure(error, reply);
      }
    },
  );
  app.post<{ Body: MailSignatureInput }>(
    '/api/v1/mail-signatures',
    { schema: { body: bodySchema, response: { 201: signatureSchema } } },
    async (request, reply) => {
      try {
        return reply
          .code(201)
          .send(await repo.create(actor(request), request.body));
      } catch (error) {
        return failure(error, reply);
      }
    },
  );
  app.put<{ Params: { id: string }; Body: MailSignatureInput }>(
    '/api/v1/mail-signatures/:id',
    {
      schema: { params, body: bodySchema, response: { 200: signatureSchema } },
    },
    async (request, reply) => {
      try {
        return await repo.update(
          actor(request),
          request.params.id,
          request.body,
        );
      } catch (error) {
        return failure(error, reply);
      }
    },
  );
  app.delete<{ Params: { id: string } }>(
    '/api/v1/mail-signatures/:id',
    { schema: { params } },
    async (request, reply) => {
      try {
        await repo.remove(actor(request), request.params.id);
        return reply.code(204).send();
      } catch (error) {
        return failure(error, reply);
      }
    },
  );
  app.put<{ Params: { id: string }; Body: Buffer }>(
    '/api/v1/mail-signatures/:id/logo',
    { schema: { params, response: { 200: signatureSchema } } },
    async (request, reply) => {
      try {
        const declared = String(request.headers['content-type'] ?? '')
          .split(';')[0]!
          .trim()
          .toLowerCase();
        return await repo.saveLogo(
          actor(request),
          request.params.id,
          request.body,
          declared,
        );
      } catch (error) {
        return failure(error, reply);
      }
    },
  );
  app.delete<{ Params: { id: string } }>(
    '/api/v1/mail-signatures/:id/logo',
    { schema: { params, response: { 200: signatureSchema } } },
    async (request, reply) => {
      try {
        return await repo.removeLogo(actor(request), request.params.id);
      } catch (error) {
        return failure(error, reply);
      }
    },
  );
  app.get<{ Params: { id: string } }>(
    '/api/v1/mail-signatures/:id/logo',
    { schema: { params } },
    async (request, reply) => {
      try {
        await repo.requireMember(actor(request));
        const logo = await repo.readLogo(request.params.id);
        return reply
          .header('content-type', logo.mediaType)
          .header('cache-control', 'private, no-store')
          .header('x-content-type-options', 'nosniff')
          .send(logo.bytes);
      } catch (error) {
        return failure(error, reply);
      }
    },
  );
}
