// Counts and versions that docs/coverage/*.md and the newest ADR state about the API catalog must be the current ones:
// rows, Custom rows, Math functions, format and catalog version, all read from the shipped contract. A statement with an
// older value must be explicitly historical: it is then listed with a reason in coverage-docs-drift-allowlist.json.
// Dated or versioned snapshot files (a date or a release version in the file name) are history by definition and skipped.
// The values a statement can carry are the sizes/versions the contract ever had (API_CONFIG_CATALOG_V1..Vn), so an
// unrelated number ("25 rows per page") is not mistaken for a catalog statement.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import * as contract from '../../apps/production-extension/api-configuration.js';

const root = join(import.meta.dirname, '../..');
const allowlist = JSON.parse(readFileSync(join(import.meta.dirname, 'coverage-docs-drift-allowlist.json'), 'utf8'));
const catalogs = Object.entries(contract).filter(([name]) => /^API_CONFIG_CATALOG_V\d+$/u.test(name)).map(([, value]) => value);
const mathCount = catalog => catalog.find(row => row.id === 'math-transcendentals')?.presets?.[0]?.value?.value?.functions?.length;
export const CURRENT = Object.freeze({ rows: contract.API_CONFIG_CATALOG.length, custom: contract.API_CONFIG_CATALOG.filter(row => row.customSupported).length,
  math: contract.API_MATH_FUNCTIONS.length, format: contract.API_CONFIGURATION_VERSION, catalog: contract.API_CONFIGURATION_CATALOG_VERSION });
const KNOWN = { rows: new Set(catalogs.map(catalog => catalog.length)), custom: new Set(catalogs.map(catalog => catalog.filter(row => row.customSupported).length)), math: new Set(catalogs.map(mathCount).filter(Boolean)) };

// Glued spellings occur in the docs ("format7/catalog8:158 rows", "все143 IDs", "поддерживает23 функции").
const PATTERNS = {
  pair: /(?<![\p{L}\d])(?:format|формат)\p{L}*\s*(\d{1,2})\s*(?:\/|,|и|and)\s*(?:catalog(?:ue)?|каталог)\p{L}*\s*(\d{1,2})(?!\d)/giu,
  catalog: /(?<![\p{L}\d])(?:catalog(?:ue)?|каталог)\p{L}*\s*(\d{1,2})(?![\d.])(?!\s?\d)(?!\s*(?:rows|строк|API|ID|адаптер|функци|GPU|карт|records|записе))/giu,
  format: /(?<![\p{L}\d])(?:format|формат)\p{L}*\s*(\d{1,2})(?![\d.])(?!\s?\d)/giu,
  rows: /(?<![\d.])(\d{3})\s*(?:rows?|строк\p{L}*|API(?!\p{L})|IDs?(?!\p{L}))/giu,
  custom: /(?<![\d.])(\d{2})\s*(?:с\s+|with\s+)?(?:типизированн\p{L}*\s+)?Custom(?!\p{L})/giu,
  math: /(?<![\d.])(\d{2})\s*(?:Math\s+)?(?:функци\p{L}*|functions?)(?!\p{L})/giu,
};

// Every catalog statement of one Markdown text: [{ line, kind, value, current, excerpt, text }].
export function catalogStatements(text) {
  const statements = [];
  text.split(/\r?\n/u).forEach((line, index) => {
    const pairs = [...line.matchAll(PATTERNS.pair)], inside = at => pairs.some(match => at >= match.index && at < match.index + match[0].length);
    const add = (kind, value, current, at) => statements.push({ line: index + 1, at, kind, value, current, text: line, excerpt: line.slice(Math.max(0, at - 60), at + 80).replace(/\s+/gu, ' ').trim() });
    for (const match of pairs) add('pair', match[1] + '/' + match[2], Number(match[1]) === CURRENT.format && Number(match[2]) === CURRENT.catalog, match.index);
    for (const match of line.matchAll(PATTERNS.catalog)) if (!inside(match.index)) add('catalog', match[1], Number(match[1]) === CURRENT.catalog, match.index);
    for (const match of line.matchAll(PATTERNS.format)) if (!inside(match.index)) add('format', match[1], Number(match[1]) === CURRENT.format, match.index);
    for (const kind of ['rows', 'custom', 'math']) for (const match of line.matchAll(PATTERNS[kind])) if (KNOWN[kind].has(Number(match[1]))) add(kind, match[1], Number(match[1]) === CURRENT[kind], match.index);
  });
  return statements;
}

