import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '../..');
writeFileSync(resolve(root, 'apps/production-extension/cookie-probe-contracts.js'), readFileSync(resolve(root, 'packages/contracts/src/cookie-probe.mjs'), 'utf8'));
