// ADR-020 §F (S10): ScriptRef of the first page frame and the masked send target. Golden frames, hostile strings,
// a 10^4 fuzz, a 1 MiB input, patched String.prototype methods (MAIN safety) and equality with the contracts'
// templateScriptPath (the validator accepts exactly its fixed points).

import { describe, expect, it } from 'vitest';
import { PROTECT_BUDGETS, isScriptHost, isScriptPathTemplate, templateScriptPath } from '@detect-expert/contracts';
import type { ScriptRef } from '@detect-expert/contracts';
import thresholds from '../../engine/src/rules/thresholds/network-observed.v1.json';
import {
  MAX_TARGET_SCAN,
  RANDOM_LABEL_MIN_CHARS,
  RANDOM_LABEL_MIN_DIGITS,
  RANDOM_LABEL_MIN_LETTERS,
  maskHost,
  parseFirstPageFrame,
  reduceTargetUrl,
  scriptRefKey,
  templatePathSafe,
} from '../src/script-ref';

const DOC = 'shop.example.com';

function stack(...frames: string[]): string {
  return ['Error', ...frames.map((f) => '    at ' + f)].join('\n');
}

/** Same rules as the contracts' readScriptRef (validators): the wire accepts exactly these shapes. */
function assertValidRef(ref: ScriptRef): void {
  if (ref.kind === 'external') {
    expect(Object.keys(ref).sort()).toEqual(['host', 'kind', 'pathTemplate', 'scheme']);
    expect(['http', 'https']).toContain(ref.scheme);
    expect(isScriptHost(ref.host), String(ref.host)).toBe(true);
    expect(isScriptPathTemplate(ref.pathTemplate), String(ref.pathTemplate)).toBe(true);
  } else {
    expect(Object.keys(ref)).toEqual(['kind']);
    expect(['document', 'eval', 'opaque', 'extension', 'unknown']).toContain(ref.kind);
  }
}

