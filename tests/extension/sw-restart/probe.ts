// P07 / REQ-009: DevTools instrumentation, never a page-accessible extension command.
import type { CDPSession, Page, Worker } from '@playwright/test';
import type { CollectorSnapshot } from '../../../packages/collector/src/collector';
import { expect } from '../harness';

// Raw CDP promises do not inherit Playwright's action timeout. Always bound them
// so a stopped worker cannot strand fixture teardown after the test deadline.
async function boundedCdp<T>(operation: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('P07 CDP timed out: ' + label)), 5000);
    })]);
  } finally { if (timer !== undefined) clearTimeout(timer); }
}

async function detach(cdp: CDPSession): Promise<void> {
  await boundedCdp(cdp.detach(), 'session detach').catch(() => {});
}

export async function workerControl(ui: Page, sw: Worker) {
  const cdp = await ui.context().newCDPSession(ui);
  let versionId = '';
  cdp.on('ServiceWorker.workerVersionUpdated', ({ versions }) => {
    for (const v of versions) if (v.scriptURL === sw.url() && v.runningStatus === 'running') versionId = v.versionId;
  });
  try {
    await boundedCdp(cdp.send('ServiceWorker.enable'), 'ServiceWorker.enable');
    await expect.poll(() => versionId).not.toBe('');
    return { cdp, detach: () => detach(cdp), stop: () => boundedCdp(cdp.send('ServiceWorker.stopWorker', { versionId }), 'ServiceWorker.stopWorker') };
  } catch (error) { await detach(cdp); throw error; }
}

export async function bridgeProbe(page: Page, sw: Worker) {
  const cdp = await page.context().newCDPSession(page);
  let contextId = 0;
  cdp.on('Runtime.executionContextCreated', ({ context }) => {
    if (context.origin.includes(new URL(sw.url()).host)) contextId = context.id;
  });
  try {
  await boundedCdp(cdp.send('Runtime.enable'), 'Runtime.enable');
  await expect.poll(() => contextId).toBeGreaterThan(0);
  const evaluate = async <T>(expression: string): Promise<T> => evaluateIn<T>(cdp, contextId, expression);
  await evaluate(`globalThis.__p07Wire = { hold: false, holdTechnique: null, calls: [], release: null };
    const originalSend = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = (...args) => {
      if (args[0]?.type !== 'sensor-events') return originalSend(...args);
      __p07Wire.calls.push({ at: performance.now(), batch: args[0] });
      if (__p07Wire.hold && (__p07Wire.holdTechnique === null || args[0].observations.some((item) => item.techniqueId === __p07Wire.holdTechnique))) return new Promise((resolve, reject) => {
        // Hold the same physical send until explicitly released. Clearing the hold flag cannot cancel it.
        const release = () => {
          if (__p07Wire.release !== release) return;
          __p07Wire.release = null;
          try { resolve(originalSend(...args)); } catch (error) { reject(error); }
        };
        __p07Wire.release = release;
      });
      return originalSend(...args);
    }; true`);
  return { cdp, detach: () => detach(cdp), evaluate, snapshot: () => evaluate<CollectorSnapshot>('__p07Collector.snapshot()') };
  } catch (error) { await detach(cdp); throw error; }
}

async function evaluateIn<T>(cdp: CDPSession, contextId: number, expression: string): Promise<T> {
  const result = await boundedCdp(cdp.send('Runtime.evaluate', { contextId, expression, returnByValue: true, awaitPromise: true }), 'Runtime.evaluate: ' + expression.slice(0, 180));
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value as T;
}
