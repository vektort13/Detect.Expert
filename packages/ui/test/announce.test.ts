import { describe, expect, it } from 'vitest';
import { INITIAL_ANNOUNCER, announce, announcementFor, flushAnnouncer } from '../src/view-models/announce';
import { fallbackMessage } from '../src/i18n';
import { msg, resolveMessage } from '../src/view-models/message';
import { finding, report } from './fixtures';

describe('throttled aria-live announcer (once per 2 s)', () => {
  it('emits the first text immediately, then holds the next one until the interval passes', () => {
    const first = announce(INITIAL_ANNOUNCER, 'A', 1000);
    expect(first.emit).toBe('A');
    expect(first.retryInMs).toBeNull();

    const second = announce(first.state, 'B', 1500);
    expect(second.emit).toBeNull();
    expect(second.retryInMs).toBe(1500);
    expect(second.state.pending).toBe('B');

    const third = announce(second.state, 'C', 1800);
    expect(third.emit).toBeNull();
    expect(third.state.pending).toBe('C');

    const early = flushAnnouncer(third.state, 2500);
    expect(early.emit).toBeNull();
    expect(early.retryInMs).toBe(500);

    const flushed = flushAnnouncer(third.state, 3000);
    expect(flushed.emit).toBe('C');
    expect(flushed.state.pending).toBeNull();
    expect(flushed.state.lastAt).toBe(3000);
  });

  it('does not repeat an identical text and drops a pending text equal to the last one', () => {
    const first = announce(INITIAL_ANNOUNCER, 'A', 0);
    expect(announce(first.state, 'A', 5000).emit).toBeNull();
    const pending = announce(first.state, 'B', 100);
    const back = announce(pending.state, 'A', 200);
    expect(back.emit).toBeNull();
    expect(back.state.pending).toBeNull();
  });

  it('aggregates findings count and observation state, nothing per API call', () => {
    expect(announcementFor(null, msg('status_off'))).toBeNull();
    const rep = report({ findings: [finding({ findingId: 'a', techniqueId: 'DET-002' }), finding({ findingId: 'b', techniqueId: 'DET-022' })] });
    const text = resolveMessage(fallbackMessage, announcementFor(rep, msg('status_active'))!);
    expect(text).toBe('aria_live_update[2, status_active]');
  });
});
