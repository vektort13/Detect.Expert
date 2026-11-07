// FP perf (live audit D-screen-10 / D-id-4): the document installer's post-insertion hooks must cost O(inserted nodes) -
// never O(receiver subtree) or O(whole document) - and must still protect every freshly inserted frame before the
// caller's next statement.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { installApiCustomDocument } from '../../apps/production-extension/api-custom-document-runtime.js';

const MARK = 8; // hardwareConcurrency selected by the Custom profile (the child realm natively reports 2)
const LIMIT = 60; // hook work per call (visited nodes + native queries + native reads), whatever the DOM size
const SMALL = 5, LARGE = 1500;
const POSITIONS = ['beforebegin', 'afterbegin', 'beforeend', 'afterend'];
const toLower = String.prototype.toLowerCase;
const lower = value => Reflect.apply(toLower, value, []);

// A small tree with native-like semantics (fragments empty on insertion, brand checks, static query results).
// Every native read/query the installer performs is counted, so a hook's cost can be compared across DOM sizes.
function createDom({ install = installApiCustomDocument, without = [] } = {}) {
  const nodes = new WeakMap(), windows = new WeakSet(), contexts = new WeakMap();
  const created = [], installed = [], operations = [], events = [];
  const stats = { visited: 0, queries: 0, documentQueries: 0, reads: 0 };
  const reason = new TypeError('Illegal invocation');
  let failure = null, reaction = null;
  const document = {};

  function data(node) {
    const entry = nodes.get(node);
    if (!entry) throw reason;
    return entry;
  }
  const is = (node, type) => data(node).type === type;
  function guard(receiver, type) { if (!is(receiver, type)) throw reason; }
  function checked(node) { if (!nodes.has(node)) throw reason; return node; }
  function enter(kind, receiver, args) {
    operations.push({ kind, receiver, args: [...args] });
    events.push('native');
    if (failure) throw failure;
  }
  function settle() { const run = reaction; reaction = null; if (run) run(); }
  function sibling(node, step) {
    const parent = data(node).parent;
    if (!parent) return null;
    const kids = data(parent).kids;
    return kids[kids.indexOf(node) + step] ?? null;
  }
  function detach(node) {
    const parent = data(node).parent;
    if (!parent) return;
    const kids = data(parent).kids;
    kids.splice(kids.indexOf(node), 1);
    data(node).parent = null;
  }
  // Insert before `reference` (null = at the end); a fragment hands over its children and is left empty.
  function place(parent, list, reference) {
    for (const node of list) {
      const entry = data(node);
      if (entry.type === 11) {
        const moved = entry.kids.splice(0);
        for (const kid of moved) data(kid).parent = null;
        place(parent, moved, reference);
        continue;
      }
      detach(node);
      const kids = data(parent).kids, at = reference ? kids.indexOf(reference) : -1;
      kids.splice(at < 0 ? kids.length : at, 0, node);
      entry.parent = parent;
    }
  }
  const convert = args => args.map(value => (nodes.has(value) ? value : new Text(String(value))));
  function parse(markup) {
    const root = new DocumentFragment(), open = [root];
    for (const token of String(markup).match(/<\/?[a-z]+>|[^<]+/gi) ?? []) {
      if (token.startsWith('</')) { if (open.length > 1) open.pop(); }
      else if (token.startsWith('<')) {
        const name = token.slice(1, -1), element = name === 'iframe' ? new HTMLIFrameElement() : new Element(name);
        place(open.at(-1), [element], null);
        open.push(element);
      } else place(open.at(-1), [new Text(token)], null);
    }
    const list = data(root).kids.splice(0);
    for (const kid of list) data(kid).parent = null;
    return list;
  }
  function select(root) {
    stats.queries++;
    if (is(root, 9)) stats.documentQueries++;
    const found = [];
    (function walk(node) {
      for (const kid of data(node).kids) {
        stats.visited++;
        if (data(kid).name === 'iframe' || data(kid).name === 'frame') found.push(kid);
        walk(kid);
      }
    })(root);
    return found;
  }
  function connected(node) {
    for (let current = node; current; current = data(current).parent) if (current === document) return true;
    return false;
  }
  function frames() {
    const found = [];
    (function walk(node) {
      for (const kid of data(node).kids) {
        if (contexts.has(kid)) found.push(contexts.get(kid));
        walk(kid);
      }
    })(document);
    return found;
  }
  // Insert at an `insertAdjacent*` position; false when the position needs a parent that is missing.
  function adjacent(receiver, where, list) {
    const parent = data(receiver).parent;
    if (where === 'afterbegin') place(receiver, list, data(receiver).kids[0] ?? null);
    else if (where === 'beforeend') place(receiver, list, null);
    else if (where === 'beforebegin' || where === 'afterend') {
      if (!parent || is(parent, 9)) return false;
      place(parent, list, where === 'beforebegin' ? receiver : sibling(receiver, 1));
    } else throw new SyntaxError('The value provided (' + where + ') is not one of the insertion positions.');
    return true;
  }

  class Navigator { get hardwareConcurrency() { return 2; } }
  class Node {
    constructor(type, name = null) { nodes.set(this, { type, name, parent: null, kids: [] }); }
    get nodeType() { stats.reads++; return data(this).type; }
    get parentNode() { stats.reads++; return data(this).parent; }
    get firstChild() { stats.reads++; return data(this).kids[0] ?? null; }
    get lastChild() { stats.reads++; return data(this).kids.at(-1) ?? null; }
    get previousSibling() { stats.reads++; return sibling(this, -1); }
    get nextSibling() { stats.reads++; return sibling(this, 1); }
    appendChild(node) { enter('appendChild', this, arguments); place(this, [checked(node)], null); return node; }
    insertBefore(node, reference) { enter('insertBefore', this, arguments); place(this, [checked(node)], reference ?? null); return node; }
    replaceChild(node, old) {
      enter('replaceChild', this, arguments);
      const next = sibling(old, 1);
      detach(old); place(this, [checked(node)], next);
      return old;
    }
  }
  class Text extends Node { constructor(value) { super(3); data(this).value = value; } }
  class Element extends Node {
    constructor(name = 'div') { super(1, name); }
    get localName() { stats.reads++; const entry = data(this); if (entry.type !== 1) throw reason; return entry.name; }
    before() {
      enter('before', this, arguments); guard(this, 1);
      const list = convert([...arguments]), parent = data(this).parent;
      if (parent) place(parent, list, this);
    }
    after() {
      enter('after', this, arguments); guard(this, 1);
      const list = convert([...arguments]), parent = data(this).parent;
      if (parent) place(parent, list, sibling(this, 1));
    }
    replaceWith() {
      enter('replaceWith', this, arguments); guard(this, 1);
      const list = convert([...arguments]), parent = data(this).parent;
      if (parent) { place(parent, list, this); detach(this); }
    }
    insertAdjacentElement(position, element) {
      enter('insertAdjacentElement', this, arguments); guard(this, 1);
      const where = lower(String(position));
      return adjacent(this, where, [checked(element)]) ? element : null;
    }
    insertAdjacentHTML(position, markup) {
      enter('insertAdjacentHTML', this, arguments); guard(this, 1);
      const where = lower(String(position));
      if (!adjacent(this, where, parse(markup))) throw new Error('NoModificationAllowedError');
      settle();
    }
    get innerHTML() { return ''; }
    set innerHTML(markup) {
      enter('innerHTML', this, arguments); guard(this, 1);
      const list = parse(markup);
      for (const kid of data(this).kids.splice(0)) data(kid).parent = null;
      place(this, list, null); settle();
    }
    get outerHTML() { return ''; }
    set outerHTML(markup) {
      enter('outerHTML', this, arguments); guard(this, 1);
      const list = parse(markup), parent = data(this).parent;
      if (!parent) return;
      if (is(parent, 9)) throw new Error('NoModificationAllowedError');
      const next = sibling(this, 1);
      detach(this); place(parent, list, next); settle();
    }
  }
  class DocumentFragment extends Node { constructor() { super(11); } }
  class Document extends Node { constructor() { super(9); } }
  class HTMLIFrameElement extends Element {
    constructor() {
      super('iframe');
      class ChildNavigator { get hardwareConcurrency() { return 2; } }
      const child = { Navigator: ChildNavigator, navigator: new ChildNavigator() };
      windows.add(child); contexts.set(this, child); created.push(child);
    }
    get contentWindow() {
      stats.reads++;
      if (data(this).name !== 'iframe') throw reason;
      return connected(this) ? contexts.get(this) : null;
    }
  }
  // ParentNode mixin: distinct function objects per interface, as in a browser.
  function parentNodeMixin(Class, type) {
    const methods = {
      append() { enter('append', this, arguments); guard(this, type); place(this, convert([...arguments]), null); },
      prepend() { enter('prepend', this, arguments); guard(this, type); place(this, convert([...arguments]), data(this).kids[0] ?? null); },
      replaceChildren() {
        enter('replaceChildren', this, arguments); guard(this, type);
        const list = convert([...arguments]);
        for (const kid of data(this).kids.splice(0)) data(kid).parent = null;
        place(this, list, null);
      },
      moveBefore(node, reference) { enter('moveBefore', this, arguments); guard(this, type); place(this, [checked(node)], reference ?? null); },
      querySelectorAll(selector) { guard(this, type); void selector; return select(this); },
    };
    for (const key of Object.keys(methods)) Object.defineProperty(Class.prototype, key, { value: methods[key], writable: true, configurable: true });
  }
  parentNodeMixin(Element, 1); parentNodeMixin(DocumentFragment, 11); parentNodeMixin(Document, 9);

  Object.setPrototypeOf(document, Document.prototype);
  nodes.set(document, { type: 9, name: null, parent: null, kids: [] });
  const html = new Element('html'), head = new Element('head'), body = new Element('body');
  place(document, [html], null); place(html, [head, body], null);
  const realm = { Navigator, Node, Element, DocumentFragment, Document, HTMLIFrameElement, document, navigator: new Navigator() };
  windows.add(realm);
  Object.defineProperty(realm, 'self', { configurable: true, get() { if (!windows.has(this)) throw reason; return this; } });
  // `window[n]`: reads a child realm without touching any frame getter, like the real indexed access.
  for (let index = 0; index < 12; index++) Object.defineProperty(realm, index, { configurable: true, get() { return frames()[index]; } });
  for (const name of without) { const [type, key] = name.split('.'); delete realm[type].prototype[key]; }
  install(realm, [{ id: 'hardware-concurrency', mode: 'custom', value: MARK }], target => {
    installed.push(target); events.push('install');
    Object.defineProperty(target.Navigator.prototype, 'hardwareConcurrency', { configurable: true, get() { return MARK; } });
  });

  const dom = {
    realm, document, html, body, Node, Element, DocumentFragment, HTMLIFrameElement, installed, operations, stats, created, events, frames, reason,
    cost: () => stats.visited + stats.queries + stats.reads,
    reset() { stats.visited = stats.queries = stats.documentQueries = stats.reads = 0; operations.length = 0; created.length = 0; events.length = 0; },
    unprotected: () => frames().filter(child => child.navigator.hardwareConcurrency !== MARK),
    element(name, ...kids) { const element = new Element(name); place(element, kids, null); return element; },
    text: value => new Text(value),
    frame: () => new HTMLIFrameElement(),
    fragment(...kids) { const fragment = new DocumentFragment(); place(fragment, kids, null); return fragment; },
    add(parent, ...kids) { place(parent, kids, null); },
    kids: node => [...data(node).kids],
    fill(parent, count) {
      const list = [];
      for (let index = 0; index < count; index++) list.push(dom.element('div', new Element('span')));
      place(parent, list, null);
    },
    remove: detach,
    failWith(error) { failure = error; },
    react(run) { reaction = run; },
  };
  return dom;
}

