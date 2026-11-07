// ADR-078: real extension-origin rendering with an owned, synthetic catalogue fixture.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { launchOwnedManagement, until, pause } from './management-browser-fixture.mjs';

const root = resolve(import.meta.dirname, '../..'), browser = process.argv.includes('--firefox') ? 'firefox' : 'chrome';
const overlay = process.argv.includes('--source-overlay');
const artifactIndex = process.argv.indexOf('--artifact-dir');
const artifact = resolve(root, artifactIndex < 0 ? 'test-results/site-systems' : process.argv[artifactIndex + 1]);
assert.ok(artifact.startsWith(root + '/') || artifact.startsWith(root + '\\'), 'Artifact path must stay in workspace');
mkdirSync(artifact, { recursive: true });
mkdirSync(join(root, '.tmp'), { recursive: true });
const run = mkdtempSync(join(root, '.tmp/site-systems-native-' + browser + '-')), extension = join(run, 'extension');
cpSync(join(root, 'dist', browser), extension, { recursive: true });
const files = ['autosurf-site-systems.js', 'site-systems-ui.js', 'site-systems-ui.css', 'autosurf-sites.js', 'autosurf-shared.js', 'company-ui.js', 'company-branding.js', 'system-branding.js', 'system-branding-data.js', 'system-mark-ui.js'];
if (overlay) for (const file of files) cpSync(join(root, 'apps/production-extension', file), join(extension, file));
const evidence = { at: new Date().toISOString(), result: 'RUNNING', browser, scope: 'owned synthetic catalogue on extension origin; ' + (overlay ? 'current source modules over previous delivered build' : 'unchanged delivered source modules'), checks: [],
  hashes: Object.fromEntries(files.map(file => [file, createHash('sha256').update(readFileSync(join(extension, file))).digest('hex')])) };
cpSync(join(root, 'node_modules/preact/dist/preact.module.js'), join(extension, 'owned-preact.js'));
writeFileSync(join(extension, 'owned-hooks.js'), readFileSync(join(root, 'node_modules/preact/hooks/dist/hooks.module.js'), 'utf8').replace('from"preact"', 'from"./owned-preact.js"'));
writeFileSync(join(extension, 'owned-jsx.js'), readFileSync(join(root, 'node_modules/preact/jsx-runtime/dist/jsxRuntime.module.js'), 'utf8').replaceAll('from"preact"', 'from"./owned-preact.js"'));
writeFileSync(join(extension, 'owned-site-systems.html'), '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="ui.css"><link rel="stylesheet" href="company-ui.css"><link rel="stylesheet" href="site-systems-ui.css"></head><body><main id="owned-root" style="padding:16px;max-width:700px;margin:auto"></main><script type="module" src="owned-site-systems.js"></script></body></html>');
const fixture = { version: 1, revision: 'owned-native-v1', publishedAt: '2026-10-13', countries: ['US'], categories: ['news'], trackingSourceId: 'publisher', trackingSnapshotAt: '2026-10-30',
  sources: [{ id: 'publisher', title: 'Owned publisher catalogue', license: 'Project-authored', asOf: '2026-10-30' }],
  trackingSystems: [{ id: 'forter', name: 'Forter', categories: ['fraud-prevention'] }, { id: 'other-system', name: 'Other System', categories: ['bot-management'] }],
  sites: [{ id: 'customer.example', name: 'Customer', origin: 'https://customer.example', countries: [], categories: [], rankBuckets: {}, trackingSystems: ['forter', 'other-system'] }] };
