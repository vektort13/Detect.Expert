// Existing Inspector reuse, native source identity and owned renderer lifetime.
import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createDetectorUi, validDetectorTabId, detectorSourceTabId, detectorTabChoices, resolveDetectorSourceTab, detectorLabels, DETECTOR_LABELS } from '../../apps/production-extension/detector-ui.js';
import { PRODUCTION_LANGUAGES } from '../production-languages.mjs';
const turn = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const popup = readFileSync(new URL('../../apps/production-extension/popup.js', import.meta.url), 'utf8');

function mountFixture() {
  const initialized = deferred(), gets = [], queries = [], renders = [];
  const document = { getElementById: () => ({ root: true }) }, window = {}; window.top = window;
  const tabs = new Map([[7, { id: 7, url: 'https://seven.example.test/' }], [8, { id: 8, url: 'https://eight.example.test/' }]]);
  const chrome = { tabs: { async get(id) { gets.push(id); return tabs.get(id); }, async query(value) { queries.push(value); return [{ id: 99, url: 'chrome-extension://owned/options.html' }]; } }, sidePanel: { async open() {} } };
  const context = { document, window, location: { pathname: '/options.html' }, chrome, validDetectorTabId, resolveDetectorSourceTab,
    initializeLanguage: () => initialized.promise, applyDocumentLanguage() {}, R: (node, container) => renders.push({ node, container }), u3: (type, props) => ({ type, props }),
    ObservationControl() {}, InspectorView() {}, DataConsentGate() {}, useReportSession: () => ({ tabId: 7, openSidePanel() { throw Error('Popup close path must not be used'); } }), PopupApp() {} };
  const query = popup.slice(popup.indexOf('async function queryActiveTab() {'), popup.indexOf('function errorMessageKey(', popup.indexOf('async function queryActiveTab() {')));
  const mount = popup.slice(popup.indexOf('// Same Inspector and hook runtime'), popup.indexOf('// The normal browser-action entry'));
  assert.ok(query.length > 100 && mount.length > 100);
  vm.runInNewContext('let detectorMount = null;\n' + query + '\n' + mount.replace(/^export /gmu, '') + '\nglobalThis.testExports = {mountDetector,unmountDetector,queryActiveTab,ConsentedDetector};', context);
  return { context, initialized, renders, gets, queries, tabs, ...context.testExports, container: () => ({ nodeType: 1, ownerDocument: document }) };
}
function wrapperFixture({ active = false, tabId = null, modulePending = null, queryPending = null } = {}) {
  const calls = [], removed = new Set(), updated = new Set(), committed = new Set(), slots = [], effects = [];
  const rows = [{ id: 7, url: 'https://seven.example.test/' }, { id: 8, url: 'https://eight.example.test/' }, { id: 99, url: 'chrome-extension://owned/options.html' }];
  const api = { tabs: { async query(value) { calls.push(['query', value]); return queryPending ? await queryPending : rows; }, async get(id) { calls.push(['get', id]); return rows.find(row => row.id === id); }, async reload(id) { calls.push(['reload',id]); }, onRemoved: { addListener: fn => removed.add(fn), removeListener: fn => removed.delete(fn) }, onUpdated: {addListener:fn=>updated.add(fn),removeListener:fn=>updated.delete(fn)} }, runtime:{async sendMessage(m){calls.push(['message',m.type]);return m.type==='ui-data-consent-get'?{schemaVersion:1,type:'data-consent-state',version:1,accepted:true}:m.type==='ui-get-scope'?{schemaVersion:1,type:'scope',scope:{scopeMode:'all-sites'}}:{schemaVersion:1,type:'report',report:null};}} };
  api.webNavigation = {onCommitted:{addListener:fn=>committed.add(fn),removeListener:fn=>committed.delete(fn)}};
  const mounts = [], host = {}, imported = { mountDetector(container, options) { const state = { container, options, stopped: false }; mounts.push(state); return () => { state.stopped = true; }; } };
  let importCalls = 0, cursor = 0, dirty = true, tree, props = { active, tabId };
  const hooks = {
    useState(initial) { const slot = slots[cursor++] ??= { value: typeof initial === 'function' ? initial() : initial }; return [slot.value, next => { const value = typeof next === 'function' ? next(slot.value) : next; if (!Object.is(value, slot.value)) { slot.value = value; dirty = true; } }]; },
    useRef(initial) { return (slots[cursor++] ??= { ref: { current: initial } }).ref; },
    useEffect(callback, dependencies) { const slot = slots[cursor++] ??= {}; if (!slot.dependencies || dependencies.some((value, index) => !Object.is(value, slot.dependencies[index]))) { slot.dependencies = dependencies; effects.push(() => { slot.cleanup?.(); slot.cleanup = callback(); }); } }
  };
  const { DetectorApp } = createDetectorUi({ ...hooks, h: (type, props) => ({ type, props }), useLocale: () => 'en', browserApi: api, importInspector: async () => { importCalls++; return modulePending ? await modulePending : imported; } });
  function nodes(predicate) { const found = []; function walk(node) { if (Array.isArray(node)) { node.forEach(walk); return; } if (!node?.props) return; if (predicate(node)) found.push(node); walk(node.props.children); } walk(tree); return found; }
  function flush() { for (let n = 0; dirty && n < 15; n++) { cursor = 0; dirty = false; tree = DetectorApp(props); nodes(node => node.props['data-detector-host']).forEach(node => { node.props.ref.current = host; }); while (effects.length) effects.shift()(); } assert.equal(dirty, false); }
  async function settle() { for (let n = 0; n < 8; n++) { flush(); await turn(); } flush(); }
  flush();
  return { api, imported, calls, mounts, removed, updated, committed, settle, flush, nodes, get importCalls() { return importCalls; }, attr: (name, value = true) => nodes(node => node.props[name] === value)[0], update(value) { props = { ...props, ...value }; dirty = true; flush(); }, unmount() { for (const slot of slots) slot.cleanup?.(); } };
}

