// REQ-007 / REQ-014: shipped copy never promises invisibility, undetectability, anonymity, bypassing protection, stealth or
// 100 % coverage, and never calls a recognised service legitimate. Scans every locale table (_locales and ui-locales) and every
// apps/production-extension/*-labels.js module in every production language. The English and Russian stems are searched in
// all languages, which also catches untranslated copies. Each remaining hit is a reasoned allowlist entry (negations such as
// "no anonymity is guaranteed", the "Bypass this site" mode, proxy routing, technical "traversal"); an entry that no longer
// matches is stale and fails, so the list can only shrink with the copy.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { PRODUCTION_LANGUAGES } from '../production-languages.mjs';

const root = join(import.meta.dirname, '../..'), source = join(root, 'apps/production-extension');
const allowlist = JSON.parse(readFileSync(join(import.meta.dirname, 'honest-copy-allowlist.json'), 'utf8'));

// [term, pattern]. `\b` is ASCII-only, so the Cyrillic stems use a Unicode letter look-behind ("необходим" is not "обход").
export const HONEST_COPY_TERMS = Object.freeze([
  ['invisible', /\binvisib/iu], ['undetectable', /\bundetectab/iu], ['anonymous', /\banonym/iu], ['bypass', /\bbypass/iu], ['stealth', /\bstealth/iu],
  ['100 %', /(?<![\d.,])100\s?%/u], ['guarantee', /\bguarant/iu], ['legitimate', /\blegitimat/iu],
  ['невидим', /(?<!\p{L})невидим/iu], ['необнаружим', /(?<!\p{L})необнаружим/iu], ['анонимн', /(?<!\p{L})анонимн/iu], ['обход', /(?<!\p{L})обход/iu],
  ['гарантир', /(?<!\p{L})гарантир/iu], ['легитимн', /(?<!\p{L})легитимн/iu],
].map(([term, pattern]) => Object.freeze([term, pattern])));

export function claimsIn(strings) {
  const hits = [];
  for (const { source: file, key, text } of strings) for (const [term, pattern] of HONEST_COPY_TERMS) if (pattern.test(text)) hits.push({ source: file, key, term, text });
  return hits;
}
export function verdict(hits, entries) {
  const covered = entry => hit => hit.source === entry.source && hit.key === entry.key && hit.term === entry.term;
  return { unexpected: hits.filter(hit => !entries.some(entry => covered(entry)(hit))), stale: entries.filter(entry => !hits.some(covered(entry))) };
}

async function shippedStrings() {
  const strings = [];
  for (const folder of ['_locales', 'ui-locales']) for (const locale of readdirSync(join(source, folder))) {
    const table = JSON.parse(readFileSync(join(source, folder, locale, 'messages.json'), 'utf8'));
    for (const [key, value] of Object.entries(table)) strings.push({ source: folder + '/' + locale + '/messages.json', key, text: value.message });
  }
  const leaves = (value, path, out) => { if (typeof value === 'string') out.push([path, value]); else if (value && typeof value === 'object') for (const [key, item] of Object.entries(value)) leaves(item, path ? path + '.' + key : key, out); return out; };
  const modules = readdirSync(source).filter(file => file.endsWith('-labels.js')).sort();
  for (const file of modules) {
    const module = await import(pathToFileURL(join(source, file)).href);
    const accessors = Object.entries(module).filter(([name, value]) => typeof value === 'function' && /Labels$/u.test(name) && value.length === 1);
    assert.ok(accessors.length, file + ' exports no <name>Labels(locale) accessor: teach honest-copy.test.mjs how to read it');
    for (const [name, accessor] of accessors) for (const language of PRODUCTION_LANGUAGES) {
      const locale = typeof language === 'string' ? language : language.id;
      for (const [path, text] of leaves(accessor(locale), '', [])) strings.push({ source: file, key: locale + ':' + name + '.' + path, text });
    }
  }
  return { strings, modules };
}

test('the claim patterns catch promises and spare ordinary words', () => {
  const caught = ['Invisible to anti-fraud', 'undetectable mode', 'Stay anonymous', 'bypass bot protection', 'Stealth', '100 % coverage', '100% protection', 'guaranteed privacy', 'legitimate antifraud systems',
    'Полностью невидимый', 'необнаружимый браузер', 'Анонимность', 'обход антифрода', 'Обходить защиту', 'гарантирует защиту', 'легитимные антифрод-системы'];
  for (const text of caught) assert.ok(claimsIn([{ source: 's', key: 'k', text }]).length, text);
  const spared = ['Необходимые', 'необходимо', 'Allow', 'Detected services', '1100 %', '2.100 %', 'Подтверждено', 'Обновить'];
  for (const text of spared) assert.deepEqual(claimsIn([{ source: 's', key: 'k', text }]), [], text);
});

test('shipped locale tables and label modules make no unreviewed REQ-007/014 claim', async () => {
  const { strings, modules } = await shippedStrings();
  assert.ok(strings.length > 10000, 'scanned ' + strings.length + ' strings');
  assert.ok(modules.length >= 10, 'label modules found: ' + modules.join(', '));
  const result = verdict(claimsIn(strings), allowlist.entries);
  assert.deepEqual(result.unexpected.map(hit => hit.source + ' ' + hit.key + ' [' + hit.term + ']: ' + hit.text.slice(0, 160)), [], 'unreviewed claims (reword them, or add a reasoned entry to honest-copy-allowlist.json only for a negation or a technical meaning)');
  assert.deepEqual(result.stale.map(entry => entry.source + ' ' + entry.key + ' [' + entry.term + ']'), [], 'stale allowlist entries (the copy changed; remove them)');
});

test('the allowlist is reasoned, unique and names known terms', () => {
  assert.equal(allowlist.schema, 1);
  const terms = HONEST_COPY_TERMS.map(([term]) => term), seen = new Set();
  for (const entry of allowlist.entries) {
    const id = entry.source + '|' + entry.key + '|' + entry.term;
    assert.ok(!seen.has(id), 'duplicate ' + id); seen.add(id);
    assert.ok(terms.includes(entry.term), 'unknown term ' + entry.term);
    assert.ok(typeof entry.reason === 'string' && entry.reason.length >= 30, 'reason required for ' + id);
  }
  const hits = [{ source: 'a', key: 'k', term: 'bypass', text: 'Bypass this site' }];
  assert.deepEqual(verdict(hits, [{ source: 'a', key: 'k', term: 'bypass' }]), { unexpected: [], stale: [] });
  assert.equal(verdict(hits, []).unexpected.length, 1, 'an uncovered hit fails');
  assert.equal(verdict([], [{ source: 'a', key: 'k', term: 'bypass' }]).stale.length, 1, 'an unused entry is stale');
});
