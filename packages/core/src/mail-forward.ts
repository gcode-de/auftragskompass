import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { sql } from 'drizzle-orm';
import { AccessError, lockTenant, requireAdministrator } from './access.js';
import { database, type Connection } from './database.js';
// The forwarding switch resolution lives in mail.ts (single source); this
// module owns the accounting setting and its routes.
import { mailAddressList, MailError } from './mail.js';

// MAIL-FWD-01: outgoing mails can additionally be sent to the accounting
// address and to app users. The composer only carries switches and user
// ids; every address is resolved here, on the server, from the stored
// setting and the tenant's own users. A requested forwarding that cannot
// be fulfilled refuses the order instead of silently dropping a copy.

export type MailForwardSettings = {
  accountingRecipient: string;
};

export type MailForwardRequest = {
  accounting?: boolean;
  userIds?: readonly string[];
};

/** The stored accounting address (empty when none is configured). */
export async function readMailForwardSettings(
  connection: Connection,
  tenantId: string,
): Promise<MailForwardSettings> {
  return database(connection).transaction(async (tx) => {
    const { rows } = await tx.execute<{ accounting_recipient: string }>(
      sql`SELECT accounting_recipient FROM mail_forward_settings
           WHERE tenant_id = ${tenantId}`,
    );
    return { accountingRecipient: rows[0]?.accounting_recipient ?? '' };
  });
}

// Same administrator, tenant lock and CSRF shape as the inquiry settings.
export function registerMailForwardSettingsRoutes(
  app: FastifyInstance,
  pool: Pool,
  tenantId: string,
) {
  app.get('/api/v1/settings/mail-accounting', async (request, reply) => {
    if (!request.authSession)
      return reply.code(401).send({ error: 'unauthorized' });
    try {
      const value = await database(pool).transaction(async (tx) => {
        await lockTenant(tx, tenantId);
        await requireAdministrator(tx, tenantId, request.authSession!.userId);
        return await readMailForwardSettings(tx, tenantId);
      });
      return value;
    } catch (error) {
      return reply
        .code(error instanceof AccessError ? 403 : 500)
        .send({ error: error instanceof AccessError ? 'forbidden' : 'failed' });
    }
  });
  app.put<{ Body: { accountingRecipient: string } }>(
    '/api/v1/settings/mail-accounting',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['accountingRecipient'],
          properties: {
            accountingRecipient: { type: 'string', maxLength: 4000 },
          },
        },
      },
    },
    async (request, reply) => {
      if (!request.authSession)
        return reply.code(401).send({ error: 'unauthorized' });
      // The same address validation as every other recipient; an empty
      // value only disables the switch.
      let recipients: string;
      try {
        recipients = request.body.accountingRecipient.trim()
          ? mailAddressList(request.body.accountingRecipient)
          : '';
      } catch (error) {
        if (error instanceof MailError)
          return reply.code(400).send({ error: 'invalid_recipients' });
        throw error;
      }
      if (recipients.length > 4000)
        return reply.code(400).send({ error: 'invalid_recipients' });
      try {
        await database(pool).transaction(async (tx) => {
          await lockTenant(tx, tenantId);
          await requireAdministrator(tx, tenantId, request.authSession!.userId);
          await tx.execute(
            sql`INSERT INTO mail_forward_settings(tenant_id,accounting_recipient)
                VALUES(${tenantId},${recipients})
                ON CONFLICT(tenant_id) DO UPDATE SET
                  accounting_recipient=EXCLUDED.accounting_recipient,
                  updated_at=now()`,
          );
        });
        return reply.code(204).send();
      } catch (error) {
        return reply.code(error instanceof AccessError ? 403 : 500).send({
          error: error instanceof AccessError ? 'forbidden' : 'failed',
        });
      }
    },
  );
}
