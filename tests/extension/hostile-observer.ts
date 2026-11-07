// F160 / ADR-004 §8: observe the actual ISOLATED -> SW boundary, with no production wire fields.
import type { Worker } from '@playwright/test';

interface WireProbe {
  types: string[];
  restore: () => void;
}

export async function installForwardingProbe(sw: Worker, tabId: number): Promise<void> {
  await sw.evaluate(async (id) => {
    await chrome.scripting.executeScript({
      target: { tabId: id }, world: 'ISOLATED',
      func: () => {
        const root = window as unknown as { __hostileWireProbe: WireProbe };
        const original = chrome.runtime.sendMessage;
        const probe: WireProbe = { types: [], restore: () => { chrome.runtime.sendMessage = original; } };
        root.__hostileWireProbe = probe;
        chrome.runtime.sendMessage = function (...args: unknown[]) {
          const message = args[0] as { type?: unknown } | undefined;
          probe.types.push(typeof message?.type === 'string' ? message.type : 'unknown');
          return Reflect.apply(original, chrome.runtime, args);
        } as typeof original;
      },
    });
  }, tabId);
}

export async function finishForwardingProbe(sw: Worker, tabId: number): Promise<string[]> {
  return sw.evaluate(async (id) => {
    const results = await chrome.scripting.executeScript({
      target: { tabId: id }, world: 'ISOLATED',
      func: () => {
        const probe = (window as unknown as { __hostileWireProbe: WireProbe }).__hostileWireProbe;
        probe.restore();
        return probe.types;
      },
    });
    return results[0]?.result ?? [];
  }, tabId);
}
