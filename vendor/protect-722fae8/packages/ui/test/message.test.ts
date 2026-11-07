import { describe, expect, it } from 'vitest';
import { fallbackMessage, t } from '../src/i18n';
import { joinMessages, msg, resolveMessage } from '../src/view-models/message';

describe('message descriptors', () => {
  it('resolves nested messages and joins', () => {
    const message = msg('coverage_partial_desc', joinMessages([msg('coverage_flag_throttled'), 'plain'], '; '));
    expect(resolveMessage(fallbackMessage, message)).toBe('coverage_partial_desc[coverage_flag_throttled; plain]');
    expect(resolveMessage(fallbackMessage, msg('x', 5, msg('y', 'z')))).toBe('x[5, y[z]]');
    expect(msg('k')).toEqual({ key: 'k' });
  });

  it('t() falls back to the key outside the extension (no chrome.i18n in Node)', () => {
    expect(typeof chrome).toBe('undefined');
    expect(t('empty_no_findings')).toBe('empty_no_findings');
    expect(t('coverage_no_access_desc', ['example.com'])).toBe('coverage_no_access_desc[example.com]');
  });
});
