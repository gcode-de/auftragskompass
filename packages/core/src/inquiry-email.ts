import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { sql } from 'drizzle-orm';
import { AccessError, lockTenant, requireAdministrator } from './access.js';
import { database } from './database.js';
import { mailAddressList, MailError } from './mail.js';
import { renderWebsiteInquiryTelegramMessage } from './telegram-message.js';
import { isWebsiteInquiry } from './website-inquiries.js';

// MAIL-NOTIFY-01: the second, independent notification of a received website
// inquiry. It reuses the MAIL-021 core (message row + outbox order) and never
// touches the Telegram queue.
export const inquiryEmailSubject = 'Neue Website-Anfrage';

/** One inquiry, one order: the same entry can never queue a second mail. */
export function inquiryEmailKey(inquiryId: string): string {
  return `inquiry-notification:${inquiryId}`;
}

// The body is the bounded Telegram field summary plus the opaque inquiry id as
// the only reference. Nothing beyond that measure is added, and no token,
// address link or secret is part of it.
export function renderWebsiteInquiryEmail(input: unknown): {
  subject: string;
  text: string;
} {
  const summary = renderWebsiteInquiryTelegramMessage(input);
  return {
    subject: inquiryEmailSubject,
    text: isWebsiteInquiry(input)
      ? `${summary}\nAnfrage-ID: ${input.id}`
      : summary,
  };
}

export type InquiryEmailSettings = {
  enabled: boolean;
  recipients: string;
};

// Same administrator, tenant lock and CSRF shape as the Telegram settings. GET
// returns only what an operator wrote; there is no secret in this table.
export function registerInquiryEmailSettingsRoutes(
  app: FastifyInstance,
  pool: Pool,
  tenantId: string,
) {
  app.get('/api/v1/settings/inquiry-email', async (request, reply) => {
    if (!request.authSession)
      return reply.code(401).send({ error: 'unauthorized' });
    try {
      const value = await database(pool).transaction(async (tx) => {
        await lockTenant(tx, tenantId);
        await requireAdministrator(tx, tenantId, request.authSession!.userId);
        const { rows } = await tx.execute<{
          enabled: boolean;
          recipients: string;
        }>(
          sql`SELECT enabled, recipients FROM inquiry_email_settings WHERE tenant_id=${tenantId}`,
        );
        return rows[0];
      });
      return {
        enabled: Boolean(value?.enabled),
        recipients: value?.recipients ?? '',
      } satisfies InquiryEmailSettings;
    } catch (error) {
      return reply
        .code(error instanceof AccessError ? 403 : 500)
        .send({ error: error instanceof AccessError ? 'forbidden' : 'failed' });
    }
  });
  app.put<{ Body: { enabled: boolean; recipients: string } }>(
    '/api/v1/settings/inquiry-email',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['enabled', 'recipients'],
          properties: {
            enabled: { type: 'boolean' },
            recipients: { type: 'string', maxLength: 4000 },
          },
        },
      },
    },
    async (request, reply) => {
      if (!request.authSession)
        return reply.code(401).send({ error: 'unauthorized' });
      let recipients: string;
      try {
        recipients = mailAddressList(request.body.recipients);
      } catch (error) {
        if (error instanceof MailError)
          return reply.code(400).send({ error: 'invalid_recipients' });
        throw error;
      }
      if (recipients.length > 4000)
        return reply.code(400).send({ error: 'invalid_recipients' });
      if (request.body.enabled && !recipients)
        return reply.code(400).send({ error: 'recipients_required' });
      try {
        await database(pool).transaction(async (tx) => {
          await lockTenant(tx, tenantId);
          await requireAdministrator(tx, tenantId, request.authSession!.userId);
          // A disabled setting keeps its address so a later activation is one
          // click; it orders nothing either way.
          await tx.execute(
            sql`INSERT INTO inquiry_email_settings(tenant_id,recipients,enabled)
                VALUES(${tenantId},${recipients},${request.body.enabled})
                ON CONFLICT(tenant_id) DO UPDATE SET recipients=EXCLUDED.recipients,
                  enabled=EXCLUDED.enabled, updated_at=now()`,
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
