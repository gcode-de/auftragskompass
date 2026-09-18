import Fastify from 'fastify';
// C005 only establishes the process boundary; runtime health follows in C007.
const app = Fastify({ logger: false });
await app.listen({ host: '0.0.0.0', port: 3000 });
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => void app.close());
