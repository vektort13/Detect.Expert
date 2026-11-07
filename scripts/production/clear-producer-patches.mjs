// ADR-073: exact-source, bounded AST edits of the delivered producer/collector substrate.
// No build, filesystem write or browser operation occurs in this module.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { transformSync } from 'esbuild';
import ts, { parse, forEachChild } from './clear-reset-ast.mjs';

const root = resolve(import.meta.dirname, '../..');
const read = path => readFileSync(resolve(root, path), 'utf8');
const hash = text => createHash('sha256').update(text).digest('hex');
const BASE = {
  deliver: '7814e6da8e5079cbe8b438c79adaf5b8e564b073c65dfbe607e2847496dc084f',
  handshake: '86e85fbd5e35a276288f0cf7b39caad603c7b6a995c9ffa7a81d8bef3d0473fb',
  listen: 'd53af1999a7f00d7b1ddbc12b040f71f60683ad7cb157daf153ad73383785af4',
  collector: 'e91fc6aca4c9119cba0b3d268dfed96dd94a8d53130190f67d7e4f2d80282ffc',
  sensorBootId: 'f7c0903d5b615c90c499738d043800b95ccba8aeee43ed89881474fd15310c9f',
  constructor: '3e224c7fbc1fb0649d883121386b50144c7a7b2c92213748b99625fc4a7461cd',
  onMessage: '0eaa5e66b7faeb0d6396b346125b637d16457d253a7d0d05072a1751b0fbf60c',
  bridgeMessage: 'd20e44c579b013657962441a98f2e22562715c183e7fa253e947156a87a8310f',
  sensorMessage: 'd7aea1c1eeefefb1a540df04b8eaf409fa81065b149f0b2e26b6b0f831d299ca',
  bridgeControl: 'f30554956f0e65502825b5b4dc4afbb2068b216fe497f1965242bb34f4228323',
  createBrowserCollectorEnv: '346dcb8cf6a394cd3b3289ba169db5fcf6e889be278e5817cdcee6f1cf82c2fe',
};

function matches(tree, predicate) {
  const out = [];
  function visit(node) { if (predicate(node)) out.push(node); forEachChild(node, visit); }
  visit(tree);
  return out;
}
function one(nodes, label) { if (nodes.length !== 1) throw Error(label + ': unique AST boundary required'); return nodes[0]; }
function classNode(source, name, file) {
  const tree = parse(source, file);
  const node = one(matches(tree, node => ts.isClassDeclaration(node) && node.name?.text === name || ts.isClassExpression(node) && ts.isVariableDeclaration(node.parent) && node.parent.name.getText(tree) === name), file + ':' + name);
  return { tree, node };
}
function member(source, className, name, file) {
  const { tree, node } = classNode(source, className, file);
  const selected = one(node.members.filter(item => name === 'constructor' ? ts.isConstructorDeclaration(item) : item.name?.text === name), file + ':' + className + '.' + name);
  return { tree, node: selected, text: selected.getText(tree) };
}
function functionNode(source, name, file) {
  const tree = parse(source, file);
  const node = one(matches(tree, node => ts.isFunctionDeclaration(node) && node.name?.text === name), file + ':' + name);
  return { tree, node, text: node.getText(tree) };
}
function splice(source, found, replacement) { return source.slice(0, found.node.getStart(found.tree)) + replacement + source.slice(found.node.end); }
function guarded(source, found, replacement, baseline, label) {
  if (found.text === replacement) return source;
  if (hash(found.text) !== baseline) throw Error(label + ': source drift; review the changed boundary');
  return splice(source, found, replacement);
}
function addMember(source, className, name, text, file) {
  const found = classNode(source, className, file), present = found.node.members.filter(item => item.name?.text === name);
  if (present.length) {
    if (present.length !== 1 || present[0].getText(found.tree) !== text) throw Error(file + ':' + name + ': inserted member drift');
    return source;
  }
  const at = found.node.end - 1;
  return source.slice(0, at) + '\n' + text + '\n' + source.slice(at);
}
function insertBlock(source, at, name, body) {
  const start = '/* clear-reset:' + name + ':start */', end = '/* clear-reset:' + name + ':end */';
  const block = start + '\n' + body.trim() + '\n' + end + '\n';
  const previous = source.indexOf(start);
  if (previous >= 0) {
    if (source.indexOf(start, previous + start.length) >= 0 || source.slice(previous, source.indexOf(end, previous) + end.length + 1) !== block) throw Error(name + ': inserted block drift');
    return source;
  }
  return source.slice(0, at) + block + source.slice(at);
}
function compile(source) {
  return transformSync(source, { loader: 'ts', target: 'es2022', charset: 'utf8', legalComments: 'none', define: { MAX_COUNT: '2147483647' } }).code;
}
function plainModule(source, file) {
  const tree = parse(source, file), cuts = tree.statements.filter(node => ts.isImportDeclaration(node) || ts.isExportDeclaration(node)).map(node => [node.getFullStart(), node.end]);
  for (const [from, to] of cuts.reverse()) source = source.slice(0, from) + source.slice(to);
  return compile(source.replace(/^export /gm, ''));
}
function compiledFunction(source, name, file) { return functionNode(plainModule(source, file), name, file + '.js').text; }
function replaceFunction(source, name, desired, file) { return guarded(source, functionNode(source, name, file), desired, BASE[name], file + ':' + name); }

