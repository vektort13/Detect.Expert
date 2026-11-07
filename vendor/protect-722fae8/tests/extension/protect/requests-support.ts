// Shared helpers of the data-request e2e specs (ADR-020 §I, S14). An init script for extension pages records what the
// page sends to the SW (JSON strings, page memory only), replaces navigator.clipboard.writeText by a recorder and
// prevents the default action of mailto: and company-form links (the click handlers still run: the journal entry is
// saved; nothing leaves the browser). IndexedDB records are written through the SW for TTL and overdue cases.

import { expect, type BrowserContext, type Page, type Request, type Worker } from '@playwright/test';
import type { DeletionRequestRecord } from '@detect-expert/contracts';
import { extensionIdOf } from '../harness';
import { PROTECT_DB } from './support';

/** Installs the recorder on every extension page of the context (before any page script). */
export async function installRequestsRecorder(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    if (location.protocol !== 'chrome-extension:') return;
    const sent: string[] = [];
    const copied: string[] = [];
    Object.defineProperty(window, '__s14Sent', { value: sent });
    Object.defineProperty(window, '__s14Copied', { value: copied });
    try {
      const runtime = (globalThis as unknown as { chrome: { runtime: { sendMessage: (...args: unknown[]) => unknown } } }).chrome.runtime;
      const original = runtime.sendMessage;
      runtime.sendMessage = function (...args: unknown[]) {
        try {
          if (sent.length < 512) sent.push(JSON.stringify(args[0]));
        } catch {
          // recorder only
        }
        return Reflect.apply(original, runtime, args);
      };
    } catch {
      // no runtime: nothing to record
    }
    try {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: (text: string) => { copied.push(String(text)); return Promise.resolve(); } },
      });
    } catch {
      // the page falls back to selecting the text
    }
    document.addEventListener('click', (event) => {
      const target = event.target instanceof Element ? event.target.closest('a[href^="mailto:"], a[data-requests-portal]') : null;
      if (target !== null) event.preventDefault();
    }, true);
  });
}

export async function sentTypes(page: Page): Promise<string[]> {
  return page.evaluate(() => ((window as unknown as { __s14Sent?: string[] }).__s14Sent ?? []).map((s) => String((JSON.parse(s) as { type?: unknown }).type)));
}

export async function sentRaw(page: Page): Promise<string[]> {
  return page.evaluate(() => [...((window as unknown as { __s14Sent?: string[] }).__s14Sent ?? [])]);
}

export async function copiedTexts(page: Page): Promise<string[]> {
  return page.evaluate(() => [...((window as unknown as { __s14Copied?: string[] }).__s14Copied ?? [])]);
}

/** Requests of extension pages or the SW to http(s)/ws(s) — the extension's own egress (must stay 0). */
export function watchExtensionEgress(context: BrowserContext, sw: Worker): { count(): number; urls(): string[] } {
  const prefix = 'chrome-extension://' + extensionIdOf(sw) + '/';
  const seen: string[] = [];
  const on = (request: Request): void => {
    let frameUrl = '';
    try {
      frameUrl = request.frame().url();
    } catch {
      frameUrl = '';
    }
    const worker = request.serviceWorker()?.url() ?? '';
    const fromExtension = frameUrl.startsWith(prefix) || worker.startsWith(prefix);
    if (fromExtension && /^(?:https?|wss?|ftp):/i.test(request.url())) seen.push(request.url());
  };
  context.on('request', on);
  return { count: () => seen.length, urls: () => [...seen] };
}

/** Local day (browser time zone) `offset` days from today, computed in the SW (the journal's calendar). */
export async function swLocalDay(sw: Worker, offset: number): Promise<string> {
  return sw.evaluate((n) => {
    const d = new Date(Date.now() + n * 86_400_000);
    return String(d.getFullYear()).padStart(4, '0') + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }, offset);
}

/** Writes journal records straight into IndexedDB `requests` (TTL / overdue cases), then drops the lane cache. */
export async function putJournalRecords(sw: Worker, records: DeletionRequestRecord[]): Promise<void> {
  await sw.evaluate(async ({ name, items }) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(name);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onupgradeneeded = () => req.transaction?.abort();
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('requests', 'readwrite');
        for (const item of items) tx.objectStore('requests').put(item);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  }, { name: PROTECT_DB, items: records });
  await sw.evaluate(() => (globalThis as unknown as { __protectHarness: { inject(n: string, p: unknown): Promise<unknown> } }).__protectHarness.inject('requests', { reload: true }));
}

/** A valid journal record (no identifier, name or letter: the contract has no field for them). */
export function journalRecord(over: Partial<DeletionRequestRecord> & Pick<DeletionRequestRecord, 'requestId' | 'createdDay'>): DeletionRequestRecord {
  return {
    sourceKind: 'manual',
    jurisdiction: 'gdpr-eu-eea',
    kinds: ['erasure'],
    letterLang: 'en',
    templateId: 'gdpr-eu-eea',
    templateVersion: '2026-10-17',
    subject: { role: 'receiver', vendorId: null, domain: null, entityName: 'Stand Co' },
    recipient: { source: 'none' },
    facts: [],
    identityKinds: ['sender-address'],
    delivery: 'copy',
    mentionGpc: false,
    status: 'prepared',
    statusDay: over.createdDay,
    sentDay: null,
    deadlineDay: null,
    extendedDeadlineDay: null,
    history: [{ status: 'prepared', day: over.createdDay }],
    ...over,
  };
}

/** Waits until the requests page has loaded the journal (read-only or editable). */
export async function waitRequestsPage(page: Page): Promise<void> {
  await expect(page.locator('[data-requests-app]')).not.toHaveAttribute('data-requests-app', 'loading', { timeout: 15_000 });
}
