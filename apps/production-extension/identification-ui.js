// UI projections for the selected document. Browser identities stay in the privileged request.
import { redesignLabels } from "./redesign-labels.js";
import { readCookieSnapshot, readCookieView, readCookieValueResult, readClearCookiesResult, readTagManagerDocuments, readSocialSnapshot, readSocialDocuments } from "./inspection-contracts.js";
import { createCompanyUi } from "./company-ui.js";
import { localizeCookiePurpose, localizeCookiePurposeText } from "./cookie-purpose-localization.js";
import { readThirdPartySnapshot } from "./third-party-contracts.js";
import { readCookieWriterSnapshot, readCookieWriterDocuments } from "./cookie-writers-contracts.js";

const TECHNIQUE_ID = /^DET-\d{3}$/;
const COOKIE_READ_TIMEOUT_MS = 6000;
const COOKIE_CLEAR_TIMEOUT_MS = 15000;
const COOKIE_VALUE_TIMEOUT_MS = 6000;
const COOKIE_STALE_RETRY_DELAYS = [150, 300, 600];
const PANELS = ["active", "passive", "third-party", "cookie", "social", "beacons", "background"];
const PANEL_KEYS = {
  active: "identification_active",
  passive: "identification_passive",
  "third-party": "identification_third_party",
  cookie: "identification_cookie", social: "identification_social", beacons: "beacon_title", background: "background_title"
};
// Decorative local geometry; labels and counts remain the accessible tab content.
const PANEL_ICONS = {
  active: [
    ["path", { d: "M5 10a7 7 0 0 1 14 0M8 11a4 4 0 0 1 8 0v3a11 11 0 0 1-2 6M11 20a15 15 0 0 0 2-8 1 1 0 0 0-2 0v2a11 11 0 0 1-2 6M5 13a18 18 0 0 1-1 6M8 14a14 14 0 0 1-1 5M19 13v2a15 15 0 0 1-1 5" }]
  ],
  passive: [
    ["path", { d: "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" }],
    ["circle", { cx: 12, cy: 12, r: 3 }]
  ],
  "third-party": [
    ["path", { d: "M12 7v4M5 16v-5h14v5" }],
    ["circle", { cx: 12, cy: 4, r: 3 }],
    ["circle", { cx: 5, cy: 19, r: 3 }],
    ["circle", { cx: 19, cy: 19, r: 3 }]
  ],
  cookie: [
    ["path", { d: "M21 12a9 9 0 1 1-9-9 5 5 0 0 0 5 5 4 4 0 0 0 4 4Z" }],
    ["circle", { cx: 8, cy: 9, r: .8, fill: "currentColor", stroke: "none" }],
    ["circle", { cx: 7, cy: 15, r: .8, fill: "currentColor", stroke: "none" }],
    ["circle", { cx: 13, cy: 13, r: .8, fill: "currentColor", stroke: "none" }],
    ["circle", { cx: 14, cy: 18, r: .8, fill: "currentColor", stroke: "none" }]
  ],
  social: [
    ["circle", { cx: 9, cy: 8, r: 3 }],
    ["path", { d: "M3 21v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6M21 21v-2a6 6 0 0 0-3-5.2" }]
  ],
  beacons: [
    ["circle", { cx: 12, cy: 12, r: 2 }],
    ["path", { d: "M7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4M5 5a10 10 0 0 0 0 14M19 5a10 10 0 0 1 0 14" }]
  ],
  background: [
    ["path", { d: "M6 7V4a1 1 0 0 1 1-1h13a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1h-3M4 7h12a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1ZM3 11h14M7 15l2 2-2 2M12 19h2" }]
  ]
};
const SERVICE_NAMES = Object.freeze({
  'google-tag-manager': 'Google Tag Manager', 'google-analytics': 'Google Analytics', 'google-ads': 'Google Ads',
  'facebook-pixel': 'Facebook Pixel', hotjar: 'Hotjar', criteo: 'Criteo', 'microsoft-clarity': 'Microsoft Clarity',
  'tiktok-pixel': 'TikTok Pixel', 'linkedin-insight': 'LinkedIn Insight', 'bing-uet': 'Microsoft Advertising UET'
});
const SOCIAL_NAMES = Object.freeze({ facebook: 'Facebook', instagram: 'Instagram', x: 'X', linkedin: 'LinkedIn', tiktok: 'TikTok', snapchat: 'Snapchat', pinterest: 'Pinterest', reddit: 'Reddit', discord: 'Discord', twitch: 'Twitch', youtube: 'YouTube', github: 'GitHub', gitlab: 'GitLab', vk: 'VK', ok: 'OK', weibo: 'Weibo', qq: 'QQ', telegram: 'Telegram', line: 'LINE', google: 'Google', microsoft: 'Microsoft', apple: 'Apple', spotify: 'Spotify', steam: 'Steam', yahoo: 'Yahoo', tumblr: 'Tumblr', quora: 'Quora', disqus: 'Disqus', yandex: 'Yandex', mailru: 'Mail.ru', kakao: 'Kakao', naver: 'NAVER', baidu: 'Baidu', bluesky: 'Bluesky', sharethis: 'ShareThis', douyin: 'Douyin', wechat: 'WeChat', mastodon: 'Mastodon', addthis: 'AddThis', whatsapp: 'WhatsApp', viber: 'Viber', threads: 'Threads', vimeo: 'Vimeo', dailymotion: 'Dailymotion', soundcloud: 'SoundCloud' });
const socialServiceCount = rows => new Set(rows.filter(row => row.service !== 'unknown').map(row => row.service)).size;
const socialTrackingRow = row => row.kind === 'tracking-sdk' || row.kind === 'tracking-pixel';
const socialTrackingServiceCount = rows => socialServiceCount(rows.filter(socialTrackingRow));

function addTechnique(target, id) {
  if (typeof id === "string" && TECHNIQUE_ID.test(id)) target.add(id);
}

function isStaleRevision(raw) {
  return raw !== null && typeof raw === "object" && !Array.isArray(raw) &&
    Object.getOwnPropertyDescriptor(raw, "schemaVersion")?.value === 1 &&
    Object.getOwnPropertyDescriptor(raw, "type")?.value === "error" &&
    Object.getOwnPropertyDescriptor(raw, "code")?.value === "stale-revision";
}

