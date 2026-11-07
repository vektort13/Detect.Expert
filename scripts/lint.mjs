import { CODE_EXTENSIONS, isTestPath, isDataPath, scanCode, reviewedCodeReferences } from './code-checks.mjs';
// Forbidden-pattern scanner (REQ-003, REQ-010, CSP MV3). Scans apps/, packages/, scripts/ and exits 1 with
// file:line for every hit. Not a style linter: it enforces product boundaries that must never regress.
// Usage: node scripts/lint.mjs

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCAN_DIRS = ['apps', 'packages', 'scripts'];
const TEXT_EXT = new Set([...CODE_EXTENSIONS, '.json', '.html', '.css']);
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git']);
/** Scanner definitions and the reviewed literal inventory contain the patterns themselves. */
const SKIP_FILES = new Set(['scripts/lint.mjs', 'scripts/release-verify.mjs', 'scripts/code-checks.mjs', 'scripts/production/lint-inventory.json']);

/** Hosts that may appear in source: JSON Schema meta-schema, XML namespaces and the loopback test fixtures. */
const ALLOWED_URL_HOSTS = new Set(['json-schema.org', 'www.w3.org', '127.0.0.1', 'localhost']);

const HTML_OBSERVER_FILE = 'apps/production-extension/api-custom-document-runtime.js';
const HTML_OBSERVER_LINE = "      each(['innerHTML', 'outerHTML'], key => wrapAccess(element, key, visitSpan, true, around));";

// ADR-049: this exception permits forwarding existing native HTML operations,
// never an HTML assignment/call, and cannot migrate to another file or rule.
export function readPatternReview(source, filename, reviews = {}) {
  const review = reviews[filename];
  if (!review) return { lines: [], error: null };
  if (filename !== HTML_OBSERVER_FILE || review.rule !== 'html-injection' ||
      !Array.isArray(review.lines) || review.lines.length !== 1 || review.lines[0] !== HTML_OBSERVER_LINE ||
      typeof review.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(review.sha256)) {
    return { lines: [], error: 'invalid reviewed pattern-reference exception' };
  }
  if (createHash('sha256').update(source).digest('hex') !== review.sha256) return { lines: [], error: 'reviewed native HTML observer source changed; independent review required' };
  const lines = source.split(/\r?\n/);
  if (lines.filter(line => line === HTML_OBSERVER_LINE).length !== 1) return { lines: [], error: 'reviewed native HTML observer line missing or ambiguous' };
  return { lines: [...review.lines], error: null };
}
export function reviewedPatternLine(review, ruleId, line) {
  return !review.error && ruleId === 'html-injection' && review.lines.includes(line);
}

// ADR-090: one fixed local UI chunk, independently reviewed. No input specifier,
// remote resource, MAIN import or other dynamic import receives this exception.
export function reviewedDetectorImport(source, filename) {
  const expression = "import('./popup.js')";
  if (filename !== 'apps/production-extension/detector-ui.js' || source.split(expression).length !== 2) return source;
  return source.replace(expression, 'localUiModule()'.padEnd(expression.length, ' '));
}

