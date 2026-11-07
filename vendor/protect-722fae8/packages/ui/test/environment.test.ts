import { describe, expect, it } from 'vitest';
import { classifyTabUrl, isChromeSupported, parseChromeMajor } from '../src/view-models/environment';

describe('classifyTabUrl (restricted page state)', () => {
  it('flags built-in pages, extensions, view-source, file and the Web Store', () => {
    for (const url of [
      'chrome://extensions',
      'chrome-extension://abcdefghijklmnopabcdefghijklmnop/popup.html',
      'chrome-untrusted://new-tab-page/',
      'devtools://devtools/bundled/inspector.html',
      'about:blank',
      'view-source:https://example.com/',
      'file:///C:/tmp/a.html',
      'https://chromewebstore.google.com/detail/x',
      'https://chrome.google.com/webstore/detail/x',
      'data:text/html,hi',
    ]) {
      expect(classifyTabUrl(url), url).toBe('restricted');
    }
  });

  it('ordinary http(s) pages are web; missing url is unknown; garbage is restricted', () => {
    expect(classifyTabUrl('https://example.com/a?b=1#c')).toBe('web');
    expect(classifyTabUrl('http://127.0.0.1:4173/index.html')).toBe('web');
    expect(classifyTabUrl(undefined)).toBe('unknown');
    expect(classifyTabUrl('')).toBe('unknown');
    expect(classifyTabUrl('not a url')).toBe('restricted');
  });
});

describe('Chrome version support', () => {
  it('reads the major from brands first, then the UA string', () => {
    expect(parseChromeMajor([{ brand: 'Not/A)Brand', version: '99' }, { brand: 'Google Chrome', version: '153' }], undefined)).toBe(153);
    expect(parseChromeMajor([{ brand: 'Chromium', version: '120' }], 'Mozilla/5.0 Chrome/119.0')).toBe(120);
    expect(parseChromeMajor(undefined, 'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/118.0.0.0 Safari/537.36')).toBe(118);
    expect(parseChromeMajor(undefined, 'Mozilla/5.0 Firefox/130.0')).toBeNull();
    expect(parseChromeMajor([], undefined)).toBeNull();
  });

  it('claims "unsupported" only with a known version below the manifest floor (REQ-015)', () => {
    expect(isChromeSupported(118, '119')).toBe(false);
    expect(isChromeSupported(119, '119')).toBe(true);
    expect(isChromeSupported(153, '119')).toBe(true);
    expect(isChromeSupported(null, '119')).toBe(true);
    expect(isChromeSupported(100, undefined)).toBe(true);
    expect(isChromeSupported(100, 'x')).toBe(true);
  });
});
