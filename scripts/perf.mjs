import { perfRunErrors, positiveCounts, waitForEvidence } from './measurement-checks.mjs';
// Perf A/B (REQ-011, spec A11 gate 5, VI I4 "no false precision", vertical slice §5, prerequisite of E02-02).
// Runs fixtures/perf-canvas-hot.html (1M measureText + 10k getImageData) in fresh Playwright Chromium
// persistent contexts with and without the test build, N runs each (interleaved), and reports median / p95 of
// the page-measured wall clock plus the overhead (ms and %) to tests/perf/results.json and stdout.
// Invalid measurements fail; no overhead pass/fail threshold yet (targets are proposed); a warning is printed above 5 %. The numbers are one
// machine, one Chromium build, page-side timers, n small: a trend, not a guarantee (spec VI I4).
// Usage: node scripts/perf.mjs [--runs N] [--no-build] [--headed]

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { startFixtureServer } from '../tests/fixture-server.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distTest = path.join(root, 'dist', 'test');
const resultsFile = process.env.DETECT_PERF_RESULTS ?? path.join(root, 'tests', 'perf', 'results.json');
const FIXTURE_HOST = '127.0.0.1';
const PROPOSED_MAX_OVERHEAD_PCT = 5;
const METRICS = ['measureTextMs', 'getImageDataMs', 'totalMs'];

function parseArgs(argv) {
  const out = { runs: 5, build: true, headed: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--runs') {
      i++;
      out.runs = Number(argv[i]);
    } else if (arg.startsWith('--runs=')) {
      out.runs = Number(arg.slice('--runs='.length));
    } else if (arg === '--no-build') {
      out.build = false;
    } else if (arg === '--headed') {
      out.headed = true;
    } else {
      console.error('perf: unknown argument ' + arg);
      process.exit(1);
    }
  }
  if (!Number.isInteger(out.runs) || out.runs < 1) {
    console.error('perf: --runs must be a positive integer');
    process.exit(1);
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));

function build(profile) {
  const result = spawnSync(process.execPath, [path.join(root, 'scripts', 'build.mjs'), '--profile', profile], { stdio: 'inherit' });
  if (result.status !== 0) {
    console.error('perf: build of profile "' + profile + '" failed');
    process.exit(1);
  }
}

function median(values) {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Nearest-rank p95; with n = 5 this is the maximum, which is stated in the results. */
function p95(values) {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.max(0, Math.ceil(0.95 * s.length) - 1)];
}

