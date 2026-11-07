// Hostile page (spec A11 gate 3, ADR-004 protocol fuzz, E16 flood): 100 000 spoofed window messages — well-formed
// spoofed batches, 100 KB strings, deep nesting, own __proto__ keys, forged tabId/frameId/documentId, fake
// ui-export-preview / ui-clear commands, garbage primitives. Expected: SW alive, dropped/throttled accounted,
// another real report stays unchanged, no privileged request is forwarded, popup still renders.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { MAX_COUNT } from '@detect-expert/contracts';
import { expect, repoRoot, test } from './harness';
import { DET, brief, fixtureResult, getReport, observed, sendUi, swAlive, tabIdOf, techniqueCount, waitForReport } from './helpers';
import { finishForwardingProbe, installForwardingProbe } from './hostile-observer';

interface HostileWindow {
  __hostileBoot: { bootId: string | null; mismatched: boolean; restored: boolean };
  __runHostile: (mode: string, target: Record<string, unknown>, maxCount: number) => void;
}

interface HostileResult {
  messages: number;
  mix: Record<string, number>;
  sentinelSeen: boolean;
  postMs: number;
  drainMs: number;
  totalMs: number;
  readbacksBefore: number;
  readbacks: number;
  samePixels: boolean;
}

function localized(key: string): RegExp {
  const variants = ['ru', 'en'].map((locale) => {
    const table = JSON.parse(readFileSync(path.join(repoRoot, 'apps', 'extension', '_locales', locale, 'messages.json'), 'utf8')) as Record<string, { message: string }>;
    const message = table[key]?.message;
    if (typeof message !== 'string') throw new Error('missing locale key ' + key + ' in ' + locale);
    return message.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  });
  return new RegExp('^(' + variants.join('|') + ')$');
}

test('bridge flood: throttled, genuine counts survive, victim unchanged and no privileged requests forwarded', async ({ ext, fixtures }) => {
  test.setTimeout(120_000);
  const url = fixtures.origins[0] + '/hostile-bridge.html';
  const { sw, ui, page: victimPage, tabId: victimTabId } = await observed(ext, fixtures.origins[0] + '/late-start.html');
  await fixtureResult(victimPage);
  await waitForReport(ui, victimTabId, (r) => techniqueCount(r, DET.pixelReadback) === 2);
  // Let startup diagnostics settle before taking the byte-for-byte revision snapshot.
  await victimPage.waitForTimeout(1000);
  const victim = await getReport(ui, victimTabId);
  if (victim === null) throw new Error('Missing genuine victim report');
  const frames = await sw.evaluate((id) => chrome.webNavigation.getAllFrames({ tabId: id }), victimTabId);
  const frame = frames?.find((f) => f.frameId === 0);
  if (frame === undefined) throw new Error('Missing trusted victim frame');
  const target = { tabId: victimTabId, frameId: frame.frameId, documentId: frame.documentId, documentKey: victim.documentKey, reportRevision: victim.reportRevision };
  const request = { schemaVersion: 1, type: 'ui-export-preview', tabId: victimTabId, documentKey: victim.documentKey, reportRevision: victim.reportRevision };
  // Authorized positive control: these exact target/revision fields can produce an in-memory export.
  expect((await sendUi(ui, request)).type).toBe('export-preview');
  const page = await ext.context.newPage();
  await page.addInitScript({ path: path.join(repoRoot, 'fixtures', 'hostile-boot.js') });
  await page.goto(url);
  const tabId = await tabIdOf(sw, url);
  await page.waitForFunction(() => (window as unknown as HostileWindow).__hostileBoot.bootId !== null);
  await waitForReport(ui, tabId, (r) => techniqueCount(r, DET.pixelReadback) === 1);
  await installForwardingProbe(sw, tabId);
  await page.evaluate(({ target, maxCount }) => (window as unknown as HostileWindow).__runHostile('flood', target, maxCount), { target, maxCount: MAX_COUNT });
  const result = await fixtureResult<HostileResult>(page, 90_000);
  expect(result.sentinelSeen).toBe(true);
  expect(result.messages).toBe(100_000);
  expect(Object.values(result.mix).reduce((a, b) => a + b, 0)).toBe(100_000);
  expect(result.readbacksBefore).toBe(1);
  expect(result.readbacks).toBe(3);
  expect(result.samePixels).toBe(true);
  test.info().annotations.push({
    type: 'timing',
    description: 'post ' + String(result.postMs) + ' ms, drain (page + bridge listeners) ' + String(result.drainMs) + ' ms, total ' + String(result.totalMs) + ' ms; mix ' + brief(result.mix),
  });

  // SW alive and the privileged channel still answers.
  expect(await swAlive(ui)).toBe(true);

  // Genuine observations before and after the flood are all there: a fake ui-clear would have dropped the count.
  const report = await waitForReport(ui, tabId, (r) => techniqueCount(r, DET.pixelReadback) >= 4, { describe: 'four genuine DET-002 readbacks (1 before + 3 after the flood)', timeoutMs: 15_000 });
  const dropped = report.dropped;
  for (const key of ['observations', 'batches', 'findings', 'hosts', 'counters', 'transport'] as const) {
    expect(Number.isInteger(dropped[key]) && dropped[key] >= 0, key).toBe(true);
  }
  // Well-formed spoofed batches are page-controlled by design (REQ-004): whether they were merged is recorded, not judged.
  test.info().annotations.push({ type: 'spoofed-batches', description: 'DET-040 (spoofed technique) count in report: ' + String(techniqueCount(report, 'DET-040')) });
  expect(report.coverageFlags, 'F161 / ADR-004: flood 10^5 must specifically report throttled; dropped=' + brief(dropped)).toContain('throttled');
  test.info().annotations.push({ type: 'flood-accounting', description: 'dropped=' + brief(dropped) + ' coverageFlags=' + brief(report.coverageFlags) + ' coverageState=' + report.coverageState });

  expect(JSON.stringify(await getReport(ui, victimTabId))).toBe(JSON.stringify(victim));
  // Complements collector/test/listen.test.ts (ui type on page channel) and
  // background/test/handlers.test.ts (unauthorized-sender). Exports are never stored.
  const forwarded = await finishForwardingProbe(sw, tabId);
  expect(forwarded, 'positive control: genuine data passed through this probe').toContain('sensor-events');
  expect(forwarded.filter((type) => type !== 'sensor-events')).toEqual([]);
  // Authorized clear is observable on this existing victim, using the same revision as the attack.
  expect((await sendUi(ui, { ...request, type: 'ui-clear' })).type).toBe('ok');
  await expect.poll(() => getReport(ui, victimTabId)).toBeNull();

  // Popup still renders after the flood (browser UI locale may be ru or en).
  await ui.goto(ui.url().split('?')[0] + '?tabId=' + String(tabId));
  await expect(ui.locator('.app__title')).toHaveText(localized('popupTitle'));
  await expect(ui.locator('.flags__list li').filter({ hasText: localized('coverage_flag_throttled') })).toBeVisible();
});

