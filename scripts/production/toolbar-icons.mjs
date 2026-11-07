// ADR-042/045: local state variants of the existing vector logo. No remote assets.
import { Resvg } from '@resvg/resvg-js';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '../..');
const svg = readFileSync(resolve(root, 'logo.svg'), 'utf8');
const viewBox = /viewBox="([^"]+)"/.exec(svg)?.[1];
if (!viewBox) throw Error('Missing logo viewBox');
const inner = svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
const check = process.argv.includes('--check');
for (const [name, color] of [['green', '#168451'], ['gray', '#8D929C']]) {
  for (const size of [16, 32, 48, 128]) {
    const pad = Math.round(size * .12), box = size - 2 * pad;
    const source = '<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size + '">' +
      '<svg x="' + pad + '" y="' + pad + '" width="' + box + '" height="' + box + '" viewBox="' + viewBox + '">' +
      inner.replaceAll('#2D66D2', color) + '</svg></svg>';
    const png = Buffer.from(new Resvg(source, { font: { loadSystemFonts: false } }).render().asPng());
    const file = resolve(root, 'apps/production-extension/icons', name + '-' + size + '.png');
    if (check) { if (!readFileSync(file).equals(png)) throw Error('Toolbar icon drift: ' + name + '-' + size); }
    else writeFileSync(file, png);
  }
}
console.log('Toolbar icons: 8 ' + (check ? 'verified' : 'generated') + ' local PNG variants.');
