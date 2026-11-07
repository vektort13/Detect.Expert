import { DNR_PRIORITIES } from '@detect-expert/contracts';
import type { DnrRangeName } from '@detect-expert/contracts';
import type { AllowedDnrRule } from '@detect-expert/engine';
import { describe, expect, it } from 'vitest';
import { DnrPort } from '../../src/protect/dnr-port';
import type { DnrHashStore } from '../../src/protect/dnr-port';
import { createFakeChrome } from '../fake-chrome';
import { DNR_PERMISSION } from './support';

function hashes(): DnrHashStore & { map: Map<DnrRangeName, string> } {
  const map = new Map<DnrRangeName, string>();
  return { map, get: (r) => map.get(r) ?? null, set: (r, h) => { if (h === null) map.delete(r); else map.set(r, h); } };
}

function block(id: number, domain = 'example.net'): AllowedDnrRule {
  return { id, priority: DNR_PRIORITIES.receiverBlock, action: { type: 'block' }, condition: { requestDomains: [domain] } };
}

describe('DnrPort (lazy namespace, guarded atomic range writes, bounded time)', () => {
  it('without the permission the namespace is absent: nothing is written, apply reports api-unavailable', async () => {
    const fake = createFakeChrome();
    const port = new DnrPort(fake, hashes(), 30);
    expect(port.available()).toBe(false);
    expect(await port.applyDynamic('decisions', [block(100000)])).toEqual({ ok: false, code: 'api-unavailable' });
    expect(await port.removeAllOurs()).toEqual({ ok: true, changed: false });
    fake.grantPermission(DNR_PERMISSION);
    expect(port.available()).toBe(true);
    expect(port.features()).toEqual({ topDomains: true });
    expect(port.limits()).toEqual({ dynamic: 1024, session: 128 });
  });

  it('replaces only our range in one update; skips an unchanged range; other ids stay', async () => {
    const fake = createFakeChrome({ permissions: [DNR_PERMISSION] });
    fake.dnr.dynamic.set(50000, block(50000));
    fake.dnr.dynamic.set(100005, block(100005));
    const store = hashes();
    const port = new DnrPort(fake, store, 30);
    expect(await port.applyDynamic('decisions', [block(100000), block(100001, 'example.org')])).toEqual({ ok: true, changed: true });
    expect([...fake.dnr.dynamic.keys()].sort((a, b) => a - b)).toEqual([50000, 100000, 100001]);
    const writes = fake.dnr.calls.filter((c) => c.method === 'updateDynamicRules');
    expect(writes).toEqual([{ method: 'updateDynamicRules', removeRuleIds: [100005], addRuleIds: [100000, 100001] }]);
    expect(await port.applyDynamic('decisions', [block(100001, 'example.org'), block(100000)])).toEqual({ ok: true, changed: false });
    expect(store.map.get('decisions')).toMatch(/^[0-9a-f]{8}:2$/);
  });

  it('rejects a rule dnr-guard refuses or an id outside the range, without calling Chrome', async () => {
    const fake = createFakeChrome({ permissions: [DNR_PERMISSION] });
    const port = new DnrPort(fake, hashes(), 30);
    expect(await port.applyDynamic('decisions', [{ ...block(100000), action: { type: 'allow' }, priority: 999 } as AllowedDnrRule])).toEqual({ ok: false, code: 'update-rejected' });
    expect(await port.applyDynamic('gpc', [block(100000)])).toEqual({ ok: false, code: 'update-rejected' });
    expect(fake.dnr.calls).toEqual([]);
  });

  it('SP-1: a hanging write times out (api-unavailable) and blocks further writes until it settles', async () => {
    const fake = createFakeChrome({ permissions: [DNR_PERMISSION] });
    fake.dnr.hangWrites = true;
    const port = new DnrPort(fake, hashes(), 20);
    const t0 = Date.now();
    expect(await port.applyDynamic('decisions', [block(100000)])).toEqual({ ok: false, code: 'api-unavailable' });
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(port.degraded).toBe('api-unavailable');
    const before = fake.dnr.calls.length;
    expect(await port.applyDynamic('decisions', [block(100000)])).toEqual({ ok: false, code: 'api-unavailable' });
    expect(fake.dnr.calls.length).toBe(before); // no second write while the first one hangs
  });

  it('rejections map to rule-limit / update-rejected; removeAllOurs clears dynamic and session ranges', async () => {
    const fake = createFakeChrome({ permissions: [DNR_PERMISSION] });
    const port = new DnrPort(fake, hashes(), 30);
    fake.dnr.failNextWrite = new Error('Dynamic rule count exceeded the maximum');
    expect(await port.applyDynamic('decisions', [block(100000)])).toEqual({ ok: false, code: 'rule-limit' });
    fake.dnr.failNextWrite = new Error('Invalid rule');
    expect(await port.applyDynamic('decisions', [block(100000)])).toEqual({ ok: false, code: 'update-rejected' });
    expect(await port.applyDynamic('decisions', [block(100000)])).toEqual({ ok: true, changed: true });
    expect(port.degraded).toBeNull();
    fake.dnr.session.set(200003, { ...block(200003), condition: { requestDomains: ['example.net'], tabIds: [1] } });
    fake.dnr.dynamic.set(7, block(7));
    fake.dnr.dynamic.set(60000, block(60000));
    expect(await port.removeAllOurs()).toEqual({ ok: true, changed: true });
    expect([...fake.dnr.dynamic.keys()]).toEqual([60000]);
    expect(fake.dnr.session.size).toBe(0);
  });

  it('review W2: removeAllOurs waits (bounded) for a write in flight, then removes what it wrote', async () => {
    const fake = createFakeChrome({ permissions: [DNR_PERMISSION] });
    const port = new DnrPort(fake, hashes(), 60);
    const update = fake.dnr.updateDynamicRules.bind(fake.dnr);
    let slow = true;
    fake.dnr.updateDynamicRules = (options) => {
      if (!slow) return update(options);
      slow = false;
      return new Promise<void>((resolve, reject) => setTimeout(() => update(options).then(resolve, reject), 15));
    };
    const writing = port.applyDynamic('decisions', [block(100000)]);
    await new Promise((r) => setTimeout(r, 2)); // the read is done, the write is in flight
    expect(await port.removeAllOurs()).toEqual({ ok: true, changed: true });
    expect(await writing).toEqual({ ok: true, changed: true });
    expect([...fake.dnr.dynamic.keys()]).toEqual([]);
    expect(port.degraded).toBeNull();
  });

  it('SP-5: after the permission is removed the calls throw → cleanup-pending', async () => {
    const fake = createFakeChrome({ permissions: [DNR_PERMISSION] });
    const store = hashes();
    const port = new DnrPort(fake, store, 30);
    await port.applyDynamic('decisions', [block(100000)]);
    fake.revokePermission(DNR_PERMISSION);
    expect(await port.removeAllOurs()).toEqual({ ok: false, code: 'cleanup-pending' });
    expect(fake.dnr.dynamic.has(100000)).toBe(true);
  });

  it('reconcile removes orphans in the ranges of disabled features only', async () => {
    const fake = createFakeChrome({ permissions: [DNR_PERMISSION] });
    fake.dnr.dynamic.set(3, block(3));
    fake.dnr.dynamic.set(100010, block(100010));
    const port = new DnrPort(fake, hashes(), 30);
    await port.reconcile(['firewall']);
    expect([...fake.dnr.dynamic.keys()]).toEqual([100010]);
    await port.reconcile(['gpc']);
    expect(fake.dnr.dynamic.size).toBe(0);
  });
});
