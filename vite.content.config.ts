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
        gate: src('content/gate.ts'),
      },
      output: {
        entryFileNames: '[name].js',
        format: 'iife',
      },
    },
  },
});
