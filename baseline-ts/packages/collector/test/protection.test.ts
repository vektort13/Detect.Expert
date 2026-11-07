import { describe, expect, it, vi } from 'vitest';
import { PROTECTION_CHANNEL } from '@detect-expert/contracts';
import type { ProtectionObservation } from '@detect-expert/contracts';
import { startProtectionBridge } from '../src/protection';
import type { ProtectionBridgeEnv } from '../src/protection';

describe('ADR-035 bounded protection observation bridge', () => {
  function setup() {
    let page: Parameters<ProtectionBridgeEnv['onPage']>[0] = () => undefined;
    let command: Parameters<ProtectionBridgeEnv['onCommand']>[0] = () => false;
    let restore = () => undefined as void;
    let finish = () => undefined as void;
    const post = vi.fn();
    startProtectionBridge({ onPage: listener => { page = listener; }, onCommand: listener => { command = listener; },
      onRestore: listener => { restore = listener; }, post, later: callback => { finish = callback; } });
    return { page, command, restore, finish: () => finish(), post };
  }
  const row: ProtectionObservation = { feature: 'canvas-readback', installed: 6, unavailable: 0, removed: 0, blocked: 3, stopped: false };
  const observation = { channel: PROTECTION_CHANNEL, type: 'protection-observation', observation: row };

  it('only accepts commands from the extension service worker', () => {
    const bridge = setup();
    const respond = vi.fn();
    expect(bridge.command(false, { schemaVersion: 1, type: 'protection-query' }, respond)).toBe(false);
    expect(bridge.command(false, { schemaVersion: 1, type: 'protection-stop' }, respond)).toBe(false);
    expect(bridge.command(true, { schemaVersion: 1, type: 'ui-protection-set' }, respond)).toBe(false);
    expect(bridge.post).not.toHaveBeenCalled();
  });

  it('only retains validated same-window data during a bounded explicit query', () => {
    const bridge = setup();
    const respond = vi.fn();
    bridge.page(true, observation);
    bridge.command(true, { schemaVersion: 1, type: 'protection-query' }, respond);
    bridge.page(false, observation);
    bridge.page(true, { ...observation, observation: { ...row, value: 'SENSITIVE_CANARY' } });
    bridge.finish();
    expect(respond).toHaveBeenCalledWith([]);
    bridge.command(true, { schemaVersion: 1, type: 'protection-query' }, respond);
    bridge.page(true, observation);
    bridge.finish();
    expect(respond).toHaveBeenLastCalledWith([row]);
  });

  it('bounds duplicate messages and simultaneous response callbacks', () => {
    const bridge = setup();
    const replies = Array.from({ length: 5 }, () => vi.fn());
    for (const reply of replies) bridge.command(true, { schemaVersion: 1, type: 'protection-query' }, reply);
    for (let count = 0; count < 1000; count++) bridge.page(true, { ...observation, observation: { ...row, blocked: count } });
    bridge.finish();
    for (const reply of replies.slice(0, 4)) expect(reply).toHaveBeenCalledWith([{ ...row, blocked: 63 }]);
    expect(replies[4]).toHaveBeenCalledWith([]);
    expect(bridge.post).toHaveBeenCalledTimes(1);
  });

  it('stops old policies on explicit control and BFCache restore without saving settings', () => {
    const bridge = setup();
    bridge.command(true, { schemaVersion: 1, type: 'protection-stop' }, vi.fn());
    bridge.restore();
    expect(bridge.post).toHaveBeenCalledTimes(2);
    expect(bridge.post).toHaveBeenLastCalledWith({ channel: PROTECTION_CHANNEL, type: 'protection-stop' });
  });
});