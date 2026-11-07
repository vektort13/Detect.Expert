import { expect, it } from 'vitest';
import { attributionConfidence } from '../src/attribution';
import { projectReport } from '../src/projection';
import { report, FP_POSITIVE, hostEntry } from './fixtures';
it.each(['inline', 'eval', 'blob', 'unknown'] as const)('P01: %s script remains unknown even with a frame and adjacent network resources', (scriptKind) => {
  expect(attributionConfidence({ evidenceSource: 'browser-network', integrity: 'browser-observed', frameBound: true, scriptKind, scriptUrl: 'https://example.com/script.js' })).toBe('unknown');
});
it('P01: only browser network script evidence gives exact-resource', () => {
  expect(attributionConfidence({ evidenceSource: 'browser-network', integrity: 'browser-observed', frameBound: true, scriptKind: 'external', scriptUrl: 'https://example.com/script.js' })).toBe('exact-resource');
  expect(attributionConfidence({ evidenceSource: 'page-hook', integrity: 'page-controlled', frameBound: true })).toBe('frame-only');
  expect(attributionConfidence({ evidenceSource: 'derived', integrity: 'derived', frameBound: false })).toBe('unknown');
});
it('P01: inline fixture counters project unknown; network neighbors do not attribute the call', () => {
  const projection = projectReport(report({ counters: FP_POSITIVE, hosts: [hostEntry('example.com')] }), { scopeMode: 'site' });
  expect(projection.techniques.length).toBeGreaterThan(0);
  expect(projection.techniques.every((t) => t.attributionConfidence === 'unknown')).toBe(true);
});