test('Detector source parsing is canonical, native-get verified and excludes extension/restricted tabs', async () => {
  for (const value of [-1, 1.5, 2147483648, '7', null, undefined]) assert.equal(validDetectorTabId(value), false);
  assert.equal(detectorSourceTabId('?tabId=7'), 7);
  for (const input of ['?tabId=07', '?tabId=7&tabId=8', '?tabId=-1', '?tabId=2147483648']) assert.equal(detectorSourceTabId(input), null);
  const rows = [{ id: 7, url: 'https://owned.example.test/?private=not-a-label' }, { id: 7, url: 'https://duplicate.example.test/' }, { id: 8, url: 'chrome-extension://own/options.html' }, { id: 9, url: 'about:blank' }];
  const choices = detectorTabChoices(rows); assert.deepEqual(choices, [{ id: 7, label: 'owned.example.test · #7' }]); assert.ok(!JSON.stringify(choices).includes('private'));
  assert.deepEqual(await resolveDetectorSourceTab({ tabs: { get: async () => rows[0] } }, 7), { id: 7, url: rows[0].url });
  assert.equal((await resolveDetectorSourceTab({ tabs: { get: async () => rows[2] } }, 8)).id, null);
  assert.equal((await resolveDetectorSourceTab({ tabs: { get: async () => rows[0] } }, 8)).id, null);
  assert.equal((await resolveDetectorSourceTab({ tabs: { get: async () => { throw Error('closed'); } } }, 7)).id, null);
  assert.equal(detectorTabChoices(Array.from({ length: 2000 }, (_, id) => ({ id, url: 'https://owned.example.test/' }))).length, 1024);
});
test('inactive Detector does not import/read, active default exposes the existing operator without guessing a source', async () => {
  const h = wrapperFixture();
  try {
    await h.settle(); assert.deepEqual(h.calls, []); assert.equal(h.importCalls, 0);
    h.update({ active: true }); await h.settle(); assert.equal(h.importCalls, 1); assert.equal(h.mounts.at(-1).options.tabId, null);
    assert.equal(h.attr('data-detector-source').props.value, ''); assert.ok(h.attr('data-detector-state', 'no-source'));
    h.update({ active: false }); await h.settle(); assert.ok(h.mounts.every(row => row.stopped)); assert.equal(h.removed.size, 0);
  } finally { h.unmount(); }
});
test('source changes and inactive navigation release the real mount; no pending import can revive a hidden section', async () => {
  const pending = deferred(), h = wrapperFixture({ active: true, tabId: 7, modulePending: pending.promise });
  try {
    await h.settle(); h.update({ active: false }); pending.resolve(h.imported); await h.settle(); assert.equal(h.mounts.length, 0);
    h.update({ active: true }); await h.settle(); assert.equal(h.mounts.at(-1).options.tabId, 7);
    const old = h.mounts.at(-1); h.update({ tabId: 8 }); await h.settle(); assert.equal(old.stopped, true); assert.equal(h.mounts.at(-1).options.tabId, 8);
    for (const listener of h.removed) listener(8); await h.settle(); assert.equal(h.attr('data-detector-source').props.value, ''); assert.equal(h.mounts.at(-1).options.tabId, null);
    h.unmount(); assert.ok(h.mounts.every(row => row.stopped));
  } finally { h.unmount(); }
});
test('the actual popup mount uses its own renderer, keeps the target across helpers and fences stale native tab reads', async () => {
  const f = mountFixture(), container = f.container();
  const stop = f.mountDetector(container, { tabId: 7 }); f.initialized.resolve(); await turn();
  assert.equal(f.renders.at(-1).node.type.name, 'EmbeddedDetector'); assert.equal(f.renders.at(-1).node.props.tabId, 7);
  assert.equal((await f.queryActiveTab()).id, 7); assert.deepEqual(f.gets, [7]); assert.equal(f.queries.length, 0);
  const held = deferred(); f.context.chrome.tabs.get = () => held.promise;
  const reading = f.queryActiveTab(); f.mountDetector(f.container(), { tabId: 8 }); held.resolve({ id: 7, url: 'https://seven.example.test/' }); assert.equal((await reading).id, null);
  stop(); assert.equal(f.unmountDetector(container), false, 'an obsolete disposer cannot unmount the current host');
  assert.equal(f.renders.some(row => row.node === null && row.container === container), true);
});
test('the actual mount validates owned Options/top-frame context and source-less mode mounts only the real operator', async () => {
  const f = mountFixture(), container = f.container();
  for (const id of [-1, '7', Infinity]) assert.throws(() => f.mountDetector(container, { tabId: id }), /invalid-detector-target/u);
  assert.throws(() => f.mountDetector({ nodeType: 1, ownerDocument: {} }, { tabId: 7 }), /invalid-detector-target/u);
  f.context.location.pathname = '/popup.html'; assert.throws(() => f.mountDetector(container, { tabId: 7 })); f.context.location.pathname = '/options.html';
  f.context.window.top = {}; assert.throws(() => f.mountDetector(container, { tabId: 7 })); f.context.window.top = f.context.window;
  const stop = f.mountDetector(container, { tabId: null }); f.initialized.resolve(); await turn(); assert.equal(f.renders.at(-1).node.type.name, 'DetectorObservationHeader'); assert.equal((await f.queryActiveTab()).id, null); stop();
  assert.equal((await f.queryActiveTab()).id, 99, 'normal popup active-tab behavior is unchanged after unmount');
});
test('popup autostart is guarded on import and all existing analyzers/tool bodies remain present', async () => {
  const tail = popup.slice(popup.indexOf('// The normal browser-action entry'));
  for (const pathname of ['/options.html', '/popup.html']) {
    let initialization = 0, appearance = 0, rendered = 0;
    vm.runInNewContext(tail, { location: { pathname }, initializeTheme: async () => { appearance++; }, initializeLanguage: async () => { initialization++; }, applyDocumentLanguage() {}, document: { getElementById: () => ({}) }, R() { rendered++; }, u3: () => ({}), PopupApp() {} });
    await turn(); assert.equal(initialization, pathname === '/popup.html' ? 1 : 0); assert.equal(appearance, initialization, 'Headless theme startup is popup-only and runs once'); assert.equal(rendered, initialization);
  }
  for (const name of ['useVisualPreview', 'useApiResults', 'useGoogleIds', 'useBeacons', 'useBackgroundActivity', 'useCookieProbe', 'useCookies', 'useCookieWriters', 'useSocial', 'useThirdParty', 'ProModeView', 'ProtectIsland', 'PrecursorPanel']) assert.ok(popup.includes(name + '(') || popup.includes('u3(' + name + ','), 'Existing production analyzer/component: ' + name);
  const current = popup.slice(popup.indexOf('function InspectorView('), popup.indexOf('// packages/ui/src/components/DataConsent.tsx', popup.indexOf('function InspectorView(')));
  const precursorCall = 'u3(PrecursorPanel, { session, enabled: !embedded })';
  assert.equal(current.split(precursorCall).length, 2);
  const normalized = current.replace('function InspectorView({ session, surface, embedded = false }) {', 'function InspectorView({ session, surface }) {').replace('embedded ? u3(DetectorObservationHeader, { tabId: session.tabId }) : ', '').replace(precursorCall, 'u3(PrecursorPanel, { session, enabled: true })');
  // ADR-103: the redesigned production Inspector (sync-redesign-ui.mjs and the grouped launcher row of
  // sync-protect-ui.mjs); the earlier ADR-090 body hashed to c26e3254de7645958ef64f30fdd2c9b72c3cc1f823e5f060f83a3feb309af0ea.
  for (const marker of ['u3(InspectorSiteCard, {', 'embedded ? null : u3(BrandLinks, {})', 'redesignText("overview")', '"data-inspector-tools-group": "defense"', 'u3(ThirdPartyPanel, { thirdParty, embedded: ', 'catalog: u3(SiteSystemsCatalog, {']) assert.ok(current.includes(marker), 'ADR-103 marker: ' + marker);
  assert.equal(createHash('sha256').update(normalized).digest('hex'), '3d6008fadbe37a96107a2d7d4a77144c39a9f0ffd5a8d28ffb3b96266e8770cf', 'Inspector body is exact except its compact operator header and embedded Precursor suppression');
});
test('all21 detector source controls have local functional labels', () => {
  assert.deepEqual(Object.keys(DETECTOR_LABELS).sort(), PRODUCTION_LANGUAGES.map(row => row.id).sort());
  for (const language of PRODUCTION_LANGUAGES) for (const label of Object.values(detectorLabels(language.id))) assert.ok(label.trim());
});

