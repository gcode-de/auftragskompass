import { afterEach, expect, test, vi } from 'vitest';
import type { Pool } from 'pg';
vi.mock('../../packages/core/src/reservations.js', () => ({
  expireReservations: vi.fn(),
}));
import { expireReservations } from '../../packages/core/src/reservations.js';
import { startReservationExpiry } from '../../packages/core/src/reservation-worker.js';
afterEach(() => {
  vi.useRealTimers();
  vi.resetAllMocks();
});
test('expiry worker retries failures, reports readiness and stops cleanly', async () => {
  vi.useFakeTimers();
  vi.mocked(expireReservations)
    .mockRejectedValueOnce(Error('synthetic offline'))
    .mockResolvedValue(0);
  const report = vi.fn(),
    worker = startReservationExpiry({} as Pool, report);
  await vi.advanceTimersByTimeAsync(0);
  expect(worker.ready()).toBe(false);
  expect(report).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(5000);
  expect(worker.ready()).toBe(true);
  await worker.stop();
  await vi.advanceTimersByTimeAsync(10000);
  expect(expireReservations).toHaveBeenCalledTimes(2);
});
test('slow expiry work never overlaps another tick and shutdown waits for completion', async () => {
  vi.useFakeTimers();
  let finish!: (value: number) => void;
  vi.mocked(expireReservations).mockImplementation(
    () =>
      new Promise<number>((resolve) => {
        finish = resolve;
      }),
  );
  const worker = startReservationExpiry({} as Pool, vi.fn());
  await vi.advanceTimersByTimeAsync(10000);
  expect(expireReservations).toHaveBeenCalledOnce();
  const stop = worker.stop();
  finish(0);
  await stop;
  expect(worker.ready()).toBe(true);
});
