// ADR-020 §I, REQ-005, REQ-010 (S14, E21-14 case 3): the identifier and the name typed on requests.html live only in
// the page's memory. After a full letter flow (mailto click, copy, «отправлен», .ics and export previews) neither
// canary (nor its hash, Base64 or URL-encoded variants) is in storage.local, storage.session, the module's IndexedDB,
// the page's localStorage / sessionStorage or any message the page sent to the SW; a reload shows empty fields; the
// extension made no network request of its own (extensionEgress = 0).

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { getServiceWorker, repoRoot } from '../harness';
import { brief, dumpLocal, dumpSession, openExtensionPage } from '../helpers';
import { canaryHits, dumpProtectDb, enableProtect, grantAllSites, launchProtect } from './support';
import type { Canary } from './support';
import { copiedTexts, installRequestsRecorder, sentRaw, waitRequestsPage, watchExtensionEgress } from './requests-support';

const registry = JSON.parse(readFileSync(path.join(repoRoot, 'fixtures/privacy/canaries.json'), 'utf8')) as { protect: Canary[] };
const CANARIES = registry.protect.filter((c) => c.id === 'request-identity' || c.id === 'request-name');
const IDENTITY = CANARIES.find((c) => c.id === 'request-identity')!.value;
const NAME = CANARIES.find((c) => c.id === 'request-name')!.value;

// Actions fail with their step instead of running into the test timeout.
test.use({ actionTimeout: 15_000 });

test('the identifier and the name typed on requests.html are stored nowhere and leave only through the user’s own actions', async () => {
  test.setTimeout(180_000);
  expect(CANARIES).toHaveLength(2);
  const ext = await launchProtect();
  try {
    const sw = await getServiceWorker(ext.context);
    await grantAllSites(ext, sw);
    const on = await enableProtect(sw, ['value-match']);
    expect(on.state?.state, brief(on)).toBe('active');
    await installRequestsRecorder(ext.context);
    const egress = watchExtensionEgress(ext.context, sw);

    const page = await openExtensionPage(ext.context, sw, 'requests.html#new=manual');
    await waitRequestsPage(page);
    const c = page.locator('[data-requests-composer="manual"]');
    await expect(c).toBeVisible({ timeout: 15_000 });
    await c.locator('[data-requests-law]').selectOption('gdpr-eu-eea');
    await c.locator('[data-requests-lang="en"]').check();
    await c.locator('[data-requests-entity]').pressSequentially('Privacy Stand Co');
    await c.locator('[data-requests-identity-kind="typed-identifier"]').check();
    await c.locator('[data-requests-identifier]').pressSequentially(IDENTITY);
    await c.locator('[data-requests-include-name]').check();
    await c.locator('[data-requests-name]').pressSequentially(NAME);
    await c.locator('[data-requests-manual-address]').pressSequentially('dpo@stand-company.test');
    for (const field of ['[data-requests-identifier]', '[data-requests-name]']) {
      await expect(c.locator(field)).toHaveAttribute('autocomplete', 'off');
      await expect(c.locator(field)).toHaveAttribute('type', 'text');
    }
    const body = await c.locator('[data-requests-body]').inputValue();
    expect(body).toContain(IDENTITY);
    expect(body).toContain(NAME);

    // The user's own actions: open the mail program (default action prevented by the recorder), copy the text.
    await c.locator('[data-requests-mailto]').click();
    await expect(page.locator('[data-requests-save-notice]')).toBeVisible();
    await c.locator('[data-requests-copy]').click();
    await expect.poll(async () => (await copiedTexts(page)).length).toBe(1);
    const row = page.locator('[data-request-row]').first();
    await row.locator('[data-request-next]').selectOption('sent');
    await row.locator('[data-request-apply]').click();
    await expect(row).toHaveAttribute('data-request-status', 'sent');
    await row.locator('[data-request-ics]').click();
    // The dialog opens (showModal) after its first render: wait for it before Escape.
    await expect(page.locator('#request-ics-dialog')).toBeVisible();
    const ics = await page.locator('#request-ics-dialog [data-requests-file-text]').innerText();
    await page.keyboard.press('Escape');
    await expect(page.locator('#request-ics-dialog')).toHaveCount(0);
    await page.locator('[data-requests-export]').click();
    await expect(page.locator('#requests-export-dialog')).toBeVisible();
    await page.locator('[data-requests-export-facts]').check();
    const exported = await page.locator('#requests-export-dialog [data-requests-file-text]').innerText();
    await page.keyboard.press('Escape');
    await expect(page.locator('#requests-export-dialog')).toHaveCount(0);
    expect(canaryHits(ics, CANARIES)).toEqual([]);
    expect(canaryHits(exported, CANARIES)).toEqual([]);

    // Every place the extension keeps or passes data.
    const wire = (await sentRaw(page)).join('\n');
    expect(wire).toContain('ui-protect-request-save');
    const pageStorage = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));
    const places: Record<string, string> = {
      'storage.local': JSON.stringify(await dumpLocal(sw)),
      'storage.session': JSON.stringify(await dumpSession(sw)),
      indexedDB: JSON.stringify(await dumpProtectDb(sw)),
      'page messages to the SW': wire,
      'page localStorage/sessionStorage': pageStorage,
    };
    for (const [where, text] of Object.entries(places)) expect(canaryHits(text, CANARIES), where).toEqual([]);
    const dbs = await sw.evaluate(async () => (await indexedDB.databases()).map((d) => String(d.name)));
    expect(dbs).toEqual(['detect-expert-protect']);
    const journal = JSON.parse(places['indexedDB']!) as { requests?: Array<{ identityKinds: string[] }> };
    expect(journal.requests?.map((r) => r.identityKinds)).toEqual([['typed-identifier', 'typed-name']]);

    // A reload starts empty: nothing was restored from anywhere.
    await page.reload();
    await waitRequestsPage(page);
    await expect(page.locator('[data-requests-composer]')).toBeVisible({ timeout: 15_000 });
    expect(canaryHits(await page.content(), CANARIES)).toEqual([]);

    expect(egress.urls()).toEqual([]);
  } finally {
    await ext.close();
  }
});
