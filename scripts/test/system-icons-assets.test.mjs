// ADR-080: independent asset, receipt and adversarial checks for the packaged icon registry.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { validateSystemIcons, buildSystemIcons } from '../build-system-icons.mjs';
import { SYSTEM_BRANDS } from '../../apps/production-extension/system-branding-data.js';
import { AUTOSURF_SITES_DATA } from '../../apps/production-extension/autosurf-sites-data.js';

const root = new URL('../../', import.meta.url);
const read = file => readFileSync(new URL(file, root));
const input = JSON.parse(read('packages/catalog/data/system-icons.v1.json'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

test('the icon module and public receipt projection are reproducible from the reviewed input', () => {
  const summary = buildSystemIcons(true);
  assert.equal(summary.systems, AUTOSURF_SITES_DATA.trackingSystems.length);
  assert.equal(summary.brand + summary.generic, summary.systems);
  assert.deepEqual(SYSTEM_BRANDS, input.records);
});

const rejectedMutations = [
  ['foreign id', value => { value.records[0].id = 'foreign-system'; }],
  ['duplicate id', value => { value.records[1].id = value.records[0].id; }],
  ['changed system name', value => { value.records[0].name = 'Someone Else'; }],
  ['ambiguous alias', value => { value.records[0].aliases = [value.records[1].name]; }],
  ['asset traversal', value => { value.records[0].asset = 'systems/../brands/forter.png'; }],
  ['remote asset', value => { value.records[0].asset = 'https://example.com/icon.png'; }],
  ['asset hash mismatch', value => { value.assets[0].sha256 = '0'.repeat(64); }],
  ['record and receipt kind mismatch', value => { value.assets[0].kind = value.records[0].kind === 'brand' ? 'generic' : 'brand'; }],
  ['invented company identity on a neutral symbol', value => { value.records.find(row => row.kind === 'generic').brandId = 'forter'; }],
  ['missing receipt', value => { value.assets.pop(); }],
  ['overlong alias', value => { value.records[0].aliases = ['x'.repeat(257)]; }]
];
for (const [name, mutate] of rejectedMutations) test('the icon build rejects ' + name, () => {
  const changed = structuredClone(input); mutate(changed);
  assert.throws(() => validateSystemIcons(changed));
});

test('reused brand assets match the earlier independent company provenance without alteration', () => {
  const legacy = JSON.parse(read('apps/production-extension/icons/brands/COMPANY-PROVENANCE.json'));
  const byId = new Map(legacy.assets.map(row => [row.id, row]));
  const receipts = new Map(input.assets.map(row => [row.id, row]));
  for (const record of input.records.filter(row => row.asset.startsWith('brands/'))) {
    const previous = byId.get(record.brandId), current = receipts.get(record.id);
    assert.ok(previous, record.id); assert.equal(record.asset, 'brands/' + previous.file);
    assert.equal(current.sha256, previous.sha256); assert.equal(current.bytes, previous.bytes);
    assert.equal(hash(read('apps/production-extension/icons/' + record.asset)), previous.sha256);
  }
});

test('neutral artwork does not claim a company source or borrow a similar company identity', () => {
  const receipts = new Map(input.assets.map(row => [row.id, row]));
  for (const record of input.records.filter(row => row.kind === 'generic')) {
    const receipt = receipts.get(record.id);
    assert.equal(record.brandId, undefined); assert.equal(receipt.sourceUrl, undefined);
    assert.equal(receipt.license, 'Project-authored UI artwork');
    assert.equal(receipt.reason, 'verified-official-artwork-unavailable');
  }
  for (const id of ['transunion', 'adshield']) {
    const record = input.records.find(row => row.id === id);
    assert.ok(record); assert.equal(record.kind, 'generic'); assert.equal(record.asset, 'systems/' + id + '.png');
  }
});

test('parent and renamed product artwork keeps exact system identity and recorded relationship evidence', () => {
  const receipts = new Map(input.assets.map(row => [row.id, row]));
  const records = new Map(input.records.map(row => [row.id, row]));
  for (const [id, brandId] of [['akamai-bot-manager', 'akamai'], ['akamai-page-integrity-manager', 'akamai'],
    ['cloudflare-bot-manager', 'cloudflare'], ['cloudflare-insights', 'cloudflare'], ['cloudflare-turnstile', 'cloudflare']]) {
    assert.equal(records.get(id)?.brandId, brandId); assert.equal(records.get(id)?.id, id);
  }
  for (const [id, hostname] of [['dark-visitors', 'knownagents.com'], ['distil-bot-discovery', 'www.imperva.com'],
    ['distil-identification-block', 'www.imperva.com'], ['perception-point', 'www.fortinet.com'],
    ['perimeterx', 'www.humansecurity.com'], ['white-ops', 'www.humansecurity.com']]) {
    const receipt = receipts.get(id);
    assert.equal(receipt.kind, 'brand'); assert.equal(new URL(receipt.identitySourceUrl).hostname, hostname);
  }
});

test('new normalized PNGs have only bounded raster chunks and no hidden text or attached resources', () => {
  for (const record of input.records.filter(row => row.asset.startsWith('systems/'))) {
    const bytes = read('apps/production-extension/icons/' + record.asset), chunks = [];
    assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(bytes.readUInt32BE(16), 96); assert.equal(bytes.readUInt32BE(20), 96);
    let at = 8;
    while (at < bytes.length) {
      assert.ok(at + 12 <= bytes.length, record.id);
      const length = bytes.readUInt32BE(at), kind = bytes.toString('ascii', at + 4, at + 8);
      assert.ok(at + 12 + length <= bytes.length, record.id);
      assert.ok(['IHDR', 'IDAT', 'IEND'].includes(kind), record.id + ': ' + kind);
      chunks.push(kind); at += 12 + length;
    }
    assert.equal(chunks[0], 'IHDR'); assert.equal(chunks.at(-1), 'IEND');
    assert.equal(chunks.filter(kind => kind === 'IHDR').length, 1);
    assert.equal(chunks.filter(kind => kind === 'IEND').length, 1);
    assert.ok(chunks.includes('IDAT')); assert.equal(at, bytes.length);
  }
});
