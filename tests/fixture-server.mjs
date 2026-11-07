// Loopback fixture server for the extension tests (spec V §9, E02-01: two distinct origins on 127.0.0.1).
// Serves static files from ./fixtures only, never adds CORS headers (canvas-tainted relies on that) and
// answers /slow after 5 s (aborted-navigation scenario). There is deliberately no /_dump or any other
// ingestion route: the extension has no network (REQ-010) and tests read reports only through the SW.
// Module: startFixtureServer([4173, 4174]). Standalone: node tests/fixture-server.mjs

import { existsSync, readFileSync, statSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const fixturesDir = path.join(repoRoot, 'fixtures');
export const FIXTURE_PORTS = [4173, 4174];
export const SLOW_DELAY_MS = 5000;

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
};

const SLOW_BODY =
  '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>slow</title></head>' +
  '<body><h1>slow page</h1><pre id="result">{"fixture":"slow"}</pre></body></html>\n';

function text(res, status, body, stats, rejected) {
  if (rejected) stats.rejected++;
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-cache' });
  res.end(body);
}

/** Request handler; `stats` is mutated so tests can assert what the browser actually requested. */
export function createFixtureHandler(stats, options = {}) {
  const slowDelayMs = options.slowDelayMs ?? SLOW_DELAY_MS;
  const timers = options.timers ?? new Set();
  return function handle(req, res) {
    stats.requests++;
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
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

function listen(port, handler) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handler);
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

export async function startFixtureServer(ports = FIXTURE_PORTS, options = {}) {
  const stats = { requests: 0, slowRequests: 0, slowAborted: 0, rejected: 0 };
  const timers = new Set();
  const handler = createFixtureHandler(stats, { ...options, timers });
  const servers = await Promise.all(ports.map((port) => listen(port, handler)));
  return {
    origins: ports.map((port) => 'http://127.0.0.1:' + String(port)),
    ports: [...ports],
    stats,
    async close() {
      for (const t of timers) clearTimeout(t);
      timers.clear();
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
