// Loopback fixture server for the extension tests (spec V §9, E02-01: two distinct origins on 127.0.0.1).
// Serves static files from ./fixtures only, never adds CORS headers (canvas-tainted relies on that) and
// answers /slow after 5 s (aborted-navigation scenario). There is deliberately no /_dump or any other
// ingestion route: the extension has no network (REQ-010) and tests read reports only through the SW.
// S08 / E10-01: GET /ws with `Upgrade: websocket` gets an RFC 6455 101 handshake so a fixture page can open a
// WebSocket; frames are never read (nothing a page sends is accepted), every other upgrade is destroyed.
// S10 / E12-01: /vendors/synthetic/slow-loader.js answers like /slow (after the delay, with the no-op loader) so the
// aborted-request scenario can cancel it; missing-loader.js has no file and gets 404. stats.syntheticVendorRequests
// counts requests for /vendors/synthetic/*loader.js (the dom-without-load scenario asserts that none happened).
// ADR-020 (S03): route plugins tests/fixture-routes/*.mjs (`export default { match(req), handle(req, res, stats),
// upgrade?(req, socket, stats) }`, see tests/fixture-routes/README.md) answer the module's receiver endpoints. They get
// a frozen view { method, url, pathname, host, headers } instead of the request: the body is drained unread
// (req.resume()) before handle(), and only counters go to stats.routes[<file name>]. Paths under /_ stay rejected.
// Module: startFixtureServer([4173, 4174]). Standalone: node tests/fixture-server.mjs

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const fixturesDir = path.join(repoRoot, 'fixtures');
export const fixtureRoutesDir = path.join(repoRoot, 'tests', 'fixture-routes');
export const FIXTURE_PORTS = [4173, 4174];
export const SLOW_DELAY_MS = 5000;
/** RFC 6455 §1.3 GUID appended to Sec-WebSocket-Key before hashing. */
export const WEBSOCKET_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
};

const SYNTHETIC_VENDOR_PREFIX = '/vendors/synthetic/';
const SLOW_LOADER_PATH = SYNTHETIC_VENDOR_PREFIX + 'slow-loader.js';

const SLOW_BODY =
  '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>slow</title></head>' +
  '<body><h1>slow page</h1><pre id="result">{"fixture":"slow"}</pre></body></html>\n';

function text(res, status, body, stats, rejected) {
  if (rejected) stats.rejected++;
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-cache' });
  res.end(body);
}

/**
 * ADR-020 (S03): loads the route plugins of `dir` (default tests/fixture-routes), sorted by file name. A plugin is
 * named after its file (without .mjs) and default-exports { match(view), handle(view, res, stats) } with an optional
 * upgrade(view, socket, stats). Throws on a malformed plugin.
 */
export async function loadFixtureRoutes(dir = fixtureRoutesDir) {
  if (!existsSync(dir)) return [];
  const routes = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.mjs')).sort()) {
    const route = (await import(pathToFileURL(path.join(dir, file)).href)).default;
    const name = file.slice(0, -'.mjs'.length);
    if (!/^[a-z][a-z0-9-]{0,31}$/.test(name)) throw new Error('fixture route ' + file + ': the file name must be a lowercase id');
    if (route === null || typeof route !== 'object' || typeof route.match !== 'function' || typeof route.handle !== 'function'
      || (route.upgrade !== undefined && typeof route.upgrade !== 'function')) {
      throw new Error('fixture route ' + file + ': default export must be { match(req), handle(req, res, stats), upgrade?(req, socket, stats) }');
    }
    routes.push({ name, match: route.match, handle: route.handle, upgrade: route.upgrade });
  }
  return routes;
}

/** What a route plugin sees of a request: no body, no socket. */
function requestView(req) {
  let pathname = '';
  try {
    pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
  } catch {
    pathname = '';
  }
  return Object.freeze({
    method: req.method ?? '',
    url: req.url ?? '/',
    pathname,
    host: String(req.headers.host ?? '').toLowerCase(),
    headers: Object.freeze({ ...req.headers }),
  });
}

