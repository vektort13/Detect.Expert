// Rasterizes logo.svg (38x22, wide) centered on a transparent square canvas with ~12% padding into
// apps/extension/public/icons/{16,32,48,128}.png via @resvg/resvg-js (ADR-002). Output is deterministic.
// Usage: node scripts/icons.mjs

import { Resvg } from '@resvg/resvg-js';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const logoPath = join(root, 'logo.svg');
const outDir = join(root, 'apps', 'extension', 'public', 'icons');
const SIZES = [16, 32, 48, 128];
const PADDING = 0.12;

const svg = readFileSync(logoPath, 'utf8');
const viewBoxMatch = /viewBox="([^"]+)"/.exec(svg);
if (!viewBoxMatch) throw new Error('logo.svg has no viewBox');
const viewBox = viewBoxMatch[1].trim();
const inner = svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');

function wrap(size) {
  const pad = Math.round(size * PADDING);
  const box = size - 2 * pad;
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '">' +
    '<svg x="' + pad + '" y="' + pad + '" width="' + box + '" height="' + box + '" viewBox="' + viewBox + '" preserveAspectRatio="xMidYMid meet">' +
    inner +
    '</svg></svg>'
  );
}

/** Bounding box of non-transparent pixels, to prove the artwork is centered inside the padding. */
function alphaBounds(rendered) {
  const { width, height, pixels } = rendered;
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (pixels[(y * width + x) * 4 + 3] > 8) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  return { minX, minY, maxX, maxY };
}

mkdirSync(outDir, { recursive: true });
for (const size of SIZES) {
  const resvg = new Resvg(wrap(size), { fitTo: { mode: 'width', value: size } });
  const rendered = resvg.render();
  if (rendered.width !== size || rendered.height !== size) {
    throw new Error('unexpected raster size for ' + size + ': ' + rendered.width + 'x' + rendered.height);
  }
  const png = rendered.asPng();
  const file = join(outDir, size + '.png');
  writeFileSync(file, png);
  const b = alphaBounds(rendered);
  if (b.maxX < 0) throw new Error('icon ' + size + ' rendered fully transparent');
  const pad = Math.round(size * PADDING);
  if (b.minX < pad || b.maxX > size - 1 - pad) throw new Error('icon ' + size + ' artwork exceeds horizontal padding');
  const centerError = Math.abs((b.minY + b.maxY) / 2 - (size - 1) / 2);
  console.log(
    'icons: ' + size + 'x' + size + ' -> ' + file + ' (' + png.length + ' B; ink x ' + b.minX + '..' + b.maxX +
    ', y ' + b.minY + '..' + b.maxY + ', vertical center error ' + centerError.toFixed(1) + 'px)',
  );
}
