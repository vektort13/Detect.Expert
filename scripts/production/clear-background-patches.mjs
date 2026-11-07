// ADR-073: update only the reviewed clear/storage boundaries of the shipped background.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import ts from './clear-reset-ast.mjs';
import { parse, namedClass, namedFunction, classMember, plainRuntime } from './clear-reset-tools.mjs';

const root = resolve(import.meta.dirname, '../..');
const read = path => readFileSync(resolve(root, path), 'utf8');
const hash = text => createHash('sha256').update(text).digest('hex');
const baseline = JSON.parse(read('scripts/production/clear-background-baseline.json'));
const mapped = text => text.replace(/\bMAX_COUNT\b/g, '2147483647').replace(/\bsatAdd\b/g, 'satAdd2');
function splice(source, found, desired) { return source.slice(0, found.node.getStart(found.tree)) + desired + source.slice(found.node.end); }
function replace(source, found, desired, key) {
  if (found.text === desired) return source;
  if (![baseline[key]].flat().includes(hash(found.text))) throw Error('clear background source drift: ' + key);
  return splice(source, found, desired);
}
function block(source, anchor, name, body) {
  const start = '/* clear-reset:' + name + ':start */', end = '/* clear-reset:' + name + ':end */';
  const desired = start + '\n' + body.trim() + '\n' + end + '\n';
  const at = source.indexOf(start);
  if (at >= 0) {
    if (source.indexOf(start, at + start.length) >= 0 || source.slice(at, source.indexOf(end, at) + end.length + 1) !== desired) throw Error('clear background block drift: ' + name);
    return source;
  }
  const position = source.indexOf(anchor);
  if (position < 0 || source.indexOf(anchor, position + anchor.length) >= 0) throw Error('clear background anchor drift: ' + name);
  return source.slice(0, position) + desired + source.slice(position);
}
function addMember(source, name, desired) {
  const found = namedClass(source, 'SessionRepository', 'background.js');
  const members = found.node.members.filter(member => member.name?.text === name);
  if (members.length) {
    if (members.length !== 1 || members[0].getText(found.tree) !== desired) throw Error('clear repository inserted member drift: ' + name);
    return source;
  }
  const at = found.node.end - 1;
  return source.slice(0, at) + '\n' + desired + '\n' + source.slice(at);
}
function clearCase(source) {
  const { tree, node } = namedFunction(source, 'reduce', 'documents.js');
  const cases = [];
  const visit = node => { if (ts.isCaseClause(node) && ts.isStringLiteral(node.expression) && node.expression.text === 'ui:clear') cases.push(node); ts.forEachChild(node, visit); };
  visit(node);
  if (cases.length !== 1) throw Error('unique ui:clear case required');
  return { tree, node: cases[0], text: cases[0].getText(tree) };
}

