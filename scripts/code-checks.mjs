// REQ-003/010, F075/F154/F155. Static defense in depth, not a proof of no egress.
// Transform removes types; the compiler scanner decodes escaped identifiers/properties and skips comments.
// Arbitrary property-name computation, reflection and DOM URL dataflow still require review/runtime gates.
import { transformSync } from 'esbuild';
import { createScanner, SyntaxKind } from 'typescript/unstable/ast';
import { createHash } from 'node:crypto';

export const CODE_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts', '.jsx', '.js', '.mjs', '.cjs']);
export function isTestPath(rel) {
  return /^(?:packages\/[^/]+\/test\/|apps\/extension\/test\/|tests\/|fixtures\/|scripts\/test\/|scripts\/production\/test\/)/.test(rel) || /^scripts\/test-(?:inspection|firefox|company-native|company-firefox-native|company-layout)\.mjs$/.test(rel);
}
export function isDataPath(rel) {
  return /^(?:packages\/catalog\/data\/|docs\/|fixtures\/)/.test(rel) ||
    rel === 'apps/production-extension/icons/brands/PROVENANCE.json' ||
    rel === 'apps/production-extension/icons/brands/COMPANY-PROVENANCE.json' ||
    rel === 'packages/catalog/research/company-logos-2026-10/registry.json' ||
    rel === 'packages/catalog/research/antifraud-2026-10/forter-runtime-sources.json' ||
    /^packages\/catalog\/research\/antifraud-2026-10\/(?:vendors-[a-d]\.json|shodan\/aggregate-(?:plan|counts)\.json)$/.test(rel) ||
    /^packages\/catalog\/research\/cookies-2026-10\/(?:open-cookie-database|upstream-manifest|google-adcookies-source|expansion-baseline|expansion-sources|expansion-comparison)\.json$/.test(rel);
}

// ADR-035/076: separately reviewed, hash-pinned favicon and explicit read-only zone API.
// Any byte change or additional capability needs a fresh source review; other production files stay strict.
export function reviewedCodeReferences(source, filename, hits, reviews = {}) {
  const review = reviews[filename];
  if (!review) return hits;
  const allowed = filename === 'apps/production-extension/site-favicon.js' ? ['network-reference: Image', 'dom-network-assignment: src'] :
    filename === 'apps/production-extension/precursor-modes-service.js' || filename === 'apps/production-extension/proxy-geo-client.js' ? ['network-reference: fetch'] : [];
  if (!allowed.length || !Array.isArray(review.references) ||
      review.references.some(reference => !allowed.includes(reference))) {
    return ['invalid reviewed code-reference exception', ...hits];
  }
  if (createHash('sha256').update(source).digest('hex') !== review.sha256) return [filename.endsWith('site-favicon.js') ? 'reviewed favicon source changed; independent review required' : filename.endsWith('proxy-geo-client.js') ? 'reviewed geolocation client source changed; independent review required' : 'reviewed Precursor API source changed; independent review required', ...hits];
  return hits.filter(hit => !review.references.includes(hit));
}

const NETWORK = new Set(['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'sendBeacon', 'RTCPeerConnection', 'webkitRTCPeerConnection', 'WebTransport', 'Image', 'importScripts']);
const HTML = new Set(['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'setHTMLUnsafe', 'createContextualFragment', 'dangerouslySetInnerHTML']);

export function scanCode(source, filename, { html = true } = {}) {
  const loader = /\.(?:tsx|jsx)$/.test(filename) ? 'tsx' : /\.(?:ts|mts|cts)$/.test(filename) ? 'ts' : 'js';
  const code = transformSync(source, { loader, target: 'esnext', treeShaking: false, legalComments: 'none' }).code;
  const scanner = createScanner(true, undefined, code);
  const tokens = [];
  let previousEnd = -1;
  for (let kind = scanner.scan(); kind !== SyntaxKind.EndOfFile; kind = scanner.scan()) {
    // Treat regex bodies as literals; scanning their backslashes as identifiers can fail to advance.
    const previous = tokens[tokens.length - 1]?.value;
    if ((kind === SyntaxKind.SlashToken || kind === SyntaxKind.SlashEqualsToken) &&
      (tokens.length === 0 || ['(', '[', '{', '=', ':', ',', '!', '?', '||', '&&', 'return', '=>'].includes(previous))) kind = scanner.reScanSlashToken();
    const end = scanner.getTokenEnd();
    if (end <= previousEnd) throw new Error('non-advancing scanner at ' + String(end));
    previousEnd = end;
    tokens.push({ kind, value: kind === SyntaxKind.Identifier || kind === SyntaxKind.StringLiteral ? scanner.getTokenValue() : scanner.getTokenText() });
  }
  const hits = new Set();
  for (let i = 0; i < tokens.length; i++) {
    const { kind, value } = tokens[i];
    const prev = tokens[i - 1]?.value;
    const next = tokens[i + 1]?.value;
    const reference = kind === SyntaxKind.Identifier || (kind === SyntaxKind.StringLiteral && prev === '[' && next === ']');
    if (reference) {
      if (NETWORK.has(value)) hits.add('network-reference: ' + value);
      if (value === 'eval') hits.add('eval-reference');
      if (value === 'Function' && !(next === '.' && tokens[i + 2]?.value === 'prototype')) hits.add('function-constructor-reference');
      // Reject sync references even after destructuring/aliasing storage.
      if (value === 'sync' && ['.', '[', '{'].includes(prev)) hits.add('storage-sync-reference');
      if (html && HTML.has(value)) hits.add('html-injection: ' + value);
      if (['setHTMLUnsafe', 'createContextualFragment'].includes(value)) hits.add('html-injection: ' + value);
      if (['src', 'srcset', 'poster'].includes(value) && (next === '=' || (next === ']' && tokens[i + 2]?.value === '='))) hits.add('dom-network-assignment: ' + value);
      if (html && ['write', 'writeln'].includes(value) && tokens[i - 2]?.value === 'document') hits.add('html-injection: document.write');
    }
    if (kind === SyntaxKind.StringLiteral && ['src', 'srcset', 'href', 'poster'].includes(value) && prev === '(' && tokens[i - 2]?.value === 'setAttribute') hits.add('dom-network-attribute: ' + value);
    if (kind === SyntaxKind.StringLiteral && ['link', 'iframe', 'script', 'img'].includes(value) && prev === '(' && tokens[i - 2]?.value === 'createElement') hits.add('dom-network-element: ' + value);
    if (value === 'import' && next === '(') hits.add('dynamic-import');
  }
  return [...hits];
}

export function auditInputs(inputs, world) {
  const hits = [];
  for (const raw of Object.keys(inputs)) {
    const name = raw.replaceAll('\\', '/');
    if (isTestPath(name) || isDataPath(name) || name.startsWith('scripts/')) hits.push('production imports exempt input: ' + name);
    if (/(?:^|\/)node_modules\//.test(name) && world !== 'ui') hits.push('unapproved dependency in ' + world + ': ' + name);
  }
  return hits;
}
