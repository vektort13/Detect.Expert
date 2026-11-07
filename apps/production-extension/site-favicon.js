// ADR-035 / REQ-002/005/010/012/013: native-tab favicons, bounded local PNGs only.
export const SITE_ICON_KEY = 'site-icons:v1';
export const SITE_ICON_LIMITS = Object.freeze({ sites: 64, pngBytes: 16384, cacheBytes: 524288, ttlMs: 604800000, jobs: 4, timeoutMs: 2500 });

export function siteIconHost(value) {
  if (typeof value !== 'string' || value.length > 253 || value !== value.toLowerCase() || !/^[a-z0-9.-]+$/.test(value)) return null;
  if (!value.includes('.') || value.includes('..') || value.endsWith('.') || /(?:^|\.)localhost$|\.local$/.test(value) || /^\d+(?:\.\d+){3}$/.test(value)) return null;
  return value.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) ? value : null;
}

export function siteIconPng(value) {
  if (typeof value !== 'string' || !value.startsWith('data:image/png;base64,') || value.length > Math.ceil(SITE_ICON_LIMITS.pngBytes / 3) * 4 + 22) return null;
  const encoded = value.slice(22);
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) return null;
  try {
    const bytes = Uint8Array.from(atob(encoded), character => character.charCodeAt(0));
    if (bytes.length < 57 || bytes.length > SITE_ICON_LIMITS.pngBytes || [137,80,78,71,13,10,26,10].some((byte, index) => bytes[index] !== byte)) return null;
    const view = new DataView(bytes.buffer), types = [], allowed = new Set(['IHDR', 'IDAT', 'IEND']);
    let offset = 8;
    while (offset + 12 <= bytes.length) {
      const length = view.getUint32(offset), type = String.fromCharCode(...bytes.slice(offset + 4, offset + 8));
      if (!allowed.has(type) || length > SITE_ICON_LIMITS.pngBytes || offset + 12 + length > bytes.length) return null;
      if (type === 'IHDR' && (offset !== 8 || length !== 13 || view.getUint32(offset + 8) !== 32 || view.getUint32(offset + 12) !== 32)) return null;
      if (type === 'IEND' && (length !== 0 || offset + 12 !== bytes.length)) return null;
      types.push(type); offset += length + 12;
    }
    if (offset !== bytes.length || types[0] !== 'IHDR' || types.at(-1) !== 'IEND' || !types.includes('IDAT') || types.filter(type => type === 'IHDR').length !== 1) return null;
    return value;
  } catch { return null; }
}

export function readSiteIconCache(value, now = Date.now()) {
  if (!value || typeof value !== 'object' || value.version !== 1 || !Array.isArray(value.entries) || value.entries.length > SITE_ICON_LIMITS.sites) return [];
  const entries = [], seen = new Set(); let bytes = 128;
  for (const row of value.entries) {
    if (!row || typeof row !== 'object' || Reflect.ownKeys(row).length !== 3) continue;
    const host = siteIconHost(row.host), png = siteIconPng(row.png), at = row.at;
    if (!host || !png || !Number.isSafeInteger(at) || at < 0 || at > now + 60000 || now - at > SITE_ICON_LIMITS.ttlMs || seen.has(host)) continue;
    const size = png.length + host.length + 80;
    if (bytes + size > SITE_ICON_LIMITS.cacheBytes) break;
    entries.push({ host, png, at }); seen.add(host); bytes += size;
  }
  return entries.sort((a, b) => b.at - a.at);
}

