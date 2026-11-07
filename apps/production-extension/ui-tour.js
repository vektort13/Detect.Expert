// ADR-107 round 5, ADR-111: guided tours of the Options UI, one for every section. A tour highlights real parts of the page (a ring, the
// rest dimmed), explains each in a few words and changes nothing: no setting, no message, no permission, no network. The only thing it
// stores is its own progress, `ui-tour:v2` in localStorage: { version: 2, tours: { <section>: { completed, lastStep } } }, validated
// strictly on read; the single-tour progress of round 5 (`ui-tour:v1`) is read once and moved into it.
// Pure parts (state, steps, target lookup, placement, key decisions, the controller) come first; the Preact parts are last.
import { announce } from './ui-announcer.js';
import { registerPaletteCommands } from './ui-shortcuts.js';
import { tourLabels } from './ui-tour-labels.js';
import { TOURS, TOUR_IDS, DEFAULT_TOUR, TOUR_TARGETS } from './ui-tour-steps.js';
import { workspaceToolIcon } from './workspace-tool-icons.js';

export { TOURS, TOUR_IDS, DEFAULT_TOUR, TOUR_TARGETS };
export const TOUR_STORAGE_KEY = 'ui-tour:v2';
export const TOUR_LEGACY_STORAGE_KEY = 'ui-tour:v1';
export const TOUR_STATE_MAX_CHARS = 1024;
export const TOUR_LEGACY_MAX_CHARS = 64;
// How long a step waits for its target after the view changed (and, unchanged, how long before it gives up); a view that is still
// loading (aria-busy) extends the wait up to the hard cap.
export const TOUR_TARGET_WAIT_MS = 3000;
export const TOUR_TARGET_QUIET_MS = 600;
export const TOUR_TARGET_HARD_MS = 6000;
export const TOUR_POLL_MS = 50;
// A shown step re-measures this often even when nothing reported a change (content that grew above the target, fonts that arrived).
export const TOUR_TICK_MS = 500;
// Pause after a section or level change, so route code that restores a scroll position has run before the target is revealed.
export const TOUR_SETTLE_MS = 140;
export const TOUR_RING_PAD = 6;
export const TOUR_MARGIN = 12;
// Below this viewport width the popover is docked to the bottom edge.
export const TOUR_COMPACT_WIDTH = 640;
export const TOUR_SKIP_NOTES = 3;
// Search words only (never rendered): English names help every language find the command in the palette.
export const TOUR_PALETTE_KEYWORDS = 'tour guide tutorial walkthrough help onboarding';

const KEY = /^[a-z][a-z0-9-]{0,31}$/u;
const stepsOf = (tour, tours = TOURS) => (typeof tour === 'string' && Object.hasOwn(tours, tour) ? tours[tour] : null);

/** True for an element a person can currently see: attached, not hidden/inert/aria-hidden by itself or an ancestor, with a box. */
export function isTourTargetVisible(element) {
  try {
    if (!element || element.isConnected !== true) return false;
    if (typeof element.closest === 'function' && element.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
    const style = globalThis.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    const box = element.getBoundingClientRect();
    return box.width > 0 && box.height > 0;
  } catch { return false; }
}

/** The first visible element of a target key (dedicated anchor first, then the registry selectors), or null. */
export function findTourTarget(key, root = globalThis.document) {
  if (typeof key !== 'string' || !KEY.test(key) || !root || typeof root.querySelectorAll !== 'function') return null;
  const selectors = ['[data-tour~="' + key + '"]', ...(Object.hasOwn(TOUR_TARGETS, key) ? TOUR_TARGETS[key] : [])];
  for (const selector of selectors) {
    let found;
    try { found = root.querySelectorAll(selector); } catch { continue; }
    for (const element of found) if (isTourTargetVisible(element)) return element;
  }
  return null;
}

// ---- stored state -----------------------------------------------------------------------------------------------------------------
const defaultStorage = () => { try { return globalThis.localStorage ?? null; } catch { return null; } };
const isPlain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const freezeState = tours => Object.freeze({ version: 2, tours: Object.freeze(tours) });
const validProgress = (value, steps) => isPlain(value) && Object.keys(value).length === 2 && Object.hasOwn(value, 'completed') && Object.hasOwn(value, 'lastStep')
  && typeof value.completed === 'boolean' && Number.isInteger(value.lastStep) && value.lastStep >= 0 && value.lastStep < steps;

/**
 * The stored text as a state, or null for anything that is not exactly { version: 2, tours: { <known tour>: { completed: boolean,
 * lastStep: 0..steps-1 } } }: no other key, no unknown tour, no value out of range, nothing longer than TOUR_STATE_MAX_CHARS.
 */
export function parseTourState(raw, tours = TOURS) {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > TOUR_STATE_MAX_CHARS) return null;
  let value;
  try { value = JSON.parse(raw); } catch { return null; }
  if (!isPlain(value)) return null;
  const keys = Object.keys(value);
  if (keys.length !== 2 || !keys.includes('version') || !keys.includes('tours') || value.version !== 2 || !isPlain(value.tours)) return null;
  const ids = Object.keys(value.tours), entries = {};
  if (ids.length > Object.keys(tours).length) return null;
  for (const id of ids) {
    const steps = stepsOf(id, tours);
    if (steps === null || !validProgress(value.tours[id], steps.length)) return null;
    entries[id] = Object.freeze({ completed: value.tours[id].completed, lastStep: value.tours[id].lastStep });
  }
  return freezeState(entries);
}
/** The text to store, tours in registry order. */
export function serializeTourState(state, tours = TOURS) {
  const entries = {};
  for (const id of Object.keys(tours)) if (state?.tours && Object.hasOwn(state.tours, id)) entries[id] = { completed: state.tours[id].completed === true, lastStep: state.tours[id].lastStep };
  return JSON.stringify({ version: 2, tours: entries });
}

