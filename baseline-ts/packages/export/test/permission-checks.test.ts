import { expect, it } from 'vitest';
import type { PermissionCheck } from '@detect-expert/contracts';
import { createExportPreview, serializeExportPreview } from '../src/index';
import { report } from '../../ui/test/fixtures';

it('exports each historical permission/policy pair intact without raw descriptors or shared rows', () => {
  const checks: PermissionCheck[] = [
    { permission: 'camera', kind: 'permission', result: 'granted', count: 2, countQuality: 'exact' },
    { permission: 'microphone', kind: 'permission', result: 'denied', count: 3, countQuality: 'lower-bound' },
    { permission: 'camera', kind: 'policy', result: 'blocked', count: 1, countQuality: 'exact' },
  ];
  const source = report({ permissionChecks: checks, documentKey: 'SECRET_DOCUMENT_CANARY' });
  Object.assign(checks[0]!, { descriptor: 'RAW_PERMISSION_DESCRIPTOR_CANARY', callback: 'CALLBACK_SOURCE_CANARY' });
  const preview = createExportPreview(source, 1000), serialized = serializeExportPreview(preview);
  expect(preview.report.permissionChecks).toEqual(checks.map(({ permission, kind, result, count, countQuality }) => ({ permission, kind, result, count, countQuality })));
  expect(serialized).not.toMatch(/CANARY|descriptor|callback|documentKey/);
  preview.report.permissionChecks![0]!.count = 99;
  expect(checks[0]!.count).toBe(2);
  expect(preview.report.permissionChecks).not.toContainEqual(expect.objectContaining({ permission: 'microphone', result: 'granted' }));
});

it('does not invent a paired field when exporting an older or generic report', () => {
  expect(Object.hasOwn(createExportPreview(report(), 1000).report, 'permissionChecks')).toBe(false);
});
