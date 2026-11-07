// P06 / E02-01: the two-origin acceptance stand uses the canonical fixture ports.
import { test as base, expect, type Page, type Worker } from '@playwright/test';
import os from 'node:os';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { launch, repoRoot, startFixtureServer, type ExtensionSession, type FixtureServer } from '../harness';

export const test = base.extend<{ ext: ExtensionSession; fixtures: FixtureServer }>({
  ext: async ({}, use) => {
    const ext = await launch();
    try { await use(ext); } finally { await ext.close(); }
  },
  fixtures: async ({}, use) => {
    const server = await startFixtureServer();
    try { await use(server); } finally { await server.close(); }
  },
});
export { expect };

export interface NavigationTrace {
  kind: string;
  tabId: number;
  frameId: number;
  documentId: string | null;
  parentDocumentId: string | null;
  lifecycle: string | null;
  path: string;
  error: string | null;
}

export async function captureNavigation(sw: Worker): Promise<void> {
  await sw.evaluate(() => {
    const state = globalThis as unknown as { __p06Trace: NavigationTrace[] };
    state.__p06Trace = [];
    const capture = (kind: string, event: { tabId: number; frameId: number; documentId?: string; parentDocumentId?: string; documentLifecycle?: string; url: string; error?: string }) => {
      if (state.__p06Trace.length >= 128) return;
      const parsed = new URL(event.url);
      if (parsed.hostname !== '127.0.0.1' && parsed.hostname !== 'localhost' && !['about:', 'blob:'].includes(parsed.protocol)) return;
      state.__p06Trace.push({ kind, tabId: event.tabId, frameId: event.frameId, documentId: event.documentId ?? null,
        parentDocumentId: event.parentDocumentId ?? null, lifecycle: event.documentLifecycle ?? null,
        path: parsed.protocol === 'blob:' ? '/blob-document' : parsed.pathname, error: event.error ?? null });
    };
    chrome.webNavigation.onBeforeNavigate.addListener((event) => capture('before', event));
    chrome.webNavigation.onCommitted.addListener((event) => capture('committed', event));
    chrome.webNavigation.onCompleted.addListener((event) => capture('completed', event));
    chrome.webNavigation.onErrorOccurred.addListener((event) => capture('error', event));
  });
}

export interface SenderTrace {
  tabId: number;
  frameId: number;
  documentId: string;
  scheme: string;
  inheritedOrigin: boolean;
}

export async function captureSenders(sw: Worker): Promise<void> {
  await sw.evaluate(() => {
    const entries: SenderTrace[] = [];
    Object.assign(globalThis, { __p06Senders: entries });
    chrome.runtime.onMessage.addListener((_message, sender) => {
      if (entries.length < 32 && sender.tab?.id !== undefined && sender.frameId !== undefined && sender.documentId && sender.url) {
        entries.push({ tabId: sender.tab.id, frameId: sender.frameId, documentId: sender.documentId,
          scheme: new URL(sender.url).protocol, inheritedOrigin: sender.origin === 'http://127.0.0.1:4173' });
      }
    });
  });
}

export async function senderTrace(sw: Worker): Promise<SenderTrace[]> {
  return sw.evaluate(() => (globalThis as unknown as { __p06Senders: SenderTrace[] }).__p06Senders);
}

export interface VendorRequestTrace {
  tabId: number;
  documentId: string | null;
  host: string;
  port: string;
  initiatorHost: string | null;
  type: string;
}

export async function captureVendorRequests(sw: Worker): Promise<void> {
  await sw.evaluate(() => {
    const entries: VendorRequestTrace[] = [];
    Object.assign(globalThis, { __p06VendorRequests: entries });
    chrome.webRequest.onCompleted.addListener((event) => {
      const url = new URL(event.url);
      if (url.pathname !== '/vendor-sim.js' || entries.length >= 16) return;
      entries.push({ tabId: event.tabId, documentId: event.documentId ?? null, host: url.hostname, port: url.port,
        initiatorHost: event.initiator ? new URL(event.initiator).hostname : null, type: event.type });
    }, { urls: ['http://*/*'], types: ['script'] });
  });
}

export async function vendorRequests(sw: Worker): Promise<VendorRequestTrace[]> {
  return sw.evaluate(() => (globalThis as unknown as { __p06VendorRequests: VendorRequestTrace[] }).__p06VendorRequests);
}

export async function navigationTrace(sw: Worker): Promise<NavigationTrace[]> {
  return sw.evaluate(() => (globalThis as unknown as { __p06Trace: NavigationTrace[] }).__p06Trace);
}

export async function evidence(page: Page, name: string, observations: unknown): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  const version = await cdp.send('Browser.getVersion');
  await cdp.detach();
  const artifact = { task: 'P06', requirement: ['REQ-006', 'REQ-009', 'REQ-013'], at: new Date().toISOString(),
    platform: os.platform(), arch: os.arch(), osRelease: os.release(), browser: version.product,
    runtimeVersion: page.context().browser()?.version() ?? null, observations };
  await test.info().attach(name, { body: Buffer.from(JSON.stringify(artifact, null, 2)), contentType: 'application/json' });
  // Explicit opt-in keeps ordinary test runs from rewriting checked-in evidence.
  if (process.env['P06_RECORD_TRACES'] === '1') {
    const directory = path.join(repoRoot, 'docs', 'coverage', 'traces');
    mkdirSync(directory, { recursive: true });
    writeFileSync(path.join(directory, name + '.json'), JSON.stringify(artifact, null, 2) + '\n');
  }
}