// body > [other (unrelated content), holder > [filler, box (large receiver), spare, filler]]
function scene(size, options) {
  const f = createDom(options), other = f.element('section'), holder = f.element('div'), box = f.element('div'), spare = f.element('p');
  f.add(f.body, other, holder);
  f.fill(other, size); f.fill(holder, size);
  f.add(holder, box, spare);
  f.fill(holder, size); f.fill(box, size);
  f.reset();
  return { f, box, holder, spare };
}

const nodePayloads = {
  frame: [f => [f.frame()], 1],
  nested: [f => [f.element('div', f.element('section', f.frame()))], 1],
  fragment: [f => [f.fragment(f.text('t'), f.frame(), f.element('b', f.frame()))], 2],
  mixed: [f => ['text', f.frame(), f.fragment(f.frame()), f.element('i', f.frame()), 42], 3],
};
const markups = {
  frame: ['<iframe></iframe>', 1],
  nested: ['<div><section><iframe></iframe></section></div>', 1],
  mixed: ['text<i>a</i><iframe></iframe><b><iframe></iframe></b>tail', 2],
  many: ['<iframe></iframe><iframe></iframe><iframe></iframe>', 3],
};

// Every insertion API x payload: `run(scene)` performs exactly one native insertion of `frames` new frames.
const cases = [];
for (const [kind, [make, frames]] of Object.entries(nodePayloads)) {
  for (const key of ['append', 'prepend', 'replaceChildren']) cases.push({ name: key + '(' + kind + ')', frames, run: s => s.box[key](...make(s.f)) });
  for (const key of ['before', 'after', 'replaceWith']) cases.push({ name: key + '(' + kind + ')', frames, run: s => s.box[key](...make(s.f)) });
  if (kind === 'mixed') continue;
  cases.push({ name: 'appendChild(' + kind + ')', frames, run: s => s.box.appendChild(make(s.f)[0]) });
  cases.push({ name: 'insertBefore(' + kind + ')', frames, run: s => s.box.insertBefore(make(s.f)[0], s.f.kids(s.box)[0]) });
  cases.push({ name: 'replaceChild(' + kind + ')', frames, run: s => s.box.replaceChild(make(s.f)[0], s.f.kids(s.box)[0]) });
  if (kind !== 'fragment') cases.push({ name: 'moveBefore(' + kind + ')', frames, run: s => s.box.moveBefore(make(s.f)[0], null) });
  if (kind === 'fragment') continue;
  for (const position of POSITIONS) cases.push({ name: 'insertAdjacentElement(' + position + ', ' + kind + ')', frames, run: s => s.box.insertAdjacentElement(position, make(s.f)[0]) });
}
for (const [kind, [markup, frames]] of Object.entries(markups)) {
  for (const position of POSITIONS) {
    cases.push({ name: 'insertAdjacentHTML(' + position + ', ' + kind + ')', frames, run: s => s.box.insertAdjacentHTML(position, markup) });
    cases.push({ name: 'insertAdjacentHTML(' + position.toUpperCase() + ', ' + kind + ')', frames, run: s => s.spare.insertAdjacentHTML(position.toUpperCase(), markup) });
  }
  cases.push({ name: 'innerHTML = ' + kind, frames, run: s => { s.box.innerHTML = markup; } });
  cases.push({ name: 'outerHTML = ' + kind, frames, run: s => { s.box.outerHTML = markup; } });
}