// Round 5 stored { version: 1, completed, lastStep } for the one tour it had, Antidetect, whose step 6 (index 5) was the Proxy step that
// now belongs to the Proxy tour: a progress after it moves one step up, so it still points at the same part of the page.
const LEGACY_KEYS = Object.freeze(['version', 'completed', 'lastStep']);
const LEGACY_STEPS = 8;
/** The v1 text as a v2 state (the Antidetect tour only), or null for anything that is not exactly the v1 shape. */
export function parseTourLegacyState(raw, tours = TOURS) {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > TOUR_LEGACY_MAX_CHARS) return null;
  let value;
  try { value = JSON.parse(raw); } catch { return null; }
  if (!isPlain(value)) return null;
  const keys = Object.keys(value);
  if (keys.length !== LEGACY_KEYS.length || !LEGACY_KEYS.every(key => keys.includes(key))) return null;
  if (value.version !== 1 || typeof value.completed !== 'boolean' || !Number.isInteger(value.lastStep) || value.lastStep < 0 || value.lastStep >= LEGACY_STEPS) return null;
  const steps = stepsOf(DEFAULT_TOUR, tours);
  if (steps === null) return null;
  const moved = value.lastStep <= 5 ? value.lastStep : value.lastStep - 1;
  return freezeState({ [DEFAULT_TOUR]: Object.freeze({ completed: value.completed, lastStep: Math.min(moved, steps.length - 1) }) });
}

/**
 * { state, invalid, legacy }. A stored v2 value is used; without one, a stored v1 value is migrated (`legacy` is true until the first
 * write replaces it). `invalid` is true when something is stored but it is not valid. A failing storage reads as empty.
 */
export function loadTourState(storage = defaultStorage(), tours = TOURS) {
  let current = null, legacy = null;
  try { if (storage) { current = storage.getItem(TOUR_STORAGE_KEY); if (current === null || current === undefined) legacy = storage.getItem(TOUR_LEGACY_STORAGE_KEY); } } catch { return { state: null, invalid: false, legacy: false }; }
  if (current !== null && current !== undefined) { const state = parseTourState(current, tours); return { state, invalid: state === null, legacy: false }; }
  if (legacy === null || legacy === undefined) return { state: null, invalid: false, legacy: false };
  const state = parseTourLegacyState(legacy, tours);
  return { state, invalid: state === null, legacy: state !== null };
}
export const readTourState = (storage, tours) => loadTourState(storage, tours).state;
/** Stores the state, then drops the round-5 key it replaces. The result says whether the new value was stored. */
export function writeTourState(storage, state, tours = TOURS) {
  try { storage.setItem(TOUR_STORAGE_KEY, serializeTourState(state, tours)); } catch { return false; }
  try { storage.removeItem(TOUR_LEGACY_STORAGE_KEY); } catch { /* The old key is harmless; it is ignored once the new one exists. */ }
  return true;
}
/** The on-demand clear path: forgets the progress completely, under both keys. */
export function clearTourState(storage = defaultStorage()) {
  try { storage?.removeItem(TOUR_STORAGE_KEY); storage?.removeItem(TOUR_LEGACY_STORAGE_KEY); return true; } catch { return false; }
}
/** { completed, lastStep, resumable } of one tour in a controller snapshot. */
export function tourProgress(snapshot, tour) {
  const entry = isPlain(snapshot?.progress) && Object.hasOwn(snapshot.progress, tour) ? snapshot.progress[tour] : null, lastStep = entry?.lastStep ?? 0;
  return Object.freeze({ completed: entry?.completed === true, lastStep, resumable: lastStep > 0 });
}

// ---- text, views, placement, keys -------------------------------------------------------------------------------------------------
/** Replaces {n}, {total} and {title} (nothing else) in one pass; a value is never read as a pattern. */
export function fillTourText(template, values) {
  if (typeof template !== 'string') return '';
  return template.replace(/\{(n|total|title)\}/gu, (match, name) => Object.hasOwn(values ?? {}, name) ? String(values[name]) : match);
}
export const tourStepKey = (id, part) => 'step_' + id + '_' + part;

export const sameTourView = (left, right) => Boolean(left) && Boolean(right) && left.section === right.section && (left.section !== 'antidetect' || (left.level ?? null) === (right.level ?? null));

/**
 * Where the popover goes, in viewport pixels. `ring` is { left, top, width, height } or null (a step without a target: centred).
 * Returns { mode: 'float' | 'dock' | 'center', left?, top?, side }: 'dock' is a sheet along the bottom edge, or along the top edge when
 * the target lies in the lower half (narrow windows, or no side of the ring has room); the position is left to CSS. `dockSide` keeps
 * an earlier choice, so the sheet never jumps between the edges while the page moves.
 */
