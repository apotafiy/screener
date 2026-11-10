import { defineConfig } from 'vite';
import { resolve } from 'node:path';

const src = (p: string) => resolve(__dirname, 'src', p);

export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    sourcemap: false,
    rollupOptions: {
      input: {
        content: src('content/index.ts'),
      },
      output: {
        entryFileNames: '[name].js',
        format: 'iife',
      },
    },
  },
});
