// ADR-073: the installed TypeScript 7 exposes syntax through its native API, not the package root.
// Parsing uses an in-memory filesystem; syntax nodes retain their local buffers after API cleanup.
import { resolve } from 'node:path';
import { API } from 'typescript/unstable/sync';
import { createVirtualFileSystem } from 'typescript/unstable/fs';
import * as syntax from 'typescript/unstable/ast';

const MAX_CACHED_FILES = 16;
const parsed = new Map();

export function parse(source, name = 'source.ts') {
  if (typeof source !== 'string' || typeof name !== 'string') throw new TypeError('AST source and name must be strings');
  const cached = parsed.get(name);
  if (cached?.source === source) {
    parsed.delete(name);
    parsed.set(name, cached);
    return cached.tree;
  }
  const virtualRoot = resolve(import.meta.dirname, '.virtual-clear-reset-ast').replaceAll('\\', '/');
  const extension = /\.(?:[cm]?[jt]sx?)$/.exec(name)?.[0] ?? '.ts';
  const input = virtualRoot + '/input' + extension;
  const config = virtualRoot + '/tsconfig.json';
  const fs = createVirtualFileSystem({
    [input]: source,
    [config]: JSON.stringify({ compilerOptions: { noLib: true, noResolve: true, allowJs: true, target: 'esnext' }, files: [input] }),
  });
  // A fresh API prevents changed virtual sources from being served by the native snapshot cache.
  const api = new API({ cwd: virtualRoot, fs });
  let tree;
  try {
    const snapshot = api.updateSnapshot({ openProjects: [config] });
    const project = snapshot.getProjects()[0];
    tree = project?.program.getSourceFile(input);
    const diagnostics = project?.program.getSyntacticDiagnostics(input) ?? [];
    snapshot.dispose();
    if (!tree || tree.text !== source) throw new Error(name + ': AST source mismatch');
    if (diagnostics.length) throw new Error(name + ': syntax error: ' + diagnostics[0].text);
  } finally { api.close(); }
  parsed.delete(name);
  parsed.set(name, { source, tree });
  if (parsed.size > MAX_CACHED_FILES) parsed.delete(parsed.keys().next().value);
  return tree;
}

export function forEachChild(node, visitor, visitArray) {
  return node.forEachChild(visitor, visitArray);
}

/** Whole-declaration replacement boundary. Grouped var statements require an explicit narrow edit. */
export function namedDeclaration(source, name, filename = 'source.ts') {
  const tree = parse(source, filename);
  const matches = [];
  for (const statement of tree.statements) {
    if (statement.name && syntax.isIdentifier(statement.name) && statement.name.text === name) {
      matches.push({ tree, node: statement, declaration: statement, text: statement.getText(tree) });
    } else if (syntax.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!syntax.isIdentifier(declaration.name) || declaration.name.text !== name) continue;
        if (statement.declarationList.declarations.length !== 1) throw new Error(filename + ': grouped variable declaration requires a narrow edit: ' + name);
        matches.push({ tree, node: statement, declaration, text: statement.getText(tree) });
      }
    }
  }
  if (matches.length !== 1) throw new Error(filename + ': unique declaration required: ' + name);
  return matches[0];
}

// Compatible with the subset used by the existing source-preserving AST tools.
export default {
  ...syntax,
  createSourceFile: (name, source) => parse(source, name),
  forEachChild,
};
