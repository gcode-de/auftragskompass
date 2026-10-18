import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
export default defineConfig({
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: {
    minify: true,
    lib: {
      entry: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
      formats: ['es'],
      fileName: 'inquiry-widget',
      cssFileName: 'inquiry-widget',
    },
  },
});
