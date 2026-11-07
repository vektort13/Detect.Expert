// DET-CF-PRECURSOR-001 / ADR-074: selected-document resource observation, never a guessed mode.
import { readPrecursorRequest, readPrecursorSnapshot } from './precursor-contracts.js';
import { createPrecursorZoneUi } from './precursor-zone-ui.js';

const POLL_MS = 1000;
const TIMEOUT_MS = 6000;
const UNAVAILABLE_COVERAGE = new Set(['paused', 'no-access', 'unsupported']);
const COVERAGE = new Set(['active', 'partial', 'late-start', 'paused', 'unsupported', 'no-access', 'degraded']);

export function createPrecursorUi({ h, useState, useEffect, useRef, useLocale, browserApi = globalThis.chrome, translate }) {
  const { PrecursorZone } = createPrecursorZoneUi({ h, useState, useEffect, useRef, useLocale, browserApi, translate });
  const text = key => translate('precursor_' + key);
  // Shared by mounts in this UI factory. A timeout or unmount never frees a native request.
  // Only actual settlement releases the single physical transport slot.
  let pending = null;

  function PrecursorPanel({ session, enabled = true }) {
    useLocale?.();
    const request = readPrecursorRequest({ schemaVersion: 1, type: 'ui-get-precursor',
      tabId: session?.tabId, frameId: session?.selectedFrameId, documentKey: session?.report?.documentKey });
    const coverage = COVERAGE.has(session?.report?.coverageState) ? session.report.coverageState : null;
    const observedSince = Number.isSafeInteger(session?.report?.observedSince) ? session.report.observedSince : null;
    const identity = JSON.stringify([request?.documentKey ?? null, observedSince, enabled === true,
      session?.loaded === true, session?.busy === true, coverage]);
    const boundary = useRef({ identity });
    // A -> busy/disabled -> A is a new epoch even when the document key is unchanged.
    if (boundary.current.identity !== identity) boundary.current = { identity };
    const scope = boundary.current;
    const latest = useRef(scope);
    latest.current = scope;
    const [current, setCurrent] = useState({ scope: null, status: 'loading', snapshot: null });
    const blocked = !request ? 'no-site' : !session?.loaded || session?.busy ? 'loading' :
      UNAVAILABLE_COVERAGE.has(coverage) ? coverage : null;
    const eligible = enabled === true && blocked === null;

    useEffect(() => {
      let disposed = false, owned = null, waitTimer = null;
      const isCurrent = () => !disposed && latest.current === scope;
      const publish = (status, snapshot = null) => { if (isCurrent()) setCurrent({ scope, status, snapshot }); };
      if (!eligible) return () => { disposed = true; };
      publish('loading');
      // A request left behind by a previous scope can occupy the transport indefinitely.
      // Show the same bounded loading deadline while waiting, without issuing another request.
      waitTimer = setTimeout(() => publish('unavailable'), TIMEOUT_MS);
      const read = () => {
        if (!isCurrent() || pending !== null) return;
        clearTimeout(waitTimer);
        waitTimer = null;
        const job = { expired: false, timer: null };
        pending = owned = job;
        const settle = (raw, failed) => {
          clearTimeout(job.timer);
          if (pending === job) pending = null;
          if (owned === job) owned = null;
          if (job.expired || !isCurrent()) return;
          const snapshot = failed ? null : readPrecursorSnapshot(raw);
          if (!snapshot || snapshot.documentKey !== request.documentKey) { publish('unavailable'); return; }
          const status = UNAVAILABLE_COVERAGE.has(snapshot.coverageState) ? snapshot.coverageState :
            snapshot.capabilities.presenceDetection ? 'ready' : 'unsupported';
          publish(status, snapshot);
        };
        job.timer = setTimeout(() => { job.expired = true; if (isCurrent()) publish('unavailable'); }, TIMEOUT_MS);
        try {
          // This is the extension's own privileged request Promise, not a page Promise.
          Promise.resolve(browserApi.runtime.sendMessage(request)).then(raw => settle(raw, false), () => settle(null, true));
        } catch { settle(null, true); }
      };
      read();
      const interval = setInterval(read, POLL_MS);
      return () => {
        disposed = true;
        clearInterval(interval);
        clearTimeout(waitTimer);
        if (owned) { owned.expired = true; clearTimeout(owned.timer); }
      };
    }, [scope]);

    if (enabled !== true) return null;
    const value = current.scope === scope ? current : { status: 'loading', snapshot: null };
    const status = blocked ?? value.status;
    const snapshot = status === 'ready' ? value.snapshot : null;
    const presence = snapshot?.presence ?? 'unknown';
    if (presence !== 'observed') return null;
    // Coverage describes this observer, not the parent report's unrelated sensors.
    const resultCoverage = status === 'ready' ? snapshot?.truncated ? 'partial' : snapshot?.coverageState :
      UNAVAILABLE_COVERAGE.has(status) ? status : status === 'unavailable' ? 'degraded' : null;
    const presenceText = status === 'ready' ? text(presence === 'observed' ? 'observed' : 'not_observed') :
      text(({ 'no-site': 'no_site', 'no-access': 'no_access' })[status] ?? status);
    return h('section', { class: 'precursor-panel', 'data-precursor-panel': true,
      'data-precursor-status': status, 'data-precursor-presence': presence, 'data-precursor-mode': 'unknown',
      children: [
        h('div', { class: 'precursor-panel__heading', children: h('strong', { dir: 'ltr', children: text('title') }) }),
        h('div', { class: 'precursor-panel__status', role: 'status', children: [
          h('span', { 'data-precursor-presence-label': true, children: presenceText }),
          resultCoverage ? h('span', { class: 'precursor-panel__coverage', 'data-precursor-coverage': resultCoverage,
            children: translate('status_' + resultCoverage.replaceAll('-', '_')) }) : null
        ] }),
        h('div', { class: 'precursor-panel__mode', 'data-precursor-mode-label': true,
          children: [text('mode'), ': ', text('mode_unknown')] }),
        h(PrecursorZone, { session, enabled, children: null }),
        h('button', { type: 'button', class: 'precursor-panel__configure', 'data-precursor-settings': true,
          onClick: () => { try { Promise.resolve(browserApi.tabs.create({ url: browserApi.runtime.getURL('precursor-settings.html') })).catch(() => {}); } catch {} },
          children: translate('precursor_modes_settings') })
      ] });
  }
  return { PrecursorPanel };
}
