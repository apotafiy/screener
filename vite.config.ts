import { defineConfig } from 'vite';
import { resolve } from 'node:path';

const src = (p: string) => resolve(__dirname, 'src', p);

export default defineConfig({
  root: 'src',
  publicDir: '../public',
  base: './',
  esbuild: { jsx: 'automatic' },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    sourcemap: false,
    modulePreload: { polyfill: false },
    rollupOptions: {
      input: {
        'service-worker': src('background/service-worker.ts'),
        'options/options': src('options/options.html'),
        'popup/popup': src('popup/popup.html'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name].js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
});
