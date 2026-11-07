// ADR-020 §15, audit F2/F3: load the owned production adapter without changing vendor sources or build outputs.
import { build } from 'esbuild';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const vendor = 'vendor/protect-722fae8/packages/';
export async function loadValueMatchAdapter() {
  const result = await build({
    stdin: {
      contents: `
        export * from './apps/production-protect/src/patches/value-match/decode.ts';
        export { ValueMatcher, emptyStats } from './apps/production-protect/src/patches/value-match/matcher.ts';
        export { FingerprintStore } from './${vendor}background/src/protect/value-match/fingerprint-store.ts';
        export { TokenRing } from './${vendor}background/src/protect/value-match/ring.ts';
        export { PROTECT_BUDGETS } from '@detect-expert/contracts';
        export { computeFieldFingerprints, hashAudit } from '@detect-expert/engine';
      `,
      resolveDir: root, loader: 'ts', sourcefile: 'protect-value-match-adapter-fixture.ts',
    },
    tsconfig: resolve(root, 'apps/production-protect/tsconfig.json'),
    bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'silent',
    plugins: [{
      name: 'value-match-hash-audit',
      setup(builder) {
        builder.onResolve({ filter: /^@detect-expert\/engine$/ }, () => ({ path: 'engine-audit', namespace: 'value-match-audit' }));
        builder.onLoad({ filter: /.*/, namespace: 'value-match-audit' }, () => ({
          contents: `
            export * from './${vendor}engine/src/index.ts';
            import { fpRange as nativeFpRange } from './${vendor}engine/src/index.ts';
            export const hashAudit = { needle: '', hits: 0, calls: 0 };
            export function fpRange(key, text, start, end, lowerHex) {
              hashAudit.calls++;
              if (hashAudit.needle && text.slice(start, end).includes(hashAudit.needle)) hashAudit.hits++;
              return nativeFpRange(key, text, start, end, lowerHex);
            }
          `,
          resolveDir: root, loader: 'ts',
        }));
      },
    }],
  });
  return import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'));
}

export const SYNTHETIC_EMAIL = 'synthetic.audit-f2@mail-example.com';

export function rawBody(text) {
  const bytes = new TextEncoder().encode(text);
  return { raw: [{ bytes: bytes.buffer }] };
}

export function request(body, over = {}) {
  return {
    tabId: 7, frameId: 0, requestId: 'r1', method: 'POST', type: 'xmlhttprequest',
    url: 'https://receiver.example.org/collect', initiator: 'https://shop.example.com', timeStamp: 1000,
    requestBody: typeof body === 'string' ? rawBody(body) : body,
    ...over,
  };
}

export function matcherFixture(module, { index = false } = {}) {
  const random = n => Uint8Array.from({ length: n }, (_, i) => (i * 13 + 1) & 255);
  const store = new module.FingerprintStore(random);
  const ring = new module.TokenRing();
  const stats = module.emptyStats();
  const ctx = {
    clock: { now: () => 1000 }, isExcluded: () => false, isTabExcluded: () => false,
    ports: {}, tabModel: { topDocumentKey: () => null }, docStore: { docsOfTab: () => [] },
  };
  const matcher = new module.ValueMatcher(ctx, store, ring, stats, random);
  if (index) {
    const doc = store.ensureDocument('fixture-doc', 7, 1000);
    store.upsert(doc, {
      fieldRef: 1, fieldKind: 'email', trigger: 'input',
      entries: module.computeFieldFingerprints('email', SYNTHETIC_EMAIL, store.salt),
    }, { site: 'shop.example.com', topSite: 'shop.example.com', topKey: null, frameContext: 'top', frameSite: null }, 1000);
  }
  const resolved = {
    requestId: 'r1', tabId: 7, frameId: 0, documentKey: null, topDocumentKey: null,
    topSite: 'shop.example.com', frameContext: 'top', frameSite: null,
    receiver: 'example.org', receiverCategory: null, relation: 'cross-site',
    method: 'POST', requestKind: 'fetch-xhr', initiatorSite: 'shop.example.com', timeStamp: 1000,
  };
  return { store, ring, stats, matcher, send: body => matcher.onRequest(request(body), { resolved }) };
}
