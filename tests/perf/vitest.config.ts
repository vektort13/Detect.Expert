import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Perf tests: cheap, generous budgets for hot validator paths (REQ-011). Run: pnpm test:perf
export default defineConfig({
  root: fileURLToPath(new URL('../..', import.meta.url)),
  test: {
    include: ['tests/perf/**/*.test.ts'],
    environment: 'node',
    passWithNoTests: false,
    testTimeout: 60_000,
  },
});
