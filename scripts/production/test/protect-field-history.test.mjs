// ADR-050 / audit F1: real DOM, independent native value counter, adapter-only inputs.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { auditProtectSource } from '../build-protect.mjs';

const root = resolve(import.meta.dirname, '../../..');
const adapter = 'apps/production-protect/src/patches/packages/collector/src/protect/';
const resolveContracts = { name: 'immutable-vendor-contracts', setup(builder) {
  builder.onResolve({ filter: /^@detect-expert\/contracts$/ }, () => ({ path: resolve(root, 'vendor/protect-722fae8/packages/contracts/src/index.ts') }));
} };
const compiled = await build({ stdin: { contents: `export { createBrowserProtectEnv } from './${adapter}env.ts'; export { EverPasswordTracker, isPaymentControl } from './${adapter}classify.ts'; export { readTrackedValue } from './${adapter}field-value.ts';`, resolveDir: root, loader: 'ts' },
  write: false, bundle: true, format: 'iife', globalName: '__ProtectF1Adapter', platform: 'browser', plugins: [resolveContracts], logLevel: 'silent' });
const tripwire = await build({ entryPoints: [resolve(root, 'apps/production-protect/src/patches/apps/extension/entrypoints/test-only/protect-tripwire.core.ts')],
  write: false, bundle: true, format: 'iife', globalName: '__ProtectF1Tripwire', platform: 'browser', logLevel: 'silent' });
let browser;
before(async () => { browser = await chromium.launch({ channel: 'chromium', headless: true }); });
after(async () => { await browser?.close(); });
async function fixture({ withTripwire = false } = {}) {
  const page = await browser.newPage();
  await page.setContent('<!doctype html><title>Owned F1 regression</title><body><input id="normal" name="email" type="email"></body>');
  await page.evaluate(() => {
    // This counter knows fixture identities, not the classifier's history or roots.
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    window.__independentReads = {};
    Object.defineProperty(HTMLInputElement.prototype, 'value', { ...descriptor, get() {
      const label = this.getAttribute('data-fixture');
      if (label) window.__independentReads[label] = (window.__independentReads[label] ?? 0) + 1;
      return Reflect.apply(descriptor.get, this, []);
    } });
    document.querySelector('#normal').setAttribute('data-fixture', 'normal');
    document.querySelector('#normal').value = 'ordinary@example.com';
  });
  if (withTripwire) {
    await page.addScriptTag({ content: tripwire.outputFiles[0].text });
    await page.evaluate(() => __ProtectF1Tripwire.installPasswordTripwire('isolated'));
  }
  await page.addScriptTag({ content: compiled.outputFiles[0].text });
  await page.evaluate(() => {
    const { createBrowserProtectEnv, EverPasswordTracker, readTrackedValue, isPaymentControl } = __ProtectF1Adapter;
    const env = createBrowserProtectEnv(), tracker = new EverPasswordTracker(callback => env.observeTypeAttributes(callback));
    let uses = 0;
    window.__f1 = { env, tracker, get uses() { return uses; }, read(element) {
      return readTrackedValue(element, { tracker, documentHasPaymentField: () => env.formControls(256).some(isPaymentControl) }, () => { uses++; return 'used'; });
    } };
  });
  return page;
}

test('F1: real normal email positive control reads exactly once; current and same-task former passwords never read', async () => {
  const page = await fixture();
  try {
    const result = await page.evaluate(() => {
      const normal = document.querySelector('#normal'), positive = __f1.read(normal);
      const control = document.createElement('input'); control.name = 'email'; control.type = 'password'; control.value = 'synthetic-only'; control.setAttribute('data-fixture', 'password'); document.body.appendChild(control);
      const current = __f1.read(control); control.type = 'text'; const former = __f1.read(control);
      return { positive, current, former, reads: __independentReads, uses: __f1.uses };
    });
    assert.equal(result.positive.status, 'read'); assert.equal(result.current.status, 'never'); assert.equal(result.former.status, 'never');
    assert.deepEqual(result.reads, { normal: 1 }); assert.equal(result.uses, 1);
  } finally { await page.close(); }
});