function measure(item, size, options) {
  const s = scene(size, options);
  item.run(s);
  const { f } = s;
  f.events.push('returned');
  return { order: f.events.join(), cost: f.cost(), documentQueries: f.stats.documentQueries, connected: f.frames().length, unprotected: f.unprotected().length, operations: f.operations.length };
}

const serialized = () => vm.runInNewContext('(' + installApiCustomDocument.toString() + ')');
for (const [label, install] of [['module', installApiCustomDocument], ['serialized', undefined]]) {
  for (const item of cases) {
    test('scan cost ignores unrelated size and frames are protected synchronously (' + label + '): ' + item.name, () => {
      const options = { install: install ?? serialized() };
      const small = measure(item, SMALL, options), large = measure(item, LARGE, options);
      for (const result of [small, large]) {
        assert.equal(result.operations, 1, 'the native operation runs exactly once');
        assert.match(result.order, /^native(,install)+,returned$/, 'the profile is installed after the native insertion and before the API returns');
        assert.equal(result.order.split('install').length - 1, item.frames, 'one install per inserted frame');
        assert.equal(result.connected, item.frames, 'every inserted frame is live');
        assert.equal(result.unprotected, 0, 'every inserted frame already has the Custom profile when the call returns');
        assert.equal(result.documentQueries, 0, 'no whole-document query');
      }
      assert.equal(large.cost, small.cost, 'hook work does not grow with the receiver, its siblings or the document');
      assert.ok(large.cost <= LIMIT, 'hook work ' + large.cost + ' exceeds ' + LIMIT);
    });
  }
}

