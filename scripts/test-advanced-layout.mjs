// ADR-030/031/032: read-only native geometry for all shipped advanced surfaces.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { chromium } from 'playwright';
import { companyFixtureFiles, companyFixtureContentType } from './production/company-test-files.mjs';
import { PRODUCTION_LANGUAGES } from './production-languages.mjs';
import { applyAdvancedCopy } from './production-locales-advanced.mjs';
import { decodeBeacon } from '../apps/production-extension/beacon-decoder.js';
import { readBeaconSnapshot } from '../packages/contracts/src/beacons.mjs';
import { readBackgroundSnapshot } from '../packages/contracts/src/background-activity.mjs';
import { readCookieProbeSnapshot } from '../packages/contracts/src/cookie-probe.mjs';

const root = resolve(import.meta.dirname, '..'), temporary = join(root, '.tmp'), artifact = join(root, 'test-results/production-1.1.0/inspection');
mkdirSync(temporary, { recursive: true }); mkdirSync(artifact, { recursive: true });
const run = mkdtempSync(join(temporary, 'advanced-layout-native-'));
const files = new Map([
  ...companyFixtureFiles(root),
  ...['advanced-ui.js', 'advanced-ui.css', 'beacon-contracts.js', 'background-activity-contracts.js', 'cookie-probe-contracts.js', 'ui.css', 'popup.css', 'sidepanel.css', 'pro.css', 'report.css'].map(name => ['/production/' + name, join(root, 'apps/production-extension', name)]),
  ['/preact.module.js', join(root, 'node_modules/preact/dist/preact.module.js')], ['/preact.hooks.js', join(root, 'node_modules/preact/hooks/dist/hooks.module.js')]
]);
const longHost = ['a'.repeat(63), 'b'.repeat(63), 'c'.repeat(63), 'd'.repeat(56), 'test'].join('.'); assert.equal(longHost.length, 253);
const documentKey = '42:0:layout';
const decoded = decodeBeacon({ url: 'https:' + '//www.facebook.com/tr/?ev=Purchase&cd[value]=49.99&cd[currency]=EUR&ud[em]=' + 'f'.repeat(64), method: 'GET' });
const browserRow = { ...decoded, method: 'GET', requestType: 'image', count: 2147483647, completedCount: 2147483600, failedCount: 30, redirectCount: 4, statusCodes: Array.from({ length: 16 }, (_, index) => 200 + index), evidenceSource: 'browser-network', integrity: 'browser-observed', attributionConfidence: 'frame-only', initiatorHost: longHost, script: null,
  events: ['Purchase', 'PageView', 'AddToCart'], money: [{ purpose: 'value', value: '49.99', currency: 'EUR', event: 'Purchase' }, { purpose: 'goal-value', value: '999999999.999999', currency: 'USD', event: 'Purchase' }, { purpose: 'revenue', value: '-99.99', currency: 'AED', event: 'Purchase' }],
  identifiers: { clientId: 'present', browserId: 'absent', sessionId: 'unknown', userId: 'ambiguous', hashedEmail: 'present', hashedPhone: 'invalid' }, consent: { gcs: 'present', gcd: 'unknown', adUserData: 'denied', adPersonalization: 'granted' }, parameterNames: ['event', 'value', 'currency', 'client-id', 'browser-id', 'session-id', 'user-id', 'hashed-email', 'hashed-phone', 'consent', 'conversion-id'] };
