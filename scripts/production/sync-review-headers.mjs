import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { patchResponseHeaderAllowlist, patchResponseHeaderExplanations } from './review-header-plan.mjs';
const root = resolve(import.meta.dirname, '../../apps/production-extension'), check = process.argv.includes('--check');
for (const name of ['background.js', 'popup.js', 'sidepanel.js', 'report.js', 'pro-report-tables.js']) {
  const file = resolve(root, name), before = readFileSync(file, 'utf8'); let source = before;
  if (name !== 'pro-report-tables.js') source = patchResponseHeaderAllowlist(source, { expectedCount: name === 'report.js' ? 2 : 1 });
  if (name !== 'background.js') source = patchResponseHeaderExplanations(source);
  if (check && source !== before) throw Error(name + ': header sync required');
  if (!check && source !== before) writeFileSync(file, source);
}
console.log((check ? 'checked' : 'synchronized') + ' response header names');