describe('parseFirstPageFrame: golden V8 frames', () => {
  const cases: Array<[string, string, ScriptRef]> = [
    ['named external frame', stack('collect (https://cdn.tracker-a.example.org/lib/v2/collect.js:12:34)'), { kind: 'external', scheme: 'https', host: 'cdn.tracker-a.example.org', pathTemplate: '/lib/v2/collect.js' }],
    ['anonymous external frame', stack('https://cdn.example.net/a.js:1:2'), { kind: 'external', scheme: 'https', host: 'cdn.example.net', pathTemplate: '/a.js' }],
    ['async prefix', stack('async send (https://cdn.example.net/app/main.js:3:4)'), { kind: 'external', scheme: 'https', host: 'cdn.example.net', pathTemplate: '/app/main.js' }],
    ['new prefix', stack('new Tracker (http://cdn.example.net/t.js:3:4)'), { kind: 'external', scheme: 'http', host: 'cdn.example.net', pathTemplate: '/t.js' }],
    ['query, fragment, userinfo and port dropped', stack('f (https://user:secret@CDN.Example.NET:8443/x/y.js?token=abc#frag:9:9)'), { kind: 'external', scheme: 'https', host: 'cdn.example.net', pathTemplate: '/x/y.js' }],
    ['inline code of the document', stack('onclick (https://shop.example.com/checkout?step=2:40:7)'), { kind: 'document' }],
    ['same host but a .js file is external', stack('f (https://shop.example.com/static/app.js:1:1)'), { kind: 'external', scheme: 'https', host: 'shop.example.com', pathTemplate: '/static/app.js' }],
    // A V8 eval frame; the literal is split so the source lint (eval-call pattern) never sees a call.
    ['eval frame', stack('eval' + ' (eval at load (https://cdn.example.net/l.js:1:1), <anonymous>:1:1)'), { kind: 'eval' }],
    ['Function-constructor frame', stack('Object.eval [as run] (eval at <anonymous> (https://cdn.example.net/l.js:2:2), <anonymous>:3:4)'), { kind: 'eval' }],
    ['code without a URL', stack('<anonymous>:1:1'), { kind: 'eval' }],
    ['blob script', stack('w (blob:https://shop.example.com/0b1c-22:1:5)'), { kind: 'opaque' }],
    ['data script', stack('data:text/javascript,alert(1):1:1'), { kind: 'opaque' }],
    ['file script', stack('f (file:///C:/x/y.js:1:1)'), { kind: 'opaque' }],
    ['wasm frame', stack('wasm://wasm/1a2b3c:wasm-function[0]:0x5d'), { kind: 'opaque' }],
    ['IP literal', stack('f (http://127.0.0.1:4173/a.js:1:1)'), { kind: 'unknown' }],
    ['IPv6 literal', stack('f (http://[::1]:4173/a.js:1:1)'), { kind: 'unknown' }],
    ['single label host', stack('f (http://localhost:4173/a.js:1:1)'), { kind: 'unknown' }],
    ['non-ASCII host', stack('f (https://пример.example/a.js:1:1)'), { kind: 'unknown' }],
    ['sourceURL name without a scheme', stack('f (webpack:///src/x.js:1:1)'), { kind: 'unknown' }],
    ['random labels are masked', stack('f (https://a1b2c3d4e5f6g7.cdn.example.net/x.js:1:1)'), { kind: 'external', scheme: 'https', host: '*.cdn.example.net', pathTemplate: '/x.js' }],
    ['ID-like path words are templated', stack('f (https://cdn.example.net/u/12345/0123abcd9f/s.js:1:1)'), { kind: 'external', scheme: 'https', host: 'cdn.example.net', pathTemplate: '/u/:id/:id/s.js' }],
    ['long paths keep the last segments', stack('f (https://cdn.example.net/a/b/c/d/e/f.js:1:1)'), { kind: 'external', scheme: 'https', host: 'cdn.example.net', pathTemplate: '/:skip/d/e/f.js' }],
  ];
  for (const [name, input, expected] of cases) {
    it(name, () => {
      const ref = parseFirstPageFrame(input, DOC);
      expect(ref).toEqual(expected);
      assertValidRef(ref);
    });
  }

  it('skips native frames without a position and extension frames; only extension frames -> extension', () => {
    expect(parseFirstPageFrame(stack('Array.map (<anonymous>)', 'new Promise (<anonymous>)', 'f (https://cdn.example.net/a.js:1:1)'), DOC)).toMatchObject({ kind: 'external', host: 'cdn.example.net' });
    expect(parseFirstPageFrame(stack('w (chrome-extension://abcdefghijklmnopabcdefghijklmnop/protect.main.js:1:1)', 'f (https://cdn.example.net/a.js:1:1)'), DOC)).toMatchObject({ kind: 'external' });
    expect(parseFirstPageFrame(stack('w (chrome-extension://abc/protect.main.js:1:1)', 'x (moz-extension://def/cs.js:2:2)'), DOC)).toEqual({ kind: 'extension' });
    expect(parseFirstPageFrame(stack('Array.map (<anonymous>)'), DOC)).toEqual({ kind: 'unknown' });
    expect(parseFirstPageFrame('Error', DOC)).toEqual({ kind: 'unknown' });
    expect(parseFirstPageFrame('', DOC)).toEqual({ kind: 'unknown' });
  });

  it('reads at most maxStackScanLines frames and maxStackScanChars characters', () => {
    const natives = Array.from({ length: PROTECT_BUDGETS.maxStackScanLines }, () => 'Array.map (<anonymous>)');
    expect(parseFirstPageFrame(stack(...natives, 'f (https://cdn.example.net/a.js:1:1)'), DOC)).toEqual({ kind: 'unknown' });
    const long = 'x'.repeat(PROTECT_BUDGETS.maxStackScanChars);
    expect(parseFirstPageFrame(stack(long + ' (<anonymous>)', 'f (https://cdn.example.net/a.js:1:1)'), DOC)).toEqual({ kind: 'unknown' });
  });

  it('a hostile function name can neither inject a location nor leak itself', () => {
    const hostile = stack('x (https://evil.example.org/fake.js:1:1) y (https://cdn.example.net/real.js:3:4)');
    expect(parseFirstPageFrame(hostile, DOC)).toEqual({ kind: 'external', scheme: 'https', host: 'cdn.example.net', pathTemplate: '/real.js' });
    const secret = stack('steal_SECRET123 (https://cdn.example.net/a.js?SECRET123=1#SECRET123:1:1)');
    expect(JSON.stringify(parseFirstPageFrame(secret, DOC))).not.toContain('SECRET123');
    expect(JSON.stringify(parseFirstPageFrame(stack('f (https://cdn.example.net/a.js:1:1)'), DOC))).not.toMatch(/:1:1|collect \(/);
  });
});

describe('maskHost and the thresholds of network-observed.v1.json', () => {
  it('uses the same random-label thresholds', () => {
    expect(RANDOM_LABEL_MIN_CHARS).toBe(thresholds.minRandomLabelChars);
    expect(RANDOM_LABEL_MIN_DIGITS).toBe(thresholds.minRandomLabelDigits);
    expect(RANDOM_LABEL_MIN_LETTERS).toBe(thresholds.minRandomLabelLetters);
  });

  it('masks random labels, lowercases, keeps the suffix real and refuses IPs and odd names', () => {
    expect(maskHost('CDN.Example.org.')).toBe('cdn.example.org');
    expect(maskHost('x9y8z7w6v5u4.example.org')).toBe('*.example.org');
    expect(maskHost('abcdefghijkl.example.org')).toBe('abcdefghijkl.example.org'); // letters only: not random
    expect(maskHost('127.0.0.1')).toBeNull();
    expect(maskHost('localhost')).toBeNull();
    expect(maskHost('a_b.example.org')).toBeNull();
    expect(maskHost('-a.example.org')).toBeNull();
    expect(maskHost('example.a1b2c3d4e5f6')).toBeNull();
    expect(maskHost('x'.repeat(64) + '.example.org')).toBeNull();
    for (const h of ['cdn.example.org', 'x9y8z7w6v5u4.example.org', 'a.b.c.example.net']) expect(isScriptHost(maskHost(h))).toBe(true);
  });
});

describe('templatePathSafe equals the contracts template', () => {
  it('golden paths', () => {
    for (const p of ['', '/', '/a.js', '/a/b/c/d.js', '/a/b/c/d/e.js', '/:skip/x/y.js', '/a//b///c.js', '/v1.2.3/lib.min.js', '/%E2%82%AC/a.js', '/x~y/z_q-r.js', '/' + 'a'.repeat(200) + '.js']) {
      expect(templatePathSafe(p), p).toBe(templateScriptPath(p));
      expect(isScriptPathTemplate(templatePathSafe(p)), p).toBe(true);
    }
  });

  it('fuzz 10^4: identical to templateScriptPath, valid and idempotent', () => {
    let seed = 12345;
    const rnd = (n: number): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % n;
    };
    const alphabet = 'abcXYZ019/./-_~:%?#@ \\é';
    for (let i = 0; i < 10_000; i++) {
      let p = '/';
      const n = rnd(120);
      for (let j = 0; j < n; j++) p += alphabet[rnd(alphabet.length)]!;
      const t = templatePathSafe(p);
      expect(t).toBe(templateScriptPath(p));
      expect(templatePathSafe(t)).toBe(t);
    }
  });
});

