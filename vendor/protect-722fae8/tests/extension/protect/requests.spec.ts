// ADR-020 §I (S14, E21-14 case 2): data requests in a real Chromium.
// 1. Module off: no «Подготовить запрос» button, no Options section, the popup sends no ui-protect-requests-get,
//    requests.html shows no journal and no IndexedDB appears.
// 2. Module on: a keylogger transfer → «Подготовить запрос о данных» in the side panel → requests.html → letter; the
//    mailto: link equals the preview; «Скопировать текст»; the journal entry; «отправлен» → approximate deadline;
//    .ics preview (no site); an overdue record → popup reminder; a company form from the synthetic directory; a
//    reviewed e-mail address from the directory; a long Russian letter (short mailto body + full text copied); TTL;
//    deletion; export (observations only when ticked). Nothing leaves the browser (mailto/form clicks are prevented by
//    the recorder; the click handlers run).
// 3. Review round 2 (ADR-020 §11): a receiver our firewall blocked «везде» (the firewall stand, real DNR) is in the
//    history through attempts and blocks only; its history draft quotes no observation and the letter never says the
//    browser sent requests to it.

import { expect, test } from '@playwright/test';
import type { Page, Worker } from '@playwright/test';
import { getServiceWorker } from '../harness';
import { brief, openExtensionPage } from '../helpers';
import { decide, delivered, launchFirewallStand, openStandPage, promptFor, sendAttempts, typeEmail } from './firewall-support';
import { PROTECT_DB, databases, dumpProtectDb, launchProtect, protectRoute } from './support';
import { copiedTexts, installRequestsRecorder, journalRecord, putJournalRecords, sentTypes, swLocalDay, waitRequestsPage, watchExtensionEgress } from './requests-support';
import { evidenceWhere, launchValueMatchStand, openForm, typeAndLeave } from './value-match-support';

const EMAIL = 'canary-letter-stand@example.test';
const IDENTITY = 'stand-identifier-81f2@example.test';

function mailtoParts(href: string): { to: string; subject: string; body: string } {
  const url = new URL(href);
  return { to: url.pathname, subject: url.searchParams.get('subject') ?? '', body: url.searchParams.get('body') ?? '' };
}

async function journalRow(page: Page, index = 0) {
  return page.locator('[data-request-row]').nth(index);
}

// Actions fail with their step instead of running into the test timeout.
test.use({ actionTimeout: 15_000 });

test('module off: no entry points, no reminder request, no journal, no database', async () => {
  test.setTimeout(120_000);
  const ext = await launchProtect();
  try {
    await installRequestsRecorder(ext.context);
    const sw = await getServiceWorker(ext.context);
    const popup = await openExtensionPage(ext.context, sw, 'popup.html');
    await expect(popup.locator('main.app--popup')).toBeVisible({ timeout: 15_000 });
    await popup.waitForTimeout(500);
    expect(await sentTypes(popup)).not.toContain('ui-protect-requests-get');
    await expect(popup.locator('[data-requests-reminder]')).toHaveCount(0);

    const requests = await openExtensionPage(ext.context, sw, 'requests.html#new=manual');
    await waitRequestsPage(requests);
    await expect(requests.locator('[data-requests-module-off]')).toBeVisible();
    await expect(requests.locator('[data-requests-composer]')).toHaveCount(0);
    await expect(requests.locator('[data-requests-journal]')).toHaveCount(0);
    expect(await sentTypes(requests)).not.toContain('ui-protect-request-draft');

    const options = await openExtensionPage(ext.context, sw, 'options.html');
    await expect(options.locator('main.app--options')).toBeVisible();
    await expect(options.locator('[data-requests-options]')).toHaveCount(0);
    const panel = await openExtensionPage(ext.context, sw, 'sidepanel.html');
    await expect(panel.locator('main.app--panel')).toBeVisible();
    await expect(panel.locator('[data-request-entry]')).toHaveCount(0);
    expect(await databases(sw)).not.toContain(PROTECT_DB);
  } finally {
    await ext.close();
  }
});