test('source-less Detector stays useful with a choice guide, visible operator and report history, without zero results',async()=>{
 const f=wrapperFixture({active:true});try{await f.settle();assert.ok(f.attr('data-detector-state','no-source'));assert.ok(f.attr('data-detector-choose'));assert.equal(f.attr('data-detector-reload').props.disabled,true);assert.equal(f.attr('data-detector-host').props.hidden,true);assert.equal(f.mounts.at(-1).options.externalOperator,true);assert.equal(f.nodes(n=>n.type?.name==='DetectorHistory').length,1);assert.equal(f.nodes(n=>n.type?.name==='ObservationControl').length,1);assert.equal(f.nodes(n=>n.type?.name==='PointerActivity').length,0);}finally{f.unmount();}
});

test('refreshing choices never reloads a page; only the explicit verified-source button does',async()=>{
 const f=wrapperFixture({active:true});try{await f.settle();await f.attr('data-detector-refresh').props.onClick();await f.settle();assert.equal(f.calls.some(x=>x[0]==='reload'),false);await f.attr('data-detector-source').props.onChange({currentTarget:{value:'7'}});await f.settle();assert.equal(f.attr('data-detector-reload').props.disabled,false);await f.attr('data-detector-reload').props.onClick();await f.settle();assert.deepEqual(f.calls.filter(x=>x[0]==='reload'),[['reload',7]]);assert.equal(f.calls.some(x=>['ui-set-scope','ui-data-consent-set','ui-pro-start'].includes(x[1])),false);}finally{f.unmount();}
});