test('odd-cased insertion positions take the same bounded path', () => {
  for (const position of ['BeforeBegin', 'AFTERBEGIN', 'bEfOrEeNd', 'AfterEnd', 'beforeend']) {
    const run = s => s.box.insertAdjacentHTML(position, '<div><iframe></iframe></div>');
    const small = measure({ run }, SMALL), large = measure({ run }, LARGE);
    assert.deepEqual(large, small, position);
    assert.match(large.order, /^native,install,returned$/, position);
    assert.equal(large.unprotected, 0, position); assert.equal(large.connected, 1, position); assert.equal(large.documentQueries, 0, position);
  }
});

test('a non-string insertion position is never coerced by the hook and keeps the document-wide answer', () => {
  const s = scene(SMALL);
  let coerced = 0;
  const position = { toString() { coerced++; return 'BEFOREEND'; } };
  assert.equal(s.box.insertAdjacentHTML(position, '<div><iframe></iframe></div>'), undefined);
  assert.equal(coerced, 1, 'only the native operation converts the page value');
  assert.equal(s.f.operations.length, 1);
  assert.equal(s.f.stats.documentQueries, 1, 'unknown spelling falls back to one document scan');
  assert.equal(s.f.unprotected().length, 0); assert.equal(s.f.frames().length, 1);
  const object = scene(SMALL);
  object.box.insertAdjacentHTML(new String('afterbegin'), '<iframe></iframe>');
  assert.equal(object.f.unprotected().length, 0); assert.equal(object.f.frames().length, 1);
});

