// P10 / REQ-007/010/013: public release copy must keep product claims and disclosure aligned.
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(path, 'utf8');
const publicPaths = ['PRIVACY.md', 'docs/release/STORE_LISTING.md', 'NOTICE'];
describe('release disclosures', () => {
  it.each(publicPaths)('%s excludes prohibited product claims', (path) => {
    const copy = read(path).toLowerCase();
    const forbidden = [...read('docs/ui-copy.md').split('## 8.')[1]!.split('## 9.')[0]!.matchAll(/«([^»]+)»/g)].map((m) => m[1]!);
    for (const claim of forbidden) expect(copy).not.toContain(claim.toLowerCase());
    for (const claim of ['защищает', 'анонимизирует', 'доказывает', 'detects all trackers', 'site is safe', 'protects against leaks']) expect(copy).not.toContain(claim);
  });
  it('both locales disclose every actual permission and optional host pattern', () => {
    const listing = read('docs/release/STORE_LISTING.md');
    const manifest = JSON.parse(read('apps/extension/permissions.allowlist.json')) as { permissions: string[]; optional_host_permissions: string[] };
    for (const locale of [listing.split('## Русский')[1]!.split('## English')[0]!, listing.split('## English')[1]!]) {
      for (const permission of [...manifest.permissions, ...manifest.optional_host_permissions]) expect(locale).toContain('`' + permission + '`');
      expect(locale).toContain('fixtures/index.html');
      expect(locale).toContain('Limited Use / Disclosure');
      expect(locale).toContain('PRIVACY.md');
    }
  });
  it('privacy policy describes persisted preferences, event-driven retention and explicit host export in both locales', () => {
    const policy = read('PRIVACY.md');
    for (const locale of [policy.split('## Русский')[1]!.split('## English')[0]!, policy.split('## English')[1]!]) {
      for (const term of ['chrome.storage.session', 'chrome.storage.local', 'scope: {v, scopeMode, hosts}', '100 KiB', '4 MiB', 'preview']) expect(locale).toContain(term);
    }
    expect(policy).toContain('при следующем событии');
    expect(policy).toContain('at the next extension event');
    expect(policy).toContain('Host исключён по умолчанию');
    expect(policy).toContain('Host is excluded by default');
  });
  it('reviewer HTTP fixture paths exist in the repository', () => {
    const paths = [...read('docs/release/STORE_LISTING.md').matchAll(/http:\/\/127\.0\.0\.1:4173\/([a-z0-9/.-]+\.html)/g)];
    expect(paths.length).toBeGreaterThanOrEqual(6);
    for (const match of paths) expect(existsSync('fixtures/' + match[1])).toBe(true);
  });
});
