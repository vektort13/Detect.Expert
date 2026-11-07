// ADR-113: the card of the setting "do not run the observation sensors while Antidetect is on" (Antidetect page, Network level).
// It talks to the service worker with two messages only (ui-sensor-quiet-get / -set), keeps no copy of the setting, and shows what the
// service worker answered: off, waiting for Antidetect, idle (no site in scope) or active. The change applies on the fly to pages opened
// afterwards; the text says so, and says what the setting does not do. It never reads a page and never touches the Antidetect draft.
import { antidetectQuietLabels } from './antidetect-quiet-labels.js';
import { SENSOR_QUIET_KEY, sensorQuietStatus, readSensorQuietState } from './sensor-quiet.js';

const CONFIGURATION_KEY = 'api-configuration:v1';

export function createAntidetectQuietUi({ h, useState, useEffect, useRef, useLocale, browserApi = globalThis.chrome }) {
  const api = globalThis.browser?.runtime?.id === browserApi?.runtime?.id ? globalThis.browser : browserApi;
  async function ask(message) {
    const state = readSensorQuietState(await api.runtime.sendMessage({ schemaVersion: 1, ...message }));
    if (state === null) throw new Error('invalid reply');
    return state;
  }

  function QuietSensorsCard({ active = true }) {
    const labels = antidetectQuietLabels(useLocale());
    const [state, setState] = useState(null), [busy, setBusy] = useState(false), [readFailed, setReadFailed] = useState(false), [writeFailed, setWriteFailed] = useState(false);
    const alive = useRef(false), epoch = useRef(0), writing = useRef(false);
    // A read that is overtaken by a newer read is dropped, and nothing is painted while a write is pending (the read after the write repaints the real state).
    const read = async () => {
      const token = ++epoch.current;
      try {
        const next = await ask({ type: 'ui-sensor-quiet-get' });
        if (alive.current && token === epoch.current && !writing.current) { setState(next); setReadFailed(false); }
      } catch { if (alive.current && token === epoch.current) setReadFailed(true); }
    };
    useEffect(() => {
      alive.current = true;
      const changed = (changes, area) => { if (area === 'local' && (Object.hasOwn(changes, SENSOR_QUIET_KEY) || Object.hasOwn(changes, CONFIGURATION_KEY))) void read(); };
      api.storage?.onChanged?.addListener(changed);
      return () => { alive.current = false; ++epoch.current; api.storage?.onChanged?.removeListener(changed); };
    }, []);
    // The first read happens here (when the page is shown) and again every time the page becomes active; a hidden page asks nothing.
    useEffect(() => { if (active) void read(); }, [active]);

    async function toggle(event) {
      const wanted = event?.currentTarget?.checked === true;
      if (busy || state === null) return;
      writing.current = true; setBusy(true); setWriteFailed(false);
      try { const next = await ask({ type: 'ui-sensor-quiet-set', enabled: wanted }); if (alive.current) setState(next); }
      catch { if (alive.current) setWriteFailed(true); }
      finally { writing.current = false; if (alive.current) { setBusy(false); void read(); } }
    }

    // A failed write stays on screen until the next attempt; the read that follows it repaints the real state under the message.
    const status = readFailed || writeFailed ? 'failed' : state === null ? 'loading' : state.healthy === false ? 'unconfirmed' : sensorQuietStatus(state);
    const text = { loading: labels.status_loading, failed: labels.failed, unconfirmed: labels.status_unconfirmed, off: labels.status_off, waiting: labels.status_waiting, idle: labels.status_idle, active: labels.status_active }[status];
    return h('section', { class: 'antidetect-card antidetect-section', 'aria-labelledby': 'antidetect-quiet-title', 'aria-busy': busy || state === null && !readFailed, 'data-antidetect-quiet': status, children: [
      h('div', { class: 'antidetect-card-heading antidetect-section__heading', children: h('h3', { id: 'antidetect-quiet-title', class: 'antidetect-section__title', children: labels.title }) }),
      h('div', { class: 'antidetect-section__body', children: [
        h('label', { class: 'antidetect-check', children: [
          h('input', { type: 'checkbox', checked: state?.setting === true, disabled: busy || state === null, 'aria-describedby': 'antidetect-quiet-status', 'data-antidetect-quiet-toggle': true, onChange: toggle }),
          h('span', { children: labels.toggle })] }),
        h('p', { id: 'antidetect-quiet-status', class: 'antidetect-note', role: status === 'failed' || status === 'unconfirmed' ? 'alert' : 'status', 'data-antidetect-quiet-status': status, children: text }),
        h('p', { class: 'antidetect-note', 'data-antidetect-quiet-what': true, children: labels.what }),
        h('p', { class: 'antidetect-note', children: labels.effect }),
        h('p', { class: 'antidetect-note', 'data-antidetect-quiet-reload': true, children: labels.reload }),
        h('ul', { class: 'fp-device-card__disclosures', 'data-antidetect-quiet-limits': true, children: [labels.limit_own, labels.limit_other].map((line, index) => h('li', { key: index, children: h('span', { children: line }) })) }),
      ] }),
    ] });
  }
  return { QuietSensorsCard };
}