test('an invalid position or a missing parent surfaces the native error unchanged and protects nothing', () => {
  const s = scene(SMALL), detached = s.f.element('div');
  assert.throws(() => s.box.insertAdjacentHTML('sideways', '<iframe></iframe>'), SyntaxError);
  assert.throws(() => detached.insertAdjacentHTML('beforebegin', '<iframe></iframe>'), /NoModificationAllowedError/);
  assert.equal(detached.insertAdjacentElement('afterend', s.f.frame()), null);
  detached.outerHTML = '<iframe></iframe>'; detached.innerHTML = '<iframe></iframe>';
  assert.equal(s.f.operations.length, 5);
  assert.equal(s.f.frames().length, 0); assert.equal(s.f.installed.length, 1, 'only the root realm was installed');
});

test('natives still run once with the original receiver, arguments and result, and page values are not coerced', () => {
  const s = scene(SMALL), { f, box } = s, fresh = f.frame();
  assert.equal(box.insertAdjacentElement('beforeend', fresh), fresh);
  assert.equal(box.appendChild(f.frame()) instanceof f.Node, true);
  let coerced = 0;
  const value = { toString() { coerced++; return '<iframe></iframe>'; } };
  box.innerHTML = value; box.append(value); box.outerHTML = value;
  assert.equal(coerced, 3, 'one native conversion per call, none from the hooks');
  assert.equal(f.operations[0].receiver, box); assert.deepEqual(f.operations[0].args, ['beforeend', fresh]);
  assert.deepEqual(f.operations.map(row => row.kind), ['insertAdjacentElement', 'appendChild', 'innerHTML', 'append', 'outerHTML']);
  const opaque = new Proxy({}, { get() { throw Error('Unexpected argument read'); }, has() { throw Error('Unexpected has'); }, getPrototypeOf() { throw Error('Unexpected prototype read'); } });
  for (const operation of [() => box.appendChild(opaque), () => box.moveBefore(opaque, null), () => box.insertAdjacentElement('afterend', opaque)]) {
    assert.throws(operation, error => error === f.reason);
  }
});

