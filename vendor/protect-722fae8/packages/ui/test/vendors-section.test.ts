// S10 / ADR-009 v1.1: «Распознанные сервисы защиты и идентификации» rendered in Chromium through the existing
// browser harness. Without an active catalog the markup is byte-identical to the pre-S10 one; with one, a card says
// what was matched and what it does not mean, and the section always ends with the no-trust disclaimer.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import type { Browser, Page } from 'playwright';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { report, vendor } from './fixtures';
import type {} from './browser-harness';

type Table = Parameters<Window['uiAudit']['mount']>[1];
const table = (locale = 'en') => JSON.parse(readFileSync(resolve('apps/extension/_locales', locale, 'messages.json'), 'utf8')) as Table;
const m = (t: Table, key: string, ...subs: string[]): string => {
  const entry = t[key]!;
  return entry.message.replace(/\$([A-Z_]+)\$/gi, (_, name: string) => subs[Number(entry.placeholders![name.toLowerCase()]!.content.slice(1)) - 1]!);
};

let browser: Browser;
let page: Page;
let script: string;
beforeAll(async () => {
  script = (await build({ entryPoints: ['packages/ui/test/browser-harness.ts'], bundle: true, write: false, format: 'iife', jsx: 'automatic', jsxImportSource: 'preact' })).outputFiles[0]!.text;
  browser = await chromium.launch({ headless: true, channel: 'chromium' });
}, 30_000);
beforeEach(async () => { page = await browser.newPage(); await page.addScriptTag({ content: script }); });
afterEach(async () => { await page.close(); });
afterAll(async () => { await browser?.close(); });

async function render(rep: ReturnType<typeof report> | null, options: { coverageLimited?: boolean; locale?: 'ru' | 'en' } = {}): Promise<string> {
  const messages = table(options.locale ?? 'en');
  await page.evaluate(({ rep, messages, options }) => {
    window.uiAudit.report = rep;
    window.uiAudit.vendorsSection(messages, options);
  }, { rep, messages, options });
  // Canonical serialization of the rendered tree (tags, attributes in order, text) without reading markup strings.
  return page.evaluate(() => {
    const ser = (n: Node): string => n.nodeType === Node.TEXT_NODE ? n.textContent ?? '' : n instanceof Element
      ? '<' + n.localName + Array.from(n.attributes, (a) => ' ' + a.name + '="' + a.value + '"').join('') + '>' + Array.from(n.childNodes, ser).join('') + '</' + n.localName + '>'
      : '';
    return Array.from(document.body.lastElementChild!.childNodes, ser).join('');
  });
}

