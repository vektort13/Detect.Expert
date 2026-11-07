import { expect, it } from 'vitest';
import { createExportPreview, diagnosticPreview, serializeExportPreview } from '../src/index';
import { report } from '../../ui/test/fixtures';

it('F027/F108 export strips browser identities and absolute time at both levels', () => {
  const source = report({ documentKey: 'SECRET-DOCUMENT', observedSince: 1_700_000_000_000, host: 'private.internal' });
  const preview = createExportPreview(source, 1_700_000_181_234);
  expect(preview.report.observationAgeMinutes).toBe(3);
  expect(preview.report.host).toBeNull();
  expect(serializeExportPreview(preview)).not.toMatch(/SECRET-DOCUMENT|1700000|documentKey|observedSince|exportedAt|private.internal/);
  expect(createExportPreview(source, 1_700_000_181_234, true).report.host).toBeNull();
  expect(source.host).toBe('private.internal');
});

it('F064 diagnostics reject unbounded or non-version strings and contain no report fields', () => {
  expect(diagnosticPreview('secret.internal/' + 'a'.repeat(500), Number.NaN, false)).toEqual({
    schemaVersion: 1, extensionVersion: 'unknown', chromeMajor: null, swAvailable: false,
  });
  expect(diagnosticPreview('0.1.0', 153, true)).toEqual({ schemaVersion: 1, extensionVersion: '0.1.0', chromeMajor: 153, swAvailable: true });
});

it.each([
  ['random-canary.example.com', 'example.com'], ['https://random-canary.example.com/a?q=secret', 'example.com'],
  ['127.0.0.1', null], ['[fd12::1]', null], ['random.local', null], ['a.unknownsuffix', null],
])('P01 export re-redacts even explicitly included host %s', (host, expected) => {
  const preview = createExportPreview(report({ host }), 1000, true);
  expect(preview.report.host).toBe(expected);
  expect(serializeExportPreview(preview)).not.toMatch(/random-canary|secret|127\.0\.0\.1|fd12/);
});