writeFileSync(join(extension, 'owned-site-systems.js'), `import{render}from'./owned-preact.js';import{jsx as h}from'./owned-jsx.js';import{useState,useEffect}from'./owned-hooks.js';import{createSiteSystemsUi}from'./site-systems-ui.js';
const errors=[];window.addEventListener('error',e=>errors.push(e.message));window.addEventListener('unhandledrejection',e=>errors.push(String(e.reason)));
const catalog=${JSON.stringify(fixture)};let props={host:'customer.example',visible:true},language='en';
const{SiteSystemsCatalog}=createSiteSystemsUi({h,useState,useEffect,useLocale:()=>language,translate:()=>language==='ru'?'Системы из каталога':'Systems in the catalog',loadCatalog:()=>catalog});
window.__siteSystemsFixture={errors,show(next,locale='en',rtl=false){props={...props,...next};language=locale;document.documentElement.lang=locale;document.documentElement.dir=rtl?'rtl':'ltr';render(h(SiteSystemsCatalog,props),document.getElementById('owned-root'));}};
window.__siteSystemsFixture.show({});`);
let opened;
const check = message => { evidence.checks.push(message); console.log('  ok ' + message); };
try {
  opened = await launchOwnedManagement({ root, run, extension, browser, evidence }); evidence.version = opened.version;
  if (browser === 'chrome') await opened.context.route(/^https?:\/\//, route => route.abort());
  await opened.goto(opened.base + 'owned-site-systems.html');
  await until(() => opened.evaluate(() => document.querySelector('[data-site-systems-catalog]')?.dataset.siteSystemsCatalog === 'customer.example'), 'exact-host native catalogue');
  evidence.initialDom = await opened.evaluate(() => document.getElementById('owned-root').innerHTML);
  const marks = await opened.evaluate(async () => {
    const images = [...document.querySelectorAll('img')]; await Promise.all(images.map(image => image.decode()));
    return images.map(image => ({ width: image.getBoundingClientRect().width, height: image.getBoundingClientRect().height, protocol: new URL(image.src).protocol, brand: image.dataset.companyLogo }));
  });
  assert.deepEqual(marks.map(mark => mark.brand), ['forter']); assert.ok(marks.every(mark => mark.width === 20 && mark.height === 20 && mark.protocol === new URL(opened.base).protocol));
  const initial = await opened.evaluate(() => ({ systems: [...document.querySelectorAll('[data-site-system-association]')].map(node => node.dataset.siteSystemAssociation), date: document.querySelector('time')?.dateTime, liveVendorCards: document.querySelectorAll('[data-vendor-id]').length, links: [...document.querySelectorAll('a')].map(link => ({ href: link.href, rel: link.rel, target: link.target })) }));
  assert.deepEqual(initial.systems, ['forter', 'other-system']); assert.equal(initial.date, '2026-10-30'); assert.equal(initial.liveVendorCards, 0); assert.equal(initial.links.length, 0);
  check('exact selected host renders two dated catalogue associations and local artwork without public source links or live detector cards');
  await opened.evaluate(() => document.defaultView.__siteSystemsFixture.show({ host: 'www.customer.example' }));
  await until(() => opened.evaluate(() => !document.querySelector('[data-site-systems-catalog]')), 'no www inference');
  await opened.evaluate(() => document.defaultView.__siteSystemsFixture.show({ host: 'customer.example.attacker.test' })); await pause(100);
  assert.equal(await opened.evaluate(() => Boolean(document.querySelector('[data-site-systems-catalog]'))), false);
  check('www and suffix lookalikes do not inherit customer technology associations');
  for (const layout of [{ locale: 'ru', rtl: false, width: 600, scheme: 'light' }, { locale: 'ar', rtl: true, width: 360, scheme: 'dark' }]) {
    await opened.viewport(layout.width, 650); await opened.media({ colorScheme: layout.scheme });
    await opened.evaluate(({ locale, rtl }) => document.defaultView.__siteSystemsFixture.show({ host: 'CUSTOMER.EXAMPLE.' }, locale, rtl), layout);
    await until(() => opened.evaluate(() => Boolean(document.querySelector('[data-site-systems-catalog]'))), 'catalogue layout');
    assert.equal(await opened.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await opened.screenshot(join(artifact, 'site-systems-' + browser + '-' + layout.locale + '.png'));
  }
  check('Russian and narrow RTL catalogue layouts have no horizontal overflow');
  evidence.resources = await opened.evaluate(() => performance.getEntriesByType('resource').map(entry => new URL(entry.name).protocol));
  assert.ok(evidence.resources.every(protocol => protocol === new URL(opened.base).protocol));
  evidence.errors = await opened.evaluate(() => document.defaultView.__siteSystemsFixture.errors); assert.deepEqual(evidence.errors, []);
  check('all fixture resources remain extension-local and the native component emits no script errors');
  evidence.result = 'PASS';
} catch (error) { evidence.result = 'FAIL'; evidence.failure = error.message; throw error; }
finally { if (opened) await opened.close(); writeFileSync(join(artifact, 'site-systems-native-' + browser + (overlay ? '-source' : '') + '.json'), JSON.stringify(evidence, null, 2) + '\n'); }
