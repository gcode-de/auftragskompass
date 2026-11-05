import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { sql } from 'drizzle-orm';
import { AccessError, lockTenant, requireAdministrator } from './access.js';
import { database } from './database.js';
import { renderWebsiteInquiryTelegramMessage } from './telegram-message.js';

class TelegramEncryptionUnavailable extends Error {}

export type TelegramNotificationFailure =
  | { type: 'database'; stage: 'claim' | 'mark_delivered' | 'schedule_retry' }
  | { type: 'decryption' }
  | { type: 'network'; category: 'timeout' | 'request' }
  | { type: 'malformed_response'; httpStatus: number }
  | { type: 'telegram_rejected'; httpStatus: number; errorCode?: number };

export function telegramKeyFromSecret(value: string): Buffer {
  const normalized = value.trim();
  if (!/^[0-9a-f]{64}$/i.test(normalized))
    throw new Error('Invalid Telegram encryption key');
  return Buffer.from(normalized, 'hex');
}

export function encryptTelegramToken(token: string, key: Uint8Array) {
  if (key.byteLength !== 32) throw new Error('Invalid Telegram encryption key');
  const nonce = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', key, nonce);
  const ciphertext = Buffer.concat([
    cipher.update(token, 'utf8'),
    cipher.final(),
  ]);
  return { ciphertext, nonce, tag: cipher.getAuthTag() };
}

export function decryptTelegramToken(
  value: { ciphertext: Buffer; nonce: Buffer; tag: Buffer },
  key: Uint8Array,
) {
  if (key.byteLength !== 32) throw new Error('Invalid Telegram encryption key');
  const decipher = createDecipheriv('aes-256-gcm', key, value.nonce);
  decipher.setAuthTag(value.tag);
  return Buffer.concat([
    decipher.update(value.ciphertext),
    decipher.final(),
  ]).toString('utf8');
}

export function registerTelegramSettingsRoutes(
  app: FastifyInstance,
  pool: Pool,
  tenantId: string,
  key: Uint8Array | null,
) {
  app.get('/api/v1/settings/telegram', async (request, reply) => {
    if (!request.authSession)
      return reply.code(401).send({ error: 'unauthorized' });
    try {
      const value = await database(pool).transaction(async (tx) => {
        await lockTenant(tx, tenantId);
        await requireAdministrator(tx, tenantId, request.authSession!.userId);
        const { rows } = await tx.execute<{
          chat_id: string;
          topic_id: string | null;
          enabled: boolean;
        }>(
          sql`SELECT chat_id, topic_id, enabled FROM telegram_settings WHERE tenant_id=${tenantId}`,
        );
        return rows[0];
      });
      return {
        configured: Boolean(value?.enabled),
        chatId: value?.chat_id ?? '',
        topicId: value?.topic_id ?? '',
      };
    } catch (error) {
      return reply
        .code(error instanceof AccessError ? 403 : 500)
        .send({ error: error instanceof AccessError ? 'forbidden' : 'failed' });
    }
  });
  app.put<{ Body: { botToken: string; chatId: string; topicId?: string } }>(
    '/api/v1/settings/telegram',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['botToken', 'chatId'],
          properties: {
            botToken: { type: 'string', minLength: 20, maxLength: 512 },
            chatId: { type: 'string', minLength: 1, maxLength: 128 },
            topicId: {
              type: 'string',
              maxLength: 15,
              pattern: '^([1-9][0-9]{0,14})?$',
            },
          },
        },
      },
    },
    async (request, reply) => {
      if (!request.authSession)
        return reply.code(401).send({ error: 'unauthorized' });
      if (!/^\d{5,15}:[A-Za-z0-9_-]{20,256}$/.test(request.body.botToken))
        return reply.code(400).send({ error: 'invalid_telegram_credentials' });
      try {
        await database(pool).transaction(async (tx) => {
          await lockTenant(tx, tenantId);
          await requireAdministrator(tx, tenantId, request.authSession!.userId);
          if (!key) throw new TelegramEncryptionUnavailable();
          const sealed = encryptTelegramToken(request.body.botToken, key);
          await tx.execute(sql`INSERT INTO telegram_settings(tenant_id, token_ciphertext, token_nonce, token_tag, chat_id, topic_id, enabled)
            VALUES(${tenantId},${sealed.ciphertext},${sealed.nonce},${sealed.tag},${request.body.chatId},${request.body.topicId || null},true)
            ON CONFLICT(tenant_id) DO UPDATE SET token_ciphertext=EXCLUDED.token_ciphertext, token_nonce=EXCLUDED.token_nonce, token_tag=EXCLUDED.token_tag, chat_id=EXCLUDED.chat_id, topic_id=EXCLUDED.topic_id, enabled=true, updated_at=now()`);
          await tx.execute(sql`UPDATE telegram_notification_jobs SET attempts=0, available_at=now()
            WHERE tenant_id=${tenantId} AND delivered_at IS NULL AND cancelled_at IS NULL AND locked_at IS NULL`);
        });
        return reply.code(204).send();
      } catch (error) {
        if (error instanceof TelegramEncryptionUnavailable)
          return reply
            .code(503)
            .send({ error: 'telegram_encryption_unavailable' });
        return reply.code(error instanceof AccessError ? 403 : 500).send({
          error: error instanceof AccessError ? 'forbidden' : 'failed',
        });
      }
    },
  );
  app.delete('/api/v1/settings/telegram', async (request, reply) => {
    if (!request.authSession)
      return reply.code(401).send({ error: 'unauthorized' });
    try {
      await database(pool).transaction(async (tx) => {
        await lockTenant(tx, tenantId);
        await requireAdministrator(tx, tenantId, request.authSession!.userId);
        await tx.execute(
          sql`UPDATE telegram_settings SET enabled=false, token_ciphertext=NULL, token_nonce=NULL, token_tag=NULL, updated_at=now() WHERE tenant_id=${tenantId}`,
        );
        await tx.execute(
          sql`UPDATE telegram_notification_jobs SET cancelled_at=now(), locked_at=NULL WHERE tenant_id=${tenantId} AND delivered_at IS NULL AND cancelled_at IS NULL`,
        );
      });
      return reply.code(204).send();
    } catch (error) {
      return reply
        .code(error instanceof AccessError ? 403 : 500)
        .send({ error: error instanceof AccessError ? 'forbidden' : 'failed' });
    }
  });
}