test('F1: open, nested and closed ShadowRoot controls are rejected before value access', async () => {
  const page = await fixture();
  try {
    const result = await page.evaluate(() => {
      const outcomes = [];
      for (const mode of ['open', 'closed']) {
        const host = document.createElement('div'); document.body.appendChild(host); const shadow = host.attachShadow({ mode });
        const control = document.createElement('input'); control.name = 'email'; control.type = 'password'; control.value = 'synthetic-shadow-only'; control.setAttribute('data-fixture', mode); shadow.appendChild(control); control.type = 'text';
        outcomes.push(__f1.read(control));
      }
      return { outcomes, reads: __independentReads, uses: __f1.uses };
    });
    assert.deepEqual(result.outcomes.map(row => row.status), ['not-tracked', 'not-tracked']); assert.deepEqual(result.reads, {}); assert.equal(result.uses, 0);
  } finally { await page.close(); }
});

test('F1: payment control inside nested open roots suspends light-DOM email reads', async () => {
  const page = await fixture();
  try {
    const result = await page.evaluate(() => {
      const host = document.createElement('section'); document.body.appendChild(host); const shadow = host.attachShadow({ mode: 'open' });
      const nested = document.createElement('div'); shadow.appendChild(nested); const deep = nested.attachShadow({ mode: 'open' });
      const card = document.createElement('input'); card.autocomplete = 'cc-number'; deep.appendChild(card);
      return { outcome: __f1.read(document.querySelector('#normal')), controls: __f1.env.formControls(256).length, reads: __independentReads };
    });
    assert.equal(result.outcome.status, 'payment-suspended'); assert.equal(result.controls, 2); assert.deepEqual(result.reads, {});
  } finally { await page.close(); }
});

test('F1: directly observed light field retains password history across detached tasks and reinsertion', async () => {
  const page = await fixture();
  try {
    const result = await page.evaluate(async () => {
      const control = document.querySelector('#normal'); const before = __f1.tracker.isTracked(control);
      control.remove(); const detached = __f1.read(control);
      await new Promise(resolve => setTimeout(resolve, 0)); control.type = 'password'; control.type = 'text';
      await new Promise(resolve => setTimeout(resolve, 0)); document.body.appendChild(control);
      return { before, detached, reinserted: __f1.read(control), reads: __independentReads };
    });
    assert.equal(result.before, true); assert.equal(result.detached.status, 'not-tracked'); assert.equal(result.reinserted.status, 'never'); assert.equal(result.reinserted.never, 'was-password'); assert.deepEqual(result.reads, {});
  } finally { await page.close(); }
});

test('F1: foreign-document controls and stopped/unavailable/failed observers never read values', async () => {
  const page = await fixture();
  try {
    const result = await page.evaluate(() => {
      const { EverPasswordTracker, readTrackedValue } = __ProtectF1Adapter;
      const frame = document.createElement('iframe'); document.body.appendChild(frame); const foreign = frame.contentDocument.createElement('input'); foreign.type = 'email'; frame.contentDocument.body.appendChild(foreign);
      const outcomes = [__f1.read(foreign)];
      for (const observe of [null, () => null, () => { throw new Error('failed startup'); }, () => ({ takeRecords() { throw new Error('failed drain'); }, isTracked() { return true; }, disconnect() {} })]) {
        const tracker = new EverPasswordTracker(observe);
        outcomes.push(readTrackedValue(document.querySelector('#normal'), { tracker, documentHasPaymentField: () => false }, () => 'forbidden'));
      }
      __f1.tracker.stop(); outcomes.push(__f1.read(document.querySelector('#normal')));
      return { outcomes, reads: __independentReads };
    });
    assert.ok(result.outcomes.every(row => row.status === 'not-tracked')); assert.deepEqual(result.reads, {});
  } finally { await page.close(); }
});