export function computeTourPlacement({ ring, popover, viewport, margin = TOUR_MARGIN, compactWidth = TOUR_COMPACT_WIDTH, forceDock = false, dockSide = undefined }) {
  const width = Math.max(0, popover?.width ?? 0), height = Math.max(0, popover?.height ?? 0), vw = Math.max(0, viewport?.width ?? 0), vh = Math.max(0, viewport?.height ?? 0);
  const clamp = (value, low, high) => Math.round(Math.max(low, Math.min(value, Math.max(low, high))));
  if (!ring) return { mode: 'center', side: 'center', left: clamp((vw - width) / 2, 0, vw - width), top: clamp((vh - height) / 2, 0, vh - height) };
  const dock = { mode: 'dock', side: dockSide === 'top' || dockSide === 'bottom' ? dockSide : vh > 0 && ring.top + ring.height / 2 > vh / 2 ? 'top' : 'bottom' };
  if (vw < compactWidth || forceDock) return dock;
  const right = ring.left + ring.width, bottom = ring.top + ring.height, centerX = ring.left + ring.width / 2, centerY = ring.top + ring.height / 2;
  const room = { bottom: vh - bottom - margin * 2, top: ring.top - margin * 2, right: vw - right - margin * 2, left: ring.left - margin * 2 };
  const fits = { bottom: room.bottom >= height, top: room.top >= height, right: room.right >= width, left: room.left >= width };
  const side = ['bottom', 'top', 'right', 'left'].find(name => fits[name]);
  if (!side) return dock;
  const across = value => clamp(value, margin, vw - width - margin), along = value => clamp(value, margin, vh - height - margin);
  if (side === 'bottom') return { mode: 'float', side, left: across(centerX - width / 2), top: Math.round(bottom + margin) };
  if (side === 'top') return { mode: 'float', side, left: across(centerX - width / 2), top: Math.round(ring.top - margin - height) };
  if (side === 'right') return { mode: 'float', side, left: Math.round(right + margin), top: along(centerY - height / 2) };
  return { mode: 'float', side, left: Math.round(ring.left - margin - width), top: along(centerY - height / 2) };
}

/** The ring around a target box: padded and kept inside the viewport (a target taller than the window shows its visible part). */
export function tourRingFor(box, viewport, pad = TOUR_RING_PAD) {
  const left = Math.max(2, box.left - pad), top = Math.max(2, box.top - pad);
  const right = Math.min(viewport.width - 2, box.left + box.width + pad), bottom = Math.min(viewport.height - 2, box.top + box.height + pad);
  return { left: Math.round(left), top: Math.round(top), width: Math.max(0, Math.round(right - left)), height: Math.max(0, Math.round(bottom - top)) };
}

/**
 * What a key press does while the tour is open. `where` is 'button' (a control of the popover), 'popover' (its frame), 'page' (the
 * page, nothing focused), 'editable' (a text field outside the popover) or 'layer' (another dialog, menu or list with its own keys).
 * Modifier shortcuts and IME composition are never taken. In right-to-left text the arrows are mirrored.
 */
export function tourKeyAction({ key, shiftKey = false, ctrlKey = false, altKey = false, metaKey = false, isComposing = false, where = 'page', rtl = false }) {
  if (ctrlKey || altKey || metaKey || isComposing || where === 'layer') return null;
  if (key === 'Escape') return 'close';
  if (key === 'Tab') return shiftKey ? 'tab-backward' : 'tab-forward';
  if (shiftKey) return null;
  if (key === 'ArrowRight' || key === 'ArrowLeft') {
    if (where === 'editable') return null;
    return (key === 'ArrowRight') === !rtl ? 'next' : 'back';
  }
  if (key === 'Enter') return where === 'popover' || where === 'page' ? 'next' : null;
  return null;
}

// ---- controller: the state machine behind the layer --------------------------------------------------------------------------------
/**
 * One tour session at a time. `requestId` changes whenever a step is asked for (start, next, back, goto); the layer shows the step,
 * which may be a later or earlier one when a part is missing, and reports it with presented(). Progress is stored per tour on every
 * shown step. `completed` stays true once a run finished; `lastStep` is the step of an unfinished run (0 when there is none).
 * `available` says that this page has a tour layer (provide()), so a header button is only drawn where a tour can really run.
 */
