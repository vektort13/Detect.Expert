import { PROTECTION_CHANNEL, readProtectionObservations } from '@detect-expert/contracts';
import type { ProtectionObservation } from '@detect-expert/contracts';
import { isOwnServiceWorker } from './env';

export interface ProtectionBridgeEnv {
  onPage(listener: (sameWindow: boolean, data: unknown) => void): void;
  onCommand(listener: (trusted: boolean, data: unknown, respond: (rows: ProtectionObservation[]) => void) => boolean): void;
  onRestore(listener: () => void): void;
  post(message: { channel: typeof PROTECTION_CHANNEL; type: 'protection-query' | 'protection-stop' }): void;
  later(callback: () => void, delay: number): void;
}

export function startProtectionBridge(env: ProtectionBridgeEnv): void {
  let pending: Array<(rows: ProtectionObservation[]) => void> | null = null;
  const rows = new Map<string, ProtectionObservation>();
  let admitted = 0;
  const field = (value: unknown, key: string): unknown => {
    if (typeof value !== 'object' || value === null) return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
  };
  const stop = (): void => { env.post({ channel: PROTECTION_CHANNEL, type: 'protection-stop' }); };
  env.onRestore(stop);
  env.onPage((sameWindow, data) => {
    if (!sameWindow || pending === null || admitted >= 64 || field(data, 'channel') !== PROTECTION_CHANNEL || field(data, 'type') !== 'protection-observation') return;
    admitted++;
    const parsed = readProtectionObservations([field(data, 'observation')]);
    const row = parsed?.[0];
    if (row) rows.set(row.feature, row);
  });
  env.onCommand((trusted, data, respond) => {
    if (!trusted || field(data, 'schemaVersion') !== 1) return false;
    const type = field(data, 'type');
    if (type === 'protection-stop') { stop(); respond([]); return false; }
    if (type !== 'protection-query') return false;
    if (pending !== null) {
      if (pending.length < 4) pending.push(respond);
      else respond([]);
      return true;
    }
    rows.clear(); admitted = 0; pending = [respond];
    env.post({ channel: PROTECTION_CHANNEL, type: 'protection-query' });
    env.later(() => {
      const waiting = pending;
      pending = null;
      if (waiting) for (const reply of waiting) reply([...rows.values()]);
      rows.clear();
    }, 50);
    return true;
  });
}

export function startBrowserProtectionBridge(): void {
  startProtectionBridge({
    onPage: listener => window.addEventListener('message', event => listener(event.source === window, event.data as unknown)),
    onCommand: listener => chrome.runtime.onMessage.addListener((message: unknown, sender, respond) =>
      listener(isOwnServiceWorker(sender), message, respond)),
    onRestore: listener => window.addEventListener('pageshow', event => { if (event.persisted) listener(); }),
    post: message => window.postMessage(message, '*'),
    later: (callback, delay) => { setTimeout(callback, delay); },
  });
}