/** The first plugin whose match(view) returns true, or null (a throwing matcher counts as no match). */
function matchRoute(routes, view) {
  for (const route of routes) {
    try {
      if (route.match(view) === true) return route;
    } catch {
      // a broken matcher never takes over other requests
    }
  }
  return null;
}

/** One counter bucket per plugin in stats.routes (created when absent). */
function routeStats(stats, routes) {
  if (stats.routes === undefined || stats.routes === null || typeof stats.routes !== 'object') stats.routes = {};
  for (const route of routes) if (stats.routes[route.name] === undefined) stats.routes[route.name] = {};
}

/** Request handler; `stats` is mutated so tests can assert what the browser actually requested. */
export function createFixtureHandler(stats, options = {}) {
  const slowDelayMs = options.slowDelayMs ?? SLOW_DELAY_MS;
  const timers = options.timers ?? new Set();
  const routes = options.routes ?? [];
  routeStats(stats, routes);
  return function handle(req, res) {
    stats.requests++;
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (url.pathname.startsWith(SYNTHETIC_VENDOR_PREFIX) && url.pathname.endsWith('loader.js')) stats.syntheticVendorRequests++;
    if (url.pathname === SLOW_LOADER_PATH) {
      stats.slowRequests++;
      let finished = false;
      const timer = setTimeout(() => {
        timers.delete(timer);
        if (res.destroyed || res.writableEnded) return;
        finished = true;
        res.writeHead(200, { 'content-type': CONTENT_TYPES['.js'], 'cache-control': 'no-cache' });
        res.end(readFileSync(path.join(fixturesDir, 'vendors', 'synthetic', 'loader.js')));
      }, slowDelayMs);
      timers.add(timer);
      res.on('close', () => {
        if (!finished) {
          stats.slowAborted++;
          clearTimeout(timer);
          timers.delete(timer);
        }
      });
      return;
    }
    if (url.pathname === '/slow') {
      stats.slowRequests++;
      let finished = false;
      const timer = setTimeout(() => {
        timers.delete(timer);
        if (res.destroyed || res.writableEnded) return;
        finished = true;
        res.writeHead(200, { 'content-type': CONTENT_TYPES['.html'], 'cache-control': 'no-cache' });
        res.end(SLOW_BODY);
      }, slowDelayMs);
      timers.add(timer);
      res.on('close', () => {
        if (!finished) {
          stats.slowAborted++;
          clearTimeout(timer);
          timers.delete(timer);
        }
      });
      return;
    }
    if (url.pathname.startsWith('/_')) {
      // No ingestion endpoints of any kind (REQ-010): nothing on the stand accepts data from a page.
      text(res, 404, 'no such endpoint: the fixture server has no ingestion routes', stats, true);
      return;
    }
    if (routes.length > 0) {
      const view = requestView(req);
      const route = matchRoute(routes, view);
      if (route !== null) {
        // ADR-020 (S03): bodies are drained unread; the plugin answers from the method, URL and headers only.
        req.resume();
        try {
          route.handle(view, res, stats);
        } catch {
          if (!res.headersSent) text(res, 500, 'fixture route failed: ' + route.name, stats, true);
          else res.destroy();
        }
        return;
      }
    }
    let rel;
    try {
      rel = decodeURIComponent(url.pathname);
    } catch {
      text(res, 400, 'bad path', stats, true);
      return;
    }
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.normalize(path.join(fixturesDir, rel));
    const inside = file.startsWith(fixturesDir + path.sep);
    if (!inside || !existsSync(file) || !statSync(file).isFile()) {
      text(res, 404, 'not found', stats, true);
      return;
    }
    const type = CONTENT_TYPES[path.extname(file)] ?? 'application/octet-stream';
    // no-cache (not no-store): pages stay BFCache-eligible while every request still hits the disk.
    res.writeHead(200, { 'content-type': type, 'cache-control': 'no-cache' });
    res.end(readFileSync(file));
  };
}

