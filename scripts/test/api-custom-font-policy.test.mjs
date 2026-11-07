// S3 (surfaces installer): canvas-font-policy matches family names case-insensitively, lets families the page registered itself
// (FontFace / @font-face, read through captured natives) pass, and accepts up to 256 selected names.
// Actual serialized production installer, synthetic CanvasRenderingContext2D / FontFaceSet / FontFace.
import test from 'node:test';
import assert from 'node:assert/strict';
import { surfaceFixture } from './surface-test-kit.mjs';

// Window (default) or worker shaped realm. Globals are non-enumerable like the browser's; `document` is an unforgeable accessor.
// counts.* count native calls; pageRuns counts page-patched code that ran and must stay 0 in every test.
function fontMocks({ worker = false, documentAccessor = true } = {}) {
  return `(() => {
    const fontOf = new WeakMap(), lists = new WeakMap(), records = new WeakMap(), sets = new WeakMap();
    const counts = globalThis.counts = { fontSet: 0, walk: 0, size: 0, family: 0, fonts: 0, document: 0 };
    globalThis.pageRuns = 0;
    const define = (name, value) => Object.defineProperty(globalThis, name, { value, writable: true, configurable: true, enumerable: false });
    const contextClass = name => ({ [name]: class {
      constructor() { fontOf.set(this, '10px sans-serif'); }
      get font() { if (!fontOf.has(this)) throw new TypeError('Illegal invocation'); return fontOf.get(this); }
      set font(value) { if (!fontOf.has(this)) throw new TypeError('Illegal invocation'); counts.fontSet++; value = String(value); if (/px /.test(value)) fontOf.set(this, value); }
    } })[name];
    const listOf = set => { const list = lists.get(set); if (!list) throw new TypeError('Illegal invocation'); return list; };
    class FontFaceSet {
      constructor() { lists.set(this, []); }
      get size() { counts.size++; if (globalThis.sizeFault) throw new Error('SIZE_FAULT'); return listOf(this).length; }
      add(face) { listOf(this).push(face); return this; }
      delete(face) { const list = listOf(this), at = list.indexOf(face); if (at >= 0) list.splice(at, 1); return at >= 0; }
      has(face) { return listOf(this).includes(face); }
      forEach(callback, thisArg) { counts.walk++; if (globalThis.walkFault) throw new Error('WALK_FAULT'); for (const face of [...listOf(this)]) callback.call(thisArg, face, face, this); }
      values() { return [...listOf(this)][Symbol.iterator](); }
      keys() { return this.values(); }
      entries() { return [...listOf(this)].map(face => [face, face])[Symbol.iterator](); }
      [Symbol.iterator]() { return this.values(); }
    }
    class FontFace {
      constructor(family) { records.set(this, { family }); }
      get family() { counts.family++; const record = records.get(this); if (!record) throw new TypeError('Illegal invocation'); return record.family; }
      set family(value) { const record = records.get(this); if (!record) throw new TypeError('Illegal invocation'); record.family = value; }
    }
    define('FontFaceSet', FontFaceSet); define('FontFace', FontFace);
    define('OffscreenCanvasRenderingContext2D', contextClass('OffscreenCanvasRenderingContext2D'));
    ${worker ? `
    const workerSet = new FontFaceSet();
    Object.defineProperty(globalThis, 'fonts', { get() { counts.fonts++; return workerSet; }, enumerable: true, configurable: true });
    ` : `
    define('CanvasRenderingContext2D', contextClass('CanvasRenderingContext2D'));
    class Document { get fonts() { counts.fonts++; let set = sets.get(this); if (!set) { set = new FontFaceSet(); sets.set(this, set); } return set; } }
    define('Document', Document);
    let current = new Document();
    globalThis.swapDocument = () => { current = new Document(); ${documentAccessor ? '' : "Object.defineProperty(globalThis, 'document', { value: current, writable: true, configurable: true, enumerable: true });"} };
    ${documentAccessor
      ? "Object.defineProperty(globalThis, 'document', { get() { counts.document++; return current; }, enumerable: true, configurable: false });"
      : "Object.defineProperty(globalThis, 'document', { value: current, writable: true, configurable: true, enumerable: true });"}
    `}
  })();`;
}

function policy(families, { worker = false, setup = '', documentAccessor = true, fallback = 'sans-serif' } = {}) {
  const run = surfaceFixture([{ id: 'canvas-font-policy', value: { families, fallback } }], { mocks: fontMocks({ worker, documentAccessor }), setup });
  run('globalThis.c = new ' + (worker ? 'OffscreenCanvasRenderingContext2D' : 'CanvasRenderingContext2D') + '();');
  const font = text => { run('c.font = ' + JSON.stringify(text)); return run('c.font'); };
  const registry = worker ? 'fonts' : 'document.fonts';
  const register = (...names) => run(names.map(name => registry + '.add(new FontFace(' + JSON.stringify(name) + '));').join(''));
  return { run, font, register, registry };
}

