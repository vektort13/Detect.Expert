// ADR-073: narrow AST edits keep production-only modules and neighbouring patches.
import ts, { namedDeclaration as findDeclaration } from './clear-reset-ast.mjs';
import { transformSync } from 'esbuild';

export function parse(source, name = 'source.ts') { return ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true, name.endsWith('.js') ? ts.ScriptKind.JS : ts.ScriptKind.TS); }
function matching(tree, predicate) {
  const found = [];
  function visit(node) { if (predicate(node)) found.push(node); ts.forEachChild(node, visit); }
  visit(tree); return found;
}
export function namedClass(source, name, filename) {
  const tree = parse(source, filename);
  const matches = matching(tree, node => (ts.isClassDeclaration(node) && node.name?.text === name) || (ts.isClassExpression(node) && ts.isVariableDeclaration(node.parent) && node.parent.name.getText(tree) === name));
  if (matches.length !== 1) throw Error((filename ?? 'source') + ': unique class required: ' + name);
  return { tree, node: matches[0] };
}
const memberName = node => ts.isConstructorDeclaration(node) ? 'constructor' : node.name && (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) ? node.name.text : null;
export function classMember(source, className, name, filename) {
  const { tree, node } = namedClass(source, className, filename), members = node.members.filter(member => memberName(member) === name);
  if (members.length !== 1) throw Error((filename ?? 'source') + ': unique member required: ' + className + '.' + name);
  return { tree, node: members[0], text: members[0].getText(tree) };
}
export function replaceClassMember(source, className, name, replacement, filename, { insert = false } = {}) {
  const { tree, node } = namedClass(source, className, filename), members = node.members.filter(member => memberName(member) === name);
  if (members.length > 1 || members.length === 0 && !insert) throw Error(filename + ': member boundary requires review: ' + className + '.' + name);
  const current = members[0], start = current ? current.getStart(tree) : node.members.pos;
  const end = current ? current.end : start;
  if (!current) return source.slice(0, start) + '\n' + replacement + '\n' + source.slice(end);
  return source.slice(0, start) + replacement + source.slice(end);
}
export function namedDeclaration(source, name, filename) {
  return findDeclaration(source, name, filename);
}
export function namedFunction(source, name, filename) {
  const tree = parse(source, filename), nodes = matching(tree, node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  if (nodes.length !== 1) throw Error(filename + ': unique function required: ' + name);
  return { tree, node: nodes[0], text: nodes[0].getText(tree) };
}
export function replaceFunction(source, name, replacement, filename) {
  const { tree, node } = namedFunction(source, name, filename);
  return source.slice(0, node.getStart(tree)) + replacement + source.slice(node.end);
}
export function replaceDeclaration(source, name, text, filename, { insert = false } = {}) {
  const tree = parse(source, filename), nodes = tree.statements.filter(node => node.name && ts.isIdentifier(node.name) && node.name.text === name);
  if (nodes.length > 1 || nodes.length === 0 && !insert) throw Error(filename + ': declaration boundary requires review: ' + name);
  if (nodes.length === 0) return source + '\n' + text + '\n';
  return source.slice(0, nodes[0].getStart(tree)) + text + source.slice(nodes[0].end);
}
export function addCaseFrom(source, functionName, caseName, donor, filename) {
  const target = namedDeclaration(source, functionName, filename), original = namedDeclaration(donor, functionName, 'donor.ts');
  const donorCases = matching(original.node, node => ts.isCaseClause(node) && ts.isStringLiteral(node.expression) && node.expression.text === caseName);
  if (donorCases.length !== 1) throw Error('donor case requires review: ' + caseName);
  const targets = matching(target.node, node => ts.isCaseClause(node) && ts.isStringLiteral(node.expression) && node.expression.text === caseName);
  const text = donorCases[0].getText(original.tree);
  if (targets.length > 1) throw Error(filename + ': duplicate case ' + caseName);
  if (targets.length === 1) return source.slice(0, targets[0].getStart(target.tree)) + text + source.slice(targets[0].end);
  const switches = matching(target.node, ts.isSwitchStatement);
  if (switches.length !== 1) throw Error(filename + ': unique switch required for ' + functionName);
  const position = switches[0].caseBlock.clauses.pos;
  return source.slice(0, position) + '\n    ' + text + '\n' + source.slice(position);
}
export function compileMember(source, className, name, filename) {
  const compiled = transformSync(source, { loader: 'ts', target: 'es2022', charset: 'utf8', legalComments: 'none', minify: false }).code;
  return classMember(compiled, className, name, filename?.replace(/\.ts$/, '.js') ?? 'compiled.js').text;
}
export function plainRuntime(source, filename) {
  const tree = parse(source, filename);
  const cuts = tree.statements.filter(node => ts.isImportDeclaration(node) || ts.isExportDeclaration(node)).map(node => [node.getFullStart(), node.end]);
  for (const [from, to] of cuts.reverse()) source = source.slice(0, from) + source.slice(to);
  source = source.replace(/^export /gm, '');
  return transformSync(source, { loader: 'ts', target: 'es2022', charset: 'utf8', legalComments: 'none', minify: false }).code.trim();
}
