// ADR-020 §14 spike (S01, throwaway): records Chrome MV3 facts the optional Protection module relies on.
// Runs only when targeted explicitly — `npx playwright test tests/extension/protect/spike/spike.spec.ts
// --config tests/extension/playwright.config.ts` — or with DETECT_PROTECT_SPIKE=1; the full `pnpm test:extension`
// run skips it. The extension under test is this directory (manifest.json, sw.js, page.html) copied to a temp dir
// together with the tiny probe content scripts below (registered dynamically, never part of any build).
// Every item is a separate test() annotated `candidate`; the facts go to test-results/protect-spike.json and only
// they may be quoted in ADR-020 §14 (REQ-015). A sub-check that throws is recorded as such, not hidden.
// Server truth: tests/fixture-server.mjs handlers on ports 4173/4174 behind a recording wrapper (method, host, path,
// `case` query and the Sec-GPC header only; request bodies are drained unread).

import { chromium, expect, test, type BrowserContext, type CDPSession, type Page, type Worker } from '@playwright/test';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http, { type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { Duplex } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { createFixtureHandler, createUpgradeHandler, FIXTURE_PORTS, type FixtureServerStats } from '../../../fixture-server.mjs';

if (process.argv.some((a) => /protect[\\/]spike/.test(a))) process.env['DETECT_PROTECT_SPIKE'] = '1';
const SPIKE_ENABLED = process.env['DETECT_PROTECT_SPIKE'] === '1';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..', '..');
const RESULTS_FILE = path.join(repoRoot, 'test-results', 'protect-spike.json');
const HOST_RULES = 'MAP *.example.com 127.0.0.1, MAP *.example.net 127.0.0.1, MAP *.example.org 127.0.0.1';
const DNR = 'declarativeNetRequestWithHostAccess';
const ALL_SITES = ['http://*/*', 'https://*/*'];
const P1 = FIXTURE_PORTS[0] ?? 4173;
const P2 = FIXTURE_PORTS[1] ?? 4174;
const WEB = (host: string, c: string, port = P1): string => 'http://' + host + ':' + String(port) + '/spike/web.html?case=' + c;
const SINK = (host: string, c: string, port = P2): string => 'http://' + host + ':' + String(port) + '/spike/sink?case=' + c;
const SETTLE_MS = 1500;

// ---------------------------------------------------------------------------------------------------------------
// Probe content scripts written next to the copied extension (registered by SP-7 / SP-12 only).
const CONTENT_SCRIPTS: Record<string, string> = {
  'cs-iso-mark.js': `(() => {
  const mark = () => { const el = document.documentElement; if (!el) return false; el.dataset.spikeIso = '1'; return true; };
  if (!mark()) document.addEventListener('readystatechange', mark, { once: true });
})();\n`,
  'cs-main-a.js': `(window.__spikeOrder = window.__spikeOrder || []).push('a');\n`,
  'cs-main-b.js': `(window.__spikeOrder = window.__spikeOrder || []).push('b');\n`,
  'cs-noop.js': `void 0;\n`,
  'cs-main-stack.js': `(() => {
  const E = Error, FP = Function.prototype, OP = Object.prototype;
  const getProto = Object.getPrototypeOf, gopd = Object.getOwnPropertyDescriptor, create = Object.create;
  const capture = Error.captureStackTrace;
  const chainOk = () => getProto(E) === FP && getProto(FP) === OP;
  const ownPst = () => gopd(E, 'prepareStackTrace') !== undefined || gopd(FP, 'prepareStackTrace') !== undefined || gopd(OP, 'prepareStackTrace') !== undefined;
  const limitOk = () => { const d = gopd(E, 'stackTraceLimit'); return d !== undefined && 'value' in d && typeof d.value === 'number' && d.value >= 1 && d.value <= 100; };
  function nullProtoCapture() {
    const h = create(null);
    try { capture(h); } catch (e) { return { threw: true, error: String(e && e.message) }; }
    const d = gopd(h, 'stack');
    const s = h.stack;
    return { threw: false, own: d !== undefined, kind: d === undefined ? 'none' : ('value' in d ? 'data' : 'accessor'), type: typeof s, head: typeof s === 'string' ? s.split('\\n')[0] : null, lines: typeof s === 'string' ? s.split('\\n').length : 0 };
  }
  function wrap(cb) { return cb(); }
  function prechecked() {
    if (!chainOk() || ownPst() || !limitOk()) return { sampled: false };
    const h = create(null); capture(h); const s = h.stack;
    return { sampled: true, length: typeof s === 'string' ? s.length : -1 };
  }
  function naive() { const h = create(null); capture(h); const s = h.stack; return { sampled: true, length: typeof s === 'string' ? s.length : -1 }; }
  Object.defineProperty(window, '__spikeMain', { value: Object.freeze({ nullProtoCapture, wrap, prechecked, naive }), configurable: true });
  document.addEventListener('spike-time-ping', () => {
    const el = document.documentElement;
    el.dataset.spikeMainNow = String(performance.now());
    el.dataset.spikeMainOrigin = String(performance.timeOrigin);
  });
})();\n`,
};

const WEB_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>protect spike page</title></head><body>
<h1>protect spike page</h1>
<form id="f-url" method="post" action="/spike/sink?case=form-urlencoded" target="sink1"><input name="alpha" value="1"><input name="beta" value="2"></form>
<form id="f-multi" method="post" enctype="multipart/form-data" action="/spike/sink?case=form-multipart" target="sink2"><input name="alpha" value="1"><input name="beta" value="2"></form>
<iframe name="sink1" title="sink1"></iframe><iframe name="sink2" title="sink2"></iframe>
<iframe id="blank" title="blank" src="about:blank"></iframe>
</body></html>
`;
const FRAME_HTML = '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>frame</title></head><body><p>frame</p></body></html>\n';
const WORKER_JS = "fetch('/spike/sink?case=worker-fetch', { cache: 'no-store' }).then(() => postMessage('done'), () => postMessage('failed'));\n";

// ---------------------------------------------------------------------------------------------------------------
// Recording wrapper around the fixture-server handlers.

interface Hit {
  port: number;
  method: string;
  host: string;
  path: string;
  c: string;
  secGpc: string | null;
  upgrade: boolean;
}

interface SpikeServer {
  hits: Hit[];
  close(): Promise<void>;
}

async function startSpikeServer(): Promise<SpikeServer> {
  const stats: FixtureServerStats = { requests: 0, slowRequests: 0, slowAborted: 0, rejected: 0, websocketUpgrades: 0, syntheticVendorRequests: 0 };
  const sockets = new Set<Duplex>();
  const fixture = createFixtureHandler(stats);
  const upgrade = createUpgradeHandler(stats, sockets);
  const hits: Hit[] = [];
  const note = (port: number, req: IncomingMessage, isUpgrade: boolean): string => {
    const url = new URL(req.url ?? '/', 'http://spike.invalid');
    const gpc = req.headers['sec-gpc'];
    hits.push({
      port,
      method: req.method ?? '',
      host: String(req.headers.host ?? '').replace(/:\d+$/, ''),
      path: url.pathname,
      c: url.searchParams.get('case') ?? url.pathname,
      secGpc: typeof gpc === 'string' ? gpc : null,
      upgrade: isUpgrade,
    });
    return url.pathname;
  };
  const send = (res: ServerResponse, type: string, body: string): void => {
    res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
    res.end(body);
  };
  const handlerFor = (port: number) => (req: IncomingMessage, res: ServerResponse): void => {
    const pathname = note(port, req, false);
    if (pathname === '/spike/web.html') return send(res, 'text/html; charset=utf-8', WEB_HTML);
    if (pathname === '/spike/frame.html') return send(res, 'text/html; charset=utf-8', FRAME_HTML);
    if (pathname === '/spike/worker.js') return send(res, 'text/javascript; charset=utf-8', WORKER_JS);
    if (pathname.startsWith('/spike/')) {
      // Sink: drain unread, answer 204. No CORS headers (a preflight, if any, is recorded and fails).
      req.on('error', () => res.destroy());
      req.on('end', () => {
        if (res.writableEnded || res.destroyed) return;
        res.writeHead(204, { 'cache-control': 'no-store' });
        res.end();
      });
      req.resume();
      return;
    }
    fixture(req, res);
  };
  const servers: Server[] = await Promise.all(
    [P1, P2].map(
      (port) =>
        new Promise<Server>((resolve, reject) => {
          const server = http.createServer(handlerFor(port));
          server.on('upgrade', (req: IncomingMessage, socket: Duplex) => {
            note(port, req, true);
            upgrade(req, socket);
          });
          server.once('error', reject);
          server.listen(port, '127.0.0.1', () => resolve(server));
        }),
    ),
  );
  return {
    hits,
    async close() {
      for (const socket of sockets) socket.destroy();
      sockets.clear();
      for (const s of servers) s.closeAllConnections();
      await Promise.all(servers.map((s) => new Promise<void>((resolve) => s.close(() => resolve()))));
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Session, service-worker access and permission helpers.

interface Session {
  context: BrowserContext;
  userDataDir: string;
  extDir: string;
  extId: string;
  ui: Page;
  web: Page;
  server: SpikeServer;
  chromium: string;
}

interface Attempt<T> {
  ok: boolean;
  value?: T;
  error?: string;
}

interface BodyShape {
  kind: string;
  error?: string;
  keys?: number;
  values?: number;
  parts?: number;
  withBytes?: number;
  bytes?: number;
  files?: number;
  empty?: number;
}

interface SpikeEvent {
  l: string;
  e: 'before' | 'send' | 'error' | 'completed';
  c: string;
  host: string;
  scheme: string;
  type: string;
  method: string;
  tabId: number;
  frameId: number;
  initiator: string | null;
  requestId: string;
  body?: BodyShape;
  gpc?: string;
  error?: string;
  status?: number;
}

interface ClickRequest {
  settled: boolean;
  granted: boolean | null;
  error: string | null;
  gesture: boolean;
  waitedMs: number;
}

let S: Session | undefined;

function session(): Session {
  if (S === undefined) throw new Error('spike session not started');
  return S;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

async function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(what + ': timeout ' + String(ms) + ' ms')), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function launchBrowser(userDataDir: string, extDir: string): Promise<BrowserContext> {
  return chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    headless: true,
    args: ['--disable-extensions-except=' + extDir, '--load-extension=' + extDir, '--host-resolver-rules=' + HOST_RULES, '--no-proxy-server'],
  });
}

/** A responsive spike SW; wakes a stopped one with a runtime message from the extension page. */
async function liveSw(context: BrowserContext, ui?: Page, timeoutMs = 20_000): Promise<Worker> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    for (const w of [...context.serviceWorkers()].reverse()) {
      if (!w.url().startsWith('chrome-extension://')) continue;
      try {
        const kind = await withTimeout(w.evaluate(() => typeof (globalThis as unknown as { spike?: unknown }).spike), 2000, 'sw probe');
        if (kind === 'object') return w;
      } catch {
        // stale worker handle
      }
    }
    if (ui !== undefined && !ui.isClosed()) {
      await ui.evaluate(() => chrome.runtime.sendMessage({ type: 'spike-ping' }).catch(() => null)).catch(() => null);
    }
    if (Date.now() > deadline) throw new Error('no live spike service worker');
    await sleep(250);
  }
}

async function sw(): Promise<Worker> {
  const s = session();
  return liveSw(s.context, s.ui);
}

async function call<T>(worker: Worker, name: string, ...args: unknown[]): Promise<T> {
  const evaluated = worker.evaluate(
    async ({ fn, list }) => {
      const api = (globalThis as unknown as { spike: Record<string, (...a: unknown[]) => unknown> }).spike;
      const f = api[fn];
      if (typeof f !== 'function') throw new Error('spike has no ' + fn);
      return f.apply(api, list);
    },
    { fn: name, list: args },
  ) as Promise<T>;
  return withTimeout(evaluated, 30_000, 'spike.' + name);
}

async function spike<T>(name: string, ...args: unknown[]): Promise<T> {
  return call<T>(await sw(), name, ...args);
}

/**
 * Host grants as tests/extension/permissions/support.ts does: chrome://extensions (developerPrivate) approves the
 * hosts, then a real click on the extension page calls permissions.request (no native prompt for approved hosts).
 * Removal: permissions.remove from the SW, then developerPrivate withdraws the approval.
 */
async function hostGrants(op: 'add' | 'remove', patterns: string[]): Promise<Record<string, unknown>> {
  if (op === 'add') {
    const approval = await developerPrivate('add', patterns);
    const request = await requestByClick('#request-hosts', { origins: patterns });
    return { approvalErrors: approval, request };
  }
  const removed = await spike<Attempt<boolean>>('removeOrigins', patterns);
  const approval = await developerPrivate('remove', patterns);
  return { removed, approvalErrors: approval };
}

async function developerPrivate(op: 'add' | 'remove', patterns: string[]): Promise<string[]> {
  const s = session();
  const page = await s.context.newPage();
  try {
    await page.goto('chrome://extensions');
    return await page.evaluate(
      async ({ id, list, mode }) => {
        const api = (chrome as unknown as {
          developerPrivate: { addHostPermission(id: string, host: string): Promise<void>; removeHostPermission(id: string, host: string): Promise<void> };
        }).developerPrivate;
        const errors: string[] = [];
        for (const p of list) {
          try {
            if (mode === 'add') await api.addHostPermission(id, p);
            else await api.removeHostPermission(id, p);
          } catch (e) {
            errors.push(p + ': ' + (e instanceof Error ? e.message : String(e)));
          }
        }
        return errors;
      },
      { id: s.extId, list: patterns, mode: op },
    );
  } finally {
    await page.close();
  }
}

async function openUi(context: BrowserContext, extId: string): Promise<Page> {
  const ui = await context.newPage();
  await ui.goto('chrome-extension://' + extId + '/page.html');
  return ui;
}

/** permissions.request from a real Playwright click on the extension page (user gesture). */
async function requestByClick(selector: string, request: { permissions?: string[]; origins?: string[] }, waitMs = 5000): Promise<ClickRequest> {
  const s = session();
  if (s.ui.isClosed()) s.ui = await openUi(s.context, s.extId);
  await s.ui.evaluate(
    ({ sel, req }) => {
      const state = { settled: false, granted: null as boolean | null, error: null as string | null, gesture: false };
      (window as unknown as { __spikeRequest: typeof state }).__spikeRequest = state;
      const button = document.querySelector<HTMLButtonElement>(sel);
      if (button === null) throw new Error('no ' + sel);
      button.onclick = () => {
        state.gesture = navigator.userActivation.isActive;
        const p: chrome.permissions.Permissions = {};
        if (req.permissions !== undefined) p.permissions = req.permissions as chrome.runtime.ManifestPermission[];
        if (req.origins !== undefined) p.origins = req.origins;
        chrome.permissions.request(p).then(
          (granted) => {
            state.settled = true;
            state.granted = granted;
          },
          (e: unknown) => {
            state.settled = true;
            state.error = e instanceof Error ? e.message : String(e);
          },
        );
      };
    },
    { sel: selector, req: request },
  );
  const started = Date.now();
  await s.ui.click(selector);
  let state = { settled: false, granted: null as boolean | null, error: null as string | null, gesture: false };
  while (Date.now() - started < waitMs) {
    state = await s.ui.evaluate(() => (window as unknown as { __spikeRequest: { settled: boolean; granted: boolean | null; error: string | null; gesture: boolean } }).__spikeRequest);
    if (state.settled) break;
    await sleep(100);
  }
  return { ...state, waitedMs: Date.now() - started };
}

async function requestDnrByClick(waitMs = 5000): Promise<ClickRequest> {
  return requestByClick('#request-dnr', { permissions: [DNR] }, waitMs);
}

/** Same profile and extension directory: closes the browser and launches it again (grants and rules persist). */
async function restartBrowser(): Promise<void> {
  const s = session();
  await s.context.close();
  s.context = await launchBrowser(s.userDataDir, s.extDir);
  s.ui = await openUi(s.context, s.extId);
  s.web = await s.context.newPage();
  await liveSw(s.context, s.ui);
}

/**
 * DNR granted and rule updates settling. SP-1 records that after a runtime grant Chromium 153 leaves
 * update{Dynamic,Session}Rules unsettled until the extension is loaded again; the spike then restarts the browser.
 */
async function ensureDnr(): Promise<boolean> {
  if (!(await spike<boolean>('contains', [DNR]))) {
    const r = await requestDnrByClick();
    if (r.granted !== true) return false;
  }
  if ((await spike<Attempt<unknown>>('writeProbe', 3000)).ok) return true;
  await restartBrowser();
  await ensureAllSites();
  return (await spike<Attempt<unknown>>('writeProbe', 5000)).ok;
}

async function ensureAllSites(): Promise<Record<string, unknown>> {
  if (await spike<boolean>('contains', undefined, ALL_SITES)) return { alreadyGranted: true };
  return hostGrants('add', ALL_SITES);
}

type FireKind = 'fetch' | 'xhr' | 'beacon' | 'image' | 'script';

/** Cross-site requests from the page; waits for fetch/xhr to settle, then SETTLE_MS for the rest. */
async function fire(page: Page, list: Array<{ kind: FireKind; url: string }>): Promise<Record<string, string>> {
  const out = await page.evaluate(async (items) => {
    const result: Record<string, string> = {};
    const pending: Array<Promise<void>> = [];
    for (const r of items) {
      try {
        if (r.kind === 'fetch') {
          pending.push(
            fetch(r.url, { mode: 'no-cors', cache: 'no-store' }).then(
              () => {
                result[r.url] = 'fetch-resolved';
              },
              (e: unknown) => {
                result[r.url] = 'fetch-rejected: ' + (e instanceof Error ? e.message : String(e));
              },
            ),
          );
        } else if (r.kind === 'xhr') {
          pending.push(
            new Promise<void>((resolve) => {
              const x = new XMLHttpRequest();
              x.open('GET', r.url);
              x.onloadend = () => {
                result[r.url] = 'xhr-status-' + String(x.status);
                resolve();
              };
              x.send();
            }),
          );
        } else if (r.kind === 'beacon') {
          result[r.url] = 'beacon-queued-' + String(navigator.sendBeacon(r.url, 'spike'));
        } else if (r.kind === 'image') {
          const img = new Image();
          img.src = r.url;
          result[r.url] = 'image-set';
        } else {
          const el = document.createElement('script');
          el.src = r.url;
          document.head.append(el);
          result[r.url] = 'script-added';
        }
      } catch (e) {
        result[r.url] = 'threw: ' + (e instanceof Error ? e.message : String(e));
      }
    }
    await Promise.race([Promise.allSettled(pending), new Promise((resolve) => setTimeout(resolve, 8000))]);
    return result;
  }, list);
  await page.waitForTimeout(SETTLE_MS);
  return out;
}

function hitsOf(c: string): Hit[] {
  return session().server.hits.filter((h) => h.c === c);
}

function sentCount(c: string): number {
  return hitsOf(c).filter((h) => h.method !== 'OPTIONS').length;
}

function perCase(events: SpikeEvent[], cases: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const c of cases) {
    const ev = events.filter((e) => e.c === c);
    out[c] = {
      beforeWithBody: ev.some((e) => e.l === 'body' && e.e === 'before'),
      beforePlain: ev.some((e) => e.l === 'plain' && e.e === 'before'),
      sendHeaders: ev.some((e) => e.e === 'send'),
      error: ev.find((e) => e.e === 'error')?.error ?? null,
      completedStatus: ev.find((e) => e.e === 'completed')?.status ?? null,
      type: ev.find((e) => e.e === 'before' || e.e === 'send')?.type ?? null,
      serverHits: sentCount(c),
      preflights: hitsOf(c).filter((h) => h.method === 'OPTIONS').length,
    };
  }
  return out;
}

async function workerControl(): Promise<{ cdp: CDPSession; stop(): Promise<void>; status(): string; detach(): Promise<void> }> {
  const s = session();
  if (s.ui.isClosed()) s.ui = await openUi(s.context, s.extId);
  const worker = await sw();
  const cdp = await s.context.newCDPSession(s.ui);
  let versionId = '';
  let status = 'unknown';
  cdp.on('ServiceWorker.workerVersionUpdated', ({ versions }) => {
    for (const v of versions) {
      if (v.scriptURL !== worker.url()) continue;
      if (v.runningStatus === 'running' || versionId === '') versionId = v.versionId;
      if (v.versionId === versionId) status = v.runningStatus;
    }
  });
  await cdp.send('ServiceWorker.enable');
  const deadline = Date.now() + 10_000;
  while (versionId === '' && Date.now() < deadline) await sleep(100);
  if (versionId === '') throw new Error('no service worker version id');
  return {
    cdp,
    stop: async () => {
      await cdp.send('ServiceWorker.stopWorker', { versionId });
    },
    status: () => status,
    detach: async () => {
      await cdp.detach().catch(() => undefined);
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Result file.

interface ResultDoc {
  updatedAt?: string;
  environment?: Record<string, unknown>;
  items: Record<string, unknown>;
}

function save(id: string, title: string, facts: Record<string, unknown>): void {
  mkdirSync(path.dirname(RESULTS_FILE), { recursive: true });
  let doc: ResultDoc = { items: {} };
  if (existsSync(RESULTS_FILE)) {
    try {
      const parsed = JSON.parse(readFileSync(RESULTS_FILE, 'utf8')) as Partial<ResultDoc>;
      doc = { ...parsed, items: parsed.items ?? {} };
    } catch {
      doc = { items: {} };
    }
  }
  const s = S;
  doc.updatedAt = new Date().toISOString();
  doc.environment = {
    chromium: s?.chromium ?? 'unknown',
    playwright: test.info().config.version,
    platform: process.platform + ' ' + process.arch + ' ' + os.release(),
    headless: true,
    channel: 'chromium',
  };
  doc.items[id] = { title, at: new Date().toISOString(), chromium: s?.chromium ?? 'unknown', facts };
  writeFileSync(RESULTS_FILE, JSON.stringify(doc, null, 2) + '\n');
}

async function probe<T>(facts: Record<string, unknown>, key: string, fn: () => Promise<T>): Promise<T | undefined> {
  try {
    const v = await fn();
    facts[key] = v;
    return v;
  } catch (e) {
    facts[key] = { threw: message(e) };
    return undefined;
  }
}

const CANDIDATE = { annotation: { type: 'candidate', description: 'ADR-020 §14 spike fact; candidate until reviewed' } };

// ---------------------------------------------------------------------------------------------------------------

test.describe('ADR-020 protect spike', () => {
  test.skip(!SPIKE_ENABLED, 'throwaway spike: run it explicitly by path (see the header) or with DETECT_PROTECT_SPIKE=1');

  test.beforeAll(async () => {
    const extDir = mkdtempSync(path.join(os.tmpdir(), 'detect-expert-spike-ext-'));
    for (const f of ['manifest.json', 'sw.js', 'page.html']) cpSync(path.join(here, f), path.join(extDir, f));
    for (const [name, body] of Object.entries(CONTENT_SCRIPTS)) writeFileSync(path.join(extDir, name), body);
    const userDataDir = mkdtempSync(path.join(os.tmpdir(), 'detect-expert-spike-profile-'));
    const server = await startSpikeServer();
    const context = await launchBrowser(userDataDir, extDir);
    const first = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    const extId = new URL(first.url()).host;
    const ui = await openUi(context, extId);
    const web = await context.newPage();
    let version = context.browser()?.version() ?? '';
    if (version === '') {
      const cdp = await context.newCDPSession(ui);
      version = (await cdp.send('Browser.getVersion')).product;
      await cdp.detach();
    }
    S = { context, userDataDir, extDir, extId, ui, web, server, chromium: version };
    const grant = await ensureAllSites();
    expect(await spike<boolean>('contains', undefined, ALL_SITES), 'all-sites grant: ' + JSON.stringify(grant)).toBe(true);
    await web.goto(WEB('www.example.com', 'start'));
  });

  test.afterAll(async () => {
    const s = S;
    S = undefined;
    if (s === undefined) return;
    await s.context.close().catch(() => undefined);
    await s.server.close();
    rmSync(s.userDataDir, { recursive: true, force: true, maxRetries: 3 });
    rmSync(s.extDir, { recursive: true, force: true, maxRetries: 3 });
  });

  test('SP-1 optional declarativeNetRequestWithHostAccess: load, request by click, contains, live SW, remove', CANDIDATE, async () => {
    test.setTimeout(120_000);
    const facts: Record<string, unknown> = {};
    const worker = await sw();
    facts['manifestLoaded'] = true;
    facts['manifest'] = await call(worker, 'manifest');
    const bootBefore = await call<string>(worker, 'ping');
    await probe(facts, 'dnrBeforeGrant', () => call(worker, 'dnrInfo'));
    await probe(facts, 'containsBeforeGrant', () => call(worker, 'contains', [DNR]));
    await call(worker, 'clear');
    const request = await probe(facts, 'requestByClick', () => requestDnrByClick());
    await probe(facts, 'containsAfterRequest', () => spike('contains', [DNR]));
    const after = await sw();
    facts['sameWorkerAfterGrant'] = (await call<string>(after, 'ping')) === bootBefore;
    await probe(facts, 'dnrInRunningWorkerAfterGrant', () => call(after, 'dnrInfo'));
    await probe(facts, 'readApiInRunningWorkerAfterGrant', () => call(after, 'getRules'));
    await probe(facts, 'writeApiInRunningWorkerAfterGrant', () => call(after, 'writeProbe', 10_000));
    await probe(facts, 'permissionEventsAfterGrant', () => call(after, 'permissionEvents'));
    await probe(facts, 'remove', () => call(after, 'removeDnr'));
    await probe(facts, 'containsAfterRemove', () => call(after, 'contains', [DNR]));
    await probe(facts, 'dnrAfterRemove', () => call(after, 'dnrInfo').then((d) => (d as { type: string }).type));
    await probe(facts, 'readApiAfterRemove', () => call(after, 'getRules'));
    await probe(facts, 'rerequestByClick', () => requestDnrByClick());
    await probe(facts, 'containsAfterRerequest', () => spike('contains', [DNR]));
    await probe(facts, 'readApiAfterRerequestSameWorker', () => spike('getRules'));
    await probe(facts, 'writeApiAfterRerequestSameWorker', () => spike('writeProbe', 5000));
    facts['sameWorkerAfterRerequest'] = (await spike<string>('ping')) === bootBefore;
    // Same calls in a freshly started worker (CDP ServiceWorker.stopWorker, then a runtime message wakes it).
    const control = await workerControl();
    try {
      await control.stop();
    } finally {
      await control.detach();
    }
    const restarted = await sw();
    facts['restartedWorker'] = (await call<string>(restarted, 'ping')) !== bootBefore;
    await probe(facts, 'dnrInRestartedWorker', () => call<{ type: string }>(restarted, 'dnrInfo').then((d) => d.type));
    await probe(facts, 'readApiInRestartedWorker', () => call(restarted, 'getRules'));
    await probe(facts, 'writeApiInRestartedWorker', () => call(restarted, 'writeProbe', 5000));
    // Browser restart with the same profile: the extension is loaded with the permission already granted.
    await restartBrowser();
    await probe(facts, 'containsAfterBrowserRestart', () => spike('contains', [DNR]));
    await probe(facts, 'writeApiAfterBrowserRestart', () => spike('writeProbe', 5000));
    await probe(facts, 'hostsAfterBrowserRestart', () => spike('contains', undefined, ALL_SITES));
    await ensureAllSites();
    facts['grantedWithoutNativeDialog'] = request?.settled === true && request.granted === true;
    save('SP-1', 'optional declarativeNetRequestWithHostAccess', facts);
    expect(facts['manifestLoaded']).toBe(true);
  });

  test('SP-1 control: the same extension with declarativeNetRequestWithHostAccess as a required permission', CANDIDATE, async () => {
    test.setTimeout(60_000);
    const facts: Record<string, unknown> = {};
    const s = session();
    const extDir = mkdtempSync(path.join(os.tmpdir(), 'detect-expert-spike-ext-required-'));
    const userDataDir = mkdtempSync(path.join(os.tmpdir(), 'detect-expert-spike-profile-required-'));
    try {
      for (const f of ['sw.js', 'page.html']) cpSync(path.join(s.extDir, f), path.join(extDir, f));
      const manifest = JSON.parse(readFileSync(path.join(s.extDir, 'manifest.json'), 'utf8')) as { permissions: string[]; optional_permissions?: string[] };
      manifest.permissions = [...manifest.permissions, DNR];
      delete manifest.optional_permissions;
      writeFileSync(path.join(extDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
      const context = await launchBrowser(userDataDir, extDir);
      try {
        const first = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
        const worker = await liveSw(context);
        facts['sameExtensionId'] = new URL(first.url()).host === s.extId;
        facts['contains'] = await call(worker, 'contains', [DNR]);
        facts['writeApi'] = await call(worker, 'writeProbe', 5000);
      } finally {
        await context.close();
      }
    } finally {
      rmSync(userDataDir, { recursive: true, force: true, maxRetries: 3 });
      rmSync(extDir, { recursive: true, force: true, maxRetries: 3 });
    }
    save('SP-1-control', 'required declarativeNetRequestWithHostAccess (control)', facts);
    expect(facts['contains']).toBe(true);
  });

  test('SP-2 DNR block: onBeforeRequest (with/without requestBody), onErrorOccurred, onSendHeaders', CANDIDATE, async () => {
    test.setTimeout(120_000);
    const facts: Record<string, unknown> = {};
    const s = session();
    facts['dnrGranted'] = await ensureDnr();
    if (facts['dnrGranted'] !== true) {
      save('SP-2', 'DNR block visibility', facts);
      return;
    }
    await spike('unlistenAll');
    await spike('clear');
    await spike('listen', 'body', { beforeRequest: 'body' });
    await spike('listen', 'plain', { beforeRequest: 'plain', sendHeaders: 'plain', errors: true, completed: true });
    await s.web.goto(WEB('www.example.com', 'sp2'));
    const kinds: FireKind[] = ['fetch', 'xhr', 'beacon', 'image', 'script'];
    facts['blockRule'] = await spike('setRules', [{ id: 1, priority: 1, action: { type: 'block' }, condition: { requestDomains: ['collect.example.net'] } }], []);
    facts['pageBlocked'] = await fire(s.web, kinds.map((k) => ({ kind: k, url: SINK('collect.example.net', 'b-' + k) })));
    const blocked = await spike<SpikeEvent[]>('events');
    facts['blocked'] = perCase(blocked, kinds.map((k) => 'b-' + k));
    await spike('setRules', [], []);
    await spike('clear');
    facts['pageSent'] = await fire(s.web, kinds.map((k) => ({ kind: k, url: SINK('collect.example.net', 's-' + k) })));
    const sent = await spike<SpikeEvent[]>('events');
    facts['sent'] = perCase(sent, kinds.map((k) => 's-' + k));
    await spike('unlistenAll');
    save('SP-2', 'DNR block visibility', facts);
    expect(Object.keys(facts['blocked'] as object).length).toBe(kinds.length);
  });

  test('SP-14 webRequest type of fetch, sendBeacon, XHR, image, script', CANDIDATE, async () => {
    test.setTimeout(60_000);
    const facts: Record<string, unknown> = {};
    const s = session();
    await spike('unlistenAll');
    await spike('clear');
    await spike('listen', 'plain', { beforeRequest: 'plain' });
    const kinds: FireKind[] = ['fetch', 'xhr', 'beacon', 'image', 'script'];
    await fire(s.web, kinds.map((k) => ({ kind: k, url: SINK('collect.example.net', 't-' + k) })));
    const ev = await spike<SpikeEvent[]>('events');
    for (const k of kinds) facts[k] = ev.find((e) => e.c === 't-' + k)?.type ?? null;
    await spike('unlistenAll');
    save('SP-14', 'webRequest resource type per page API', facts);
    expect(Object.keys(facts)).toHaveLength(kinds.length);
  });

  test('SP-3 requestBody presence and form per request kind and size', CANDIDATE, async () => {
    test.setTimeout(180_000);
    const facts: Record<string, unknown> = {};
    const s = session();
    await spike('unlistenAll');
    await spike('clear');
    await spike('listen', 'body', { beforeRequest: 'body' });
    await s.web.goto(WEB('www.example.com', 'sp3'));
    facts['page'] = await s.web.evaluate(async () => {
      const sink = (c: string): string => '/spike/sink?case=' + c;
      const out: Record<string, string> = {};
      const run = async (c: string, fn: () => Promise<unknown> | unknown): Promise<void> => {
        try {
          await fn();
          out[c] = 'ok';
        } catch (e) {
          out[c] = 'error: ' + (e instanceof Error ? e.message : String(e));
        }
      };
      const form = (): FormData => {
        const fd = new FormData();
        fd.append('alpha', '1');
        fd.append('beta', '2');
        return fd;
      };
      const bytes = (n: number): Uint8Array<ArrayBuffer> => new Uint8Array(new ArrayBuffer(n)).fill(97);
      const beacon = (c: string, body: BodyInit): void => {
        if (!navigator.sendBeacon(sink(c), body)) throw new Error('sendBeacon returned false');
      };
      await Promise.all([
        run('fetch-string', () => fetch(sink('fetch-string'), { method: 'POST', body: 'alpha=1&beta=2' })),
        run('fetch-json', () => fetch(sink('fetch-json'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"alpha":1}' })),
        run('fetch-urlsearchparams', () => fetch(sink('fetch-urlsearchparams'), { method: 'POST', body: new URLSearchParams({ alpha: '1', beta: '2' }) })),
        run('fetch-formdata', () => fetch(sink('fetch-formdata'), { method: 'POST', body: form() })),
        run('fetch-blob', () => fetch(sink('fetch-blob'), { method: 'POST', body: new Blob(['alpha=1'], { type: 'text/plain' }) })),
        run('fetch-arraybuffer', () => fetch(sink('fetch-arraybuffer'), { method: 'POST', body: new TextEncoder().encode('alpha=1').buffer })),
        run('fetch-stream', () =>
          fetch(sink('fetch-stream'), {
            method: 'POST',
            body: new ReadableStream({
              start(controller) {
                controller.enqueue(new TextEncoder().encode('alpha=1'));
                controller.close();
              },
            }),
            duplex: 'half',
          } as RequestInit),
        ),
        run('fetch-keepalive', () => fetch(sink('fetch-keepalive'), { method: 'POST', body: 'alpha=1', keepalive: true })),
        run('fetch-put', () => fetch(sink('fetch-put'), { method: 'PUT', body: 'alpha=1' })),
        run('fetch-patch', () => fetch(sink('fetch-patch'), { method: 'PATCH', body: 'alpha=1' })),
        run(
          'xhr-string',
          () =>
            new Promise<void>((resolve, reject) => {
              const x = new XMLHttpRequest();
              x.open('POST', sink('xhr-string'));
              x.onload = () => resolve();
              x.onerror = () => reject(new Error('xhr error'));
              x.send('alpha=1');
            }),
        ),
        run('beacon-string', () => beacon('beacon-string', 'alpha=1')),
        run('beacon-blob', () => beacon('beacon-blob', new Blob(['alpha=1'], { type: 'text/plain' }))),
        run('beacon-formdata', () => beacon('beacon-formdata', form())),
        run('size-64k', () => fetch(sink('size-64k'), { method: 'POST', body: bytes(64 * 1024) })),
        run('size-1m', () => fetch(sink('size-1m'), { method: 'POST', body: bytes(1024 * 1024) })),
        run('size-32m', () => fetch(sink('size-32m'), { method: 'POST', body: bytes(32 * 1024 * 1024) })),
      ]);
      (document.getElementById('f-url') as HTMLFormElement).submit();
      (document.getElementById('f-multi') as HTMLFormElement).submit();
      out['form-urlencoded'] = 'submitted';
      out['form-multipart'] = 'submitted';
      return out;
    });
    await s.web.waitForTimeout(2500);
    const ev = await spike<SpikeEvent[]>('events');
    const cases = Object.keys(facts['page'] as Record<string, string>);
    const perKind: Record<string, unknown> = {};
    for (const c of cases) {
      const e = ev.find((x) => x.c === c);
      perKind[c] = e === undefined ? { seen: false, serverHits: sentCount(c) } : { seen: true, type: e.type, method: e.method, body: e.body, serverHits: sentCount(c) };
    }
    facts['requestBody'] = perKind;
    await spike('unlistenAll');
    save('SP-3', 'requestBody per request kind and size', facts);
    expect(cases.length).toBeGreaterThan(10);
  });

  test('SP-4 storage.local.setAccessLevel(TRUSTED_CONTEXTS) and content-script view', CANDIDATE, async () => {
    test.setTimeout(60_000);
    const facts: Record<string, unknown> = {};
    const s = session();
    await s.web.goto(WEB('www.example.com', 'sp4'));
    await spike('storageSeed');
    const tabId = await spike<number>('tabIdOf', 'http://www.example.com:' + String(P1) + '/');
    facts['tabFound'] = tabId >= 0;
    await probe(facts, 'contentScriptBefore', () => spike('probeStorage', tabId));
    await probe(facts, 'setAccessLevelLocal', () => spike('setAccessLevel'));
    await probe(facts, 'contentScriptAfter', () => spike('probeStorage', tabId));
    await probe(facts, 'resetAccessLevel', () => spike('resetAccessLevel'));
    save('SP-4', 'storage.local access level', facts);
    expect(facts['tabFound']).toBe(true);
  });

  test('SP-9 DNR conditions: excluded domains, IP, initiator host access, topDomains, limits', CANDIDATE, async () => {
    test.setTimeout(180_000);
    const facts: Record<string, unknown> = {};
    const s = session();
    facts['dnrGranted'] = await ensureDnr();
    if (facts['dnrGranted'] !== true) {
      save('SP-9', 'DNR conditions', facts);
      return;
    }
    await probe(facts, 'dnrInfo', () => spike('dnrInfo'));
    const block = (id: number, condition: Record<string, unknown>): Record<string, unknown> => ({ id, priority: 1, action: { type: 'block' }, condition });
    const one = async (key: string, rule: Record<string, unknown> | null, from: string, fromPort: number, target: string): Promise<void> => {
      const c = key;
      const applied = rule === null ? { ok: true } : await spike<Attempt<unknown>>('setRules', [rule], []);
      await s.web.goto(WEB(from, 'from-' + c, fromPort));
      await fire(s.web, [{ kind: 'fetch', url: target + (target.includes('?') ? '&' : '?') + 'case=' + c }]);
      facts[key] = { applied, serverHits: sentCount(c) };
      await spike('setRules', [], []);
    };
    const target = (host: string, port = P2): string => 'http://' + host + ':' + String(port) + '/spike/sink';
    // excludedInitiatorDomains / excludedRequestDomains with a registrable domain.
    await one('exclInit-from-www.example.com', block(901, { requestDomains: ['collect.example.net'], excludedInitiatorDomains: ['example.com'] }), 'www.example.com', P1, target('collect.example.net'));
    await one('exclInit-from-www.example.org', block(902, { requestDomains: ['collect.example.net'], excludedInitiatorDomains: ['example.com'] }), 'www.example.org', P1, target('collect.example.net'));
    await one('exclReq-to-collect.example.net', block(903, { requestDomains: ['example.net'], excludedRequestDomains: ['collect.example.net'] }), 'www.example.com', P1, target('collect.example.net'));
    await one('exclReq-to-other.example.net', block(904, { requestDomains: ['example.net'], excludedRequestDomains: ['collect.example.net'] }), 'www.example.com', P1, target('other.example.net'));
    // IP literals.
    await one('ip-requestDomains-127.0.0.1', block(905, { requestDomains: ['127.0.0.1'] }), 'www.example.com', P1, target('127.0.0.1'));
    await one('ip-exclInit-from-127.0.0.1', block(906, { requestDomains: ['collect.example.net'], excludedInitiatorDomains: ['127.0.0.1'] }), '127.0.0.1', P1, target('collect.example.net'));
    await one('ip-control-from-127.0.0.1-no-exclusion', block(907, { requestDomains: ['collect.example.net'] }), '127.0.0.1', P1, target('collect.example.net'));
    // topDomains (Chrome support is the question).
    await one('topDomains-from-www.example.com', block(908, { requestDomains: ['collect.example.net'], topDomains: ['example.com'] }), 'www.example.com', P1, target('collect.example.net'));
    await one('topDomains-from-www.example.org', block(909, { requestDomains: ['collect.example.net'], topDomains: ['example.com'] }), 'www.example.org', P1, target('collect.example.net'));
    await one('excludedTopDomains-from-www.example.com', block(910, { requestDomains: ['collect.example.net'], excludedTopDomains: ['example.com'] }), 'www.example.com', P1, target('collect.example.net'));
    // Host access: grant only the target (http://*.example.net/*), then target + initiator.
    facts['revokeAll'] = await hostGrants('remove', ALL_SITES);
    facts['grantTargetOnly'] = await hostGrants('add', ['http://*.example.net/*']);
    facts['containsTargetOnly'] = { target: await spike('contains', undefined, ['http://collect.example.net/*']), initiator: await spike('contains', undefined, ['http://www.example.com/*']) };
    await one('hostAccess-targetOnly-block', block(911, { requestDomains: ['collect.example.net'] }), 'www.example.com', P1, target('collect.example.net'));
    const gpcRule = { id: 912, priority: 1, action: { type: 'modifyHeaders', requestHeaders: [{ header: 'Sec-GPC', operation: 'set', value: '1' }] }, condition: { requestDomains: ['collect.example.net'] } };
    await one('hostAccess-targetOnly-modifyHeaders', gpcRule, 'www.example.com', P1, target('collect.example.net'));
    facts['hostAccess-targetOnly-modifyHeaders-secGpc'] = hitsOf('hostAccess-targetOnly-modifyHeaders').map((h) => h.secGpc);
    facts['grantInitiatorToo'] = await hostGrants('add', ['http://*.example.com/*']);
    await one('hostAccess-both-block', block(913, { requestDomains: ['collect.example.net'] }), 'www.example.com', P1, target('collect.example.net'));
    await one('hostAccess-both-modifyHeaders', { ...gpcRule, id: 914 }, 'www.example.com', P1, target('collect.example.net'));
    facts['hostAccess-both-modifyHeaders-secGpc'] = hitsOf('hostAccess-both-modifyHeaders').map((h) => h.secGpc);
    facts['restore'] = await hostGrants('remove', ['http://*.example.net/*', 'http://*.example.com/*']);
    facts['restoreAll'] = await hostGrants('add', ALL_SITES);
    facts['containsAllAfterRestore'] = await spike('contains', undefined, ALL_SITES);
    save('SP-9', 'DNR conditions', facts);
    expect(facts['containsAllAfterRestore']).toBe(true);
  });

  test('SP-10 modifyHeaders Sec-GPC: 1 — server, onSendHeaders, worker, WebSocket, preflight, stopped SW', CANDIDATE, async () => {
    test.setTimeout(180_000);
    const facts: Record<string, unknown> = {};
    const s = session();
    facts['dnrGranted'] = await ensureDnr();
    if (facts['dnrGranted'] !== true) {
      save('SP-10', 'Sec-GPC modifyHeaders', facts);
      return;
    }
    const types = await spike<string[]>('allResourceTypes');
    facts['resourceTypes'] = types;
    facts['rule'] = await spike('setRules', [{ id: 1, priority: 100, action: { type: 'modifyHeaders', requestHeaders: [{ header: 'Sec-GPC', operation: 'set', value: '1' }] }, condition: { resourceTypes: types } }], []);
    await spike('unlistenAll');
    await spike('clear');
    await spike('listen', 'headers', { sendHeaders: 'headers', urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] });
    await s.web.goto(WEB('www.example.com', 'gpc-nav'));
    facts['page'] = await s.web.evaluate(async ({ frameUrl, crossUrl, beaconUrl, imageUrl, wsUrl }) => {
      const out: Record<string, string> = {};
      const frame = document.createElement('iframe');
      frame.src = frameUrl;
      document.body.append(frame);
      try {
        await fetch('/spike/sink?case=gpc-fetch-same', { cache: 'no-store' });
        out['gpc-fetch-same'] = 'ok';
      } catch (e) {
        out['gpc-fetch-same'] = String(e);
      }
      try {
        await fetch(crossUrl, { cache: 'no-store' });
        out['gpc-fetch-cross'] = 'resolved';
      } catch (e) {
        out['gpc-fetch-cross'] = 'rejected (no CORS headers): ' + (e instanceof Error ? e.message : String(e));
      }
      out['gpc-beacon'] = String(navigator.sendBeacon(beaconUrl, 'x'));
      const img = new Image();
      img.src = imageUrl;
      out['worker'] = await new Promise<string>((resolve) => {
        const w = new Worker('/spike/worker.js');
        w.onmessage = (m) => resolve(String(m.data));
        w.onerror = () => resolve('worker-error');
        setTimeout(() => resolve('worker-timeout'), 5000);
      });
      out['gpc-ws'] = await new Promise<string>((resolve) => {
        const ws = new WebSocket(wsUrl);
        ws.onopen = () => {
          ws.close();
          resolve('open');
        };
        ws.onerror = () => resolve('error');
        setTimeout(() => resolve('timeout'), 5000);
      });
      return out;
    }, {
      frameUrl: 'http://www.example.org:' + String(P2) + '/spike/frame.html?case=gpc-iframe',
      crossUrl: SINK('collect.example.net', 'gpc-fetch-cross'),
      beaconUrl: SINK('collect.example.net', 'gpc-beacon'),
      imageUrl: SINK('collect.example.net', 'gpc-image'),
      wsUrl: 'ws://collect.example.net:' + String(P2) + '/ws?case=gpc-ws',
    });
    await s.web.waitForTimeout(SETTLE_MS);
    const ev = await spike<SpikeEvent[]>('events');
    const cases = ['gpc-nav', 'gpc-iframe', 'gpc-fetch-same', 'gpc-fetch-cross', 'gpc-beacon', 'gpc-image', '/spike/worker.js', 'worker-fetch', 'gpc-ws'];
    const per: Record<string, unknown> = {};
    for (const c of cases) {
      per[c] = {
        server: hitsOf(c).map((h) => ({ method: h.method, secGpc: h.secGpc, upgrade: h.upgrade })),
        onSendHeaders: ev.filter((e) => e.c === c).map((e) => ({ type: e.type, gpc: e.gpc ?? null })),
      };
    }
    facts['perCase'] = per;
    // Rule in force while the SW is stopped.
    const control = await workerControl();
    try {
      await control.stop();
      const deadline = Date.now() + 10_000;
      while (control.status() !== 'stopped' && Date.now() < deadline) await sleep(100);
      facts['swStatusBeforeRequests'] = control.status();
      await s.web.goto(WEB('www.example.com', 'gpc-nav-sw-stopped'));
      await fire(s.web, [{ kind: 'fetch', url: SINK('collect.example.net', 'gpc-fetch-sw-stopped') }]);
      facts['swStatusAfterRequests'] = control.status();
      facts['swStopped'] = {
        nav: hitsOf('gpc-nav-sw-stopped').map((h) => h.secGpc),
        fetch: hitsOf('gpc-fetch-sw-stopped').map((h) => h.secGpc),
      };
    } finally {
      await control.detach();
    }
    await spike('setRules', [], []);
    await spike('unlistenAll');
    save('SP-10', 'Sec-GPC modifyHeaders', facts);
    expect(facts['perCase']).toBeDefined();
  });

  test('SP-11 onBeforeRequest with filter.tabId and requestBody after an optional host grant', CANDIDATE, async () => {
    test.setTimeout(120_000);
    const facts: Record<string, unknown> = {};
    const s = session();
    await s.web.goto(WEB('www.example.com', 'sp11'));
    const tabId = await spike<number>('tabIdOf', 'http://www.example.com:' + String(P1) + '/');
    facts['tabFound'] = tabId >= 0;
    await spike('unlistenAll');
    await spike('clear');
    facts['revoke'] = await hostGrants('remove', ALL_SITES);
    facts['containsAfterRevoke'] = await spike('contains', undefined, ALL_SITES);
    await spike('listen', 'pre', { beforeRequest: 'body' });
    facts['grant'] = await hostGrants('add', ALL_SITES);
    facts['containsAfterGrant'] = await spike('contains', undefined, ALL_SITES);
    await spike('listen', 'post', { beforeRequest: 'body', tabId });
    await s.web.evaluate(async () => {
      await fetch('/spike/sink?case=sp11-post', { method: 'POST', body: 'alpha=1' });
    });
    await s.web.waitForTimeout(SETTLE_MS);
    const ev = await spike<SpikeEvent[]>('events');
    facts['registeredBeforeGrant'] = ev.filter((e) => e.l === 'pre' && e.c === 'sp11-post').map((e) => ({ type: e.type, body: e.body, tabMatches: e.tabId === tabId }));
    facts['registeredAfterGrantTabFilter'] = ev.filter((e) => e.l === 'post' && e.c === 'sp11-post').map((e) => ({ type: e.type, body: e.body, tabMatches: e.tabId === tabId }));
    facts['permissionEvents'] = await spike('permissionEvents');
    await spike('unlistenAll');
    save('SP-11', 'listener after optional grant', facts);
    expect(facts['containsAfterGrant']).toBe(true);
  });

  test('SP-12 MAIN content script: null-prototype captureStackTrace, frame URL, prepareStackTrace accessor, clocks', CANDIDATE, async () => {
    test.setTimeout(120_000);
    const facts: Record<string, unknown> = {};
    const s = session();
    await spike('unregisterAll');
    facts['register'] = await spike('register', [{ id: 'spike-main-stack', js: ['cs-main-stack.js'], matches: ['http://*/*'], runAt: 'document_start', world: 'MAIN', allFrames: false, persistAcrossSessions: false }]);
    await s.web.goto(WEB('www.example.com', 'sp12'));
    await probe(facts, 'nullPrototypeCapture', () =>
      s.web.evaluate(() => (window as unknown as { __spikeMain: { nullProtoCapture(): unknown } }).__spikeMain.nullProtoCapture()),
    );
    await probe(facts, 'wrapperFrame', () =>
      s.web.evaluate(() => {
        const main = (window as unknown as { __spikeMain: { wrap(cb: () => unknown): unknown } }).__spikeMain;
        const stack = String(main.wrap(() => new Error('spike').stack));
        const lines = stack.split('\n');
        const ext = lines.filter((l) => l.includes('chrome-extension://'));
        return { lines: lines.length, extensionFrames: ext.length, wrapFrame: ext.map((l) => l.replace(/chrome-extension:\/\/[a-p]{32}/, 'chrome-extension://<id>').trim()).slice(0, 2) };
      }),
    );
    await probe(facts, 'prepareStackTraceAccessor', () =>
      s.web.evaluate(() => {
        const main = (window as unknown as { __spikeMain: { prechecked(): { sampled: boolean }; naive(): { sampled: boolean; length: number } } }).__spikeMain;
        let calls = 0;
        Object.defineProperty(Object.prototype, 'prepareStackTrace', {
          get() {
            calls++;
            return undefined;
          },
          configurable: true,
        });
        const pre = main.prechecked();
        const callsAfterPrechecked = calls;
        const naive = main.naive();
        const callsAfterNaive = calls;
        delete (Object.prototype as unknown as Record<string, unknown>)['prepareStackTrace'];
        const clean = main.prechecked();
        return { prechecked: pre, callsAfterPrechecked, naive, callsAfterNaive, cleanAfterRemoval: clean };
      }),
    );
    const tabId = await spike<number>('tabIdOf', 'http://www.example.com:' + String(P1) + '/');
    const time = await probe(facts, 'clockSamples', () => spike<Attempt<{ samples: Array<{ before: number; after: number; main: number }>; originIsolated: number; originMain: number }>>('probeTime', tabId));
    if (time?.ok === true && time.value !== undefined) {
      const v = time.value;
      const deltas = v.samples.map((x) => Math.max(Math.abs(x.main - x.before), Math.abs(x.after - x.main)));
      facts['clock'] = {
        maxDeltaMs: Math.max(...deltas),
        mainWithinIsolatedWindow: v.samples.every((x) => x.main >= x.before && x.main <= x.after),
        sameTimeOrigin: v.originIsolated === v.originMain,
        samples: v.samples.length,
      };
      delete facts['clockSamples'];
    }
    await spike('unregisterAll');
    save('SP-12', 'MAIN-world stack sampling and clocks', facts);
    expect(facts['register']).toBeDefined();
  });

  test('SP-13 crypto.subtle in ISOLATED/MAIN on an http page (non-secure) and on 127.0.0.1', CANDIDATE, async () => {
    test.setTimeout(60_000);
    const facts: Record<string, unknown> = {};
    const s = session();
    await s.web.goto(WEB('www.example.com', 'sp13'));
    let tabId = await spike<number>('tabIdOf', 'http://www.example.com:' + String(P1) + '/');
    await probe(facts, 'wwwExampleComIsolated', () => spike('probeCrypto', tabId, 'ISOLATED'));
    await probe(facts, 'wwwExampleComMain', () => spike('probeCrypto', tabId, 'MAIN'));
    await s.web.goto(WEB('127.0.0.1', 'sp13-ip'));
    tabId = await spike<number>('tabIdOf', 'http://127.0.0.1:' + String(P1) + '/');
    await probe(facts, 'loopbackIsolated', () => spike('probeCrypto', tabId, 'ISOLATED'));
    save('SP-13', 'crypto.subtle availability', facts);
    expect(facts['wwwExampleComIsolated']).toBeDefined();
  });

  test('SP-6 chrome.action.openPopup without a user gesture (informational)', CANDIDATE, async () => {
    test.setTimeout(60_000);
    const facts: Record<string, unknown> = {};
    const s = session();
    await s.web.bringToFront();
    const pageTargets = async (): Promise<number | string> => {
      const browser = s.context.browser();
      if (browser === null) return 'browser handle unavailable';
      const cdp = await browser.newBrowserCDPSession();
      try {
        const { targetInfos } = await cdp.send('Target.getTargets');
        return targetInfos.filter((t) => t.url === 'chrome-extension://' + s.extId + '/page.html').length;
      } finally {
        await cdp.detach();
      }
    };
    const before = s.context.pages().length;
    facts['pageHtmlTargetsBefore'] = await pageTargets();
    await probe(facts, 'openPopup', () => spike('openPopup'));
    await sleep(1000);
    facts['pagesBefore'] = before;
    facts['pagesAfter'] = s.context.pages().length;
    facts['pageHtmlTargetsAfter'] = await pageTargets();
    save('SP-6', 'action.openPopup without gesture', facts);
    expect(facts['openPopup']).toBeDefined();
  });

  test('SP-8 IndexedDB in the SW: open, upgrade, deleteDatabase, survives ServiceWorker.stopWorker', CANDIDATE, async () => {
    test.setTimeout(120_000);
    const facts: Record<string, unknown> = {};
    const bootBefore = await spike<string>('ping');
    await probe(facts, 'scenario', () => spike('idbScenario'));
    const control = await workerControl();
    try {
      await control.stop();
      const deadline = Date.now() + 10_000;
      while (control.status() !== 'stopped' && Date.now() < deadline) await sleep(100);
      facts['statusAfterStop'] = control.status();
    } finally {
      await control.detach();
    }
    const worker = await sw();
    facts['restarted'] = (await call<string>(worker, 'ping')) !== bootBefore;
    await probe(facts, 'readAfterRestart', () => call(worker, 'idbRead'));
    save('SP-8', 'IndexedDB in the service worker', facts);
    expect(facts['scenario']).toBeDefined();
  });

  test('SP-7 registerContentScripts: excludeMatches + matchOriginAsFallback, two MAIN registrations, persistAcrossSessions', CANDIDATE, async () => {
    test.setTimeout(180_000);
    const facts: Record<string, unknown> = {};
    const s = session();
    await spike('unregisterAll');
    facts['isoWithExcludeAndFallback'] = await spike('register', [
      { id: 'spike-iso', js: ['cs-iso-mark.js'], matches: ['http://*/*'], excludeMatches: ['*://excluded.example.com/*'], allFrames: true, matchOriginAsFallback: true, runAt: 'document_start', world: 'ISOLATED', persistAcrossSessions: true },
    ]);
    facts['mainB'] = await spike('register', [{ id: 'spike-main-b', js: ['cs-main-b.js'], matches: ['http://*/*'], runAt: 'document_start', world: 'MAIN', persistAcrossSessions: false }]);
    facts['mainA'] = await spike('register', [{ id: 'spike-main-a', js: ['cs-main-a.js'], matches: ['http://*/*'], runAt: 'document_start', world: 'MAIN', persistAcrossSessions: false }]);
    facts['persistTrue'] = await spike('register', [{ id: 'spike-persist-true', js: ['cs-noop.js'], matches: ['http://*/*'], runAt: 'document_idle', persistAcrossSessions: true }]);
    facts['persistFalse'] = await spike('register', [{ id: 'spike-persist-false', js: ['cs-noop.js'], matches: ['http://*/*'], runAt: 'document_idle', persistAcrossSessions: false }]);
    facts['registered'] = await spike('registered');
    const marks = async (host: string, c: string): Promise<Record<string, unknown>> => {
      await s.web.goto(WEB(host, c));
      const top = await s.web.evaluate(() => ({ iso: document.documentElement.dataset['spikeIso'] ?? null, order: (window as unknown as { __spikeOrder?: string[] }).__spikeOrder ?? null }));
      // Playwright's frame.name() falls back to the id attribute when the iframe has no name.
      const blank = s.web.frames().find((f) => f.url() === 'about:blank' && f.name() === 'blank' && f !== s.web.mainFrame());
      let blankIso: string | null | 'no-frame' = 'no-frame';
      if (blank !== undefined) blankIso = await blank.evaluate(() => document.documentElement.dataset['spikeIso'] ?? null).catch(() => 'eval-failed');
      return { top, aboutBlankChildIso: blankIso };
    };
    const runs: unknown[] = [];
    for (let i = 0; i < 5; i++) runs.push(await marks('www.example.com', 'sp7-' + String(i)));
    facts['includedHostRuns'] = runs;
    facts['excludedHost'] = await marks('excluded.example.com', 'sp7-excluded');
    // Browser restart with the same profile: which registrations and DNR rules survive?
    const dnr = await ensureDnr();
    facts['dnrGrantedBeforeRestart'] = dnr;
    if (dnr) facts['rulesBeforeRestart'] = await spike('setRules', [{ id: 70, priority: 1, action: { type: 'block' }, condition: { requestDomains: ['restart.example.net'] } }], [{ id: 71, priority: 1, action: { type: 'block' }, condition: { requestDomains: ['restart-session.example.net'] } }]);
    await restartBrowser();
    const worker = await sw();
    facts['afterBrowserRestart'] = {
      registered: await call(worker, 'registered'),
      rules: await call(worker, 'getRules'),
      dnrContains: await call(worker, 'contains', [DNR]),
      hostsContain: await call(worker, 'contains', undefined, ALL_SITES),
    };
    await call(worker, 'setRules', [], []);
    await call(worker, 'unregisterAll');
    save('SP-7', 'registerContentScripts behaviour', facts);
    expect(facts['registered']).toBeDefined();
  });

  test('SP-5 dynamic/session rules after permissions.remove, re-grant and runtime.reload', CANDIDATE, async () => {
    test.setTimeout(180_000);
    const facts: Record<string, unknown> = {};
    const s = session();
    facts['dnrGranted'] = await ensureDnr();
    if (facts['dnrGranted'] !== true) {
      save('SP-5', 'rules across permission removal and reload', facts);
      return;
    }
    await ensureAllSites();
    const rules = {
      dynamic: [{ id: 50, priority: 1, action: { type: 'block' }, condition: { requestDomains: ['persist.example.net'] } }],
      session: [{ id: 51, priority: 1, action: { type: 'block' }, condition: { requestDomains: ['session.example.net'] } }],
    };
    facts['set'] = await spike('setRules', rules.dynamic, rules.session);
    const phase = async (name: string): Promise<Record<string, unknown>> => {
      await s.web.goto(WEB('www.example.com', 'p5-' + name));
      await fire(s.web, [
        { kind: 'fetch', url: SINK('persist.example.net', 'p5-' + name + '-dynamic') },
        { kind: 'fetch', url: SINK('session.example.net', 'p5-' + name + '-session') },
      ]);
      return {
        dnr: await spike('dnrInfo').then((d) => (d as { type: string }).type),
        rules: await spike('getRules'),
        dynamicRuleTargetHits: sentCount('p5-' + name + '-dynamic'),
        sessionRuleTargetHits: sentCount('p5-' + name + '-session'),
      };
    };
    facts['granted'] = await phase('granted');
    facts['remove'] = await spike('removeDnr');
    facts['containsAfterRemove'] = await spike('contains', [DNR]);
    facts['afterRemove'] = await phase('after-remove');
    facts['rerequest'] = await requestDnrByClick();
    facts['afterRegrant'] = await phase('after-regrant');
    facts['writeAfterRegrant'] = await spike('writeProbe', 3000);
    await restartBrowser();
    facts['hostsAfterBrowserRestart'] = await spike('contains', undefined, ALL_SITES);
    await ensureAllSites();
    facts['afterBrowserRestart'] = await phase('after-browser-restart');
    facts['writeAfterBrowserRestart'] = await spike('writeProbe', 5000);
    // chrome.runtime.reload last: in this harness the unpacked extension may not come back (state recorded).
    await spike('reload');
    await sleep(3000);
    const page = await s.context.newPage();
    try {
      await page.goto('chrome://extensions');
      facts['extensionStateAfterRuntimeReload'] = await page.evaluate(async (id) => {
        const api = (chrome as unknown as {
          developerPrivate: { getExtensionsInfo(o: { includeDisabled: boolean; includeTerminated: boolean }): Promise<Array<{ id: string; state: string; disableReasons: Record<string, boolean> }>> };
        }).developerPrivate;
        const info = (await api.getExtensionsInfo({ includeDisabled: true, includeTerminated: true })).find((e) => e.id === id);
        if (info === undefined) return null;
        return { state: info.state, disableReasons: Object.entries(info.disableReasons).filter(([, v]) => v).map(([k]) => k) };
      }, s.extId);
    } finally {
      await page.close();
    }
    const state = facts['extensionStateAfterRuntimeReload'] as { state: string } | null;
    if (state?.state === 'ENABLED') {
      s.ui = await openUi(s.context, s.extId);
      facts['afterRuntimeReload'] = await phase('after-runtime-reload');
      await spike('setRules', [], []);
    }
    save('SP-5', 'rules across permission removal, re-grant, browser restart and runtime.reload', facts);
    expect(facts['set']).toBeDefined();
  });
});