test('family names match case-insensitively, generics too; anything else is still replaced by the fallback', () => {
  const { run, font } = policy(['Arial', 'Segoe UI', 'Ünicode Font']);
  assert.equal(font('12px arial'), '12px arial');
  assert.equal(font('12px ARIAL, Verdana'), '12px ARIAL', 'the unlisted family is dropped');
  assert.equal(font('14px "segoe ui", serif'), '14px "segoe ui", serif');
  assert.equal(font("bold 14px 'SEGOE UI'"), "bold 14px 'SEGOE UI'");
  assert.equal(font('12px Segoe UI'), '12px Segoe UI', 'unquoted multi-word name');
  assert.equal(font('12px "ünicode font"'), '12px "ünicode font"', 'Unicode lower-casing');
  assert.equal(font('12px SERIF'), '12px SERIF', 'generic keywords are case-insensitive');
  assert.equal(font('12px Sans-Serif, Verdana'), '12px Sans-Serif');
  assert.equal(font('12px Verdana'), '12px sans-serif', 'not selected, not registered: replaced');
  assert.equal(font('12px "serif"'), '12px sans-serif', 'a quoted "serif" is a family name, not the generic');
  assert.equal(run('counts.fontSet'), 2 * 10, 'the page assignment runs natively once per call, the policy writes the result once');
  assert.equal(run('pageRuns'), 0);
});

test('a family registered in the page FontFaceSet passes, also late and case-insensitively; removal restores the strict list', () => {
  const { run, font, register, registry } = policy(['Arial']);
  assert.equal(font('12px WebFont'), '12px sans-serif');
  register('WebFont');
  assert.equal(font('12px webfont, Verdana'), '12px webfont');
  run('globalThis.second = new FontFace("\\"Quoted Face\\""); ' + registry + '.add(second);');
  assert.equal(font('12px "quoted face"'), '12px "quoted face"', 'a family string that carries its own quotes');
  assert.equal(font('12px Arial, WebFont, Verdana'), '12px Arial, WebFont');
  run(registry + '.delete(second); globalThis.first = null;');
  assert.equal(font('12px "quoted face"'), '12px sans-serif');
  run('for (const face of Array.from(' + registry + ')) ' + registry + '.delete(face);');
  assert.equal(font('12px WebFont'), '12px sans-serif', 'unregistered again');
  assert.equal(run('pageRuns'), 0);
});

test('the registered set is cached by size: repeated calls never rescan, a size change rescans once', () => {
  const { run, font, register } = policy(['Arial']);
  register('WebFont');
  for (let index = 0; index < 50; index++) assert.equal(font('12px webfont'), '12px webfont');
  assert.equal(run('counts.walk'), 1, 'one walk for fifty canvas font assignments');
  assert.ok(run('counts.size') >= 50, 'the size is read on every consultation');
  register('Another');
  assert.equal(font('12px another'), '12px another'); assert.equal(font('12px webfont'), '12px webfont');
  assert.equal(run('counts.walk'), 2, 'one more walk after the size changed');
  // An allowed family never consults the set at all.
  const before = Number(run('counts.size')); font('12px arial'); assert.equal(Number(run('counts.size')), before);
});

test('at most 256 faces are examined, in insertion order', () => {
  const { run, font } = policy(['Arial']);
  run('for (let index = 0; index < 300; index++) document.fonts.add(new FontFace("Face" + index));');
  assert.equal(font('12px Face255'), '12px Face255');
  assert.equal(font('12px Face256'), '12px sans-serif');
  assert.equal(font('12px Face299'), '12px sans-serif');
  assert.equal(run('counts.family'), 256, 'the family getter ran for 256 faces only');
  // A face with a family over 128 characters or a non-string family is ignored, never fatal.
  run('document.fonts.delete(document.fonts.values().next().value); document.fonts.add(new FontFace("L".repeat(129))); document.fonts.add(new FontFace(42));');
  assert.equal(font('12px Face1'), '12px Face1');
  assert.equal(run('pageRuns'), 0);
});

