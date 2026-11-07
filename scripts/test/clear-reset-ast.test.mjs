// ADR-073: test actual shipped/canonical AST boundaries, source freshness and fail-closed edits.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ast, { parse, forEachChild, namedDeclaration } from '../production/clear-reset-ast.mjs';

const source = path => readFileSync(new URL('../../' + path, import.meta.url), 'utf8');
function find(tree, predicate) {
  const matches = [];
  function visit(node) { if (predicate(node)) matches.push(node); forEachChild(node, visit); }
  visit(tree);
  return matches;
}

test('TypeScript 7 parses the actual canonical class and preserves exact member boundaries after cleanup', () => {
  const filename = 'baseline-ts/packages/background/src/runtime.ts';
  const text = source(filename), tree = parse(text, filename);
  const classes = find(tree, node => ast.isClassDeclaration(node) && node.name?.text === 'BackgroundRuntime');
  assert.equal(classes.length, 1);
  for (const name of ['start', 'apply', 'handleBatch', 'clear', 'clearSession']) {
    const member = classes[0].members.find(node => node.name?.text === name);
    assert.ok(member, 'actual canonical member ' + name);
    assert.equal(member.getText(tree), text.slice(member.getStart(tree), member.end));
    assert.equal(member.parent, classes[0]);
  }
});

test('TypeScript 7 finds class expressions and actual functions in the delivered background bundle', () => {
  const filename = 'apps/production-extension/background.js';
  const text = source(filename), tree = parse(text, filename);
  const classes = find(tree, node => ast.isClassExpression(node) && ast.isVariableDeclaration(node.parent) && node.parent.name.getText(tree) === 'BackgroundRuntime');
  assert.equal(classes.length, 1);
  const clear = classes[0].members.find(node => node.name?.text === 'clear');
  assert.ok(clear.getText(tree).includes('this.apiResults.prepareClear'));
  assert.ok(clear.getText(tree).includes('this.pro.onLightClear'));
  const functions = find(tree, node => ast.isFunctionDeclaration(node) && node.name?.text === 'readStoredDocument');
  assert.equal(functions.length, 1);
  assert.equal(functions[0].getText(tree), text.slice(functions[0].getStart(tree), functions[0].end));
});

test('top-level variable lookup finds the actual CLEAR_FENCES_KEY and leaves adjacent source exact', () => {
  const filename = 'baseline-ts/packages/background/src/repository.ts';
  const text = source(filename);
  const found = namedDeclaration(text, 'CLEAR_FENCES_KEY', filename);
  assert.ok(ast.isVariableStatement(found.node));
  assert.equal(found.declaration.name.text, 'CLEAR_FENCES_KEY');
  assert.match(found.text, /clear-epochs:v1/);
  const replacement = "export const CLEAR_FENCES_KEY = 'review-only';";
  const changed = text.slice(0, found.node.getStart(found.tree)) + replacement + text.slice(found.node.end);
  assert.equal(changed.slice(0, found.node.getStart(found.tree)), text.slice(0, found.node.getStart(found.tree)));
  assert.equal(changed.slice(found.node.getStart(found.tree) + replacement.length), text.slice(found.node.end));
});

test('same filename with changed source never returns stale syntax; an exact source may reuse its buffer', () => {
  const before = parse('class Before {}', 'fresh.ts');
  const after = parse('class After {}', 'fresh.ts');
  assert.equal(before.statements[0].name.text, 'Before');
  assert.equal(after.statements[0].name.text, 'After');
  assert.equal(parse('class After {}', 'fresh.ts'), after);
});

test('lookup rejects grouped/duplicate declarations and malformed syntax before an edit', () => {
  assert.throws(() => namedDeclaration('const keep = 1, target = 2;', 'target'), /grouped variable/);
  assert.throws(() => namedDeclaration('const target = 1; const target = 2;', 'target'), /unique declaration/);
  assert.throws(() => parse('class {', 'broken.ts'), /syntax error/);
});
