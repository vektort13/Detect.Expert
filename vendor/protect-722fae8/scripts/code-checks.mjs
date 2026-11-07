// REQ-003/010, F075/F154/F155. Static defense in depth, not a proof of no egress.
// Transform removes types; the compiler scanner decodes escaped identifiers/properties and skips comments.
// Arbitrary property-name computation, reflection and DOM URL dataflow still require review/runtime gates.
// ADR-020 (S03), opt-in module «Защита»: network-name literals (only the MAIN hook table names fetch/XHR/sendBeacon),
// scanFieldReads (no page input/keyboard/clipboard readers outside the one audited field reader) and API ownership
// (indexedDB, declarativeNetRequest, webRequest extra-info strings). These are lint gates; the runtime proof is the
// tripwire spec (tests/extension/protect/password-never-read.spec.ts) and the privacy scan.
import { transformSync } from 'esbuild';
import { createScanner, SyntaxKind } from 'typescript/unstable/ast';

export const CODE_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts', '.jsx', '.js', '.mjs', '.cjs']);
export function isTestPath(rel) {
  return /^(?:packages\/[^/]+\/test\/|apps\/extension\/test\/|tests\/|fixtures\/|scripts\/test\/)/.test(rel);
}
export function isDataPath(rel) {
  return /^(?:packages\/catalog\/data\/|docs\/|fixtures\/)/.test(rel);
}
/** ADR-020 (S03): entries of the test-profile tripwire bundles. Never built into the local (release) profile. */
export function isTestOnlyEntry(rel) {
  return rel.startsWith('apps/extension/entrypoints/test-only/');
}
/** Product source code: apps/ or packages/, outside the test and data roots and the test-only entries. */
export function isProductionSource(rel) {
  const name = normalize(rel);
  return (name.startsWith('apps/') || name.startsWith('packages/')) && !isTestPath(name) && !isDataPath(name) && !isTestOnlyEntry(name)
    && CODE_EXTENSIONS.has(name.slice(name.lastIndexOf('.')));
}

