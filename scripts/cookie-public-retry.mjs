// One explicitly authorized retry of nine existing public disclosure URLs.
// Reuses identical DNS/TLS/redirect/body guards; no broad retry or runtime work.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { publicJson, normalizePublicDatasets } from './cookie-public-datasets.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DIR = path.join(ROOT, 'packages/catalog/research/cookies-2026-10');
const IDS = new Set([139, 270, 285, 842, 892, 903, 1140, 1246, 1488, 1494]);
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

export async function retryDeclaredPublicDocuments() {
  const retryFile = path.join(DIR, 'iab-cookie-disclosure-retry.json');
  const alreadyRecorded = await fs.access(retryFile).then(() => true, () => false);
  if (alreadyRecorded) throw new Error('Retry already recorded');
  const filename = path.join(DIR, 'iab-cookie-disclosure-snapshot.json');
  const priorBytes = await fs.readFile(filename);
  const snapshot = JSON.parse(priorBytes.toString('utf8'));
  const grouped = new Map();
  for (const row of snapshot.results) {
    if (!IDS.has(row.vendorId)) continue;
    if (!(row.status === 'timeout' || row.status === 'http-error' && [500, 502, 503, 520].includes(row.httpStatus))) throw new Error('Retry source status changed');
    const selected = grouped.get(row.sourceUrl) ?? { sourceUrl: row.sourceUrl, rows: [] };
    selected.rows.push(row);
    grouped.set(row.sourceUrl, selected);
  }
  if (grouped.size !== 9 || [...grouped.values()].flatMap(group => group.rows).length !== 10) throw new Error('Retry plan changed');
  const jobs = [...grouped.values()];
  const results = [];
  let cursor = 0;
  async function worker() {
    while (cursor < jobs.length) {
      const job = jobs[cursor++];
      const startedAt = new Date().toISOString();
      const attempted = await publicJson(job.sourceUrl).catch(error => ({ status: error.name === 'TimeoutError' || error.name === 'AbortError' ? 'timeout' : 'fetch-error' }));
      results.push({
        sourceUrl: job.sourceUrl,
        vendorIds: job.rows.map(row => row.vendorId),
        prior: job.rows.map(({ vendorId, owner, status, httpStatus }) => ({ vendorId, owner, status, httpStatus })),
        startedAt, finishedAt: new Date().toISOString(), result: attempted
      });
    }
  }
  await Promise.all([worker(), worker()]);
  results.sort((a, b) => a.vendorIds[0] - b.vendorIds[0]);
  const report = {
    schemaVersion: 1, researchOnly: true, generatedAt: new Date().toISOString(),
    operation: 'single-authorized-public-document-retry', priorSnapshotSha256: digest(priorBytes),
    limits: { uniqueUrls: 9, vendorRows: 10, concurrency: 2, requestTimeoutMs: 10_000, maximumBodyBytes: 2 * 1024 * 1024, attemptsPerUrl: 1 },
    results
  };
  const retryBytes = Buffer.from(JSON.stringify(report, null, 2) + '\n');
  // Refuse replacing evidence even if another process races the initial guard.
  await fs.writeFile(retryFile, retryBytes, { flag: 'wx' });
  const byId = new Map(snapshot.results.map((row, index) => [row.vendorId, index]));
  let upgradedRows = 0;
  for (const record of results) {
    if (record.result.status !== 'ok') continue;
    for (const vendorId of record.vendorIds) {
      const index = byId.get(vendorId);
      const prior = snapshot.results[index];
      snapshot.results[index] = {
        vendorId: prior.vendorId, owner: prior.owner, sourceUrl: prior.sourceUrl, ...record.result,
        retryHistory: [{ status: prior.status, httpStatus: prior.httpStatus, retriedAt: record.startedAt, retryFile: 'iab-cookie-disclosure-retry.json' }]
      };
      upgradedRows++;
    }
  }
  snapshot.retryEvidence = { file: 'iab-cookie-disclosure-retry.json', sha256: digest(retryBytes), uniqueUrls: 9, vendorRows: 10, upgradedRows };
  await fs.writeFile(filename, JSON.stringify(snapshot, null, 2) + '\n');
  const normalized = await normalizePublicDatasets();
  const finalBytes = await fs.readFile(filename);
  const normalizedBytes = await fs.readFile(path.join(DIR, 'iab-cookie-disclosures.normalized.json'));
  const summary = {
    uniqueUrlsAttempted: 9, vendorRowsAttempted: 10,
    successfulUrls: results.filter(row => row.result.status === 'ok').length,
    upgradedRows, failedRetryUrls: results.filter(row => row.result.status !== 'ok').length,
    snapshotSha256: digest(finalBytes), normalizedSha256: digest(normalizedBytes), retrySha256: digest(retryBytes), quality: normalized.quality
  };
  console.log(JSON.stringify(summary, null, 2));
  return summary;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  retryDeclaredPublicDocuments().catch(() => { console.error('Public disclosure retry failed'); process.exitCode = 1; });
}
