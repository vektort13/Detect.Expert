import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { createAutosurfDriver, AUTOSURF_DRIVER_LIMITS } from '../../apps/production-extension/autosurf-driver.js';
import { inspectAutosurfPage } from '../../apps/production-extension/autosurf-page.js';

const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const code = expected => error => error?.code === expected;
function event() { const listeners = new Set(); return { addListener: value => listeners.add(value), removeListener: value => listeners.delete(value), emit: (...args) => { for (const listener of listeners) listener(...args); } }; }
function fixture() {
  const trace = [], detached = [], state = { live: true, frame: null, inspection: null, attach: null, command: null, getFrame: null };
  const context = { tabId: 12, documentId: 'owned-doc', origin: 'https://owned.example.com', url: 'https://owned.example.com/start', isCurrent: () => state.live };
  state.frame = { documentId: context.documentId, documentLifecycle: 'active', url: context.url };
  state.inspection = { viewport: { width: 1000, height: 700 }, scroll: { x: 0, y: 0, maxY: 3000 }, hoverPoints: [{ x: 550, y: 360 }], links: ['https://owned.example.com/next'], challenge: null, hidden: false };
  const api = {
    debugger: { onDetach: event(), async attach(...args) { trace.push(['attach', ...args]); return state.attach?.(); }, async detach(target) { trace.push(['detach', target]); api.debugger.onDetach.emit(target, 'canceled_by_user'); }, async sendCommand(target, method, params) { trace.push(['command', target, method, params]); if (state.command) return state.command(target, method, params); if (method === 'Performance.getMetrics') return { metrics: [{ name: 'JSHeapUsedSize', value: 1234 }, { name: 'TaskDuration', value: 1.25 }, { name: 'SecretValue', value: 'SECRET' }] }; } },
    webNavigation: { async getFrame(target) { trace.push(['frame', target]); return state.getFrame ? state.getFrame(target) : structuredClone(state.frame); } },
    scripting: { async executeScript(request) { trace.push(['inspect', request]); return [{ documentId: context.documentId, frameId: 0, result: structuredClone(state.inspection) }]; } },
  };
  const driver = createAutosurfDriver(api, { onDetach: value => detached.push(value) });
  return { api, driver, context, state, trace, detached, attach: () => driver.attach(context.tabId, context.isCurrent) };
}

