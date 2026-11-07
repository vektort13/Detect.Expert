// Runs the registered native tests (scripts/test/native-suites.mjs) one at a time and writes
// test-results/production-<manifest version>/natives-summary.{json,md} plus one log per run under natives-logs/.
//
// node scripts/run-natives.mjs [--group all|<group>[,<group>]] [--browser chrome,firefox] [--gate release|suite]
//                              [--only <file>[,<file>]] [--include-manual] [--continue] [--last-failed] [--list]
//                              [--timeout <minutes>]
//
//   --group           groups from NATIVE_GROUPS, or all (default)
//   --browser         chrome and/or firefox (default both); entries that do not support a browser are not run for it
//   --gate            only entries of this gate (manual entries are never selected by gate)
//   --only            exactly these files (manual ones included); package checks only when named
//   --include-manual  also start manual entries of the selected groups
//   --continue        keep going after a failure (default: stop, the rest is reported as not-run)
//   --last-failed     re-run only the runs that did not pass in the previous summary; the summary is updated in place
//   --list            print the plan and exit
//   --timeout         minutes per run (default: the entry's timeoutMinutes, else 20)
//
// The runner never builds: natives test dist/<browser> (the lead's build). It records whether dist predates the newest
// production source file, so a stale package is visible next to the results. Exit code 1 if any selected run failed,
// timed out or was not run.
import { spawn, spawnSync } from 'node:child_process';
import { createWriteStream, existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { NATIVE_BROWSERS, NATIVE_GATES, NATIVE_GROUPS, NATIVE_SUITES, browsersOf } from './test/native-suites.mjs';
import { ROOT, evidenceDirectory, evidencePath, productionVersion, writeEvidence } from './test/native-evidence.mjs';

export const SUMMARY_JSON = 'natives-summary.json', SUMMARY_MD = 'natives-summary.md', LOG_DIRECTORY = 'natives-logs';
const DEFAULT_TIMEOUT_MINUTES = 20, TAIL_LINES = 40, LOG_LIMIT = 8 * 1024 * 1024;
const PASSING = new Set(['pass']), RERUN = new Set(['fail', 'timeout', 'not-run', 'error']);

const list = value => value.split(',').map(item => item.trim()).filter(Boolean);
export function parseArguments(argv) {
  const options = { groups: [...NATIVE_GROUPS], browsers: [...NATIVE_BROWSERS], gate: null, only: null, includeManual: false, continueOnFailure: false, lastFailed: false, listOnly: false, timeoutMinutes: null };
  const value = (index, name) => { const next = argv[index + 1]; if (next === undefined || next.startsWith('--')) throw new Error(name + ' needs a value'); return next; };
  for (let index = 0; index < argv.length; index++) {
    const name = argv[index];
    if (name === '--group') { const raw = value(index++, name); options.groups = raw === 'all' ? [...NATIVE_GROUPS] : list(raw); }
    else if (name === '--browser') options.browsers = list(value(index++, name));
    else if (name === '--gate') options.gate = value(index++, name);
    else if (name === '--only') options.only = list(value(index++, name));
    else if (name === '--timeout') options.timeoutMinutes = Number(value(index++, name));
    else if (name === '--include-manual') options.includeManual = true;
    else if (name === '--continue') options.continueOnFailure = true;
    else if (name === '--last-failed') options.lastFailed = true;
    else if (name === '--list') options.listOnly = true;
    else throw new Error('unknown argument ' + name);
  }
  for (const group of options.groups) if (!NATIVE_GROUPS.includes(group)) throw new Error('unknown group ' + group + ' (known: ' + NATIVE_GROUPS.join(', ') + ')');
  for (const browser of options.browsers) if (!NATIVE_BROWSERS.includes(browser)) throw new Error('unknown browser ' + browser);
  if (!options.browsers.length || !options.groups.length) throw new Error('empty --browser or --group');
  if (options.gate !== null && (!NATIVE_GATES.includes(options.gate) || options.gate === 'manual')) throw new Error('--gate must be release or suite');
  if (options.timeoutMinutes !== null && !(options.timeoutMinutes > 0 && options.timeoutMinutes <= 240)) throw new Error('--timeout must be 1..240 minutes');
  if (options.only) for (const file of options.only) if (!NATIVE_SUITES.some(item => item.file === file)) throw new Error('--only: ' + file + ' is not registered in scripts/test/native-suites.mjs');
  return options;
}

export const runKey = step => step.file + '|' + (step.browser ?? 'package');

// Ordered steps: natives in registry order, then the package checks of the selected groups.
export function buildPlan(options, registry = NATIVE_SUITES, previous = null) {
  const steps = [];
  for (const item of registry) {
    const named = options.only?.includes(item.file) ?? false;
    if (options.only ? !named : !options.groups.includes(item.group)) continue;
    if (item.kind === 'package') {
      if (options.only ? named : options.gate === null || item.gate === options.gate) steps.push({ file: item.file, browser: null, kind: 'package', group: item.group, gate: item.gate, args: [...item.args], timeoutMinutes: item.timeoutMinutes ?? null });
      continue;
    }
    if (!named && options.gate !== null && item.gate !== options.gate) continue;
    for (const browser of browsersOf(item).filter(browser => options.browsers.includes(browser))) {
      const step = { file: item.file, browser, kind: 'native', group: item.group, gate: item.gate, args: [...item.run[browser]], timeoutMinutes: item.timeoutMinutes ?? null };
      if (item.gate === 'manual' && !named && !options.includeManual) Object.assign(step, { skip: true, reason: item.reason });
      steps.push(step);
    }
  }
  if (!options.lastFailed) return steps;
  if (!previous) throw new Error('--last-failed needs a previous ' + SUMMARY_JSON);
  const before = new Map(previous.results.map(result => [runKey(result), result.status]));
  return steps.filter(step => !step.skip && (RERUN.has(before.get(runKey(step))) || step.kind === 'package' && before.get(runKey(step)) !== 'pass'));
}

function newestSource(directory) {
  let newest = { file: null, time: 0 };
  const walk = path => {
    for (const name of readdirSync(path)) {
      const full = join(path, name), stat = statSync(full);
      if (stat.isDirectory()) walk(full); else if (stat.mtimeMs > newest.time) newest = { file: relative(ROOT, full).replaceAll('\\', '/'), time: stat.mtimeMs };
    }
  };
  walk(directory);
  return newest;
}
export function distFreshness(browsers) {
  const source = newestSource(join(ROOT, 'apps/production-extension'));
  return Object.fromEntries(browsers.map(browser => {
    const manifest = join(ROOT, 'dist', browser, 'manifest.json');
    if (!existsSync(manifest)) return [browser, { exists: false, stale: true }];
    const built = statSync(manifest).mtimeMs, version = JSON.parse(readFileSync(manifest, 'utf8')).version;
    return [browser, { exists: true, version, builtAt: new Date(built).toISOString(), newestSource: source.file, newestSourceAt: new Date(source.time).toISOString(), stale: source.time > built }];
  }));
}

function killTree(child) {
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
  else try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
}

function execute(step, logFile, timeoutMinutes) {
  return new Promise(done => {
    const started = Date.now(), log = createWriteStream(logFile), tail = [];
    let partial = '', written = 0, truncated = false, timedOut = false;
    log.write('$ node scripts/test/' + step.file + (step.args.length ? ' ' + step.args.join(' ') : '') + '\n');
    const child = spawn(process.execPath, [join(ROOT, 'scripts/test', step.file), ...step.args], { cwd: ROOT, env: process.env, windowsHide: true, detached: process.platform !== 'win32' });
    current = child;
    const sink = (chunk, stream) => {
      stream.write(chunk);
      if (written < LOG_LIMIT) { log.write(chunk); written += chunk.length; } else if (!truncated) { truncated = true; log.write('\n[log truncated at ' + LOG_LIMIT + ' bytes]\n'); }
      const lines = (partial + chunk.toString('utf8')).split(/\r?\n/u); partial = lines.pop() ?? '';
      for (const line of lines) { tail.push(line.slice(0, 500)); if (tail.length > TAIL_LINES) tail.shift(); }
    };
    child.stdout.on('data', chunk => sink(chunk, process.stdout));
    child.stderr.on('data', chunk => sink(chunk, process.stderr));
    const timer = setTimeout(() => { timedOut = true; killTree(child); }, timeoutMinutes * 60000);
    const finish = (code, signal, error) => {
      clearTimeout(timer); current = null;
      if (partial) { tail.push(partial.slice(0, 500)); if (tail.length > TAIL_LINES) tail.shift(); }
      log.end(() => done({ status: error ? 'error' : timedOut ? 'timeout' : code === 0 ? 'pass' : 'fail', exitCode: code, signal: signal ?? null, durationMs: Date.now() - started, tail, ...(error ? { error: String(error.message ?? error) } : {}) }));
    };
    child.on('error', error => finish(null, null, error));
    child.on('close', (code, signal) => finish(code, signal, null));
  });
}

const minutes = ms => (ms / 60000).toFixed(1) + ' min';
export function renderMarkdown(summary) {
  const counts = summary.totals, lines = [
    '# Native tests ' + summary.version, '',
    'Started ' + summary.startedAt + ', finished ' + (summary.finishedAt ?? '(running)') + '. Command: `' + summary.command.join(' ') + '`.', '',
    '| Result | Count |', '| --- | --- |', ...Object.entries(counts).map(([key, value]) => '| ' + key + ' | ' + value + ' |'), '',
    '## Packages tested', '',
    ...Object.entries(summary.dist).map(([browser, facts]) => '- ' + browser + ': ' + (facts.exists ? 'dist/' + browser + ' ' + facts.version + ' built ' + facts.builtAt + (facts.stale ? ' — OLDER than ' + facts.newestSource + ' (' + facts.newestSourceAt + '): rebuild before trusting a pass' : ' — newer than every production source file') : 'dist/' + browser + ' is missing')),
    '', '## Runs', '', '| Native | Browser | Group | Gate | Result | Time | Log |', '| --- | --- | --- | --- | --- | --- | --- |',
    ...summary.results.map(result => '| ' + result.file + ' | ' + (result.browser ?? 'package') + ' | ' + result.group + ' | ' + result.gate + ' | ' + result.status + (result.reason ? ' (' + result.reason + ')' : '') + ' | ' + (result.durationMs === undefined ? '' : minutes(result.durationMs)) + ' | ' + (result.log ?? '') + ' |'),
  ];
  const failed = summary.results.filter(result => ['fail', 'timeout', 'error'].includes(result.status));
  if (failed.length) {
    lines.push('', '## Failures', '');
    for (const result of failed) lines.push('### ' + result.file + ' (' + (result.browser ?? 'package') + ') — ' + result.status, '', '```text', ...(result.tail ?? []).slice(-15), '```', '');
  }
  return lines.join('\n') + '\n';
}

const tally = results => Object.fromEntries(['pass', 'fail', 'timeout', 'error', 'not-run', 'skipped'].map(status => [status, results.filter(result => result.status === status).length]));

let current = null;
async function main() {
  const options = parseArguments(process.argv.slice(2));
  const version = productionVersion(), summaryPath = evidencePath(SUMMARY_JSON);
  const previous = existsSync(summaryPath) ? JSON.parse(readFileSync(summaryPath, 'utf8')) : null;
  const plan = buildPlan(options, NATIVE_SUITES, previous);
  if (options.listOnly) {
    for (const step of plan) console.log((step.skip ? 'skip ' : 'run  ') + step.file + ' ' + (step.browser ?? 'package') + (step.args.length ? ' ' + step.args.join(' ') : '') + (step.skip ? '  (manual: ' + step.reason + ')' : ''));
    console.log(plan.filter(step => !step.skip).length + ' run(s), ' + plan.filter(step => step.skip).length + ' manual skip(s)');
    return 0;
  }
  if (!plan.some(step => !step.skip)) { console.log('run-natives: nothing to run'); return 0; }
  evidenceDirectory(LOG_DIRECTORY);
  const browsers = [...new Set(plan.map(step => step.browser).filter(Boolean))];
  const kept = options.lastFailed ? previous.results.filter(result => !plan.some(step => runKey(step) === runKey(result))) : [];
  const summary = { schema: 1, version, startedAt: new Date().toISOString(), finishedAt: null, command: ['node', 'scripts/run-natives.mjs', ...process.argv.slice(2)], node: process.version,
    selection: { groups: options.groups, browsers: options.browsers, gate: options.gate, only: options.only, includeManual: options.includeManual, continueOnFailure: options.continueOnFailure, lastFailed: options.lastFailed },
    dist: distFreshness(browsers.length ? browsers : options.browsers), results: [], totals: {} };
  for (const [browser, facts] of Object.entries(summary.dist)) if (facts.stale) console.warn('run-natives: WARNING dist/' + browser + (facts.exists ? ' predates ' + facts.newestSource : ' is missing') + '; results describe the packaged build, not the current source');
  const results = plan.map(step => ({ file: step.file, browser: step.browser, kind: step.kind, group: step.group, gate: step.gate, args: step.args, status: step.skip ? 'skipped' : 'not-run', ...(step.skip ? { reason: step.reason } : {}) }));
  const save = () => {
    const order = new Map(NATIVE_SUITES.map((item, index) => [item.file, index]));
    summary.results = [...kept, ...results].sort((left, right) => (order.get(left.file) ?? 1e6) - (order.get(right.file) ?? 1e6) || String(left.browser).localeCompare(String(right.browser)));
    summary.totals = tally(summary.results);
    writeEvidence(SUMMARY_JSON, summary); writeEvidence(SUMMARY_MD, renderMarkdown(summary));
  };
  let interrupted = false;
  process.on('SIGINT', () => { interrupted = true; if (current) killTree(current); });
  save();
  let stopped = false;
  for (let index = 0; index < plan.length; index++) {
    const step = plan[index], result = results[index];
    if (step.skip) continue;
    if (stopped || interrupted) continue;
    if (step.kind === 'package') {
      const blocked = [...kept, ...results].filter(other => other.kind === 'native' && other.group === step.group && other.status !== 'skipped' && !PASSING.has(other.status));
      if (blocked.length) { Object.assign(result, { status: 'not-run', reason: 'natives of the group did not all pass' }); save(); continue; }
    }
    const label = step.file + ' ' + (step.browser ?? 'package'), name = step.file.replace(/\.mjs$/u, '') + '.' + (step.browser ?? 'package') + '.log';
    console.log('\n=== run-natives [' + (index + 1) + '/' + plan.length + '] ' + label);
    const outcome = await execute(step, evidencePath(LOG_DIRECTORY + '/' + name), options.timeoutMinutes ?? step.timeoutMinutes ?? DEFAULT_TIMEOUT_MINUTES);
    Object.assign(result, outcome, { log: LOG_DIRECTORY + '/' + name, finishedAt: new Date().toISOString() });
    console.log('=== run-natives ' + label + ': ' + result.status + ' in ' + minutes(result.durationMs));
    if (!PASSING.has(result.status) && !options.continueOnFailure) stopped = true;
    save();
  }
  summary.finishedAt = new Date().toISOString(); if (interrupted) summary.interrupted = true; save();
  console.log('\nrun-natives: ' + Object.entries(summary.totals).filter(([, count]) => count).map(([key, count]) => count + ' ' + key).join(', ') + ' -> ' + relative(ROOT, summaryPath).replaceAll('\\', '/'));
  return summary.results.some(result => ['fail', 'timeout', 'error', 'not-run'].includes(result.status)) ? 1 : 0;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().then(code => { process.exitCode = code; }, error => { console.error('run-natives: ' + (error?.message ?? error)); process.exitCode = 2; });
}