test('module on: evidence → letter → mailto = preview → copy → journal → sent → deadline, .ics, reminder, directory, long letter, TTL, deletion, export', async () => {
  test.setTimeout(300_000);
  const stand = await launchValueMatchStand(['value-match', 'history']);
  try {
    await installRequestsRecorder(stand.ext.context);
    const egress = watchExtensionEgress(stand.ext.context, stand.sw);
    const sw = stand.sw;

    // A transfer of the e-mail typed on a site (keylogger beacon to example.org), seen as sent.
    const kl = await openForm(stand, 'keylogger-beacon.html');
    await typeAndLeave(stand, kl, '#email', EMAIL);
    const evidence = await evidenceWhere(sw, kl.tabId, (e) => e.receiver === 'example.org' && e.deliveryState === 'sent', 'sent keylogger transfer');

    // History rows of two synthetic directory companies (vendor-sim.test: e-mail, portal-only.test: form).
    for (const payload of [{ evidence: { receiver: 'vendor-sim.test', site: 'example.com' } }, { evidence: { receiver: 'portal-only.test', site: 'example.com' } }, { flush: true }]) {
      await sw.evaluate((p) => (globalThis as unknown as { __protectHarness: { inject(n: string, x: unknown): Promise<unknown> } }).__protectHarness.inject('history', p), payload);
    }

    // Side panel → «Подготовить запрос о данных» on the transfer → requests.html#new=evidence.<id> in a new tab.
    const panel = await openExtensionPage(stand.ext.context, sw, 'sidepanel.html?tabId=' + String(kl.tabId));
    await panel.getByRole('tab', { name: /Protection|Защита/ }).click();
    const entry = panel.locator('[data-request-entry="evidence"]').first();
    await expect(entry).toBeVisible({ timeout: 15_000 });
    const [page] = await Promise.all([stand.ext.context.waitForEvent('page'), entry.click()]);
    await page.waitForLoadState('domcontentloaded');
    expect(new URL(page.url()).hash).toBe('#new=evidence.' + evidence.evidenceId);
    await waitRequestsPage(page);
    await expect(page.locator('[data-requests-draft-badge]')).toBeVisible();
    const composer = page.locator('[data-requests-composer="evidence"]');
    await expect(composer).toBeVisible({ timeout: 15_000 });
    await expect(composer.locator('[data-requests-preview="incomplete"]')).toBeVisible();

    await composer.locator('[data-requests-law]').selectOption('gdpr-eu-eea');
    await composer.locator('[data-requests-lang="en"]').check();
    // Erasure only (the default): the English letter fits a full mailto: link (≤ 2000 characters).
    await expect(composer.locator('[data-requests-kind="erasure"]')).toBeChecked();
    await expect(composer.locator('[data-requests-fact]').first()).toBeVisible();
    await expect(composer.locator('[data-requests-fact] input').first()).toBeChecked();
    await expect(composer.locator('[data-requests-recipient-unknown]')).toBeVisible();
    await composer.locator('[data-requests-identity-kind="typed-identifier"]').check();
    await composer.locator('[data-requests-identifier]').pressSequentially(IDENTITY);
    await composer.locator('[data-requests-manual-address]').pressSequentially('dpo@example.org');
    const body = await composer.locator('[data-requests-body]').inputValue();
    const subject = await composer.locator('[data-requests-subject-line]').inputValue();
    expect(body.split('\n')[0]).toBe('[DRAFT: this template has not been reviewed by a lawyer. Read it and delete this line before sending.]');
    expect(body).toContain('on the site example.com, a request was sent to example.org');
    expect(body.split(IDENTITY)).toHaveLength(2);
    expect(body).not.toContain(EMAIL);
    const mailto = composer.locator('[data-requests-mailto="full"]');
    const parts = mailtoParts((await mailto.getAttribute('href'))!);
    expect(parts).toEqual({ to: 'dpo@example.org', subject, body: body.replace(/\r?\n/g, '\r\n') });
    await mailto.click();
    await expect(page.locator('[data-requests-save-notice]')).toBeVisible();
    await composer.locator('[data-requests-copy]').click();
    await expect.poll(() => copiedTexts(page)).toEqual([body.replace(/\r?\n/g, '\r\n')]);

    // Journal: one prepared entry (no second entry for the same letter); mark it sent today → deadline.
    await expect(page.locator('[data-request-row]')).toHaveCount(1);
    const row = await journalRow(page);
    await expect(row).toHaveAttribute('data-request-status', 'prepared');
    await row.locator('[data-request-next]').selectOption('sent');
    await row.locator('[data-request-apply]').click();
    await expect(row).toHaveAttribute('data-request-status', 'sent');
    await expect(row.locator('[data-request-due="pending"]')).toBeVisible();

    // .ics: the due day and the reminder only.
    await row.locator('[data-request-ics]').click();
    await expect(page.locator('#request-ics-dialog')).toBeVisible();
    const ics = await page.locator('#request-ics-dialog [data-requests-file-text]').innerText();
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('TRIGGER:-P3D');
    for (const forbidden of ['example.org', 'example.com', IDENTITY]) expect(ics).not.toContain(forbidden);
    await page.keyboard.press('Escape');
    await expect(page.locator('#request-ics-dialog')).toHaveCount(0);
    await expect(row.locator('[data-request-ics]')).toBeFocused();

    // Overdue → popup reminder (one summary request when the popup opens).
    const created = await swLocalDay(sw, -60);
    const sent = await swLocalDay(sw, -59);
    await putJournalRecords(sw, [
      journalRecord({ requestId: 'rq_overdueaaaaaaaaaaaaa', createdDay: created, status: 'sent', statusDay: sent, sentDay: sent, deadlineDay: await swLocalDay(sw, -29), extendedDeadlineDay: await swLocalDay(sw, 31), history: [{ status: 'prepared', day: created }, { status: 'sent', day: sent }] }),
      // TTL: a prepared record 31 days old is deleted at the next request.
      journalRecord({ requestId: 'rq_expiredaaaaaaaaaaaaa', createdDay: await swLocalDay(sw, -31) }),
    ]);
    const popup = await openExtensionPage(stand.ext.context, sw, 'popup.html?tabId=' + String(kl.tabId));
    const reminder = popup.locator('[data-requests-reminder]');
    await expect(reminder).toBeVisible({ timeout: 15_000 });
    await expect(reminder).toContainText(/1/);
    expect((await sentTypes(popup)).filter((t) => t === 'ui-protect-requests-get')).toHaveLength(1);
    const dump = await dumpProtectDb(sw);
    expect((dump['requests'] ?? []).map((r) => (r as { requestId: string }).requestId).sort()).toEqual([(await page.locator('[data-request-row]').first().getAttribute('data-request-row'))!, 'rq_overdueaaaaaaaaaaaaa'].sort());

    // A company form from the directory (synthetic portal-only.test): the link is the form; the click copies the text.
    const portal = await openExtensionPage(stand.ext.context, sw, 'requests.html#new=history.d:portal-only.test');
    await waitRequestsPage(portal);
    const pc = portal.locator('[data-requests-composer="history"]');
    await expect(pc).toBeVisible({ timeout: 15_000 });
    await pc.locator('[data-requests-law]').selectOption('gdpr-uk');
    await expect(pc.locator('[data-requests-candidate="portal-only"] input')).toBeChecked();
    const form = pc.locator('[data-requests-portal]');
    await expect(form).toHaveAttribute('href', 'https://privacy.portal-only.test/request');
    await expect(form).toHaveAttribute('target', '_blank');
    await expect(pc.locator('[data-requests-fact="unassessed"] input')).not.toBeChecked();
    await form.click();
    await expect(portal.locator('[data-requests-save-notice]')).toBeVisible();
    expect((await copiedTexts(portal))[0]).toContain('UK General Data Protection Regulation');
    await expect(portal.locator('[data-request-row]')).toHaveCount(3);

    // A reviewed e-mail address from the directory (vendor-sim.test) is preselected with its source day.
    const vendor = await openExtensionPage(stand.ext.context, sw, 'requests.html#new=history.d:vendor-sim.test');
    await waitRequestsPage(vendor);
    const vc = vendor.locator('[data-requests-composer="history"]');
    await vc.locator('[data-requests-law]').selectOption('pdl-ru-152');
    await expect(vc.locator('[data-requests-candidate="vendor-sim"] input')).toBeChecked();
    await expect(vc.locator('[data-requests-ru-note]')).toBeVisible();
    // Long Russian letter: every observation ticked + an identifier → the mailto body is short, the click copies all.
    for (const box of await vc.locator('[data-requests-fact] input').all()) await box.check();
    await vc.locator('[data-requests-identity-kind="typed-identifier"]').check();
    await vc.locator('[data-requests-identifier]').pressSequentially(IDENTITY);
    const longBody = await vc.locator('[data-requests-body]').inputValue();
    expect(longBody.startsWith('[ЧЕРНОВИК:')).toBe(true);
    const short = vc.locator('[data-requests-mailto="short"]');
    const shortParts = mailtoParts((await short.getAttribute('href'))!);
    expect(shortParts.to).toBe('privacy@vendor-sim.test');
    expect(shortParts.body).toBe('[Вставьте сюда полный текст письма: расширение скопировало его в буфер обмена.]');
    expect((await short.getAttribute('href'))!.length).toBeLessThanOrEqual(2000);
    await short.click();
    await expect.poll(() => copiedTexts(vendor)).toEqual([longBody.replace(/\r?\n/g, '\r\n')]);
    await expect(vendor.locator('[data-request-row]')).toHaveCount(4);

    // Back on the first page: reload → TTL removed the expired record; delete one entry; export.
    await page.reload();
    await waitRequestsPage(page);
    await expect(page.locator('[data-request-row]')).toHaveCount(4);
    await expect(page.locator('[data-request-row="rq_expiredaaaaaaaaaaaaa"]')).toHaveCount(0);
    const overdueRow = page.locator('[data-request-row="rq_overdueaaaaaaaaaaaaa"]');
    await expect(overdueRow.locator('[data-request-due="overdue"]')).toBeVisible();
    await overdueRow.locator('[data-request-delete]').click();
    await expect(page.getByRole('alertdialog')).toBeVisible();
    await page.getByRole('alertdialog').locator('button').last().click();
    await expect(page.locator('[data-request-row]')).toHaveCount(3);
    await expect(page.locator('#requests-journal-title')).toBeFocused();

    await page.locator('[data-requests-export]').click();
    await expect(page.locator('#requests-export-dialog')).toBeVisible();
    const preview = page.locator('#requests-export-dialog [data-requests-file-text]');
    const plain = await preview.innerText();
    expect(JSON.parse(plain)).toMatchObject({ kind: 'detect-expert-requests', redacted: true, factsIncluded: false });
    expect(plain).not.toContain('example.com');
    await page.locator('[data-requests-export-facts]').check();
    await expect(page.locator('[data-requests-export-warning]')).toBeVisible();
    await expect(preview).toContainText('example.com');
    expect(await preview.innerText()).not.toContain(IDENTITY);
    await page.keyboard.press('Escape');

    expect(egress.urls()).toEqual([]);
  } finally {
    await stand.close();
  }
});

