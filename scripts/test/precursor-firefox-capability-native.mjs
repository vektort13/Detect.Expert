// Read-only proof in an owned Firefox profile. Only enum/count metadata exits ISOLATED.
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { launchOwnedManagement, until } from './management-browser-fixture.mjs';
const root = resolve(import.meta.dirname, '../..');
mkdirSync(join(root, '.tmp'), { recursive: true });
const run = mkdtempSync(join(root, '.tmp/precursor-firefox-capability-')), extension = join(run, 'extension');
cpSync(join(root, 'dist/firefox'), extension, { recursive: true });
const evidence = { at: new Date().toISOString(), result: 'RUNNING', rawUrlsPersisted: false, checks: [] };
let opened;
try {
  opened = await launchOwnedManagement({ root, run, extension, browser: 'firefox', evidence });
  evidence.version = opened.version;
  await opened.goto(opened.base + 'options.html#settings');
  await until(() => opened.evaluate(() => Boolean(document.querySelector('[data-management-shell]'))), 'Options ready');
  await opened.click('#options-scope-all-sites');
  await opened.click('form.scope:has(#options-scope-all-sites) button[type="submit"]');
  await until(() => opened.evaluate(async () => (await browser.runtime.sendMessage({ schemaVersion: 1, type: 'ui-get-scope' })).scope?.scopeMode === 'all-sites'), 'scope all sites');
  const site = process.argv.includes('--cloudflare') ? 'https://blog.cloudflare.com/good-and-bad-agentic-behaviors/' : process.argv.includes('--stackoverflow') ? 'https://stackoverflow.com/' : 'https://luma.com/';
  const tabId = await opened.evaluate(async url => (await browser.tabs.create({ url, active: true })).id, site);
  const read = () => opened.evaluate(async tabId => {
    const values = await browser.scripting.executeScript({ target: { tabId, frameIds: [0] }, world: 'ISOLATED', func: () => {
      const getter = (prototype, key) => Object.getOwnPropertyDescriptor(prototype, key)?.get;
      const name = getter(PerformanceEntry.prototype, 'name'), initiator = getter(PerformanceResourceTiming.prototype, 'initiatorType');
      const content = getter(PerformanceResourceTiming.prototype, 'contentType'), status = getter(PerformanceResourceTiming.prototype, 'responseStatus');
      const available = [name, initiator, content, status].every(value => typeof value === 'function');
      const evidence = { available, firefoxRuntime: typeof browser.runtime.getBrowserInfo === 'function', ownFirefoxOrigin: browser.runtime.getURL('').startsWith('moz-extension://'), privateIdentity: /^[a-f0-9]{32}$/.test(globalThis.__detectExpertIsolatedDocumentV1 ?? ''), entries: 0, scripts: 0, sameOriginJavaScript: 0, count: 0, successfulJavaScript: 0, contentTypes: [], statuses: [], truncated: false };
      if (!available) return evidence;
      const entries = Reflect.apply(Performance.prototype.getEntriesByType, performance, ['resource']);
      evidence.entries = Math.min(entries.length, 2049);
      if (entries.length > 2048) { evidence.truncated = true; return evidence; }
      for (const entry of entries) {
        const raw = Reflect.apply(name, entry, []);
        if (typeof raw !== 'string' || raw.length > 16384) continue;
        let url; try { url = new URL(raw); } catch { continue; }
        if (Reflect.apply(initiator, entry, []) !== 'script') continue;
        evidence.scripts++;
        if (url.origin !== location.origin) continue;
        if (['text/javascript', 'application/javascript'].includes(Reflect.apply(content, entry, [])) && Reflect.apply(status, entry, []) >= 200 && Reflect.apply(status, entry, []) < 300) evidence.sameOriginJavaScript++;
        if (!/^\/cdn-cgi\/challenge-platform\/h\/g\/scripts\/precursor\/[a-f0-9]{12}\/main\.js$/.test(url.pathname)) continue;
        evidence.count++;
        const mime = Reflect.apply(content, entry, []), code = Reflect.apply(status, entry, []);
        const category = ['text/javascript', 'application/javascript'].includes(mime) ? 'javascript' : mime === '' ? 'empty' : 'other';
        if (!evidence.contentTypes.includes(category)) evidence.contentTypes.push(category);
        const response = Number.isInteger(code) && code >= 200 && code < 300 || code === 304 ? 'success' : code === 0 ? 'unavailable' : 'other';
        if (!evidence.statuses.includes(response)) evidence.statuses.push(response);
        if (category === 'javascript' && response === 'success') evidence.successfulJavaScript++;
      }
      return evidence;
    } });
    return values[0]?.result ?? null;
  }, tabId);
  evidence.observation = await until(async () => { try { const result = await read(); evidence.lastObservation = result; return result?.sameOriginJavaScript && result.privateIdentity ? result : null; } catch { return null; } }, 'native successful JavaScript timing', 30000);
  assert.equal(evidence.observation.available, true);
  assert.equal(evidence.observation.ownFirefoxOrigin, true);
  evidence.checks.push('Firefox native responseStatus/contentType getters available in ISOLATED', 'ordinary navigation exposes successful same-origin JavaScript timing', 'existing bridge private identity is present', 'only counts and finite enum metadata leave ISOLATED');
  evidence.precursorObserved = evidence.observation.successfulJavaScript > 0;
  evidence.result = 'PASS';
} catch (error) { evidence.result = 'FAIL'; evidence.error = String(error.message).replace(/https?:\/\/\S+/g, '[url]').slice(0, 200); process.exitCode = 1; }
finally { if (opened) await opened.close(); evidence.finishedAt = new Date().toISOString(); writeFileSync(join(root, 'test-results/precursor-modes-2026-10-30/firefox-capability-native.json'), JSON.stringify(evidence, null, 2) + '\n'); }
console.log(JSON.stringify(evidence));