export function createTourController({ tours = TOURS, storage = defaultStorage, defaultTour = DEFAULT_TOUR } = {}) {
  const listeners = new Set(), store = () => typeof storage === 'function' ? storage() : storage, known = id => stepsOf(id, tours) !== null;
  let stored = null, loaded = false, session = null, requests = 0, current = null, detach = null, available = false;
  function load() {
    if (loaded) return stored;
    loaded = true;
    const { state, invalid } = loadTourState(store(), tours);
    stored = state;
    if (invalid) clearTourState(store());
    return stored;
  }
  const entryOf = tour => { const state = load(); return state && Object.hasOwn(state.tours, tour) ? state.tours[tour] : null; };
  // Another Options window (or the person) changed the stored progress: read it again. Only while someone is subscribed.
  function attach() {
    if (detach || typeof globalThis.addEventListener !== 'function') return;
    const onStorage = event => { if (event?.key == null || event.key === TOUR_STORAGE_KEY || event.key === TOUR_LEGACY_STORAGE_KEY) { loaded = false; load(); notify(); } };
    globalThis.addEventListener('storage', onStorage);
    detach = () => globalThis.removeEventListener('storage', onStorage);
  }
  function build() {
    const state = load();
    return Object.freeze({ available, running: session !== null, tour: session ? session.tour : null, requestId: session ? session.requestId : 0, index: session ? session.index : 0, direction: session ? session.direction : 1,
      total: session ? session.total : 0, invoker: session ? session.invoker : null, progress: state ? state.tours : Object.freeze({}) });
  }
  function notify() { current = build(); for (const listener of [...listeners]) { try { listener(current); } catch { /* One view must not break another. */ } } }
  function persist(tour, completed, lastStep) {
    stored = freezeState({ ...(load()?.tours ?? {}), [tour]: Object.freeze({ completed, lastStep }) });
    writeTourState(store(), stored, tours);
  }
  function request(index, direction) {
    if (!session || !Number.isInteger(index) || index < 0 || index >= session.total) return false;
    session = { ...session, index, direction, requestId: ++requests };
    notify();
    return true;
  }
  return Object.freeze({
    getSnapshot: () => current ??= build(),
    subscribe(listener) {
      if (typeof listener !== 'function') return () => {};
      listeners.add(listener); attach();
      return () => { listeners.delete(listener); if (listeners.size === 0 && detach) { detach(); detach = null; } };
    },
    /** This page has a tour layer: the header buttons that start tours are drawn from now on. */
    provide() { if (!available) { available = true; current = null; if (listeners.size) notify(); } return true; },
    /** Starts (or restarts) a tour; with `resume` at the stored step of an unfinished run. Starting over forgets that stored step. */
    start({ tour = defaultTour, invoker = null, resume = false } = {}) {
      if (!known(tour)) return false;
      loaded = false;                                       // the stored progress may have changed elsewhere since it was read
      const entry = entryOf(tour), resuming = resume === true && (entry?.lastStep ?? 0) > 0, index = resuming ? entry.lastStep : 0;
      if (!resuming && (entry?.lastStep ?? 0) > 0) persist(tour, entry.completed, 0);
      session = { tour, total: tours[tour].length, requestId: ++requests, index, direction: 1, invoker: invoker ?? null, shown: null };
      notify();
      return true;
    },
    next: () => session !== null && session.index < session.total - 1 && request(session.index + 1, 1),
    back: () => session !== null && session.index > 0 && request(session.index - 1, -1),
    goto: (index, direction = 1) => request(index, direction < 0 ? -1 : 1),
    /** The layer shows step `index` (maybe not the one asked for): it becomes the current step and the stored progress. */
    presented(index) {
      if (!session || !Number.isInteger(index) || index < 0 || index >= session.total) return false;
      session = { ...session, index, shown: index };
      persist(session.tour, entryOf(session.tour)?.completed === true, index);
      notify();
      return true;
    },
    /** Ends the run. 'done', or any end on the last step, completes it; otherwise the shown step is kept for Resume. */
    close(reason = 'skip') {
      if (!session) return null;
      const closing = session, at = closing.shown ?? closing.index, finished = reason === 'done' || at >= closing.total - 1;
      session = null;
      if (closing.shown !== null) { if (finished) persist(closing.tour, true, 0); else persist(closing.tour, entryOf(closing.tour)?.completed === true, at); }
      notify();
      return Object.freeze({ reason, tour: closing.tour, completed: finished && closing.shown !== null, invoker: closing.invoker });
    },
    /** Forgets the progress of one tour, or of all (the stored key is removed). */
    forget(tour = null) {
      if (tour === null) { stored = null; loaded = true; clearTourState(store()); notify(); return true; }
      if (!known(tour)) return false;
      const state = load();
      if (state && Object.hasOwn(state.tours, tour)) {
        const rest = { ...state.tours }; delete rest[tour];
        if (Object.keys(rest).length === 0) { stored = null; clearTourState(store()); } else { stored = freezeState(rest); writeTourState(store(), stored, tours); }
      }
      notify();
      return true;
    },
  });
}
export const tourSession = createTourController();

// ---- the walk to the next step that can be shown ------------------------------------------------------------------------------------
const defaultPause = ms => new Promise(resolve => setTimeout(resolve, ms));
/**
 * From step `index`, walks in `direction` (1 or -1) to the first step whose target is on screen. A step whose view is not on screen
 * is asked for through `navigate`; its target is waited for (TOUR_TARGET_WAIT_MS after a view change, TOUR_TARGET_QUIET_MS otherwise,
 * longer while `busy()` says the view still loads, up to TOUR_TARGET_HARD_MS). A step whose target never shows is skipped; its id is
 * collected. Resolves { index, element, skipped } (a step without a target resolves with element null), { ranOff: true, index, skipped }
 * when the walk left either end of the steps, or null as soon as `cancelled()` is true. Nothing here touches the page except through
 * the three callbacks, so the walk can be checked with a fake clock.
 */
export async function findPresentableStep({ steps = TOURS[DEFAULT_TOUR], index, direction, currentView, navigate, locate, cancelled = () => false, busy = () => false, pause = defaultPause, now = Date.now }) {
  const skipped = [];
  while (index >= 0 && index < steps.length) {
    // The page is asked for the step's view whenever it is not on screen, also after the person moved elsewhere behind the tour.
    const step = steps[index], viewChanged = !sameTourView(currentView(), step.view);
    if (viewChanged) { try { navigate(step.view); } catch { /* A view that cannot be shown simply has no target. */ } await pause(TOUR_SETTLE_MS); }
    if (cancelled()) return null;
    let element = step.target === null ? null : locate(step.target);
    const began = now(), patience = viewChanged ? TOUR_TARGET_WAIT_MS : TOUR_TARGET_QUIET_MS;
    while (step.target !== null && !element && !cancelled()) {
      const waited = now() - began;
      if (waited >= patience && !(busy() && waited < TOUR_TARGET_HARD_MS)) break;
      await pause(TOUR_POLL_MS);
      element = locate(step.target);
    }
    if (cancelled()) return null;
    if (step.target === null || element) return { index, element, skipped };
    skipped.push(step.id);
    index += direction;
  }
  return { ranOff: true, index, skipped };
}

