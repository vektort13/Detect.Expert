import { describe, expect, it } from 'vitest';
import { readPageSender, verifyPageSender, verifyUiSender } from '../src/index';
import { RUNTIME_ID, pageSender, uiSender } from './fake-chrome';

describe('readPageSender (content channel, REQ-004)', () => {
  it('accepts a content-script sender and derives documentKey/host from MessageSender only', () => {
    const r = readPageSender(pageSender(), RUNTIME_ID);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.context.documentKey).toBe('7:0:DOC000000000000000000000000000001');
    expect(r.context.host).toBe('example.com');
    expect(r.context.originPattern).toBe('https://example.com/*');
    expect(r.context.documentLifecycle).toBe('active');
    expect(JSON.stringify(r.context)).not.toContain('q=1');
  });

  it('rejects extension-page senders, foreign extensions and senders without tab/frame/documentId', () => {
    expect(readPageSender(uiSender(), RUNTIME_ID)).toEqual({ ok: false, reason: 'extension-page' });
    expect(readPageSender(pageSender({ id: 'other' }), RUNTIME_ID)).toEqual({ ok: false, reason: 'foreign-extension' });
    expect(readPageSender(pageSender({ tab: undefined }), RUNTIME_ID)).toEqual({ ok: false, reason: 'no-tab' });
    expect(readPageSender(pageSender({ tabId: -1 }), RUNTIME_ID)).toEqual({ ok: false, reason: 'no-tab' });
    expect(readPageSender(pageSender({ frameId: undefined }), RUNTIME_ID)).toEqual({ ok: false, reason: 'no-frame' });
    expect(readPageSender(pageSender({ documentId: undefined }), RUNTIME_ID)).toEqual({ ok: false, reason: 'no-document-id' });
    expect(readPageSender(pageSender({ documentId: 'bad id!' }), RUNTIME_ID)).toEqual({ ok: false, reason: 'no-document-id' });
    expect(readPageSender(pageSender({ url: 'chrome://settings', origin: 'chrome://settings' }), RUNTIME_ID)).toEqual({
      ok: false,
      reason: 'opaque-origin',
    });
  });

  it('falls back to sender.origin for about:blank frames and rejects opaque origins', () => {
    const r = readPageSender(pageSender({ url: 'about:blank', origin: 'https://parent.example' }), RUNTIME_ID);
    expect(r.ok && r.context.host).toBe('parent.example');
    expect(readPageSender(pageSender({ url: 'about:blank', origin: 'null' }), RUNTIME_ID)).toEqual({ ok: false, reason: 'opaque-origin' });
  });

  it('verifyPageSender requires the origin to be inside the granted scope', async () => {
    const granted = await verifyPageSender(pageSender(), RUNTIME_ID, { isGranted: async () => true });
    expect(granted.ok).toBe(true);
    const denied = await verifyPageSender(pageSender(), RUNTIME_ID, { isGranted: async () => false });
    expect(denied).toEqual({ ok: false, reason: 'out-of-scope' });
    const throwing = await verifyPageSender(pageSender(), RUNTIME_ID, {
      isGranted: async () => {
        throw new Error('boom');
      },
    });
    expect(throwing).toEqual({ ok: false, reason: 'out-of-scope' });
  });
});

describe('verifyUiSender (privileged channel)', () => {
  it('accepts popup/side panel senders and our own options page in a tab', () => {
    expect(verifyUiSender(uiSender(), RUNTIME_ID)).toBe(true);
    expect(verifyUiSender(uiSender({ tab: { id: 3 }, url: 'chrome-extension://' + RUNTIME_ID + '/options.html' }), RUNTIME_ID)).toBe(true);
  });

  it('rejects page senders, other extensions and origin/url mismatches', () => {
    expect(verifyUiSender(pageSender(), RUNTIME_ID)).toBe(false);
    expect(verifyUiSender(uiSender({ id: 'other' }), RUNTIME_ID)).toBe(false);
    expect(verifyUiSender(uiSender({ origin: 'chrome-extension://' + 'b'.repeat(32) }), RUNTIME_ID)).toBe(false);
    expect(verifyUiSender(uiSender({ tab: { id: 3 }, url: 'https://example.com/' }), RUNTIME_ID)).toBe(false);
    expect(verifyUiSender({ id: RUNTIME_ID, tab: { id: 3 }, frameId: 0, url: 'https://example.com/', origin: 'https://example.com', documentId: 'D' }, RUNTIME_ID)).toBe(false);
  });
});