const SNAPSHOT = /(?:\d+\.\d+\.\d+|\d{4}-\d{2}-\d{2})/u;
export function scannedDocuments() {
  const coverage = readdirSync(join(root, 'docs/coverage')).filter(file => file.endsWith('.md')).sort();
  const adrs = readdirSync(join(root, 'docs/decisions')).filter(file => /^ADR-\d+.*\.md$/u.test(file)).sort((left, right) => Number(/\d+/u.exec(left)[0]) - Number(/\d+/u.exec(right)[0]));
  return { files: [...coverage.filter(file => !SNAPSHOT.test(file)).map(file => 'docs/coverage/' + file), 'docs/decisions/' + adrs.at(-1)], snapshots: coverage.filter(file => SNAPSHOT.test(file)), newestAdr: 'docs/decisions/' + adrs.at(-1) };
}

// A line that states the CURRENT value of the same family and marks the older value as history next to it ("format7/catalog8 —
// состояние ADR-106", "(ADR-106: FormatVersion7 / CatalogVersion8", "составлена для 143 строк catalog 6") is explicit history.
// Both conditions are required, and the marker must stand within 80 characters of the old value.
const FAMILY = { pair: 'version', catalog: 'version', format: 'version', rows: 'rows', custom: 'custom', math: 'math' };
const HISTORY_MARKER = /состояни|прежн|заморож|составлен|раньше|прецедент|историческ|раунд\p{L}*\s*\d|ADR-\d{3}\s*:|\(ADR-\d{3}\)|state of|previous|frozen|historical|round \d/iu;
export function markedHistory(statement, lineStatements) {
  if (statement.current || !lineStatements.some(other => other.current && FAMILY[other.kind] === FAMILY[statement.kind])) return false;
  return HISTORY_MARKER.test(statement.text.slice(Math.max(0, statement.at - 80), statement.at + 80));
}

// Entries: { file, contains, statements: ['kind=value', ...], reason }. An entry covers those non-current statements on lines
// of `file` that include `contains`; an entry (or one of its listed statements) that covers nothing is stale.
export function driftVerdict(found, entries) {
  const used = new Set(), drift = [], history = [];
  for (const statement of found) {
    if (statement.current) continue;
    const key = statement.kind + '=' + statement.value;
    const index = entries.findIndex(entry => entry.file === statement.file && statement.text.includes(entry.contains) && entry.statements.includes(key));
    if (index >= 0) used.add(index + '|' + key);
    else if (markedHistory(statement, found.filter(other => other.file === statement.file && other.line === statement.line))) history.push(statement);
    else drift.push(statement);
  }
  const stale = entries.flatMap((entry, index) => entry.statements.filter(key => !used.has(index + '|' + key)).map(key => entry.file + ' [' + entry.contains + '] ' + key));
  return { drift, stale, history };
}

// The "current" values are never typed here: they follow the contract, so a new catalog makes older statements history.
test('the current values are the newest catalog of the contract', () => {
  const versions = Object.keys(contract).map(name => /^API_CONFIG_CATALOG_V(\d+)$/u.exec(name)?.[1]).filter(Boolean).map(Number);
  assert.equal(Math.max(...versions), CURRENT.catalog, 'API_CONFIGURATION_CATALOG_VERSION names the newest API_CONFIG_CATALOG_Vn');
  assert.equal(contract['API_CONFIG_CATALOG_V' + CURRENT.catalog], contract.API_CONFIG_CATALOG, 'API_CONFIG_CATALOG is that newest catalog');
  assert.ok(KNOWN.rows.has(CURRENT.rows) && KNOWN.custom.has(CURRENT.custom) && KNOWN.math.has(CURRENT.math));
  assert.ok(CURRENT.format >= 7 && CURRENT.catalog >= 8 && CURRENT.rows >= 158, 'formats and catalogs only grow');
});

test('statement extraction reads glued, spaced and Russian spellings and ignores unrelated numbers', () => {
  const kinds = text => catalogStatements(text).map(item => item.kind + '=' + item.value + (item.current ? '' : '!'));
  const { format, catalog, rows, custom, math } = CURRENT;
  assert.deepEqual(kinds('Текущий format' + format + '/catalog' + catalog + ':' + rows + ' rows/' + custom + ' Custom'), ['pair=' + format + '/' + catalog, 'rows=' + rows, 'custom=' + custom]);
  assert.deepEqual(kinds('FormatVersion6 / CatalogVersion7 и 143 API / 40 Custom'), ['pair=6/7!', 'rows=143!', 'custom=40!']);
  assert.deepEqual(kinds('Формат ' + format + ', каталог ' + catalog + '; формат 6 / каталог 7; Всего ' + rows + ' строк, ' + custom + ' с Custom'), ['pair=' + format + '/' + catalog, 'pair=6/7!', 'rows=' + rows, 'custom=' + custom]);
  assert.deepEqual(kinds('содержит 143 строки текущего catalog 6'), ['catalog=6!', 'rows=143!']);
  assert.deepEqual(kinds('Math поддерживает' + math + ' функции; прежние20 функций; все' + rows + ' API scope rows; каталог' + rows + ' rows'), ['rows=' + rows, 'rows=' + rows, 'math=' + math, 'math=20!']);
  assert.deepEqual(kinds('по 25 строк, 1 024 строками, каталогу 2 522 records, 398 API-операций, 40 + 15 Custom, каталога 50 адаптеров, 12 строк'), []);
});

