import { defineConfig } from '@playwright/test';

// Extension tests: chromium.launchPersistentContext with channel 'chromium' and dist/test loaded through
// --disable-extensions-except/--load-extension (see harness.ts). Run: pnpm test:extension
export default defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.ts$/,
  outputDir: '../../test-results/extension',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
});