test('restricted navigation releases Inspector and stale report callbacks cannot populate the new selection',async()=>{
 const f=wrapperFixture({active:true,tabId:7});try{await f.settle();const old=f.mounts.at(-1);f.update({tabId:8});await f.settle();old.options.onState({tabId:7,loaded:true,available:true,report:{documentKey:'old',coverageState:'active'}});await f.settle();assert.equal(f.attr('data-detector-host').props.hidden,true);for(const fn of f.updated)fn(8,{url:'chrome://settings/'});await f.settle();assert.equal(f.attr('data-detector-source').props.value,'');assert.ok(f.attr('data-detector-state','no-source'));assert.equal(old.stopped,true);}finally{f.unmount();assert.equal(f.updated.size,0);}
});

test('a pending source choice immediately fences old reloads and old Inspector callbacks',async()=>{
 const f=wrapperFixture({active:true,tabId:7}),pending=deferred();try{
  await f.settle();const old=f.mounts.at(-1),nativeGet=f.api.tabs.get;
  f.api.tabs.get=id=>id===8?pending.promise:nativeGet(id);
  const choosing=f.attr('data-detector-source').props.onChange({currentTarget:{value:'8'}});
  await f.attr('data-detector-reload').props.onClick();
  old.options.onState({tabId:7,loaded:true,available:true,report:{documentKey:'old',coverageState:'active'}});
  await f.settle();assert.equal(f.attr('data-detector-source').props.value,'');assert.equal(f.attr('data-detector-reload').props.disabled,true);assert.equal(f.attr('data-detector-host').props.hidden,true);
  assert.equal(f.calls.some(x=>x[0]==='reload'),false);
  pending.resolve({id:8,url:'https://eight.example.test/'});await choosing;await f.settle();
  await f.attr('data-detector-reload').props.onClick();await f.settle();assert.deepEqual(f.calls.filter(x=>x[0]==='reload'),[['reload',8]]);
 }finally{pending.resolve({id:8,url:'https://eight.example.test/'});f.unmount();}
});

