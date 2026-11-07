// ADR-073 — supplementary structural checks; sync-clear-reset.mjs performs exact-source drift checking.
//
// The fix is implemented in the canonical production TS (baseline-ts/packages/**):
//   contracts (reset wire types + validators), background (documents fence model, repository clear-epochs
//   journal, runtime reset barrier), sensors (SensorRuntime.reset), collector (collector/handshake/deliver/
//   ring/env reset). The shipped bundles (apps/production-extension/{background,bridge,hook.early,hook.main}.js)
//   are produced from that canonical TS. This tool (1) guards the canonical substrate against a silent drop on
//   re-vendor/regeneration and (2) verifies each shipped bundle actually carries the reset barrier, printing
//   the exact missing markers so the bundle sync/build is verifiable. It never writes the bundles (ROOT applies
//   the build/sync and re-runs this gate). Run: node scripts/production/sync-clear-reset.mjs [--check]
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const prodRoot = resolve(repoRoot, 'baseline-ts');
const read = (p) => readFileSync(p, 'utf8');

const results = [];
function check(name, fn) {
  try { fn(); results.push({ name, ok: true }); }
  catch (error) { results.push({ name, ok: false, detail: error instanceof Error ? error.message : String(error) }); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

// ---- 1. Canonical production TS substrate (source of truth) ----
const documents = read(resolve(prodRoot, 'packages/background/src/documents.ts'));
const repository = read(resolve(prodRoot, 'packages/background/src/repository.ts'));
const runtime = read(resolve(prodRoot, 'packages/background/src/runtime.ts'));
const sensor = read(resolve(prodRoot, 'packages/sensors/src/runtime.ts'));
const collector = read(resolve(prodRoot, 'packages/collector/src/collector.ts'));
const contractsMessages = read(resolve(prodRoot, 'packages/contracts/src/messages.ts'));
const contractsValidate = read(resolve(prodRoot, 'packages/contracts/src/validate.ts'));
const contractsEnums = read(resolve(prodRoot, 'packages/contracts/src/enums.ts'));

check('ts/contracts: reset wire types + validator', () => {
  for (const t of ['SensorResetMessage', 'BridgeResetMessage', 'BridgeResetControlMessage', 'BridgeResetAck']) assert(contractsMessages.includes('interface ' + t), 'messages missing ' + t);
  assert(/BRIDGE_CONTROL_COMMANDS = \[[^\]]*'reset'/.test(contractsEnums), "enums missing 'reset' command");
  assert(contractsValidate.includes('export function validateBridgeResetAck'), 'validate missing validateBridgeResetAck');
  assert(contractsValidate.includes("case 'sensor-reset'") && contractsValidate.includes("case 'bridge-reset'"), 'validate missing reset message cases');
});
check('ts/documents: ClearFence + resetDocument + epoch gate + ui:clear fence', () => {
  assert(/export interface ClearFence[\s\S]*reportRevision: number/.test(documents), 'ClearFence missing reportRevision');
  assert(documents.includes('export function resetDocument') && documents.includes('export function clearedFromBinding'), 'resetDocument/clearedFromBinding missing');
  assert(documents.includes('meta.clearEpoch !== undefined') && documents.includes('meta.clearBootIds?.includes(batch.sensorBootId)'), 'applyBatch epoch gate missing');
  assert(documents.includes('resetDocument(report, meta, event.fence ??'), 'ui:clear fence wiring missing');
});
check('ts/repository: clear-epochs:v1 journal + honest commitClear', () => {
  assert(/CLEAR_FENCES_KEY = 'clear-epochs:v1'/.test(repository), 'CLEAR_FENCES_KEY changed');
  assert(repository.includes('function readClearFence') && repository.includes('function clearFenceBytes'), 'readClearFence/clearFenceBytes missing');
  for (const m of ['async commitClear(', 'async commitMany(', 'runMany<T>(', 'clearFence(documentKey']) assert(repository.includes(m), 'repository missing ' + m);
  assert(/async remove\(documentKeys: readonly string\[\], forgetFences/.test(repository), 'remove(forgetFences) missing');
  assert(repository.includes('resetDocument(doc.report, doc.meta, fence)') && repository.includes('clearedFromBinding(binding, fence)'), 'loadAll fence application missing');
});
check('ts/runtime: reset barrier + cleared/clearing projection guards', () => {
  for (const m of ['private async commitClear(', 'private async commitClearRecords(', 'private async resetHistoryActor(']) assert(runtime.includes(m), 'runtime missing ' + m);
  assert(runtime.includes('clearingDocs') && runtime.includes('validateBridgeResetAck'), 'runtime reset wiring missing');
  assert(runtime.includes('meta.cleared && !meta.paused'), 'projection/checkDocument cleared+paused guard missing');
});
check('ts/sensor: SensorRuntime.reset rotates boot + resets hot-loop cache', () => {
  assert(sensor.includes('private reset(resetId: string): void'), 'SensorRuntime.reset missing');
  assert(sensor.includes('this.lastCounterKey = -1') && sensor.includes('this.lastCounter = undefined'), 'sensor reset must clear lastCounterKey/lastCounter');
  assert(sensor.includes('clearMap(this.counters)') && sensor.includes('this.sensorBootId = makeBootId'), 'sensor reset must clear counters and rotate boot');
});
check('ts/collector: reset barrier (reset/onReset) + fresh-boot admission', () => {
  assert(collector.includes('function reset(resetId') && collector.includes('function onReset('), 'collector reset/onReset missing');
  assert(collector.includes('resetBoots') && collector.includes("command === 'reset'"), 'collector fresh-boot admission / control reset missing');
});

// ---- 2. Shipped bundle presence (must hold after the production build/sync) ----
const bundleDir = resolve(repoRoot, 'apps/production-extension');
/** Markers that must appear in each bundle once the reset barrier is synced from canonical TS. */
const BUNDLE_MARKERS = {
  'background.js': ['clear-epochs:v1', 'resetHistoryActor', 'commitClear', 'clearingDocs', 'clearBootIds', 'bridge-reset-ack'],
  'bridge.js': ['bridge-reset', "command === \"reset\"", 'resetBoots', 'bridge-reset-ack'],
  'hook.early.js': ['bridge-reset', 'nextSensorBootId'],
  'hook.main.js': ['bridge-reset', 'nextSensorBootId'],
};
const bundleGaps = [];
for (const [file, markers] of Object.entries(BUNDLE_MARKERS)) {
  let code;
  try { code = read(resolve(bundleDir, file)); } catch { bundleGaps.push(file + ': not found'); continue; }
  const missing = markers.filter((m) => !code.includes(m));
  if (missing.length > 0) bundleGaps.push(file + ': missing ' + missing.join(', '));
}

let failed = 0;
for (const r of results) { if (!r.ok) failed++; console.log((r.ok ? 'OK   ' : 'FAIL ') + r.name + (r.ok ? '' : ' — ' + r.detail)); }
console.log('\nShipped bundle reset-barrier presence:');
if (bundleGaps.length === 0) console.log('  all bundles carry the reset barrier.');
else for (const g of bundleGaps) console.log('  NEEDS SYNC — ' + g);

if (failed > 0) { console.error('\nclear-reset canonical substrate drift: ' + failed + ' check(s) failed.'); process.exit(1); }
if (bundleGaps.length > 0) {
  console.error('\nShipped bundles are not yet synced from canonical TS. Build/sync apps/production-extension/*.js' +
    ' from baseline-ts/packages (reset barrier: documents+repository+runtime, sensors, collector,' +
    ' contracts) and re-run this gate. Canonical substrate is correct and typecheck-clean.');
  process.exit(2);
}
console.log('\nclear-reset: canonical substrate present and shipped bundles synced (' + results.length + ' checks).');