test('the selected list is accepted up to 256 names of 128 characters; the rest is ignored', () => {
  const families = Array.from({ length: 300 }, (_, index) => 'Fam' + index); families[200] = 'L'.repeat(129);
  const { run, font } = policy(families);
  assert.equal(font('12px Fam0'), '12px Fam0'); assert.equal(font('12px fam199'), '12px fam199'); assert.equal(font('12px FAM255'), '12px FAM255', 'the 256th name is accepted');
  assert.equal(font('12px Fam256'), '12px sans-serif', 'the 257th name is not');
  assert.equal(font('12px Fam299'), '12px sans-serif');
  assert.equal(font('12px ' + 'L'.repeat(129)), '12px sans-serif', 'a 129-character name is ignored at both ends');
  assert.equal(font('12px "' + 'L'.repeat(128) + '"'), '12px sans-serif', 'not selected');
  const edge = policy(['E'.repeat(128)]);
  assert.equal(edge.font('12px ' + 'e'.repeat(128)), '12px ' + 'e'.repeat(128), 'a 128-character name is accepted');
  // Non-string, missing and empty lists never throw and leave the strict behaviour.
  for (const odd of [[1, null, {}, 'Arial'], [], undefined]) { const odds = policy(odd); assert.equal(odds.font('12px Arial'), odd && odd.includes('Arial') ? '12px Arial' : '12px sans-serif'); }
  assert.equal(run('pageRuns'), 0);
});

test('OffscreenCanvasRenderingContext2D follows the same rules and shares the window font set', () => {
  const { run, font, register } = policy(['Arial']);
  run('globalThis.off = new OffscreenCanvasRenderingContext2D(); off.font = "12px WebFont"; globalThis.before = off.font;');
  assert.equal(run('before'), '12px sans-serif');
  register('WebFont');
  run('off.font = "12px webfont, arial, Verdana";');
  assert.equal(run('off.font'), '12px webfont, arial');
  assert.equal(font('12px WEBFONT'), '12px WEBFONT');
});

test('a worker realm reads WorkerGlobalScope.fonts', () => {
  const { run, font, register } = policy(['Arial'], { worker: true });
  assert.equal(font('12px WebFont'), '12px sans-serif');
  register('WebFont');
  const before = Number(run('counts.fonts'));
  assert.equal(font('12px webfont'), '12px webfont'); assert.equal(font('12px ARIAL'), '12px ARIAL');
  assert.equal(run('typeof document + typeof Document'), 'undefinedundefined');
  assert.equal(Number(run('counts.fonts')) - before, 1, 'worker fonts are consulted only for the family the list rejects, never a window document');
});

test('the current document is read each time: a replaced document does not inherit the old set, even at equal size', () => {
  const { run, font, register } = policy(['Arial']);
  register('WebA');
  assert.equal(font('12px weba'), '12px weba');
  run('swapDocument();'); register('WebB');
  assert.equal(font('12px webb'), '12px webb'); assert.equal(font('12px weba'), '12px sans-serif', 'both sets have size 1; the cache is per set');
});

test('a hostile page cannot run code: patched FontFaceSet, FontFace, Document and String methods are never reached', () => {
  const { run, font, register } = policy(['Arial']);
  register('WebFont');
  assert.equal(font('12px webfont'), '12px webfont');
  run('globalThis.realSet = document.fonts;');
  run(`
    FontFaceSet.prototype.forEach = function() { pageRuns++; };
    Object.defineProperty(FontFaceSet.prototype, 'size', { get() { pageRuns++; throw new Error('PAGE_SIZE'); }, configurable: true });
    Object.defineProperty(FontFace.prototype, 'family', { get() { pageRuns++; throw new Error('PAGE_FAMILY'); }, configurable: true });
    Object.defineProperty(Document.prototype, 'fonts', { get() { pageRuns++; throw new Error('PAGE_FONTS'); }, configurable: true });
    FontFaceSet.prototype[Symbol.iterator] = FontFaceSet.prototype.values = FontFaceSet.prototype.entries = FontFaceSet.prototype.keys = function() { pageRuns++; throw new Error('PAGE_ITER'); };
    String.prototype.toLowerCase = function() { pageRuns++; return 'evil'; };
    String.prototype.trim = function() { pageRuns++; return ''; };
    String.prototype.slice = function() { pageRuns++; return ''; };
    Array.prototype.join = function() { pageRuns++; return ''; };
  `);
  // The set grows after the patch, so the rescan has to go through the captured natives too.
  run('Reflect.apply(FontFaceSet.prototype.add, realSet, [new FontFace("LateFont")]);');
  assert.equal(font('12px latefont'), '12px latefont');
  assert.equal(font('12px WEBFONT, arial, Verdana'), '12px WEBFONT, arial');
  assert.equal(font('12px Verdana'), '12px sans-serif');
  assert.equal(run('pageRuns'), 0, 'no page-patchable method ran');
});

