import { describe, expect, it, vi } from 'vitest';
import { API_RESULTS_CHANNEL } from '@detect-expert/contracts';
import { startApiResultsBridge } from '../src/api-results';
import type { ApiResultsBridgeEnv } from '../src/api-results';

const row = { operation: 'Screen.width', techniqueId: 'DET-029', phase: 'returned-sync', value: { kind: 'number', value: 1920 } };

function setup() {
  let onPage: Parameters<ApiResultsBridgeEnv['onPage']>[0] = () => undefined;
  let command: Parameters<ApiResultsBridgeEnv['onCommand']>[0] = () => false;
  let restore = () => undefined as void;
  let timeout = () => undefined as void;
  let now = 0;
  const post = vi.fn();
  startApiResultsBridge({ onPage: listener => { onPage = listener; }, onCommand: listener => { command = listener; },
    onRestore: listener => { restore = listener; }, post, later: callback => { timeout = callback; return 1; }, cancel: vi.fn(), now: () => now });
  return { onPage, command, restore, timeout: () => timeout(), post, advance: (ms: number) => { now += ms; } };
}

describe('ADR-036 isolated result query channel', () => {
  it('accepts only trusted commands and valid same-window batches for the current query', () => {
    const bridge = setup();
    const reply = vi.fn();
    expect(bridge.command(false, { schemaVersion: 1, type: 'api-results-query' }, reply)).toBe(false);
    expect(bridge.post).not.toHaveBeenCalled();
    expect(bridge.command(true, { schemaVersion: 1, type: 'api-results-query' }, reply)).toBe(true);
    const query = bridge.post.mock.calls[0]![0];
    const message = { ...query, type: 'api-results-batch', batchSeq: 0, final: true, enabled: true, rows: [row], truncated: false };
    bridge.onPage(false, message);
    expect(reply).not.toHaveBeenCalled();
    bridge.onPage(true, message);
    expect(reply).toHaveBeenCalledWith({ schemaVersion: 1, type: 'api-results-cache', epoch: 0, available: true, rows: [row], truncated: false });
  });

  it('invalidates pending replies and advances the live-document epoch before reset acknowledgement', () => {
    const bridge = setup();
    const reply = vi.fn(), resetReply = vi.fn();
    bridge.command(true, { schemaVersion: 1, type: 'api-results-query' }, reply);
    const old = bridge.post.mock.calls[0]![0];
    bridge.command(true, { schemaVersion: 1, type: 'api-results-reset' }, resetReply);
    expect(reply).toHaveBeenCalledWith(expect.objectContaining({ available: false, rows: [] }));
    expect(resetReply).toHaveBeenCalledWith({ schemaVersion: 1, type: 'api-results-reset-ack', epoch: 1 });
    const next = vi.fn();
    bridge.command(true, { schemaVersion: 1, type: 'api-results-query' }, next);
    bridge.onPage(true, { ...old, type: 'api-results-batch', batchSeq: 0, final: true, enabled: true, rows: [row], truncated: false });
    bridge.timeout();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ available: false, rows: [], epoch: 1 }));
  });

  it('bounds pending callers and ignores malformed values instead of forwarding them', () => {
    const bridge = setup();
    const replies = Array.from({ length: 5 }, () => vi.fn());
    for (const reply of replies) bridge.command(true, { schemaVersion: 1, type: 'api-results-query' }, reply);
    expect(replies[4]).toHaveBeenCalledWith(expect.objectContaining({ available: false, rows: [] }));
    const query = bridge.post.mock.calls[0]![0];
    for (let index = 0; index < 1000; index++) bridge.onPage(true, { ...query, type: 'api-results-batch', batchSeq: 0, final: true, enabled: true,
      rows: [{ ...row, operation: 'Document.cookie', value: { kind: 'string', value: 'SECRET_CANARY' } }], truncated: false });
    bridge.timeout();
    for (const reply of replies) expect(JSON.stringify(reply.mock.calls)).not.toContain('SECRET_CANARY');
    expect(bridge.post).toHaveBeenCalledTimes(1);
  });

  it('invalidates old previews on BFCache restore without calling any page API', () => {
    const bridge = setup();
    bridge.restore();
    expect(bridge.post).toHaveBeenCalledWith({ channel: API_RESULTS_CHANNEL, type: 'api-results-reset', epoch: 1, requestId: 'reset-1' });
  });

  it('shares a result for one second across UI readers and drops it immediately on reset', () => {
    const bridge = setup();
    const request = { schemaVersion: 1, type: 'api-results-query' };
    const first = vi.fn(), second = vi.fn();
    bridge.command(true, request, first);
    const query = bridge.post.mock.calls[0]![0];
    bridge.onPage(true, { ...query, type: 'api-results-batch', batchSeq: 0, final: true, enabled: true, rows: [row], truncated: false });
    bridge.advance(500);
    expect(bridge.command(true, request, second)).toBe(false);
    expect(second).toHaveBeenCalledWith(first.mock.calls[0]![0]);
    expect(bridge.post).toHaveBeenCalledTimes(1);
    bridge.command(true, { schemaVersion: 1, type: 'api-results-reset' }, vi.fn());
    const afterReset = vi.fn();
    expect(bridge.command(true, request, afterReset)).toBe(true);
    expect(afterReset).not.toHaveBeenCalled();
    expect(bridge.post.mock.calls[2]![0].epoch).toBe(1);
    bridge.timeout();
    expect(afterReset).toHaveBeenCalledWith(expect.objectContaining({ rows: [], available: false }));
  });

  it('does not reuse a snapshot after the one-second deadline', () => {
    const bridge = setup();
    const request = { schemaVersion: 1, type: 'api-results-query' };
    bridge.command(true, request, vi.fn());
    const query = bridge.post.mock.calls[0]![0];
    bridge.onPage(true, { ...query, type: 'api-results-batch', batchSeq: 0, final: true, enabled: true, rows: [row], truncated: false });
    bridge.advance(1001);
    const second = vi.fn();
    expect(bridge.command(true, request, second)).toBe(true);
    expect(second).not.toHaveBeenCalled();
    expect(bridge.post).toHaveBeenCalledTimes(2);
  });
});