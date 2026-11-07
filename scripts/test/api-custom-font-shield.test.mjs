// ADR-110: the page-side installer of the HTML/CSS font shield, run as the page bootstrap runs it (serialized, in a fresh realm) against a
// synthetic document with constructed style sheets and a synthetic FontFace. The real engines are covered by scripts/test/font-shield-native.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { installFontShield } from '../../apps/production-extension/api-custom-font-shield-runtime.js';

// Window shaped realm: `document` is an unforgeable accessor, adoptedStyleSheets lives on Document.prototype and only takes sheets that were
// constructed for that very document (as engines do). counts.* count native calls; pageRuns counts page-patched code that ran and must stay 0.
const MOCKS = `(() => {
  const owner = new WeakMap(), texts = new WeakMap(), lists = new WeakMap();
  const counts = globalThis.counts = { replace: 0, construct: 0, set: 0, fontFace: 0 };
  globalThis.pageRuns = 0;
  const define = (name, value) => Object.defineProperty(globalThis, name, { value, writable: true, configurable: true, enumerable: false });
  const token = new WeakMap(); const idOf = target => { if (!token.has(target)) token.set(target, {}); return token.get(target); };
  class Document { get adoptedStyleSheets() { return [...(lists.get(this.__id ?? idOf(this)) ?? [])]; }
    set adoptedStyleSheets(value) { counts.set++; if (globalThis.setThrows) throw new DOMException('read only', 'NotAllowedError'); const next = [...value]; for (const sheet of next) if (owner.get(sheet) !== (this.__id ?? idOf(this))) throw new DOMException('wrong document', 'NotAllowedError'); lists.set(this.__id ?? idOf(this), next); } }
  class CSSStyleSheet { constructor() { counts.construct++; owner.set(this, current.__id ?? idOf(current)); }
    replaceSync(text) { counts.replace++; if (globalThis.replaceThrows) throw new DOMException('no', 'NotAllowedError'); texts.set(this, String(text)); } }
  let current = new Document();
  globalThis.swapDocument = () => { current = new Document(); return current; };
  globalThis.anotherWrapper = () => { const twin = Object.create(current); Object.defineProperty(twin, '__id', { value: current.__id ?? idOf(current) }); current = twin; return twin; };
  globalThis.textOf = sheet => texts.get(sheet);
  globalThis.sheetsOf = target => [...(lists.get(target.__id ?? idOf(target)) ?? [])];
  define('Document', Document); define('CSSStyleSheet', CSSStyleSheet);
  Object.defineProperty(globalThis, 'document', { get() { return current; }, enumerable: true, configurable: false });
  globalThis.faceCalls = [];
  const installed = new Set(['century gothic', 'arial', 'agency fb']);
  class FontFace { constructor(family, source, descriptors) { counts.fontFace++; globalThis.faceCalls[globalThis.faceCalls.length] = { args: [...arguments], target: new.target, self: this };
    if (typeof source === 'string' && source.includes('throw-me')) throw new TypeError('synthetic native failure'); this.family = family; this.source = source; }
    load() { const names = [...String(this.source).matchAll(/local\\(\\s*(?:"([^"]*)"|'([^']*)'|([^)"']*))\\s*\\)/gi)].map(match => (match[1] ?? match[2] ?? match[3]).trim().toLowerCase());
      return names.some(name => installed.has(name)) ? Promise.resolve(this) : Promise.reject(new DOMException('missing', 'NetworkError')); } }
  define('FontFace', FontFace);
})();`;