test('native failures propagate by identity and discard what was held for a fragment', () => {
  const s = scene(SMALL), { f, box } = s, failure = new Error('native insertion failure');
  f.failWith(failure);
  const attempts = [
    () => box.append(f.fragment(f.frame())), () => box.appendChild(f.fragment(f.frame())), () => box.insertAdjacentHTML('beforeend', '<iframe></iframe>'),
    () => { box.innerHTML = '<iframe></iframe>'; }, () => { box.outerHTML = '<iframe></iframe>'; }, () => box.replaceWith(f.fragment(f.frame())),
  ];
  for (const attempt of attempts) assert.throws(attempt, error => error === failure);
  assert.equal(f.operations.length, attempts.length);
  assert.equal(f.installed.length, 1);
  f.failWith(null);
  for (const key of ['append', 'prepend', 'replaceChildren', 'before', 'after', 'replaceWith', 'insertAdjacentHTML', 'insertAdjacentElement', 'moveBefore']) {
    const wrapped = f.Element.prototype[key];
    const count = f.operations.length;
    assert.equal(Object.hasOwn(wrapped, 'prototype'), false);
    assert.throws(() => new wrapped(), TypeError); assert.throws(() => Reflect.construct(wrapped, []), TypeError);
    assert.equal(f.operations.length, count, key + ' construction fails before the native call');
    assert.throws(() => Reflect.apply(wrapped, {}, [f.frame(), f.frame()]), error => error === f.reason);
    assert.equal(f.operations.length, count + 1);
  }
  for (const key of ['innerHTML', 'outerHTML']) {
    const setter = Object.getOwnPropertyDescriptor(f.Element.prototype, key).set;
    assert.throws(() => new setter(), TypeError);
    assert.throws(() => Reflect.apply(setter, undefined, ['<iframe></iframe>']), error => error === f.reason);
  }
  assert.equal(f.frames().length, 0); assert.equal(f.installed.length, 1);
});

test('a DocumentFragment is empty after insertion, so its frames must be collected before the native call', () => {
  const s = scene(LARGE), { f, box } = s, fragment = f.fragment(f.element('div', f.frame()), f.frame());
  box.append(fragment);
  assert.equal(f.kids(fragment).length, 0, 'the native insertion consumed the fragment');
  assert.equal(f.frames().length, 2); assert.equal(f.unprotected().length, 0);
  assert.ok(f.cost() <= LIMIT, 'cost ' + f.cost());
  // Without the native fragment query nothing can find those frames afterwards: the pre-scan is what protects them.
  const blind = scene(SMALL, { without: ['DocumentFragment.querySelectorAll'] }), emptied = blind.f.fragment(blind.f.frame());
  blind.box.append(emptied);
  assert.equal(blind.f.frames().length, 1); assert.equal(blind.f.unprotected().length, 1);
});

