// ADR-034: actual local artwork is decoded in a native browser; no vendor network traffic.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { chromium } from 'playwright';
import { COMPANY_BRANDS } from '../apps/production-extension/company-branding.js';
import { companyFixtureFiles, companyFixtureContentType } from './production/company-test-files.mjs';
const root = resolve(import.meta.dirname, '..'), artifact = join(root, 'test-results/production-1.1.0/company-logos');
mkdirSync(artifact, { recursive: true });
const run = mkdtempSync(join(root, '.tmp/company-layout-'));
assert.ok(resolve(run).startsWith(join(root, '.tmp') + sep), 'temporary run stays in the project');
const files = new Map([...companyFixtureFiles(root),
  ['/preact.module.js', join(root, 'node_modules/preact/dist/preact.module.js')],
  ...['ui.css', 'report.css'].map(file => ['/production/' + file, join(root, 'apps/production-extension', file)])]);
const html = `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/production/ui.css">
<link rel="stylesheet" href="/production/report.css"><link rel="stylesheet" href="/production/company-ui.css">
<style>body{margin:0;background:white;font:14px Arial,sans-serif;color:#152232}#gallery{padding:12px;display:grid;grid-template-columns:repeat(8,minmax(0,1fr));gap:10px}
.tile{padding:8px;border:1px solid #d7dee8;border-radius:8px;min-height:104px;min-width:0}.preview{display:block;object-fit:contain;width:48px;height:48px;margin:0 auto 6px}.identity{display:block;font-size:11px;overflow-wrap:anywhere;margin-top:4px;color:#586b82}
#labels{padding:10px}#labels h3,#labels h5{margin:9px 0}#labels table{table-layout:fixed;width:100%}#labels td{overflow-wrap:anywhere} @media print{#gallery{grid-template-columns:repeat(6,minmax(0,1fr))}.tile{break-inside:avoid}}</style>
</head><body><main id="gallery"></main><main id="labels"></main><script type="module" src="/fixture.js"></script></body></html>`;
const fixture = `import{h,render}from'/preact.module.js';import{COMPANY_BRANDS}from'/production/company-branding.js';import{createCompanyUi,waitForCompanyImages}from'/production/company-ui.js';
const{CompanyLabel}=createCompanyUi({h});
window.showGallery=async(start=0,end=COMPANY_BRANDS.length)=>{document.getElementById('labels').textContent='';render(COMPANY_BRANDS.slice(start,end).map(brand=>h('article',{class:'tile',children:[h('img',{class:'preview',src:'/production/icons/brands/'+brand.file,alt:'',decoding:'async'}),h(CompanyLabel,{name:brand.name,identity:brand.id}),h('code',{class:'identity',children:brand.id})]})),document.getElementById('gallery'));await Promise.all([...document.querySelectorAll('img')].map(image=>image.decode()));return waitForCompanyImages(document)};
window.showLabels=async(width,rtl=false)=>{render(null,document.getElementById('gallery'));document.getElementById('labels').style.width=width+'px';document.getElementById('labels').dir=rtl?'rtl':'ltr';const brands=['threatmetrix','cloudflare-turnstile','google-recaptcha','facebook-pixel','google-tag-manager','linkedin-insight','google-analytics','tiktok','yandex','criteo','hotjar'];const declaration=COMPANY_BRANDS.find(brand=>brand.declarantAliases?.length);render(h('section',{children:[...brands.map(identity=>h('h3',{children:h(CompanyLabel,{name:identity,identity,size:'large'})})),h('h5',{children:h(CompanyLabel,{name:'Unknown',identity:'Unknown'})}),h('p',{children:h(CompanyLabel,{name:declaration.declarantAliases[0]+' / '+('Long name '.repeat(12)),identity:declaration.declarantAliases[0]})}),h('table',{class:'tag-manager-table',children:h('tbody',{children:h('tr',{children:[h('td',{children:h(CompanyLabel,{name:'Google Tag Manager',identity:'google-tag-manager'})}),h('td',{children:h(CompanyLabel,{name:'Facebook Pixel',identity:'facebook-pixel'})})]})})})]}),document.getElementById('labels'));await waitForCompanyImages(document);await new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)))};
window.companyLayoutReady=true;`;
const server = createServer((request, response) => {
  const path = new URL(request.url, 'http://owned.test').pathname;
  response.setHeader('Cache-Control', 'no-store');
  if (path === '/') { response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end(html); return; }
  if (path === '/fixture.js') { response.setHeader('Content-Type', 'application/javascript'); response.end(fixture); return; }
  const file = files.get(path); if (!file) { response.writeHead(404); response.end(); return; }
  response.setHeader('Content-Type', companyFixtureContentType(file)); response.end(readFileSync(file));
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = 'http://127.0.0.1:' + server.address().port;
const evidence = { schemaVersion: 1, brands: COMPANY_BRANDS.length, sourceHashes: Object.fromEntries(['icons/brands/COMPANY-PROVENANCE.json', 'company-branding.js', 'company-ui.js', 'company-ui.css'].map(file => [file, createHash('sha256').update(readFileSync(join(root, 'apps/production-extension', file))).digest('hex')])), errors: [], unexpectedRequests: [], layouts: [] };
let context;
try {
  context = await chromium.launchPersistentContext(join(run, 'profile'), { channel: 'chromium', headless: true, viewport: { width: 1120, height: 900 }, args: ['--no-proxy-server'] });
  evidence.browser = context.browser().version();
  await context.route('**/*', route => { if (new URL(route.request().url()).origin === origin) return route.continue(); evidence.unexpectedRequests.push(route.request().url()); return route.abort(); });
  const page = await context.newPage(); page.on('pageerror', error => evidence.errors.push(error.message));
  await page.goto(origin); await page.waitForFunction(() => window.companyLayoutReady);
  assert.equal(await page.evaluate(() => window.showGallery()), true);
  evidence.images = await page.locator('.preview').evaluateAll(images => images.map(image => ({ file: new URL(image.src).pathname.split('/').at(-1), decoded: image.complete && image.naturalWidth > 0 && image.naturalHeight > 0, width: image.naturalWidth, height: image.naturalHeight })));
  assert.equal(evidence.images.length, COMPANY_BRANDS.length); assert.ok(evidence.images.every(image => image.decoded));
  for (let offset = 0; offset < COMPANY_BRANDS.length; offset += 96) {
    assert.equal(await page.evaluate(offset => window.showGallery(offset, offset + 96), offset), true);
    await page.screenshot({ path: join(artifact, 'gallery-' + String(offset / 96 + 1).padStart(2, '0') + '.png'), fullPage: true });
  }
  for (const rtl of [false, true]) for (const width of [252, 292, 380, 760]) {
    await page.evaluate(({ width, rtl }) => window.showLabels(width, rtl), { width, rtl });
    const layout = await page.evaluate(() => ({
      overflow: [...document.querySelectorAll('#labels,.company-label,.company-label__name')].filter(node => node.clientWidth && node.scrollWidth > node.clientWidth + 1).map(node => ({ class: node.className, text: node.textContent.slice(0, 80) })),
      marks: [...document.querySelectorAll('.company-logo')].map(image => ({ brand: image.dataset.companyLogo, width: image.getBoundingClientRect().width, height: image.getBoundingClientRect().height, decoded: image.complete && image.naturalWidth > 0, parent: getComputedStyle(image.parentElement).width })),
      unbranded: document.querySelectorAll('h5 img').length,
      tagManagerDisplay: getComputedStyle(document.querySelector('.tag-manager-table td>.company-label')).display
    }));
    evidence.layouts.push({ width, rtl, ...layout }); assert.deepEqual(layout.overflow, []); assert.equal(layout.unbranded, 0); assert.equal(layout.tagManagerDisplay, 'inline-flex');
    assert.ok(layout.marks.every(mark => mark.decoded && mark.width === mark.height && [20, 28].includes(mark.width)));
    if (width === 292) await page.locator('#labels').screenshot({ path: join(artifact, 'labels-' + (rtl ? 'rtl' : 'ltr') + '.png') });
  }
  await page.evaluate(() => window.showGallery(0, 96)); await page.emulateMedia({ media: 'print' });
  const print = await page.locator('.company-logo').evaluateAll(images => images.map(image => ({ width: image.getBoundingClientRect().width, visibility: getComputedStyle(image).visibility, opacity: getComputedStyle(image).opacity, decoded: image.complete && image.naturalWidth > 0 })));
  assert.ok(print.every(image => image.width === 20 && image.visibility === 'visible' && image.opacity === '1' && image.decoded)); evidence.print = { logos: print.length, decoded: true };
  await page.pdf({ path: join(artifact, 'company-gallery-print.pdf'), format: 'A4', printBackground: true });
  assert.deepEqual(evidence.errors, []); assert.deepEqual(evidence.unexpectedRequests, []); evidence.passed = true;
  console.log(JSON.stringify({ browser: evidence.browser, brands: evidence.brands, layouts: evidence.layouts.length, print: evidence.print, passed: true }));
} finally {
  writeFileSync(join(artifact, 'layout.json'), JSON.stringify(evidence, null, 2) + '\n');
  await context?.close(); await new Promise(done => server.close(done)); rmSync(run, { recursive: true, force: true });
}
