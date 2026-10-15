import type { Pool } from 'pg';
import { expireReservations } from './reservations.js';
export function startReservationExpiry(pool: Pool, reportError: () => void) {
  let healthy = false,
    pending: Promise<void> | null = null;
  const run = () => {
    if (pending) return;
    pending = expireReservations(pool)
      .then(() => {
        healthy = true;
      })
      .catch(() => {
        healthy = false;
        reportError();
      })
      .finally(() => {
        pending = null;
      });
  };
  run();
  const timer = setInterval(run, 5000);
  timer.unref();
  return {
    ready: () => healthy,
    stop: async () => {
      clearInterval(timer);
      await pending;
    },
  };
}
