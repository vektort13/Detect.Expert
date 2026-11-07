// ADR-049: immutable document-start Custom installation. No page-visible native restore channel.
// Serialized by api-custom-registration.js; keep this function self-contained.
export function installApiCustomDocument(realm, entries, install) {
  const apply = Reflect.apply, getOwn = Object.getOwnPropertyDescriptor, define = Object.defineProperty;
  const getPrototype = Object.getPrototypeOf;
  const minimum = Math.min, lowercase = String.prototype.toLowerCase;
  const seen = new WeakMap(), installed = new WeakSet();
  const mapGet = WeakMap.prototype.get, mapSet = WeakMap.prototype.set;
  const setHas = WeakSet.prototype.has, setAdd = WeakSet.prototype.add;
  const marker = Symbol.for('detect.expert/api-custom/document/v2');
  const captureDeny = Symbol.for('detect.expert/api-custom/value-capture-deny/v1');
  let hasCustom = false;
  for (let index = 0; index < entries.length; index++) if (getOwn(entries[index], 'mode')?.value === 'custom') hasCustom = true;
  const inheritKey = Symbol.for('detect.expert/api-custom/inherit/v2');
  const windowSelf = descriptor(realm, 'self')?.value.get;
  const frameGetter = descriptor(own(own(realm, 'HTMLIFrameElement'), 'prototype'), 'contentWindow')?.value.get;
  const oldFrameGetter = descriptor(own(own(realm, 'HTMLFrameElement'), 'prototype'), 'contentWindow')?.value.get;
  const queryDocument = descriptor(own(own(realm, 'Document'), 'prototype'), 'querySelectorAll')?.value.value;
  let count = 0;
  function each(values, operation) { for (let index = 0; index < values.length; index++) operation(values[index]); }
  // ADR-112: a replacement function reports the name and length of the function it replaces. Two descriptors are copied (the compatibility
  // measure docs/PROJECT_RULES.md allows); Function.prototype.toString is not touched.
  function matchMeta(replacement, source) {
    for (const metaKey of ['length', 'name']) { const field = getOwn(source, metaKey), data = field && getOwn(field, 'value'); if (data) { try { define(replacement, metaKey, { __proto__: null, value: data.value, writable: false, enumerable: false, configurable: true }); } catch { /* keep the default */ } } }
  }
  function own(target, key) { return target && getOwn(target, key)?.value; }
  function descriptor(target, key) {
    for (let depth = 0; target && depth < 16; depth++, target = getPrototype(target)) {
      const value = getOwn(target, key); if (value) return { target, value };
    }
    return null;
  }
  // `before` may record neighbors or fragment frames that the native call is about to consume; `after` receives it.
  function wrap(target, key, after, before) {
    const found = descriptor(target, key);
    if (!found || !found.value.configurable || typeof found.value.value !== 'function' || apply(setHas, installed, [found.value.value])) return;
    const original = found.value.value;
    const customDocumentOperation = { customDocumentOperation() {
      'use strict';
      let record;
      if (before) { try { record = before(this, arguments); } catch { /* Observer failure never reaches the page. */ } }
      const result = apply(original, this, arguments);
      try { after(result, this, arguments, record); } catch { /* Native operation already completed. */ }
      return result;
    } }.customDocumentOperation;
    apply(setAdd, installed, [customDocumentOperation]);
    matchMeta(customDocumentOperation, original);
    define(found.target, key, { ...found.value, value: customDocumentOperation });
  }
  function wrapAccess(target, key, after, setter = false, before) {
    const found = descriptor(target, key), field = setter ? 'set' : 'get';
    if (!found || !found.value.configurable || typeof found.value[field] !== 'function' || apply(setHas, installed, [found.value[field]])) return;
    const original = found.value[field];
    const customDocumentAccess = { customDocumentAccess() {
      'use strict';
      let record;
      if (before) { try { record = before(this, arguments); } catch { /* Observer failure never reaches the page. */ } }
      const result = apply(original, this, arguments);
      try { after(result, this, arguments, record); } catch { /* Preserve the native access result. */ }
      return result;
    } }.customDocumentAccess;
    apply(setAdd, installed, [customDocumentAccess]);
    matchMeta(customDocumentAccess, original);
    define(found.target, key, { ...found.value, [field]: customDocumentAccess });
  }
  function protectFrame(element) {
    const getters = [frameGetter, oldFrameGetter];
    for (let index = 0; index < getters.length; index++) {
      if (!getters[index]) continue;
      try { const child = apply(getters[index], element, []); if (child) protect(child); return; }
      catch { /* Try the other native frame interface. */ }
    }
  }
  function scan(win) {
    try {
      if (!queryDocument) return;
      const frames = apply(queryDocument, win.document, ['iframe,frame']);
      for (let index = 0; index < minimum(frames.length, 1024); index++) protectFrame(frames[index]);
    } catch { /* A navigated realm may no longer be same-origin. */ }
  }
  function protect(win) {
    try {
      if (win !== realm && (!windowSelf || apply(windowSelf, win, []) !== win)) return;
      if (hasCustom) {
        // Presence only vetoes previews. Never evaluate a page marker's value.
        try {
          const existing = getOwn(win, captureDeny);
          if (!existing || existing.configurable) define(win, captureDeny, { __proto__: null, value: true, configurable: false, enumerable: false, writable: false });
        } catch { /* Observer policy independently denies non-extensible/inaccessible realms. */ }
      }
      if (getOwn(win, marker)?.value === true) {
        // ADR-110: a window can be reused by a new document (initial about:blank -> srcdoc, blob, data or a same-origin URL). The realm keeps its
        // patches but not state bound to the old document; an installer with such state exposes `install.refresh`, which is cheap when nothing changed.
        if (typeof install.refresh === 'function') { try { install.refresh(win); } catch { /* best effort: the realm keeps its other patches */ } }
        return;
      }
      const navigatorPrototype = own(own(win, 'Navigator'), 'prototype');
      if (!navigatorPrototype || apply(mapGet, seen, [win]) === navigatorPrototype || count >= 1024) return;
      // A fresh realm has its own intrinsics/prototypes. Do not mark a WindowProxy
      // globally: the same proxy can represent a later navigated document.
      apply(mapSet, seen, [win, navigatorPrototype]); count++;
      install(win, entries);
      define(win, marker, { value: true, configurable: false, writable: false });
      define(win, inheritKey, { value: child => { protect(child); }, configurable: false, writable: false });
      const documentQuery = descriptor(own(own(win, 'Document'), 'prototype'), 'querySelectorAll')?.value.value;
      const elementQuery = descriptor(own(own(win, 'Element'), 'prototype'), 'querySelectorAll')?.value.value;
      const elementName = descriptor(own(own(win, 'Element'), 'prototype'), 'localName')?.value.get;
      const fragmentQuery = descriptor(own(own(win, 'DocumentFragment'), 'prototype'), 'querySelectorAll')?.value.value;
      function subtree(root) {
        if (!root || typeof root !== 'object') return;
        try {
          const name = elementName && apply(elementName, root, []);
          if (name === 'iframe' || name === 'frame') protectFrame(root);
        } catch { /* Document/fragment have no Element localName. */ }
        const queries = [elementQuery, fragmentQuery, documentQuery];
        for (let queryIndex = 0; queryIndex < queries.length; queryIndex++) {
          const query = queries[queryIndex];
          if (typeof query !== 'function') continue;
          try {
            const frames = apply(query, root, ['iframe,frame']);
            for (let index = 0; index < minimum(frames.length, 1024); index++) protectFrame(frames[index]);
            return;
          } catch { /* Try the native interface matching this node. */ }
        }
      }
      const iframe = own(own(win, 'HTMLIFrameElement'), 'prototype');
      const frame = own(own(win, 'HTMLFrameElement'), 'prototype');
      const framePrototypes = [iframe, frame];
      for (let frameIndex = 0; frameIndex < framePrototypes.length; frameIndex++) {
        const prototype = framePrototypes[frameIndex]; if (!prototype) continue;
        wrapAccess(prototype, 'contentWindow', child => { if (child) protect(child); });
        wrapAccess(prototype, 'contentDocument', document => { if (document?.defaultView) protect(document.defaultView); });
      }
      const eventPrototype = own(own(win, 'Event'), 'prototype');
      const eventTarget = descriptor(eventPrototype, 'target')?.value.get;
      const addEvent = descriptor(own(own(win, 'EventTarget'), 'prototype'), 'addEventListener')?.value.value;
      const captureLoad = event => {
        try { protectFrame(apply(eventTarget, event, [])); } catch {}
      };
      const beforeScript = () => scan(win);
      const listenForLoads = () => {
        if (eventTarget && addEvent) {
          apply(addEvent, win, ['load', captureLoad, true]);
          // Firefox fires this before parser scripts, including a script inside
          // document.write that immediately borrows a newly parsed frame.
          apply(addEvent, win, ['beforescriptexecute', beforeScript, true]);
        }
      };
      listenForLoads();
      wrapAccess(win, 'frames', () => scan(win));
      wrapAccess(win, 'length', () => scan(win));
      wrap(win, 'open', child => { if (child) protect(child); });
      const node = own(own(win, 'Node'), 'prototype');
      const nodeType = descriptor(node, 'nodeType')?.value.get;
      const parentNode = descriptor(node, 'parentNode')?.value.get;
      const firstChild = descriptor(node, 'firstChild')?.value.get, lastChild = descriptor(node, 'lastChild')?.value.get;
      const previousSibling = descriptor(node, 'previousSibling')?.value.get, nextSibling = descriptor(node, 'nextSibling')?.value.get;
      // The cost of an insertion must follow the inserted nodes, never the receiver or the document:
      // node arguments are inspected directly, parsed markup between neighbors recorded beforehand.
      const bound = 1024;
      // A DocumentFragment is empty once inserted, so its frames are collected before the native call.
      function holdFragmentFrames(args, first, last) {
        let held, total = 0; // `total` bounds the frames held across all fragment arguments.
        for (let index = first; index < minimum(last, args.length, bound); index++) {
          const argument = args[index];
          if (!argument || typeof argument !== 'object') continue;
          try {
            if (apply(nodeType, argument, []) !== 11 || total >= bound) continue;
            const frames = apply(fragmentQuery, argument, ['iframe,frame']);
            held = { __proto__: null, frames, rest: held };
            total += frames.length;
          } catch { /* Not a node, or no native fragment query: nothing to hold. */ }
        }
        return held;
      }
      function wrapNodes(target, key, first, last) {
        wrap(target, key, (result, receiver, args, held) => {
          for (let index = first; index < minimum(last, args.length, bound); index++) subtree(args[index]);
          for (let link = held; link; link = link.rest) {
            for (let index = 0; index < minimum(link.frames.length, bound); index++) protectFrame(link.frames[index]);
          }
          if (args.length > bound) scan(win); // More nodes than can be inspected one by one.
        }, (receiver, args) => holdFragmentFrames(args, first, last));
      }
      // Parsed markup lands between the neighbors of its insertion point; nothing else is new.
      function neighbors(container, left, right) { return { __proto__: null, container, left, right }; }
      function around(receiver) {
        return neighbors(apply(parentNode, receiver, []), apply(previousSibling, receiver, []), apply(nextSibling, receiver, []));
      }
      function adjacent(receiver, args) {
        // The page's position is compared only as a primitive string; any other value takes the document scan.
        const where = args.length > 0 && typeof args[0] === 'string' ? apply(lowercase, args[0], []) : '';
        if (where === 'afterbegin') return neighbors(receiver, null, apply(firstChild, receiver, []));
        if (where === 'beforeend') return neighbors(receiver, apply(lastChild, receiver, []), null);
        if (where === 'beforebegin') return neighbors(apply(parentNode, receiver, []), apply(previousSibling, receiver, []), receiver);
        if (where === 'afterend') return neighbors(apply(parentNode, receiver, []), receiver, apply(nextSibling, receiver, []));
        return undefined;
      }
      function visitSpan(result, receiver, args, span) {
        if (!span) { scan(win); return; } // Neighbors unknown: keep the document-wide answer.
        const { container, left, right } = span;
        if (!container) return; // A detached receiver cannot own a live frame.
        let current = left ? apply(nextSibling, left, []) : apply(firstChild, container, []);
        for (let steps = 0; current && current !== right; current = apply(nextSibling, current, [])) {
          if (steps++ >= bound) { subtree(container); return; }
          if (apply(nodeType, current, []) === 1) subtree(current);
        }
        // Page code (custom element reactions) may have moved the recorded neighbor away.
        if (left && apply(parentNode, left, []) !== container) subtree(container);
      }
      each(['appendChild', 'insertBefore', 'replaceChild'], key => wrapNodes(node, key, 0, 1));
      each(['Element', 'Document', 'DocumentFragment'], name => {
        const prototype = own(own(win, name), 'prototype');
        each(['append', 'prepend', 'replaceChildren'], key => wrapNodes(prototype, key, 0, bound));
        wrapNodes(prototype, 'moveBefore', 0, 1);
      });
      const element = own(own(win, 'Element'), 'prototype');
      each(['replaceWith', 'before', 'after'], key => wrapNodes(element, key, 0, bound));
      wrapNodes(element, 'insertAdjacentElement', 1, 2);
      wrap(element, 'insertAdjacentHTML', visitSpan, adjacent);
      each(['innerHTML', 'outerHTML'], key => wrapAccess(element, key, visitSpan, true, around));
      // Parser/insertion operations can bypass Node.appendChild in native code.
      // Inherit only after successful insertion, before the caller's next read.
      wrap(element, 'setHTMLUnsafe', (result, receiver) => subtree(receiver));
      wrap(own(own(win, 'ShadowRoot'), 'prototype'), 'setHTMLUnsafe', (result, receiver) => subtree(receiver));
      const range = own(own(win, 'Range'), 'prototype');
      const rangeAncestor = descriptor(range, 'commonAncestorContainer')?.value.get;
      wrap(range, 'insertNode', (result, receiver, args) => {
        subtree(args[0]);
        // A fragment is empty after the native insertion. Inspect its Range's
        // local ancestor, rather than relying on an emptied argument or a MO.
        if (nodeType && rangeAncestor && apply(nodeType, args[0], []) === 11) {
          let root = apply(rangeAncestor, receiver, []);
          if (nodeType && parentNode && apply(nodeType, root, []) === 3) root = apply(parentNode, root, []);
          subtree(root);
        }
      });
      wrap(range, 'surroundContents', (result, receiver, args) => subtree(args[0]));
      const documentPrototype = own(own(win, 'Document'), 'prototype');
      const bodyGetter = descriptor(documentPrototype, 'body')?.value.get;
      if (bodyGetter) wrapAccess(documentPrototype, 'body', (result, receiver) => subtree(apply(bodyGetter, receiver, [])), true);
      each(['open', 'write', 'writeln'], key => wrap(documentPrototype, key, result => {
        if (key === 'open' && result) protect(result);
        protect(win); listenForLoads(); scan(win);
      }));
      const Observer = own(win, 'MutationObserver');
      if (typeof Observer === 'function') {
        const observer = new Observer(records => {
          for (let index = 0; index < minimum(records.length, 1024); index++) {
            const nodes = records[index].addedNodes;
            for (let item = 0; item < minimum(nodes.length, 1024); item++) subtree(nodes[item]);
          }
        });
        observer.observe(win.document, { childList: true, subtree: true });
        // The observer and installed handles stay private for this document.
        // OFF/permission changes apply by registration change and reload.
      }
      scan(win);
    } catch { /* Inaccessible/non-extensible browser realms are not synthesized. */ }
  }
  // No stop handle, original descriptor, mutable values or command listener is
  // exported into the page. Saving another profile requires a new document.
  protect(realm);
}