// F008/F168: independent contexts prevent one silencing attack from masking another.
for (const mode of ['sequence', 'boot-churn', 'status', 'stop', 'pause', 'pre-handshake', 'array-push', 'set-add']) {
  test('known-boot hostile scenario: ' + mode, async ({ ext, fixtures }) => {
    await ext.context.addInitScript({ path: path.join(repoRoot, 'fixtures', 'hostile-boot.js') });
    const { sw, ui, page, tabId } = await observed(ext, fixtures.origins[0] + '/hostile-bridge.html?attack=' + mode);
    await page.waitForFunction(() => (window as unknown as HostileWindow).__hostileBoot.bootId !== null);
    if (mode !== 'pre-handshake') {
      const baseline = await waitForReport(ui, tabId, (r) => techniqueCount(r, DET.pixelReadback) === 1);
      expect(baseline.coverageFlags).not.toContain('channel-gap');
      expect(baseline.coverageFlags).not.toContain('hook-failed');
      expect(baseline.coverageFlags).not.toContain('protocol-mismatch');
    }
    await installForwardingProbe(sw, tabId);
    await page.evaluate(({ mode, maxCount }) => (window as unknown as HostileWindow).__runHostile(mode, {}, maxCount), { mode, maxCount: MAX_COUNT });
    const result = await fixtureResult<HostileResult>(page);
    expect(result.readbacksBefore).toBe(1);
    expect(result.readbacks, 'page API semantics survive the hostile stimulus').toBe(3);
    expect(result.samePixels).toBe(true);
    expect(await page.evaluate(() => (window as unknown as HostileWindow).__hostileBoot.restored)).toBe(true);
    expect(await swAlive(ui)).toBe(true);
    const report = await waitForReport(ui, tabId, (r) => {
      if (mode === 'sequence' || mode === 'boot-churn') return techniqueCount(r, DET.pixelReadback) >= 4 || r.coverageFlags.includes('channel-gap');
      if (mode === 'array-push') return techniqueCount(r, DET.pixelReadback) >= 4 || r.coverageFlags.includes('hook-failed') || r.coverageFlags.includes('channel-gap');
      return r.coverageFlags.includes('channel-gap') || r.coverageFlags.includes('protocol-mismatch');
    }, { describe: mode + ': genuine count continuity or explicit collection gap (REQ-006)' });
    test.info().annotations.push({ type: mode, description: brief(report) });
    if (mode === 'pre-handshake') expect(await page.evaluate(() => (window as unknown as HostileWindow).__hostileBoot.mismatched)).toBe(true);
    for (const technique of report.techniques.filter((t) => t.techniqueId === 'DET-040')) {
      expect(technique.integrity).toBe('page-controlled');
      expect(technique.evidenceSource).toBe('page-hook');
    }
    if (techniqueCount(report, DET.pixelReadback) < 4) expect(report.coverageState).not.toBe('active');
    const forwarded = await finishForwardingProbe(sw, tabId);
    expect(forwarded.filter((type) => type !== 'sensor-events')).toEqual([]);
    await ui.goto(ui.url().split('?')[0] + '?tabId=' + String(tabId));
    await expect(ui.locator('.app__title')).toHaveText(localized('popupTitle'));
    if (report.coverageFlags.includes('channel-gap')) {
      await expect(ui.locator('.flags__list li').filter({ hasText: localized('coverage_flag_channel_gap') })).toBeVisible();
    }
  });
}
