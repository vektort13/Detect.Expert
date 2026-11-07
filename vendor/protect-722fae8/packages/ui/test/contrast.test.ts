import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync('packages/ui/src/styles/ui.css', 'utf8');
function luminance(hex: string): number {
  const rgb = hex.match(/[a-f\d]{2}/gi)!.map((channel) => {
    const value = parseInt(channel, 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return rgb[0]! * 0.2126 + rgb[1]! * 0.7152 + rgb[2]! * 0.0722;
}
describe('F060 control boundary contrast from actual CSS tokens', () => {
  const themes = [...css.matchAll(/:root\s*\{([^}]+)\}/g)];
  for (const [index, theme] of themes.entries()) it(index === 0 ? 'light' : 'dark', () => {
    const tokens = Object.fromEntries([...theme[1]!.matchAll(/(--[a-z0-9-]+):\s*(#[a-f\d]{6})/gi)].map((match) => [match[1], match[2]]));
    for (const surface of ['--surface', '--surface-2']) {
      const a = luminance(tokens['--control-border']!);
      const b = luminance(tokens[surface]!);
      expect((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)).toBeGreaterThanOrEqual(3);
    }
  });
  it('applies the boundary to inputs and supports forced colors', () => {
    expect(themes).toHaveLength(2);
    expect(css).toMatch(/\.field input\s*\{[^}]*border: 1px solid var\(--control-border\)/);
    expect(css).toMatch(/@media \(forced-colors: active\)[\s\S]*\.field input,[^}]*border-color: CanvasText/);
  });
});

// S13 / E13-02: aria-disabled buttons, the filter summary and the timeline description use --muted on --surface-2.
describe('S13 muted text and new controls', () => {
  const themes = [...css.matchAll(/:root\s*\{([^}]+)\}/g)];
  for (const [index, theme] of themes.entries()) it('--muted on --surface-2 >= 3:1 (' + (index === 0 ? 'light' : 'dark') + ')', () => {
    const tokens = Object.fromEntries([...theme[1]!.matchAll(/(--[a-z0-9-]+):\s*(#[a-f\d]{6})/gi)].map((match) => [match[1], match[2]]));
    for (const surface of ['--surface', '--surface-2']) {
      const a = luminance(tokens['--muted']!);
      const b = luminance(tokens[surface]!);
      expect((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)).toBeGreaterThanOrEqual(3);
    }
  });
  it('selects share the input boundary, aria-disabled stays focusable without fading, forced colors cover the new parts', () => {
    expect(css).toMatch(/\.field select\s*\{[^}]*border: 1px solid var\(--control-border\)/);
    expect(css).toMatch(/\.button\[aria-disabled="true"\]:not\(\.button--primary\)\s*\{[^}]*color: var\(--muted\)/);
    expect(css).not.toMatch(/\[aria-disabled="true"\][^{]*\{[^}]*(pointer-events|opacity)/);
    expect(css).toMatch(/\.filters\s*\{[^}]*repeat\(auto-fit, minmax\(min\(140px, 100%\), 1fr\)\)/);
    expect(css).toMatch(/\.dialog--confirm\s*\{[^}]*max-inline-size: min\(420px, 100vw - 24px\)/);
    expect(css).toMatch(/@media \(forced-colors: active\)[\s\S]*\.field select,[\s\S]*\.timeline__track,[^}]*border-color: CanvasText/);
    expect(css).toMatch(/\.timeline__bar\s*\{[^}]*inset-inline-start: var\(--timeline-start/);
  });
});
