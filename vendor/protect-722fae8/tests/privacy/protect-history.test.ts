// ADR-020 §4 (REQ-005), §8, §G (S12): the history «Кто вас узнаёт» keeps only registrable domains, UTC day numbers,
// enums and counts. Reports and module events that carry canaries in every field the history must ignore (paths,
// parameter names, document ids, limitation codes, endpoint hosts) go through the real controller and history lane
// (fake chrome + in-memory IndexedDB); then the database, storage.local, storage.session and the export (with and
// without site names) are scanned: no canary or canary variant, no URL, no path, no time of day, no epoch time.

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateProtectUiRequest } from '@detect-expert/contracts';
import type { DocumentReport, HistoryExport, ProtectEvidence, ProtectUiRequest } from '@detect-expert/contracts';
import { serializeHistoryExport } from '../../packages/export/src/protect-history';
import { HistoryService } from '../../packages/background/src/protect/history/service';
import { ALL_SITES, DNR_PERMISSION, ENABLED_SETTINGS, optionsSender, setupController } from '../../packages/background/test/protect/support';
import type { RecordingService } from '../../packages/background/test/protect/support';

interface Canary { id: string; value: string }
const registry = JSON.parse(readFileSync(resolve('fixtures/privacy/canaries.json'), 'utf8')) as { canaries: Canary[]; protect: Canary[] };
const CANARIES: Canary[] = [...registry.canaries, ...registry.protect];
const NOW = Date.UTC(2026, 9, 18, 13, 37, 21);

function variants(value: string): string[] {
  const out = new Set<string>([value, encodeURIComponent(value), Buffer.from(value, 'utf8').toString('base64')]);
  for (const algo of ['md5', 'sha1', 'sha256', 'sha512']) {
    out.add(createHash(algo).update(value, 'utf8').digest('hex'));
    out.add(createHash(algo).update(value.trim().toLowerCase(), 'utf8').digest('hex'));
  }
  return [...out];
}

function hits(text: string): string[] {
  const out: string[] = [];
  for (const c of CANARIES) for (const v of variants(c.value)) if (text.includes(v)) out.push(c.id);
  return [...new Set(out)];
}

const SIGHTING_KEYS = ['blocked', 'endDay', 'families', 'frame', 'lastDay', 'receiver', 'replay', 'request', 'ruleIds', 'seen', 'site', 'strongestValueEncoding', 'v', 'valueMatch'];

