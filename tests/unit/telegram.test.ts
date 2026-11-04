import { describe, expect, test, vi } from 'vitest';
import type { Pool } from 'pg';
import {
  decryptTelegramToken,
  encryptTelegramToken,
  telegramKeyFromSecret,
  startTelegramNotifications,
} from '../../packages/core/src/telegram.js';

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
