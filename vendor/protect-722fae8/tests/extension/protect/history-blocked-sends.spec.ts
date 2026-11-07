// ADR-020 §11, §G (S12 × S07 × S08, review round 1): the history counts a value-match only when Chrome reported the
// send. Real Chromium, all sites granted, module with value-match + firewall + history (enabled in Options, browser
// restarted for SP-1). A «везде» block of example.net is decided first (the prompt comes from the firewall lane's
// harness, which never reaches the history). Then the e-mail is typed on two sites; the stand's sender hashes it and
// sends it to collect.example.net. The value-match lane sees every request at onBeforeRequest (SP-2) and publishes
// `unknown`; our rule stops them (`stopped`), the server receives none, and the history records no value-match.
// Control: after the decisions are purged, the same sends go out (`sent`) and the history shows value-match on 2 sites.
// Review round 2: while blocked, the example.net row and card in the side panel (request attempts, SP-2, and our
// blocks) claim neither receipt nor sending; after the control sends the value-match line reads «отправлялись».

import { expect, test } from '@playwright/test';
import type { Worker } from '@playwright/test';
import type { HistoryProjection, ProtectTransferEvidence } from '@detect-expert/contracts';
import { brief, openExtensionPage } from '../helpers';
import { dumpProtectDb, ourDnrRules, protectRoute } from './support';
import { decide, delivered, launchFirewallStand, openStandPage, promptFor, report, sendAttempts, typeEmail } from './firewall-support';
import type { FirewallStand, StandPage } from './firewall-support';

const SITES = ['www.example.com', 'www.example.org'];
/** Words that would claim the receiver got something or that Chrome sent it (ru / en UI locales). */
const NO_RECEIPT_OR_SEND = /получал|получил|отправл|received|\breceives?\b|\bsent\b|\bsend/i;

async function historyQuery(sw: Worker, extra: Record<string, unknown> = {}): Promise<HistoryProjection> {
  const r = await protectRoute(sw, { type: 'ui-protect-history-query', windowDays: 30, offset: 0, limit: 50, ...extra });
  if (r.type !== 'protect-history') throw new Error('history query answered ' + brief(r));
  return (r as unknown as { history: HistoryProjection }).history;
}

async function historyDebug(sw: Worker): Promise<Record<string, number | boolean>> {
  return sw.evaluate(() => (globalThis as unknown as { __protectHarness: { service(n: string): { debug(): Record<string, number | boolean> } } }).__protectHarness.service('history').debug());
}

async function transfersTo(stand: FirewallStand, sp: StandPage, receiver: string): Promise<ProtectTransferEvidence[]> {
  return (await report(stand, sp.tabId)).evidence.filter((e): e is ProtectTransferEvidence => e.protectKind === 'value-match' && e.receiver === receiver);
}

/** valueMatch day masks of the stored sightings of `receiver` (site → any bit set). */
async function storedValueMatch(sw: Worker, receiver: string): Promise<Record<string, boolean>> {
  const dump = await dumpProtectDb(sw);
  const out: Record<string, boolean> = {};
  for (const row of (dump['sightings'] ?? []) as Array<{ receiver?: string; site?: string; valueMatch?: number[] }>) {
    if (row.receiver !== receiver || typeof row.site !== 'string') continue;
    out[row.site] = Array.isArray(row.valueMatch) && row.valueMatch.some((w) => w !== 0);
  }
  return out;
}

