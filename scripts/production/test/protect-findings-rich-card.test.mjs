// ADR-052 / ADR-020 §15: factual read-only cards cannot invent an outcome, attribution or decision capability.
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';

const root = resolve(import.meta.dirname, '../../..');
const i18n = resolve(root, 'apps/production-protect/src/ui/i18n-shim.ts');
const vendorI18n = resolve(root, 'vendor/protect-722fae8/packages/ui/src/i18n');
const built = await build({ stdin: { resolveDir: root, loader: 'ts', contents: `
  export * from './apps/production-protect/src/ui/TransferFindingCard.tsx';
  export * from './vendor/protect-722fae8/packages/ui/test/protect-firewall-support.ts';
  export * from './apps/production-protect/src/ui/i18n-shim.ts';
` }, bundle: true, write: false, format: 'esm', platform: 'node', jsx: 'automatic', jsxImportSource: 'preact',
  tsconfig: resolve(root, 'apps/production-protect/tsconfig.json'), logLevel: 'silent',
  plugins: [{ name: 'production-i18n', setup(builder) {
    builder.onResolve({ filter: /^\.{1,2}\// }, args => {
      const path = resolve(args.resolveDir, args.path);
      return path === vendorI18n || path === vendorI18n + '.ts' ? { path: i18n } : undefined;
    });
  } }],
});
const M = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'));
M.setProductionLocale('en');
// Resolve this pure component's VNodes without adding a DOM or a new renderer dependency.
function nodes(value, ancestors = []) {
  if (value === null || value === undefined || typeof value === 'boolean') return [];
  if (Array.isArray(value)) return value.flatMap(child => nodes(child, ancestors));
  if (typeof value === 'string' || typeof value === 'number') return [{ type: '#text', value: String(value), props: {}, ancestors }];
  if (typeof value.type === 'function') return nodes(value.type(value.props), ancestors);
  const node = { type: value.type, props: value.props, ancestors };
  return [node, ...nodes(value.props.children, [...ancestors, node])];
}
const render = (evidence = M.fwEvidence(), report = M.fwProjection({ prompt: null })) => nodes(M.TransferFindingCard({ evidence, report }));
const find = (tree, name, value) => tree.find(node => node.props[name] === value);
const content = tree => tree.filter(node => node.type === '#text').map(node => node.value).join(' ');
const row = (tree, name) => { const parent = find(tree, 'data-fw-row', name); assert.ok(parent); return content(tree.filter(node => node.ancestors.includes(parent))); };

test('a genuine transfer without a pending prompt has immediately visible facts and no decision capability', () => {
  const tree = render(); assert.ok(find(tree, 'data-fw-readonly', 'true')); assert.ok(find(tree, 'data-fw-card', 'sent'));
  for (const name of ['sender', 'company', 'receiver', 'data', 'moment']) {
    const node = find(tree, 'data-fw-row', name); assert.ok(node); assert.ok(!node.ancestors.some(parent => parent.type === 'details'));
    assert.ok(row(tree, name).trim());
  }
  assert.ok(tree.some(node => node.props.class === 'fw-chip'));
  const proof = tree.find(node => node.type === 'details'); assert.ok(proof); assert.equal(proof.props.open, undefined);
  assert.ok(!tree.some(node => node.props['data-fw-action'] || node.props.name === 'fw-scope' || Object.keys(node.props).some(key => /^on[A-Z]/.test(key))));
});

test('the alert describes the matched request and downgrades unsupported stopped claims', () => {
  const latest = M.fwReceiver(undefined, { lastDelivery: 'sent' });
  const report = M.fwProjection({ prompt: null, receivers: [latest] });
  for (const deliveryState of ['unknown', 'stopped-other', 'stopped']) assert.ok(find(render(M.fwEvidence(undefined, { deliveryState }), report), 'data-fw-alert', 'unknown'), deliveryState);
  const stopped = M.fwReceiver(undefined, { delivery: { sent: 0, stopped: 1, stoppedOther: 0, unknown: 0 }, effectiveRule: { action: 'block', scope: 'site', origin: 'user' } });
  const supported = M.fwProjection({ prompt: null, receivers: [stopped] });
  assert.ok(find(render(M.fwEvidence(undefined, { deliveryState: 'stopped' }), supported), 'data-fw-alert', 'stopped'));
  assert.ok(find(render(M.fwEvidence(undefined, { deliveryState: 'sent' }), supported), 'data-fw-alert', 'sent'));
});

test('field, parameter and timing come from the shown record rather than the receiver latest request', () => {
  const report = M.fwProjection({ prompt: null, receivers: [M.fwReceiver(undefined, { fieldKinds: ['phone'], submitTiming: 'after-submit', sinceInput: 'gt-30s' })] });
  const tree = render(M.fwEvidence(undefined, { fieldKind: 'email', paramName: 'email', submitTiming: 'before-submit', sinceInput: '1-5s' }), report);
  assert.ok(row(tree, 'data').includes('email')); assert.ok(!row(tree, 'data').includes(M.t('protect_field_phone')));
  const timing = row(tree, 'moment'); assert.ok(timing.includes(M.t('protect_since_1_5s')) || timing.includes('1–5') || timing.includes('1-5'));
  assert.ok(!timing.includes('2 seconds')); assert.ok(!timing.includes('3 seconds'));
});

test('unknown company and frame attribution cannot become a fabricated vendor or exact script', () => {
  const script = { kind: 'external', scheme: 'https', host: 'cdn.example.org', pathTemplate: '/sender.js' };
  const ordinary = render(M.fwEvidence(undefined, { script, attributionConfidence: 'frame-only' }));
  assert.ok(!row(ordinary, 'sender').includes(script.host)); assert.ok(row(ordinary, 'company').includes(M.t('fw_company_not_checked')));
  const sampled = render(M.fwEvidence(undefined, { script, attributionConfidence: 'sampled-stack' }));
  assert.ok(row(sampled, 'sender').includes(script.host));
});

test('opaque, malformed and accessor-bearing evidence produces no card and does not read a value getter', () => {
  for (const change of [{ protectKind: 'opaque-after-input' }, { encodings: [] }, { deliveryState: 'invented' }, { endpointPathTemplate: '/collect?secret=value' }, { endpointHost: 'https://secret.example/path' }]) assert.deepEqual(render(M.fwEvidence(undefined, change)), []);
  let reads = 0; const evidence = M.fwEvidence(); Object.defineProperty(evidence, 'value', { enumerable: true, get() { reads++; throw Error('forbidden'); } });
  assert.deepEqual(render(evidence), []); assert.equal(reads, 0);
});
