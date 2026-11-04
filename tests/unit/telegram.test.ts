import { describe, expect, test, vi } from 'vitest';
import type { Pool } from 'pg';
import {
  decryptTelegramToken,
  encryptTelegramToken,
  telegramKeyFromSecret,
  startTelegramNotifications,
} from '../../packages/core/src/telegram.js';

function claimedJobPool(failedUpdate: 'delivered' | 'retry') {
  const key = Buffer.alloc(32, 51);
  const sealed = encryptTelegramToken(
    '123456:abcdefghijklmnopqrstuvwxyz_ABCDEF',
    key,
  );
  const job = {
    tenant_id: '11111111-1111-4111-8111-111111111111',
    inquiry_id: '22222222-2222-4222-8222-222222222222',
    chat_id: 'fictional-chat',
    token_ciphertext: sealed.ciphertext,
    token_nonce: sealed.nonce,
    token_tag: sealed.tag,
  };
  const client = {
    query: vi.fn(async (query: string) => {
      if (query.startsWith('WITH picked')) return { rows: [job] };
      if (
        failedUpdate === 'delivered' &&
        query.startsWith('UPDATE telegram_notification_jobs SET delivered_at')
      )
        throw new Error('fictional database detail');
      if (
        failedUpdate === 'retry' &&
        query.startsWith('UPDATE telegram_notification_jobs SET locked_at=NULL')
      )
        throw new Error('fictional database detail');
      return { rows: [] };
    }),
    release: vi.fn(),
  };
  return {
    key,
    client,
    pool: { connect: vi.fn().mockResolvedValue(client) } as unknown as Pool,
  };
}

describe('Telegram token encryption', () => {
  test('round trips with the provisioned 256-bit key and authenticates ciphertext', () => {
    const key = telegramKeyFromSecret('ab'.repeat(32));
    const sealed = encryptTelegramToken(
      '123456:abcdefghijklmnopqrstuvwxyz_ABCDEF',
      key,
    );
    expect(sealed.ciphertext.toString()).not.toContain('123456:');
    expect(decryptTelegramToken(sealed, key)).toBe(
      '123456:abcdefghijklmnopqrstuvwxyz_ABCDEF',
    );
    expect(() =>
      decryptTelegramToken({ ...sealed, tag: Buffer.alloc(16) }, key),
    ).toThrow();
  });

  test('rejects malformed or undersized provisioning keys', () => {
    expect(() => telegramKeyFromSecret('secret')).toThrow();
    expect(() => encryptTelegramToken('token', Buffer.alloc(16))).toThrow();
    const sealed = encryptTelegramToken('token', Buffer.alloc(32));
    expect(() => decryptTelegramToken(sealed, Buffer.alloc(16))).toThrow();
  });

  test('reports database connection failures without an unhandled worker rejection', async () => {
    const reportError = vi.fn();
    const pool = {
      connect: vi.fn().mockRejectedValue(new Error('offline')),
    } as unknown as Pool;
    const worker = startTelegramNotifications(
      pool,
      Buffer.alloc(32),
      reportError,
    );
    try {
      await vi.waitFor(() => expect(reportError).toHaveBeenCalledOnce());
      expect(reportError).toHaveBeenCalledWith({
        type: 'database',
        stage: 'claim',
      });
    } finally {
      await worker.stop();
    }
  });

  test('rolls back and reports a claimed-cycle query failure', async () => {
    const reportError = vi.fn();
    const client = {
      query: vi.fn().mockRejectedValue(new Error('database unavailable')),
      release: vi.fn(),
    };
    const pool = {
      connect: vi.fn().mockResolvedValue(client),
    } as unknown as Pool;
    const worker = startTelegramNotifications(
      pool,
      Buffer.alloc(32),
      reportError,
    );
    try {
      await vi.waitFor(() => expect(reportError).toHaveBeenCalledOnce());
      expect(client.release).toHaveBeenCalledOnce();
      expect(client.query).toHaveBeenCalledWith('ROLLBACK');
      expect(reportError).toHaveBeenCalledWith({
        type: 'database',
        stage: 'claim',
      });
    } finally {
      await worker.stop();
    }
  });

  test('classifies a delivered-status database failure without retrying the send immediately', async () => {
    const { pool, key, client } = claimedJobPool('delivered');
    const reportError = vi.fn();
    const worker = startTelegramNotifications(
      pool,
      key,
      reportError,
      async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    try {
      await vi.waitFor(() => expect(reportError).toHaveBeenCalledOnce());
      expect(reportError).toHaveBeenCalledWith({
        type: 'database',
        stage: 'mark_delivered',
      });
      expect(
        client.query.mock.calls.filter(([query]) =>
          query.startsWith(
            'UPDATE telegram_notification_jobs SET locked_at=NULL',
          ),
        ),
      ).toHaveLength(0);
      expect(JSON.stringify(reportError.mock.calls)).not.toContain(
        'fictional database detail',
      );
    } finally {
      await worker.stop();
    }
  });

  test('reports retry-scheduling database failures separately from the request failure', async () => {
    const { pool, key } = claimedJobPool('retry');
    const reportError = vi.fn();
    const worker = startTelegramNotifications(
      pool,
      key,
      reportError,
      async () => {
        throw new TypeError('fictional request detail');
      },
    );
    try {
      await vi.waitFor(() => expect(reportError).toHaveBeenCalledTimes(2));
      expect(reportError.mock.calls.map(([failure]) => failure)).toEqual([
        { type: 'network', category: 'request' },
        { type: 'database', stage: 'schedule_retry' },
      ]);
      expect(JSON.stringify(reportError.mock.calls)).not.toContain(
        'fictional request detail',
      );
      expect(JSON.stringify(reportError.mock.calls)).not.toContain(
        'fictional database detail',
      );
    } finally {
      await worker.stop();
    }
  });

  test('leaves an empty queue idle without reporting a failure', async () => {
    const reportError = vi.fn();
    const client = {
      query: vi.fn(async () => ({ rows: [] })),
      release: vi.fn(),
    };
    const pool = {
      connect: vi.fn().mockResolvedValue(client),
    } as unknown as Pool;
    const worker = startTelegramNotifications(
      pool,
      Buffer.alloc(32),
      reportError,
    );
    try {
      await vi.waitFor(() =>
        expect(client.query).toHaveBeenCalledWith('COMMIT'),
      );
      expect(reportError).not.toHaveBeenCalled();
    } finally {
      await worker.stop();
    }
  });

  test('does not start overlapping queue cycles', async () => {
    vi.useFakeTimers();
    const client = {
      query: vi.fn(async () => ({ rows: [] as never[] })),
      release: vi.fn(),
    };
    let release!: (value: typeof client) => void;
    const pool = {
      connect: vi.fn(
        () =>
          new Promise<typeof client>((resolve) => {
            release = resolve;
          }),
      ),
    } as unknown as Pool;
    const worker = startTelegramNotifications(pool, Buffer.alloc(32), vi.fn());
    try {
      await vi.advanceTimersByTimeAsync(5000);
      expect(pool.connect).toHaveBeenCalledOnce();
      release(client);
      await vi.waitFor(() => expect(client.release).toHaveBeenCalledOnce());
    } finally {
      await worker.stop();
      vi.useRealTimers();
    }
  });
});
