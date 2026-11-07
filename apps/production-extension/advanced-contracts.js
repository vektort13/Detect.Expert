// ADR-030/031/032: optional Pro metadata stays in its native tab/document scope.
import { readBeaconDocuments } from './beacon-contracts.js';
import { readBackgroundDocuments } from './background-activity-contracts.js';
import { readCookieProbeDocuments } from './cookie-probe-contracts.js';
import { readProCookieValues } from './pro-cookie-values-contracts.js';
import { readProRequestValues } from './pro-request-values-contracts.js';
import { readCookieWriterDocuments } from './cookie-writers-contracts.js';

export function readAdvancedPageFields(page, session) {
  try {
    const tabId = Object.getOwnPropertyDescriptor(page, 'tabId')?.value;
    const documentKey = Object.getOwnPropertyDescriptor(page, 'documentKey')?.value;
    for (const [field, reader] of [['cookieValues', readProCookieValues], ['requestValues', readProRequestValues]]) {
      if (!Object.hasOwn(page, field)) continue;
      const values = reader(Object.getOwnPropertyDescriptor(page, field)?.value);
      const startedAt = session ? Object.getOwnPropertyDescriptor(session, 'startedAt')?.value : Object.getOwnPropertyDescriptor(page, 'startedAt')?.value, endedAt = Object.getOwnPropertyDescriptor(page, 'endedAt')?.value, deadlineAt = session ? Object.getOwnPropertyDescriptor(session, 'deadlineAt')?.value : Infinity;
      if (!values || values.documentKey !== documentKey || !values.documentKey.startsWith(tabId + ':') || values.rows.some(row => row.firstSeenAt < startedAt || row.lastSeenAt > deadlineAt || endedAt !== null && row.lastSeenAt > endedAt)) return false;
    }
    for (const [key, reader] of [['beacons', readBeaconDocuments], ['backgroundActivity', readBackgroundDocuments], ['cookieProbes', readCookieProbeDocuments], ['cookieWriters', readCookieWriterDocuments]]) {
      if (!Object.hasOwn(page, key)) continue;
      const descriptor = Object.getOwnPropertyDescriptor(page, key);
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) return false;
      const documents = reader(descriptor.value);
      if (!documents || documents.some(document => !document.documentKey.startsWith(tabId + ':') || key === 'cookieProbes' && document.documentKey !== documentKey)) return false;
    }
    return true;
  } catch { return false; }
}
