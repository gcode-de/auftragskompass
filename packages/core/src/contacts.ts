import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { drizzle } from 'drizzle-orm/node-postgres';
import { and, asc, eq, or, ilike, inArray, ne } from 'drizzle-orm';
import { contacts } from './schema.js';
import { AccessError, lockTenant, requireAdministrator } from './access.js';
import { appendAudit } from './audit.js';
export type ContactInput = {
  kind: 'private' | 'company';
  name: string;
  contactPerson: string;
  street: string;
  postalCode: string;
  city: string;
  country: string;
  email: string;
  phone: string;
  mobile: string;
  state: 'active' | 'archived';
};
export function phoneKey(value: string, country: string) {
  let digits = value
    .trim()
    .replace(/^(\+|00)(\d{1,3})\s*\(0\)/, '$1$2')
    .replace(/\D/g, '');
  if (value.trim().startsWith('00')) digits = digits.slice(2);
  else if (
    !value.trim().startsWith('+') &&
    country === 'DE' &&
    digits.startsWith('0')
  )
    digits = '49' + digits.slice(1);
  return digits;
}
export function csv(rows: string[][]) {
  return (
    '\uFEFF' +
    rows
      .map((row) =>
        row
          .map(
            (value) =>
              '"' +
              // eslint-disable-next-line no-control-regex -- Ignore leading controls when blocking spreadsheet formulas.
              (/^[\s\u0000-\u001f]*[=+@-]/.test(value)
                ? "'" + value
                : value
              ).replace(/"/g, '""') +
              '"',
          )
          .join(','),
      )
      .join('\r\n') +
    '\r\n'
  );
}
class ContactError extends Error {}
export function contactRepository(pool: Pool, tenantId: string) {
  const db = drizzle(pool),
    scope = eq(contacts.tenantId, tenantId);
  return {
    async list(search = '') {
      const pattern = '%' + search.replace(/[\\%_]/g, '\\$&') + '%';
      return db
        .select()
        .from(contacts)
        .where(
          and(
            scope,
            search
              ? or(
                  ...[
                    contacts.name,
                    contacts.contactPerson,
                    contacts.email,
                    contacts.phone,
                    contacts.mobile,
                    contacts.street,
                    contacts.postalCode,
                    contacts.city,
                  ].map((field) => ilike(field, pattern)),
                )
              : undefined,
          ),
        )
        .orderBy(asc(contacts.name), asc(contacts.id));
    },
    async duplicates(
      input: Pick<ContactInput, 'email' | 'phone' | 'mobile' | 'country'>,
      excludeId?: string,
    ) {
      const email = input.email.trim().toLowerCase(),
        keys = [
          phoneKey(input.phone, input.country),
          phoneKey(input.mobile, input.country),
        ].filter(Boolean);
      if (!email && !keys.length) return [];
      return db
        .select()
        .from(contacts)
        .where(
          and(
            scope,
            excludeId ? ne(contacts.id, excludeId) : undefined,
            or(
              email ? eq(contacts.email, email) : undefined,
              keys.length ? inArray(contacts.phoneKey, keys) : undefined,
              keys.length ? inArray(contacts.mobileKey, keys) : undefined,
            ),
          ),
        )
        .orderBy(asc(contacts.name));
    },
    async save(
      actorId: string,
      input: ContactInput,
      id?: string,
      version?: number,
    ) {
      return db.transaction(async (tx) => {
        await lockTenant(tx, tenantId);
        await requireAdministrator(tx, tenantId, actorId);
        let previous = 0;
        if (id) {
          const [old] = await tx
            .select()
            .from(contacts)
            .where(and(scope, eq(contacts.id, id)));
          if (!old) throw new ContactError('not_found');
          if (old.version !== version) throw new ContactError('conflict');
          previous = old.version;
        }
        const values = {
          ...input,
          name: input.name.trim(),
          email: input.email.trim().toLowerCase(),
          phoneKey: phoneKey(input.phone, input.country),
          mobileKey: phoneKey(input.mobile, input.country),
          version: previous + 1,
        };
        const [row] = id
          ? await tx
              .update(contacts)
              .set(values)
              .where(and(scope, eq(contacts.id, id)))
              .returning()
          : await tx
              .insert(contacts)
              .values({ ...values, tenantId, id: randomUUID() })
              .returning();
        await appendAudit(
          tx,
          tenantId,
          id ? 'contact.updated' : 'contact.created',
          actorId,
          row!.id,
        );
        return row!;
      });
    },
  };
}
const phone = { type: 'string', maxLength: 60, pattern: '^[+0-9() .\\/-]*$' };
export const contactFields = {
  kind: { type: 'string', enum: ['private', 'company'] },
  name: { type: 'string', minLength: 1, maxLength: 200, pattern: '\\S' },
  contactPerson: { type: 'string', maxLength: 200 },
  street: { type: 'string', maxLength: 200 },
  postalCode: { type: 'string', maxLength: 20 },
  city: { type: 'string', maxLength: 120 },
  country: { type: 'string', pattern: '^[A-Z]{2}$' },
  email: {
    type: 'string',
    maxLength: 254,
    pattern: '^\\s*$|^\\s*[^\\s@]+@[^\\s@]+\\.[^\\s@]+\\s*$',
  },
  phone,
  mobile: phone,
  state: { type: 'string', enum: ['active', 'archived'] },
};
export function registerContactRoutes(
  app: FastifyInstance,
  pool: Pool,
  tenantId: string,
) {
  const repo = contactRepository(pool, tenantId);
  const fields = contactFields;
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
    if (error instanceof ContactError)
      return reply
        .code(error.message === 'not_found' ? 404 : 409)
        .send({ error: error.message });
    throw error;
  }
  app.get(
    '/api/v1/contacts',
    {
      schema: {
        querystring: {
          type: 'object',
          properties: { q: { type: 'string', maxLength: 200 } },
        },
        response: { 200: { type: 'array', items: row } },
      },
    },
    (request) => repo.list((request.query as { q?: string }).q),
  );
  app.get('/api/v1/contacts/export.csv', async (_request, reply) => {
    const rows = await repo.list();
    const columns = [
      'kind',
      'name',
      'contactPerson',
      'street',
      'postalCode',
      'city',
      'country',
      'email',
      'phone',
      'mobile',
      'state',
    ] as const;
    return reply
      .type('text/csv; charset=utf-8')
      .header('content-disposition', 'attachment; filename="contacts.csv"')
      .header('cache-control', 'no-store')
      .send(
        csv([
          columns.slice(),
          ...rows.map((row) => columns.map((key) => row[key])),
        ]),
      );
  });
  app.post<{
    Body: Pick<ContactInput, 'email' | 'phone' | 'mobile' | 'country'> & {
      excludeId?: string;
    };
  }>(
    '/api/v1/contacts/duplicates',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['email', 'phone', 'mobile', 'country'],
          properties: {
            email: fields.email,
            phone,
            mobile: phone,
            country: fields.country,
            excludeId: { type: 'string', format: 'uuid' },
          },
        },
        response: { 200: { type: 'array', items: row } },
      },
    },
    (request) => repo.duplicates(request.body, request.body.excludeId),
  );
  app.post<{ Body: ContactInput }>(
    '/api/v1/contacts',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: Object.keys(fields),
          properties: fields,
        },
        response: { 201: row },
      },
    },
    async (request, reply) => {
      try {
        return reply
          .code(201)
          .send(await repo.save(request.authSession!.userId, request.body));
      } catch (error) {
        return failure(error, reply);
      }
    },
  );
  app.put<{
    Params: { id: string };
    Body: ContactInput & { version: number };
  }>(
    '/api/v1/contacts/:id',
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
          properties: { ...fields, version },
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
