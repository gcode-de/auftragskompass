import { writeFileSync } from 'node:fs';
// Process heartbeat only; no jobs or business schema before the relevant slices.
const heartbeat = () =>
  writeFileSync('/tmp/ak-worker-heartbeat', String(Date.now()));
heartbeat();
const timer = setInterval(heartbeat, 1000);
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => {
    clearInterval(timer);
  });