describe('VendorsSection (S10)', () => {
  it('catalogVersion null: the pre-S10 markup byte for byte (popup screenshots stay unchanged)', async () => {
    const t = table();
    const expected = '<section class="section" aria-labelledby="vendors-title"><h2 id="vendors-title" class="section__title">' + m(t, 'vendorsSectionTitle') +
      '</h2><p class="muted">' + m(t, 'vendors_catalog_unavailable') + '</p><p class="small muted">' + m(t, 'card_vendor_no_trust') + '</p></section>';
    expect(await render(report())).toBe(expected);
    // Vendors without a catalog version are never shown (the SW did not evaluate them).
    expect(await render(report({ vendors: [vendor({ vendorId: 'threatmetrix' })] }))).toBe(expected);
    expect(await render(null)).toBe(expected);
  });

  it('evaluated empty result: vendorsEmpty, the coverage note only when access is limited, then the disclaimer', async () => {
    const t = table();
    await render(report({ catalogVersion: 'synthetic-test-1' }), { coverageLimited: true });
    const texts = await page.locator('section > p').allTextContents();
    expect(texts).toEqual([m(t, 'vendorsEmpty'), m(t, 'vendors_coverage_limited'), m(t, 'card_vendor_no_trust')]);
    await render(report({ catalogVersion: 'synthetic-test-1', scopeMode: 'all-sites' }), { coverageLimited: false });
    expect(await page.locator('section > p').allTextContents()).toEqual([m(t, 'vendorsEmpty'), m(t, 'card_vendor_no_trust')]);
  });

  it('a card: name and purpose from the catalog, request-only, rule line, details, integrity, not linked; disclaimer last', async () => {
    const t = table();
    const version = '2026-10-17.ui000001';
    await render(report({ catalogVersion: version, vendors: [vendor({ vendorId: 'threatmetrix', ruleIds: ['tmx-tags-endpoint'] })] }));
    const card = page.locator('article.card--vendor');
    expect(await card.count()).toBe(1);
    expect(await card.locator('h3').textContent()).toBe(m(t, 'card_vendor_found', 'LexisNexis ThreatMetrix'));
    const paragraphs = await card.locator(':scope > p').allTextContents();
    expect(paragraphs[0]).toBe(m(t, 'card_vendor_purpose', m(t, 'card_vendor_threatmetrix_purpose')));
    expect(paragraphs).toContain(m(t, 'card_vendor_request_only'));
    expect(paragraphs).toContain(m(t, 'card_vendor_match_documented_resource'));
    expect(paragraphs.at(-1)).toBe(m(t, 'card_vendor_not_linked'));
    expect(await card.locator('li').allTextContents()).toEqual([m(t, 'card_vendor_rule_line', 'tmx-tags-endpoint', '3', version)]);
    expect(await card.locator('details').getAttribute('open')).toBeNull();
    expect(await card.locator('details summary').textContent()).toBe(m(t, 'card_vendor_details'));
    expect(await card.locator('details p').allTextContents()).toEqual([
      m(t, 'card_vendor_rule_meaning', 'The browser received test resource A.'),
      m(t, 'card_vendor_rule_limitations', 'Does not mean A ran.'),
    ]);
    expect(await card.locator('.badge').textContent()).toBe(m(t, 'integrity_browser_observed'));
    expect(await page.locator('section > p').last().textContent()).toBe(m(t, 'card_vendor_no_trust'));
    // No positive or trust wording and no "ok" badge (REQ-007).
    const text = (await page.locator('section').textContent()) ?? '';
    expect(text).not.toMatch(/\b(trusted|verified|confirmed|legitimate|secure|safe)\b/i);
    expect(await page.locator('[class*="success"], [class*="--ok"], [class*="positive"]').count()).toBe(0);
  });

  it('ru: rule texts follow the UI locale; a weak network signal uses the "without an exact resource" wording', async () => {
    const t = table('ru');
    await render(report({ catalogVersion: 'x1', vendors: [vendor({ vendorId: 'threatmetrix', ruleIds: ['tmx-tags-endpoint'] }), vendor({ vendorId: 'datadome', vendorConfidence: 'weak-signal', ruleIds: ['datadome-host'] })] }), { locale: 'ru' });
    const cards = page.locator('article.card--vendor');
    expect(await cards.count()).toBe(2);
    expect(await cards.nth(0).locator('details p').first().textContent()).toBe(m(t, 'card_vendor_rule_meaning', 'Браузер получил тестовый ресурс A.'));
    expect(await cards.nth(1).locator(':scope > p').allTextContents()).toContain(m(t, 'card_vendor_match_weak_signal_network'));
    expect(await cards.nth(1).locator('h3').textContent()).toBe(m(t, 'card_vendor_found', 'DataDome Bot Protect'));
    const text = (await page.locator('section').textContent()) ?? '';
    expect(text).not.toMatch(/подтвержд|легитим|доверя/i);
  });

  it('repeated sections keep unique ids and every card heading reference', async () => {
    await page.evaluate(({ rep, messages }) => { window.uiAudit.report = rep; window.uiAudit.vendorsSection(messages); window.uiAudit.vendors(); }, { rep: report({ catalogVersion: 'x1', vendors: [vendor({ vendorId: 'same' })] }), messages: table() });
    expect(await page.locator('article').count()).toBe(2);
    expect(await page.evaluate(() => {
      const ids = Array.from(document.querySelectorAll('[id]'), (node) => node.id);
      return new Set(ids).size === ids.length && Array.from(document.querySelectorAll('article[aria-labelledby]')).every((node) => node.contains(document.getElementById(node.getAttribute('aria-labelledby')!)));
    })).toBe(true);
  });
});
