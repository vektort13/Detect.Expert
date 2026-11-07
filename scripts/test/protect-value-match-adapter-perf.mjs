// ADR-020 §15.8, REQ-011 / audit F3. Synthetic, repeatable bounded-prefix measurements; no production build writes.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { loadValueMatchAdapter, matcherFixture, request } from './protect-value-match-adapter-support.mjs';

const module = await loadValueMatchAdapter();
const max = module.PROTECT_BUDGETS.maxScannedBodyBytes;
const output = resolve(import.meta.dirname, '../../test-results/prod/reports/2026-10-20-protect-audit/value-match-perf.json');
const samples = 200;
const warmups = 50;
const ascii4MiB = 'a'.repeat(4 * 1024 * 1024);
const ascii16MiB = 'a'.repeat(16 * 1024 * 1024);
const unicode = 'é😀'.repeat(700000);
// Prepare owned strings before measuring the callback (including engine rope flattening).
ascii4MiB.charCodeAt(ascii4MiB.length - 1);
ascii16MiB.charCodeAt(ascii16MiB.length - 1);
unicode.charCodeAt(unicode.length - 1);
const cases = [
  ['form-1KiB', request({ formData: { note: ['a'.repeat(1024)] } })],
  ['form-exact64KiB', request({ formData: { note: ['a'.repeat(max - 4)] } })],
  ['form-4MiB', request({ formData: { note: [ascii4MiB] } })],
  ['form-16MiB', request({ formData: { note: [ascii16MiB] } })],
  ['form-unicode', request({ formData: { note: [unicode] } })],
  ['form-key-4MiB', request({ formData: { [ascii4MiB]: ['unused'] } })],
  ['form-key-16MiB', request({ formData: { [ascii16MiB]: ['unused'] } })],
  ['json-truncated', request(JSON.stringify({ password: 'synthetic-perf-canary', note: ' '.repeat(max * 4) }))],
];

function measure(fn) {
  for (let i = 0; i < warmups; i++) fn();
  const times = [];
  for (let i = 0; i < samples; i++) {
    const started = performance.now();
    fn();
    times.push(performance.now() - started);
  }
  times.sort((a, b) => a - b);
  const round = value => +value.toFixed(4);
  return { medianMs: round(times[Math.floor(samples / 2)]), p95Ms: round(times[Math.floor(samples * 0.95)]), maxMs: round(times.at(-1)) };
}

const measurements = [];
for (const [name, details] of cases) {
  const result = module.requestViews(details);
  assert.ok(result.bodyBytes <= max);
  const decodeAndTokenize = measure(() => {
    const decoded = module.requestViews(details);
    for (const view of decoded.views) module.scanTokens(view.text, () => true);
  });
  const fixture = matcherFixture(module);
  const resolved = {
    requestId: 'perf', tabId: 7, frameId: 0, documentKey: null, topDocumentKey: null,
    topSite: 'shop.example.com', frameContext: 'top', frameSite: null, receiver: 'example.org',
    receiverCategory: null, relation: 'cross-site', method: 'POST', requestKind: 'fetch-xhr',
    initiatorSite: 'shop.example.com', timeStamp: 1000,
  };
  const matcherCallback = measure(() => fixture.matcher.onRequest(details, { resolved }));
  measurements.push({ name, inspectedBytes: result.bodyBytes, inspectedCodeUnits: result.bodyChars, ringSafe: result.ringSafe, limitations: [...result.limitations], decodeAndTokenize, matcherCallback });
}
const report = {
  at: new Date().toISOString(), node: process.version, platform: process.platform, arch: process.arch,
  budgetBytes: max, samples, warmups,
  scope: 'Synthetic SW decoder + tokenization and no-index matcher callback. Input allocation, browser delivery and string preparation are outside timing. No claim about full extension overhead; no timing pass threshold.',
  measurements,
};
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