export function startTelegramNotifications(
  pool: Pool,
  key: Uint8Array,
  reportError: (failure: TelegramNotificationFailure) => void,
  fetcher: typeof fetch = fetch,
) {
  let pending: Promise<void> | null = null;
  const run = () => {
    if (pending) return;
    pending = (async () => {
      let client: PoolClient | null = null;
      try {
        client = await pool.connect();
        await client.query('BEGIN');
        const claim = await client.query<{
          tenant_id: string;
          inquiry_id: string;
          chat_id: string;
          topic_id: string | null;
          payload: unknown;
          token_ciphertext: Buffer;
          token_nonce: Buffer;
          token_tag: Buffer;
        }>(
          "WITH picked AS (SELECT j.tenant_id,j.inquiry_id FROM telegram_notification_jobs j WHERE j.delivered_at IS NULL AND j.cancelled_at IS NULL AND j.available_at <= now() AND (j.locked_at IS NULL OR j.locked_at < now()-interval '2 minutes') AND EXISTS (SELECT 1 FROM telegram_settings s WHERE s.tenant_id=j.tenant_id AND s.enabled) ORDER BY j.created_at FOR UPDATE SKIP LOCKED LIMIT 1) UPDATE telegram_notification_jobs j SET locked_at=now(), attempts=j.attempts+1 FROM picked p,telegram_settings s,website_inquiry_deliveries d WHERE j.tenant_id=p.tenant_id AND j.inquiry_id=p.inquiry_id AND s.tenant_id=j.tenant_id AND s.enabled AND d.tenant_id=j.tenant_id AND d.id=j.inquiry_id RETURNING j.tenant_id,j.inquiry_id,s.chat_id,s.topic_id,s.token_ciphertext,s.token_nonce,s.token_tag,d.payload",
        );
        await client.query('COMMIT');
        const job = claim.rows[0];
        if (!job) return;
        const retry = async (failure: TelegramNotificationFailure) => {
          reportError(failure);
          try {
            await client!.query(
              "UPDATE telegram_notification_jobs SET locked_at=NULL, available_at=now()+least(interval '6 hours', interval '15 seconds' * power(2,least(attempts,10))) WHERE tenant_id=$1 AND inquiry_id=$2 AND delivered_at IS NULL AND cancelled_at IS NULL",
              [job.tenant_id, job.inquiry_id],
            );
          } catch {
            reportError({ type: 'database', stage: 'schedule_retry' });
          }
        };
        let token: string;
        try {
          token = decryptTelegramToken(
            {
              ciphertext: job.token_ciphertext,
              nonce: job.token_nonce,
              tag: job.token_tag,
            },
            key,
          );
        } catch {
          await retry({ type: 'decryption' });
          return;
        }
        let response: Response;
        try {
          response = await fetcher(
            `https://api.telegram.org/bot${token}/sendMessage`,
            {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                chat_id: job.chat_id,
                ...(job.topic_id
                  ? { message_thread_id: Number(job.topic_id) }
                  : {}),
                text: renderWebsiteInquiryTelegramMessage(job.payload),
              }),
              signal: AbortSignal.timeout(10000),
              redirect: 'error',
            },
          );
        } catch (error) {
          await retry({
            type: 'network',
            category:
              error instanceof Error &&
              (error.name === 'AbortError' || error.name === 'TimeoutError')
                ? 'timeout'
                : 'request',
          });
          return;
        }
        let result: { ok?: boolean; error_code?: number };
        try {
          result = (await response.json()) as {
            ok?: boolean;
            error_code?: number;
          };
        } catch {
          await retry({
            type: 'malformed_response',
            httpStatus: response.status,
          });
          return;
        }
        if (!response.ok || result?.ok !== true) {
          await retry({
            type: 'telegram_rejected',
            httpStatus: response.status,
            ...(Number.isSafeInteger(result?.error_code) &&
            result.error_code! >= 100 &&
            result.error_code! <= 599
              ? { errorCode: result.error_code }
              : {}),
          });
          return;
        }
        try {
          await client.query(
            'UPDATE telegram_notification_jobs SET delivered_at=now(),locked_at=NULL WHERE tenant_id=$1 AND inquiry_id=$2',
            [job.tenant_id, job.inquiry_id],
          );
        } catch {
          reportError({ type: 'database', stage: 'mark_delivered' });
        }
      } catch {
        if (client) await client.query('ROLLBACK').catch(() => {});
        reportError({ type: 'database', stage: 'claim' });
      } finally {
        client?.release();
      }
    })().finally(() => {
      pending = null;
    });
  };
  run();
  const timer = setInterval(run, 5000);
  timer.unref();
  return {
    ready: () => true,
    stop: async () => {
      clearInterval(timer);
      await pending;
    },
  };
}
