// P05 / ADR-003: idle and paused documents must receive terminal control without another page batch.
import { expect, it } from 'vitest';
import { BackgroundRuntime } from '../src/index';
import { createFakeChrome, committed } from './fake-chrome';

it.each(['permission', 'scope'] as const)('P05 proactive stop on %s loss is document-scoped and idempotent', async (cause) => {
  const fake = createFakeChrome();
  fake.grantedOrigins.add('https://example.com/*');
  fake.local.data.set('scope', { v: 1, scopeMode: 'site', hosts: ['example.com'] });
  const frame = committed();
  const documentId = frame.documentId!;
  const key = '7:0:' + documentId;
  fake.tabList = [{ id: 7 }];
  fake.framesByTab.set(7, [frame]);
  const runtime = new BackgroundRuntime(fake, { ttlIntervalMs: 0 });
  try {
    await runtime.start();
    runtime.dispatch({ type: 'navigation:committed', tabId: 7, frameId: 0, documentId,
      parentDocumentId: null, frameType: 'outermost_frame', documentLifecycle: 'active', host: 'example.com', at: runtime.now() });
    await runtime.handleBatch({ tabId: 7, frameId: 0, documentId, documentKey: key, host: 'example.com',
      originPattern: 'https://example.com/*', documentLifecycle: 'active', frameType: 'outermost_frame' },
    { schemaVersion: 1, type: 'sensor-events', sensorBootId: 'p05-boot', bridgeSessionId: 'p05-session', batchSeq: 1,
      observations: [{ techniqueId: 'DET-001', count: 1, countQuality: 'exact', phase: 'attempted', signalCodes: ['api-use'], intervalBucket: 0 }], coverageDelta: [] });
    expect(runtime.state.metas.get(key)?.sensorSeen).toBe(true);
    if (cause === 'permission') fake.grantedOrigins.clear();
    else await runtime.scope.setScope({ schemaVersion: 1, type: 'ui-set-scope', scopeMode: 'off' });
    await runtime.onPermissionsChanged();
    await runtime.onPermissionsChanged();
    expect(fake.sentToTabs).toEqual([{ tabId: 7, options: { frameId: 0, documentId },
      message: { schemaVersion: 1, type: 'bridge-control', command: 'stop' } }]);
    expect(runtime.state.reports.get(key)?.counters).toEqual([]);
    expect(runtime.state.reports.get(key)?.coverageFlags).toContain('revoked');
  } finally { runtime.stop(); }
});