describe('fuzz and size bounds of the frame parser', () => {
  it('10^4 random stacks: never throws, always a valid ScriptRef', () => {
    let seed = 777;
    const rnd = (n: number): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % n;
    };
    const pieces = ['at ', '    at ', 'async ', 'new ', '(', ')', ' (', 'https://', 'http://', 'chrome-extension://', 'blob:', 'eval at ', '<anonymous>', ':1', ':22', '/', '.js', 'cdn.', 'example.org', 'x9y8z7w6v5u4.', '127.0.0.1', '@', '?', '#', '\n', ' ', 'é', '\u0000'];
    for (let i = 0; i < 10_000; i++) {
      let s = '';
      const n = rnd(40);
      for (let j = 0; j < n; j++) s += pieces[rnd(pieces.length)]!;
      assertValidRef(parseFirstPageFrame(s, DOC));
    }
  });

  it('a 1 MiB input is bounded (no full scan)', () => {
    const big = stack('f (https://cdn.example.net/' + 'a/'.repeat(512 * 1024) + 'x.js:1:1)');
    expect(big.length).toBeGreaterThan(1024 * 1024);
    const t0 = performance.now();
    const ref = parseFirstPageFrame(big, DOC);
    expect(performance.now() - t0).toBeLessThan(200);
    assertValidRef(ref);
    const target = reduceTargetUrl('https://cdn.example.net/' + 'q'.repeat(1024 * 1024), DOC);
    expect(target).toEqual({ kind: 'absolute', host: 'cdn.example.net' });
  });
});