function round(value, digits = 2) {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

function summarize(values) {
  return { n: values.length, min: round(Math.min(...values)), median: round(median(values)), p95: round(p95(values)), max: round(Math.max(...values)) };
}

async function getServiceWorker(context) {
  const existing = context.serviceWorkers()[0];
  if (existing) return existing;
  return context.waitForEvent('serviceworker');
}

const STAND_SCRIPT_IDS = ['detector-isolated-v1', 'detector-main-v1'];

function coversStand(matches) {
  return matches.some((m) => m === 'http://' + FIXTURE_HOST + '/*' || m === '*://' + FIXTURE_HOST + '/*' || m === '<all_urls>' || m === 'http://*/*' || m === '*://*/*');
}

/** Same rule as tests/extension/helpers.ts ensureObserved: static test grant registered at startup, else ui-set-scope. */
async function ensureObserved(sw, ui) {
  await ui.evaluate((r) => chrome.runtime.sendMessage(r), { schemaVersion: 1, type: 'ui-get-scope' }); // awaits SW readiness
  const deadline = Date.now() + 10_000;
  for (;;) {
    const scripts = await sw.evaluate(async () => (await chrome.scripting.getRegisteredContentScripts()).map((s) => ({ id: s.id, matches: s.matches ?? [] })));
    const ids = scripts.filter((s) => coversStand(s.matches)).map((s) => s.id);
    if (STAND_SCRIPT_IDS.every((id) => ids.includes(id))) return { enabled: true, how: 'static test grant: ' + ids.join(',') + ' registered at startup' };
    if (Date.now() >= deadline) break;
    await ui.waitForTimeout(200);
  }
  const scope = await ui.evaluate((r) => chrome.runtime.sendMessage(r), { schemaVersion: 1, type: 'ui-set-scope', scopeMode: 'site', host: FIXTURE_HOST });
  const enabled = scope !== undefined && (scope.type === 'ok' || scope.type === 'scope');
  return { enabled, how: 'ui-set-scope site ' + FIXTURE_HOST + ' -> ' + JSON.stringify(scope) };
}

async function runOnce(mode, origin) {
  const userDataDir = mkdtempSync(path.join(os.tmpdir(), 'detect-expert-perf-'));
  const withExtension = mode === 'with';
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    headless: !args.headed,
    args: withExtension ? ['--disable-extensions-except=' + distTest, '--load-extension=' + distTest] : [],
  });
  try {
    let sw = null;
    let ui = null;
    let observation = null;
    if (withExtension) {
      sw = await getServiceWorker(context);
      ui = await context.newPage();
      await ui.goto('chrome-extension://' + new URL(sw.url()).host + '/popup.html');
      observation = await ensureObserved(sw, ui);
    }
    const page = await context.newPage();
    const url = origin + '/perf-canvas-hot.html';
    await page.goto(url);
    await page.waitForFunction(() => window.__fixtureResult !== undefined, undefined, { timeout: 60_000 });
    const cold = await page.evaluate(() => window.__fixtureResult);
    const warm = await page.evaluate(() => window.__runPerf());
    const userAgent = await page.evaluate(() => navigator.userAgent);
    const chromeVersion = (/Chrome\/([\d.]+)/.exec(userAgent) ?? [])[1] ?? 'unknown';
    let observed = null;
    if (withExtension && sw && ui) {
      const tabId = await sw.evaluate(async (prefix) => {
        const tabs = await chrome.tabs.query({});
        const hit = tabs.find((t) => typeof t.url === 'string' && t.url.startsWith(prefix));
        return hit && typeof hit.id === 'number' ? hit.id : -1;
      }, url);
      const response = await waitForEvidence(
        () => tabId >= 0 ? ui.evaluate((r) => chrome.runtime.sendMessage(r), { schemaVersion: 1, type: 'ui-get-report', tabId }) : null,
        (r) => r?.type === 'report' && positiveCounts(r.report?.techniques, ['DET-002', 'DET-003']),
      );
      const report = response && response.type === 'report' ? response.report : null;
      observed = report
        ? {
            coverageState: report.coverageState,
            counts: Object.fromEntries(report.techniques.map((t) => [t.techniqueId, t.count])),
            countQualities: Object.fromEntries(report.techniques.map((t) => [t.techniqueId, t.countQuality])),
          }
        : null;
    }
    const run = { mode, cold, warm, chromeVersion, observation, observed };
    const errors = perfRunErrors(run);
    if (errors.length) throw new Error('invalid perf run: ' + errors.join('; '));
    return run;
  } finally {
    await context.close();
    rmSync(userDataDir, { recursive: true, force: true, maxRetries: 3 });
  }
}

function table(rows) {
  const widths = rows[0].map((_, col) => Math.max(...rows.map((r) => String(r[col]).length)));
  for (const row of rows) console.log('  ' + row.map((cell, col) => String(cell).padEnd(widths[col])).join('  '));
}