const RULES = [
  {
    id: 'eval',
    re: /\beval\s*\(/,
    message: 'dynamic code evaluation is forbidden (REQ-010, MV3 CSP)',
  },
  {
    id: 'function-constructor',
    re: /\bnew\s+Function\b|\bFunction\s*\(\s*['"`]/,
    message: 'the Function constructor is forbidden (REQ-010, MV3 CSP)',
  },
  {
    id: 'tostring-masking',
    re: /Function\.prototype\.toString\s*=|defineProperty\(\s*Function\.prototype\s*,\s*['"`]toString/,
    message: 'masking wrappers through Function.prototype.toString is forbidden (REQ-003)',
  },
  {
    id: 'storage-sync',
    re: /\bstorage\.sync\b/,
    message: 'storage.sync is forbidden for reports and any site data (REQ-010)',
  },
  {
    id: 'remote-url',
    re: /\bhttps?:\/\/([a-z0-9][a-z0-9.-]*)[^\s"'<>`\\]*/gi,
    message: 'remote http(s) URL in source (REQ-010: no remote code, no telemetry, no external assets)',
    applies: (rel) => !isTestPath(rel) && !isDataPath(rel),
    check: (match) => !ALLOWED_URL_HOSTS.has(match[1].toLowerCase()),
  },
  {
    id: 'network-call',
    re: /\bfetch\s*\(|\bnew\s+XMLHttpRequest\b|\bnew\s+WebSocket\b|\bnew\s+EventSource\b|\bsendBeacon\s*\(/,
    message: 'network calls are forbidden in extension code (REQ-010: no outgoing traffic)',
    applies: (rel) => (rel.startsWith('apps/') || rel.startsWith('packages/')) && !isTestPath(rel),
  },
  {
    id: 'html-injection',
    re: /\b(innerHTML|outerHTML)\b|\binsertAdjacentHTML\s*\(|\bdocument\.write(ln)?\s*\(|dangerouslySetInnerHTML/,
    message: 'HTML string injection is forbidden (untrusted strings must never become markup)',
  },
];

function walk(dir, out) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (TEXT_EXT.has(name.slice(name.lastIndexOf('.')))) out.push(full);
  }
}

export function runLint() {
const files = [];
for (const dir of SCAN_DIRS) {
  const full = join(root, dir);
  try {
    if (statSync(full).isDirectory()) walk(full, files);
  } catch {
    // directory absent: nothing to scan
  }
}

const findings = [];
const productionAudit = JSON.parse(readFileSync(join(root, 'scripts/production/lint-inventory.json'), 'utf8'));
let scanned = 0;
for (const file of files) {
  const rel = relative(root, file).split('\\').join('/');
  if (SKIP_FILES.has(rel) || rel.startsWith('scripts/test/')) continue;
  scanned++;
  let source = readFileSync(file, 'utf8');
  // Audit the inherited Preact implementation by exact hash, then scan all application code normally.
  // Its unused dangerouslySetInnerHTML implementation is dependency code, not an application sink.
  const preactHash = productionAudit.preact[rel];
  if (preactHash) {
    const end = source.indexOf('// packages/ui/src/view-models/message.ts');
    const prefix = source.slice(0, end);
    if (end < 0 || createHash('sha256').update(prefix).digest('hex') !== preactHash) {
      findings.push(rel + ': inherited Preact prefix changed; independent dependency review required');
    } else {
      const dependencyStart = Math.max(0, prefix.search(/^[ \t]*\/\/ (?:\.\.\/)*node_modules\/\.pnpm\/preact@[^/\r\n]+\/node_modules\/preact\//m));
      source = prefix.slice(0, dependencyStart) + prefix.slice(dependencyStart).replace(/[^\r\n]/g, ' ') + source.slice(end);
    }
  }
  if (rel === 'apps/production-extension/privacy.html' && !/<script\b|\bon[a-z]+\s*=/i.test(source)) source = source.replace('Chrome storage.sync is not used.', 'Chrome storage reference is not used.').replace('storage.sync не используется.', 'storage reference не используется.');
  source = reviewedDetectorImport(source, rel);
  const patternReview = readPatternReview(source, rel, productionAudit.patternReferences);
  if (patternReview.error) findings.push(rel + ': ' + patternReview.error);
  if ((rel.startsWith('apps/') || rel.startsWith('packages/')) && !isTestPath(rel) && CODE_EXTENSIONS.has(file.slice(file.lastIndexOf('.')))) {
    try { for (const hit of reviewedCodeReferences(source, rel, scanCode(source, rel), productionAudit.codeReferences)) findings.push(rel + ': ' + hit); }
    catch (e) { findings.push(rel + ': source scan failed: ' + e.message); }
  }
  const lines = source.split(/\r?\n/);
  for (const rule of RULES) {
    if (rule.applies && !rule.applies(rel)) continue;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const re = new RegExp(rule.re.source, rule.re.flags.includes('g') ? rule.re.flags : rule.re.flags + 'g');
      let match;
      while ((match = re.exec(line)) !== null) {
        if (rule.check && !rule.check(match)) continue;
        if (rule.id === 'remote-url' && (productionAudit.urls[rel] ?? []).includes(match[0])) continue;
        if (reviewedPatternLine(patternReview, rule.id, line)) continue;
        findings.push(rel + ':' + (i + 1) + ': [' + rule.id + '] ' + rule.message);
        if (!rule.re.flags.includes('g')) break;
      }
    }
  }
}

if (findings.length > 0) {
  for (const f of findings) console.error(f);
  console.error('lint: ' + findings.length + ' forbidden pattern(s) in ' + scanned + ' files');
  process.exit(1);
}
console.log('lint: OK (' + scanned + ' files scanned, ' + RULES.length + ' rules)');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) runLint();