describe('history privacy (REQ-005, ADR-020 §G)', () => {
  it('stores and exports only domains, days, enums and counts', async () => {
    const history = new HistoryService({ flushMs: 60_000 });
    const s = await setupController({
      chrome: { grantedOrigins: ALL_SITES, permissions: [DNR_PERMISSION] },
      settings: { ...ENABLED_SETTINGS, features: ['history', 'value-match'] },
      services: () => [history as unknown as RecordingService],
      load: false,
    });
    s.clock.t = NOW;
    await s.controller.load();
    const canary = (id: string): string => CANARIES.find((c) => c.id === id)!.value;

    for (const [tab, host] of [[1, 'www.shop.com'], [2, 'news.example.net']] as const) {
      const r: DocumentReport = {
        schemaVersion: 1, documentKey: String(tab) + ':0:' + canary('path-id'), tabId: tab, frameId: 0, documentId: canary('path-id'), host,
        lifecycle: 'committed', createdAt: NOW, updatedAt: NOW, revision: 1, coverageState: 'active', coverageFlags: ['network-limited'],
        counters: [{ techniqueId: 'DET-001', phase: 'returned-sync', signalCodes: ['api-use'], count: 2, countQuality: 'exact', firstBucket: 0, lastBucket: 1 }],
        findings: [{ findingId: canary('fragment'), ruleId: 'canvas-readback', ruleVersion: '1', techniqueId: 'DET-001', interpretation: 'possible-fingerprinting', interpretationConfidence: 'low', evidenceIds: [canary('query-param')], counterEvidenceCodes: [canary('title-text')], limitationCodes: [canary('stack-frame')], vendorMatchIds: [] }],
        hosts: [{ registrableDomain: 'tracker.net', relation: 'cross-site', evidenceSource: 'browser-network', integrity: 'browser-observed', requestCount: 3, firstSeenBucket: 0, lastSeenBucket: 1, ruleIds: [] }],
        networkCounters: [], networkPatterns: { localPortsMax: 0, localTargetsMax: 0, randomSubdomainsMax: 0 }, watermark: { bridgeSessionId: canary('form-text'), lastCommittedBatchSeq: 1 },
        dropped: { observations: 0, batches: 0, findings: 0, hosts: 0, counters: 0, transport: 0 },
      };
      s.controller.onReportPersisted(r, { tabId: tab, frameId: 0, documentId: r.documentId, documentKey: r.documentKey, parentDocumentId: null, frameType: 'outermost_frame', documentLifecycle: 'active', host, boundAt: NOW }, { paused: false, bindingOf: () => null });
      const evidence = {
        evidenceId: 'pe-1', frameContext: 'top', attributionConfidence: 'unknown', count: 1, countQuality: 'exact', firstSecond: 0, lastSecond: 3,
        evidenceSource: 'derived', integrity: 'derived', ruleVersion: '1', limitationCodes: [], protectKind: 'value-match', ruleId: 'form-leak',
        transferClass: 'third-party-before-submit', fieldKind: 'email', encodings: ['sha256-hex'], paramName: 'email', receiver: 'tracker.net', relation: 'cross-site',
        method: 'POST', requestKind: 'xhr', endpointHost: 'collect.tracker.net', endpointPathTemplate: '/' + canary('protect-email').replace(/[^A-Za-z0-9-]/g, '-'),
        submitTiming: 'before-submit', deliveryState: 'sent', interpretationConfidence: 'high',
      } as unknown as ProtectEvidence;
      s.controller.eventBus.publish({ kind: 'evidence', documentKey: r.documentKey, tabId: tab, site: host === 'www.shop.com' ? 'shop.com' : 'example.net', evidence });
    }
    const route = async (request: Record<string, unknown>) => {
      const v = validateProtectUiRequest({ schemaVersion: 1, ...request });
      if (!v.ok) throw new Error('invalid');
      return s.controller.routeUi(v.value as ProtectUiRequest, optionsSender());
    };
    const query = await route({ type: 'ui-protect-history-query', windowDays: 30, offset: 0, limit: 50 });
    expect(query.type).toBe('protect-history');
    const exports: string[] = [];
    for (const includeSites of [false, true]) {
      const r = await route({ type: 'ui-protect-history-export', includeSites });
      exports.push(serializeHistoryExport((r as unknown as { preview: HistoryExport }).preview));
    }

    const db: Record<string, unknown[]> = {};
    for (const [name, store] of s.db.stores) db[name] = [...store.values()].map((e) => e.value);
    const sightings = db['sightings'] as Array<Record<string, unknown>>;
    expect(sightings.length).toBe(2);
    for (const rec of sightings) {
      for (const key of Object.keys(rec)) expect(SIGHTING_KEYS, key).toContain(key);
      expect(typeof rec['endDay']).toBe('number');
    }
    const texts = {
      indexeddb: JSON.stringify(db),
      local: JSON.stringify([...s.fake.local.data.entries()]),
      session: JSON.stringify([...s.fake.session.data.entries()]),
      exportRedacted: exports[0]!,
      exportNamed: exports[1]!,
      projection: JSON.stringify(query),
    };
    for (const [where, text] of Object.entries(texts)) {
      expect(hits(text), where).toEqual([]);
      expect(text, where).not.toMatch(/https?:\/\/|\/\/[a-z]|\?[a-z]+=|T\d\d:\d\d|\b\d\d:\d\d:\d\d\b/i);
    }
    // No time of day and no epoch time in the history output: day numbers (≈ 20 000) and u32 day-mask words only.
    for (const where of ['indexeddb', 'exportRedacted', 'exportNamed', 'projection'] as const) {
      const text = texts[where];
      expect(text, where).not.toContain(String(NOW));
      expect(text, where).not.toContain(String(Math.floor(NOW / 1000)));
      for (const n of text.match(/\b\d{12,}\b/g) ?? []) expect(Number(n), where + ' ' + n).toBeLessThan(1e12);
    }
    expect(texts.indexeddb).not.toContain('collect.tracker.net');
    expect(texts.indexeddb).not.toContain('www.shop.com');
    expect(texts.exportRedacted).not.toMatch(/shop\.com|example\.net/);
    expect(texts.exportNamed).toMatch(/shop\.com/);
  });
});