const beacon = readBeaconSnapshot({ schemaVersion: 1, type: 'beacons-state', documentKey, coverageState: 'partial', requestCount: browserRow.count, rows: [browserRow], scriptCalls: [{ ...browserRow, evidenceSource: 'page-hook', integrity: 'page-controlled', count: 1, completedCount: 0, failedCount: 0, redirectCount: 0, statusCodes: [], attributionConfidence: 'exact-resource', script: { host: longHost, pathTemplate: '/main.js' } }], truncated: true }); assert.ok(beacon);
const background = readBackgroundSnapshot({ schemaVersion: 1, type: 'background-activity-state', documentKey, coverageState: 'partial', observedAt: 1791548748000, truncated: true,
  rows: ['ServiceWorkerContainer.register', 'PushManager.subscribe', 'PeriodicSyncManager.register', 'SyncManager.getTags', 'Notification.requestPermission'].map((operation, index) => ({ operation, phase: index % 2 ? 'threw-sync' : 'async-returned', count: 2147483647, evidenceSource: 'page-hook', integrity: 'page-controlled', attributionConfidence: 'exact-resource', script: { host: longHost, pathTemplate: '/main.js' }, worker: operation === 'ServiceWorkerContainer.register' ? { host: longHost, pathTemplate: '/sw.js' } : null })),
  inventory: { status: 'available', secureContext: true, supported: { serviceWorker: true, push: true, sync: true, periodicSync: true }, permissions: { notifications: 'granted', push: 'prompt', sync: 'granted', periodicSync: 'denied' }, registrationCount: 1, pushSubscriptionCount: 1, syncTagCount: 4096, periodicTagCount: null, checkedAt: 1791548748000, truncated: true,
    registrations: [{ scope: { host: longHost, pathTemplate: '/<scope>' }, script: { host: longHost, pathTemplate: '/sw.js' }, state: 'activated', pushSubscribed: true, syncTagCount: 4096, periodicTagCount: null }] } }); assert.ok(background);
const probe = readCookieProbeSnapshot({ schemaVersion: 1, type: 'cookie-probe-state', documentKey, status: 'complete', result: 'restored-same', reason: 'none', cookieName: '_ga_' + 'A'.repeat(76), domain: longHost, owner: 'Synthetic owned fixture', removalConfirmed: true, observedRestorations: 32, source: 'unknown', cleanup: 'restored', startedAt: 1000, completedAt: 2000, windowMs: 10000, matchedStores: [{ storage: 'localStorage', count: 64 }, { storage: 'indexedDB', count: 64 }, { storage: 'cacheStorage', count: 64 }], storageCoverage: 'partial' }); assert.ok(probe);
const cookies = { state: { entries: [{ name: probe.cookieName, domain: longHost, tracking: true, httpOnly: false, session: false }] }, handles: ['a'.repeat(32)], busy: false };
const fixturePage = { beacons: [beacon], backgroundActivity: [background], cookieProbes: [probe] };
const unsupportedBackground = readBackgroundSnapshot({ ...background, inventory: { status: 'unsupported', secureContext: true, supported: { serviceWorker: false, push: false, sync: false, periodicSync: false }, permissions: { notifications: 'unknown', push: 'unsupported', sync: 'unsupported', periodicSync: 'unsupported' }, registrationCount: null, pushSubscriptionCount: null, syncTagCount: null, periodicTagCount: null, registrations: [], truncated: false, checkedAt: 1791548748000 } }); assert.ok(unsupportedBackground);
const unsupportedPage = { ...fixturePage, backgroundActivity: [unsupportedBackground] };
const fixtureScript = `
import {h,render} from '/preact.module.js';
import {useState,useEffect,useRef} from '/preact.hooks.js';
import {createAdvancedUi} from '/production/advanced-ui.js';
const surface=document.getElementById('surface'),mount=document.getElementById('root'),link=document.getElementById('surface-style');let sequence=0;
window.renderAdvancedFixture=async({locale,tag,table,width,mode,kind,beacon,background,probe,cookies,page})=>{
  document.documentElement.lang=tag;document.documentElement.dir=['ar','ur'].includes(locale)?'rtl':'ltr';
  const css=mode==='report'?'report.css':mode==='popup'?'popup.css':'sidepanel.css';
  if(!link.href.endsWith('/'+css))await new Promise((done,fail)=>{link.onload=done;link.onerror=fail;link.href='/production/'+css;});
  document.getElementById('pro-style').disabled=mode==='report';surface.className=mode==='report'?'pro-report-app':'app inspector app--'+(mode==='popup'?'popup':'panel');
  surface.style.width=mode==='report'?'':width+'px';mount.className=mode==='report'?'pro-report':'';const style=getComputedStyle(surface),available=surface.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight);mount.style.width=mode==='report'?Math.min(width,available)+'px':'';
  const translate=(key,substitutions=[])=>{const entry=table[key];if(!entry)throw Error('Missing localized key: '+key);let text=entry.message;for(const[name,value]of Object.entries(entry.placeholders??{}))text=text.replaceAll('$'+name.toUpperCase()+'$',substitutions[Number(value.content.slice(1))-1]??'');return text;};
  const ui=createAdvancedUi({h,useState,useEffect,useRef,useLocale:()=>locale,translate});const key=++sequence;
  const component=kind==='beacon'?h(ui.BeaconPanel,{key,beacons:{state:beacon,pending:false,eligible:true,refresh(){window.refreshes=(window.refreshes??0)+1;}}}):kind==='background'?h(ui.BackgroundPanel,{key,backgroundActivity:{state:background,pending:false,eligible:true,refresh(){window.backgroundRefreshes=(window.backgroundRefreshes??0)+1;}}}):kind==='cookie'?h(ui.CookieProbePanel,{key,probe:{state:probe,pending:false,eligible:true,start(handle){window.probeStarts=(window.probeStarts??[]).concat(handle);},cancel(){window.probeCancels=(window.probeCancels??0)+1;}},cookies:{...cookies,hideValue(){window.hideValues=(window.hideValues??0)+1;}}}):h(ui.ProAdvancedSnapshot,{key,page});
  render(component,mount);await new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)));
};window.advancedLayoutReady=true;`;
const html = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Owned advanced layout fixture</title>' +
  '<link rel="stylesheet" href="/production/ui.css"><link rel="stylesheet" href="/production/advanced-ui.css"><link id="pro-style" rel="stylesheet" href="/production/pro.css"><link id="surface-style" rel="stylesheet" href="/production/sidepanel.css"></head><body><main id="surface"><div id="root"></div></main><script type="module" src="/fixture.js"></script></body></html>';
