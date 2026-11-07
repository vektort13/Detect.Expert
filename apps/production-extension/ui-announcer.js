// ADR-107: one pair of always-present live regions (polite + assertive) at the Options shell root, outside the inert
// panels, and one way to fill them. Messages are plain bounded text set through textContent: nothing is parsed as markup,
// stored, logged or sent anywhere. Without the regions (another document, a test without DOM) announce() is a no-op.
export const ANNOUNCER_ATTRIBUTE = 'data-ui-announcer';
export const ANNOUNCE_MAX_LENGTH = 512;
// A shown message leaves the region after this time so the virtual cursor never meets stale text.
export const ANNOUNCE_CLEAR_MS = 7000;
// The previous message is removed first and the next one appears after this gap, so a repeated identical message is
// announced again instead of being taken for an unchanged region.
export const ANNOUNCE_GAP_MS = 100;
// Messages arriving within one gap are joined into one announcement; at most this many are kept (the newest win).
export const ANNOUNCE_BATCH = 3;
// While a modal dialog makes the rest of the page inert, delivery waits for it to close, at most this long.
export const ANNOUNCE_MODAL_WAIT_MS = 1500;
const MODAL_POLL_MS = 50;

const regionProps = kind => ({
  key: 'ui-announcer-' + kind, class: 'ui-announcer sr-only', role: kind === 'assertive' ? 'alert' : 'status',
  'aria-live': kind, 'aria-atomic': 'true', [ANNOUNCER_ATTRIBUTE]: kind,
});
/** Both regions as elements of the given `h`; the Options shell renders them once as direct children of `.management-shell`. */
export function announcerRegions(h) { return [h('div', regionProps('polite')), h('div', regionProps('assertive'))]; }

const states = new WeakMap();
function bounded(message) {
  if (typeof message !== 'string') return '';
  let text = message.trim();
  if (text.length > ANNOUNCE_MAX_LENGTH) {
    text = text.slice(0, ANNOUNCE_MAX_LENGTH);
    const last = text.charCodeAt(text.length - 1);
    if (last >= 0xd800 && last <= 0xdbff) text = text.slice(0, -1);
  }
  return text;
}
function regionOf(document, kind) {
  try { return document?.querySelector?.('[' + ANNOUNCER_ATTRIBUTE + '="' + kind + '"]') ?? null; } catch { return null; }
}
// `:modal` matches a dialog opened with showModal(); engines without the selector simply never defer.
function blockingModal(document, region) {
  try { const modal = document.querySelector(':modal'); return modal && !modal.contains(region) ? modal : null; } catch { return null; }
}
function deliver(document, region, state) {
  state.timer = null;
  if (!region.isConnected) { state.pending = []; return; }
  if (state.waited < ANNOUNCE_MODAL_WAIT_MS && blockingModal(document, region)) {
    state.waited += MODAL_POLL_MS; state.timer = setTimeout(() => deliver(document, region, state), MODAL_POLL_MS); return;
  }
  const text = bounded(state.pending.join(' ')); state.pending = []; state.waited = 0;
  if (!text) return;
  const node = document.createElement('div'); node.textContent = text; region.append(node); state.node = node;
  clearTimeout(state.clear); state.clear = setTimeout(() => { node.remove(); if (state.node === node) state.node = null; }, ANNOUNCE_CLEAR_MS);
}

/**
 * Announces `message` (a string; anything else is ignored) in the polite region, or in the assertive one when
 * `assertive` is true. Returns true when the message was queued for a mounted region.
 */
export function announce(message, options) {
  const text = bounded(message);
  if (!text) return false;
  const document = globalThis.document, region = regionOf(document, options?.assertive === true ? 'assertive' : 'polite');
  if (!region) return false;
  let state = states.get(region);
  if (!state) { state = { pending: [], timer: null, clear: null, node: null, waited: 0 }; states.set(region, state); }
  state.pending.push(text);
  if (state.pending.length > ANNOUNCE_BATCH) state.pending.splice(0, state.pending.length - ANNOUNCE_BATCH);
  if (state.timer !== null) return true;
  const shown = state.node !== null && state.node.parentNode === region;
  if (shown) { clearTimeout(state.clear); state.node.remove(); state.node = null; }
  state.waited = 0;
  state.timer = setTimeout(() => deliver(document, region, state), shown ? ANNOUNCE_GAP_MS : 0);
  return true;
}
