// ADR-020 «Защита» (S06): no module feature can be turned on from the popup or the side panel. The UI typed senders
// go through the real SW router (createBackground over fake-chrome): from popup.html / sidepanel.html the widening
// requests get unauthorized-sender, from options.html they pass. The popup and side-panel sources never call them.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { createBackground } from '../../background/src/index';
import type { MessageSenderLike } from '../../background/src/index';
import { RUNTIME_ID, createFakeChrome } from '../../background/test/fake-chrome';
import { MemoryProtectDb } from '../../background/test/protect/memory-db';
import { ALL_SITES, DNR_PERMISSION, defaultServices } from '../../background/test/protect/support';
import { protectUi } from '../src/messaging';

const here = dirname(fileURLToPath(import.meta.url));
const g = globalThis as { chrome?: unknown };
const original = g.chrome;

function senderFor(page: string): MessageSenderLike {
  return { id: RUNTIME_ID, origin: 'chrome-extension://' + RUNTIME_ID, url: 'chrome-extension://' + RUNTIME_ID + '/' + page };
}

/** Routes the UI's chrome.runtime.sendMessage into the SW listener with the sender Chrome would attach for `page`. */
async function backgroundFor(page: string) {
  const fake = createFakeChrome({ grantedOrigins: ALL_SITES });
  fake.grantPermission(DNR_PERMISSION);
  fake.local.data.set('scope', { v: 1, scopeMode: 'all-sites', hosts: [] });
  const db = new MemoryProtectDb();
  const bg = createBackground(fake, {
    ttlIntervalMs: 0,
    persistDebounceMs: 1,
    protect: { dbFactory: () => db, services: defaultServices([]), dnrTimeoutMs: 50, docStore: { flushMs: 1 } },
  });
  await bg.start();
  await bg.runtime.protect.idle();
  const route = (target: string) => (message: unknown) => new Promise<unknown>((resolve) => {
    bg.onMessage(message, senderFor(target), (response) => resolve(response));
  });
  g.chrome = { runtime: { sendMessage: route(page) } };
  return { fake, bg, switchTo: (target: string) => { g.chrome = { runtime: { sendMessage: route(target) } }; } };
}

afterEach(() => {
  g.chrome = original;
});

describe('widening module actions are Options-only (isOptionsSender)', () => {
  for (const page of ['popup.html', 'popup.html?tabId=7', 'sidepanel.html']) {
    it(page + ': enable and set-settings → unauthorized-sender; the module stays off', async () => {
      const { fake, switchTo } = await backgroundFor(page);
      expect(await protectUi.enable(['value-match', 'firewall'], 'normal')).toEqual({ ok: false, code: 'unauthorized-sender' });
      expect(await protectUi.setSettings({ features: ['value-match', 'gpc'] })).toEqual({ ok: false, code: 'unauthorized-sender' });
      const state = await protectUi.getState();
      expect(state).toMatchObject({ ok: true, response: { state: { state: 'off' } } });
      expect(fake.local.data.has('protect')).toBe(false);
      expect([...fake.registered.keys()].some((id) => id.startsWith('detector-protect'))).toBe(false);
      // The same requests from Options work.
      switchTo('options.html#protect');
      expect(await protectUi.enable(['value-match'], 'normal')).toMatchObject({ ok: true, response: { state: { state: 'active', features: ['value-match'] } } });
      switchTo(page);
      expect(await protectUi.setSettings({ preset: 'strict' })).toEqual({ ok: false, code: 'unauthorized-sender' });
      expect(await protectUi.setSite('example.com', true)).toMatchObject({ ok: true, response: { state: { excludedSites: ['example.com'] } } });
      // Un-excluding a site widens the module again: Options only.
      expect(await protectUi.setSite('example.com', false)).toEqual({ ok: false, code: 'unauthorized-sender' });
    });
  }
});

describe('popup and side-panel sources never send widening requests', () => {
  function sources(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) sources(full, out);
      else if (/\.tsx?$/.test(name)) out.push(full);
    }
    return out;
  }
  const src = join(here, '..', 'src');
  const popupSide = [
    join(src, 'app', 'PopupApp.tsx'),
    join(src, 'app', 'SidepanelApp.tsx'),
    join(src, 'components', 'protect', 'ProtectPopupArea.tsx'),
    join(src, 'components', 'protect', 'ProtectSidepanel.tsx'),
    ...['leaks', 'firewall', 'replay', 'history', 'gpc', 'requests'].flatMap((lane) => sources(join(src, 'components', 'protect', lane))),
  ].filter((file) => !/(?:FirewallRulesPanel|HistorySettings|GpcSection|RequestsOptionsSection|RequestsApp)\.tsx$/.test(file));

  it('no enable / setSettings / setFeatures / setPreset / un-exclude in popup and side-panel code', () => {
    expect(popupSide.length).toBeGreaterThan(8);
    for (const file of popupSide) {
      const text = readFileSync(file, 'utf8');
      for (const pattern of [/\bprotectUi\.(?:enable|setSettings)\b/, /'ui-protect-(?:enable|set-settings)'/, /\.(?:enable|setFeatures|setPreset)\(/, /setSite\([^)]*,\s*false\)/]) {
        expect(pattern.test(text), file + ' ' + String(pattern)).toBe(false);
      }
    }
  });
});
