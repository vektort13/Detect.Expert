// ADR-020 §11 (S08, E21-08 case 2): truthful delivery states in a real Chromium.
//   - the first request to a new receiver is `sent` (the server received exactly 1) and is never `stopped`;
//   - after a site block, N attempts (beacon, fetch, image, XHR) are `stopped` by our rule: stoppedToday == N (lower
//     bound, exact here: the tab is armed), the server received none;
//   - while the service worker is stopped nothing is claimed: attempts are not counted (outcome not observed), the
//     server still receives none;
//   - rebuild after a browser restart: the decision comes back from IndexedDB, the rule stops requests again.

import { expect, test } from '@playwright/test';
import { brief } from '../helpers';
import { ourDnrRules } from './support';
import { decide, delivered, inject, launchFirewallStand, openStandPage, promptFor, report, sendAttempts, serviceDebug, typeEmail } from './firewall-support';

test('truthful state: first request sent, then stopped == N, nothing claimed while the SW is stopped, rebuild after restart', async () => {
  test.setTimeout(240_000);
  const stand = await launchFirewallStand();
  try {
    const a = await openStandPage(stand, 'www.example.com', 'leak-form.html');
    // The evidence of the first match exists before its request is sent (value-match finds it in onBeforeRequest).
    await promptFor(stand, a);
    await typeEmail(stand, a);
    await expect.poll(() => delivered(stand), { message: 'the server received the first request' }).toBe(1);
    let view = (await report(stand, a.tabId)).firewall;
    const receiver = view.receivers.find((r) => r.receiver === 'example.net');
    expect(receiver, brief(view)).toMatchObject({ lastDelivery: 'sent', countQuality: 'lower-bound' });
    expect(receiver!.delivery.sent).toBeGreaterThanOrEqual(1);
    expect(receiver!.delivery.stopped, 'the first request is never stopped').toBe(0);
    expect(view.stoppedToday).toEqual({ count: 0, countQuality: 'lower-bound' });

    const res = await decide(stand, a, ['example.net'], 'block', 'site');
    expect(res, brief(res)).toMatchObject({ type: 'protect-decision', applied: [{ receiver: 'example.net', ruleApplied: true }] });
    const N = await sendAttempts(a, 2);
    expect(delivered(stand), 'the server received none of the attempts after the decision').toBe(1);
    await expect.poll(async () => (await report(stand, a.tabId)).firewall.stoppedToday.count, { message: 'stoppedToday == N' }).toBe(N);
    view = (await report(stand, a.tabId)).firewall;
    expect(view.receivers.find((r) => r.receiver === 'example.net')).toMatchObject({ lastDelivery: 'stopped', delivery: { stopped: N } });
    expect(view.enforcement).toBe('active');

    // Statistics are written at most every 5 s; then the service worker is stopped and the page tries again.
    await a.page.waitForTimeout(5_500);
    const ui = await stand.context.newPage();
    await ui.goto(stand.server.origins[0]! + '/protect/index.html');
    const cdp = await stand.context.newCDPSession(ui);
    let versionId = '';
    cdp.on('ServiceWorker.workerVersionUpdated', ({ versions }) => {
      for (const v of versions) if (v.scriptURL === stand.sw.url() && v.runningStatus === 'running') versionId = v.versionId;
    });
    await cdp.send('ServiceWorker.enable');
    await expect.poll(() => versionId).not.toBe('');
    await cdp.send('ServiceWorker.stopWorker', { versionId });
    await sendAttempts(a, 1);
    expect(delivered(stand), 'DNR rules act while the service worker is stopped').toBe(1);
    await cdp.detach();
    await stand.refreshWorker();
    expect((await report(stand, a.tabId)).firewall.stoppedToday.count, 'attempts while the SW was stopped are not claimed (outcome not observed)').toBe(N);

    // Browser restart with the same profile: the decision is rebuilt from IndexedDB.
    await stand.restart();
    expect((await ourDnrRules(stand.sw)).ids).toEqual([100000]);
    expect(await serviceDebug(stand)).toMatchObject({ decisions: 1, activeRules: 1 });
    const again = await openStandPage(stand, 'www.example.com', 'leak-form.html');
    await inject(stand, { op: 'arm', tabId: again.tabId });
    const before = delivered(stand);
    const M = await sendAttempts(again, 1);
    expect(delivered(stand), 'the rebuilt rule stops the requests').toBe(before);
    await expect.poll(async () => (await report(stand, again.tabId)).firewall.stoppedToday.count, { message: 'stopped after the restart' }).toBe(N + M);
  } finally {
    await stand.close();
  }
});