export function patchClearBackground(source) {
  const documents = mapped(plainRuntime(read('baseline-ts/packages/background/src/documents.ts'), 'documents.ts'));
  const repository = mapped(plainRuntime(read('baseline-ts/packages/background/src/repository.ts'), 'repository.ts'));
  const sessionKeys = plainRuntime(read('packages/background/src/repository.ts'), 'repository.ts');
  const validate = plainRuntime(read('packages/contracts/src/validate.ts'), 'validate.ts');
  for (const name of ['applyBatch', 'onNetworkHost']) source = replace(source, namedFunction(source, name, 'background.js'), namedFunction(documents, name, 'documents.js').text, name);
  const originalReduce = namedFunction(source, 'reduce', 'background.js');
  const desiredCase = clearCase(documents).text;
  const previousCase = clearCase(source);
  if (previousCase.text !== desiredCase) {
    if (hash(originalReduce.text) !== baseline.reduce) throw Error('clear reducer source drift');
    source = splice(source, previousCase, desiredCase);
  }
  source = block(source, '// packages/background/src/documents.ts', 'document-reset', ['resetDocument', 'clearedFromBinding'].map(name => namedFunction(documents, name, 'documents.js').text).join('\n'));
  source = replace(source, namedFunction(source, 'readStoredDocument', 'background.js'), namedFunction(repository, 'readStoredDocument', 'repository.js').text, 'readStoredDocument');
  source = block(source, '// packages/background/src/repository.ts', 'clear-journal', 'var CLEAR_FENCES_KEY = "clear-epochs:v1";\n' + ['readClearFence', 'clearFenceBytes'].map(name => namedFunction(repository, name, 'repository.js').text).join('\n'));
  source = block(source, '// packages/background/src/repository.ts', 'session-key-enumeration', namedFunction(sessionKeys, 'sessionStorageKeys', 'repository.js').text);
  for (const name of ['loadAll', 'remove']) {
    const original = classMember(repository, 'SessionRepository', name, 'repository.js').text;
    const previous = name === 'loadAll' ? original.replace('await this.storage.get(null)', 'typeof this.storage.getKeys === "function" ? await this.storage.get((await this.storage.getKeys()).filter(key => key === INDEX_KEY || key === CLEAR_FENCES_KEY || key.startsWith(DOC_KEY_PREFIX))) : await this.storage.get(null)') : original;
    const previousHelper = name === 'loadAll' ? original.replace('await this.storage.get(null)', 'await this.storage.get((await sessionStorageKeys(this.storage)).filter(key => key === INDEX_KEY || key === CLEAR_FENCES_KEY || key.startsWith(DOC_KEY_PREFIX)))') : original;
    const desired = name === 'loadAll' ? original.replace('const items = await this.storage.get(null);', 'const keys = await sessionStorageKeys(this.storage);\n    if (!isCurrent()) throw new Error("history-access-changed");\n    const items = await this.storage.get(keys.filter(key => key === INDEX_KEY || key === CLEAR_FENCES_KEY || key.startsWith(DOC_KEY_PREFIX)));') : original;
    const found = classMember(source, 'SessionRepository', name, 'background.js');
    source = found.text === original || found.text === previous || found.text === previousHelper ? splice(source, found, desired) : replace(source, found, desired, 'SessionRepository.' + name);
  }
  for (const name of ['fences', 'fenceSize', 'clearFence', 'clearFenceBytes', 'runMany', 'commitMany', 'commitClear']) source = addMember(source, name, classMember(repository, 'SessionRepository', name, 'repository.js').text);
  // Preserve ADR-047's shipped optional Protect-key predicate, including its exact-true/throw semantics.
  const clearAll = classMember(source, 'SessionRepository', 'clearAll', 'background.js');
  const marker = '/* clear-reset:clear-all-cache */';
  const addition = '\n        ' + marker + '\n        if (!kept(CLEAR_FENCES_KEY)) { this.fences.clear(); this.fenceSize = 0; }';
  const oldEnumeration = 'let items = await this.storage.get(null), remove = Object.keys(items).filter((key2) => !kept(key2));';
  const previousEnumeration = 'let keys = typeof this.storage.getKeys === "function" ? await this.storage.getKeys() : Object.keys(await this.storage.get(null)), remove = keys.filter((key2) => !kept(key2));';
  const keyEnumeration = 'let keys = await sessionStorageKeys(this.storage), remove = keys.filter((key2) => !kept(key2));';
  const before = clearAll.text.replace(addition, '').replace(keyEnumeration, oldEnumeration).replace(previousEnumeration, oldEnumeration);
  if (hash(before) !== baseline['SessionRepository.clearAll'] || (before.match(/\n      \}\), !0;/g) ?? []).length !== 1) throw Error('clearAll Protect predicate boundary drift');
  source = splice(source, clearAll, before.replace(oldEnumeration, keyEnumeration).replace('\n      }), !0;', addition + '\n      }), !0;'));
  source = block(source, '// packages/contracts/src/validate.ts', 'native-reset-ack', 'var capturedOwnKeys = Reflect.ownKeys, capturedDescriptor = Object.getOwnPropertyDescriptor, capturedCreate = Object.create;\n' + ['readDataFields', 'validateBridgeResetAck'].map(name => namedFunction(validate, name, 'validate.js').text).join('\n'));
  parse(source, 'patched-background.js');
  return source;
}
