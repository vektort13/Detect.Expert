// REQ-001/005/008/010/011: aggregate verification of published browser hosts only.
import { open, rename, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, RESEARCH, OUTPUT, toShodanCatalog } from './antifraud-cdn-catalog.mjs';
import { buildAggregatePlan, runAggregate, loadAggregateConfig, loadCredential, containedExistingPath, sanitizedErrorCode } from './shodan-antifraud-counts.mjs';
import { readStdinCredential } from './shodan-cookie-counts.mjs';

export function parseCdnOptions(argv) {
  const options = {};
  for (const arg of argv) {
    if (arg === '--run' || arg === '--plan') {
      if (options.mode) throw Error('invalid-options');
      options.mode = arg.slice(2);
    } else if (arg === '--stdin-key') {
      if (options.stdinKey) throw Error('invalid-options');
      options.stdinKey = true;
    } else throw Error('invalid-options');
  }
  if (!options.mode || options.mode === 'plan' && options.stdinKey) throw Error('invalid-options');
  return options;
}

export async function loadCdnCatalog(projectRoot = ROOT) {
  const filename = await containedExistingPath(projectRoot, OUTPUT);
  const handle = await open(filename, 'r');
  const limit = 2 * 1024 * 1024;
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > limit) throw Error('invalid-cdn-catalog');
    const buffer = Buffer.alloc(limit + 1); let size = 0;
    for (;;) {
      const chunk = await handle.read(buffer, size, buffer.length - size, size);
      size += chunk.bytesRead;
      if (size > limit) throw Error('invalid-cdn-catalog');
      if (!chunk.bytesRead) break;
    }
    try { return toShodanCatalog(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, size)))); }
    catch { throw Error('invalid-cdn-catalog'); }
  } finally { await handle.close(); }
}

export async function mainCdnCounts({ argv = process.argv.slice(2), env = process.env, stdin = process.stdin,
  fetchImpl = globalThis.fetch, output = line => console.log(line) } = {}) {
  const options = parseCdnOptions(argv);
  const catalog = await loadCdnCatalog(ROOT);
  const config = await loadAggregateConfig(ROOT);
  const eligibleHosts = new Set(catalog.vendors.flatMap(v => v.browserSignals.map(s => s.host)));
  if (eligibleHosts.size > config.maximumSelectedHosts) throw Error('cdn-plan-exceeds-budget');
  let report;
  if (options.mode === 'plan') report = buildAggregatePlan(catalog, config);
  else {
    const credential = options.stdinKey ? await readStdinCredential(stdin) : await loadCredential({ projectRoot: ROOT, env });
    report = await runAggregate({ catalog, config, credential, fetchImpl });
    report.generatedAt = new Date().toISOString();
  }
  report.inputCatalog = OUTPUT;
  report.interpretation = 'Aggregate index matches for published browser hostname filters; not ownership, site adoption or detector validation.';
  const directory = await containedExistingPath(ROOT, RESEARCH);
  const target = options.mode === 'plan' ? 'shodan-plan.json' : 'shodan-counts.json';
  const temporary = join(directory, '.cdn-counts-' + randomUUID() + '.tmp');
  try {
    const handle = await open(temporary, 'wx', 0o600);
    try { await handle.writeFile(JSON.stringify(report, null, 2) + '\n', 'utf8'); }
    finally { await handle.close(); }
    await rename(temporary, join(directory, target));
  } finally { await unlink(temporary).catch(() => {}); }
  const success = report.entries.filter(row => row.status === 'ok').length;
  const nonzero = report.entries.filter(row => row.status === 'ok' && row.count > 0).length;
  output('Shodan CDN: ' + report.status + '; planned=' + report.requestCount + '; ok=' + success + '; nonzero=' + nonzero + '; ' + RESEARCH + '/' + target);
  return report;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  mainCdnCounts().catch(error => {
    console.error('Shodan CDN: ' + sanitizedErrorCode(error, 'cdn-operation-failed'));
    process.exitCode = 1;
  });
}