test('hostile page replacements of queries, tree getters and string helpers never replace the captured natives', () => {
  const lowerCase = String.prototype.toLowerCase;
  try {
    const s = scene(SMALL), { f, box, holder } = s;
    let hits = 0;
    const spy = () => { hits++; return null; };
    for (const Class of [f.Element, f.DocumentFragment, f.document.constructor]) {
      Object.defineProperty(Class.prototype, 'querySelectorAll', { configurable: true, value: spy });
    }
    for (const key of ['nodeType', 'parentNode', 'firstChild', 'lastChild', 'previousSibling', 'nextSibling']) {
      Object.defineProperty(f.Node.prototype, key, { configurable: true, get: spy });
    }
    Object.defineProperty(f.Element.prototype, 'localName', { configurable: true, get: spy });
    String.prototype.toLowerCase = function toLowerCase() { hits++; return 'nonsense'; };
    for (const target of [box, holder]) Object.defineProperty(target, 'querySelectorAll', { value: spy });
    Object.defineProperty(box, 'parentNode', { get: spy });
    box.insertAdjacentHTML('BeforeEnd', '<iframe></iframe>');
    box.insertAdjacentHTML('AfterBegin', '<div><iframe></iframe></div>');
    box.insertAdjacentHTML('beforebegin', '<iframe></iframe>');
    box.append(f.fragment(f.frame()), f.element('i', f.frame()));
    box.appendChild(f.fragment(f.frame()));
    box.before(f.frame()); box.innerHTML = '<iframe></iframe>'; box.outerHTML = '<p><iframe></iframe></p>';
    assert.equal(hits, 0, 'the page replacements were never called');
    assert.equal(f.operations.length, 8);
    assert.equal(f.created.length, 9);
    assert.equal(f.created.filter(child => child.navigator.hardwareConcurrency !== MARK).length, 0, 'every inserted frame was protected when its call returned');
  } finally { String.prototype.toLowerCase = lowerCase; }
});

test('a custom element reaction that removes the recorded neighbor widens to the container instead of missing frames', () => {
  const s = scene(SMALL), { f, box } = s, last = f.kids(box).at(-1);
  f.react(() => f.remove(last));
  box.insertAdjacentHTML('beforeend', '<iframe></iframe>');
  assert.equal(f.frames().length, 1); assert.equal(f.unprotected().length, 0);
  assert.equal(f.stats.documentQueries, 0, 'widened to the container, not the document');
});

test('work stays bounded when more nodes arrive than can be inspected one by one', () => {
  const s = scene(SMALL), { f, box } = s;
  const many = Array.from({ length: 1500 }, () => f.element('i')), frame = f.frame();
  box.append(...many.slice(0, 1400), frame, ...many.slice(1400));
  assert.equal(f.frames().length, 1); assert.equal(f.unprotected().length, 0, 'the frame beyond the inspection bound is still found');
  assert.ok(f.cost() <= 16 * 1024, 'cost ' + f.cost());
  const html = scene(SMALL);
  html.box.insertAdjacentHTML('beforeend', '<i></i>'.repeat(1500) + '<iframe></iframe>');
  assert.equal(html.f.frames().length, 1); assert.equal(html.f.unprotected().length, 0);
  assert.equal(html.f.stats.documentQueries, 0); assert.ok(html.f.cost() <= 16 * 1024, 'cost ' + html.f.cost());
});

test('fragment receivers cost the same however much they already hold', () => {
  const costs = [SMALL, LARGE].map(size => {
    const f = createDom(), receiver = f.fragment();
    f.fill(receiver, size); f.reset();
    receiver.append(f.frame()); receiver.prepend(f.element('div', f.frame()));
    return f.cost();
  });
  assert.equal(costs[0], costs[1]); assert.ok(costs[1] <= LIMIT);
});

test('an indexed window read right after the call sees the profile, for each insertion route', () => {
  const routes = [
    s => s.box.append(s.f.frame()), s => s.box.prepend(s.f.element('div', s.f.frame())), s => s.box.appendChild(s.f.fragment(s.f.frame())),
    s => s.box.after(s.f.frame()), s => s.box.replaceWith(s.f.fragment(s.f.frame())), s => s.box.insertAdjacentHTML('afterbegin', '<iframe></iframe>'),
    s => { s.box.innerHTML = '<p><iframe></iframe></p>'; }, s => { s.box.outerHTML = '<iframe></iframe>'; },
  ];
  for (const route of routes) {
    const s = scene(SMALL);
    route(s);
    assert.ok(s.f.realm[0], String(route));
    assert.equal(s.f.realm[0].navigator.hardwareConcurrency, MARK, String(route));
  }
});

