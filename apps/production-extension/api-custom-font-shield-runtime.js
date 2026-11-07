// ADR-110: HTML/CSS font shield for the canvas-font-policy Custom row. Serialized by api-custom-registration.js; keep self-contained.
// One constructed style sheet is adopted by the document. Each rule is an @font-face for a listed family name whose only sources are
// local() lookups of common fonts and whose unicode-range is a single code point that no text uses: the family then resolves like a
// missing one (the platform font of the same name is not consulted and no text takes glyphs from the face), so layout falls through to
// the next family of the page's font-family list for DOM, SVG and Canvas text alike. No fetch is made (page CSP font-src and style-src
// are not involved), nothing is measured or rendered by the extension, and no result of a page API is replaced.
// The one hook: a FontFace constructed with a string source whose local() names a hidden family is constructed with that name
// replaced by an absent one (the original constructor runs once, with the original arguments and new.target), so load() fails like it
// does for a font that is not installed. Fonts the shield does not list, @font-face rules written in page CSS, Workers and frames
// the parent cannot hand a profile to stay uncovered (docs/coverage/antidetect.md).
// The sheet belongs to a document, not to a realm: a window that a new document reuses (initial about:blank -> srcdoc, blob, data or a
// same-origin URL) keeps its patches but loses the sheet, so a second call for a known realm adopts a sheet again when the document changed.
export function installFontShield(realm, entries) {
  'use strict';
  const cached = installFontShield.__detectExpertFontShieldIntrinsicsV1;
  const I = cached || {
    own: Object.getOwnPropertyDescriptor, define: Object.defineProperty, proto: Object.getPrototypeOf, apply: Reflect.apply, construct: Reflect.construct,
    Proxy, isArray: Array.isArray, charCode: String.prototype.charCodeAt, slice: String.prototype.slice, lower: String.prototype.toLowerCase,
    symbolFor: Symbol.for, setProto: Object.setPrototypeOf, reflectSetProto: Reflect.setPrototypeOf,
  };
  if (!cached) I.define(installFontShield, '__detectExpertFontShieldIntrinsicsV1', { value: I });
  // A realm that carries the shield holds its refresher under a symbol. The property is on the window itself, so it is found whichever wrapper
  // of the window the caller holds and whichever copy of this installer asks (a frame can be reached by the parent's script and by its own).
  const KEY = I.apply(I.symbolFor, undefined, ['detect.expert/api-custom/font-shield/v1']);
  const prior = I.own(realm, KEY);
  if (prior !== undefined && typeof prior.value === 'function') { try { I.apply(prior.value, undefined, []); } catch { /* best effort */ } return null; }
  const MAX_NAMES = 1024, MAX_SOURCE = 4096;
  // The face never matches a rendered character (U+10FFFF is a noncharacter); font-stretch:200% makes the face the worst candidate for
  // every ordinary request, so a web font that the page defines under the same family always wins the style matching. The marker
  // `U+10FFFF` is also how the Canvas font policy recognizes these faces and leaves them out of its "registered by the page" table.
  const SOURCES = 'src:local(Arial),local("Segoe UI"),local(Helvetica),local(Roboto),local("Noto Sans"),local("DejaVu Sans"),local("Liberation Sans"),local(Ubuntu),local(Cantarell),local(Tahoma)';
  const TAIL = ';unicode-range:U+10FFFF;font-stretch:200%}';
  const ABSENT = 'local("detect.expert absent")';
  const handles = [], state = { installed: 0, unavailable: 0, changed: 0, names: 0, stopped: false };
  let active = null;
  function own(object, key) { if (object === null || typeof object !== 'object' && typeof object !== 'function') return; const found = I.own(object, key); return found && I.own(found, 'value') ? found.value : undefined; }
  function push(array, value) { I.define(array, array.length, { value, configurable: true, enumerable: true, writable: true }); }
  function field(object, key) { for (let depth = 0; object && depth < 16; depth++, object = I.proto(object)) { const descriptor = I.own(object, key); if (descriptor) return { target: object, descriptor }; } return null; }
  function prototype(name) { return own(own(realm, name), 'prototype'); }
  function unavailable() { if (state.unavailable < 65535) state.unavailable++; }
  function save(target, key, original, descriptor) {
    if (handles.length >= 8) { unavailable(); return false; }
    I.define(target, key, descriptor); push(handles, { target, key, original, descriptor }); state.installed++; return true;
  }
  // A name the rule text can carry unescaped: printable ASCII without quotes, backslash, comma, semicolon, braces or angle brackets.
  function safe(name) {
    if (typeof name !== 'string' || name.length < 1 || name.length > 128) return false;
    for (let index = 0; index < name.length; index++) {
      const code = I.apply(I.charCode, name, [index]);
      if (code < 32 || code > 126 || code === 34 || code === 39 || code === 44 || code === 59 || code === 60 || code === 62 || code === 92 || code === 123 || code === 125) return false;
    }
    return true;
  }
  let list;
  for (let index = 0; index < entries.length && index < MAX_NAMES; index++) {
    const entry = own(entries, index);
    if (own(entry, 'id') === 'canvas-font-policy' && own(entry, 'mode') === 'custom') { const names = own(entry, 'fontShadow'); if (I.isArray(names)) list = names; break; }
  }
  // Lower-cased names of the hidden families (CSS family names match without regard to case) and the rule text built from them.
  const hidden = { __proto__: null };
  let css = '';
  for (let index = 0; list && index < list.length && index < MAX_NAMES; index++) {
    const name = own(list, index);
    if (!safe(name)) continue;
    const key = I.apply(I.lower, name, []);
    if (hidden[key] === true) continue;
    hidden[key] = true; state.names++;
    css += '@font-face{font-family:"' + name + '";' + SOURCES + TAIL;
  }
  // Natives of this realm, read once: the constructor and replaceSync of constructed style sheets, the document accessor and adoptedStyleSheets.
  const Sheet = own(realm, 'CSSStyleSheet'), replaceField = field(own(Sheet, 'prototype'), 'replaceSync'), replace = replaceField && own(replaceField.descriptor, 'value');
  const documentField = field(realm, 'document'), documentGet = documentField && own(documentField.descriptor, 'get');
  const adopted = field(prototype('Document'), 'adoptedStyleSheets'), get = adopted && own(adopted.descriptor, 'get'), set = adopted && own(adopted.descriptor, 'set');
  const usable = typeof Sheet === 'function' && typeof replace === 'function' && typeof get === 'function' && typeof set === 'function';
  function currentDocument() { return typeof documentGet === 'function' ? I.apply(documentGet, realm, []) : own(realm, 'document'); }
  // A copy of the document's adopted sheets in order, without `except` (undefined keeps every sheet).
  function adoptedList(documentObject, except) {
    const current = I.apply(get, documentObject, []), next = [];
    for (let index = 0; current && index < current.length && index < 256; index++) if (current[index] !== except) push(next, current[index]);
    return next;
  }
  function adoptSheet() {
    const documentObject = currentDocument();
    if (!usable || documentObject === null || typeof documentObject !== 'object') { unavailable(); return; }
    const sheet = I.construct(Sheet, []);
    I.apply(replace, sheet, [css]);
    // Sheets the page (or an earlier installer) adopted stay in place and in order; this one goes last.
    const next = adoptedList(documentObject);
    push(next, sheet);
    I.apply(set, documentObject, [next]);
    active = { sheet, documentObject }; state.installed++;
  }
  function adopts(documentObject, sheet) {
    const current = I.apply(get, documentObject, []);
    for (let index = 0; current && index < current.length && index < 256; index++) if (current[index] === sheet) return true;
    return false;
  }
  // Cheap when nothing changed. A document that already carries this realm's sheet (reached through another reference) is not given a second one.
  function refresh() {
    if (state.stopped || state.names === 0) return;
    try {
      const documentObject = currentDocument();
      if (active !== null && documentObject === active.documentObject) return;
      if (active !== null && documentObject !== null && typeof documentObject === 'object' && adopts(documentObject, active.sheet)) { active.documentObject = documentObject; return; }
      adoptSheet();
    } catch { unavailable(); }
  }
  // Replaces the `local( name )` tokens of a FontFace source string whose name is hidden. Names are compared without regard to case;
  // a quoted or bare name with an escape, an unterminated token, or anything that is not a plain local(name) is left untouched.
  function rewrite(text) {
    const length = text.length;
    if (length > MAX_SOURCE) return text;
    const at = index => index < length ? I.apply(I.charCode, text, [index]) : -1;
    const blank = code => code === 32 || code === 9 || code === 10 || code === 12 || code === 13;
    const fold = code => code >= 65 && code <= 90 ? code + 32 : code;
    let output = '', copied = 0, index = 0;
    while (index < length) {
      const code = at(index);
      if (code === 34 || code === 39) { // a quoted string outside local(): skipped whole
        let end = index + 1;
        while (end < length && at(end) !== code) end += at(end) === 92 ? 2 : 1;
        index = end + 1; continue;
      }
      if (fold(code) !== 108 || fold(at(index + 1)) !== 111 || fold(at(index + 2)) !== 99 || fold(at(index + 3)) !== 97 || fold(at(index + 4)) !== 108 || at(index + 5) !== 40) { index++; continue; }
      let cursor = index + 6;
      while (blank(at(cursor))) cursor++;
      const quote = at(cursor);
      let from = cursor, to = cursor, close;
      if (quote === 34 || quote === 39) {
        from = cursor + 1; to = from;
        while (to < length && at(to) !== quote && at(to) !== 92) to++;
        if (at(to) !== quote) { index += 6; continue; }
        close = to + 1;
      } else {
        while (to < length && at(to) !== 41 && at(to) !== 34 && at(to) !== 39 && at(to) !== 92 && at(to) !== 40) to++;
        close = to;
      }
      while (blank(at(close))) close++;
      if (at(close) !== 41) { index += 6; continue; }
      let a = from, b = to;
      while (a < b && blank(at(a))) a++;
      while (b > a && blank(at(b - 1))) b--;
      if (hidden[I.apply(I.lower, I.apply(I.slice, text, [a, b]), [])] === true) { output += I.apply(I.slice, text, [copied, index]) + ABSENT; copied = close + 1; }
      index = close + 1;
    }
    return copied === 0 ? text : output + I.apply(I.slice, text, [copied]);
  }
  function hookFontFace() {
    const found = field(realm, 'FontFace'), Constructor = found && own(found.descriptor, 'value');
    if (!found || !found.descriptor.configurable || typeof Constructor !== 'function') { unavailable(); return; }
    // ADR-112: closing a prototype cycle through the wrapper (Object.setPrototypeOf(fn, fn)) is refused with the engine's own TypeError, as for the
    // native constructor; accepted, it would make every later property read of the function overflow the stack. Everything else is forwarded.
    // `__proto__: null` keeps a trap from being inherited from a page-extended Object.prototype. The guard also holds after stop().
    const wrapper = new I.Proxy(Constructor, { __proto__: null, construct(target, args, newTarget) {
      let forward = args;
      if (!state.stopped && args.length >= 2 && typeof args[1] === 'string') {
        let rewritten = args[1];
        try { rewritten = rewrite(args[1]); } catch { rewritten = args[1]; }
        if (rewritten !== args[1]) {
          forward = []; for (let index = 0; index < args.length; index++) push(forward, index === 1 ? rewritten : args[index]);
          if (state.changed < 65535) state.changed++;
        }
      }
      return I.construct(target, forward, newTarget === wrapper ? target : newTarget);
    }, setPrototypeOf(target, value) {
      if (value === wrapper) { I.setProto(target, target); return false; }
      return I.reflectSetProto(target, value);
    } });
    const home = own(Constructor, 'prototype'), alias = home && I.own(home, 'constructor');
    if (alias && alias.configurable && own(alias, 'value') === Constructor) save(home, 'constructor', alias, { ...alias, value: wrapper });
    save(found.target, 'FontFace', found.descriptor, { ...found.descriptor, value: wrapper });
  }
  const result = {
    snapshot() { return { ...state }; },
    stop() {
      if (state.stopped) return; state.stopped = true;
      if (active !== null) { try { I.apply(set, active.documentObject, [adoptedList(active.documentObject, active.sheet)]); } catch { /* the page replaced its sheets */ } active = null; }
      for (let index = handles.length - 1; index >= 0; index--) {
        const handle = handles[index];
        try { const now = I.own(handle.target, handle.key); if (now && now.value === handle.descriptor.value) I.define(handle.target, handle.key, handle.original); } catch { /* later page ownership */ }
      }
    },
  };
  try { I.define(realm, KEY, { value: refresh, configurable: false, enumerable: false, writable: false }); } catch { unavailable(); }
  if (state.names === 0) return result;
  try { adoptSheet(); } catch { unavailable(); }
  try { hookFontFace(); } catch { unavailable(); }
  return result;
}
