// ADR-107: keyboard save scoped to one editor, the unsaved-changes guard on leaving the page, and the commands mounted
// editors offer to the Options command palette while they live. No storage, no messages, no permission requests.

/** Ctrl+S (Windows, Linux) or Cmd+S (macOS); Alt, Shift and IME composition never match. Physical key or typed letter. */
export function isSaveShortcut(event) {
  return Boolean(event) && (event.ctrlKey === true || event.metaKey === true) && event.altKey !== true && event.shiftKey !== true
    && event.isComposing !== true && (event.code === 'KeyS' || event.key === 's' || event.key === 'S');
}
const inside = (root, target) => { try { return target === root || root.contains(target) === true; } catch { return false; } };

/**
 * Handles Ctrl/Cmd+S while focus is inside `rootElement`. `handler(event)` must return exactly `true` synchronously when it
 * accepted the save (start any asynchronous work without awaiting it); only then is the browser's own "Save page"
 * prevented. Keyboard auto-repeat never calls the handler again: it is prevented only when the first press was handled.
 * Returns an idempotent unregister function; a missing root or handler registers nothing.
 */
export function registerSaveShortcut(rootElement, handler) {
  if (!rootElement || typeof rootElement.addEventListener !== 'function' || typeof handler !== 'function') return () => {};
  let active = true, handledPress = false;
  const listener = event => {
    if (!active || event.defaultPrevented || !isSaveShortcut(event) || !inside(rootElement, event.target)) return;
    if (event.repeat === true) { if (handledPress) event.preventDefault(); return; }
    let accepted = false;
    try { accepted = handler(event) === true; } catch { accepted = false; }
    handledPress = accepted;
    if (accepted) event.preventDefault();
  };
  rootElement.addEventListener('keydown', listener);
  return () => { if (!active) return; active = false; rootElement.removeEventListener('keydown', listener); };
}

/**
 * Adds one `beforeunload` listener that asks the browser to confirm leaving while `isDirty()` returns exactly true.
 * A throwing check counts as clean so a broken view never traps the page. Returns an idempotent unregister function.
 */
export function registerDirtyGuard(isDirty, target = globalThis) {
  if (typeof isDirty !== 'function' || typeof target?.addEventListener !== 'function') return () => {};
  let active = true;
  const listener = event => {
    if (!active) return;
    let dirty = false;
    try { dirty = isDirty() === true; } catch { dirty = false; }
    if (!dirty) return;
    event.preventDefault();
    // Chromium before 119 shows the dialog only when returnValue is set.
    try { event.returnValue = true; } catch { /* Read-only in some engines; preventDefault suffices there. */ }
  };
  target.addEventListener('beforeunload', listener);
  return () => { if (!active) return; active = false; target.removeEventListener('beforeunload', listener); };
}

// Palette commands. A mounted editor registers a provider; the palette asks every provider when it renders and formats
// the labels itself, so a provider supplies only the kind, the data the label needs and the action. The kinds are a
// closed list: none of them requests a permission or opens a browser settings page. The two tour kinds (ui-tour.js) only open or
// resume the guided tour; they change no setting.
export const PALETTE_COMMAND_KINDS = Object.freeze(['load-profile', 'randomize', 'apply-profile', 'apply-network', 'export-profile', 'start-tour', 'resume-tour']);
export const PALETTE_SOURCE_LIMIT = 8;
export const PALETTE_COMMAND_LIMIT = 64;
export const PALETTE_NAME_MAX = 128;
const SOURCE_ID = /^[a-z0-9-]{1,64}$/u;
const PALETTE_SECTION = /^[a-z][a-z0-9-]{0,31}$/u;
const sources = new Map();

/**
 * `provide()` returns an array of `{ kind, key?, name?, run }`: `kind` from PALETTE_COMMAND_KINDS, `key` a string unique
 * within the source (needed when one kind repeats, as for profiles), `name` the profile name of `load-profile`, `run` the
 * action. Registering the same `sourceId` again replaces the provider. Returns an idempotent unregister function.
 */
export function registerPaletteCommands(sourceId, provide) {
  if (typeof sourceId !== 'string' || !SOURCE_ID.test(sourceId) || typeof provide !== 'function') return () => {};
  if (!sources.has(sourceId) && sources.size >= PALETTE_SOURCE_LIMIT) return () => {};
  const token = { provide };
  sources.set(sourceId, token);
  return () => { if (sources.get(sourceId) === token) sources.delete(sourceId); };
}
const shortText = value => typeof value === 'string' && value.trim() !== '' && value.length <= PALETTE_NAME_MAX ? value : null;
/** The current valid commands of every provider, at most PALETTE_COMMAND_LIMIT per source; a throwing provider is skipped. */
export function collectPaletteCommands() {
  const result = [];
  for (const [source, { provide }] of sources) {
    let list;
    try { list = provide(); } catch { continue; }
    if (!Array.isArray(list)) continue;
    const seen = new Set();
    for (const item of list.slice(0, PALETTE_COMMAND_LIMIT)) {
      if (!item || typeof item !== 'object' || !PALETTE_COMMAND_KINDS.includes(item.kind) || typeof item.run !== 'function') continue;
      const name = item.kind === 'load-profile' ? shortText(item.name) : null;
      if (item.kind === 'load-profile' && name === null) continue;
      const key = shortText(item.key) ?? item.kind, id = source + ':' + item.kind + ':' + key;
      if (seen.has(id)) continue;
      seen.add(id);
      // `section` (a section id, as the tour commands of ADR-111 carry) says which Options section the command belongs to.
      const section = typeof item.section === 'string' && PALETTE_SECTION.test(item.section) ? item.section : null;
      result.push(Object.freeze({ id, source, kind: item.kind, name, section, run: item.run }));
    }
  }
  return result;
}
