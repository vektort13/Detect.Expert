// Read-only DBSC capability experiment in disposable browser/Incognito profiles.
// Pinned primary Network.pdl parameter contracts and references:
// No cookie inventory/values, session identifiers, challenges, keys, refreshes,
// request observation, registration requests or installed user profiles.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const output = resolve(import.meta.dirname, '../../test-results/production-1.1.0/research/dbsc-cookie-capability.json');
const evidence = { generatedAt: new Date().toISOString(), nativeExperiment: true, isolatedProfiles: true, installedUserProfilesOpened: false,
  networkObservationEnabled: false, cookieInventoryRead: false, sessionRegistrationRequested: false, keysRequested: false,
  hardwareBackingTested: false, positiveMembershipTested: false, runs: [] };
const delay = ms => new Promise(done => setTimeout(done, ms));
async function capability(channel) {
  const row = { channel, launched: false, version: null, isolatedContext: false, fetchSchemefulSiteSucceeded: false, fetchReturnFields: [],
    schemefulSiteMatchesLoopback: false, enableSucceeded: false, enableReturnFields: [], initialEventCount: 0, initialEventFields: [],
    initialSessionsIsArray: false, initialSessionCount: 0, lifecycleEventCount: 0, lifecycleEventFields: [], disableSucceeded: false,
    disableReturnFields: [], detached: false, closed: false, unsupported: false };
  evidence.runs.push(row);
  let browser, context, session;
  try {
    // Playwright owns the temporary browser profile. No userDataDir is supplied.
    browser = await chromium.launch({ channel, headless: true, timeout: 20000, args: ['--no-first-run', '--disable-background-networking'] });
    row.launched = true; row.version = browser.version(); context = await browser.newContext(); row.isolatedContext = true;
    const page = await context.newPage(); session = await context.newCDPSession(page);
    session.on('Network.deviceBoundSessionsAdded', event => {
      row.initialEventCount++;
      row.initialEventFields = [...new Set([...row.initialEventFields, ...Object.keys(event)])].sort();
      row.initialSessionsIsArray = Array.isArray(event.sessions);
      // Only the inventory count is read; no session contents are inspected.
      if (row.initialSessionsIsArray) row.initialSessionCount += event.sessions.length;
    });
    session.on('Network.deviceBoundSessionEventOccurred', event => {
      row.lifecycleEventCount++;
      row.lifecycleEventFields = [...new Set([...row.lifecycleEventFields, ...Object.keys(event)])].sort();
    });
    try {
      const result = await session.send('Network.fetchSchemefulSite', { origin: 'https://localhost:8443' });
      row.fetchSchemefulSiteSucceeded = true; row.fetchReturnFields = Object.keys(result).sort();
      row.schemefulSiteMatchesLoopback = result.schemefulSite === 'https://localhost';
      assert.equal(typeof result.schemefulSite, 'string');
    } catch (error) { row.unsupported = /wasn.t found|not found|method not found/i.test(String(error.message)); }
    try {
      const result = await session.send('Network.enableDeviceBoundSessions', { enable: true });
      row.enableSucceeded = true; row.enableReturnFields = Object.keys(result).sort();
      const end = Date.now() + 2500;
      while (!row.initialEventCount && Date.now() < end) await delay(25);
      await delay(100);
    } catch (error) { row.unsupported ||= /wasn.t found|not found|method not found/i.test(String(error.message)); }
  } finally {
    if (session) {
      try { const result = await session.send('Network.enableDeviceBoundSessions', { enable: false }); row.disableSucceeded = true; row.disableReturnFields = Object.keys(result).sort(); } catch {}
      try { await session.detach(); row.detached = true; } catch {}
    }
    if (context) await context.close();
    if (browser) { await browser.close(); row.closed = true; }
  }
  // These assert capability/empty clean-profile behavior, not DBSC membership
  // of a real cookie and not hardware backing/TPM participation.
  assert.equal(row.fetchSchemefulSiteSucceeded, true, channel + ': fetchSchemefulSite unavailable');
  assert.equal(row.schemefulSiteMatchesLoopback, true, channel + ': schemeful site result');
  assert.equal(row.enableSucceeded, true, channel + ': DBSC subscription unavailable');
  assert.ok(row.initialEventCount > 0, channel + ': no initial event');
  assert.equal(row.initialSessionsIsArray, true, channel + ': inventory shape');
  assert.equal(row.initialSessionCount, 0, channel + ': isolated inventory unexpectedly nonempty');
  assert.equal(row.lifecycleEventCount, 0, channel + ': unexpected lifecycle event');
  assert.equal(row.disableSucceeded && row.detached && row.closed, true, channel + ': cleanup');
  return row;
}
try {
  for (const channel of ['chromium', 'chrome']) { const row = await capability(channel); console.log(channel + ' ' + row.version + ': capability/empty inventory/cleanup PASS'); }
  evidence.result = 'PASS';
} catch (error) { evidence.result = 'FAIL'; evidence.assertionFailed = error.name === 'AssertionError'; process.exitCode = 1; }
finally { await mkdir(resolve(output, '..'), { recursive: true }); await writeFile(output, JSON.stringify(evidence, null, 2) + '\n'); }