/** valueMatch / replay / blocked / request day bits of the stored sightings of `receiver` (site → bits set). */
async function sightingBits(sw: Worker, receiver: string): Promise<Record<string, { valueMatch: boolean; replay: boolean; blocked: boolean; request: boolean }>> {
  await sw.evaluate(() => (globalThis as unknown as { __protectHarness: { inject(n: string, x: unknown): Promise<unknown> } }).__protectHarness.inject('history', { flush: true }));
  const any = (m: unknown): boolean => Array.isArray(m) && m.some((w) => w !== 0);
  const out: Record<string, { valueMatch: boolean; replay: boolean; blocked: boolean; request: boolean }> = {};
  for (const row of ((await dumpProtectDb(sw))['sightings'] ?? []) as Array<Record<string, unknown>>) {
    if (row['receiver'] !== receiver || typeof row['site'] !== 'string') continue;
    out[row['site']] = { valueMatch: any(row['valueMatch']), replay: any(row['replay']), blocked: any(row['blocked']), request: any(row['request']) };
  }
  return out;
}

test('history draft: a receiver our firewall blocked is in the history, but the letter quotes no «sent» observation (review round 2)', async () => {
  test.setTimeout(240_000);
  const stand = await launchFirewallStand(['value-match', 'firewall', 'history']);
  try {
    const egress = watchExtensionEgress(stand.context, stand.sw);
    const decider = await openStandPage(stand, 'www.example.org', 'leak-form.html');
    await promptFor(stand, decider);
    const res = await decide(stand, decider, ['example.net'], 'block', 'everywhere');
    expect(res, brief(res)).toMatchObject({ type: 'protect-decision', applied: [{ receiver: 'example.net', ruleApplied: true }] });
    for (const host of ['www.example.com', 'www.example.org']) {
      const sp = await openStandPage(stand, host, 'leak-form.html');
      await typeEmail(stand, sp, 'canary-blocked-letter@example.test');
      await sendAttempts(sp);
    }
    expect(delivered(stand), 'our rule stopped every send').toBe(0);
    // The history holds example.net on both sites (attempts from the observation reports, SP-2, and our blocks) and
    // no send Chrome reported (no value-match, no replay day).
    await expect.poll(async () => {
      const bits = await sightingBits(stand.sw, 'example.net');
      return { sites: Object.keys(bits).sort(), blocked: Object.values(bits).some((b) => b.blocked), sent: Object.values(bits).some((b) => b.valueMatch || b.replay) };
    }, { timeout: 20_000, message: 'example.net sightings: attempts and blocks, no send' }).toEqual({ sites: ['example.com', 'example.org'], blocked: true, sent: false });

    // The draft names the receiver and quotes no observation (the source exists: not «missing»).
    const draft = await protectRoute(stand.sw, { type: 'ui-protect-request-draft', sourceKind: 'history', recordId: 'd:example.net' });
    expect(draft, brief(draft)).toMatchObject({ type: 'protect-request-draft', draft: { sourceKind: 'history', sourceMissing: false, facts: [] } });

    // requests.html: no observation rows; the letter names neither site and never says the browser sent requests.
    const page = await openExtensionPage(stand.context, stand.sw, 'requests.html#new=history.d:example.net');
    await waitRequestsPage(page);
    const composer = page.locator('[data-requests-composer="history"]');
    await expect(composer).toBeVisible({ timeout: 15_000 });
    await expect(composer.locator('[data-requests-source-missing]')).toHaveCount(0);
    await expect(composer.locator('[data-requests-fact]')).toHaveCount(0);
    await expect(composer.locator('[data-requests-entity]')).toHaveValue('example.net');
    for (const [law, lang] of [['gdpr-eu-eea', 'en'], ['gdpr-eu-eea', 'ru']] as const) {
      await composer.locator('[data-requests-law]').selectOption(law);
      await composer.locator('[data-requests-lang="' + lang + '"]').check();
      // No directory address for example.net: «только скопировать».
      await composer.locator('[data-requests-recipient-unknown]').waitFor();
      await composer.locator('[data-requests-recipient-kind="none"]').check();
      const body = await composer.locator('[data-requests-body]').inputValue();
      expect(body, body).not.toMatch(/sent requests|отправлял запросы/);
      for (const site of ['example.com', 'example.org']) expect(body).not.toContain(site);
    }
    expect(egress.urls()).toEqual([]);
  } finally {
    await stand.close();
  }
});