test('child-frame loading preserves the current Inspector; only a committed top navigation invalidates it',async()=>{
 const f=wrapperFixture({active:true,tabId:7});try{
  await f.settle();f.mounts.at(-1).options.onState({tabId:7,loaded:true,available:true,mainDocumentKey:'main',report:{documentKey:'main',coverageState:'active'}});await f.settle();
  assert.equal(f.attr('data-detector-host').props.hidden,false);
  for(const fn of f.updated)fn(7,{status:'loading'});for(const fn of f.committed)fn({tabId:7,frameId:2});await f.settle();assert.equal(f.attr('data-detector-host').props.hidden,false);
  for(const fn of f.committed)fn({tabId:8,frameId:0});await f.settle();assert.equal(f.attr('data-detector-host').props.hidden,false);
  for(const fn of f.committed)fn({tabId:7,frameId:0});await f.settle();assert.equal(f.attr('data-detector-host').props.hidden,true);
 }finally{f.unmount();assert.equal(f.committed.size,0);}
});

test('the delivered report poll runs in hidden Detector only, while normal popup polling retains its old behavior',()=>{
 const start=popup.indexOf('  h2(() => {\n    mountedRef.current = !0, refresh();'),end=popup.indexOf('  let guarded =',start),effect=popup.slice(start,end);assert.ok(start>0&&end>start);
 for(const pollWhenHidden of[undefined,true]){
  let refreshes=0,tick,cleanup,removed=false,cleared=false;const document={visibilityState:'hidden',addEventListener(name,fn){assert.equal(name,'visibilitychange');assert.equal(fn,tick);},removeEventListener(){removed=true;}};
  vm.runInNewContext(effect,{h2(fn){cleanup=fn();},mountedRef:{current:false},refresh(){refreshes++;},options:{pollWhenHidden},pollMs:1000,watchTabs:false,document,window:{setInterval(fn){tick=fn;return 4;},clearInterval(id){assert.equal(id,4);cleared=true;}}});
  assert.equal(refreshes,1);tick();assert.equal(refreshes,pollWhenHidden?2:1);document.visibilityState='visible';tick();assert.equal(refreshes,pollWhenHidden?3:2);cleanup();assert.equal(removed,true);assert.equal(cleared,true);
 }
 assert.ok(popup.includes('watchTabs: false, pollWhenHidden: true'));
});
