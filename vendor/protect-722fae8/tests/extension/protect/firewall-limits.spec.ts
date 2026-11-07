// ADR-020 §C, §13 (S08, E21-08 case 2): rule limits in a real Chromium. 1000 decisions fill the decisions range and
// are written to DNR; the 1001st is refused (limit-reached, nothing written). 128 once decisions fill the session
// range; the 129th is refused. Record-only (not a gate, PROTECT_PERF_RECORD=1 in the quiet perf phase): the time of
// the 1000-rule write goes to docs/coverage/perf/protect-firewall-<ts>.json.

import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { repoRoot } from '../harness';
import { brief } from '../helpers';
import { ourDnrRules } from './support';
import { decide, inject, launchFirewallStand, openStandPage, promptFor, report } from './firewall-support';

test('limits: the 1001st decision and the 129th once decision are refused', async () => {
  test.setTimeout(300_000);
  const stand = await launchFirewallStand();
  try {
    const bulk = (await inject(stand, { op: 'bulk', count: 1000 })) as Record<string, number | boolean>;
    expect(bulk['decisions'], brief(bulk)).toBe(1000);
    expect(bulk['degraded']).toBe(false);
    expect((await ourDnrRules(stand.sw)).ids).toHaveLength(1000);
    if (process.env['PROTECT_PERF_RECORD'] === '1') {
      const out = path.join(repoRoot, 'docs', 'coverage', 'perf', 'protect-firewall-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json');
      writeFileSync(out, JSON.stringify({ card: 'E21-08', kind: 'record-only', rules: 1000, rebuildMs: bulk['rebuildMs'], note: 'updateDynamicRules of the decisions range, measured in the SW (clock ms); not a gate' }, null, 2) + '\n');
    }
    const a = await openStandPage(stand, 'www.example.com', 'leak-form.html');
    await promptFor(stand, a);
    const refused = await decide(stand, a, ['example.net'], 'block', 'site');
    expect(refused, brief(refused)).toMatchObject({ type: 'error', code: 'limit-reached' });
    expect((await ourDnrRules(stand.sw)).ids).toHaveLength(1000);

    const b = await openStandPage(stand, 'shop.example.org', 'second-site.html');
    for (let round = 0; round < 16; round++) {
      const receivers = Array.from({ length: 8 }, (_, i) => 'once' + String(round) + '-' + String(i) + '.net');
      for (const receiver of receivers) await inject(stand, { op: 'evidence', tabId: b.tabId, receiver });
      await expect.poll(async () => (await report(stand, b.tabId)).firewall.prompt?.receivers.length ?? 0).toBe(8);
      const res = await decide(stand, b, receivers, 'block', 'once');
      expect(res.type, brief(res)).toBe('protect-decision');
    }
    expect((await ourDnrRules(stand.sw)).ids.filter((id) => id >= 200000)).toHaveLength(128);
    await inject(stand, { op: 'evidence', tabId: b.tabId, receiver: 'extra-once.net' });
    const over = await decide(stand, b, ['extra-once.net'], 'block', 'once');
    expect(over, brief(over)).toMatchObject({ type: 'error', code: 'limit-reached' });
    expect((await ourDnrRules(stand.sw)).ids.filter((id) => id >= 200000)).toHaveLength(128);
  } finally {
    await stand.close();
  }
});
