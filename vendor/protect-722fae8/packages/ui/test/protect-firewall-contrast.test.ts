// ADR-020 §D (S09): palette of the firewall UI from the actual CSS tokens — --accent on --accent-bg ≥ 4.5:1 in both
// themes (chosen scope, shield), the primary action (--accent-contrast on --accent) ≥ 4.5:1, the per-tab badge colour
// with white text ≥ 4.5:1; firewall.css uses tokens only (no literal colours, so no green), no animation, and a
// forced-colors block.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BADGE_FIREWALL_COLOR } from '../../background/src/badge';

const ui = readFileSync('packages/ui/src/styles/ui.css', 'utf8');
const base = readFileSync('packages/ui/src/styles/protect/base.css', 'utf8');
const firewall = readFileSync('packages/ui/src/styles/protect/firewall.css', 'utf8');

function luminance(hex: string): number {
  const rgb = hex.match(/[a-f\d]{2}/gi)!.map((channel) => {
    const value = parseInt(channel, 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return rgb[0]! * 0.2126 + rgb[1]! * 0.7152 + rgb[2]! * 0.0722;
}

/** CSS without block comments (string code: the lint token scanner does not parse comment-like regex literals). */
function withoutComments(css: string): string {
  let out = '';
  let i = 0;
  for (;;) {
    const start = css.indexOf('/' + '*', i);
    if (start < 0) return out + css.slice(i);
    out += css.slice(i, start);
    const end = css.indexOf('*' + '/', start + 2);
    if (end < 0) return out;
    i = end + 2;
  }
}

function contrast(a: string, b: string): number {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** Literal hex colours (`#` followed by 3–8 hex digits) in CSS, found without a regular expression. */
function hexColours(css: string): string[] {
  const found: string[] = [];
  for (let i = css.indexOf('#'); i >= 0; i = css.indexOf('#', i + 1)) {
    let j = i + 1;
    while (j < css.length && '0123456789abcdefABCDEF'.includes(css.charAt(j))) j++;
    if (j - i - 1 >= 3) found.push(css.slice(i, j));
  }
  return found;
}

/** Hex colour tokens of every `:root { … }` block (light, then dark), parsed without regular expressions. */
function themes(css: string): Array<Record<string, string>> {
  const code = withoutComments(css);
  const out: Array<Record<string, string>> = [];
  let i = 0;
  for (;;) {
    const at = code.indexOf(':root', i);
    if (at < 0) return out;
    const open = code.indexOf('{', at);
    const close = open < 0 ? -1 : code.indexOf('}', open);
    if (open < 0 || close < 0) return out;
    const tokens: Record<string, string> = {};
    for (const decl of code.slice(open + 1, close).split(';')) {
      const colon = decl.indexOf(':');
      if (colon < 0) continue;
      const name = decl.slice(0, colon).trim();
      const value = decl.slice(colon + 1).trim();
      if (name.startsWith('--') && value.startsWith('#') && value.length === 7) tokens[name] = value;
    }
    out.push(tokens);
    i = close + 1;
  }
}

describe('firewall palette (S09)', () => {
  const uiThemes = themes(ui);
  const baseThemes = themes(base);

  it('two themes in ui.css and base.css', () => {
    expect(uiThemes).toHaveLength(2);
    expect(baseThemes).toHaveLength(2);
  });

  for (const [i, name] of ['light', 'dark'].entries()) {
    it('--accent on --accent-bg ≥ 4.5 and --accent-contrast on --accent ≥ 4.5 (' + name + ')', () => {
      const accent = uiThemes[i]!['--accent']!;
      const accentBg = baseThemes[i]!['--accent-bg']!;
      expect(contrast(accent, accentBg)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(uiThemes[i]!['--accent-contrast']!, accent)).toBeGreaterThanOrEqual(4.5);
      // The chosen scope and the options keep their boundary against the card surface.
      expect(contrast(uiThemes[i]!['--control-border']!, uiThemes[i]!['--surface']!)).toBeGreaterThanOrEqual(3);
    });
  }

  it('the per-tab badge colour with white text ≥ 4.5 (6.87:1)', () => {
    expect(contrast(BADGE_FIREWALL_COLOR, '#FFFFFF')).toBeGreaterThanOrEqual(6.8);
  });

  it('firewall.css: tokens only (no literal colours, hence no green), no animation, forced-colors block, ≥ 12 px', () => {
    const code = withoutComments(firewall);
    expect(hexColours(code)).toEqual([]);
    expect(code).not.toMatch(/\b(?:rgb|rgba|hsl|hsla|oklch|lab|lch)\(/i);
    expect(code).not.toMatch(/\bgreen\b|\blime\b/i);
    expect(code).not.toMatch(/animation|transition|@keyframes/i);
    expect(code).toMatch(/@media \(forced-colors: active\)/);
    for (const m of code.matchAll(/font-size:\s*(\d+)px/g)) expect(Number(m[1])).toBeGreaterThanOrEqual(12);
    for (const token of ['--accent', '--accent-bg', '--attention-border', '--attention-bg', '--border', '--control-border']) expect(code).toContain('var(' + token + ')');
    // The primary action is the extension's accent button, never the error colour.
    expect(code).not.toMatch(/\.fw-action[^{]*\{[^}]*--error/);
  });
});