// Serialized by scripting.executeScript; no closure, page hooks or MAIN messages.
export async function captureNativeSiteFavicon(expectedOrigin, source) {
  if (window.top !== window || location.origin !== expectedOrigin || typeof source !== 'string') return null;
  const dataImage = /^data:image\/(?:png|jpeg|gif|webp|x-icon|vnd\.microsoft\.icon|svg\+xml)(?:;base64)?,/i.test(source);
  const nativeSvg = /^data:image\/svg\+xml(?:;base64)?,/i.test(source);
  if (dataImage) { if (source.length > 65536) return null; }
  else {
    if (source.length > 4096) return null;
    let parsed; try { parsed = new URL(source); } catch { return null; }
    if (!/^https?:$/.test(parsed.protocol) || parsed.username || parsed.password || !/^[a-z0-9.-]+$/i.test(parsed.hostname) || !parsed.hostname.includes('.') || /^\d+(?:\.\d+){3}$/.test(parsed.hostname) || /(?:^|\.)localhost$|\.local$/i.test(parsed.hostname)) return null;
  }
  return new Promise(resolve => {
    const image = new Image(); let settled = false;
    const finish = value => { if (settled) return; settled = true; clearTimeout(timer); image.onload = image.onerror = null; image.src = ''; resolve(value); };
    const timer = setTimeout(() => finish(null), 1800);
    image.crossOrigin = 'anonymous'; image.referrerPolicy = 'no-referrer'; image.decoding = 'async'; image.width = image.height = 32;
    image.onerror = () => finish(null);
    image.onload = () => {
      try {
        if (location.origin !== expectedOrigin || (!image.naturalWidth || !image.naturalHeight) && !nativeSvg || image.naturalWidth > 1024 || image.naturalHeight > 1024) return finish(null);
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 32;
        const context = canvas.getContext('2d'); if (!context) return finish(null);
        const viewportSvg = nativeSvg && (!image.naturalWidth || !image.naturalHeight);
        const sourceWidth = viewportSvg ? 32 : image.naturalWidth, sourceHeight = viewportSvg ? 32 : image.naturalHeight;
        const scale = Math.min(32 / sourceWidth, 32 / sourceHeight), width = sourceWidth * scale, height = sourceHeight * scale;
        context.drawImage(image, (32 - width) / 2, (32 - height) / 2, width, height);
        const png = canvas.toDataURL('image/png'); finish(png.length <= 21870 ? png : null);
      } catch { finish(null); }
    };
    image.src = source;
  });
}