const NETWORK = new Set(['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'sendBeacon', 'RTCPeerConnection', 'webkitRTCPeerConnection', 'WebTransport', 'Image', 'importScripts']);
const HTML = new Set(['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'setHTMLUnsafe', 'createContextualFragment', 'dangerouslySetInnerHTML']);

/**
 * ADR-020 §A: the module's MAIN hook table is the only place that names these network APIs as string literals, exactly
 * once each: the source packages/sensors/src/protect/targets.ts and the bundle protect.main.js. Everywhere else a
 * literal is `network-name-literal`; identifiers and computed `[..]` access stay `network-reference` everywhere.
 */
export const HOOK_TARGET_NAMES = ['fetch', 'XMLHttpRequest', 'sendBeacon'];
export const HOOK_TARGET_SOURCE = 'packages/sensors/src/protect/targets.ts';
export const HOOK_TARGET_BUNDLE = 'protect.main.js';
/** webRequest extra-info strings that are never used in v1 (cookies and other headers stay unread: ADR-020 §4). */
const FORBIDDEN_LITERALS = new Set(['extraHeaders']);

/** ADR-020 §5/§12: page input, keyboard and clipboard readers; never referenced by product code. */
export const FIELD_READ_IDENTIFIERS = new Set([
  'FormData', 'valueAsNumber', 'valueAsDate', 'getData', 'keyCode', 'charCode', 'KeyboardEvent', 'InputEvent',
  'ClipboardEvent', 'DataTransfer', 'selectionStart', 'selectionEnd', 'setRangeText',
]);
/** Field element interfaces: only the MAIN registration hook brand-checks `type` through the captured getter. */
export const FIELD_ELEMENT_IDENTIFIERS = new Set(['HTMLInputElement', 'HTMLTextAreaElement']);
export const FIELD_ELEMENT_OWNER = 'packages/sensors/src/protect/registration-hooks.ts';
/** The single audited `.value` reader of the module (ISOLATED world). */
export const FIELD_VALUE_READER = 'packages/collector/src/protect/field-value.ts';
/** S10 (foundation follow-up): the one named helper that reads `value` of a contracts ValidationResult (never a field). */
export const VALIDATED_VALUE_HELPER = 'packages/collector/src/protect/validated.ts';
const GET_ATTRIBUTE = new Set(['getAttribute', 'getAttributeNS', 'getAttributeNode', 'getAttributeNodeNS']);

/** ADR-020 §A: API ownership. `reference` = identifier or computed `['name']`; `literal` = any string literal. */
export const API_OWNERS = [
  { name: 'indexedDB', match: 'reference', owners: ['packages/background/src/protect/idb.ts'] },
  { name: 'declarativeNetRequest', match: 'reference', owners: ['packages/background/src/protect/dnr-port.ts', 'packages/background/src/chrome-api.ts'] },
  { name: 'requestBody', match: 'literal', owners: ['packages/background/src/protect/net-hub.ts'] },
  { name: 'requestHeaders', match: 'literal', owners: ['packages/background/src/protect/net-hub.ts'] },
];

function normalize(name) {
  return String(name).replaceAll('\\', '/');
}

let cache = null;
/** Tokens of the type-stripped source; the last result is cached because lint runs several scanners per file. */
function tokenize(source, filename) {
  if (cache !== null && cache.filename === filename && cache.source === source) return cache.tokens;
  const loader = /\.(?:tsx|jsx)$/.test(filename) ? 'tsx' : /\.(?:ts|mts|cts)$/.test(filename) ? 'ts' : 'js';
  const code = transformSync(source, { loader, target: 'esnext', treeShaking: false, legalComments: 'none' }).code;
  const scanner = createScanner(true, undefined, code);
  const tokens = [];
  for (let kind = scanner.scan(); kind !== SyntaxKind.EndOfFile; kind = scanner.scan()) {
    const literal = kind === SyntaxKind.StringLiteral || kind === SyntaxKind.NoSubstitutionTemplateLiteral;
    tokens.push({ kind, literal, value: kind === SyntaxKind.Identifier || literal ? scanner.getTokenValue() : scanner.getTokenText() });
  }
  cache = { filename, source, tokens };
  return tokens;
}

/** A literal used as a computed member name: `x['name']`. */
function bracketed(tokens, i) {
  return tokens[i]?.literal === true && tokens[i - 1]?.kind === SyntaxKind.OpenBracketToken && tokens[i + 1]?.kind === SyntaxKind.CloseBracketToken;
}

export function scanCode(source, filename, { html = true, hookTargets = 1 } = {}) {
  const name = normalize(filename);
  const tokens = tokenize(source, filename);
  const hits = new Set();
  const hookCounts = new Map(HOOK_TARGET_NAMES.map((n) => [n, 0]));
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
    if (tokens[i].literal) {
      if (bracketed(tokens, i) && NETWORK.has(value)) hits.add('network-reference: ' + value);
      else if (hookCounts.has(value)) hookCounts.set(value, hookCounts.get(value) + 1);
      if (FORBIDDEN_LITERALS.has(value)) hits.add('forbidden-literal: ' + value);
    }
  }
  if (name === HOOK_TARGET_SOURCE || name === HOOK_TARGET_BUNDLE) {
    // The source table always names each target once; the bundle mirrors it (0 while the table does not exist yet).
    const expected = name === HOOK_TARGET_SOURCE ? 1 : hookTargets;
    if ([...hookCounts.values()].some((count) => count !== expected)) {
      hits.add('hook-target-count-mismatch: ' + HOOK_TARGET_NAMES.map((n) => n + '=' + String(hookCounts.get(n))).join(', ') + ' (expected ' + String(expected) + ' each)');
    }
  } else {
    for (const [target, count] of hookCounts) if (count > 0) hits.add('network-name-literal: ' + target);
  }
  return [...hits];
}

/** `'value'` as the attribute name argument of getAttribute / getAttributeNS / getAttributeNode(NS). */
function isGetAttributeValueArg(tokens, i) {
  if (!tokens[i].literal || tokens[i].value.toLowerCase() !== 'value') return false;
  let j = i - 1;
  // getAttributeNS(ns, 'value'): skip at most one namespace argument and its comma.
  for (let skipped = 0; skipped < 2 && j >= 0 && tokens[j].kind !== SyntaxKind.OpenParenToken; skipped++) {
    const t = tokens[j];
    if (!(t.kind === SyntaxKind.CommaToken || t.literal || t.kind === SyntaxKind.NullKeyword || t.kind === SyntaxKind.Identifier)) return false;
    j--;
  }
  if (tokens[j]?.kind !== SyntaxKind.OpenParenToken) return false;
  j--;
  if (tokens[j]?.kind === SyntaxKind.QuestionDotToken) j--;
  return tokens[j]?.kind === SyntaxKind.Identifier && GET_ATTRIBUTE.has(tokens[j].value);
}

/** Files where `.value` may not be read: the module's ISOLATED code, except the audited reader. */
function valueReadScope(name) {
  return (name === 'apps/extension/entrypoints/protect.ts' || name.startsWith('packages/collector/src/protect/')) && name !== FIELD_VALUE_READER && name !== VALIDATED_VALUE_HELPER;
}

const BINDING_FOLLOWERS = new Set(['=', 'of', 'in']);

/**
 * S10 (foundation follow-up): identifier `value` used as a key of an object binding pattern — `const { value } = x`,
 * `({ value: v } = x)`, `for (const { value } of xs)`, `function f({ value })`, `({ value }) => …`, `catch ({ value })`.
 * Token heuristic: the key sits at depth 1 of a `{…}` whose closing brace is followed by `=`, `of`, `in`, or `)` and
 * then `=>` or `{`. Object literals (`{ value: true }` as an argument, `return { value }`) are not patterns.
 */
function isValueBindingKey(tokens, i) {
  const prev = tokens[i - 1]?.kind;
  if (prev !== SyntaxKind.OpenBraceToken && prev !== SyntaxKind.CommaToken) return false;
  const next = tokens[i + 1]?.kind;
  if (next !== SyntaxKind.ColonToken && next !== SyntaxKind.CommaToken && next !== SyntaxKind.CloseBraceToken && next !== SyntaxKind.EqualsToken) return false;
  let depth = 0;
  let open = -1;
  for (let j = i - 1; j >= 0; j--) {
    const k = tokens[j].kind;
    if (k === SyntaxKind.CloseBraceToken || k === SyntaxKind.CloseBracketToken || k === SyntaxKind.CloseParenToken) depth++;
    else if (k === SyntaxKind.OpenBraceToken || k === SyntaxKind.OpenBracketToken || k === SyntaxKind.OpenParenToken) {
      if (depth === 0) {
        open = j;
        break;
      }
      depth--;
    }
  }
  if (open < 0 || tokens[open].kind !== SyntaxKind.OpenBraceToken) return false;
  depth = 0;
  for (let j = open; j < tokens.length; j++) {
    const k = tokens[j].kind;
    if (k === SyntaxKind.OpenBraceToken || k === SyntaxKind.OpenBracketToken || k === SyntaxKind.OpenParenToken) depth++;
    else if (k === SyntaxKind.CloseBraceToken || k === SyntaxKind.CloseBracketToken || k === SyntaxKind.CloseParenToken) {
      depth--;
      if (depth === 0) {
        const after = tokens[j + 1];
        if (after === undefined) return false;
        if (BINDING_FOLLOWERS.has(after.value)) return true;
        if (after.kind === SyntaxKind.CloseParenToken) {
          const then = tokens[j + 2];
          return then?.kind === SyntaxKind.EqualsGreaterThanToken || then?.kind === SyntaxKind.OpenBraceToken;
        }
        return false;
      }
    }
  }
  return false;
}

/**
 * ADR-020 §12 (S03): page-input readers in production sources. Returns hits (empty = clean). Test, data and test-only
 * entry paths are not production code and return [].
 */
export function scanFieldReads(source, rel) {
  const name = normalize(rel);
  if (!isProductionSource(name)) return [];
  const tokens = tokenize(source, name);
  const hits = new Set();
  const valueScope = valueReadScope(name);
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const reference = t.kind === SyntaxKind.Identifier || bracketed(tokens, i);
    if (reference && FIELD_READ_IDENTIFIERS.has(t.value)) hits.add('field-read: ' + t.value);
    if (reference && FIELD_ELEMENT_IDENTIFIERS.has(t.value) && name !== FIELD_ELEMENT_OWNER) hits.add('field-element: ' + t.value + ' outside ' + FIELD_ELEMENT_OWNER);
    if (isGetAttributeValueArg(tokens, i)) hits.add("field-read: getAttribute('value')");
    if (valueScope && t.value === 'value') {
      const prevKind = tokens[i - 1]?.kind;
      const member = t.kind === SyntaxKind.Identifier && (prevKind === SyntaxKind.DotToken || prevKind === SyntaxKind.QuestionDotToken);
      if (member || bracketed(tokens, i)) hits.add('field-value-read: .value outside ' + FIELD_VALUE_READER);
      else if (t.kind === SyntaxKind.Identifier && isValueBindingKey(tokens, i)) hits.add('field-value-read: destructured value outside ' + FIELD_VALUE_READER + ' (validator results: ' + VALIDATED_VALUE_HELPER + ')');
    }
    // A 'value' name literal anywhere else in the scope can become a computed read (Reflect.get(el, 'value'),
    // el[name], getOwnPropertyDescriptor(proto, 'value')): not allowed outside the audited reader and the helper.
    if (valueScope && t.literal && !bracketed(tokens, i) && t.value.toLowerCase() === 'value') {
      hits.add("field-value-read: 'value' name literal outside " + FIELD_VALUE_READER);
    }
  }
  return [...hits];
}

/** ADR-020 §A (S03): API ownership in production sources. Returns hits (empty = clean). */
export function scanApiOwnership(source, rel) {
  const name = normalize(rel);
  if (!isProductionSource(name)) return [];
  const tokens = tokenize(source, name);
  const hits = new Set();
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    for (const rule of API_OWNERS) {
      if (t.value !== rule.name || rule.owners.includes(name)) continue;
      const matched = rule.match === 'literal' ? t.literal : t.kind === SyntaxKind.Identifier || bracketed(tokens, i);
      if (matched) hits.add('api-owner: ' + rule.name + ' only in ' + rule.owners.join(', '));
    }
  }
  return [...hits];
}

/**
 * esbuild (without whitespace minification) marks every bundled module with a `// <path>` line. Returns, for each
 * line of the bundle, the source module it belongs to ('' before the first marker).
 */
export function bundleModules(text) {
  const lines = text.split(/\r?\n/);
  const owners = new Array(lines.length);
  let current = '';
  for (let i = 0; i < lines.length; i++) {
    const m = /^\s*\/\/ ((?:packages|apps|node_modules|tests|fixtures|scripts)\/\S+)$/.exec(lines[i]);
    if (m !== null) current = m[1];
    owners[i] = current;
  }
  return { lines, owners };
}

/** Bundle lines matching `re` whose module is not one of `allowedModules`: [{ line, module, text }]. */
export function bundleOccurrencesOutside(text, re, allowedModules) {
  const { lines, owners } = bundleModules(text);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (re.test(lines[i]) && !allowedModules.includes(owners[i])) out.push({ line: i + 1, module: owners[i], text: lines[i].trim().slice(0, 120) });
  }
  return out;
}

export function auditInputs(inputs, world, { testOnly = false } = {}) {
  const hits = [];
  for (const raw of Object.keys(inputs)) {
    const name = raw.replaceAll('\\', '/');
    if (!testOnly && (isTestPath(name) || isDataPath(name) || name.startsWith('scripts/'))) hits.push('production imports exempt input: ' + name);
    if (/(?:^|\/)node_modules\//.test(name) && world !== 'ui') hits.push('unapproved dependency in ' + world + ': ' + name);
  }
  return hits;
}
