// ADR-057: exercise shipped listeners with the shipped matcher and native identities.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import { createVendorRedirectTracker } from '../../apps/production-extension/vendor-redirects.js';
import ast, { parse, forEachChild } from '../production/clear-reset-ast.mjs';

const source = readFileSync(new URL('../../apps/production-extension/background.js', import.meta.url), 'utf8');
const catalog = source.slice(source.indexOf('// packages/catalog/src/vendors.runtime.json'), source.indexOf('// packages/catalog/src/vendors.rtc.runtime.json'));
const first = source.indexOf('// ADR-057 vendor redirect attribution start');
const last = source.indexOf('// packages/background/src/observers.ts', first);
assert.ok(first > 0 && last > first);
const canonical = 'https://challenges.cloudflare.com/turnstile/v0/api.js?QUERY_CANARY';
const versioned = 'https://challenges.cloudflare.com/turnstile/v0/opaque/opaque/api.js?FINAL_CANARY';
const key = '7:0:native-document';
const clone = value => JSON.parse(JSON.stringify(value));
const runtimeTree = parse(source, 'vendor-redirect-background.js');
function runtimeMethod(name) {
  const classes = [];
  function visit(node) {
    if (ast.isClassExpression(node) && ast.isVariableDeclaration(node.parent) && node.parent.name.getText(runtimeTree) === 'BackgroundRuntime') classes.push(node);
    forEachChild(node, visit);
  }
  visit(runtimeTree); assert.equal(classes.length, 1);
  const members = classes[0].members.filter(node => node.name?.text === name);
  assert.equal(members.length, 1, 'actual BackgroundRuntime.' + name);
  return members[0];
}

function fixture(initialAt = Date.parse('2026-10-20T00:00:00Z')) {
  let at = initialAt, current = true;
  const events = [], meta = { paused: false, revoked: false, accessGranted: true };
  const scope = { hasDataConsent: true, accessReady: true, accessGeneration: 1,
    hasAnyHostAccess: () => true, isHostGrantedSync: () => true, inScope: () => true, getScopeMode: () => 'all-sites' };
  const runtime = { now: () => at, hydrationComplete: true, scope, state: { metas: new Map([[key, meta]]) },
    canBufferRedactedBrowserData: () => scope.hasDataConsent,
    canObserveNetworkDocument: documentKey => current && documentKey === key && !meta.paused && !meta.revoked && meta.accessGranted,
    dispatch: event => events.push(clone(event)) };
  const context = vm.createContext({ URL, Date, createVendorRedirectTracker,
    makeDocumentKey: (tab, frame, doc) => `${tab}:${frame}:${doc}`,
    sanitizeHost: raw => { try { return new URL(raw).hostname; } catch { return null; } },
    redactHost: () => ({ kind: 'registrable', value: 'cloudflare.com' }), siteRelation: () => 'cross-site', TYPE_SET: new Set(['script']) });
  vm.runInContext(catalog + '\nvar matcher = createVendorResourceMatcher(vendors_runtime_default.rules);\n' +
    'var matchVendorResource = matcher.matchVendorResource, lookupVendorResourceRule = matcher.lookupVendorResourceRule;\n' + source.slice(first, last), context);
  const pro = { session: { id: 'pro-1' }, trackedTabs: new Set([7]), checkDeadline: () => true, limit() {}, mark() {} };
  runtime.vendorRedirects = context.createRuntimeVendorRedirects(runtime);
  pro.vendorRedirects = context.createRuntimeVendorRedirects(runtime, pro);
  const event = extra => ({ requestId: 'native-request', documentId: 'native-document', tabId: 7, frameId: 0,
    documentLifecycle: 'active', type: 'script', initiator: 'https://owned.example.com/', url: canonical, timeStamp: at, ...extra });
  const observe = (phase, extra = {}, isPro = false) => Array.from(context.carriedVendorRuleIds(runtime,
    isPro ? pro.vendorRedirects : runtime.vendorRedirects, event(extra), phase, isPro ? pro : null));
  const begin = (isPro = false) => { observe('before', {}, isPro); observe('redirect', { statusCode: 302, redirectUrl: versioned }, isPro); observe('before', { url: versioned }, isPro); };
  return { runtime, pro, meta, scope, events, event, observe, begin, context,
    tick: ms => { at += ms; }, current: value => { current = value; } };
}

test('shipped Light listener recognizes final success after a real reviewed loader redirect', () => {
  const f = fixture();
  f.begin();
  assert.equal(f.events.length, 0, 'A 302 creates no resource success or vendor event');
  const final = f.event({ url: versioned, statusCode: 200 });
  for (const forbidden of ['requestBody', 'requestHeaders', 'responseHeaders']) Object.defineProperty(final, forbidden, { get() { throw Error('forbidden read'); } });
  f.context.createNetworkListener(f.runtime)(final);
  assert.equal(f.events.length, 1);
  assert.deepEqual(f.events[0].ruleIds, ['turnstile-loader-v1']);
  assert.equal(f.events[0].documentId, 'native-document');
  assert.doesNotMatch(JSON.stringify(f.events), /CANARY|opaque|https|requestId|Headers|Body/);
});