export function displayCookieValue(value) {
  // Keep controls and directional overrides visible without interpreting the cookie bytes.
  return value.replace(/[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu,
    character => "\\u" + character.charCodeAt(0).toString(16).padStart(4, "0"));
}

export function identificationCounts(report, selectedFrameId, frames, overviews, operationDefinition) {
  const active = new Set(), passive = new Set(), children = new Set();
  for (const row of (report?.techniques ?? []).slice(0, 128)) {
    if (row.count > 0) {
      addTechnique(passive, row.techniqueId);
      if (selectedFrameId > 0) addTechnique(children, row.techniqueId);
    }
  }
  for (const row of (report?.apiOperations ?? []).slice(0, 512)) {
    if (row.count > 0) addTechnique(active, operationDefinition(row.apiOperation)?.techniqueId);
  }
  for (const frame of (overviews ?? []).slice(0, 32)) {
    if (frame.frameId <= 0 || frame.frameId === selectedFrameId ||
        !(frames ?? []).some((current) => current.frameId === frame.frameId && current.documentKey === frame.documentKey)) continue;
    for (const id of (frame.techniqueIds ?? []).slice(0, 128)) addTechnique(children, id);
  }
  return { active: active.size, passive: passive.size, "third-party": children.size };
}

// Cross-site rows with requests; browser-observed rows win over page Resource Timing of the same document.
function admittedThirdPartyRows(state) {
  const rows = (state?.rows ?? []).slice(0, 1024);
  const browserDocuments = new Set(rows.filter(row => row.evidenceSource === "browser-network").map(row => row.documentKey));
  return rows.filter(row => row.relation === "cross-site" && row.requestCount > 0 && (row.evidenceSource === "browser-network" || !browserDocuments.has(row.documentKey)));
}

export function thirdPartyTotals(state) {
  const domains = new Set(); let requests = 0, resources = 0;
  for (const row of admittedThirdPartyRows(state)) {
    domains.add(row.domain); ++resources;
    requests = Math.min(2147483647, requests + row.requestCount);
  }
  return { requests, domains: domains.size, resources };
}

// ADR-103: the Third Party panel leads with request kinds (like the technique list) and domains.
export function thirdPartyGroups(state) {
  const add = (a, b) => Math.min(2147483647, a + b), types = new Map(), domains = new Map();
  for (const row of admittedThirdPartyRows(state)) {
    const type = types.get(row.type) ?? { type: row.type, requests: 0, domains: new Map() };
    type.requests = add(type.requests, row.requestCount); type.domains.set(row.domain, add(type.domains.get(row.domain) ?? 0, row.requestCount)); types.set(row.type, type);
    const domain = domains.get(row.domain) ?? { domain: row.domain, requests: 0, types: [] };
    domain.requests = add(domain.requests, row.requestCount); if (!domain.types.includes(row.type)) domain.types.push(row.type); domains.set(row.domain, domain);
  }
  const order = (a, b) => b.requests - a.requests || String(a.domain ?? a.type).localeCompare(String(b.domain ?? b.type));
  return {
    types: [...types.values()].map(group => ({ type: group.type, requests: group.requests, domains: [...group.domains].map(([domain, requests]) => ({ domain, requests })).sort(order) })).sort(order),
    domains: [...domains.values()].sort(order)
  };
}

// Decorative local geometry for request kinds; the localized kind name stays the accessible text.
const THIRD_PARTY_TYPE_ICONS = {
  image: [["rect", { x: 3, y: 5, width: 18, height: 14, rx: 2 }], ["circle", { cx: 9, cy: 10, r: 1.6 }], ["path", { d: "m21 16-5-5-9 8" }]],
  script: [["path", { d: "m8 8-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14" }]],
  xmlhttprequest: [["path", { d: "M4 8h13l-3-3M20 16H7l3 3" }]],
  ping: [["circle", { cx: 12, cy: 12, r: 1.5 }], ["path", { d: "M8.5 15.5a5 5 0 0 1 0-7M15.5 8.5a5 5 0 0 1 0 7M5.6 18.4a9 9 0 0 1 0-12.8M18.4 5.6a9 9 0 0 1 0 12.8" }]],
  sub_frame: [["rect", { x: 3, y: 4, width: 18, height: 16, rx: 2 }], ["path", { d: "M3 9h18M8 13h8M8 16h5" }]],
  stylesheet: [["path", { d: "M5 4h14v6H5zM12 10v3M10 13h4v7h-4z" }]],
  font: [["path", { d: "M4 7V5h10v2M9 5v14M7 19h4M14 12v-1h6v1M17 11v8M15.5 19h3" }]],
  media: [["circle", { cx: 12, cy: 12, r: 9 }], ["path", { d: "m10 8.5 5.5 3.5-5.5 3.5Z" }]],
  websocket: [["path", { d: "M9 7V3M15 7V3M7 7h10v4a5 5 0 0 1-10 0V7ZM12 16v5" }]],
  csp_report: [["path", { d: "M12 3 5 6v6c0 4.5 3 7.5 7 9 4-1.5 7-4.5 7-9V6Z" }]],
  other: [["path", { d: "M21 8 12 3 3 8v8l9 5 9-5ZM3 8l9 5 9-5M12 13v8" }]]
};
THIRD_PARTY_TYPE_ICONS.webtransport = THIRD_PARTY_TYPE_ICONS.websocket;
THIRD_PARTY_TYPE_ICONS.object = THIRD_PARTY_TYPE_ICONS.webbundle = THIRD_PARTY_TYPE_ICONS.other;

export function createIdentificationUi({ h, useState, useEffect, useRef, useLocale, translate, browserApi = globalThis.chrome }) {
  const { CompanyLabel } = createCompanyUi({ h });
  const text = (key, substitutions = []) => translate(key, substitutions);
  const ownerText = owner => owner.startsWith("Vendor declaration: ") ? text("cookie_vendor_declaration", [owner.slice(20)]) : owner || text("cookie_company_unknown");
  const purposeText = entry => {
    const prefix = "Catalogue name match: ";
    if (!entry.purpose.startsWith(prefix)) return localizeCookiePurpose(entry, translate) ?? entry.purpose;
    return entry.purpose.slice(prefix.length).split(/; (?=[^;]+ — )/).map(part => {
      const index = part.indexOf(" — ");
      return index < 0 ? part : part.slice(0, index + 3) + (localizeCookiePurposeText(part.slice(index + 3), translate) ?? part.slice(index + 3));
    }).join("; ");
  };
  const dateText = (milliseconds, locale) => {
    try { return new Intl.DateTimeFormat(({ zh_CN: "zh-CN", pt_BR: "pt-BR", yue: "zh-CN", wuu: "zh-CN" })[locale] ?? locale ?? "en", { dateStyle: "medium", timeStyle: "medium" }).format(milliseconds); } catch { return "—"; }
  };
  const panelId = (prefix, panel) => prefix + "-panel-" + panel;
  const tabId = (prefix, panel) => prefix + "-tab-" + panel;

  function IdentificationNavigation({ prefix, active, onSelect, counts, cookieState, socialState = null, thirdPartyState = undefined, beaconState = null, backgroundState = null }) {
    const locale = useLocale();
    const select = (panel, focus) => {
      onSelect(panel);
      if (focus) document.getElementById(tabId(prefix, panel))?.focus();
    };
    return h("div", { class: "identification-tabs", role: "tablist", "aria-label": redesignLabels(locale).observed, "data-zero-label": redesignLabels(locale).notObserved, children: PANELS.map((panel, index) => {
      const selected = panel === active, count = panel === "cookie" ? cookieState?.trackingCount ?? 0 : panel === "social" ? socialServiceCount(socialState?.rows ?? []) : panel === "beacons" ? beaconState?.requestCount ?? 0 : panel === "background" ? new Set((backgroundState?.rows ?? []).map(row => row.operation)).size : panel === "third-party" && thirdPartyState !== undefined ? thirdPartyTotals(thirdPartyState).requests : counts[panel];
      return h("button", {
        type: "button", role: "tab", id: tabId(prefix, panel), class: "identification-tab" + (selected ? " identification-tab--active" : ""),
        "data-identification-tab": panel, "aria-selected": selected, "aria-controls": panelId(prefix, panel), tabIndex: selected ? 0 : -1,
        onClick: () => select(panel, false),
        onKeyDown: (event) => {
          let next;
          const rtl = document.documentElement.dir === "rtl";
          if (event.key === "Home") next = 0;
          else if (event.key === "End") next = PANELS.length - 1;
          else if (event.key === "ArrowRight" || event.key === "ArrowLeft") next = (index + (event.key === "ArrowRight" !== rtl ? 1 : -1) + PANELS.length) % PANELS.length;
          else if (event.key === "ArrowDown" || event.key === "ArrowUp") next = (index + (event.key === "ArrowDown" ? 1 : -1) + PANELS.length) % PANELS.length;
          if (next !== undefined) { event.preventDefault(); select(PANELS[next], true); }
        },
        children: [
          h("span", { class: "identification-tab__icon", "data-identification-icon": panel, "aria-hidden": "true", children:
            h("svg", { width: 20, height: 20, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": 1.7, "stroke-linecap": "round", "stroke-linejoin": "round", focusable: "false", children: PANEL_ICONS[panel].map(([tag, props]) => h(tag, props)) }) }),
          h("span", { class: "identification-tab__label", children: panel === "cookie" && cookieState?.permission === "granted" ? text("cookie_tab_total", [(cookieState.truncated ? "≥" : "") + String(cookieState.totalCount ?? cookieState.entries.length)]) : text(PANEL_KEYS[panel]) }),
          h("span", { class: "identification-tab__count" + (count === 0 ? " identification-tab__count--empty" : ""), "data-identification-count": panel,
            "aria-label": text(panel === "cookie" ? "cookie_tracking_count" : panel === "social" ? "social_service_count" : panel === "beacons" ? "beacon_total" : panel === "third-party" && thirdPartyState !== undefined ? "third_party_requests_badge" : "identification_technique_count", [String(count)]), children: count })
        ]
      });
    }) });
  }

  function useCookies(session, visible) {
    const documentKey = session.report?.documentKey ?? null, tabId = session.tabId, frameId = session.selectedFrameId;
    const coverage = session.report?.coverageState;
    const identity = documentKey === null ? "" : String(tabId) + ":" + String(frameId) + ":" + documentKey + ":" + String(session.report?.observedSince ?? "none");
    const [current, setCurrent] = useState({ identity: "", state: null, handles: [], pending: false, unavailable: false });
    const generation = useRef(0);
    const wasVisible = useRef(visible);
    const mounted = useRef(false);
    const clearJob = useRef(null);
    const latest = useRef(null);
    const panelVisible = useRef(visible);
    panelVisible.current = visible;
    const valueGeneration = useRef(0);
    const valueJob = useRef(null);
    const [valueBusy, setValueBusy] = useState(false);
    const [valueState, setValueState] = useState({ identity: "", index: null, handle: null, value: null, pending: false, unavailable: false, truncated: false });
    const [clearState, setClearState] = useState({ identity: "", pending: false, result: null, unavailable: false });
    const eligible = session.loaded && !session.busy && tabId !== null && documentKey !== null;
    const resetValue = () => {
      ++valueGeneration.current;
      setValueState({ identity: "", index: null, handle: null, value: null, pending: false, unavailable: false, truncated: false });
    };
    const read = async (grant = false) => {
      if (!eligible || !mounted.current || clearJob.current) return;
      resetValue();
      const token = ++generation.current;
      setCurrent((previous) => ({ identity, state: previous.identity === identity ? previous.state : null, pending: true, unavailable: false }));
      let timer, retryTimer;
      try {
        // The permission API is invoked before the first await, directly from the click handler.
        if (grant) {
          if (!browserApi.permissions?.request) throw new Error("unsupported");
          const granted = await browserApi.permissions.request({ permissions: ["cookies"] });
          if (token !== generation.current) return;
          if (!granted) { if (token === generation.current) setCurrent((previous) => ({ ...previous, pending: false })); return; }
        }
        const deadline = Date.now() + COOKIE_READ_TIMEOUT_MS;
        for (let attempt = 0; attempt <= COOKIE_STALE_RETRY_DELAYS.length; attempt++) {
          if (token !== generation.current) return;
          const remaining = deadline - Date.now();
          if (remaining <= 0) break;
          const raw = await Promise.race([
            browserApi.runtime.sendMessage({ schemaVersion: 1, type: panelVisible.current ? "ui-get-cookie-view" : "ui-get-cookies", tabId, frameId, documentKey }),
            new Promise((resolve) => { timer = setTimeout(() => resolve(null), remaining); })
          ]);
          clearTimeout(timer); timer = undefined;
          if (token !== generation.current) return;
          // Optional permission events may arrive before the background finishes its access revision.
          if (isStaleRevision(raw) && attempt < COOKIE_STALE_RETRY_DELAYS.length) {
            const delay = Math.min(COOKIE_STALE_RETRY_DELAYS[attempt], Math.max(0, deadline - Date.now()));
            await new Promise((resolve) => { retryTimer = setTimeout(resolve, delay); });
            retryTimer = undefined;
            continue;
          }
          const view = readCookieView(raw);
          const state = view?.snapshot ?? readCookieSnapshot(raw);
          setCurrent({ identity, state: state?.documentKey === documentKey ? state : null, handles: view?.snapshot.documentKey === documentKey ? view.handles : [], pending: false, unavailable: !state || state.documentKey !== documentKey });
          return;
        }
        if (token === generation.current) setCurrent({ identity, state: null, handles: [], pending: false, unavailable: true });
      } catch {
        if (token === generation.current) setCurrent({ identity, state: null, handles: [], pending: false, unavailable: true });
      } finally {
        if (timer !== undefined) clearTimeout(timer);
        if (retryTimer !== undefined) clearTimeout(retryTimer);
      }
    };
    latest.current = { identity, read };
    const showValue = async index => {
      if (!eligible || ["paused", "no-access", "unsupported"].includes(coverage) || !mounted.current || !panelVisible.current || clearJob.current || valueJob.current || current.pending ||
          current.identity !== identity || current.state?.permission !== "granted" || !["active", "partial"].includes(current.state.coverageState) ||
          !Number.isInteger(index) || index < 0 || index >= current.state.entries.length) return;
      const handle = current.handles[index];
      if (typeof handle !== "string" || !/^[a-f0-9]{32}$/.test(handle)) return;
      const job = {}, token = ++valueGeneration.current;
      valueJob.current = job;
      setValueBusy(true);
      setValueState({ identity, index, handle, value: null, pending: true, unavailable: false, truncated: false });
      let timer;
      try {
        const raw = await Promise.race([
          browserApi.runtime.sendMessage({ schemaVersion: 1, type: "ui-get-cookie-value", tabId, frameId, documentKey, handle }),
          new Promise(resolve => { timer = setTimeout(() => resolve(null), COOKIE_VALUE_TIMEOUT_MS); })
        ]);
        if (!mounted.current || !panelVisible.current || token !== valueGeneration.current || latest.current?.identity !== identity) return;
        const result = readCookieValueResult(raw);
        if (!result || result.documentKey !== documentKey || result.handle !== handle) {
          setValueState({ identity, index, handle, value: null, pending: false, unavailable: true, truncated: false });
          return;
        }
        setValueState({ identity, index, handle, value: result.value, pending: false, unavailable: false, truncated: result.truncated });
      } catch {
        if (mounted.current && panelVisible.current && token === valueGeneration.current && latest.current?.identity === identity)
          setValueState({ identity, index, handle, value: null, pending: false, unavailable: true, truncated: false });
      } finally {
        if (timer !== undefined) clearTimeout(timer);
        if (valueJob.current === job) { valueJob.current = null; if (mounted.current) setValueBusy(false); }
      }
    };
    const clear = async () => {
      if (!eligible || !mounted.current || clearJob.current || current.identity !== identity || current.state?.permission !== "granted" || !["active", "partial"].includes(current.state.coverageState)) return;
      const job = {}, token = ++generation.current;
      resetValue();
      clearJob.current = job;
      setCurrent(previous => ({ ...previous, pending: false }));
      setClearState({ identity, pending: true, result: null, unavailable: false });
      let timer, refresh = false;
      try {
        // One destructive command per click; no permission prompt or destructive retry.
        const raw = await Promise.race([
          browserApi.runtime.sendMessage({ schemaVersion: 1, type: "ui-clear-site-cookies", tabId, frameId, documentKey }),
          new Promise(resolve => { timer = setTimeout(() => resolve(null), COOKIE_CLEAR_TIMEOUT_MS); })
        ]);
        if (!mounted.current || token !== generation.current) return;
        const result = readClearCookiesResult(raw);
        if (!result || result.documentKey !== documentKey) {
          setClearState({ identity, pending: false, result: null, unavailable: true });
          return;
        }
        setClearState({ identity, pending: false, result, unavailable: false });
        refresh = true;
      } catch {
        if (mounted.current && token === generation.current) setClearState({ identity, pending: false, result: null, unavailable: true });
      } finally {
        if (timer !== undefined) clearTimeout(timer);
        if (clearJob.current === job) clearJob.current = null;
        if (mounted.current && (refresh || token !== generation.current)) {
          // Effects invalidated by navigation/permission events read the current document after the command settles.
          await latest.current?.read();
        }
      }
    };
    useEffect(() => {
      mounted.current = true;
      ++generation.current;
      resetValue();
      setClearState({ identity, pending: false, result: null, unavailable: false });
      setCurrent((previous) => previous.identity === identity && eligible && !["paused", "no-access", "unsupported"].includes(coverage) ? previous : { identity, state: null, handles: [], pending: false, unavailable: false });
      if (eligible) read();
      return () => { mounted.current = false; ++generation.current; ++valueGeneration.current; };
    }, [identity, eligible, coverage]);
    useEffect(() => {
      const opening = visible && !wasVisible.current;
      wasVisible.current = visible;
      if (!visible) resetValue();
      if (opening && eligible) read();
    }, [visible]);
    useEffect(() => {
      const changed = (change) => {
        if (!change.permissions?.includes("cookies") && !(Array.isArray(change.origins) && change.origins.length)) return;
        ++generation.current;
        resetValue();
        setCurrent({ identity, state: null, handles: [], pending: false, unavailable: false });
        setClearState({ identity, pending: false, result: null, unavailable: false });
        if (eligible) read();
      };
      const removed = browserApi.permissions?.onRemoved, added = browserApi.permissions?.onAdded;
      removed?.addListener(changed); added?.addListener(changed);
      return () => { removed?.removeListener(changed); added?.removeListener(changed); };
    }, [identity, eligible]);
    useEffect(() => {
      const hidden = () => { if (globalThis.document?.visibilityState === "hidden") resetValue(); };
      globalThis.addEventListener?.("beforeprint", resetValue);
      globalThis.document?.addEventListener?.("visibilitychange", hidden);
      return () => {
        globalThis.removeEventListener?.("beforeprint", resetValue);
        globalThis.document?.removeEventListener?.("visibilitychange", hidden);
      };
    }, [identity]);
    return { state: current.identity === identity ? current.state : null, pending: current.identity === identity && current.pending,
      unavailable: current.identity === identity && current.unavailable, refresh: () => read(), grant: () => read(true), clear,
      handles: current.identity === identity ? current.handles : [], showValue, hideValue: resetValue,
      valueState: eligible && !["paused", "no-access", "unsupported"].includes(coverage) && panelVisible.current && valueState.identity === identity ? valueState : null, valueBusy,
      busy: clearJob.current !== null, clearing: clearState.identity === identity && clearState.pending,
      clearResult: clearState.identity === identity ? clearState.result : null, clearUnavailable: clearState.identity === identity && clearState.unavailable };
  }

  function useSocial(session, visible) {
    const documentKey = session.report?.documentKey ?? null, tabId = session.tabId, frameId = session.selectedFrameId;
    const coverage = session.report?.coverageState;
    const identity = documentKey === null ? "" : tabId + ":" + frameId + ":" + documentKey + ":" + (session.report?.observedSince ?? "none");
    const eligible = session.loaded && !session.busy && tabId !== null && documentKey !== null && !["paused", "no-access", "unsupported"].includes(coverage);
    const [current, setCurrent] = useState({ identity: "", state: null, pending: false });
    const generation = useRef(0), mounted = useRef(false), job = useRef(null), latest = useRef(null);
    const read = async () => {
      if (!eligible || !mounted.current || job.current) return;
      const token = ++generation.current, operation = {};
      job.current = operation;
      setCurrent(previous => ({ identity, state: previous.identity === identity ? previous.state : null, pending: true }));
      let timer;
      try {
        const raw = await Promise.race([browserApi.runtime.sendMessage({ schemaVersion: 1, type: "ui-get-social-networks", tabId, frameId, documentKey }),
          new Promise(resolve => { timer = setTimeout(() => resolve(null), COOKIE_READ_TIMEOUT_MS); })]);
        if (!mounted.current || token !== generation.current || latest.current?.identity !== identity) return;
        const state = readSocialSnapshot(raw);
        setCurrent({ identity, state: state?.documentKey === documentKey ? state : null, pending: false });
      } catch {
        if (mounted.current && token === generation.current) setCurrent({ identity, state: null, pending: false });
      } finally { clearTimeout(timer); if (job.current === operation) job.current = null; }
    };
    latest.current = { identity, read };
    useEffect(() => {
      mounted.current = true; ++generation.current;
      setCurrent({ identity, state: null, pending: false });
      if (eligible) read();
      // Hidden tabs also refresh their service badge; one owned request at a time.
      const timer = eligible ? setInterval(() => latest.current?.read(), 5000) : null;
      return () => { mounted.current = false; ++generation.current; if (timer !== null) clearInterval(timer); };
    }, [identity, eligible, coverage]);
    useEffect(() => { if (visible) latest.current?.read(); }, [visible]);
    useEffect(() => {
      const changed = () => { ++generation.current; setCurrent({ identity, state: null, pending: false }); latest.current?.read(); };
      const removed = browserApi.permissions?.onRemoved, added = browserApi.permissions?.onAdded;
      removed?.addListener(changed); added?.addListener(changed);
      return () => { removed?.removeListener(changed); added?.removeListener(changed); };
    }, [identity, eligible]);
    return { state: eligible && current.identity === identity ? current.state : null, pending: current.identity === identity && current.pending, refresh: read };
  }

  function useCookieWriters(session, visible) {
    const documentKey = session.report?.documentKey ?? null, tabId = session.tabId, frameId = session.selectedFrameId;
    const coverage = session.report?.coverageState;
    const identity = documentKey === null ? "" : tabId + ":" + frameId + ":" + documentKey + ":" + (session.report?.observedSince ?? "none");
    const eligible = visible && session.loaded && !session.busy && tabId !== null && documentKey !== null && !["paused", "no-access", "unsupported"].includes(coverage);
    const [current, setCurrent] = useState({ identity: "", state: null, pending: false });
    const generation = useRef(0), mounted = useRef(false), job = useRef(null), latest = useRef(null);
    const read = async () => {
      if (!eligible || !mounted.current || job.current) return;
      const token = ++generation.current, operation = {};
      job.current = operation;
      setCurrent(previous => ({ identity, state: previous.identity === identity ? previous.state : null, pending: true }));
      let timer;
      try {
        const raw = await Promise.race([browserApi.runtime.sendMessage({ schemaVersion: 1, type: "ui-get-cookie-writers", tabId, frameId, documentKey }),
          new Promise(resolve => { timer = setTimeout(() => resolve(null), COOKIE_READ_TIMEOUT_MS); })]);
        if (!mounted.current || token !== generation.current || latest.current?.identity !== identity) return;
        const state = readCookieWriterSnapshot(raw);
        setCurrent({ identity, state: state?.documentKey === documentKey ? state : null, pending: false });
      } catch {
        if (mounted.current && token === generation.current) setCurrent({ identity, state: null, pending: false });
      } finally { clearTimeout(timer); if (job.current === operation) job.current = null; }
    };
    latest.current = { identity, read };
    useEffect(() => {
      mounted.current = true; ++generation.current;
      setCurrent({ identity, state: null, pending: false });
      if (eligible) read();
      const timer = eligible ? setInterval(() => latest.current?.read(), 5000) : null;
      return () => { mounted.current = false; ++generation.current; if (timer !== null) clearInterval(timer); };
    }, [identity, eligible, coverage]);
    useEffect(() => {
      const changed = () => { ++generation.current; setCurrent({ identity, state: null, pending: false }); latest.current?.read(); };
      const removed = browserApi.permissions?.onRemoved, added = browserApi.permissions?.onAdded;
      removed?.addListener(changed); added?.addListener(changed);
      return () => { removed?.removeListener(changed); added?.removeListener(changed); };
    }, [identity, eligible]);
    return { state: eligible && current.identity === identity ? current.state : null, pending: eligible && current.identity === identity && current.pending, refresh: read };
  }

  // The inventory belongs to the current top document, independent of the API frame picker.
  function useThirdParty(session, enabled, visible) {
    const root = session.frames.find(frame => frame.frameId === 0), documentKey = root?.documentKey ?? null;
    const tabId = session.tabId, rootReport = session.report?.documentKey === documentKey ? session.report : null, coverage = rootReport?.coverageState;
    const identity = documentKey === null ? "" : tabId + ":" + documentKey + ":" + (rootReport?.observedSince ?? "root");
    const eligible = enabled && session.loaded && !session.busy && tabId !== null && documentKey !== null && !["paused", "no-access", "unsupported"].includes(coverage);
    const [current, setCurrent] = useState({ identity: "", state: null, pending: false });
    const generation = useRef(0), mounted = useRef(false), job = useRef(null), latest = useRef(null);
    const read = async () => {
      if (!eligible || !mounted.current || job.current) return;
      const token = ++generation.current, operation = {}; job.current = operation;
      setCurrent(previous => ({ identity, state: previous.identity === identity ? previous.state : null, pending: true }));
      let timer;
      try {
        const raw = await Promise.race([browserApi.runtime.sendMessage({ schemaVersion: 1, type: "ui-get-third-party", tabId, frameId: 0, documentKey }),
          new Promise(resolve => { timer = setTimeout(() => resolve(null), 6000); })]);
        if (!mounted.current || token !== generation.current || latest.current?.identity !== identity) return;
        const state = readThirdPartySnapshot(raw);
        setCurrent({ identity, state: state?.documentKey === documentKey ? state : null, pending: false });
      } catch { if (mounted.current && token === generation.current) setCurrent({ identity, state: null, pending: false }); }
      finally { clearTimeout(timer); if (job.current === operation) job.current = null; }
    };
    latest.current = { identity, read };
    useEffect(() => {
      mounted.current = true; ++generation.current; setCurrent({ identity, state: null, pending: false });
      if (eligible) read();
      const timer = eligible ? setInterval(() => latest.current?.read(), visible ? 1000 : 3000) : null;
      return () => { mounted.current = false; ++generation.current; if (timer !== null) clearInterval(timer); };
    }, [identity, eligible, visible, coverage]);
    useEffect(() => {
      const changed = () => { ++generation.current; setCurrent({ identity, state: null, pending: false }); latest.current?.read(); };
      const removed = browserApi.permissions?.onRemoved, added = browserApi.permissions?.onAdded;
      removed?.addListener(changed); added?.addListener(changed);
      return () => { removed?.removeListener(changed); added?.removeListener(changed); };
    }, [identity, eligible]);
    return { state: eligible && current.identity === identity ? current.state : null, pending: current.identity === identity && current.pending, refresh: read };
  }

  function ThirdPartyRows({ state, rows = state.rows, summary = true }) {
    const totals = thirdPartyTotals(state), columns = ["third_party_resource", "third_party_initiator", "pro_resource_requests", "third_party_status"];
    const cell = (index, children) => h("td", { role: "cell", children: [
      h("span", { class: "social-cell-label", "aria-hidden": "true", children: text(columns[index]) }),
      h("div", { class: "social-cell-value", children })
    ] });
    const field = (key, value) => h("div", { children: [h("dt", { children: text(key) }), h("dd", { dir: "auto", children: value })] });
    return h("div", { class: "social-observations third-party-observations", children: [
      summary ? h("div", { class: "third-party-summary", children: [
        h("strong", { "data-third-party-requests": totals.requests, children: text("third_party_requests_total", [String(totals.requests)]) }),
        h("span", { "data-third-party-domains": totals.domains, children: text("third_party_domains_total", [String(totals.domains)]) }),
        state.coverageState ? h("span", { class: "pill", children: text("status_" + state.coverageState.replace(/-/g, "_")) }) : null
      ] }) : null,
      rows.length ? h("table", { class: "social-report-table third-party-table", role: "table", "data-third-party-table": true, children: [
        h("thead", { role: "rowgroup", children: h("tr", { role: "row", children: columns.map(key => h("th", { role: "columnheader", scope: "col", children: text(key) })) }) }),
        h("tbody", { role: "rowgroup", children: rows.map((row, index) => h("tr", { role: "row", "data-third-party-row": index, "data-third-party-domain": row.domain, "data-third-party-source": row.evidenceSource,
          key: row.documentKey + ":" + row.domain + ":" + row.pathTemplate + ":" + row.type + ":" + row.evidenceSource, children: [
          cell(0, [h("strong", { dir: "auto", children: row.domain }), h("code", { children: row.pathTemplate }),
            h("span", { class: "small", children: text("social_resource_" + row.type) }), row.relation === "unknown" ? h("span", { class: "small muted", children: text("report_relation_unknown") }) : null]),
          cell(1, [h("dl", { class: "third-party-fields", children: [field("third_party_document", row.documentHost ?? text("host_unknown")),
            field("third_party_initiator", row.initiatorHost ?? text("host_unknown"))] }),
            h("span", { class: "small", children: text("third_party_script_unknown") }),
            h("span", { class: "small muted", children: text("evidence_" + row.evidenceSource.replace(/-/g, "_")) })]),
          cell(2, [h("strong", { children: row.requestCount }), h("dl", { class: "third-party-fields small", children: [
            field("third_party_completed", row.evidenceSource === "browser-network" ? row.completedCount : "—"), field("third_party_failed", row.evidenceSource === "browser-network" ? row.failedCount : "—"), field("third_party_redirects", row.evidenceSource === "browser-network" ? row.redirectCount : "—")
          ] })]),
          cell(3, h("code", { children: row.statusCodes.join(", ") || "—" }))
        ] })) })
      ] }) : h("p", { class: "inspector-empty", children: text(state.rows.length ? "third_party_no_filter_match" : "third_party_empty") }),
      state.truncated ? h("p", { class: "small muted", "data-third-party-truncated": true, children: text("third_party_limited") }) : null
    ] });
  }

  function ThirdPartyTypeIcon({ type }) {
    const geometry = THIRD_PARTY_TYPE_ICONS[type] ?? THIRD_PARTY_TYPE_ICONS.other;
    return h("span", { class: "technique-icon third-party-type-icon", "aria-hidden": "true", children: h("svg", { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": 1.7, "stroke-linecap": "round", "stroke-linejoin": "round", focusable: "false",
      children: geometry.map(([tag, attributes], index) => h(tag, { ...attributes, key: index })) }) });
  }

  // Request kinds read like the technique list: kind, its domains and the request count; domains expand.
  function ThirdPartyTechniques({ groups, expanded, onToggle }) {
    const summary = domains => domains.slice(0, 3).map(row => row.domain).join(", ") + (domains.length > 3 ? " +" + (domains.length - 3) : "");
    return h("table", { class: "technique-table third-party-techniques", "data-third-party-techniques": true, children: [
      h("thead", { children: h("tr", { children: [h("th", { children: text("inspector_group") }), h("th", { children: text("inspector_found") })] }) }),
      h("tbody", { children: groups.flatMap(group => {
        const open = expanded.includes(group.type), id = "third-party-type-" + group.type;
        return [
          h("tr", { key: group.type, children: h("td", { colSpan: 2, children: h("button", { class: "technique-row", type: "button", "data-third-party-type": group.type, "aria-expanded": open, "aria-controls": id, onClick: () => onToggle(group.type), children: [
            h("span", { class: "technique-row__name", children: [h(ThirdPartyTypeIcon, { type: group.type }), h("span", { class: "third-party-technique__label", children: [
              h("span", { children: text("social_resource_" + group.type) }),
              h("span", { class: "small muted", dir: "auto", "data-third-party-type-domains": group.domains.length, children: summary(group.domains) })
            ] })] }),
            h("span", { class: "technique-row__end", children: [h("span", { class: "technique-row__count", children: group.requests }), h("span", { class: "technique-row__mark", "aria-hidden": "true", children: open ? "−" : "+" })] })
          ] }) }) }),
          h("tr", { key: group.type + ":domains", hidden: !open, children: h("td", { colSpan: 2, children: h("div", { id, class: "technique-expanded", children: h("ul", { class: "third-party-domain-list", children: group.domains.map(row => h("li", { key: row.domain, children: [
            h("strong", { dir: "auto", children: row.domain }), h("span", { class: "small muted", children: text("third_party_requests_total", [String(row.requests)]) })
          ] })) }) }) }) })
        ];
      }) })
    ] });
  }

  function ThirdPartyDomains({ domains }) {
    const [limit, setLimit] = useState(12);
    return h("section", { class: "third-party-domains", "data-third-party-domain-list": true, children: [
      h("h3", { children: text("pro_graph_domains") }),
      h("ul", { class: "third-party-domain-list", children: domains.slice(0, limit).map(row => h("li", { key: row.domain, "data-third-party-domain-row": row.domain, children: [
        h("span", { class: "third-party-domain__text", children: [h("strong", { dir: "auto", children: row.domain }), h("span", { class: "small muted", children: row.types.map(type => text("social_resource_" + type)).join(", ") })] }),
        h("span", { class: "technique-row__count", children: row.requests })
      ] })) }),
      domains.length > limit ? h("button", { class: "button", type: "button", onClick: () => setLimit(value => value + 50), children: text("pro_show_more") }) : null
    ] });
  }

  // ADR-103: kinds of third-party requests first, then API use in embedded documents, then domains;
  // the per-resource table stays available but collapsed.
  function ThirdPartyPanel({ thirdParty, embedded = null }) {
    const [filter, setFilter] = useState(""), [limit, setLimit] = useState(100), [expanded, setExpanded] = useState([]);
    const state = thirdParty.state, term = filter.toLowerCase(), all = (state?.rows ?? []).filter(row => (row.domain + " " + row.pathTemplate + " " + row.type).toLowerCase().includes(term));
    useEffect(() => { setFilter(""); setLimit(100); setExpanded([]); }, [state?.documentKey]);
    const totals = state ? thirdPartyTotals(state) : null, groups = state ? thirdPartyGroups(state) : null;
    const toggle = type => setExpanded(values => values.includes(type) ? values.filter(item => item !== type) : [...values.slice(-9), type]);
    return h("section", { class: "third-party-panel", "data-third-party-panel": true, children: [
      h("div", { class: "third-party-heading", children: [h("h2", { children: text("inspector_spotted") }),
        h("button", { class: "button", type: "button", disabled: thirdParty.pending, onClick: thirdParty.refresh, children: text("action_refresh") })] }),
      state ? [
        h("div", { class: "third-party-summary", children: [
          h("strong", { "data-third-party-requests": totals.requests, children: text("third_party_requests_total", [String(totals.requests)]) }),
          h("span", { "data-third-party-domains": totals.domains, children: text("third_party_domains_total", [String(totals.domains)]) }),
          state.coverageState ? h("span", { class: "pill", children: text("status_" + state.coverageState.replace(/-/g, "_")) }) : null
        ] }),
        state.truncated ? h("p", { class: "small muted", children: text("third_party_limited") }) : null,
        groups.types.length ? h(ThirdPartyTechniques, { groups: groups.types, expanded, onToggle: toggle }) : h("p", { class: "inspector-empty", children: text("third_party_empty") })
      ] : h("p", { class: "inspector-empty", children: text(thirdParty.pending ? "statusLoading" : "third_party_unavailable") }),
      embedded,
      state && groups.domains.length ? h(ThirdPartyDomains, { domains: groups.domains }) : null,
      state && state.rows.length ? h("details", { class: "third-party-details", "data-third-party-details": true, children: [
        h("summary", { children: text("third_party_title") }),
        h("label", { class: "third-party-filter", children: [h("span", { class: "small", children: text("third_party_filter") }),
          h("input", { class: "input", type: "search", maxLength: 253, value: filter, onInput: event => { setFilter(event.currentTarget.value.slice(0, 253)); setLimit(100); } })] }),
        h(ThirdPartyRows, { state, rows: all.slice(0, limit), summary: false }),
        all.length > limit ? h("button", { class: "button", type: "button", onClick: () => setLimit(value => Math.min(1024, value + 100)), children: text("pro_show_more") }) : null
      ] }) : null
    ] });
  }

  function ProThirdPartySnapshot({ page }) {
    const locale = useLocale();
    const elapsed = timestamp => {
      if (!Number.isFinite(timestamp) || !Number.isFinite(page.startedAt)) return "—";
      const seconds = Math.max(0, Math.floor((timestamp - page.startedAt) / 1000));
      return String(Math.floor(seconds / 60)).padStart(2, "0") + ":" + String(seconds % 60).padStart(2, "0");
    };
    const duration = milliseconds => {
      if (!Number.isFinite(milliseconds)) return "—";
      try { return new Intl.NumberFormat(({ zh_CN: "zh-CN", pt_BR: "pt-BR", yue: "zh-CN", wuu: "zh-CN" })[locale] ?? locale ?? "en").format(milliseconds) + " ms"; }
      catch { return String(milliseconds) + " ms"; }
    };
    const rows = [];
    for (const resource of page.resources ?? []) {
      if (resource.relation !== "cross-site" || !resource.requestCount) continue;
      let pathTemplate = "/";
      try { pathTemplate = new URL(resource.url).pathname; } catch { /* Validated Pro URLs may also be category labels. */ }
      // Existing Pro groups combine requests from the visit's frames; source document is unavailable.
      const documentHost = null;
      rows.push({ ...resource, domain: resource.domain, pathTemplate, documentKey: page.documentKey, documentHost,
        initiatorHost: null, evidenceSource: "browser-network", integrity: "browser-observed", script: null });
    }
    if (!rows.length) return null;
    const totals = thirdPartyTotals({ rows });
    return h("section", { class: "pro-third-party", "data-pro-third-party": true, children: [
      h("h3", { children: text("third_party_title") }),
      h("p", { class: "third-party-summary", children: [
        h("strong", { "data-third-party-requests": totals.requests, children: text("third_party_requests_total", [String(totals.requests)]) }),
        h("span", { "data-third-party-domains": totals.domains, children: text("third_party_domains_total", [String(totals.domains)]) })
      ] }),
      reportTable(["third_party_resource", "social_resource_type", "pro_resource_requests", "third_party_completed", "third_party_failed", "third_party_redirects", "third_party_status"], rows.map((row, index) => h("tr", {
        key: row.id ?? index, "data-third-party-row": index, "data-third-party-domain": row.domain, "data-third-party-source": row.evidenceSource, children: [
          h("td", { children: [h("strong", { dir: "auto", children: row.domain }), h("code", { dir: "ltr", children: row.pathTemplate }),
            h("div", { class: "small", "data-third-party-timing": true, children: text("report_first_seen") + ": " + elapsed(row.firstSeenAt) + " · " + text("report_last_seen") + ": " + elapsed(row.lastSeenAt) })] }),
          h("td", { children: text("social_resource_" + row.type) }), h("td", { children: row.requestCount }), h("td", { children: row.completedCount }),
          h("td", { children: row.failedCount }), h("td", { children: row.redirectCount }), h("td", { children: [row.statusCodes.join(", ") || "—",
            h("div", { class: "small", "data-third-party-duration": true, children: text("report_latency") + ": " + duration(row.durationTotalMs) })] })
        ]
      })), { "data-third-party-table": true })
    ] });
  }

  function SocialRows({ state }) {
    const columns = ["social_service_column", "detail_evidence", "social_script", "social_count_column"];
    const cell = (index, children, properties = {}) => h("td", { role: "cell", ...properties, children: [
      h("span", { class: "social-cell-label", "aria-hidden": "true", children: text(columns[index]) }),
      h("div", { class: "social-cell-value", children })
    ] });
    return h("div", { class: "social-observations", children: [
      h("p", { class: "small muted", children: text("status_" + state.coverageState.replace(/-/g, "_")) }),
      h("div", { class: "social-summary", children: [
        h("p", { children: text("social_service_count", [String(socialServiceCount(state.rows))]) }),
        h("p", { "data-social-tracking-services": true, children: text("social_tracking_services", [String(socialTrackingServiceCount(state.rows))]) })
      ] }),
      state.rows.length ? h("table", { class: "social-report-table", role: "table", "data-social-table": true, children: [
        h("thead", { role: "rowgroup", children: h("tr", { role: "row", children: columns.map(key => h("th", { role: "columnheader", scope: "col", children: text(key) })) }) }),
        h("tbody", { role: "rowgroup", children: state.rows.map((row, index) => h("tr", { role: "row", "data-social-row": index, "data-social-kind": row.kind,
          "data-social-service": row.service, "data-social-tracking": String(socialTrackingRow(row)), "data-social-evidence": row.evidenceSource, key: index, children: [
          cell(0, [h("strong", { children: h(CompanyLabel, { name: SOCIAL_NAMES[row.service] ?? text("cookie_confidence_unknown"), identity: row.service }) }),
            h("p", { class: "social-kind" + (socialTrackingRow(row) ? " social-kind--tracking" : ""), children: text("social_kind_" + row.kind.replace(/-/g, "_")) }),
            h("dl", { class: "social-request-facts", children: [
              h("div", { children: [h("dt", { children: text("social_method") }), h("dd", { children: row.method === "UNKNOWN" ? text("social_method_unknown") : h("code", { dir: "ltr", children: row.method }) })] }),
              h("div", { children: [h("dt", { children: text("social_endpoint") }), h("dd", { children: text("social_endpoint_" + row.endpoint.replace(/-/g, "_")) })] }),
              h("div", { children: [h("dt", { children: text("social_resource_type") }), h("dd", { children: text("social_resource_" + row.requestType) })] })
            ] })]),
          cell(1, [h("p", { children: text("evidence_" + row.evidenceSource.replace(/-/g, "_")) }), h("p", { children: text("integrity_" + row.integrity.replace(/-/g, "_")) }), h("p", { children: text("attribution_" + row.attributionConfidence.replace(/-/g, "_")) })]),
          cell(2, [row.script ? h("code", { dir: "ltr", "data-social-script": true, children: row.script.host + row.script.pathTemplate }) : h("span", { children: text("social_script_unknown") }), row.initiatorHost ? h("p", { children: [text("social_initiator") + ": ", h("code", { dir: "ltr", children: row.initiatorHost })] }) : null]),
          cell(3, text(row.evidenceSource === "browser-network" ? "social_browser_request_count" : "social_page_action_count", [String(row.count)]), { "data-social-count-source": row.evidenceSource })
        ] })) })
      ] }) : h("p", { class: "inspector-empty", children: text("social_empty") }),
      state.truncated ? h("p", { children: text("social_limit") }) : null
    ] });
  }
  function SocialPanel({ social }) {
    useLocale();
    const state = readSocialSnapshot(social.state);
    return h("section", { class: "social-inspector", "data-social-panel": true, "aria-busy": social.pending, children: [
      h("h2", { children: text("social_title") }), state ? h(SocialRows, { state }) : h("p", { role: "status", children: text(social.pending ? "statusLoading" : "statusUnavailable") }),
      h("button", { type: "button", class: "button", disabled: social.pending, onClick: social.refresh, children: text("social_refresh") })
    ] });
  }
  const reportDocument = (page, documentKey, index) => page?.reports?.find(report => report.documentKey === documentKey)?.host || text("social_document", [String(index + 1)]);
  const reportTable = (columns, rows, properties = {}) => h("table", { class: "pro-data-table", ...properties, children: [
    h("thead", { children: h("tr", { children: columns.map(key => h("th", { scope: "col", children: text(key) })) }) }),
    h("tbody", { children: rows })
  ] });
  function ProSocialSnapshot({ snapshots, page = null }) {
    useLocale();
    const documents = readSocialDocuments(snapshots);
    if (!documents) return null;
    const rows = documents.flatMap(state => state.rows);
    const limited = documents.some(state => state.truncated);
    if (!rows.length && !limited) return null;
    return h("section", { class: "pro-social-networks", "data-pro-social-networks": true, children: [h("h4", { children: text("social_report_title") }),
      rows.length ? h("div", { class: "social-summary", "data-social-pro-summary": true, children: [
        h("span", { "data-social-pro-services": true, children: text("social_service_count", [String(socialServiceCount(rows))]) }),
        socialTrackingServiceCount(rows) ? h("span", { "data-social-pro-tracking-services": true, children: text("social_tracking_services", [String(socialTrackingServiceCount(rows))]) }) : null
      ] }) : null,
      rows.length ? reportTable(["social_service_column", "social_endpoint", "third_party_document", "social_script", "detail_evidence", "social_count_column"],
        documents.flatMap((state, documentIndex) => state.rows.map((row, index) => h("tr", { key: state.documentKey + ":" + index,
          "data-social-row": index, "data-social-kind": row.kind, "data-social-service": row.service, "data-social-tracking": String(socialTrackingRow(row)), "data-social-evidence": row.evidenceSource, "data-social-pro-document": documentIndex, children: [
          h("td", { children: h("strong", { children: h(CompanyLabel, { name: SOCIAL_NAMES[row.service] ?? text("cookie_confidence_unknown"), identity: row.service }) }) }),
          h("td", { children: [h("strong", { class: "social-kind" + (socialTrackingRow(row) ? " social-kind--tracking" : ""), children: text("social_kind_" + row.kind.replace(/-/g, "_")) }),
            h("div", { children: [row.method === "UNKNOWN" ? text("social_method_unknown") : row.method, " · ", text("social_endpoint_" + row.endpoint.replace(/-/g, "_")), " · ", text("social_resource_" + row.requestType)] })] }),
          h("td", { children: reportDocument(page, state.documentKey, documentIndex) }),
          h("td", { children: [row.script ? h("code", { dir: "ltr", "data-social-script": true, children: row.script.host + row.script.pathTemplate }) : "—",
            row.initiatorHost ? h("div", { children: [text("social_initiator") + ": ", h("code", { dir: "ltr", children: row.initiatorHost })] }) : null] }),
          h("td", { children: [h("span", { children: text("evidence_" + row.evidenceSource.replace(/-/g, "_")) }), h("div", { class: "small", children: text("attribution_" + row.attributionConfidence.replace(/-/g, "_")) })] }),
          h("td", { "data-social-count-source": row.evidenceSource, children: text(row.evidenceSource === "browser-network" ? "social_browser_request_count" : "social_page_action_count", [String(row.count)]) })
        ] }))), { class: "pro-data-table social-report-table", "data-social-table": true }) : null,
      limited ? h("p", { class: "small report-muted", "data-social-pro-truncated": true, children: text("report_data_limited") }) : null
    ] });
  }

  function CookieMetadata({ state, live = null }) {
    const locale = useLocale();
    const entries = state.entries;
    const row = (label, value) => h("div", { children: [h("dt", { children: text(label) }), h("dd", { children: value })] });
    const cookie = (entry, index) => {
      const analysis = [entry.hostOnly ? "cookie_analysis_host_only" : "cookie_analysis_domain", entry.secure ? "cookie_analysis_secure" : "cookie_analysis_no_secure",
        entry.httpOnly ? "cookie_analysis_http_only" : "cookie_analysis_no_http_only", "cookie_analysis_samesite_" + entry.sameSite,
        entry.session ? "cookie_analysis_session" : "cookie_analysis_persistent", entry.partitioned ? "cookie_analysis_partitioned" : "cookie_analysis_no_partition"];
      const unknown = ["unknown", "ambiguous"].includes(entry.confidence) || entry.category === "unknown";
      const nameReference = entry.confidence === "ambiguous" && entry.category === "unknown" && !entry.owner && entry.purpose.startsWith("Catalogue name match: ");
      if (unknown) analysis.unshift("cookie_analysis_unknown");
      return h("article", { class: "cookie-entry" + (entry.tracking ? " cookie-entry--tracking" : ""), "data-cookie-tracking": String(entry.tracking), "data-cookie-category": entry.category, children: [
      h("div", { class: "cookie-entry__heading", children: [
        h("div", { children: [h("h4", { class: "cookie-entry__name", dir: "ltr", children: entry.name }), h("p", { class: "cookie-entry__company", children: h(CompanyLabel, { name: ownerText(entry.owner), identity: entry.owner }) })] })
      ] }),
      h("dl", { class: "cookie-facts", children: [
        row("cookie_domain", h("code", { dir: "ltr", children: entry.domain })),
        row("cookie_attributes", h("code", { dir: "ltr", children: [entry.hostOnly ? "HostOnly" : "Domain", entry.secure ? "Secure" : null, entry.httpOnly ? "HttpOnly" : null,
          "SameSite=" + entry.sameSite, text(entry.partitioned ? "cookie_partitioned" : "cookie_unpartitioned")].filter(Boolean).join(" · ") })),
        row("cookie_expiry", entry.session ? text("cookie_session") : entry.expirationDate === undefined ? "—" : dateText(entry.expirationDate * 1000, locale)),
        row("cookie_category", text("cookie_category_" + entry.category)),
        entry.owner ? row("cookie_owner", h(CompanyLabel, { name: ownerText(entry.owner), identity: entry.owner })) : null,
        entry.purpose ? row(nameReference ? "cookie_name_reference" : "cookie_purpose", nameReference
          ? h("span", { "data-cookie-name-reference": true, children: purposeText(entry) }) : purposeText(entry)) : null,
        row("cookie_confidence", text("cookie_confidence_" + entry.confidence)),
        entry.ruleIds.length ? row("detail_rule", h("code", { dir: "ltr", children: entry.ruleIds.join(", ") })) : null
      ] }),
      live ? h("div", { class: "cookie-value", "data-cookie-value": index, children: [
        h("strong", { class: "cookie-value__label", children: text("cookie_value") }),
        live.valueState?.index === index && typeof live.valueState.value === "string" ? [
          live.valueState.value.length ? h("pre", { class: "cookie-value__text", dir: "ltr", "data-cookie-value-text": true, children: displayCookieValue(live.valueState.value) }) : h("p", { class: "small", "data-cookie-empty-value": true, children: text("cookie_value_empty") }),
          live.valueState.truncated ? h("p", { class: "small muted", children: text("cookie_value_limit") }) : null,
          h("button", { type: "button", class: "button", "data-cookie-value-action": "hide", onClick: live.hideValue, children: text("cookie_value_hide") })
        ] : typeof live.handles?.[index] === "string" ? [
          live.valueState?.index === index && live.valueState.unavailable ? h("p", { class: "small muted", role: "status", children: text("cookie_value_unavailable") }) : null,
          h("button", { type: "button", class: "button", "data-cookie-value-action": "show", disabled: live.pending || live.busy || live.valueBusy,
            onClick: () => live.showValue(index), children: text(live.valueState?.index === index && live.valueState.pending ? "cookie_value_loading" : "cookie_value_show") })
        ] : h("p", { class: "small muted", children: text("cookie_value_unavailable") })
      ] }) : null,
      h("details", { class: "cookie-analysis", "data-cookie-analysis": true, open: unknown, children: [h("summary", { children: text("cookie_analysis") }),
        h("ul", { children: analysis.map(key => h("li", { children: text(key) })) })] }),
      entry.sourceUrls.length ? h("ul", { class: "cookie-entry__sources", children: entry.sourceUrls.map((url) => h("li", { children: h("a", { href: url, target: "_blank", rel: "noreferrer noopener", children: url }) })) }) : null
    ], key: entry.domain + ":" + entry.name + ":" + index });
    };
    return h("div", { class: "cookie-metadata", "data-cookie-metadata": true, children: [
      h("p", { class: "small muted", "data-cookie-coverage": true, children: text("status_" + state.coverageState.replace(/-/g, "_")) }),
      h("div", { class: "cookie-counts", "data-cookie-counts": true, children: [
        h("strong", { "data-cookie-total": true, children: text("cookie_total_count", [(state.truncated ? "≥" : "") + String(state.totalCount ?? entries.length)]) }),
        h("span", { children: text("cookie_tracking_count", [String(state.trackingCount)]) }),
        h("span", { children: text("cookie_other_count", [String(entries.filter(entry => !entry.tracking).length)]) }),
        state.siteCount !== undefined && state.siteCount !== (state.totalCount ?? entries.length) ? h("span", { children: text("cookie_site_count", [(state.truncated ? "≥" : "") + String(state.siteCount)]) }) : null
      ] }),
      ...[true, false].map((tracking) => {
        const rows = entries.map((entry, index) => ({ entry, index })).filter(({ entry }) => entry.tracking === tracking);
        return rows.length ? h("section", { class: "cookie-category-group", children: [h("h3", { children: text(tracking ? "cookie_tracking" : "cookie_other") }), ...rows.map(({ entry, index }) => cookie(entry, index))] }) : null;
      }),
      entries.length === 0 ? h("p", { class: "inspector-empty", children: text((state.totalCount ?? 0) > 0 ? "cookie_unavailable" : "cookie_empty") }) : null,
      state.truncated ? h("p", { class: "small muted", children: text("cookie_limit") }) : null,
    ] });
  }

  function CookieWritersTable({ documents }) {
    const locale = useLocale();
    const snapshots = readCookieWriterDocuments(documents);
    const rows = snapshots?.flatMap((snapshot, documentIndex) => snapshot.rows.map(row => ({ row, documentKey: snapshot.documentKey, documentIndex }))) ?? [];
    if (!rows.length) return null;
    let compare;
    try { compare = new Intl.Collator(({ zh_CN: "zh-CN", pt_BR: "pt-BR", yue: "zh-CN", wuu: "zh-CN" })[locale] ?? locale ?? "en").compare; } catch { compare = new Intl.Collator("en").compare; }
    rows.sort((a, b) => compare(a.row.name, b.row.name) || compare(a.row.script?.host ?? "", b.row.script?.host ?? "") || compare(a.row.script?.pathTemplate ?? "", b.row.script?.pathTemplate ?? "") || compare(a.row.phase, b.row.phase) || a.documentIndex - b.documentIndex);
    const columns = ["cookie_name", "social_script", "detail_phases", "detail_counts"];
    const cell = (index, children) => h("td", { role: "cell", children: [
      h("span", { class: "social-cell-label", "aria-hidden": "true", children: text(columns[index]) }),
      h("div", { class: "social-cell-value", children })
    ] });
    return h("section", { class: "cookie-writers social-observations", "data-cookie-writers": true, children: [
      h("h3", { children: text("cookie_writers_title") }),
      h("table", { class: "social-report-table pro-data-table cookie-writers-table", role: "table", "data-cookie-writers-table": true, children: [
        h("thead", { role: "rowgroup", children: h("tr", { role: "row", children: columns.map(key => h("th", { role: "columnheader", scope: "col", children: text(key) })) }) }),
        h("tbody", { role: "rowgroup", children: rows.map(({ row, documentKey, documentIndex }, index) => h("tr", { role: "row", key: index, "data-cookie-writer-row": index, "data-cookie-writer-document": documentKey, children: [
          cell(0, [h("code", { dir: "ltr", children: row.name }), snapshots.length > 1 ? h("p", { class: "small muted", children: text("social_document", [String(documentIndex + 1)]) }) : null]),
          cell(1, [row.script ? h("code", { dir: "ltr", children: row.script.host + row.script.pathTemplate }) : h("span", { children: text("social_script_unknown") }),
            h("p", { class: "small muted", children: text("attribution_" + row.attributionConfidence.replace(/-/g, "_")) })]),
          cell(2, text("phase_" + row.phase.replace(/-/g, "_"))),
          cell(3, (row.count === 2147483647 ? "≥" : "") + row.count)
        ] })) })
      ] }),
      snapshots.some(snapshot => snapshot.truncated) ? h("p", { class: "small muted", children: text("status_partial") }) : null
    ] });
  }

  function CookiePanel({ cookies, probeControl = null, writers = null }) {
    useLocale();
    const state = cookies.state, permission = state?.permission;
    return h("section", { class: "cookie-inspector", "data-cookie-panel": true, "aria-busy": cookies.pending || cookies.busy, children: [
      h("button", { type: "button", class: "button cookie-clear", "data-cookie-action": "clear", disabled: cookies.pending || cookies.busy || permission !== "granted" || !["active", "partial"].includes(state?.coverageState), onClick: cookies.clear,
        children: text(cookies.clearing ? "cookie_clearing" : "cookie_clear_site") }),
      cookies.clearResult ? h("p", { class: "cookie-clear-result", role: "status", children: [
        text("cookie_clear_result", [String(cookies.clearResult.removedCount), String(cookies.clearResult.failedCount)]),
        cookies.clearResult.truncated || cookies.clearResult.failedCount > 0 ? h("span", { children: " " + text("cookie_clear_partial") }) : null
      ] }) : cookies.clearUnavailable ? h("p", { class: "cookie-clear-result", role: "status", children: text("cookie_clear_unavailable") }) : null,
      h("h2", { children: text("cookie_scope_title") }),
      probeControl,
      permission === "required" ? h("div", { class: "cookie-access", children: [
        h("p", { class: "small", children: text("cookie_permission_required") }),
        h("button", { type: "button", class: "button button--primary", "data-cookie-action": "grant", disabled: cookies.pending || cookies.busy, onClick: cookies.grant, children: text("cookie_allow_access") })
      ] }) : permission === "granted" ? h(CookieMetadata, { state, live: cookies }) : h("p", { class: "small muted", role: "status", children: text(cookies.pending ? "cookie_loading" : "cookie_unavailable") }),
      writers?.state ? h(CookieWritersTable, { documents: [writers.state] }) : null,
      h("button", { type: "button", class: "button", "data-cookie-action": "refresh", disabled: cookies.pending || cookies.busy, onClick: () => { cookies.refresh(); writers?.refresh(); }, children: text("cookie_refresh") })
    ] });
  }

  function ProCookieSnapshot({ snapshot }) {
    const locale = useLocale();
    const state = readCookieSnapshot(snapshot);
    if (!state || state.permission !== "granted" || !state.entries.length && !(state.totalCount > 0) && !state.truncated) return null;
    const fact = (label, value) => h("div", { class: "cookie-report-fact", children: [h("strong", { children: text(label) + ": " }), value] });
    const flag = value => text(value ? "cookie_yes" : "cookie_no");
    const rows = state.entries.map((entry, index) => {
      const nameReference = entry.confidence === "ambiguous" && entry.category === "unknown" && !entry.owner && entry.purpose.startsWith("Catalogue name match: ");
      return h("tr", { "data-cookie-report-row": index, "data-cookie-tracking": String(entry.tracking), key: index, children: [
        h("td", { children: index + 1 }),
        h("td", { children: [h("code", { dir: "ltr", children: entry.name }), h("div", { class: "cookie-report-company", children: [
          h(CompanyLabel, { name: ownerText(entry.owner), identity: entry.owner })
        ] })] }),
        h("td", { children: [h("code", { dir: "ltr", children: entry.domain }), h("p", { children: text(entry.hostOnly ? "cookie_scope_host_only" : "cookie_scope_domain") })] }),
        h("td", { children: [fact("cookie_category", text("cookie_category_" + entry.category)), fact("cookie_tracking", flag(entry.tracking)), fact("cookie_confidence", text("cookie_confidence_" + entry.confidence))] }),
        h("td", { children: [fact(nameReference ? "cookie_name_reference" : "cookie_purpose", h("span", { ...(nameReference ? { "data-cookie-name-reference": true } : {}), children: entry.purpose ? purposeText(entry) : text("cookie_analysis_unknown") })),
          entry.ruleIds.length ? fact("detail_rule", h("code", { dir: "ltr", children: entry.ruleIds.join(", ") })) : null,
          h("ol", { class: "cookie-entry__sources", children: entry.sourceUrls.map(url => h("li", { children: h("a", { href: url, target: "_blank", rel: "noreferrer noopener", children: url }) })) })] }),
        h("td", { children: [fact("cookie_attributes", h("code", { dir: "ltr", children: "Secure=" + flag(entry.secure) + " · HttpOnly=" + flag(entry.httpOnly) + " · SameSite=" + entry.sameSite })),
          h("p", { children: text(entry.partitioned ? "cookie_partitioned" : "cookie_unpartitioned") }),
          entry.hasCrossSiteAncestor !== undefined ? h("p", { children: text(entry.hasCrossSiteAncestor ? "cookie_cross_site_ancestor" : "cookie_no_cross_site_ancestor") }) : null,
          fact("cookie_expiry", entry.session ? text("cookie_session") : entry.expirationDate === undefined ? "—" : dateText(entry.expirationDate * 1000, locale))] }),
      ] });
    });
    return h("section", { class: "pro-report-cookies", "data-pro-cookies": true, children: [
      h("h4", { children: text("cookie_report_title") }),
      state.permission === "granted" ? [
        h("p", { children: [text("cookie_total_count", [(state.truncated ? "≥" : "") + String(state.totalCount ?? rows.length)]), " · ", text("cookie_other_count", [String(rows.length - state.trackingCount)]), state.siteCount !== undefined && state.siteCount !== state.totalCount ? " · " + text("cookie_site_count", [(state.truncated ? "≥" : "") + String(state.siteCount)]) : null] }),
        h("p", { "data-cookie-report-counts": true, children: text("cookie_tracking_count", [String(state.trackingCount)]) }),
        rows.length ? h("table", { class: "cookie-report-table pro-data-table", "data-cookie-report-table": true, children: [
          h("thead", { children: h("tr", { children: ["#", text("cookie_report_identity"), text("cookie_domain"), text("cookie_report_classification"), text("cookie_report_explanation"), text("cookie_report_properties")].map(label => h("th", { scope: "col", children: label })) }) }), h("tbody", { children: rows })
        ] }) : null,
        rows.length ? null : h("p", { children: text((state.totalCount ?? 0) > 0 ? "cookie_unavailable" : "cookie_empty") }),
        state.truncated || state.totalCount > rows.length ? h("p", { class: "small report-muted", children: [text("cookie_report_rows", [String(rows.length), (state.truncated ? "≥" : "") + String(state.totalCount ?? rows.length)]), state.truncated ? " · " + text("cookie_limit") : null] }) : null,
      ] : h("p", { class: "report-muted", children: text(state.permission === "required" ? "cookie_permission_required" : "cookie_unavailable") })
    ] });
  }

  function ProTagManagerSection({ pages }) {
    useLocale();
    let limited = false;
    const sections = [];
    for (const [pageIndex, page] of pages.entries()) {
      const documents = readTagManagerDocuments(page.tagManager);
      if (!documents) continue;
      const rows = [], services = new Set();
      for (const [documentIndex, document] of documents.entries()) {
        limited ||= document.truncated;
        for (const row of document.rows) {
          services.add(SERVICE_NAMES[row.target]);
          rows.push(h("tr", { children: [
            h("td", { children: [h("strong", { children: h(CompanyLabel, { name: SERVICE_NAMES[row.source], identity: row.source }) }), h("span", { class: "small muted", children: reportDocument(page, document.documentKey, documentIndex) })] }),
            h("td", { children: h(CompanyLabel, { name: SERVICE_NAMES[row.target], identity: row.target }) }),
            h("td", { children: row.count }),
            h("td", { children: [
              h("span", { children: text("attribution_" + row.attributionConfidence.replace(/-/g, "_")) }),
              h("span", { class: "small muted", children: text("evidence_" + row.evidenceSource.replace(/-/g, "_")) }),
              h("span", { class: "small muted", children: text("integrity_" + row.integrity.replace(/-/g, "_")) })
            ] })
          ] }));
        }
      }
      if (rows.length) sections.push(h("section", { class: "tag-manager-page", children: [
        h("h3", { children: text("report_page") + " " + (pageIndex + 1) }),
        h("p", { class: "report-code small", children: page.url }),
        h("p", { class: "tag-manager-summary", "data-tag-manager-summary": true, children: text("tag_manager_loading_summary", [[...services].join(", ")]) }),
        h("div", { class: "tag-manager-companies", children: [...services].map(name => h(CompanyLabel, { name, identity: name, key: name })) }),
        h("table", { class: "tag-manager-table pro-data-table", children: [
          h("thead", { children: h("tr", { children: ['tag_manager_source', 'tag_manager_target', 'tag_manager_count', 'detail_evidence'].map((key) => h("th", { children: text(key) })) }) }),
          h("tbody", { children: rows })
        ] })
      ] }));
    }
    if (!sections.length && !limited) return null;
    return h("section", { class: "pro-tag-manager", "data-pro-tag-manager": true, children: [
      h("h2", { children: text("tag_manager_title") }),
      sections,
      limited ? h("p", { class: "report-muted", children: text("tag_manager_limit") }) : null
    ] });
  }

  return { IdentificationNavigation, useCookies, useSocial, useCookieWriters, useThirdParty, CookiePanel, CookieWritersTable, SocialPanel, ThirdPartyRows, ThirdPartyPanel, ProThirdPartySnapshot, ProSocialSnapshot, ProCookieSnapshot, ProTagManagerSection };
}
