import { defineConfig } from 'vite';

// `base: './'` keeps the build relocatable (Vercel, GitHub Pages sub-path, or file hosting).
export default defineConfig({
  base: './',
  build: { target: 'es2022', chunkSizeWarningLimit: 900 },
  test: { include: ['tests/**/*.test.ts'] },
});
