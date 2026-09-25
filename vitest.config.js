import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/setup.js'],
    include: ['tests/**/*.test.js'],
    environmentMatchGlobs: [
      ['tests/cardrush-extractor.test.js', 'jsdom'],
    ],
  },
});