test('browser-native identity may arrive before the model; final attribution requires the live document', () => {
  const f = fixture();
  f.runtime.state.metas.delete(key); f.current(false); f.begin();
  f.runtime.state.metas.set(key, f.meta); f.current(true);
  assert.deepEqual(f.observe('completed', { url: versioned, statusCode: 200 }), ['turnstile-loader-v1']);
  const stale = fixture(); stale.begin(); stale.current(false);
  assert.deepEqual(stale.observe('completed', { url: versioned, statusCode: 200 }), []);
});

test('paused or revoked documents cannot seed evidence that appears after resume', () => {
  for (const state of [{ paused: true }, { revoked: true }, { accessGranted: false }]) {
    const f = fixture(); Object.assign(f.meta, state); f.begin();
    Object.assign(f.meta, { paused: false, revoked: false, accessGranted: true });
    assert.deepEqual(f.observe('completed', { url: versioned, statusCode: 200 }), []);
  }
});

test('clearing or pausing one document prevents its old chain from completing after resume', () => {
  const f = fixture(); f.begin(); f.begin(true);
  f.runtime.vendorRedirects.clearDocument(key); f.pro.vendorRedirects.clearDocument(key);
  assert.deepEqual(f.observe('completed', { url: versioned, statusCode: 200 }), []);
  assert.deepEqual(f.observe('completed', { url: versioned, statusCode: 200 }, true), []);
  for (const name of ['pause', 'clear']) {
    const method = runtimeMethod(name), parameter = method.parameters[1].name.getText(runtimeTree), calls = [];
    function visit(node) { if (ast.isCallExpression(node)) calls.push(node); forEachChild(node, visit); }
    visit(method);
    const history = calls.filter(node => node.expression.getText(runtimeTree) === 'this.ensureHistory');
    assert.equal(history.length, 1, name + ': one authority guard');
    assert.ok(ast.isAwaitExpression(history[0].parent), name + ': authority is awaited');
    for (const receiver of ['this.vendorRedirects', 'this.pro.vendorRedirects']) {
      const clears = calls.filter(node => node.expression.getText(runtimeTree) === receiver + '.clearDocument');
      assert.equal(clears.length, 1, name + ': exact ' + receiver + ' cleanup');
      assert.equal(clears[0].arguments.length, 1);
      assert.ok(ast.isIdentifier(clears[0].arguments[0]));
      assert.equal(clears[0].arguments[0].getText(runtimeTree), parameter, name + ': use the requested document parameter');
      assert.ok(history[0].end < clears[0].pos, name + ': authority guard precedes cleanup');
    }
  }
});

test('consent, permission generation, host scope and Pro period are rechecked before releasing evidence', () => {
  const changes = [f => { f.scope.accessGeneration++; }, f => { f.scope.inScope = () => false; },
    f => { f.scope.isHostGrantedSync = () => false; }, f => { f.scope.hasDataConsent = false; }, f => { f.scope.accessReady = false; }];
  for (const change of changes) { const f = fixture(); f.begin(); change(f); assert.deepEqual(f.observe('completed', { url: versioned, statusCode: 200 }), []); }
  const pro = fixture(); pro.begin(true); pro.pro.session.id = 'pro-2';
  assert.deepEqual(pro.observe('completed', { url: versioned, statusCode: 200 }, true), []);
});

test('Light and Pro independently consume one native request without sharing terminal state', () => {
  const f = fixture(); f.begin(); f.begin(true);
  assert.deepEqual(f.observe('completed', { url: versioned, statusCode: 200 }), ['turnstile-loader-v1']);
  assert.deepEqual(f.observe('completed', { url: versioned, statusCode: 200 }, true), ['turnstile-loader-v1']);
  assert.deepEqual(f.observe('completed', { url: versioned, statusCode: 200 }, true), []);
});

test('a rule that expires between the canonical request and completion is not recognized', () => {
  const f = fixture(Date.parse('2027-03-13T00:00:00Z') - 3); f.begin(); f.tick(4);
  assert.deepEqual(f.observe('completed', { url: versioned, statusCode: 200 }), []);
});

test('capacity reports a bounded coverage gap with the native document identity only', () => {
  const f = fixture();
  for (let i = 0; i < 129; i++) f.observe('before', { requestId: `native-${i}` });
  assert.equal(f.runtime.vendorRedirects.stats().entries, 128);
  assert.deepEqual(f.events, [{ type: 'network:limited', documentKey: key, at: f.runtime.now() }]);
});
