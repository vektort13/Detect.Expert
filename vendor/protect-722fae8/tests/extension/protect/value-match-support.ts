// Shared stand of the value-match e2e specs (ADR-020 §B; S07). All sites granted, the module enabled with the
// value-match feature (no DNR feature, so no browser restart is needed), fixture pages under /protect/forms on
// www.example.com and receivers on example.net / example.org (host-resolver rules to the loopback stand). Typing is
// trusted CDP input; the fixtures send the values themselves. Evidence comes only from the SW projection
// (ui-protect-get-report through the test-profile harness); the fixture server counts what was delivered.

import { expect, type Page, type Worker } from '@playwright/test';
import type { ProtectProjection, ProtectTransferEvidence } from '@detect-expert/contracts';
import { getServiceWorker, startFixtureServer, type ExtensionSession, type FixtureServer } from '../harness';
import { brief, fixtureResult, tabIdOf } from '../helpers';
import { enableProtect, grantAllSites, launchProtect, protectRoute, standUrl, typeInto } from './support';

export interface ValueMatchStand {
  ext: ExtensionSession;
  server: FixtureServer;
  sw: Worker;
  /** Port of the receivers (the second stand origin). */
  rp: string;
  close(): Promise<void>;
}

export async function launchValueMatchStand(features: string[] = ['value-match']): Promise<ValueMatchStand> {
  const ext = await launchProtect();
  const server = await startFixtureServer();
  const sw = await getServiceWorker(ext.context);
  await grantAllSites(ext, sw);
  const on = await enableProtect(sw, features);
  expect(on.state?.state, brief(on)).toBe('active');
  return {
    ext,
    server,
    sw,
    rp: new URL(server.origins[1]!).port,
    async close() {
      await server.close();
      await ext.close();
    },
  };
}

export interface FormPage {
  page: Page;
  tabId: number;
}

/** Opens /protect/forms/<file> on `host` (stand origin 0) with ?rp=<receiver port>. */
export async function openForm(stand: ValueMatchStand, file: string, query = '', host = 'www.example.com'): Promise<FormPage> {
  const page = await stand.ext.context.newPage();
  const sep = query.length > 0 ? '&' : '';
  await page.goto(standUrl(stand.server.origins[0]!, host, '/protect/forms/' + file) + '?rp=' + stand.rp + sep + query);
  await fixtureResult(page);
  const tabId = await tabIdOf(stand.sw, page.url());
  return { page, tabId };
}

/** Numbers of the value-match lane (`__protectHarness.service('value-match').debug()`). */
export async function vmDebug(sw: Worker): Promise<Record<string, number | boolean>> {
  return sw.evaluate(() => {
    const h = (globalThis as unknown as { __protectHarness: { service(name: string): { debug(): Record<string, number | boolean> } } }).__protectHarness;
    return h.service('value-match').debug();
  });
}

export async function protectReport(sw: Worker, tabId: number): Promise<ProtectProjection> {
  const r = await protectRoute(sw, { type: 'ui-protect-get-report', tabId });
  const projection = (r as { report?: ProtectProjection | null }).report;
  if (projection === null || projection === undefined) throw new Error('no protect report for tab ' + String(tabId) + ': ' + brief(r));
  return projection;
}

export async function transfers(sw: Worker, tabId: number): Promise<ProtectTransferEvidence[]> {
  return (await protectReport(sw, tabId)).evidence.filter((e): e is ProtectTransferEvidence => e.protectKind === 'value-match' || e.protectKind === 'opaque-after-input');
}

/** Waits until the lane holds at least `n` fields (the debounced protect-input arrived). */
export async function waitFields(sw: Worker, n = 1): Promise<void> {
  await expect.poll(async () => Number((await vmDebug(sw))['fields'] ?? 0), { message: 'fingerprints stored in the SW' }).toBeGreaterThanOrEqual(n);
}

/** Types like a user into `selector`, waits for the fingerprints, then leaves the field (click on #title). */
export async function typeAndLeave(stand: ValueMatchStand, fp: FormPage, selector: string, value: string, fields = 1): Promise<void> {
  await typeInto(fp.page, fp.page.locator(selector), value);
  await waitFields(stand.sw, fields);
  await fp.page.locator('#title').click();
}

/** Requests the fixture server answered on the forms route, per "METHOD host:port/path". */
export function delivered(stand: ValueMatchStand): Record<string, number> {
  return { ...(stand.server.stats.routes['forms'] ?? {}) };
}

export async function evidenceWhere(sw: Worker, tabId: number, pred: (e: ProtectTransferEvidence) => boolean, message: string): Promise<ProtectTransferEvidence> {
  let found: ProtectTransferEvidence | undefined;
  await expect.poll(async () => {
    found = (await transfers(sw, tabId)).find(pred);
    return found !== undefined;
  }, { message, timeout: 15_000 }).toBe(true);
  return found!;
}