function replaceModule(source, name, next, body, file) {
  const start = '  // packages/collector/src/' + name + '.ts', stop = '  // packages/collector/src/' + next + '.ts';
  const from = source.indexOf(start), to = source.indexOf(stop, from + start.length);
  if (from < 0 || to < 0 || source.indexOf(start, from + start.length) >= 0) throw Error(file + ':' + name + ': module boundary drift');
  const replacement = start + '\n' + body + '\n\n';
  if (source.slice(from, to) === replacement) return source;
  if (hash(source.slice(from, to)) !== BASE[name]) throw Error(file + ':' + name + ': module source drift');
  return source.slice(0, from) + replacement + source.slice(to);
}

const RESET_MESSAGE_BRANCH = '\n      /* clear-reset:sensor-routing */\n      if (msg.type === "bridge-reset") {\n        if (msg.sensorBootId === this.sensorBootId || (this.lastReset?.resetId === msg.resetId && msg.sensorBootId === this.lastReset.sensorBootId)) this.reset(msg.resetId);\n        return;\n      }';
const SENSOR_RESET = `reset(resetId) {
  if (this.stopped) return;
  if (this.lastReset?.resetId === resetId) { this.post(this.lastReset); this.postHello(); return; }
  const oldBoot = this.sensorBootId;
  this.cancelTimer(); clearResetMap(this.counters);
  this.lastCounterKey = -1; this.lastCounter = undefined;
  this.dirty.length = 0; this.dropped = 0;
  clearResetFlag(this.flags, 'budget-exceeded'); clearResetFlag(this.flags, 'channel-gap'); clearResetFlag(this.flags, 'truncated');
  this.flagDelta = []; this.sensorSeq = 0; this.historyEpoch = {}; this.bootAt = this.env.now();
  this.sensorBootId = makeBootId(this.env).slice(0, 20) + '-' + resetId.slice(-32);
  this.handshake = false;
  this.lastReset = { channel: CHANNEL, type: 'sensor-reset', sensorBootId: oldBoot, resetId, nextSensorBootId: this.sensorBootId, coverageFlags: setArray(this.flags) };
  this.post(this.lastReset); this.postHello();
}`;

export function patchSensorRuntime(source, file = 'hook.main.js') {
  // Keep the shipped public field and constructor (including value-capture plumbing) byte-identical.
  if (hash(member(source, 'SensorRuntime', 'sensorBootId', file).text) !== BASE.sensorBootId || hash(member(source, 'SensorRuntime', 'constructor', file).text) !== BASE.constructor) throw Error(file + ': sensor identity/constructor drift');
  source = addMember(source, 'SensorRuntime', 'lastReset', 'lastReset = null;', file);
  const ingress = member(source, 'SensorRuntime', 'onMessage', file);
  const original = ingress.text.replace(RESET_MESSAGE_BRANCH, '');
  if (hash(original) !== BASE.onMessage || (original.match(/let msg = result\.value;/g) ?? []).length !== 1) throw Error(file + ': sensor ingress drift');
  source = splice(source, ingress, original.replace('let msg = result.value;', 'let msg = result.value;' + RESET_MESSAGE_BRANCH));
  source = addMember(source, 'SensorRuntime', 'reset', SENSOR_RESET, file);
  const runtime = classNode(source, 'SensorRuntime', file);
  let declaration = runtime.node;
  while (!ts.isVariableStatement(declaration) && declaration.parent) declaration = declaration.parent;
  if (!ts.isVariableStatement(declaration)) throw Error(file + ': sensor variable statement missing');
  source = insertBlock(source, declaration.getStart(runtime.tree), 'sensor-intrinsics', 'var clearResetMap = Function.prototype.call.bind(Map.prototype.clear), clearResetFlag = Function.prototype.call.bind(Set.prototype.delete);');
  return source;
}

function patchPageValidators(source, file, includeSensor) {
  const validator = read('packages/contracts/src/validate.ts');
  source = replaceFunction(source, 'bridgeMessage', compiledFunction(validator, 'bridgeMessage', 'root-validate.ts'), file);
  if (includeSensor) source = replaceFunction(source, 'sensorMessage', compiledFunction(validator, 'sensorMessage', 'root-validate.ts'), file);
  return source;
}
function patchControlValidator(source, file) {
  const validator = read('packages/contracts/src/validate.ts');
  const control = compiledFunction(validator, 'bridgeControl', 'root-validate.ts');
  source = replaceFunction(source, 'bridgeControl', control, file);
  const found = functionNode(source, 'bridgeControl', file);
  source = insertBlock(source, found.node.getStart(found.tree), 'control-reader', 'var capturedOwnKeys = Reflect.ownKeys, capturedDescriptor = Object.getOwnPropertyDescriptor, capturedCreate = Object.create;\nvar BRIDGE_CONTROL_RESET_SET = new Set([...BRIDGE_CONTROL_KEYS, "resetId"]);\n' + compiledFunction(validator, 'readDataFields', 'root-validate.ts'));
  return source;
}

