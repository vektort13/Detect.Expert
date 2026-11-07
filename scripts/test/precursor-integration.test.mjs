// ADR-074: execute the shipped route and lifecycle, retaining the existing trust boundary.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import { namedFunction, classMember } from '../production/clear-reset-tools.mjs';
import { readPrecursorRequest } from '../../apps/production-extension/precursor-contracts.js';

const source = readFileSync(new URL('../../apps/production-extension/background.js', import.meta.url), 'utf8');
const origin = 'chrome-extension://owned-extension';
const message = { schemaVersion: 1, type: 'ui-get-precursor', tabId: 7, frameId: 0, documentKey: '7:0:doc' };
function fixture() {
  const reads = [];
  const context = vm.createContext({
    readPrecursorRequest, selfOrigin: () => origin,
    uiError: code => ({ type: 'error', code }),
  });
  vm.runInContext(namedFunction(source, 'verifyUiSender', 'background.js').text + '\n' + namedFunction(source, 'route', 'background.js').text, context);
  const runtime = { api: { runtime: { id: 'owned-extension' } }, scope: { hasDataConsent: true }, whenReady: async () => {},
    precursor: { read: value => { reads.push(value); return { type: 'precursor-state', mode: 'unknown' }; } } };
  return { reads, runtime, route: (value = message, sender = { id: 'owned-extension', origin, url: origin + '/options.html', tab: { id: 1 } }) => context.route(runtime, value, sender) };
}
test('shipped privileged route accepts only a strict read request after data consent', async () => {
  const f = fixture();
  assert.equal((await f.route()).type, 'precursor-state');
  assert.equal(f.reads.length, 1);
  assert.equal((await f.route({ ...message, mode: 'arm' })).code, 'invalid-request');
  assert.equal((await f.route({ ...message, tabId: 8 })).code, 'invalid-request');
  f.runtime.scope.hasDataConsent = false;
  assert.equal((await f.route()).code, 'no-access');
  assert.equal(f.reads.length, 1);
});
test('content scripts, foreign extensions and forged page origins cannot read the sidecar', async () => {
  const f = fixture();
  for (const sender of [
    { id: 'owned-extension', origin: 'https://site.example', url: 'https://site.example/', tab: { id: 7 } },
    { id: 'foreign-extension', origin, url: origin + '/popup.html' },
    { id: 'owned-extension', origin, url: 'https://site.example/', tab: { id: 7 } },
    { id: 'owned-extension', url: origin + '/options.html' },
  ]) assert.equal((await f.route(message, sender)).code, 'unauthorized-sender');
  assert.equal(f.reads.length, 0);
});
test('pause, clear, session clear and permission/consent invalidation retain Precursor cleanup', () => {
  for (const name of ['pause', 'clear']) {
    const body = classMember(source, 'BackgroundRuntime', name, 'background.js').text;
    assert.ok(body.includes('this.precursor?.forget(documentKey)'), name);
  }
  for (const name of ['clearSession', 'discardUnconsentedData', 'onPermissionsChanged']) {
    const body = classMember(source, 'BackgroundRuntime', name, 'background.js').text;
    assert.ok(body.includes('this.precursor?.clear()'), name);
  }
  assert.equal(source.split('runtime.precursor = new PrecursorObserver(runtime);').length, 2);
  assert.ok(source.includes('types: ["script"] }, ["responseHeaders"]'));
  assert.ok(source.includes('background.runtime.precursor.clearTab(removed)'));
  assert.ok(source.includes('background.runtime.precursor.forget(details.tabId + ":" + details.frameId + ":" + details.documentId, "navigation")'));
});

test('shipped Inspector bindings suppress embedded popup observation without reading an undeclared sidepanel variable', () => {
  for (const file of ['popup.js', 'sidepanel.js']) {
    const shipped = readFileSync(new URL('../../apps/production-extension/' + file, import.meta.url), 'utf8');
    const inspector = namedFunction(shipped, 'InspectorView', file).text;
    const header = inspector.slice(0, inspector.indexOf('\n'));
    const calls = [...inspector.matchAll(/^\s*(u3\(PrecursorPanel, [^\n]+\)),\s*$/gmu)];
    assert.equal(calls.length, 1, file + ': exactly one panel in the actual Inspector');
    // Execute the shipped parameter binding and panel expression in an empty realm.
    // The previous sidepanel !embedded expression throws here because that view has no embedded parameter.
    const panel = Symbol('PrecursorPanel');
    const context = vm.createContext({ PrecursorPanel: panel, u3: (type, props) => ({ type, props }) });
    const probe = vm.runInContext('(' + header + '\nreturn ' + calls[0][1] + ';\n})', context);
    for (const embedded of [undefined, false, true]) {
      const session = { tabId: 7, selectedFrameId: 0 };
      const value = probe({ session, surface: file === 'popup.js' ? 'popup' : 'sidepanel', ...(embedded === undefined ? {} : { embedded }) });
      assert.equal(value.type, panel, file);
      assert.equal(value.props.session, session, file + ': original session binding');
      assert.equal(value.props.enabled, file === 'popup.js' ? embedded !== true : true, file + '/' + embedded);
    }
  }
});