test('driver inspects only its native current top document using the fixed ISOLATED function', async () => {
  const f = fixture(); await f.attach(); assert.deepEqual(await f.driver.inspect(f.context), f.state.inspection);
  const request = f.trace.find(row => row[0] === 'inspect')[1];
  assert.deepEqual(request.target, { tabId: 12, documentIds: ['owned-doc'] }); assert.equal(request.world, 'ISOLATED'); assert.equal(request.func, inspectAutosurfPage);
  assert.deepEqual(request.args, [f.context.origin, f.context.url]);
  await f.driver.detach(12); assert.equal(f.detached.length, 0);
});
test('rejected already-attached target is never claimed or detached', async () => {
  const f = fixture(); f.state.attach = () => { throw Error('Another debugger is already attached'); };
  await assert.rejects(f.attach(), code('autosurf-native-error')); assert.equal(await f.driver.detach(12), false);
  assert.equal(f.trace.filter(row => row[0] === 'detach').length, 0);
});
test('late successful attach after cancellation is detached without acquiring a live driver', async () => {
  const f = fixture(), pending = deferred(); f.state.attach = () => pending.promise;
  const attached = f.attach(), failed = assert.rejects(attached, code('autosurf-stale')); await tick(); f.state.live = false;
  await f.driver.detach(12); pending.resolve(); await failed; await tick();
  assert.equal(f.trace.filter(row => row[0] === 'detach').length, 1); assert.equal(f.detached.length, 0);
});
test('timed-out attach retains its physical slot and cleans up only its late success', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] }); const f = fixture(), pending = deferred(); f.state.attach = () => pending.promise;
  const failed = assert.rejects(f.attach(), code('autosurf-timeout')); await tick(); t.mock.timers.tick(AUTOSURF_DRIVER_LIMITS.timeoutMs); await failed;
  await assert.rejects(f.driver.attach(13, () => true), code('autosurf-busy')); assert.equal(f.trace.filter(row => row[0] === 'attach').length, 1);
  pending.resolve(); await tick(); await tick(); assert.equal(f.trace.filter(row => row[0] === 'detach').length, 1);
});
test('a timed-out native lookup keeps capacity occupied until its actual settlement', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] }); const f = fixture(); await f.attach(); const pending = deferred(); f.state.getFrame = () => pending.promise;
  const failed = assert.rejects(f.driver.inspect(f.context), code('autosurf-timeout')); await tick(); t.mock.timers.tick(AUTOSURF_DRIVER_LIMITS.timeoutMs); await failed;
  await assert.rejects(f.driver.inspect(f.context), code('autosurf-busy')); assert.equal(f.trace.filter(row => row[0] === 'frame').length, 1);
  pending.resolve(f.state.frame); await tick(); f.state.getFrame = null; assert.ok(await f.driver.inspect(f.context)); await f.driver.detach(12);
});
test('stop while a native input is pending prevents all following inputs and detaches after settlement', async () => {
  const f = fixture(), pending = deferred(); await f.attach(); f.state.command = () => pending.promise;
  const failed = assert.rejects(f.driver.step(f.context, { kind: 'hover' }), code('autosurf-stale'));
  await tick(); assert.equal(f.trace.filter(row => row[0] === 'command').length, 1);
  f.state.live = false; await f.driver.detach(12); assert.equal(f.trace.filter(row => row[0] === 'detach').length, 0);
  pending.resolve(); await failed; await tick(); assert.equal(f.trace.filter(row => row[0] === 'command').length, 1); assert.equal(f.trace.filter(row => row[0] === 'detach').length, 1);
});
test('document replacement, changed URL, lifecycle and origin fail before page inspection/input', async () => {
  for (const change of [{ documentId: 'other-doc' }, { documentLifecycle: 'cached' }, { url: 'https://owned.example.com/other' }, { url: 'https://other.example.com/start' }, { errorOccurred: true }]) {
    const f = fixture(); await f.attach(); Object.assign(f.state.frame, change);
    await assert.rejects(f.driver.step(f.context, { kind: 'scroll' }), code('autosurf-stale')); assert.equal(f.trace.some(row => row[0] === 'inspect' || row[0] === 'command'), false); await f.driver.detach(12);
  }
});
test('hidden or challenge candidate documents receive no input', async () => {
  for (const [change, expected] of [[{ hidden: true }, 'autosurf-hidden'], [{ challenge: 'visible-challenge' }, 'autosurf-challenge']]) {
    const f = fixture(); await f.attach(); Object.assign(f.state.inspection, change);
    await assert.rejects(f.driver.step(f.context, { kind: 'scroll' }), code(expected)); assert.equal(f.trace.some(row => row[0] === 'command'), false); await f.driver.detach(12);
  }
});
test('page-controlled link results are independently revalidated outside the isolated adapter', async () => {
  for (const link of ['https://other.example.com/next', 'https://owned.example.com/logout', 'https://owned.example.com/sign-in', 'https://owned.example.com/file.pdf', 'https://owned.example.com/%2564elete', 'https://owned.example.com/next?secret=1', 'https://owned.example.com/a%250Ab']) {
    const f = fixture(); await f.attach(); f.state.inspection.links = [link];
    await assert.rejects(f.driver.inspect(f.context), code('autosurf-invalid-result')); await f.driver.detach(12);
  }
});
test('hover follows bounded native movement and never sends pressed, keyboard or arbitrary protocol commands', async () => {
  const f = fixture(); await f.attach(); const result = await f.driver.step(f.context, { kind: 'hover', random: 0.25 });
  assert.equal(result.hovers, 1); assert.equal(result.wheels, 0); assert.ok(result.moves >= 2 && result.moves <= 24);
  const commands = f.trace.filter(row => row[0] === 'command'); assert.equal(commands.length, result.moves);
  for (const [, target, method, params] of commands) { assert.deepEqual(target, { tabId: 12 }); assert.equal(method, 'Input.dispatchMouseEvent'); assert.equal(params.type, 'mouseMoved'); assert.equal(params.buttons, 0); assert.ok(params.x >= 0 && params.x < 1000 && params.y >= 0 && params.y < 700); }
  assert.equal(commands.at(-1)[3].x, 550); assert.equal(commands.at(-1)[3].y, 360); await f.driver.detach(12);
});
test('scroll is four native wheel events with bounded total distance and fewer than32 input events', async () => {
  const f = fixture(); await f.attach(); const result = await f.driver.step(f.context, { kind: 'scroll', random: 0.9 });
  assert.equal(result.wheels, 4); assert.ok(result.moves + result.wheels <= 28);
  const wheel = f.trace.filter(row => row[0] === 'command' && row[3].type === 'mouseWheel'); assert.equal(wheel.length, 4);
  const total = wheel.reduce((sum, row) => sum + row[3].deltaY, 0); assert.ok(total > 0 && total <= 700); await f.driver.detach(12);
});
test('driver reports only allowlisted renderer aggregates', async () => {
  const f = fixture(); await f.attach(); assert.deepEqual(await f.driver.sample(f.context), { jsHeapBytes: 1234, taskDurationMs: 1250 });
  assert.deepEqual(f.trace.filter(row => row[0] === 'command').map(row => row[2]), ['Performance.enable', 'Performance.getMetrics']);
  await f.driver.sample(f.context); assert.equal(f.trace.filter(row => row[0] === 'command' && row[2] === 'Performance.enable').length, 1); await f.driver.detach(12);
});
test('foreign detach does nothing and unexpected own detach interrupts exactly once', async () => {
  const f = fixture(); await f.attach(); assert.equal(await f.driver.detach(99), false); f.api.debugger.onDetach.emit({ tabId: 99 }, 'target_closed'); assert.equal(f.detached.length, 0);
  f.api.debugger.onDetach.emit({ tabId: 12 }, 'target_closed'); f.api.debugger.onDetach.emit({ tabId: 12 }, 'target_closed'); assert.deepEqual(f.detached, [{ tabId: 12, reason: 'target-closed' }]);
  await assert.rejects(f.driver.inspect(f.context), code('autosurf-stale')); assert.equal(f.trace.filter(row => row[0] === 'detach').length, 0);
});
test('unsupported browser never attempts a debugging operation', async () => { assert.equal(createAutosurfDriver({}).supported(), false); await assert.rejects(createAutosurfDriver({}).attach(1, () => true), code('autosurf-unsupported')); });