function patchControlCommands(source, file) {
  const tree = parse(source, file);
  const declaration = one(matches(tree, node => ts.isVariableDeclaration(node) && node.name?.text === 'BRIDGE_CONTROL_COMMANDS'), file + ':control commands');
  const initializer = declaration.initializer;
  if (!initializer || !ts.isArrayLiteralExpression(initializer)) throw Error(file + ': control command initializer drift');
  const commands = initializer.elements.map(item => ts.isStringLiteral(item) ? item.text : null);
  if (JSON.stringify(commands) === JSON.stringify(['pause', 'resume', 'reset'])) return source;
  if (JSON.stringify(commands) !== JSON.stringify(['pause', 'resume'])) throw Error(file + ': control command values drift');
  return source.slice(0, initializer.getStart(tree)) + '["pause", "resume", "reset"]' + source.slice(initializer.end);
}

export function patchBridge(source, file = 'bridge.js') {
  // Generic delivery uses the final TS physical-cap1 implementation. Production routing keeps its strict bind.
  source = replaceModule(source, 'deliver', 'handshake', 'var { Deliverer, readAck, isFatalTransportError } = (() => {\n' + plainModule(read('packages/collector/src/deliver.ts'), 'root-deliver.ts') + '\nreturn { Deliverer, readAck, isFatalTransportError };\n})();', file);
  source = replaceModule(source, 'handshake', 'listen', 'var { Handshake } = (() => {\n' + plainModule(read('baseline-ts/packages/collector/src/handshake.ts'), 'production-handshake.ts') + '\nreturn { Handshake };\n})();', file);
  let listen = read('baseline-ts/packages/collector/src/listen.ts');
  listen = listen.replace("'sensor-hello', 'sensor-batch', 'sensor-status'", "'sensor-hello', 'sensor-batch', 'sensor-status', 'sensor-reset'").replace("'bridge-hello', 'bridge-pause', 'bridge-resume', 'bridge-stop'", "'bridge-hello', 'bridge-pause', 'bridge-resume', 'bridge-stop', 'bridge-reset'");
  // Do not duplicate types if the canonical mirror has already incorporated the final protocol.
  listen = listen.replace("'sensor-reset', 'sensor-reset'", "'sensor-reset'").replace("'bridge-reset', 'bridge-reset'", "'bridge-reset'");
  source = replaceModule(source, 'listen', 'ring', 'var { ingestWindowMessage } = (() => {\n' + plainModule(listen, 'production-listen.ts') + '\nreturn { ingestWindowMessage };\n})();', file);
  source = addMember(source, 'AggregateRing', 'clear', 'clear() { this.records.clear(); this.cleanKeys.clear(); this.dirtyCount = 0; }', file);
  let collector = read('baseline-ts/packages/collector/src/collector.ts');
  for (const name of ['onHello', 'onBatch', 'onStatus']) {
    const signature = new RegExp('(function ' + name + '\\([^\\n]+\\): void \\{)(?!\\s*if \\(resetting !== null\\))');
    collector = collector.replace(signature, '$1\n    if (resetting !== null) return;');
  }
  collector = collector.replace('addFlags(result.coverageFlags)', 'addSensorFlags(result.coverageFlags)');
  for (const sentinel of ['resetting !== null', 'addSensorFlags(result.coverageFlags)', "command === 'reset'"]) if (!collector.includes(sentinel)) throw Error('production collector donor incomplete: ' + sentinel);
  source = replaceModule(source, 'collector', 'env', 'var { startCollector, DEFAULT_COLLECTOR_OPTIONS } = (() => {\n' + plainModule(collector, 'production-collector.ts') + '\nreturn { startCollector, DEFAULT_COLLECTOR_OPTIONS };\n})();', file);
  source = replaceFunction(source, 'createBrowserCollectorEnv', compiledFunction(read('baseline-ts/packages/collector/src/env.ts'), 'createBrowserCollectorEnv', 'production-env.ts'), file);
  source = patchPageValidators(source, file, true);
  source = patchControlValidator(source, file);
  return patchControlCommands(source, file);
}

export function patchProducer(source, file) {
  if (file === 'bridge.js') return patchBridge(source, file);
  if (file === 'hook.early.js' || file === 'hook.main.js') return patchControlCommands(patchPageValidators(patchSensorRuntime(source, file), file, false), file);
  throw Error('unexpected producer target: ' + file);
}