function fixture(list, { mocks = MOCKS, setup = '', entries } = {}) {
  const context = vm.createContext({ DOMException });
  vm.runInContext(mocks + '\n' + setup + '\nglobalThis.installFontShield = (' + installFontShield.toString() + ');', context);
  context.entries = entries ?? [{ id: 'canvas-font-policy', mode: 'custom', fontShadow: list }];
  const run = source => vm.runInContext(source, context);
  return { context, run, install: () => run('globalThis.guard = installFontShield(globalThis, entries)') };
}
const rules = text => [...text.matchAll(/@font-face\{font-family:"([^"]*)";(src:[^;]*);unicode-range:(U\+[0-9A-F]+);font-stretch:(\d+%)\}/gu)].map(match => ({ name: match[1], src: match[2], range: match[3], stretch: match[4] }));

test('one sheet is adopted: a rule per safe, distinct hidden name, only local() sources, a range no text uses, and the worst style match', () => {
  const unsafe = ['Bad"Name', "Bad'Name", 'Back\\slash', 'Semi;colon', 'Com,ma', 'Brace{', 'Angle<', 'x'.repeat(129), '', 'Tab\there', 'Ünicode'];
  const f = fixture(['Century Gothic', 'Agency FB', 'Zz Name', 'century gothic', ...unsafe, 5, null, undefined, {}]); f.install();
  const sheets = f.run('sheetsOf(document)'); assert.equal(sheets.length, 1);
  const text = f.run('textOf(sheetsOf(document)[0])'), parsed = rules(text);
  assert.deepEqual(parsed.map(rule => rule.name), ['Century Gothic', 'Agency FB', 'Zz Name'], 'listed order, duplicates (any case) and unsafe or non-string names dropped');
  assert.equal(text.split('@font-face').length - 1, 3);
  for (const rule of parsed) { assert.match(rule.src, /^src:local\(Arial\),local\("Segoe UI"\),/u); assert.ok(!rule.src.includes('url('), 'no fetch'); assert.equal(rule.range, 'U+10FFFF'); assert.equal(rule.stretch, '200%'); }
  assert.ok(!/@import|url\(|expression|javascript/iu.test(text));
  assert.deepEqual(JSON.parse(JSON.stringify(f.run('guard.snapshot()'))), { installed: 3, unavailable: 0, changed: 0, names: 3, stopped: false });
  assert.equal(f.run('counts.construct'), 1); assert.equal(f.run('counts.replace'), 1); assert.equal(f.run('pageRuns'), 0);
});

test('sheets the page adopted stay in place and in order; the shield goes last', () => {
  const f = fixture(['Century Gothic'], { setup: 'const page = new CSSStyleSheet(); page.replaceSync("p{color:red}"); document.adoptedStyleSheets = [page]; globalThis.pageSheet = page;' });
  f.install();
  const sheets = f.run('sheetsOf(document)'); assert.equal(sheets.length, 2);
  assert.equal(f.run('sheetsOf(document)[0] === pageSheet'), true); assert.equal(f.run('textOf(pageSheet)'), 'p{color:red}');
  assert.equal(rules(f.run('textOf(sheetsOf(document)[1])')).length, 1);
});

test('no Custom font row, a row that is not Custom, or no fontShadow array installs nothing and leaves FontFace alone', () => {
  for (const entries of [[], [{ id: 'canvas-font-policy', mode: 'on', fontShadow: ['Arial'] }], [{ id: 'canvas-font-policy', mode: 'custom' }], [{ id: 'canvas-font-policy', mode: 'custom', fontShadow: 'Arial' }], [{ id: 'canvas-font-policy', mode: 'custom', fontShadow: [] }], [{ id: 'canvas-text-metrics', mode: 'custom', fontShadow: ['Arial'] }]]) {
    const f = fixture(null, { entries }); f.install();
    assert.equal(f.run('sheetsOf(document).length'), 0); assert.equal(f.run('counts.construct'), 0);
    assert.equal(f.run('FontFace === FontFace && Object.getOwnPropertyDescriptor(FontFace.prototype, "constructor").value === FontFace'), true);
    assert.equal(f.run('faceCalls.length'), 0);
    assert.equal(f.run('guard.snapshot().names'), 0);
  }
});

test('FontFace: the original runs once with the original arguments and new.target; only a hidden local() name is replaced by an absent one', async () => {
  const f = fixture(['Century Gothic', 'Agency FB']); f.install();
  const Wrapper = f.run('FontFace');
  // A hidden installed font stops loading like a missing one; an allowed or unknown name keeps its native answer.
  const hiddenFace = f.run('new FontFace("p1", "local(\\"Century Gothic\\")")'), keptFace = f.run('new FontFace("p2", "local(Arial)")');
  await assert.rejects(hiddenFace.load(), { name: 'NetworkError' }); assert.equal(await keptFace.load(), keptFace);
  assert.deepEqual(JSON.parse(f.run('JSON.stringify(faceCalls.map(call => call.args))')), [['p1', 'local("detect.expert absent")'], ['p2', 'local(Arial)']]);
  assert.equal(f.run('faceCalls.length'), 2, 'one native construction per call');
  const text = source => f.run('(() => { const face = new FontFace("x", ' + JSON.stringify(source) + '); return faceCalls[faceCalls.length - 1].args[1]; })()');
  assert.equal(text('LOCAL( "century gothic" )'), 'local("detect.expert absent")', 'case, spaces and quote style do not matter');
  assert.equal(text("local('Agency FB')"), 'local("detect.expert absent")');
  assert.equal(text('local(  agency fb  )'), 'local("detect.expert absent")', 'bare names too');
  assert.equal(text('url(a.woff2) format("woff2"), local("Century Gothic"), url(b.woff2), local(Arial)'), 'url(a.woff2) format("woff2"), local("detect.expert absent"), url(b.woff2), local(Arial)', 'other sources are kept');
  assert.equal(text('local(Century Gothic), local(Agency FB)'), 'local("detect.expert absent"), local("detect.expert absent")', 'several hidden names');
  assert.equal(text('local("Arial"), local("Century Gothic Bold")'), 'local("Arial"), local("Century Gothic Bold")', 'only the exact family name');
  assert.equal(text('url("local(Century Gothic)")'), 'url("local(Century Gothic)")', 'inside a quoted url it is not a local()');
  assert.equal(text('local("Century\\\\ Gothic")'), 'local("Century\\\\ Gothic")', 'an escape is never interpreted');
  assert.equal(text('local("Century Gothic"'), 'local("Century Gothic"', 'an unterminated token is left alone');
  assert.equal(text('local("Century Gothic" x)'), 'local("Century Gothic" x)', 'not a plain local(name)');
  assert.equal(text('local()'), 'local()'); assert.equal(text(''), '');
  assert.equal(text('a'.repeat(5000) + 'local("Century Gothic")'), 'a'.repeat(5000) + 'local("Century Gothic")', 'a source over 4096 characters is left to the engine');
  // Other arguments are forwarded untouched, including a non-string source and the descriptors object; the page's coercion is never run.
  const buffer = f.run('globalThis.bytes = new ArrayBuffer(4)'); f.run('new FontFace("b", bytes, { weight: "700" })');
  assert.equal(f.run('faceCalls[faceCalls.length - 1].args[1] === bytes'), true); assert.deepEqual(JSON.parse(f.run('JSON.stringify({ ...faceCalls[faceCalls.length - 1].args[2] })')), { weight: '700' });
  assert.equal(f.run('faceCalls[faceCalls.length - 1].args.length'), 3);
  f.run('globalThis.touched = 0; new FontFace("c", { toString() { touched++; return "local(Century Gothic)"; } })');
  assert.equal(f.run('touched'), 0, 'an object source is not coerced'); assert.equal(f.run('faceCalls[faceCalls.length - 1].args[1].toString === undefined'), false);
  // Identity: new.target, the prototype link, subclassing, instanceof, errors.
  assert.equal(f.run('faceCalls[0].target === FontFace'), false, 'a direct new FontFace reaches the native constructor with the native constructor as new.target, not with the wrapper');
  assert.equal(f.run('faceCalls[0].self instanceof FontFace && Object.getPrototypeOf(faceCalls[0].self) === FontFace.prototype'), true, 'the instance belongs to the native prototype');
  assert.equal(f.run('(() => { const face = new FontFace("i", "local(Arial)"); return face instanceof FontFace && face.constructor === FontFace && FontFace.prototype.constructor === FontFace; })()'), true);
  assert.equal(f.run('class Mine extends FontFace { constructor() { super("m", "local(\\"Century Gothic\\")"); } } const mine = new Mine(); mine instanceof Mine && mine instanceof FontFace && faceCalls[faceCalls.length - 1].target === Mine && faceCalls[faceCalls.length - 1].args[1] === "local(\\"detect.expert absent\\")"'), true);
  assert.throws(() => f.run('new FontFace("e", "throw-me")'), { name: 'TypeError', message: 'synthetic native failure' });
  assert.equal(f.run('FontFace.length'), 3, 'the mock constructor declares three parameters; the wrapper forwards length and name'); assert.equal(f.run('FontFace.name'), 'FontFace'); assert.equal(Wrapper === f.run('FontFace'), true);
  assert.deepEqual(JSON.parse(JSON.stringify(f.run('guard.snapshot()'))).changed >= 5, true);
  assert.equal(f.run('pageRuns'), 0);
});

test('a window that a new document reuses gets the sheet again, once; the old document keeps its own and no second installer duplicates it', () => {
  const f = fixture(['Century Gothic']); f.install();
  const oldDocument = f.run('document');
  assert.equal(f.run('Object.getOwnPropertyDescriptor(globalThis, Symbol.for("detect.expert/api-custom/font-shield/v1")).configurable'), false);
  // Same document: nothing happens, however often the document runtime asks.
  for (let index = 0; index < 5; index++) f.run('globalThis[Symbol.for("detect.expert/api-custom/font-shield/v1")]()');
  assert.equal(f.run('counts.construct'), 1); assert.equal(f.run('sheetsOf(document).length'), 1);
  // A second copy of the installer (the frame's own injected script) finds the first one's refresher and installs nothing twice.
  f.run('globalThis.second = (' + installFontShield.toString() + '); second(globalThis, entries)');
  assert.equal(f.run('counts.construct'), 1); assert.equal(f.run('sheetsOf(document).length'), 1); assert.equal(f.run('faceCalls.length'), 0);
  assert.equal(f.run('FontFace.prototype.constructor === FontFace'), true);
  // The window gets a new document: the next refresh adopts a sheet there.
  f.run('swapDocument()');
  assert.equal(f.run('sheetsOf(document).length'), 0);
  f.run('globalThis[Symbol.for("detect.expert/api-custom/font-shield/v1")]()');
  assert.equal(f.run('sheetsOf(document).length'), 1); assert.equal(rules(f.run('textOf(sheetsOf(document)[0])')).length, 1); assert.equal(f.run('counts.construct'), 2);
  f.run('globalThis[Symbol.for("detect.expert/api-custom/font-shield/v1")]()'); f.run('second(globalThis, entries)');
  assert.equal(f.run('counts.construct'), 2, 'still one sheet per document'); assert.equal(f.run('sheetsOf(document).length'), 1);
  assert.equal(f.context.sheetsOf(oldDocument).length, 1, 'the old document is untouched');
  // The same document reached again through another wrapper (Firefox hands out new references) does not get a second sheet.
  f.run('anotherWrapper()'); f.run('globalThis[Symbol.for("detect.expert/api-custom/font-shield/v1")]()');
  assert.equal(f.run('counts.construct'), 2, 'no third sheet'); assert.equal(f.run('sheetsOf(document).length'), 1);
  assert.equal(f.run('guard.snapshot().installed'), 4, 'sheet, constructor link, FontFace binding, second document');
});

test('natives are captured once: page code patched later is never run by the refresh or the FontFace hook', () => {
  const f = fixture(['Century Gothic']); f.install();
  f.run('globalThis.refresh = globalThis[Symbol.for("detect.expert/api-custom/font-shield/v1")]');
  f.run(`const define = Object.defineProperty; for (const [object, key] of [[Array.prototype, 'push'], [String.prototype, 'slice'], [String.prototype, 'toLowerCase'], [String.prototype, 'charCodeAt'], [Object, 'defineProperty'], [Object, 'getOwnPropertyDescriptor'], [Reflect, 'apply'], [Reflect, 'construct'], [Array, 'isArray'], [Symbol, 'for']]) {
    const native = object[key]; define(object, key, { value: function () { pageRuns++; return native.apply(this, arguments); }, configurable: true, writable: true });
  } pageRuns = 0;`);
  f.run('swapDocument()');
  f.run('refresh()');
  f.run('new FontFace("p", "local(\\"Century Gothic\\")")');
  assert.equal(f.run('pageRuns'), 0, 'no patched builtin ran inside the installer');
  assert.equal(f.run('sheetsOf(document).length'), 1);
});

test('failures never reach the page: missing sheet API, a throwing replaceSync or adoptedStyleSheets, a missing or fixed FontFace', () => {
  for (const [label, setup, expectInstalled] of [
    ['no CSSStyleSheet', 'delete globalThis.CSSStyleSheet;', true], ['replaceSync throws', 'globalThis.replaceThrows = true;', true], ['adopting throws', 'globalThis.setThrows = true;', true],
    ['no adoptedStyleSheets', 'delete Document.prototype.adoptedStyleSheets;', true], ['no FontFace', 'delete globalThis.FontFace;', false],
    ['FontFace is fixed', 'Object.defineProperty(globalThis, "FontFace", { value: FontFace, writable: false, configurable: false });', false],
  ]) {
    const f = fixture(['Century Gothic'], { setup }); assert.doesNotThrow(() => f.install(), label);
    const snapshot = JSON.parse(JSON.stringify(f.run('guard.snapshot()')));
    assert.ok(snapshot.unavailable >= 1, label + ': counted as unavailable (' + JSON.stringify(snapshot) + ')');
    if (label === 'no FontFace' || label === 'FontFace is fixed') assert.equal(f.run('sheetsOf(document).length'), 1, label + ': the sheet still works');
    else assert.equal(f.run('sheetsOf(document).length'), 0, label);
    if (expectInstalled && label !== 'no adoptedStyleSheets') assert.equal(f.run('FontFace.prototype.constructor === FontFace'), true, label + ': FontFace still installed');
    assert.equal(f.run('pageRuns'), 0);
  }
  const f = fixture(['Century Gothic']); f.install();
  f.run('globalThis.setThrows = true; swapDocument();'); assert.doesNotThrow(() => f.run('globalThis[Symbol.for("detect.expert/api-custom/font-shield/v1")]()'));
});

test('stop() removes the sheet and the hook only where the page has not taken the property over', () => {
  const f = fixture(['Century Gothic']); f.install();
  assert.equal(f.run('sheetsOf(document).length'), 1);
  const wrapper = f.run('FontFace');
  f.run('globalThis.Retained = FontFace; guard.stop();');
  assert.equal(f.run('sheetsOf(document).length'), 0); assert.notEqual(f.run('FontFace'), wrapper); assert.equal(f.run('FontFace.prototype.constructor === FontFace'), true);
  f.run('new FontFace("p", "local(\\"Century Gothic\\")")'); assert.equal(f.run('faceCalls[0].args[1]'), 'local("Century Gothic")', 'stopped: nothing is rewritten');
  f.run('new Retained("r", "local(\\"Century Gothic\\")")'); assert.equal(f.run('faceCalls[faceCalls.length - 1].args[1]'), 'local("Century Gothic")', 'a wrapper the page kept does nothing after stop');
  f.run('guard.stop()'); assert.equal(f.run('guard.snapshot().stopped'), true);
  const g = fixture(['Century Gothic']); g.install();
  g.run('globalThis.FontFace = class PageFace {}'); g.run('guard.stop()');
  assert.equal(g.run('FontFace.name'), 'PageFace', 'a replacement by the page stays');
});

// ADR-112 follow-up: what a page can look at on the FontFace wrapper. Same probe as scripts/test/api-custom-wrapper-parity.test.mjs: close a
// prototype cycle through the function, read it, change its prototype in a legal way and restore it. A Proxy that forwards the cycle makes
// every later property read overflow the stack; the native constructor refuses it with a TypeError.
const CYCLE = `(fn => {
  const out = {}, native = Object.getPrototypeOf(fn);
  try { Object.setPrototypeOf(fn, fn); out.threw = false; } catch (error) { out.threw = error instanceof TypeError; out.message = String(error.message); }
  out.proto = Object.getPrototypeOf(fn) === native;
  out.reads = [typeof fn.name, typeof fn.length, typeof fn.call, typeof fn.bind].join();
  out.reflectOther = Reflect.setPrototypeOf(fn, Object.prototype) && Object.getPrototypeOf(fn) === Object.prototype;
  out.restored = Reflect.setPrototypeOf(fn, native) && Object.getPrototypeOf(fn) === native;
  return out;
})`;

test('FontFace wrapper: a prototype cycle through it is refused with the engine TypeError, other prototype changes are forwarded, the constructor keeps working', () => {
  const native = fixture(['Century Gothic']).run(CYCLE + '(FontFace)');
  assert.equal(native.threw, true, 'the native constructor refuses the cycle with a TypeError'); assert.match(native.message, /cyclic|cycle/i);
  const f = fixture(['Century Gothic']); f.install();
  const out = f.run(CYCLE + '(FontFace)');
  assert.equal(out.threw, true, 'a TypeError, as for the native constructor'); assert.equal(out.message, native.message, 'the engine\'s own message, not a Proxy invariant message');
  assert.equal(out.proto, true, 'the prototype is unchanged'); assert.equal(out.reads, 'string,number,function,function', 'properties stay readable');
  assert.equal(out.reflectOther, true, 'another prototype is forwarded to the native constructor'); assert.equal(out.restored, true);
  // The attempts left a working wrapper: it rewrites a hidden local() name once, constructs instances of the native prototype and subclasses.
  assert.equal(f.run('FontFace.prototype.constructor === FontFace'), true);
  assert.equal(f.run('(() => { const face = new FontFace("p", "local(\\"Century Gothic\\")"); return face instanceof FontFace && faceCalls.length === 1 && faceCalls[0].args[1] === "local(\\"detect.expert absent\\")"; })()'), true);
  assert.equal(f.run('class Mine extends FontFace { constructor() { super("m", "local(Arial)"); } } new Mine() instanceof Mine'), true);
  // Repeated attempts change nothing.
  assert.equal(f.run('(() => { for (let attempt = 0; attempt < 3; attempt++) { try { Object.setPrototypeOf(FontFace, FontFace); } catch { /* refused */ } } return Object.getPrototypeOf(FontFace) === Function.prototype && FontFace.name === "FontFace" && FontFace.length === 3; })()'), true);
  assert.equal(f.run('guard.snapshot().unavailable'), 0);
  // The guard does not depend on the shield being active: a wrapper the page kept still refuses the cycle after stop(), where the rewrite is off.
  const g = fixture(['Century Gothic']); g.install(); g.run('globalThis.Retained = FontFace; guard.stop();');
  const kept = g.run(CYCLE + '(Retained)');
  assert.equal(kept.threw, true); assert.equal(kept.proto, true); assert.equal(kept.reads, 'string,number,function,function'); assert.equal(kept.reflectOther, true); assert.equal(kept.restored, true);
  g.run('new Retained("r", "local(\\"Century Gothic\\")")'); assert.equal(g.run('faceCalls[faceCalls.length - 1].args[1]'), 'local("Century Gothic")', 'stopped: still nothing is rewritten');
});

test('FontFace wrapper: the cycle guard uses captured natives and no trap is inherited from a page-extended Object.prototype', () => {
  const f = fixture(['Century Gothic']); f.install();
  // Natives the "page" kept before it patched them: calling them reaches the wrapper's trap without running a patched function itself.
  f.run(`globalThis.nativeSet = Object.setPrototypeOf; globalThis.nativeReflectSet = Reflect.setPrototypeOf; globalThis.nativeDefine = Object.defineProperty; globalThis.hits = { count: 0 };
    for (const [object, key] of [[Object, 'setPrototypeOf'], [Reflect, 'setPrototypeOf']]) {
      const native = object[key]; Object.defineProperty(object, key, { value: function () { hits.count++; return native.apply(this, arguments); }, configurable: true, writable: true });
    }`);
  f.run('try { nativeSet(FontFace, FontFace); } catch { /* refused */ } nativeReflectSet(FontFace, Object.prototype); nativeReflectSet(FontFace, Function.prototype);');
  assert.equal(f.run('hits.count'), 0, 'the guard and the forwarding ran the captured Object.setPrototypeOf / Reflect.setPrototypeOf only');
  assert.equal(f.run('Object.getPrototypeOf(FontFace) === Function.prototype'), true);
  // A trap name that a page adds to Object.prototype is never read as a trap of the wrapper. The descriptors have a null prototype because `get` and
  // `set` are descriptor fields; once they exist no global is written (the vm global would build an invalid descriptor), so the probes return their facts.
  const poison = names => f.run(`for (const trap of ${JSON.stringify(names)}) nativeDefine(Object.prototype, trap, { __proto__: null, value: function () { hits.count++; throw new Error('inherited trap ' + trap); }, configurable: true, writable: true });`);
  poison(['has', 'apply', 'getOwnPropertyDescriptor', 'defineProperty', 'getPrototypeOf', 'ownKeys', 'deleteProperty', 'isExtensible', 'preventExtensions']);
  assert.equal(f.run(`(() => { try { 'name' in FontFace; Object.getOwnPropertyDescriptor(FontFace, 'name'); Object.getPrototypeOf(FontFace); Reflect.ownKeys(FontFace); Object.isExtensible(FontFace); delete FontFace.nothing; return 'quiet'; } catch (error) { return 'leaked: ' + error.message; } })()`), 'quiet');
  assert.equal(f.run('hits.count'), 0, 'no inherited trap ran');
  poison(['get', 'set']);
  assert.equal(f.run(`(() => { try { const read = [FontFace.name, FontFace.length, typeof FontFace.call].join(); FontFace.pageMark = 1; return read + '|' + FontFace.pageMark; } catch (error) { return 'leaked: ' + error.message; } })()`), 'FontFace,3,function|1');
  assert.equal(f.run('(() => { try { nativeSet(FontFace, FontFace); return "accepted"; } catch (error) { return error instanceof TypeError ? "refused" : "other"; } })()'), 'refused', 'the guard still answers with a poisoned Object.prototype');
  assert.equal(f.run('hits.count'), 0);
});
