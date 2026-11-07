// REQ-010 / ADR-022: acquire brand artwork only during explicit development research.
// Runtime modules generated here contain local asset references and exact aliases only.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
const root = new URL('../../', import.meta.url);
const ledgerFile = new URL('packages/catalog/research/company-logos-2026-10/registry.json', root);
const directory = new URL('apps/production-extension/icons/brands/', root);
const runtimeFile = new URL('apps/production-extension/company-branding.js', root);
const provenanceFile = new URL('COMPANY-PROVENANCE.json', directory);
const registry = JSON.parse(readFileSync(ledgerFile, 'utf8'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const key = value => value.trim().toLowerCase();
const refresh = process.argv.includes('--refresh');
const check = process.argv.includes('--check');
const MAX_ASSET = 384 * 1024;
async function download(url, limit = MAX_ASSET) {
  const response = await fetch(url, { signal: AbortSignal.timeout(10000), headers: { 'User-Agent': 'Detect.Expert local brand-asset research/1.1.0' } });
  if (!response.ok) throw new Error('HTTP ' + response.status);
  const length = Number(response.headers.get('content-length'));
  if (length > limit) throw new Error('Source exceeds the size budget');
  const reader = response.body.getReader(), chunks = []; let size = 0;
  for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length;
    if (size > limit) { await reader.cancel(); throw new Error('Source exceeds the size budget'); } chunks.push(value); }
  return { bytes: Buffer.concat(chunks), url: response.url, mime: response.headers.get('content-type') ?? '' };
}
function media(bytes) {
  if (bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return { extension: 'png', mime: 'image/png', width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  if (bytes.length >= 6 && bytes.readUInt32LE(0) === 0x10000 && bytes.readUInt16LE(4) > 0) return { extension: 'ico', mime: 'image/x-icon' };
  const svg = bytes.toString('utf8').trim();
  if (/^(?:<\?xml[^>]+>\s*)?(?:<!--[^]*?-->\s*)*<svg\b/i.test(svg)) {
    if (!/\bviewBox\s*=/.test(svg) || /<(?:script|style|image|foreignObject|use|animate[a-z]*|set|discard|iframe|object|embed|audio|video|text)\b|\b(?:href|src|on[a-z]+)\s*=|<!DOCTYPE|<!ENTITY|@import|url\s*\(/i.test(svg)) throw new Error('SVG is not inert self-contained artwork');
    return { extension: 'svg', mime: 'image/svg+xml' };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { extension: 'jpg', mime: 'image/jpeg' };
  if (bytes.subarray(0, 6).toString() === 'GIF89a' || bytes.subarray(0, 6).toString() === 'GIF87a') return { extension: 'gif', mime: 'image/gif' };
  if (bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP') return { extension: 'webp', mime: 'image/webp' };
  throw new Error('Response is not a supported image');
}
function normalizeArtwork(bytes, source = {}) {
  let artwork;
  try { artwork = { bytes, ...media(bytes) }; } catch (originalError) {
    const svg = bytes.toString('utf8').trim();
    if (!/<svg\b/i.test(svg) || /<(?:script|image|foreignObject|animate[a-z]*|set|discard|iframe|object|embed|audio|video|text)\b|\b(?:src|on[a-z]+)\s*=|<!DOCTYPE|<!ENTITY|@import|\b(?:xlink:)?href\s*=\s*["'](?!#)|url\s*\(\s*["']?(?!#)/i.test(svg)) throw originalError;
    // Render static path/CSS artwork to an inert bitmap. No network or system fonts.
    const output = new Resvg(svg, { fitTo: { mode: 'width', value: 96 }, font: { loadSystemFonts: false, fontFiles: [] } }).render().asPng();
    artwork = { bytes: output, ...media(output), sourceSha256: hash(bytes), transformation: 'Static path artwork rasterized at 96px width with resvg 2.6.2; system fonts disabled' };
  }
  if (artwork.extension === 'png' && (source.displayBackground || source.cropTransparentMargins)) {
    if (source.displayBackground && source.displayBackground !== '#202020') throw new Error('Unsupported display background');
    const original = artwork.bytes, width = artwork.width, height = artwork.height;
    if (width * height > 16 * 1024 * 1024) throw new Error('Artwork dimensions exceed the research budget');
    const embedded = `<image width="${width}" height="${height}" href="data:image/png;base64,${original.toString('base64')}"/>`;
    let left = 0, top = 0, right = width - 1, bottom = height - 1;
    if (source.cropTransparentMargins) {
      const pixels = new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${embedded}</svg>`, { font: { loadSystemFonts: false, fontFiles: [] } }).render().pixels;
      left = width; top = height; right = -1; bottom = -1;
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (pixels[(y * width + x) * 4 + 3]) {
        left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y);
      }
      if (right < left) throw new Error('Artwork has no visible pixels');
    }
    const cropWidth = right - left + 1, cropHeight = bottom - top + 1;
    const padding = source.displayBackground ? 8 : 0, scale = (96 - padding * 2) / Math.max(cropWidth, cropHeight);
    const x = (96 - cropWidth * scale) / 2 - left * scale, y = (96 - cropHeight * scale) / 2 - top * scale;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">${source.displayBackground ? '<rect width="96" height="96" fill="#202020"/>' : ''}<g transform="translate(${x} ${y}) scale(${scale})">${embedded}</g></svg>`;
    const output = new Resvg(svg, { font: { loadSystemFonts: false, fontFiles: [] } }).render().asPng();
    const transformations = [artwork.transformation];
    if (source.cropTransparentMargins) transformations.push(`Fully transparent outer margins trimmed to ${cropWidth}x${cropHeight}; original geometry and colours retained`);
    if (source.displayBackground) transformations.push('Original white artwork composited on neutral #202020 tile with padding for visibility; original geometry and colours retained');
    artwork = { bytes: output, ...media(output), sourceSha256: artwork.sourceSha256 ?? hash(bytes), transformation: transformations.filter(Boolean).join('; ') };
  }
  return artwork;
}
async function officialIcon(source) {
  const homepage = new URL(source.url); homepage.hash = ''; homepage.search = '';
  const iconUrls = [...(source.assetUrls ?? [])]; let finalHomepageUrl = homepage.href;
  try {
    const page = await download(homepage.href, 2 * 1024 * 1024);
    finalHomepageUrl = page.url;
    const html = page.bytes.toString('utf8');
    const candidates = [];
    for (const tag of html.match(/<link\b[^>]{0,4096}>/gi) ?? []) {
      const attributes = Object.create(null);
      for (const match of tag.matchAll(/([a-z-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) attributes[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4];
      if (!/(?:^|\s)(?:icon|apple-touch-icon|apple-touch-icon-precomposed)(?:$|\s)/i.test(attributes.rel ?? '') || !attributes.href) continue;
      try { const url = new URL(attributes.href.replaceAll('&amp;', '&'), page.url); if (url.protocol !== 'https:') continue;
        candidates.push({ url: url.href, score: /^apple-touch/i.test(attributes.rel) ? 300 : /(?:64|96|128|180|192|256|512)/.test(attributes.sizes ?? '') ? 200 : /svg/i.test(attributes.type ?? attributes.href) ? 150 : 100 }); } catch { /* malformed HTML link */ }
    }
    candidates.sort((a, b) => b.score - a.score);
    iconUrls.push(...candidates.map(value => value.url));
  } catch { /* The explicit official /favicon.ico route remains available. */ }
  iconUrls.push(new URL('/favicon.ico', homepage).href, new URL('/favicon.png', homepage).href, new URL('/apple-touch-icon.png', homepage).href);
  const errors = [];
  for (const url of [...new Set(iconUrls)].slice(0, 20)) {
    try { const response = await download(url); const image = normalizeArtwork(response.bytes, source);
      return { ...response, ...image, officialHomepageUrl: homepage.href, finalHomepageUrl }; }
    catch (error) { errors.push(url + ': ' + error.message); }
  }
  throw new Error(errors.slice(0, 4).join(' | ') || 'No official icon source');
}
async function acquire(brand) {
  if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(brand.id)) throw new Error('Invalid brand ID');
  const source = brand.source;
  let acquired;
  if (source.type === 'official-site-icon') acquired = await officialIcon(source);
  else if (source.type === 'official-inline-svg') {
    if (!/^[a-z0-9-]{1,40}$/.test(source.inlineSvgClass ?? '')) throw new Error('Invalid inline artwork selector');
    const page = await download(source.url, 2 * 1024 * 1024);
    const html = page.bytes.toString('utf8'), container = `<div class="${source.inlineSvgClass}">`;
    const start = html.indexOf(container); if (start < 0) throw new Error('Official inline artwork selector is unavailable');
    const raw = html.slice(start, start + 64 * 1024).match(/<svg\b[^]*?<\/svg>/)?.[0];
    if (!raw) throw new Error('Official inline SVG is unavailable');
    const bytes = Buffer.from(raw.replace('xmlns="https://www.w3.org/2000/svg"', 'xmlns="http://www.w3.org/2000/svg"').replace('viewbox=', 'viewBox='));
    if (hash(bytes) !== source.expectedArtworkSha256) throw new Error('Official inline artwork changed and requires a new visual review');
    acquired = { url: page.url, officialHomepageUrl: source.url, finalHomepageUrl: page.url, ...normalizeArtwork(bytes, source), transformation: source.extraction };
  } else acquired = await download(source.url).then(result => ({ ...result, ...normalizeArtwork(result.bytes, source) }));
  const file = brand.id + '.' + acquired.extension;
  writeFileSync(new URL(file, directory), acquired.bytes);
  return { id: brand.id, name: brand.name, file, kind: source.type,
    sourceUrl: acquired.url, officialHomepageUrl: acquired.officialHomepageUrl ?? null,
    finalHomepageUrl: acquired.finalHomepageUrl ?? null,
    brandOwner: source.brandOwner ?? null, relationshipSource: source.relationshipSource ?? null,
    relationship: source.relationship ?? null, relationshipSources: source.relationshipSources ?? [],
    relationshipStatus: source.relationshipStatus ?? null, identitySources: source.identitySources ?? [],
    aliasEvidence: brand.aliasEvidence ?? [],
    officialSource: source.officialSource ?? null, license: source.license, licenseUrl: source.licenseUrl ?? null,
    commit: source.commit ?? null, mime: acquired.mime, bytes: acquired.bytes.length, sha256: hash(acquired.bytes),
    sourceSha256: acquired.sourceSha256 ?? null, transformation: acquired.transformation ?? null,
    width: acquired.width ?? null, height: acquired.height ?? null };
}
let provenance = existsSync(provenanceFile) ? JSON.parse(readFileSync(provenanceFile, 'utf8')) : { schemaVersion: 1, accessedAt: registry.accessedAt, assets: [], failures: [] };
if (refresh) {
  mkdirSync(directory, { recursive: true });
  const previous = new Map(provenance.assets.map(value => [value.id, value]));
  const pending = registry.brands.filter(brand => {
    const item = previous.get(brand.id); return !item || !existsSync(new URL(item.file, directory)) || hash(readFileSync(new URL(item.file, directory))) !== item.sha256;
  });
  const failures = []; let cursor = 0;
  await Promise.all(Array.from({ length: 12 }, async () => {
    for (;;) { const brand = pending[cursor++]; if (!brand) return;
      try { previous.set(brand.id, await acquire(brand)); }
      catch (error) { failures.push({ id: brand.id, name: brand.name, source: brand.source.url, error: error.message }); }
      if (cursor % 25 === 0) {
        writeFileSync(provenanceFile, JSON.stringify({ ...provenance, assets: [...previous.values()], failures }, null, 2) + '\n');
        process.stdout.write(JSON.stringify({ acquired: previous.size, attempted: Math.min(cursor, pending.length), pending: pending.length, failures: failures.length }) + '\n');
      }
    }
  }));
  provenance = { ...provenance, assets: [...previous.values()].sort((a,b)=>a.id.localeCompare(b.id)), failures };
  writeFileSync(provenanceFile, JSON.stringify(provenance, null, 2) + '\n');
}
const byId = new Map(provenance.assets.map(item => [item.id, item]));
const records = []; const identities = new Map();
for (const brand of registry.brands) {
  const asset = byId.get(brand.id); if (!asset) { if (check) throw new Error('Missing company asset: ' + brand.id); continue; }
  const bytes = readFileSync(new URL(asset.file, directory));
  if (bytes.length !== asset.bytes || hash(bytes) !== asset.sha256) throw new Error('Asset drift: ' + asset.file);
  media(bytes);
  const aliases = [], declarantAliases = [];
  for (const [values, target] of [[brand.aliases, aliases], [brand.declarantAliases, declarantAliases]]) for (const label of values ?? []) {
    const identity = key(label); if (!identity) continue;
    const previous = identities.get(identity); const role = target === aliases ? 'company' : 'declarant';
    if (previous) { if (previous.id !== brand.id || previous.role !== role) throw new Error('Conflicting company alias: ' + label); continue; }
    if (identity.length > 256 || /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/.test(identity)) throw new Error('Invalid company alias');
    identities.set(identity, { id: brand.id, role }); target.push(label);
  }
  records.push({ id: brand.id, name: brand.name, file: asset.file, aliases, declarantAliases });
}
const module = `// Generated by scripts/production/company-logos.mjs. Local artwork only.\n// REQ-010 / ADR-022: exact catalogue identities; no domain/prefix/substr inference.\nexport const COMPANY_BRANDS = Object.freeze(${JSON.stringify(records)});\nconst identities = new Map();\nfor (const brand of COMPANY_BRANDS) {\n  const assetUrl = new URL('./icons/brands/' + brand.file, import.meta.url).href;\n  const company = Object.freeze({ id: brand.id, name: brand.name, src: assetUrl, brand: brand.id, role: 'company' });\n  const declarant = Object.freeze({ ...company, role: 'declarant' });\n  for (const alias of brand.aliases) identities.set(alias.trim().toLowerCase(), company);\n  for (const alias of brand.declarantAliases) identities.set(alias.trim().toLowerCase(), declarant);\n}\nexport function companyBrand(labelOrId) {\n  if (typeof labelOrId !== 'string' || labelOrId.length > 256) return null;\n  return identities.get(labelOrId.trim().toLowerCase()) ?? null;\n}\n`;
if (check) {
  if (!existsSync(runtimeFile) || readFileSync(runtimeFile, 'utf8') !== module) throw new Error('Company branding module is out of date');
  if (provenance.failures.length) throw new Error('Unresolved company assets: ' + provenance.failures.length);
} else writeFileSync(runtimeFile, module);
console.log(JSON.stringify({ brands: records.length, aliases: identities.size, assets: provenance.assets.length, failures: provenance.failures.length, unresolved: registry.unresolved?.length ?? 0, runtime: fileURLToPath(runtimeFile) }));