test('a missing or unusable capture keeps the strict list: no throw, no page code, no pass-through', () => {
  const variants = {
    'no forEach': { setup: 'delete FontFaceSet.prototype.forEach;' },
    'size is not an accessor': { setup: "Object.defineProperty(FontFaceSet.prototype, 'size', { value: 1, configurable: true });" },
    'no FontFace.family getter': { setup: 'delete FontFace.prototype.family;' },
    'no FontFace': { setup: 'delete globalThis.FontFace; delete globalThis.FontFaceSet;' },
    'Document.fonts is a method': { setup: "Object.defineProperty(Document.prototype, 'fonts', { value() { return null; }, configurable: true });" },
    'document is a plain value': { documentAccessor: false },
  };
  for (const [label, options] of Object.entries(variants)) {
    const { run, font } = policy(['Arial'], options);
    run('try { document.fonts.add(new FontFace("WebFont")); } catch {}');
    assert.equal(font('12px WebFont'), '12px sans-serif', label + ': strict');
    assert.equal(font('12px arial'), '12px arial', label + ': the selected list still works');
    assert.equal(run('pageRuns'), 0, label);
  }
});

test('failing natives at call time fall back to the strict list, cached per size so a failing walk is not repeated', () => {
  const walkFault = policy(['Arial']);
  walkFault.register('WebFont'); walkFault.run('globalThis.walkFault = true;');
  for (let index = 0; index < 5; index++) assert.equal(walkFault.font('12px webfont'), '12px sans-serif');
  assert.equal(walkFault.run('counts.walk'), 1, 'the failing walk ran once for this size');
  assert.equal(walkFault.font('12px arial'), '12px arial');
  const sizeFault = policy(['Arial']);
  sizeFault.register('WebFont'); sizeFault.run('globalThis.sizeFault = true;');
  assert.equal(sizeFault.font('12px webfont'), '12px sans-serif'); assert.equal(sizeFault.run('counts.walk'), 0);
  const odd = policy(['Arial']);
  odd.run('document.fonts.add(new FontFace(null)); document.fonts.add(new FontFace({ toString() { pageRuns++; return "Evil"; } })); document.fonts.add(new FontFace("Fine"));');
  assert.equal(odd.font('12px fine'), '12px fine', 'non-string families are skipped, not stringified'); assert.equal(odd.run('pageRuns'), 0);
});

test('wrong receivers stay native, the policy counts per context, and stop restores the setters', () => {
  const { run, font, register } = policy(['Arial']);
  assert.throws(() => run('Object.getOwnPropertyDescriptor(CanvasRenderingContext2D.prototype, "font").set.call({}, "12px X")'), error => error.name === 'TypeError' && /Illegal invocation/.test(error.message));
  assert.equal(run('counts.fontSet'), 0);
  const row = JSON.parse(run('JSON.stringify(guard.snapshot().entries[0])'));
  assert.equal(row.installed, 2); assert.equal(row.unavailable, 0);
  register('WebFont'); font('12px webfont'); font('12px Verdana');
  assert.equal(Number(run('guard.snapshot().changed')), 2);
  run('globalThis.retained = Object.getOwnPropertyDescriptor(CanvasRenderingContext2D.prototype, "font").set; guard.stop(); guard.stop();');
  assert.equal(font('12px Verdana'), '12px Verdana', 'stopped: the page value is kept');
  const count = Number(run('counts.fontSet'));
  run('Reflect.apply(retained, c, ["13px Anything"])');
  assert.equal(Number(run('counts.fontSet')) - count, 1, 'a retained wrapper passes straight to the native setter');
  assert.equal(run('c.font'), '13px Anything');
});

// ADR-110: the HTML/CSS font shield adopts hundreds of @font-face rules with unicode-range U+10FFFF into the same FontFaceSet.
test('shield faces (unicode-range U+10FFFF) are not families the page registered and never use up the bounded scan', () => {
  const setup = "const ranges = new WeakMap(); Object.defineProperty(FontFace.prototype, 'unicodeRange', { get() { return ranges.get(this) ?? 'U+0-10FFFF'; }, configurable: true }); globalThis.shield = name => { const face = new FontFace(name); ranges.set(face, 'U+10FFFF'); document.fonts.add(face); };";
  const { run, font, register } = policy(['Arial'], { setup });
  run('for (let index = 0; index < 400; index++) shield("Hidden" + index); shield("Century Gothic");');
  register('WebFont');
  assert.equal(font('12px WebFont'), '12px WebFont', 'a page face behind 401 shield faces is still seen (the scan is bounded at 256)');
  assert.equal(font('12px Century Gothic'), '12px sans-serif', 'a shield family is not a family the page registered');
  assert.equal(font('12px hidden7, Arial'), '12px Arial');
  assert.equal(run('counts.family'), 1, 'the family getter ran for the page face only');
  register('Century Gothic');
  assert.equal(font('12px century gothic'), '12px century gothic', 'a face the page defines under a shielded name passes');
  assert.equal(run('pageRuns'), 0);
});