// ---- Preact parts -----------------------------------------------------------------------------------------------------------------
const sleep = defaultPause;
const documentRoot = () => globalThis.document?.documentElement ?? null;
const viewportSize = () => { const root = documentRoot(); return { width: root?.clientWidth ?? globalThis.innerWidth ?? 0, height: root?.clientHeight ?? globalThis.innerHeight ?? 0 }; };
const levelOnScreen = () => { try { return globalThis.document.querySelector('[data-antidetect-category][aria-selected="true"]')?.dataset?.antidetectCategory ?? null; } catch { return null; } };
const quiet = action => { try { return action(); } catch { return undefined; } };
const activeInvoker = () => {
  const element = quiet(() => globalThis.document.activeElement);
  return element && element !== globalThis.document.body && element !== globalThis.document.documentElement ? element : null;
};
const loadingOnScreen = () => quiet(() => globalThis.document.querySelector('[data-management-panel]:not([hidden]) [aria-busy="true"]')) != null;
// Scrolls instantly (a smooth scroll would make the ring chase a moving target); older engines without the keyword scroll plainly.
function revealTarget(element) {
  const height = viewportSize().height, box = quiet(() => element.getBoundingClientRect());
  const block = box && box.height > height * 0.6 ? 'start' : 'center';
  try { element.scrollIntoView({ block, inline: 'nearest', behavior: 'instant' }); } catch { quiet(() => element.scrollIntoView({ block, inline: 'nearest' })); }
}
// Anything the tour may hand focus back to when its invoker is gone.
const FALLBACK_FOCUS = Object.freeze(['[data-ui-tour-start]', '[data-management-search]', '[data-management-tab][aria-selected="true"]']);
const OTHER_LAYER = 'dialog, [role="dialog"], [role="alertdialog"], [role="listbox"], [role="menu"], [aria-expanded="true"]';
const EDITABLE = 'input:not([type="button"]):not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="submit"]), textarea, select, [contenteditable=""], [contenteditable="true"]';
const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * The entry points. `TourButton` is the compact button of a section header, drawn left of the module switch (or at the end of a header
 * without one): it starts the tour of its section, or resumes it after an interruption. `TourStart` is the block of the Antidetect
 * first-run checklist. Both start tours only; the button is drawn only on a page that has a tour layer.
 */
export function createTourEntry({ h, useState, useEffect, useLocale, controller = tourSession }) {
  function useSnapshot() {
    const [snapshot, setSnapshot] = useState(controller.getSnapshot);
    useEffect(() => { setSnapshot(controller.getSnapshot()); return controller.subscribe(setSnapshot); }, []);
    return snapshot;
  }
  const begin = (tour, event, resume) => { try { controller.start({ tour, invoker: event?.currentTarget ?? null, resume }); } catch { /* The tour never throws into the page. */ } };

  function TourStart({ variant = 'checklist', tour = DEFAULT_TOUR }) {
    const labels = tourLabels(useLocale()), text = key => labels[key], snapshot = useSnapshot(), steps = stepsOf(tour);
    if (steps === null) return null;
    const progress = tourProgress(snapshot, tour), resumable = progress.resumable && !snapshot.running, label = resumable ? text('resume') : text('start');
    const start = h('button', { type: 'button', class: 'button', 'aria-haspopup': 'dialog', 'data-ui-tour-start': variant, 'data-tour-for': tour, onClick: event => begin(tour, event, resumable), children: label });
    return h('div', { class: 'ui-tour-entry', 'data-ui-tour-entry': variant, children: [
      h('p', { class: 'ui-tour-entry__hint', children: resumable ? fillTourText(text('resume_hint'), { n: progress.lastStep + 1, total: steps.length }) : text('entry_hint') }),
      h('div', { class: 'ui-tour-entry__actions', children: [start, resumable ? h('button', { type: 'button', class: 'button button--text', 'data-ui-tour-restart': variant, onClick: event => begin(tour, event, false), children: text('restart') }) : null] }),
    ] });
  }

  function TourButton({ tour, className = '' }) {
    const labels = tourLabels(useLocale()), snapshot = useSnapshot(), steps = stepsOf(tour);
    if (steps === null || snapshot.available !== true) return null;
    const progress = tourProgress(snapshot, tour), resumable = progress.resumable && !snapshot.running;
    return h('button', { type: 'button', class: 'button workspace-tool workspace-tool--tour' + (className ? ' ' + className : ''), 'aria-haspopup': 'dialog', 'data-ui-tour-start': 'header', 'data-tour-for': tour,
      'data-ui-tour-resumable': resumable ? 'true' : undefined, title: resumable ? fillTourText(labels.tour_tip_resume, { n: progress.lastStep + 1, total: steps.length }) : labels.tour_tip, onClick: event => begin(tour, event, resumable),
      children: [workspaceToolIcon(h, 'tour'), h('span', { class: 'workspace-tool__label', children: labels.tour_label })] });
  }
  return { TourStart, TourButton };
}

/**
 * The Tour button for a header that another copy of Preact draws (the Firewall launcher of the module «Защита», ADR-111). A component of this page's
 * Preact cannot run inside that copy (its hooks would have no component to belong to), so the shell hands the launcher this maker instead of a vnode:
 * the module calls it once with ITS h and hooks and the language of the page, and draws the component that comes back between the title and the
 * switch. The button is the one of every other header (the same markup, the same controller); only the Preact that runs it differs.
 */
export function tourToolSlot(tour, controller = tourSession) {
  return kit => {
    const { TourButton } = createTourEntry({ h: kit.h, useState: kit.useState, useEffect: kit.useEffect, useLocale: kit.useLocale, controller });
    return () => kit.h(TourButton, { tour });
  };
}

