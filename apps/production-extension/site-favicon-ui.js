import { SITE_ICON_KEY, readSiteIconCache, siteIconHost } from './site-favicon.js';

// One lazy IPC read and one native storage listener per UI, shared by up to 4096 icons.
export function createSiteIconStore(browserApi, { timeoutMs = 1200 } = {}) {
  const subscribers = new Set(); let snapshot = { state: 'pending', icons: new Map() }, generation = 0, loaded = false, timer;
  const publish = value => { snapshot = value; for (const subscriber of subscribers) { try { subscriber(snapshot); } catch {} } };
  const update = cache => publish({ state: 'ready', icons: new Map(readSiteIconCache(cache).map(entry => [entry.host, entry.png])) });
  const changed = (changes, area) => { if (area === 'local' && Object.hasOwn(changes, SITE_ICON_KEY)) { loaded = true; generation++; clearTimeout(timer); update(changes[SITE_ICON_KEY].newValue); } };
  function start() {
    browserApi.storage.onChanged?.addListener(changed);
    const current = ++generation;
    timer = setTimeout(() => { if (current === generation) { generation++; loaded = true; update(null); } }, Math.min(2500, Math.max(1, timeoutMs)));
    try {
      Promise.resolve(browserApi.storage.local.get(SITE_ICON_KEY)).then(value => {
        if (current === generation) { loaded = true; clearTimeout(timer); update(value[SITE_ICON_KEY]); }
      }, () => { if (current === generation) { loaded = true; clearTimeout(timer); update(null); } });
    } catch { loaded = true; clearTimeout(timer); update(null); }
  }
  return {
    subscribe(subscriber) {
      if (typeof subscriber !== 'function') return () => {};
      if (subscribers.size >= 4096) { subscriber({ state: 'ready', icons: new Map() }); return () => {}; }
      subscribers.add(subscriber);
      if (subscribers.size === 1 && !loaded) start();
      else if (subscribers.size === 1) browserApi.storage.onChanged?.addListener(changed);
      subscriber(snapshot);
      return () => {
        subscribers.delete(subscriber);
        if (subscribers.size === 0) { generation++; clearTimeout(timer); browserApi.storage.onChanged?.removeListener?.(changed); loaded = false; snapshot = { state: 'pending', icons: new Map() }; }
      };
    }
  };
}

export function createSiteIconUi({ h, useState, useEffect, browserApi }) {
  const store = createSiteIconStore(browserApi);
  function SiteIcon({ host, size = 20 }) {
    const normalized = siteIconHost(host), [current, setCurrent] = useState({ host: normalized, png: null, state: normalized ? 'pending' : 'fallback' });
    const value = current.host === normalized ? current : { png: null, state: normalized ? 'pending' : 'fallback' };
    useEffect(() => {
      if (!normalized) return;
      return store.subscribe(snapshot => {
        const png = snapshot.icons.get(normalized) ?? null, state = snapshot.state === 'pending' ? 'pending' : png ? 'ready' : 'fallback';
        setCurrent(previous => previous.host === normalized && previous.png === png && previous.state === state ? previous : { host: normalized, png, state });
      });
    }, [normalized]);
    if (!normalized) return null;
    const width = size === 24 ? 24 : 20;
    return h('span', { class: 'site-icon', 'data-site-icon': normalized, 'data-site-icon-state': value.state, 'aria-hidden': 'true', style: { width, height: width }, children: value.png
      ? h('img', { src: value.png, alt: '', width, height: width, loading: 'eager', decoding: 'async', referrerPolicy: 'no-referrer', onError: () => setCurrent({ host: normalized, png: null, state: 'fallback' }) })
      : h('svg', { viewBox: '0 0 24 24', width, height: width, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.5, focusable: 'false', children: [h('circle', { cx: 12, cy: 12, r: 9 }), h('ellipse', { cx: 12, cy: 12, rx: 4, ry: 9 }), h('path', { d: 'M3 12h18M5 6.5h14M5 17.5h14' })] }) });
  }
  function SiteLabel({ host, label = host, size }) {
    return h('span', { class: 'site-label', dir: 'auto', children: [h(SiteIcon, { host, size }), h('span', { children: label })] });
  }
  return { SiteIcon, SiteLabel };
}

export async function waitForSiteIcons(documentRef = document, timeoutMs = 1800) {
  const delay = Math.min(2500, Math.max(1, timeoutMs));
  return new Promise(resolve => {
    let finished = false, decoding = false;
    const finish = value => { if (finished) return; finished = true; clearTimeout(deadline); clearInterval(poll); resolve(value); };
    const check = async () => {
      if (finished || decoding) return;
      try {
        const icons = [...documentRef.querySelectorAll('[data-site-icon]')];
        if (icons.length > 4096) return finish(false);
        if (icons.some(icon => icon.getAttribute('data-site-icon-state') === 'pending')) return;
        decoding = true;
        const images = icons.flatMap(icon => [...icon.querySelectorAll('img')]);
        const results = await Promise.all(images.map(async image => { if (typeof image.decode === 'function') await image.decode(); return image.complete && image.naturalWidth > 0; }));
        finish(results.every(Boolean));
      } catch { finish(false); }
    };
    const deadline = setTimeout(() => finish(false), delay), poll = setInterval(check, 25); void check();
  });
}
