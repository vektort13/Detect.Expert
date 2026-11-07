// ADR-101: explicit owned-window actions; the existing Antidetect master is retained.
import { createFingerprintEngineClient } from './fingerprint-engine-client.js';
import { fingerprintEngineLabels } from './fingerprint-engine-labels.js';

export function createFingerprintEngineUi({ h, useState, useEffect, useRef, useLocale, browserApi = globalThis.chrome, createClient = createFingerprintEngineClient }) {
  function FingerprintEnginePanel({ active = true, revision = null, enabled = false, blocked = false }) {
    const text = fingerprintEngineLabels(useLocale?.()), [url, setUrl] = useState(''), [state, setState] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [certain, setCertain] = useState(false);
    const client = useRef(null), input = useRef(null), epoch = useRef(0), visible = useRef(active), working = useRef(false), latest = useRef(null), urlValue = useRef('');
    visible.current = active;
    latest.current = { active, revision, enabled, blocked };
    const supported = typeof browserApi?.debugger?.attach === 'function';
    const saved = Number.isSafeInteger(revision) && revision >= 0 && !blocked;
    const live = token => visible.current && epoch.current === token;
    const errorKey = code => ['stale-revision', 'profile-changed'].includes(code) ? 'stale' : code === 'profile-conflict' ? 'conflict' : ['scope-denied', 'permission-required', 'inactive'].includes(code) ? 'scope' : code === 'unsupported' ? 'unsupported' : 'failed';
    useEffect(() => {
      const token = ++epoch.current;
      if (!active || !supported) return () => { ++epoch.current; };
      setState(null); setCertain(false); setError(''); setBusy(true); working.current = true;
      const owner = createClient(browserApi, { onChange: value => { if (live(token)) setState(value); }, onDisconnect: () => { if (live(token)) { const interrupted = working.current; setCertain(false); setBusy(false); working.current = false; setError(interrupted ? 'failed' : ''); } } });
      client.current = owner;
      owner.load().then(value => { if (live(token)) { setState(value); setCertain(true); } }, failure => { if (live(token)) setError(errorKey(failure?.code)); }).finally(() => { if (live(token)) { setBusy(false); working.current = false; } });
      return () => { ++epoch.current; if (client.current === owner) client.current = null; owner.dispose(); working.current = false; };
    }, [active, supported]);
    async function act(kind, event) {
      event?.preventDefault();
      const owner = client.current, token = epoch.current;
      const props = latest.current;
      if (!owner || !visible.current || !props.active || working.current || kind === 'start' && (props.blocked || !Number.isSafeInteger(props.revision) || !props.enabled || certain && (state?.sessionOpen || ['starting', 'stopping'].includes(state?.status)))) return;
      working.current = true; setBusy(true); setError('');
      try {
        const requestedUrl = urlValue.current, requestedRevision = props.revision;
        if (kind === 'start' && (!certain || !owner.isCertain())) {
          // The user starts a new action. First reconcile a lost/idle port;
          // an unknown timed-out Start is never automatically repeated.
          const observed = await owner.recover();
          if (!live(token) || client.current !== owner) return;
          setState(observed); setCertain(true);
          if (!observed.supported || observed.sessionOpen || ['starting', 'stopping'].includes(observed.status)) return;
          const current = latest.current;
          if (!current.active || current.blocked || !current.enabled || current.revision !== requestedRevision || urlValue.current !== requestedUrl) { setError('stale'); return; }
        }
        const value = await (kind === 'start' ? owner.start(requestedUrl, requestedRevision) : kind === 'stop' ? owner.stop() : owner.recover());
        if (live(token)) { setState(value); setCertain(true); }
      } catch (failure) {
        if (live(token)) { setError(errorKey(failure?.code)); setCertain(owner.isCertain()); if (kind === 'start' && failure?.code === 'invalid-input') input.current?.focus(); }
      } finally { if (live(token)) { working.current = false; setBusy(false); } }
    }
    const partial = state?.partial || state?.native.status === 'partial';
    const label = !supported || state?.supported === false ? text.unsupported : !certain ? '—' : ['starting', 'stopping'].includes(state?.status) ? '…' : state?.status === 'detached' || state?.status === 'stopped' ? text.detached : state?.status === 'error' ? text.failed : state?.sessionOpen ? partial ? text.partial : text.running : state ? text.ready : '—';
    return h('section', { class: 'antidetect-card fingerprint-engine', 'data-fingerprint-engine': true, 'aria-busy': busy, children: [
      h('div', { class: 'fingerprint-engine__heading', children: [h('h3', { children: [h('svg', { width: 21, height: 21, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.6, 'aria-hidden': true, focusable: false, children: h('path', { d: 'M3 4h18v16H3ZM3 9h18M6 6.5h.01M9 6.5h.01M8 13l-2 2 2 2m8-4 2 2-2 2' }) }), h('span', { children: text.title })] }), h('span', { class: 'fingerprint-engine__status', role: 'status', 'data-fingerprint-engine-status': !supported ? 'unsupported' : !certain ? 'unknown' : state?.status ?? 'unknown', children: label })] }),
      h('form', { class: 'fingerprint-engine__form', onSubmit: event => act('start', event), children: [
        h('label', { class: 'antidetect-field fingerprint-engine__url', children: [h('span', { children: text.url }), h('input', { type: 'url', inputMode: 'url', dir: 'ltr', value: url, maxLength: 4096, required: true, autoComplete: 'off', spellCheck: false, disabled: !supported || busy || !active, ref: input, 'data-fingerprint-engine-url': true, onInput: event => { urlValue.current = event.currentTarget.value; setUrl(urlValue.current); } })] }),
        h('div', { class: 'fingerprint-engine__actions', children: [
          h('button', { type: 'submit', class: 'button button--primary', disabled: !supported || !active || busy || !saved || !enabled || certain && (state?.sessionOpen === true || ['starting', 'stopping'].includes(state?.status)), 'data-fingerprint-engine-start': true, children: text.start }),
          h('button', { type: 'button', class: 'button', disabled: !supported || !active || busy || !client.current || certain && !state?.sessionOpen, 'data-fingerprint-engine-close': true, onClick: event => act('stop', event), children: text.close }),
          h('button', { type: 'button', class: 'button button--text', disabled: !supported || !active || busy, 'data-fingerprint-engine-refresh': true, onClick: event => act('refresh', event), children: text.refresh }),
        ] }),
      ] }),
      supported && !saved ? h('p', { class: 'antidetect-note', role: 'status', 'data-fingerprint-engine-save': true, children: text.save }) : null,
      state?.sessionOpen ? h('p', { class: 'fingerprint-engine__workers', children: [text.workers, ': ', h('strong', { dir: 'ltr', 'data-fingerprint-engine-workers': true, children: String(state.native.bootstrappedWorkers) })] }) : null,
      state?.unsupportedFields.length ? h('details', { class: 'fingerprint-engine__fields', children: [h('summary', { children: text.unsupportedFields }), h('ul', { children: state.unsupportedFields.map(row => h('li', { key: row.id, children: h('code', { dir: 'ltr', children: row.id + ': ' + row.fields.join(', ') }) })) })] }) : null,
      error ? h('p', { class: 'fingerprint-engine__error', role: 'alert', 'data-fingerprint-engine-error': true, children: text[error] ?? text.failed }) : null,
    ] });
  }
  return { FingerprintEnginePanel };
}