test('F1: incomplete control, node or shadow-root scans fail closed instead of hiding an unscanned payment field', async () => {
  for (const budget of ['controls', 'nodes', 'roots']) {
    const page = await fixture();
    try {
      const result = await page.evaluate(budget => {
        const total = budget === 'controls' ? 257 : budget === 'nodes' ? 4100 : 65;
        const fragment = document.createDocumentFragment();
        for (let index = 0; index < total; index++) {
          const node = document.createElement(budget === 'controls' ? 'input' : 'div'); if (budget === 'roots') node.attachShadow({ mode: 'open' }); fragment.appendChild(node);
        }
        document.body.appendChild(fragment); return { outcome: __f1.read(document.querySelector('#normal')), reads: __independentReads };
      }, budget);
      assert.equal(result.outcome.status, 'not-tracked', budget); assert.deepEqual(result.reads, {}, budget);
    } finally { await page.close(); }
  }
});

test('F1: independent tripwire counts forbidden shadow reads as hits, with detached self-check and ordinary email positive control', async () => {
  const page = await fixture({ withTripwire: true });
  try {
    const result = await page.evaluate(() => {
      const before = JSON.parse(document.documentElement.dataset.pwTripwireIsolated); __f1.read(document.querySelector('#normal'));
      const form = document.createElement('form'); document.body.appendChild(form); form.appendChild(document.querySelector('#normal'));
      void new FormData(form); const ordinaryForm = JSON.parse(document.documentElement.dataset.pwTripwireIsolated);
      const host = document.createElement('div'); document.body.appendChild(host); const shadow = host.attachShadow({ mode: 'open' });
      const input = document.createElement('input'); input.type = 'password'; input.name = 'email'; input.value = 'synthetic-only'; input.setAttribute('data-fixture', 'former-shadow'); shadow.appendChild(input); input.type = 'text';
      const outcome = __f1.read(input), safe = JSON.parse(document.documentElement.dataset.pwTripwireIsolated);
      void input.value; const positive = JSON.parse(document.documentElement.dataset.pwTripwireIsolated);
      return { before, ordinaryForm, outcome, safe, positive, reads: __independentReads };
    });
    assert.equal(result.before.selfCheck, 1); assert.equal(result.before.hits, 0);
    assert.equal(result.ordinaryForm.hits, 0, 'A normal form is not an untracked sensitive control');
    assert.equal(result.outcome.status, 'not-tracked'); assert.equal(result.safe.hits, 0); assert.ok(result.safe.nonPasswordReads >= 1);
    assert.equal(result.positive.hits, 1); assert.deepEqual(result.reads, { normal: 1, 'former-shadow': 1 });
  } finally { await page.close(); }
});

test('F1: adapter sources retain one audited value read and immutable vendor imports', () => {
  const field = readFileSync(resolve(root, adapter, 'field-value.ts'), 'utf8');
  assert.equal((field.match(/el\.value/g) ?? []).length, 1); assert.match(field, /@protect-audited-read/);
  for (const file of ['classify.ts', 'field-value.ts']) {
    const source = readFileSync(resolve(root, adapter, file), 'utf8');
    assert.match(source, /vendor\/protect-722fae8\/packages\/engine/);
    assert.deepEqual(auditProtectSource(source, adapter + file), []);
  }
});

test('PP-01: complete long autocomplete markers block password and OTP fields before any native value read', async () => {
  for (const token of ['current-password', 'new-password', 'one-time-code']) for (const prefix of ['section-' + 'a'.repeat(100) + ' ', ' '.repeat(65), '\t\n\f\r '.repeat(20)]) {
    const page = await fixture();
    try {
      const result = await page.evaluate(({ token, prefix }) => {
        const input = document.querySelector('#normal');
        input.type = token === 'one-time-code' ? 'tel' : 'email';
        input.setAttribute('autocomplete', prefix + token.toUpperCase());
        return { outcome: __f1.read(input), reads: __independentReads, uses: __f1.uses };
      }, { token, prefix });
      assert.equal(result.outcome.status, 'never', token);
      assert.equal(result.outcome.never, token === 'one-time-code' ? 'one-time-code' : 'password');
      assert.deepEqual(result.reads, {}, token); assert.equal(result.uses, 0);
    } finally { await page.close(); }
  }
});