test('history: value-match of sends our rule stopped is never «received»; sent ones are (control)', async () => {
  test.setTimeout(240_000);
  const stand = await launchFirewallStand(['value-match', 'firewall', 'history']);
  try {
    const decider = await openStandPage(stand, 'www.example.org', 'leak-form.html');
    await promptFor(stand, decider);
    const res = await decide(stand, decider, ['example.net'], 'block', 'everywhere');
    expect(res, brief(res)).toMatchObject({ type: 'protect-decision', applied: [{ receiver: 'example.net', ruleApplied: true }] });

    const pages: StandPage[] = [];
    for (const host of SITES) {
      const sp = await openStandPage(stand, host, 'leak-form.html');
      await typeEmail(stand, sp);
      await sendAttempts(sp);
      pages.push(sp);
    }
    expect(delivered(stand), 'our rule stopped every send: the server received none').toBe(0);
    for (const sp of pages) {
      await expect.poll(async () => (await transfersTo(stand, sp, 'example.net')).map((e) => e.deliveryState).sort().join(','), { message: 'value-match stopped on tab ' + String(sp.tabId) }).toMatch(/stopped/);
      expect((await transfersTo(stand, sp, 'example.net')).some((e) => e.deliveryState === 'sent'), 'nothing was sent').toBe(false);
    }
    // The direct matches got `stopped` and were dropped (`unsent`). A reverse match of a request that had already been
    // stopped before the fingerprint arrived (untracked then) stays `unknown` and waits for an outcome that will be
    // `unknown` (tracker TTL): parked, never counted.
    const dbg = await historyDebug(stand.sw);
    expect(Number(dbg['unsent']), brief(dbg)).toBeGreaterThanOrEqual(2);
    expect(Number(dbg['unsent']) + Number(dbg['awaitingSends']), brief(dbg)).toBeGreaterThanOrEqual(SITES.length * 2);
    const blocked = await historyQuery(stand.sw, { minSites: 1 });
    expect(blocked.rows.flatMap((r) => r.mechanisms.map((m) => m.mechanism)), brief(blocked.rows)).not.toContain('value-match');
    expect(Object.values(await storedValueMatch(stand.sw, 'example.net')), 'no valueMatch day bit for example.net').not.toContain(true);

    // Review round 2 (ADR-020 §11): while example.net is blocked, its row in the side panel (attempts from the
    // observation reports, SP-2, plus our blocks) claims neither receipt nor sending — in the row and in its card.
    await expect.poll(async () => (await historyQuery(stand.sw)).rows.find((r) => r.rowKey === 'd:example.net')?.sites ?? 0, { timeout: 20_000, message: 'example.net row on two sites' }).toBe(SITES.length);
    const panel = await openExtensionPage(stand.context, stand.sw, 'sidepanel.html?tabId=' + String(pages[0]!.tabId));
    await panel.locator('#panel-tab-history').click();
    const row = panel.locator('[data-history-row="d:example.net"]');
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expect(row.locator('[data-history-mechanism="value-match"]')).toHaveCount(0);
    await row.locator('[data-history-details]').click();
    await expect(row.locator('[data-history-card="d:example.net"] [data-history-site]')).toHaveCount(SITES.length);
    const rowText = await row.innerText();
    expect(rowText, rowText).not.toMatch(NO_RECEIPT_OR_SEND);
    // The observation reports list example.net (onBeforeRequest attempts, SP-2): requests-only, worded as attempts.
    const requestsOnly = row.locator('[data-history-mechanism="requests-only"]');
    await expect(requestsOnly).toHaveCount(2); // the row and its card
    for (const line of await requestsOnly.all()) await expect(line).toContainText(/попытки запросов по данным Chrome|request attempts reported by Chrome/);
    await panel.close();

    // Control: without the rule the same sends go out; Chrome reports onSendHeaders → value-match on both sites.
    expect((await protectRoute(stand.sw, { type: 'ui-protect-purge', what: 'decisions' })).type).toBe('protect-state');
    await expect.poll(async () => (await ourDnrRules(stand.sw)).ids).toEqual([]);
    for (const sp of pages) await sendAttempts(sp);
    await expect.poll(() => delivered(stand), { message: 'the sends went out after the purge' }).toBeGreaterThanOrEqual(2);
    await expect.poll(async () => {
      const row = (await historyQuery(stand.sw, { mechanismsOnly: true })).rows.find((r) => r.rowKey === 'd:example.net');
      return row?.mechanisms.find((m) => m.mechanism === 'value-match') ?? null;
    }, { timeout: 20_000, message: 'value-match on two sites after real sends' }).toMatchObject({ sites: 2, interpretationConfidence: 'high' });
    expect(await storedValueMatch(stand.sw, 'example.net')).toEqual({ 'example.com': true, 'example.org': true });
    // Positive control of the wording: a send Chrome reported reads «отправлялись … (по данным Chrome)».
    const after = await openExtensionPage(stand.context, stand.sw, 'sidepanel.html?tabId=' + String(pages[0]!.tabId));
    await after.locator('#panel-tab-history').click();
    const vm = after.locator('[data-history-row="d:example.net"] [data-history-mechanism="value-match"]');
    await expect(vm).toBeVisible({ timeout: 15_000 });
    await expect(vm).toContainText(/отправлялись ему на 2 сайтах \(по данным Chrome\)|was sent to it on 2 sites \(as reported by Chrome\)/);
    await after.close();
  } finally {
    await stand.close();
  }
});
