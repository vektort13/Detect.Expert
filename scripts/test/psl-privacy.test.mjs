import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Hits, scanString } from '../privacy-checks.mjs';
for (const value of ['10.0.0.1', '172.16.0.1', '172.31.255.2', '192.168.2.3', '169.254.3.4', '[fe80::1]', '[fc00::1]', '[fd12:1234::2]']) {
  test('P01 privacy patterns reject ' + value, () => {
    const hits = new Hits();
    scanString(hits, 'storage', value, []);
    assert.ok(hits.items.some((h) => h.rule === 'private-address'));
  });
}
test('P01 privacy categories are safe', () => {
  const hits = new Hits();
  for (const value of ['loopback', 'link-local', 'private', 'ULA', 'public', 'example.com']) scanString(hits, 'storage', value, []);
  assert.equal(hits.count, 0);
});