async function main() {
  if (args.build) build('test');
  const server = await startFixtureServer();
  const origin = server.origins[0];
  const runs = [];
  try {
    for (let i = 0; i < args.runs; i++) {
      for (const mode of ['without', 'with']) {
        const run = await runOnce(mode, origin);
        runs.push({ index: i + 1, ...run });
        console.log('perf: run ' + String(i + 1) + '/' + String(args.runs) + ' ' + mode.padEnd(7) + ' warm total ' + String(run.warm.totalMs) + ' ms (measureText ' + String(run.warm.measureTextMs) + ', getImageData ' + String(run.warm.getImageDataMs) + ')');
      }
    }
  } finally {
    await server.close();
  }

  const warnings = [];
  const withRuns = runs.filter((r) => r.mode === 'with');
  const observationEnabled = withRuns.every((r) => r.observation !== null && r.observation.enabled);
  const observedAll = withRuns.every((r) => r.observed !== null && ['DET-002', 'DET-003'].every((id) => r.observed.counts[id] > 0));
  if (!observationEnabled) throw new Error('observation could not be enabled (' + (withRuns[0]?.observation?.how ?? 'unknown') + '): the "with" runs measure a loaded but idle extension, not active sensors');
  else if (!observedAll) throw new Error('no report with technique counts for the perf tab: the sensors did not observe the loop, so the overhead is not that of active wrappers');

  const metrics = {};
  const rows = [['metric', 'without median', 'with median', 'overhead ms', 'overhead %', 'without p95', 'with p95', 'p95 overhead ms', 'p95 overhead %']];
  for (const metric of METRICS) {
    const without = summarize(runs.filter((r) => r.mode === 'without').map((r) => r.warm[metric]));
    const withExt = summarize(withRuns.map((r) => r.warm[metric]));
    const overhead = {
      medianMs: round(withExt.median - without.median),
      medianPct: round(((withExt.median - without.median) / without.median) * 100),
      p95Ms: round(withExt.p95 - without.p95),
      p95Pct: round(((withExt.p95 - without.p95) / without.p95) * 100),
    };
    metrics[metric] = { without, with: withExt, overhead };
    rows.push([metric, without.median, withExt.median, overhead.medianMs, overhead.medianPct, without.p95, withExt.p95, overhead.p95Ms, overhead.p95Pct]);
    if (overhead.medianPct > PROPOSED_MAX_OVERHEAD_PCT) warnings.push(metric + ': median overhead ' + String(overhead.medianPct) + ' % exceeds the proposed ' + String(PROPOSED_MAX_OVERHEAD_PCT) + ' % target');
  }

  const cpus = os.cpus();
  const results = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    fixture: 'fixtures/perf-canvas-hot.html (1000000 measureText + 10000 getImageData, warm run after one cold run per context)',
    machine: { platform: process.platform, arch: process.arch, cpu: cpus[0]?.model ?? 'unknown', cpuCount: cpus.length, totalMemGiB: round(os.totalmem() / 1024 ** 3, 1), node: process.version },
    chromium: { version: runs[0]?.chromeVersion ?? 'unknown', harness: 'Playwright persistent context, channel chromium, headless=' + String(!args.headed) },
    extension: { version: JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version, profile: 'test', observationEnabled, observedBy: withRuns[0]?.observation?.how ?? null, sensorsObservedLoop: observedAll },
    method: { runsPerMode: args.runs, interleaved: true, statistic: 'median and nearest-rank p95 of page-side performance.now() deltas (with n=' + String(args.runs) + ' the p95 is the maximum)', threshold: 'none yet; proposed max median overhead ' + String(PROPOSED_MAX_OVERHEAD_PCT) + ' %' },
    metrics,
    runs: runs.map((r) => ({ index: r.index, mode: r.mode, cold: r.cold, warm: r.warm, observation: r.observation, observed: r.observed })),
    warnings,
  };
  writeFileSync(resultsFile, JSON.stringify(results, null, 2) + '\n');

  console.log('perf: ' + String(args.runs) + ' runs per mode, Chromium ' + results.chromium.version + ', ' + results.machine.cpu + ' x' + String(results.machine.cpuCount));
  table(rows);
  for (const w of warnings) console.warn('perf: WARNING: ' + w);
  console.log('perf: results written to ' + path.relative(root, resultsFile) + ' (no pass/fail threshold yet)');
}

await main();
