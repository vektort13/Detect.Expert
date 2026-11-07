import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { readPatternReview, reviewedPatternLine } from '../lint.mjs';
import { scanCode } from '../code-checks.mjs';

const file = 'apps/production-extension/api-custom-document-runtime.js';
const source = readFileSync(new URL('../../' + file, import.meta.url), 'utf8');
const inventory = JSON.parse(readFileSync(new URL('../production/lint-inventory.json', import.meta.url), 'utf8'));
const reviews = inventory.patternReferences;
const line = "      each(['innerHTML', 'outerHTML'], key => wrapAccess(element, key, visitSpan, true, around));";
const hash = input => createHash('sha256').update(input).digest('hex');

test('ADR-049: only the reviewed, SHA-pinned native observer literal line is exempt', () => {
  const review = readPatternReview(source, file, reviews);
  assert.equal(review.error, null); assert.deepEqual(review.lines, [line]);
  assert.equal(reviewedPatternLine(review, 'html-injection', line), true);
  assert.deepEqual(scanCode(source, file), [], 'No AST exception is needed or permitted');
});

test('any source modification invalidates the reviewed observer exception', () => {
  for (const changed of [source + '\n// drift\n', source.replace('scan(win)', 'scan(other)'), source.replace(line, '      element.innerHTML = userMarkup;')]) {
    const review = readPatternReview(changed, file, reviews);
    assert.match(review.error, /source changed/);
    assert.equal(reviewedPatternLine(review, 'html-injection', line), false);
  }
});

test('exception cannot migrate to another file or suppress another rule', () => {
  const other = 'apps/production-extension/other.js';
  const forged = { [other]: { ...reviews[file], sha256: hash(source) } };
  assert.match(readPatternReview(source, other, forged).error, /invalid reviewed/);
  assert.equal(reviewedPatternLine(readPatternReview(source, other, reviews), 'html-injection', line), false);
  const review = readPatternReview(source, file, reviews);
  for (const rule of ['network-call', 'eval', 'function-constructor', 'remote-url']) assert.equal(reviewedPatternLine(review, rule, line), false);
});

test('even a repinned source cannot authorize HTML assignment/calls or a different literal', () => {
  for (const injected of ['      element.innerHTML = userMarkup;', '      document.write(userMarkup);', '      element.insertAdjacentHTML("beforeend", userMarkup);']) {
    const changed = source.replace(line, injected);
    const forged = { [file]: { ...reviews[file], sha256: hash(changed), lines: [injected] } };
    const review = readPatternReview(changed, file, forged);
    assert.match(review.error, /invalid reviewed/);
    assert.equal(reviewedPatternLine(review, 'html-injection', injected), false);
    assert.ok(scanCode(injected, file).length > 0);
  }
});

test('missing, duplicate, malformed or expanded allowlists fail closed', () => {
  const duplicates = source.replace(line, line + '\n' + line);
  assert.match(readPatternReview(duplicates, file, { [file]: { ...reviews[file], sha256: hash(duplicates) } }).error, /missing or ambiguous/);
  for (const update of [{ sha256: 'bad' }, { rule: 'network-call' }, { lines: [] }, { lines: [line, 'other'] }]) {
    const review = readPatternReview(source, file, { [file]: { ...reviews[file], ...update } });
    assert.match(review.error, /invalid reviewed/);
  }
});