describe('reduceTargetUrl', () => {
  it('absolute, relative, protocol-relative, document host, unread and non-network schemes', () => {
    expect(reduceTargetUrl('https://collect.tracker-a.example.org/v1/e?email=a@b.c', DOC)).toEqual({ kind: 'absolute', host: 'collect.tracker-a.example.org' });
    expect(reduceTargetUrl('  HTTPS://user:pw@Collect.Example.NET:8443/x', DOC)).toEqual({ kind: 'absolute', host: 'collect.example.net' });
    expect(reduceTargetUrl('//cdn.example.net/p', DOC)).toEqual({ kind: 'absolute', host: 'cdn.example.net' });
    expect(reduceTargetUrl('/api/v1?x=1', DOC)).toEqual({ kind: 'relative' });
    expect(reduceTargetUrl('api/v1:foo', DOC)).toEqual({ kind: 'relative' });
    expect(reduceTargetUrl('', DOC)).toEqual({ kind: 'relative' });
    expect(reduceTargetUrl('https://shop.example.com/api', DOC)).toEqual({ kind: 'relative' });
    expect(reduceTargetUrl('http://127.0.0.1:4173/x', DOC)).toEqual({ kind: 'unread' });
    expect(reduceTargetUrl('https://[::1]/x', DOC)).toEqual({ kind: 'unread' });
    for (const s of ['data:text/plain,x', 'blob:https://shop.example.com/1', 'javascript:void 0', 'about:blank', 'mailto:a@b.c', 'chrome-extension://x/y']) {
      expect(reduceTargetUrl(s, DOC), s).toBeNull();
    }
    expect(MAX_TARGET_SCAN).toBeGreaterThanOrEqual(2048);
  });
});

describe('MAIN safety: patched String.prototype methods are never called', () => {
  it('works and calls none of the page-patched methods', () => {
    const names = ['slice', 'indexOf', 'lastIndexOf', 'charCodeAt', 'toLowerCase', 'startsWith', 'endsWith', 'split', 'substring', 'includes', 'replace', 'trim'] as const;
    const proto = String.prototype as unknown as Record<string, unknown>;
    const saved = new Map(names.map((n) => [n, proto[n]]));
    const ArrayProto = Array.prototype as unknown as Record<string, unknown>;
    const savedPush = ArrayProto['push'];
    let calls = 0;
    let out: unknown = null;
    try {
      for (const n of names) {
        proto[n] = function patched() {
          calls++;
          throw new Error('page patch');
        };
      }
      ArrayProto['push'] = function patched() {
        calls++;
        throw new Error('page patch push');
      };
      const ref = parseFirstPageFrame(stack('Array.map (<anonymous>)', 'f (https://user@CDN.Example.NET:1/u/12345/a.js?q#h:1:2)'), DOC);
      out = {
        ref,
        target: reduceTargetUrl('HTTPS://Collect.Example.NET/x', DOC),
        masked: maskHost('X9Y8Z7W6V5U4.example.org'),
        template: templatePathSafe('/a/b/c/d/e/f.js'),
        key: scriptRefKey(ref),
      };
    } finally {
      for (const [n, f] of saved) proto[n] = f;
      ArrayProto['push'] = savedPush;
    }
    // Asserted after the restore (the test runner itself uses string methods).
    expect(calls).toBe(0);
    expect(out).toEqual({
      ref: { kind: 'external', scheme: 'https', host: 'cdn.example.net', pathTemplate: '/u/:id/a.js' },
      target: { kind: 'absolute', host: 'collect.example.net' },
      masked: '*.example.org',
      template: '/:skip/d/e/f.js',
      key: 'x|https|cdn.example.net|/u/:id/a.js',
    });
  });
});