function pageFixture(hrefs, { challenge = false, challengeArea = true, challengeHidden = false, hidden = false } = {}) {
  let index = 0, walked = 0; const nodes = hrefs.map(raw => ({ localName: 'a', getAttribute: name => name === 'href' ? raw : '', hasAttribute: () => false, closest: () => null, contains: () => false, getBoundingClientRect: () => ({ left: 0, top: 0, right: 100, bottom: 30, width: 100, height: 30 }) }));
  const win = {}; win.top = win;
  const context = { window: win, location: { origin: 'https://owned.example.com', href: 'https://owned.example.com/start' }, innerWidth: 1000, innerHeight: 700, scrollX: 0, scrollY: 0, URL, Set, NodeFilter: { SHOW_ELEMENT: 1 }, getComputedStyle: element => ({ display: element.challenge && challengeHidden ? 'none' : 'block', visibility: 'visible', opacity: '1', pointerEvents: 'auto' }), document: { visibilityState: hidden ? 'hidden' : 'visible', scrollingElement: { scrollHeight: 3000 }, documentElement: nodes[0], elementFromPoint: () => nodes[index], querySelector: selector => challenge && selector === '#challenge-form' ? { challenge: true, getBoundingClientRect: () => ({ left: 0, top: 0, right: challengeArea ? 1000 : 100, bottom: challengeArea ? 700 : 20 }) } : null, createTreeWalker: () => ({ currentNode: nodes[0], nextNode: () => { ++walked; return nodes[++index] ?? null; } }) } };
  const value = runInNewContext('(' + inspectAutosurfPage.toString() + ')(location.origin,location.href)', context);
  return { value: JSON.parse(JSON.stringify(value)), walked };
}
test('fixed page inspection excludes actions, credentials, query/hash, files, malformed and foreign URLs', () => {
  const values = ['/next', '/logout', '/checkout', '/delete', '/buy/product', '/file.pdf', '/oauth/accept', 'https://u:p@owned.example.com/a', '/account?token=SECRET', '/route#secret', 'javascript:alert(1)', '//other.example.com/a', '/a%0Ab', '/a%5Cb', '/bad%zz', '/sign-in', '/log-out', '/account', '/api/route', '/%2564elete', '/a%250Ab', '/a%253Fsecret'];
  const f = pageFixture(values); assert.deepEqual(f.value.links, ['https://owned.example.com/next']); assert.equal(f.value.hoverPoints.length, 1); assert.ok(!JSON.stringify(f.value).includes('SECRET'));
});
test('page traversal and returned candidates stay bounded on huge DOM fixtures', () => { const f = pageFixture(Array.from({ length: 2000 }, (_, i) => '/page-' + i)); assert.ok(f.walked <= 128); assert.equal(f.value.links.length, 32); assert.equal(f.value.hoverPoints.length, 8); });
test('visible challenge form yields a candidate while a normal page has no challenge', () => { assert.equal(pageFixture(['/next']).value.challenge, null); const f = pageFixture(['/next'], { challenge: true }); assert.equal(f.value.challenge, 'visible-challenge'); assert.deepEqual(f.value.links, []); });
test('a hidden or small embedded challenge element is not treated as blocking', () => { assert.equal(pageFixture(['/next'], { challenge: true, challengeHidden: true }).value.challenge, null); assert.equal(pageFixture(['/next'], { challenge: true, challengeArea: false }).value.challenge, null); });
test('normal CAPTCHA and Precursor script URLs do not by themselves mark a challenge', () => { const f = pageFixture(['/cdn-cgi/challenge-platform/h/g/scripts/precursor/abcdefabcdef/main.js', '/recaptcha/help', '/turnstile/documentation']); assert.equal(f.value.challenge, null); });
test('hidden page returns only aggregate geometry with no candidate links', () => { const f = pageFixture(['/next'], { hidden: true }); assert.equal(f.value.hidden, true); assert.deepEqual(f.value.links, []); assert.equal(f.walked, 0); });