test('docs/coverage and the newest ADR state the current catalog (drift is listed for the docs owner)', t => {
  const { files, newestAdr } = scannedDocuments();
  assert.ok(files.length >= 30, 'scanned ' + files.length + ' documents');
  const found = files.flatMap(file => catalogStatements(readFileSync(join(root, file), 'utf8')).map(statement => ({ ...statement, file })));
  assert.ok(found.filter(statement => statement.current).length >= 10, 'the current catalog is stated in the docs');
  for (const entry of allowlist.statements) assert.ok(files.includes(entry.file), entry.file + ' is not scanned' + (entry.file.startsWith('docs/decisions/') ? ' (the newest ADR is now ' + newestAdr + '; remove the entries of the older one)' : '') + ': remove its allowlist entries');
  const { drift, stale, history } = driftVerdict(found, allowlist.statements);
  for (const item of history) t.diagnostic('history next to the current value: ' + item.file + ':' + item.line + ' ' + item.kind + '=' + item.value);
  assert.deepEqual({ drift: drift.map(item => item.file + ':' + item.line + ' ' + item.kind + '=' + item.value + ' (current ' + (item.kind === 'pair' ? CURRENT.format + '/' + CURRENT.catalog : CURRENT[item.kind]) + ') | ' + item.excerpt), stale }, { drift: [], stale: [] },
    'drift: outdated catalog statements (update the doc, state the current value next to the old one with a history marker, or list a pure-history line in coverage-docs-drift-allowlist.json with a reason); stale: allowlist entries that no longer match (remove them)');
});

test('history next to the current value is accepted only with a marker and the current value of the same family', () => {
  const pair = CURRENT.format + '/catalog' + CURRENT.catalog, verdict = text => driftVerdict(catalogStatements(text).map(item => ({ ...item, file: 'f' })), []);
  const kept = verdict('текущий format' + pair + '; format6/catalog7 — состояние ADR-087');
  assert.deepEqual([kept.drift.length, kept.history.map(item => item.value)], [0, ['6/7']]);
  assert.equal(verdict('текущий format' + pair + '; format6/catalog7 описывает сохранённые профили').drift.length, 1, 'no marker: drift');
  assert.equal(verdict('format6/catalog7 — состояние ADR-087').drift.length, 1, 'no current value on the line: drift');
  assert.equal(verdict('текущий format' + pair + ', ' + CURRENT.rows + ' строк; прежние 143 строки').history.length, 1, 'rows history needs the current row count');
  assert.equal(verdict('текущий format' + pair + '; прежние 143 строки').drift.length, 1, 'a current version does not vouch for an old row count');
});

test('the allowlist is reasoned and well formed', () => {
  assert.equal(allowlist.schema, 1);
  for (const entry of allowlist.statements) {
    assert.ok(typeof entry.file === 'string' && typeof entry.contains === 'string' && entry.contains.length >= 12, JSON.stringify(entry));
    assert.ok(Array.isArray(entry.statements) && entry.statements.length && entry.statements.every(key => /^(?:pair=\d+\/\d+|(?:catalog|format|rows|custom|math)=\d+)$/u.test(key)), JSON.stringify(entry));
    assert.ok(typeof entry.reason === 'string' && entry.reason.length >= 30, 'reason required: ' + entry.file);
  }
  const fake = [{ file: 'f', line: 1, kind: 'rows', value: '143', current: false, text: 'прежние 143 ID' }];
  assert.deepEqual(driftVerdict(fake, [{ file: 'f', contains: 'прежние', statements: ['rows=143'] }]), { drift: [], stale: [], history: [] });
  assert.equal(driftVerdict(fake, []).drift.length, 1, 'an unlisted historical value is drift');
  assert.deepEqual(driftVerdict([], [{ file: 'f', contains: 'прежние', statements: ['rows=143'] }]).stale, ['f [прежние] rows=143'], 'an unused entry is stale');
});
