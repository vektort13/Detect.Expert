// ADR-020 §B (S07): a gzip-compressed batch (CompressionStream) to a third party shortly after the input can only be
// «possible transfer» (opaque-after-input, low); the same JSON uncompressed (?plain=1) is a value-match (high).

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { repoRoot } from '../harness';
import { delivered, evidenceWhere, launchValueMatchStand, openForm, transfers, typeAndLeave } from './value-match-support';
import type { Canary } from './support';

const registry = JSON.parse(readFileSync(path.join(repoRoot, 'fixtures/privacy/canaries.json'), 'utf8')) as { protect: Canary[] };
const EMAIL = registry.protect.find((c) => c.id === 'protect-email')!.value;

test('opaque batch → opaque-after-input (low); ?plain=1 → value-match (high)', async () => {
  test.setTimeout(120_000);
  const stand = await launchValueMatchStand();
  try {
    const gz = await openForm(stand, 'opaque-batcher.html');
    await typeAndLeave(stand, gz, '#email', EMAIL);
    const opaque = await evidenceWhere(stand.sw, gz.tabId, (e) => e.protectKind === 'opaque-after-input', 'opaque-after-input evidence');
    expect(opaque).toMatchObject({ transferClass: 'opaque-after-input', interpretationConfidence: 'low', encodings: [], location: 'body-opaque', receiver: 'example.org', fieldKind: 'email' });
    expect((await transfers(stand.sw, gz.tabId)).filter((e) => e.protectKind === 'value-match'), 'nothing claimed about the compressed body').toEqual([]);
    expect(delivered(stand)['POST rec.collect.example.org:' + stand.rp + '/fsink/batch'] ?? 0).toBeGreaterThanOrEqual(1);

    const plain = await openForm(stand, 'opaque-batcher.html', 'plain=1');
    await typeAndLeave(stand, plain, '#email', EMAIL);
    const found = await evidenceWhere(stand.sw, plain.tabId, (e) => e.protectKind === 'value-match', 'plain JSON value-match');
    expect(found).toMatchObject({ interpretationConfidence: 'high', location: 'body-json', paramName: 'events.email', encodings: ['plain'] });
  } finally {
    await stand.close();
  }
});