test('assigning markup to the document element covers frames whose parent is the Document', () => {
  for (const size of [SMALL, LARGE]) {
    const s = scene(size), { f } = s;
    f.reset();
    f.html.innerHTML = '<body><iframe></iframe></body>';
    assert.equal(f.frames().length, 1); assert.equal(f.unprotected().length, 0);
    assert.ok(f.cost() <= LIMIT, 'cost ' + f.cost()); assert.equal(f.stats.documentQueries, 0);
    assert.throws(() => { f.html.outerHTML = '<iframe></iframe>'; }, /NoModificationAllowedError/);
  }
});

test('Document and DocumentFragment receivers use the same bounded argument walk', () => {
  const f = createDom();
  f.reset(); // the installer's own start-up scan is not part of the hook cost
  f.document.replaceChildren(f.element('html', f.element('body', f.frame())));
  assert.equal(f.frames().length, 1); assert.equal(f.unprotected().length, 0);
  assert.equal(f.stats.documentQueries, 0);
  const g = createDom();
  g.reset();
  g.document.prepend(g.fragment(g.frame()), g.frame());
  assert.equal(g.frames().length, 2); assert.equal(g.unprotected().length, 0);
  assert.equal(g.stats.documentQueries, 0);
});

test('frames assembled inside a detached fragment are protected only once the fragment is inserted', () => {
  const s = scene(SMALL), { f, box } = s, fragment = f.fragment(f.element('div'));
  const [holder] = f.kids(fragment);
  holder.insertAdjacentHTML('beforeend', '<iframe></iframe>');
  holder.after(f.frame()); holder.append(f.element('i', f.frame()));
  assert.equal(f.created.length, 3); assert.equal(f.frames().length, 0);
  assert.equal(f.installed.length, 1, 'nothing is live, so no realm exists yet');
  box.appendChild(fragment);
  assert.equal(f.frames().length, 3); assert.equal(f.unprotected().length, 0);
});

// Mutation self-test: each removed safeguard must be caught by the protection checks above, and only by them.
test('removing the fragment pre-scan, the markup walk or the argument walk leaves exactly the matching frames unprotected', () => {
  const mutant = (from, to) => {
    const source = installApiCustomDocument.toString();
    assert.equal(source.split(from).length, 2, 'mutation anchor must occur exactly once - update this test with the source: ' + from);
    return vm.runInNewContext('(' + source.replace(from, () => to) + ')');
  };
  const probes = {
    fragmentAppend: s => s.box.append(s.f.fragment(s.f.element('div', s.f.frame()))),
    fragmentAppendChild: s => s.box.appendChild(s.f.fragment(s.f.frame())),
    elementAppend: s => s.box.append(s.f.element('div', s.f.frame())),
    markupAdjacent: s => s.box.insertAdjacentHTML('beforeend', '<div><iframe></iframe></div>'),
    markupSetter: s => { s.box.innerHTML = '<iframe></iframe>'; },
  };
  const run = install => Object.fromEntries(Object.entries(probes).map(([name, probe]) => {
    const s = scene(SMALL, { install });
    probe(s);
    return [name, s.f.unprotected().length + (s.f.frames().length === 1 ? 0 : 100)];
  }));
  const none = { fragmentAppend: 0, fragmentAppendChild: 0, elementAppend: 0, markupAdjacent: 0, markupSetter: 0 };
  assert.deepEqual(run(installApiCustomDocument), none, 'control: the intact installer protects every probe');
  assert.deepEqual(run(mutant('return held;', 'return undefined;')), { ...none, fragmentAppend: 1, fragmentAppendChild: 1 });
  assert.deepEqual(run(mutant('subtree(args[index]);', 'void args[index];')), { ...none, elementAppend: 1 });
  assert.deepEqual(run(mutant('if (apply(nodeType, current, []) === 1) subtree(current);', 'void current;')), { ...none, markupAdjacent: 1, markupSetter: 1 });
});

test('the installer stays inert in a realm without any DOM interfaces', () => {
  const realm = { Navigator: class Navigator {} };
  Object.defineProperty(realm, 'self', { get() { return this; } });
  const installed = [];
  assert.doesNotThrow(() => installApiCustomDocument(realm, [{ id: 'hardware-concurrency', mode: 'custom', value: MARK }], target => installed.push(target)));
  assert.deepEqual(installed, [realm]);
});
