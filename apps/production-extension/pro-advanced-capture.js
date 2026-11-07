// ADR-030/031/032: runs inside the existing two-slot Pro capture scheduler.
import { readBeaconSnapshot, readBeaconDocuments } from './beacon-contracts.js';
import { readBackgroundSnapshot, readBackgroundDocuments } from './background-activity-contracts.js';
import { readCookieProbeSnapshot } from './cookie-probe-contracts.js';
import { readCookieWriterSnapshot, readCookieWriterDocuments } from './cookie-writers-contracts.js';
const readable = state => state && !['paused', 'no-access', 'unsupported'].includes(state.coverageState);

async function retain(pro, page, key, documents, context) {
  if (!context.current()) return;
  const bytes = 256 + JSON.stringify(documents).length * 2;
  if (!pro.size(key + ':' + page.id, bytes) || !context.current()) return;
  page[key] = documents; pro.mark();
  try { await pro.flush(); }
  finally {
    if (!context.current() && page[key] === documents) {
      delete page[key];
      if (pro.pageById(page.id) === page) { pro.size(key + ':' + page.id, 0); pro.mark(); await pro.flush(); }
    }
  }
}

export async function captureAdvancedChannels(pro, page, request, context, inventoryRead) {
  const runtime = pro.runtime, targets = [request]; let overflow = false;
  for (const report of runtime.state?.reports?.values() ?? []) {
    if (report.tabId !== page.tabId || report.frameId <= 0 || !pro.belongsToPage(report.documentKey, page) || runtime.getProjection(page.tabId, report.frameId)?.documentKey !== report.documentKey || !runtime.canObserveNetworkDocument(report.documentKey)) continue;
    if (targets.length >= 24) { overflow = true; break; }
    targets.push({ ...request, frameId: report.frameId, documentKey: report.documentKey });
  }
  for (const [channel, field, type, reader, documentReader] of [
    [runtime.beacons, 'beacons', 'ui-get-beacons', readBeaconSnapshot, readBeaconDocuments],
    [runtime.backgroundActivity, 'backgroundActivity', 'ui-get-background-activity', readBackgroundSnapshot, readBackgroundDocuments],
    [runtime.cookieWriters, 'cookieWriters', 'ui-get-cookie-writers', readCookieWriterSnapshot, readCookieWriterDocuments]
  ]) {
    if (!channel || !context.current()) continue;
    const documents = []; let rows = 0, calls = 0;
    for (const target of targets) {
      if (!context.current()) return;
      let refresh = false;
      if (field === 'backgroundActivity' && !inventoryRead.has(target.documentKey)) refresh = true;
      let state;
      try { state = reader(await channel.read({ ...target, type: refresh ? 'ui-refresh-background-activity' : type })); } catch { continue; }
      if (!context.current()) return;
      if (!readable(state) || state.documentKey !== target.documentKey || runtime.getProjection(target.tabId, target.frameId)?.documentKey !== target.documentKey || !runtime.canObserveNetworkDocument(target.documentKey)) continue;
      if (refresh && state.inventory.checkedAt > 0) inventoryRead.add(target.documentKey);
      if (rows + state.rows.length > 256 || field === 'beacons' && calls + state.scriptCalls.length > 128) { overflow = true; continue; }
      const next = documents.concat(state);
      if (!documentReader(next)) { overflow = true; continue; }
      documents.push(state); rows += state.rows.length; if (field === 'beacons') calls += state.scriptCalls.length;
    }
    if (overflow && documents.length) documents[0].truncated = true;
    if (documents.length && documentReader(documents)) await retain(pro, page, field, documents, context);
  }
  const probe = runtime.cookieProbe ? readCookieProbeSnapshot(runtime.cookieProbe.snapshot(page.documentKey)) : null;
  if (probe && probe.status !== 'idle' && context.current()) await retain(pro, page, 'cookieProbes', [probe], context);
}

export function retainCookieProbe(pro, snapshot) {
  const state = readCookieProbeSnapshot(snapshot), runtime = pro.runtime;
  if (!state || state.status === 'idle' || !pro.checkDeadline() || !runtime.scope.hasDataConsent) return;
  const tabId = Number(state.documentKey.split(':')[0]), page = pro.pageFor(tabId);
  const projection = runtime.getProjection(tabId, 0);
  if (!page || page.documentKey !== state.documentKey || page.endedAt !== null || projection?.documentKey !== state.documentKey || ['paused', 'no-access', 'unsupported'].includes(projection.coverageState) || !runtime.canObserveNetworkDocument(state.documentKey)) return;
  const bytes = 256 + JSON.stringify([state]).length * 2;
  if (!pro.size('cookieProbes:' + page.id, bytes)) return;
  page.cookieProbes = [state]; pro.mark(); void pro.flush().catch(() => {});
}