/** Sec-WebSocket-Accept for a client key (RFC 6455 §4.2.2): base64(sha1(key + GUID)). */
export function websocketAccept(key) {
  return createHash('sha1').update(key + WEBSOCKET_GUID).digest('base64');
}

/**
 * 'upgrade' handler: only GET /ws with a websocket upgrade and a 16-byte base64 key is accepted (101 response);
 * the socket is kept in `sockets` until it closes and is never read. Any other upgrade is destroyed.
 */
export function createUpgradeHandler(stats, sockets, routes = []) {
  routeStats(stats, routes);
  const upgradeRoutes = routes.filter((r) => typeof r.upgrade === 'function');
  return function upgrade(req, socket) {
    socket.on('error', () => {});
    // ADR-020 (S03): a route plugin with upgrade() may take its own upgrade requests (frames are never read).
    if (upgradeRoutes.length > 0) {
      const route = matchRoute(upgradeRoutes, requestView(req));
      if (route !== null) {
        sockets.add(socket);
        socket.on('close', () => sockets.delete(socket));
        try {
          route.upgrade(requestView(req), socket, stats);
        } catch {
          stats.rejected++;
          socket.destroy();
        }
        return;
      }
    }
    let pathname = '';
    try {
      pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
    } catch {
      pathname = '';
    }
    const key = req.headers['sec-websocket-key'];
    const isWebSocket = String(req.headers['upgrade'] ?? '').toLowerCase() === 'websocket';
    if (req.method !== 'GET' || pathname !== '/ws' || !isWebSocket || typeof key !== 'string' || !/^[A-Za-z0-9+/]{22}==$/.test(key)) {
      stats.rejected++;
      socket.destroy();
      return;
    }
    stats.websocketUpgrades++;
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('end', () => socket.destroy());
    const CRLF = '\r\n';
    socket.write(
      'HTTP/1.1 101 Switching Protocols' + CRLF +
        'Upgrade: websocket' + CRLF +
        'Connection: Upgrade' + CRLF +
        'Sec-WebSocket-Accept: ' + websocketAccept(key) + CRLF + CRLF,
    );
  };
}

function listen(port, handler, upgrade) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handler);
    server.on('upgrade', upgrade);
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

export async function startFixtureServer(ports = FIXTURE_PORTS, options = {}) {
  const stats = { requests: 0, slowRequests: 0, slowAborted: 0, rejected: 0, websocketUpgrades: 0, syntheticVendorRequests: 0, routes: {} };
  const timers = new Set();
  const sockets = new Set();
  const routes = options.routes ?? (await loadFixtureRoutes(options.routesDir ?? fixtureRoutesDir));
  const handler = createFixtureHandler(stats, { ...options, timers, routes });
  const upgrade = createUpgradeHandler(stats, sockets, routes);
  const servers = await Promise.all(ports.map((port) => listen(port, handler, upgrade)));
  return {
    origins: ports.map((port) => 'http://127.0.0.1:' + String(port)),
    ports: [...ports],
    stats,
    async close() {
      for (const t of timers) clearTimeout(t);
      timers.clear();
      // Upgraded sockets are detached from the HTTP server: closeAllConnections() does not reach them.
      for (const socket of sockets) socket.destroy();
      sockets.clear();
      // The browser keeps keep-alive sockets open; close() alone would wait for them until the test timeout.
      for (const s of servers) s.closeAllConnections();
      await Promise.all(servers.map((s) => new Promise((resolve) => s.close(() => resolve()))));
    },
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = await startFixtureServer();
  console.log('fixture server: ' + server.origins.join(', ') + ' (serving ' + fixturesDir + '; /slow answers after ' + String(SLOW_DELAY_MS) + ' ms)');
}
