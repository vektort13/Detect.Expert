// Shared helpers of the module «Защита» unit tests (ADR-020 S04): a controller over fake-chrome + MemoryProtectDb, a
// recording lane service and an API call log for ordering assertions. Test-only; never bundled.

import { ProtectController } from '../../src/protect/controller';
import type { ProtectControllerOptions } from '../../src/protect/controller';
import type { ProtectFeatureService, ProtectServiceContext, ProtectServiceName } from '../../src/protect/services';
import type { MessageSenderLike } from '../../src/chrome-api';
import { RUNTIME_ID, createFakeChrome } from '../fake-chrome';
import type { FakeChrome, FakeChromeOptions } from '../fake-chrome';
import { MemoryProtectDb } from './memory-db';

export const ALL_SITES = ['http://*/*', 'https://*/*'];
export const DNR_PERMISSION = 'declarativeNetRequestWithHostAccess';

export const ENABLED_SETTINGS = {
  v: 1,
  enabled: true,
  consentVersion: 1,
  features: ['value-match', 'firewall', 'session-replay'],
  preset: 'normal',
  snoozeUntil: null,
  historyRetentionDays: 30,
};

export function makeClock(start = 1_000_000): { t: number; now(): number } {
  return {
    t: start,
    now() {
      return this.t;
    },
  };
}

export function optionsSender(path = 'options.html'): MessageSenderLike {
  return { id: RUNTIME_ID, origin: 'chrome-extension://' + RUNTIME_ID, url: 'chrome-extension://' + RUNTIME_ID + '/' + path };
}

export function popupSender(): MessageSenderLike {
  return optionsSender('popup.html');
}

export interface RecordingService extends ProtectFeatureService {
  starts: number;
  stops: string[];
  ctx: ProtectServiceContext | null;
}

/** A lane service that records its lifecycle into `log` (and optionally fails its start). */
export function recordingService(name: ProtectServiceName, features: ProtectFeatureService['features'], log: string[], extra: Partial<ProtectFeatureService> & { failStart?: boolean } = {}): RecordingService {
  const { failStart, ...hooks } = extra;
  const service: RecordingService = {
    name,
    features,
    starts: 0,
    stops: [],
    ctx: null,
    start(ctx) {
      log.push('service.start:' + name);
      if (failStart === true) throw new Error('start failed');
      service.starts++;
      service.ctx = ctx;
    },
    stop(reason) {
      log.push('service.stop:' + name + ':' + reason);
      service.stops.push(reason);
    },
    ...hooks,
  };
  return service;
}

/** Wraps the fake's APIs so every module-relevant call lands in `log` (names only). */
export function instrument(fake: FakeChrome, log: string[]): void {
  const s = fake.scripting;
  const reg = s.registerContentScripts.bind(s);
  const upd = s.updateContentScripts.bind(s);
  const unreg = s.unregisterContentScripts.bind(s);
  s.registerContentScripts = async (scripts) => {
    log.push('scripting.register:' + scripts.map((x) => x.id).join(','));
    return reg(scripts);
  };
  s.updateContentScripts = async (scripts) => {
    log.push('scripting.update:' + scripts.map((x) => x.id).join(','));
    return upd(scripts);
  };
  s.unregisterContentScripts = async (filter) => {
    log.push('scripting.unregister:' + (filter?.ids ?? ['*']).join(','));
    return unreg(filter);
  };
  for (const [name, event] of Object.entries(fake.webRequestEvents)) {
    const add = event.addListener.bind(event);
    const remove = event.removeListener.bind(event);
    event.addListener = (cb, filter, extra) => {
      log.push('webRequest.add:' + name + (filter.tabId === undefined ? '' : ':tab' + String(filter.tabId)) + (extra !== undefined && extra.length > 0 ? ':' + extra.join('+') : ''));
      add(cb, filter, extra);
    };
    event.removeListener = (cb) => {
      log.push('webRequest.remove:' + name);
      remove(cb);
    };
  }
  const dnr = fake.dnr;
  const ud = dnr.updateDynamicRules.bind(dnr);
  const us = dnr.updateSessionRules.bind(dnr);
  dnr.updateDynamicRules = (o) => {
    log.push('dnr.updateDynamic');
    return ud(o);
  };
  dnr.updateSessionRules = (o) => {
    log.push('dnr.updateSession');
    return us(o);
  };
  const lset = fake.local.set.bind(fake.local);
  fake.local.set = async (items) => {
    log.push('local.set:' + Object.keys(items).join(','));
    return lset(items);
  };
  const lrem = fake.local.remove.bind(fake.local);
  fake.local.remove = async (keys) => {
    log.push('local.remove:' + (Array.isArray(keys) ? keys : [keys]).join(','));
    return lrem(keys);
  };
  const send = fake.tabs.sendMessage.bind(fake.tabs);
  fake.tabs.sendMessage = async (tabId, message, options) => {
    log.push('tabs.send:' + String((message as { type?: string }).type) + ':' + String((message as { command?: string }).command));
    return send(tabId, message, options);
  };
}

export interface ControllerSetup {
  fake: FakeChrome;
  clock: { t: number; now(): number };
  db: MemoryProtectDb;
  dbCreated: () => number;
  controller: ProtectController;
  log: string[];
  services: RecordingService[];
}

export interface ControllerSetupOptions {
  chrome?: FakeChromeOptions;
  settings?: unknown;
  services?: (log: string[]) => RecordingService[];
  controller?: Partial<ProtectControllerOptions>;
  load?: boolean;
}

/** Default lanes: one recording service per lane (features as in the foundation stubs). */
export function defaultServices(log: string[]): RecordingService[] {
  return [
    recordingService('value-match', ['value-match'], log),
    recordingService('firewall', ['firewall'], log),
    recordingService('attribution', ['value-match', 'firewall', 'session-replay'], log),
    recordingService('replay', ['session-replay'], log),
    recordingService('history', ['history'], log),
    recordingService('gpc', ['gpc'], log),
    recordingService('requests', 'module', log),
  ];
}

export async function setupController(options: ControllerSetupOptions = {}): Promise<ControllerSetup> {
  const fake = createFakeChrome(options.chrome ?? {});
  if (options.settings !== undefined) fake.local.data.set('protect', options.settings);
  const clock = makeClock();
  const db = new MemoryProtectDb();
  let created = 0;
  const log: string[] = [];
  const services = (options.services ?? defaultServices)(log);
  instrument(fake, log);
  const controller = new ProtectController(fake, {
    clock,
    dbFactory: () => {
      created++;
      log.push('db.create');
      return db;
    },
    services,
    dnrTimeoutMs: 50,
    docStore: { flushMs: 1 },
    ...(options.controller ?? {}),
  });
  if (options.load !== false) await controller.load();
  return { fake, clock, db, dbCreated: () => created, controller, log, services };
}

export async function settleProtect(ms = 5): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}
