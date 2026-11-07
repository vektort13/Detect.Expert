import { defineConfig } from 'vitest/config';

// Unit tests (Node). Extension tests live under tests/extension (Playwright), privacy/perf under tests/privacy, tests/perf.
export default defineConfig({
  test: {
    include: ['packages/**/*.test.ts', 'apps/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    environment: 'node',
    passWithNoTests: false,
  },
});
