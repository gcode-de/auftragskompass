import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  // Baked in at image build time, so the shown version matches the served bundle.
  define: {
    __AK_REVISION__: JSON.stringify(
      process.env.AK_BUILD_REVISION || 'development',
    ),
  },
  server: {
    host: '127.0.0.1',
    fs: {
      // The repository root also contains private material outside the app.
      strict: true,
      allow: [
        fileURLToPath(new URL('.', import.meta.url)),
        fileURLToPath(new URL('../../node_modules', import.meta.url)),
      ],
    },
  },
});