test('PP-01: long credential hints and over-limit attributes fail closed without evaluating value', async () => {
  for (const attribute of ['autocomplete', 'name', 'id', 'placeholder', 'aria-label']) {
    for (const overLimit of [false, true]) {
      const page = await fixture();
      try {
        const result = await page.evaluate(({ attribute, overLimit }) => {
          const input = document.querySelector('#normal');
          input.setAttribute(attribute, overLimit ? 'a'.repeat(4097) : (attribute === 'autocomplete' ? 'section-' + 'a'.repeat(100) + ' current-password' : 'a'.repeat(100) + ' password'));
          return { outcome: __f1.read(input), reads: __independentReads, uses: __f1.uses };
        }, { attribute, overLimit });
        assert.equal(result.outcome.status, 'never', attribute); assert.deepEqual(result.reads, {}, attribute); assert.equal(result.uses, 0);
      } finally { await page.close(); }
    }
  }
});

test('PP-01: harmless long sections and labels retain the ordinary email positive control', async () => {
  const page = await fixture();
  try {
    const result = await page.evaluate(() => {
      const input = document.querySelector('#normal');
      input.setAttribute('autocomplete', 'section-' + 'a'.repeat(100) + ' email');
      input.setAttribute('aria-label', 'a'.repeat(4096));
      return { outcome: __f1.read(input), reads: __independentReads, uses: __f1.uses };
    });
    assert.equal(result.outcome.status, 'read'); assert.deepEqual(result.reads, { normal: 1 }); assert.equal(result.uses, 1);
  } finally { await page.close(); }
});

test('PP-01: payment hints beyond the old truncation boundary suspend the whole document', async () => {
  for (const attribute of ['name', 'id', 'placeholder', 'aria-label']) {
    const page = await fixture();
    try {
      const result = await page.evaluate(attribute => {
        const payment = document.createElement('input'); payment.setAttribute(attribute, 'a'.repeat(100) + ' card'); document.body.appendChild(payment);
        return { outcome: __f1.read(document.querySelector('#normal')), reads: __independentReads };
      }, attribute);
      assert.equal(result.outcome.status, 'payment-suspended', attribute); assert.deepEqual(result.reads, {}, attribute);
    } finally { await page.close(); }
  }
});

test('PP-01: complete long payment markers and unknown over-limit controls suspend other field reads', async () => {
  for (const marker of ['section-' + 'a'.repeat(100) + ' cc-number', 'current-password section-' + 'a'.repeat(100) + ' cc-exp', 'a'.repeat(4097)]) {
    const page = await fixture();
    try {
      const result = await page.evaluate(marker => {
        const payment = document.createElement('input'); payment.setAttribute('autocomplete', marker); document.body.appendChild(payment);
        return { outcome: __f1.read(document.querySelector('#normal')), reads: __independentReads, uses: __f1.uses };
      }, marker);
      assert.equal(result.outcome.status, 'payment-suspended'); assert.deepEqual(result.reads, {}); assert.equal(result.uses, 0);
    } finally { await page.close(); }
  }
  const page = await fixture();
  try {
    const result = await page.evaluate(() => {
      const hidden = document.createElement('input'); hidden.type = 'hidden'; hidden.setAttribute('autocomplete', 'section-' + 'a'.repeat(100) + ' cc-number'); document.body.appendChild(hidden);
      return { outcome: __f1.read(document.querySelector('#normal')), reads: __independentReads };
    });
    assert.equal(result.outcome.status, 'read'); assert.deepEqual(result.reads, { normal: 1 });
  } finally { await page.close(); }
});
