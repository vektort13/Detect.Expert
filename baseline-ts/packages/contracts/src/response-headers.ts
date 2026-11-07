import { MAX_COUNT } from './budgets';

export const RESPONSE_HEADER_NAMES = ['accept-ch', 'critical-ch', 'permissions-policy', 'feature-policy', 'nel', 'report-to', 'reporting-endpoints',
  'secure-session-registration', 'sec-session-registration', 'secure-session-challenge', 'sec-session-challenge', 'use-as-dictionary'] as const;
export type ResponseHeaderName = typeof RESPONSE_HEADER_NAMES[number];
export const CLIENT_HINT_NAMES = ['sec-ch-ua', 'sec-ch-ua-mobile', 'sec-ch-ua-platform', 'sec-ch-ua-arch', 'sec-ch-ua-bitness', 'sec-ch-ua-model',
  'sec-ch-ua-platform-version', 'sec-ch-ua-full-version', 'sec-ch-ua-full-version-list', 'sec-ch-ua-wow64', 'sec-ch-ua-form-factors',
  'device-memory', 'sec-ch-device-memory', 'dpr', 'sec-ch-dpr', 'width', 'sec-ch-width', 'viewport-width', 'sec-ch-viewport-width',
  'sec-ch-viewport-height', 'rtt', 'downlink', 'ect', 'save-data', 'sec-ch-prefers-color-scheme', 'sec-ch-prefers-reduced-motion',
  'sec-ch-prefers-reduced-transparency'] as const;
export type ClientHintName = typeof CLIENT_HINT_NAMES[number];

export interface ResponseHeaderEntry { name: ResponseHeaderName; count: number; clientHints: ClientHintName[] }
export interface ResponseHeadersSummary { entries: ResponseHeaderEntry[]; truncated: boolean }

function field(value: object, key: string): unknown {
  const entry = Object.getOwnPropertyDescriptor(value, key);
  return entry?.enumerable && Object.hasOwn(entry, 'value') ? entry.value : undefined;
}

export function readResponseHeaders(value: unknown): ResponseHeadersSummary | null {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Reflect.ownKeys(value).length !== 2) return null;
    const entries = field(value, 'entries'), truncated = field(value, 'truncated');
    if (!Array.isArray(entries) || entries.length > RESPONSE_HEADER_NAMES.length || Reflect.ownKeys(entries).length !== entries.length + 1 || typeof truncated !== 'boolean') return null;
    const output: ResponseHeaderEntry[] = [], seen = new Set<ResponseHeaderName>();
    for (let index = 0; index < entries.length; index++) {
      const row = field(entries, String(index));
      if (!row || typeof row !== 'object' || Array.isArray(row) || Reflect.ownKeys(row).length !== 3) return null;
      const name = field(row, 'name'), count = field(row, 'count'), hints = field(row, 'clientHints');
      if (typeof name !== 'string' || !RESPONSE_HEADER_NAMES.includes(name as ResponseHeaderName) || seen.has(name as ResponseHeaderName) ||
          typeof count !== 'number' || !Number.isSafeInteger(count) || count < 1 || count > MAX_COUNT ||
          !Array.isArray(hints) || hints.length > CLIENT_HINT_NAMES.length || Reflect.ownKeys(hints).length !== hints.length + 1) return null;
      if (name !== 'accept-ch' && name !== 'critical-ch' && hints.length > 0) return null;
      const clientHints: ClientHintName[] = [];
      for (let hintIndex = 0; hintIndex < hints.length; hintIndex++) {
        const hint = field(hints, String(hintIndex));
        if (typeof hint !== 'string' || !CLIENT_HINT_NAMES.includes(hint as ClientHintName) || clientHints.includes(hint as ClientHintName)) return null;
        clientHints.push(hint as ClientHintName);
      }
      seen.add(name as ResponseHeaderName);
      output.push({ name: name as ResponseHeaderName, count, clientHints });
    }
    return { entries: output, truncated };
  } catch { return null; }
}

export function mergeResponseHeaders(previous: ResponseHeadersSummary | undefined, incoming: ResponseHeadersSummary): ResponseHeadersSummary {
  const result = readResponseHeaders(previous) ?? { entries: [], truncated: false };
  const update = readResponseHeaders(incoming);
  if (!update) return { ...result, truncated: true };
  result.truncated ||= update.truncated;
  for (const row of update.entries) {
    const prior = result.entries.find(entry => entry.name === row.name);
    if (!prior) result.entries.push(row);
    else {
      if (prior.count + row.count >= MAX_COUNT) result.truncated = true;
      prior.count = Math.min(MAX_COUNT, prior.count + row.count);
      for (const hint of row.clientHints) if (!prior.clientHints.includes(hint)) prior.clientHints.push(hint);
    }
  }
  result.entries.sort((left, right) => RESPONSE_HEADER_NAMES.indexOf(left.name) - RESPONSE_HEADER_NAMES.indexOf(right.name));
  for (const row of result.entries) row.clientHints.sort();
  return result;
}