export class SiteFaviconCache {
  constructor(api, { authorize, host, ready = Promise.resolve(), now = Date.now } = {}) {
    this.api = api; this.authorize = authorize; this.host = host; this.ready = ready; this.now = now;
    this.generation = 0; this.tabs = new Map(); this.running = new Map(); this.dirty = new Set(); this.following = new Set(); this.physical = new Set(); this.chain = Promise.resolve();
  }
  async collect(tabId) {
    if (!Number.isSafeInteger(tabId) || tabId < 0) return;
    if (this.running.has(tabId)) { if (!this.following.has(tabId)) this.dirty.add(tabId); return; }
    if (this.running.size >= SITE_ICON_LIMITS.jobs || this.physical.size >= SITE_ICON_LIMITS.jobs) return;
    const generation = this.generation, token = {};
    this.running.set(tabId, token);
    try {
      try { await this.capture(tabId, generation); } catch {}
      if (this.dirty.delete(tabId) && generation === this.generation && this.physical.size < SITE_ICON_LIMITS.jobs) {
        this.following.add(tabId); try { await this.capture(tabId, generation); } catch {}
      }
    } finally { this.following.delete(tabId); this.dirty.delete(tabId); if (this.running.get(tabId) === token) this.running.delete(tabId); }
  }
  async topFrame(tabId) {
    const native = await this.api.webNavigation.getFrame({ tabId, frameId: 0 });
    if (!native || typeof native.url !== 'string' || native.errorOccurred === true || native.documentLifecycle === 'prerender' || native.documentLifecycle === 'cached' || native.documentLifecycle === 'pending_deletion') return null;
    const identity = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value);
    if (native.documentId !== undefined) return identity(native.documentId) ? native : null;
    // ADR-018: Firefox <153 exposes the private ISOLATED identity through the
    // existing getAllFrames adapter. Raw getFrame has no document identity.
    if (typeof this.api.webNavigation.getAllFrames !== 'function') return null;
    const frames = await this.api.webNavigation.getAllFrames({ tabId });
    if (!Array.isArray(frames) || frames.length > 128) return null;
    const tops = frames.filter(frame => frame?.frameId === 0);
    if (tops.length !== 1) return null;
    const top = tops[0];
    return identity(top.documentId) && top.url === native.url && top.errorOccurred !== true && top.documentLifecycle === 'active' ? top : null;
  }
  async capture(tabId, generation) {
    await this.ready;
    const tab = await this.api.tabs.get(tabId);
    if (generation !== this.generation || tab.incognito || tab.discarded || typeof tab.url !== 'string' || typeof tab.favIconUrl !== 'string' || !tab.favIconUrl) return;
    if (tab.favIconUrl.length > (tab.favIconUrl.startsWith('data:image/') ? 65536 : 4096)) return;
    const sourceKey = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(tab.favIconUrl))), byte => byte.toString(16).padStart(2, '0')).join('');
    let origin; try { const url = new URL(tab.url); if (!/^https?:$/.test(url.protocol) || url.username || url.password) return; origin = url.origin; } catch { return; }
    const frame = await this.topFrame(tabId);
    if (!frame || typeof frame.documentId !== 'string' || new URL(frame.url).origin !== origin || frame.documentLifecycle === 'prerender' || frame.documentLifecycle === 'cached') return;
    const host = siteIconHost(this.host?.(frame.url)), allowed = () => generation === this.generation && this.authorize?.({ tabId, frame, origin }) === true;
    if (!host || !allowed()) return;
    const binding = this.tabs.get(tabId), stored = await this.api.storage.local.get(SITE_ICON_KEY);
    if (!allowed()) return;
    const entries = readSiteIconCache(stored[SITE_ICON_KEY], this.now());
    if (binding?.documentId === frame.documentId && binding.sourceKey === sourceKey && entries.some(entry => entry.host === host)) return;
    let timer;
    const operation = this.api.scripting.executeScript({ target: { tabId, frameIds: [0] }, world: 'ISOLATED', func: captureNativeSiteFavicon, args: [origin, tab.favIconUrl] });
    this.physical.add(operation); operation.then(() => this.physical.delete(operation), () => this.physical.delete(operation));
    const results = await Promise.race([operation, new Promise(resolve => { timer = setTimeout(() => resolve(null), SITE_ICON_LIMITS.timeoutMs); })]).finally(() => clearTimeout(timer));
    const png = siteIconPng(results?.find(result => result.frameId === 0)?.result);
    if (!png || !allowed()) return;
    const current = await this.topFrame(tabId), liveTab = await this.api.tabs.get(tabId);
    if (!allowed() || current?.documentId !== frame.documentId || new URL(current.url).origin !== origin || typeof liveTab.url !== 'string' || new URL(liveTab.url).origin !== origin || liveTab.favIconUrl !== tab.favIconUrl || liveTab.incognito) return;
    await this.enqueue(async () => {
      if (!allowed()) return;
      const latest = readSiteIconCache((await this.api.storage.local.get(SITE_ICON_KEY))[SITE_ICON_KEY], this.now());
      if (!allowed()) return;
      const next = readSiteIconCache({ version: 1, entries: [{ host, png, at: this.now() }, ...latest.filter(entry => entry.host !== host)].slice(0, SITE_ICON_LIMITS.sites) }, this.now());
      await this.api.storage.local.set({ [SITE_ICON_KEY]: { version: 1, entries: next } });
      if (!allowed()) { await this.api.storage.local.remove(SITE_ICON_KEY); return; }
      if (this.tabs.size >= 128) this.tabs.clear(); this.tabs.set(tabId, { documentId: frame.documentId, sourceKey });
    });
  }
  enqueue(operation) { const next = this.chain.then(operation, operation); this.chain = next.catch(() => {}); return next; }
  invalidate() { this.generation++; this.tabs.clear(); this.dirty.clear(); return this.enqueue(() => this.api.storage.local.remove(SITE_ICON_KEY)); }
  removed(tabId) { this.tabs.delete(tabId); this.dirty.delete(tabId); }
  async refresh() {
    try {
      await this.ready;
      const generation = this.generation;
      await this.enqueue(async () => {
        const saved = (await this.api.storage.local.get(SITE_ICON_KEY))[SITE_ICON_KEY];
        if (generation !== this.generation || saved === undefined) return;
        const entries = readSiteIconCache(saved, this.now());
        if (saved?.version !== 1 || !Array.isArray(saved.entries) || saved.entries.length !== entries.length) {
          if (entries.length) await this.api.storage.local.set({ [SITE_ICON_KEY]: { version: 1, entries } });
          else await this.api.storage.local.remove(SITE_ICON_KEY);
        }
      });
      const tabs = await this.api.tabs.query({});
      for (const tab of tabs.slice(0, SITE_ICON_LIMITS.sites)) if (typeof tab.id === 'number') await this.collect(tab.id);
    } catch {}
  }
}