/** The popover: a non-modal dialog. Purely a function of its props, so its markup can be checked without a browser. */
export function createTourPopover({ h }) {
  return function TourPopover({ popoverRef, nextRef, id, index, total, title, body, stepLabel, eyebrow, notes = [], mode = 'float', dock = 'bottom', style = undefined, ready = false, busy = false, labels, onBack, onNext, onSkip }) {
    const last = index === total - 1, guarded = handler => event => { if (busy) { event?.preventDefault?.(); return; } handler(event); };
    return h('section', { class: 'ui-tour__popover', ref: popoverRef, role: 'dialog', 'aria-modal': 'false', 'aria-labelledby': 'ui-tour-title', 'aria-describedby': 'ui-tour-step ui-tour-body', tabIndex: -1,
      'data-ui-tour-popover': '', 'data-ui-tour-step': id, 'data-ui-tour-mode': mode, 'data-ui-tour-dock': mode === 'dock' ? dock : undefined, 'data-ui-tour-ready': ready ? 'true' : 'false', 'aria-busy': busy ? 'true' : undefined, style, children: [
        h('p', { class: 'ui-tour__eyebrow', children: [h('span', { class: 'ui-tour__eyebrow-text', children: eyebrow }), h('span', { class: 'ui-tour__counter', dir: 'ltr', 'aria-hidden': 'true', 'data-ui-tour-counter': '', children: (index + 1) + ' / ' + total })] }),
        h('h2', { id: 'ui-tour-title', class: 'ui-tour__title', 'data-ui-tour-title': '', children: title }),
        h('p', { id: 'ui-tour-step', class: 'sr-only', children: stepLabel }),
        h('p', { id: 'ui-tour-body', class: 'ui-tour__body', 'data-ui-tour-body': '', children: body }),
        notes.length ? h('ul', { class: 'ui-tour__notes', 'data-ui-tour-skipped': notes.length, children: notes.map(note => h('li', { key: note.id, 'data-ui-tour-skipped-step': note.id, children: note.text })) }) : null,
        h('div', { class: 'ui-tour__actions', children: [
          last ? null : h('button', { type: 'button', class: 'button button--text ui-tour__skip', 'data-ui-tour-skip': '', onClick: onSkip, children: labels.skip }),
          h('span', { class: 'ui-tour__spacer', 'aria-hidden': 'true' }),
          index > 0 ? h('button', { type: 'button', class: 'button', 'data-ui-tour-back': '', 'aria-disabled': busy ? 'true' : undefined, onClick: guarded(onBack), children: labels.back }) : null,
          h('button', { type: 'button', class: 'button button--primary', ref: nextRef, 'data-ui-tour-next': '', 'aria-disabled': busy ? 'true' : undefined, onClick: guarded(onNext), children: last ? labels.done : labels.next }),
        ] }),
      ] });
  };
}

/**
 * The tour layer, mounted once in the Options shell. `navigate({ section, level? })` shows a section (and an Antidetect level) without
 * moving focus; `getView()` returns { section } of what is on screen now. Both are read at call time, so fresh closures are fine.
 */
