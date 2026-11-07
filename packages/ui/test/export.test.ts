import { describe, expect, it } from 'vitest';
import { buildExportDownload, exportFieldPaths, exportFileName, serializeExportPreview } from '../src/view-models/export';
import { preview } from './fixtures';

describe('export preview (REQ-013)', () => {
  it('the download text is byte-for-byte the preview serialization', () => {
    const p = preview();
    const download = buildExportDownload(p);
    expect(download.text).toBe(serializeExportPreview(p));
    expect(download.mime).toBe('application/json');
    expect(download.text.endsWith('\n')).toBe(true);
  });

  it('round-trips to an equal object and contains only preview fields', () => {
    const p = preview({ report: { ...preview().report, host: 'shop.example', findings: [] } });
    const parsed = JSON.parse(serializeExportPreview(p)) as unknown;
    expect(parsed).toEqual(p);
    expect(Object.keys(parsed as object).sort()).toEqual(['documentOrdinal', 'redacted', 'report', 'reportRevision', 'schemaVersion']);
    expect(serializeExportPreview(p)).not.toMatch(/https?:\/\//);
  });

  it('file name is deterministic for the same preview and includes the revision', () => {
    const p = preview({ documentOrdinal: 1, reportRevision: 42 });
    expect(exportFileName(p)).toBe('detect-expert-report-1-r42.json');
    expect(exportFileName(p)).toBe(buildExportDownload(p).fileName);
    expect(serializeExportPreview(p)).not.toMatch(/documentKey|exportedAt|observedSince/);
  });

  it('lists the top-level fields and the report fields', () => {
    const paths = exportFieldPaths(preview());
    expect(paths).toContain('schemaVersion');
    expect(paths).toContain('redacted');
    expect(paths).toContain('report.host');
    expect(paths).toContain('report.coverageState');
    expect(paths).not.toContain('report');
  });
});

// F054: disclosure is an explicit choice even for public-looking hosts.
describe('host disclosure in the exact downloadable preview', () => {
  for (const host of ['jira.corp-internal', 'intranet', '10.20.30.40', '[fd00::1]', 'example.com']) {
    it(host, async () => {
      const { withExportHost, buildExportDownload } = await import('../src/view-models/export');
      const source = preview();
      source.report.host = host;
      const hidden = withExportHost(source);
      expect(hidden.report.host).toBeNull();
      expect(buildExportDownload(hidden).text).toBe(JSON.stringify(hidden, null, 2) + '\n');
      expect(buildExportDownload(hidden).text).not.toContain(host);
      const included = withExportHost(source, true);
      expect(JSON.parse(buildExportDownload(included).text).report.host).toBe(host);
      expect(withExportHost(source, false).report.host).toBeNull();
      expect(source.report.host).toBe(host);
    });
  }
});