const evidence = { cases: [], checks: [], errors: [], unexpectedRequests: [], fixture: 'Owned loopback; shipped Preact component/CSS; canonical redacted projections; no browser actions or network probes' };
const server = createServer((request, response) => {
  response.setHeader('Cache-Control', 'no-store'); const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
  if (pathname === '/favicon.ico') { response.writeHead(204); response.end(); return; }
  if (pathname === '/') { response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end(html.replace('</head>', '<link rel="stylesheet" href="/production/company-ui.css"></head>')); return; }
  if (pathname === '/fixture.js') { response.setHeader('Content-Type', 'application/javascript'); response.end(fixtureScript); return; }
  const file = files.get(pathname); if (!file) { evidence.unexpectedRequests.push(pathname); response.writeHead(404); response.end(); return; }
  response.setHeader('Content-Type', companyFixtureContentType(file)); const content = readFileSync(file); response.end(pathname === '/preact.hooks.js' ? content.toString('utf8').replaceAll('from"preact"', 'from"/preact.module.js"') : content);
});
await new Promise(done => server.listen(0, '127.0.0.1', done)); const origin = 'http://127.0.0.1:' + server.address().port;
let context;
try {
  context = await chromium.launchPersistentContext(join(run, 'profile'), { channel: 'chromium', headless: true, viewport: { width: 1120, height: 900 }, args: ['--no-proxy-server'] }); evidence.browser = context.browser().version();
  await context.route('**/*', async route => { if (new URL(route.request().url()).origin === origin) await route.continue(); else { evidence.unexpectedRequests.push(route.request().url()); await route.abort(); } });
  const browserPage = await context.newPage(); browserPage.on('pageerror', error => evidence.errors.push(error.message)); await browserPage.goto(origin); await browserPage.waitForFunction(() => window.advancedLayoutReady);
  const catalogues = new Map(PRODUCTION_LANGUAGES.map(language => [language.id, applyAdvancedCopy(JSON.parse(readFileSync(join(root, 'apps/production-extension', language.uiOnly ? 'ui-locales' : '_locales', language.id, 'messages.json'), 'utf8')), language.id)]));
  const configure = (language, width, kind, mode = 'sidepanel', state = probe, page = fixturePage, activity = background) => browserPage.evaluate(payload => window.renderAdvancedFixture(payload), { locale: language.id, tag: language.tag, table: catalogues.get(language.id), width, kind, mode, beacon, background: activity, probe: state, cookies, page });
  const inspect = () => browserPage.evaluate(() => {
    const overflow = [], overlap = [];
    for (const element of document.querySelectorAll('.advanced-inspector,.advanced-heading,.advanced-actions,.advanced-card,.advanced-fact,.advanced-fact>dt,.advanced-fact>dd,.cookie-probe-select,.cookie-probe-select select,.cookie-probe-result,p,h2,h3,h4')) {
      if (getComputedStyle(element).display !== 'none' && element.clientWidth > 0 && element.scrollWidth > element.clientWidth + 1) overflow.push({ class: element.className, tag: element.tagName, width: element.clientWidth, scrollWidth: element.scrollWidth, text: element.textContent.slice(0, 100) });
    }
    for (const fact of document.querySelectorAll('.advanced-fact')) {
      const dt = fact.querySelector(':scope>dt'), dd = fact.querySelector(':scope>dd'); if (!dt || !dd || getComputedStyle(fact).display !== 'grid') continue;
      const left = dt.getBoundingClientRect(), right = dd.getBoundingClientRect(); if (Math.min(left.right, right.right) - Math.max(left.left, right.left) > 1 && Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top) > 1) overlap.push(dt.textContent.slice(0, 80));
    }
    const visible = selector => { const element = document.querySelector(selector); return !!element && element.getBoundingClientRect().height > 0 && getComputedStyle(element).display !== 'none'; };
    return { direction: document.documentElement.dir, viewport: innerWidth, documentWidth: document.documentElement.scrollWidth, overflow, overlap, beaconRows: document.querySelectorAll('[data-beacon-row]').length, backgroundRows: document.querySelectorAll('[data-background-row]').length, capabilities: document.querySelectorAll('[data-background-capability]').length, registrations: document.querySelectorAll('[data-background-registrations]').length, unavailable: visible('[data-background-inventory-unavailable]'), unavailableText: document.querySelector('[data-background-inventory-unavailable]')?.textContent ?? null, cookieResult: visible('[data-cookie-probe-result]'), pro: ['[data-pro-beacons]', '[data-pro-background]', '[data-pro-cookie-probes]'].map(visible), selectWidth: document.querySelector('select')?.getBoundingClientRect().width ?? null, countVisible: document.body.textContent.includes('2147483647'), longHostVisible: document.body.textContent.includes('a'.repeat(63) + '.' + 'b'.repeat(63)), moneyVisible: document.body.textContent.includes('49.99'), buttons: [...document.querySelectorAll('button')].map(button => ({ width: button.getBoundingClientRect().width, height: button.getBoundingClientRect().height, disabled: button.disabled })) };
  });
  const verify = async (language, width, kind, mode = 'sidepanel', state = probe, page = fixturePage, activity = background) => {
    await configure(language, width, kind, mode, state, page, activity); const result = await inspect(); const unsupported = activity.inventory.checkedAt > 0 && activity.inventory.status === 'unsupported'; const description = `${language.id}: ${kind} ${width} ${mode}${unsupported ? ' isolated-inventory-unavailable' : ''}`;
    evidence.cases.push({ description, ...result }); assert.deepEqual(result.overflow, [], description + ': horizontal element overflow'); assert.deepEqual(result.overlap, [], description + ': caption/value overlap'); assert.ok(result.documentWidth <= result.viewport + 1, description + ': document overflow'); assert.equal(result.longHostVisible, true, description + ': retained long host');
    if (kind === 'beacon' || kind === 'pro') { assert.equal(result.beaconRows, 2); assert.equal(result.moneyVisible, true); }
    if (kind === 'background' || kind === 'pro') { assert.equal(result.backgroundRows, 5); assert.equal(result.capabilities, unsupported ? 0 : 4); assert.equal(result.registrations, unsupported ? 0 : 1); assert.equal(result.unavailable, unsupported); if (unsupported) assert.equal(result.unavailableText, catalogues.get(language.id).advanced_unavailable.message); }
    if (kind === 'cookie' || kind === 'pro') assert.equal(result.cookieResult, true);
    if (kind === 'pro') assert.deepEqual(result.pro, [true, true, true]);
    if (kind === 'cookie') assert.ok(result.selectWidth > 0 && result.selectWidth <= width);
  };
  for (const language of PRODUCTION_LANGUAGES) for (const width of [280, 380, 560, 760]) for (const kind of ['beacon', 'background', 'cookie', 'pro']) await verify(language, width, kind, kind === 'pro' ? 'report' : 'sidepanel');
  evidence.checks.push('21 languages × four widths × four surfaces: complete fields, captions, controls and no horizontal overflow');
  for (const language of PRODUCTION_LANGUAGES) for (const kind of ['background', 'pro']) await verify(language, 280, kind, kind === 'pro' ? 'report' : 'sidepanel', probe, unsupportedPage, unsupportedBackground);
  evidence.checks.push('21 languages × live/Pro: unavailable isolated inventory is localized, capability/registration cards absent, and all MAIN operation rows retained');
  const english = PRODUCTION_LANGUAGES.find(language => language.id === 'en');
  for (const locale of ['en', 'ru', 'ar']) {
    const language = PRODUCTION_LANGUAGES.find(item => item.id === locale); await browserPage.setViewportSize({ width: 380, height: 900 }); await verify(language, 380, 'pro', 'report');
    await browserPage.screenshot({ path: join(artifact, 'advanced-layout-' + locale + '.png'), fullPage: true });
  }
  evidence.checks.push('English, Russian and RTL screenshots of the actual narrow Pro projection');
  await browserPage.setViewportSize({ width: 380, height: 900 }); await verify(english, 380, 'beacon', 'popup'); await browserPage.locator('button').click(); assert.equal(await browserPage.evaluate(() => window.refreshes), 1);
  await verify(english, 380, 'background', 'popup'); await browserPage.locator('[data-background-refresh]').click(); assert.equal(await browserPage.evaluate(() => window.backgroundRefreshes), 1);
  await verify(english, 380, 'cookie', 'popup'); await browserPage.locator('select').selectOption('a'.repeat(32)); await browserPage.locator('[data-cookie-probe-start]').click(); assert.deepEqual(await browserPage.evaluate(() => window.probeStarts), ['a'.repeat(32)]); assert.equal(await browserPage.evaluate(() => window.hideValues), 1);
  const watching = { ...probe, status: 'watching', result: 'none', cleanup: 'none', observedRestorations: 0, completedAt: 0 }; assert.ok(readCookieProbeSnapshot(watching));
  await verify(english, 380, 'cookie', 'popup', watching); await browserPage.locator('[data-cookie-probe-cancel]').click(); assert.equal(await browserPage.evaluate(() => window.probeCancels), 1); evidence.checks.push('real Preact refresh, explicit diagnostic check, selected-cookie start and cancel dispatch their owned handlers');
  await browserPage.setViewportSize({ width: 794, height: 1123 }); await verify(english, 680, 'pro', 'report'); await browserPage.emulateMedia({ media: 'print' }); await verify(english, 680, 'pro', 'report');
  await browserPage.pdf({ path: join(artifact, 'advanced-layout-chrome.pdf'), format: 'A4', printBackground: true }); evidence.checks.push('A4 preview and print preserve all three Pro sections and complete field metadata');
  assert.deepEqual(evidence.errors, []); assert.deepEqual(evidence.unexpectedRequests, []); evidence.checks.push('no page exceptions or external requests');
  evidence.sha256 = Object.fromEntries(['advanced-ui.js', 'advanced-ui.css', 'beacon-contracts.js', 'background-activity-contracts.js', 'cookie-probe-contracts.js'].map(name => [name, createHash('sha256').update(readFileSync(join(root, 'apps/production-extension', name))).digest('hex')]));
  console.log('PASS: native advanced layout (' + evidence.cases.length + ' cases, ' + evidence.checks.length + ' checks)');
} finally {
  writeFileSync(join(artifact, 'advanced-layout-chrome.json'), JSON.stringify(evidence, null, 2) + '\n'); await context?.close(); server.closeAllConnections(); await new Promise(done => server.close(done));
  const owned = resolve(run); assert.ok(owned.startsWith(temporary + sep)); rmSync(owned, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