export function createTourUi({ h, useState, useEffect, useRef, useLocale, controller = tourSession }) {
  const TourPopover = createTourPopover({ h });
  controller.provide?.();

  function TourLayer({ navigate = () => {}, getView = () => ({ section: null }) }) {
    const locale = useLocale();
    const [snapshot, setSnapshot] = useState(controller.getSnapshot);
    const [shown, setShown] = useState(null);
    const [geometry, setGeometry] = useState(null);
    const popoverRef = useRef(null), nextRef = useRef(null), live = useRef(null), work = useRef(null);
    work.current ??= { origin: null, serial: 0, dockLatch: null, adjusted: '', focusedSerial: -1 };
    live.current = { snapshot, shown, navigate, getView, labels: tourLabels(locale) };
    // Handlers and effects read the labels of the latest render, so a language switched under a running tour is followed everywhere.
    const text = key => live.current.labels[key];
    const titleOf = id => text(tourStepKey(id, 'title')), bodyOf = id => text(tourStepKey(id, 'body'));

    useEffect(() => { setSnapshot(controller.getSnapshot()); return controller.subscribe(setSnapshot); }, []);
    // The palette offers the tour of every section (or its resume) while no run is going; the kinds are in ui-shortcuts.js.
    useEffect(() => registerPaletteCommands('ui-tour', () => {
      const state = controller.getSnapshot();
      if (state.running) return [];
      return TOUR_IDS.map(tour => {
        const resume = tourProgress(state, tour).resumable;
        return { kind: resume ? 'resume-tour' : 'start-tour', key: tour, section: tour, run: () => { controller.start({ tour, invoker: activeInvoker(), resume }); } };
      });
    }), []);

    const actualView = () => { const section = quiet(() => live.current.getView().section) ?? null; return section === 'antidetect' ? { section, level: levelOnScreen() } : { section }; };

    // Leaves the tour: stores the progress, brings the page back to where the run began and hands focus back to the invoker.
    function finish(reason) {
      const state = work.current, origin = state.origin;
      const closed = controller.close(reason);
      if (!closed) return;
      state.origin = null;
      quiet(() => announce(closed.completed ? text('finished') : text('closed')));
      void (async () => {
        try {
          const view = origin ? { section: origin.section, ...(origin.section === 'antidetect' && origin.level ? { level: origin.level } : {}) } : null;
          if (view && view.section && !sameTourView(view, actualView())) live.current.navigate(view);
          await sleep(TOUR_SETTLE_MS);
          const deadline = Date.now() + 1500;
          for (;;) {
            let target = closed.invoker && isTourTargetVisible(closed.invoker) && !closed.invoker.disabled ? closed.invoker : null;
            // Every section keeps its own header button in the page, so the first one in the document may belong to a section that is not on screen.
            if (!target) for (const selector of FALLBACK_FOCUS) { const found = quiet(() => [...globalThis.document.querySelectorAll(selector)].find(isTourTargetVisible)); if (found) { target = found; break; } }
            if (target) { quiet(() => target.focus()); return; }
            if (Date.now() >= deadline) return;
            await sleep(TOUR_POLL_MS);
          }
        } catch { /* Closing never throws into the page. */ }
      })();
    }

    // Each request for a step: show its view, wait for its target, skip the steps whose part is missing, then show the step.
    useEffect(() => {
      if (!snapshot.running) { setShown(null); setGeometry(null); return undefined; }
      let cancelled = false;
      const state = work.current, steps = stepsOf(snapshot.tour), tour = snapshot.tour;
      if (steps === null) { quiet(() => controller.close('error')); return undefined; }
      (async () => {
        try {
          if (state.origin === null) state.origin = { section: quiet(() => live.current.getView().section) ?? null, level: levelOnScreen() };
          const direction = snapshot.direction, previous = live.current.shown?.tour === tour ? live.current.shown : null;
          const found = await findPresentableStep({ steps, index: snapshot.index, direction, currentView: actualView, navigate: view => live.current.navigate(view), locate: findTourTarget, cancelled: () => cancelled, busy: loadingOnScreen });
          if (found === null || cancelled) return;
          if (found.ranOff) {
            // Past the last step: the run is over. Before the first: stay where the person was.
            if (direction > 0 && previous !== null) { finish('done'); return; }
            if (previous !== null) { controller.goto(previous.index, 1); return; }
            // Nothing could be shown at all: the first step is shown without a highlight rather than leaving the person with nothing.
            setShown({ tour, index: 0, element: null, skipped: found.skipped, requestId: snapshot.requestId, serial: ++state.serial, first: true });
            controller.presented(0);
            return;
          }
          if (found.element) { revealTarget(found.element); await sleep(TOUR_POLL_MS); if (cancelled) return; }
          setShown({ tour, index: found.index, element: found.element, skipped: found.skipped, requestId: snapshot.requestId, serial: ++state.serial, first: previous === null });
          controller.presented(found.index);
        } catch { if (!cancelled) quiet(() => controller.close('error')); }
      })();
      return () => { cancelled = true; };
    }, [snapshot.running, snapshot.requestId]);

    // Position the ring and the popover for the shown step and keep them right while the window, the page or the theme change.
    useEffect(() => {
      if (!shown) return undefined;
      const state = work.current, serial = shown.serial, listeners = [], steps = stepsOf(shown.tour) ?? [];
      let timer = null, disposed = false, resizeObserver = null, mutationObserver = null, tracked = shown.element, slowTick = null;
      const skipNotes = () => shown.skipped.slice(0, TOUR_SKIP_NOTES).map(skippedId => fillTourText(text('skipped'), { title: titleOf(skippedId) })).join(' ');
      const announcement = () => {
        const id = steps[shown.index].id, parts = [fillTourText(text('step_label'), { n: shown.index + 1, total: steps.length }) + ': ' + titleOf(id) + '.', bodyOf(id)];
        if (shown.skipped.length) parts.push(skipNotes());
        return parts.join(' ');
      };
      const schedule = () => { if (timer === null && !disposed) timer = setTimeout(measure, 16); };
      function measure() {
        timer = null;
        const popover = popoverRef.current;
        if (disposed || !popover) return;
        // The page may replace the node of the target (a part that renders again): look for it again, by the step's own key.
        if (tracked && !tracked.isConnected) { const fresh = findTourTarget(steps[shown.index].target); if (fresh) { tracked = fresh; quiet(() => resizeObserver?.observe(fresh)); } }
        const viewport = viewportSize(), element = tracked && tracked.isConnected ? tracked : null;
        const box = element ? quiet(() => element.getBoundingClientRect()) : null;
        const ring = box && (box.width > 0 || box.height > 0) ? tourRingFor(box, viewport) : null;
        const size = { width: popover.offsetWidth, height: popover.offsetHeight };
        const latch = state.dockLatch && state.dockLatch.serial === serial && state.dockLatch.width === viewport.width && state.dockLatch.height === viewport.height ? state.dockLatch : null;
        const placement = computeTourPlacement({ ring, popover: size, viewport, forceDock: latch !== null, dockSide: latch?.side });
        if (placement.mode === 'dock' && !latch) state.dockLatch = { serial, width: viewport.width, height: viewport.height, side: placement.side };
        // A docked sheet covers an edge of the window: when the target lies under it, move the page (once per step and sheet shape).
        const shape = serial + ':' + popover.getAttribute('data-ui-tour-mode');
        if (placement.mode === 'dock' && ring && state.adjusted !== shape) {
          const room = size.height + 8 + TOUR_MARGIN, top = placement.side === 'top', covered = top ? room - ring.top : ring.top + ring.height - (viewport.height - room);
          if (covered > 0) { state.adjusted = shape; quiet(() => globalThis.scrollBy({ top: top ? -covered : Math.min(covered, Math.max(0, ring.top - TOUR_MARGIN)), left: 0, behavior: 'instant' })); schedule(); }
        }
        const rtl = quiet(() => globalThis.getComputedStyle(popover).direction === 'rtl') === true;
        setGeometry(before => {
          const same = before && before.serial === serial && before.rtl === rtl && JSON.stringify(before.ring) === JSON.stringify(ring) && JSON.stringify(before.placement) === JSON.stringify(placement);
          return same ? before : { serial, ring, placement, rtl };
        });
        if (state.focusedSerial !== serial) {
          state.focusedSerial = serial;
          const active = quiet(() => globalThis.document.activeElement);
          if (shown.first) quiet(() => popover.focus({ preventScroll: true }));
          else if (!active || !popover.contains(active)) quiet(() => (nextRef.current ?? popover).focus({ preventScroll: true }));
          // The first step is read out through the dialog itself; a note about steps skipped before it is not part of that, so it is announced.
          if (!shown.first) quiet(() => announce(announcement()));
          else if (shown.skipped.length) quiet(() => announce(skipNotes()));
        }
      }
      const listen = (target, type, handler, options) => { if (target?.addEventListener) { target.addEventListener(type, handler, options); listeners.push(() => target.removeEventListener(type, handler, options)); } };
      listen(globalThis, 'resize', schedule); listen(globalThis, 'scroll', schedule, true);
      for (const query of ['(prefers-color-scheme: dark)', '(prefers-reduced-motion: reduce)', '(prefers-contrast: more)', '(forced-colors: active)']) listen(quiet(() => globalThis.matchMedia(query)), 'change', schedule);
      if (typeof globalThis.ResizeObserver === 'function') {
        resizeObserver = new globalThis.ResizeObserver(schedule);
        quiet(() => { resizeObserver.observe(documentRoot()); if (shown.element) resizeObserver.observe(shown.element); if (popoverRef.current) resizeObserver.observe(popoverRef.current); });
      }
      // Theme, language and direction live on the root element; a change moves things by a few pixels.
      if (typeof globalThis.MutationObserver === 'function' && documentRoot()) {
        mutationObserver = new globalThis.MutationObserver(schedule);
        quiet(() => mutationObserver.observe(documentRoot(), { attributes: true, attributeFilter: ['data-ui-theme', 'data-ui-theme-effective', 'lang', 'dir', 'style', 'class'] }));
      }
      measure();
      slowTick = setInterval(schedule, TOUR_TICK_MS);
      return () => { disposed = true; if (timer !== null) clearTimeout(timer); clearInterval(slowTick); for (const stop of listeners) stop(); resizeObserver?.disconnect(); mutationObserver?.disconnect(); };
    }, [shown?.serial, locale]);

    // Keyboard: Esc closes, arrows and Enter move, Tab cycles inside the popover; nothing else is taken, and the page stays reachable.
    useEffect(() => {
      if (!snapshot.running) return undefined;
      const onKey = event => {
        const popover = popoverRef.current, current = live.current;
        const target = event.target instanceof Element ? event.target : null;
        const inside = Boolean(popover) && Boolean(target) && popover.contains(target);
        const layer = target && !inside ? target.closest(OTHER_LAYER) : null;
        let where = 'page';
        if (layer || (!inside && quiet(() => globalThis.document.querySelector(':modal')))) where = 'layer';
        else if (inside) where = target.closest('button, a, input, select, textarea') ? 'button' : 'popover';
        else if (target && target.matches?.(EDITABLE)) where = 'editable';
        const rtl = quiet(() => globalThis.getComputedStyle(popover ?? documentRoot()).direction === 'rtl') === true;
        const action = tourKeyAction({ key: event.key, shiftKey: event.shiftKey, ctrlKey: event.ctrlKey, altKey: event.altKey, metaKey: event.metaKey, isComposing: event.isComposing, where, rtl });
        if (!action) return;
        // While the first step is still being prepared there is no popover: Esc alone can already stop the tour.
        if (!popover || !current.shown) { if (action === 'close') { event.preventDefault(); event.stopPropagation(); finish('esc'); } return; }
        if (action === 'tab-forward' || action === 'tab-backward') {
          const stops = [...popover.querySelectorAll(FOCUSABLE)].filter(isTourTargetVisible), first = stops[0], last = stops[stops.length - 1], active = quiet(() => globalThis.document.activeElement);
          if (!first) return;
          const forward = action === 'tab-forward';
          if (!inside || (forward && active === last) || (!forward && (active === first || active === popover))) { event.preventDefault(); (forward ? first : last).focus({ preventScroll: true }); }
          return;
        }
        event.preventDefault(); event.stopPropagation();
        if (event.repeat) return;
        const lastStep = current.shown.index >= (stepsOf(current.shown.tour)?.length ?? 0) - 1;
        if (action === 'close') finish(lastStep ? 'done' : 'esc');
        else if (current.shown.requestId !== current.snapshot.requestId) return;
        else if (action === 'next') { if (lastStep) finish('done'); else controller.next(); }
        else if (action === 'back') controller.back();
      };
      globalThis.addEventListener('keydown', onKey, true);
      return () => globalThis.removeEventListener('keydown', onKey, true);
    }, [snapshot.running]);

    // The page going away while a run is open: store the progress, restore nothing.
    useEffect(() => () => { try { if (controller.getSnapshot().running) controller.close('unmount'); } catch { /* Nothing to clean when the page is gone. */ } }, []);

    if (!snapshot.running || !shown) return null;
    const steps = stepsOf(shown.tour) ?? [], entry = steps[shown.index];
    if (!entry) return null;
    const total = steps.length, id = entry.id;
    const ready = geometry !== null && geometry.serial === shown.serial, busy = shown.requestId !== snapshot.requestId;
    const placement = ready ? geometry.placement : { mode: 'float', side: 'bottom' }, ring = ready ? geometry.ring : null;
    const style = ready && placement.mode !== 'dock' ? { left: placement.left + 'px', top: placement.top + 'px' } : undefined;
    const labels = { back: text('back'), next: text('next'), skip: text('skip'), done: text('done') };
    const notes = shown.skipped.slice(0, TOUR_SKIP_NOTES).map(skippedId => ({ id: skippedId, text: fillTourText(text('skipped'), { title: titleOf(skippedId) }) }));
    return h('div', { class: 'ui-tour', 'data-ui-tour': 'open', 'data-ui-tour-for': shown.tour, children: [
      h('div', { class: 'ui-tour__shield', 'aria-hidden': 'true', onMouseDown: event => { event.preventDefault(); }, onContextMenu: event => { event.preventDefault(); } }),
      ring ? h('div', { class: 'ui-tour__ring', 'aria-hidden': 'true', 'data-ui-tour-ring': '', style: { left: ring.left + 'px', top: ring.top + 'px', width: ring.width + 'px', height: ring.height + 'px' } }) : h('div', { class: 'ui-tour__scrim', 'aria-hidden': 'true', 'data-ui-tour-scrim': '' }),
      h(TourPopover, { popoverRef, nextRef, id, index: shown.index, total, title: titleOf(id), body: bodyOf(id), stepLabel: fillTourText(text('step_label'), { n: shown.index + 1, total }),
        eyebrow: text('eyebrow'), notes, mode: placement.mode, dock: placement.side, style, ready, busy, labels,
        onBack: () => { controller.back(); }, onNext: () => { if (shown.index >= total - 1) finish('done'); else controller.next(); }, onSkip: () => { finish('skip'); } }),
    ] });
  }
  return { TourLayer, TourPopover };
}
