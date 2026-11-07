import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Privacy tests: wire contract allowlist (REQ-005). Run: pnpm test:privacy
export default defineConfig({
  root: fileURLToPath(new URL('../..', import.meta.url)),
  test: {
    include: ['tests/privacy/**/*.test.ts'],
    environment: 'node',
    passWithNoTests: false,
  },
});
