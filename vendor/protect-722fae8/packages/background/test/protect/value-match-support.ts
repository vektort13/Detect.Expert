// Test-only helpers of the value-match lane (S07): a controller with the real value-match service over fake-chrome,
// page senders, protect-input messages keyed with the SW salt (engine computeFieldFingerprints, as protect.js does)
// and webRequest events. Never bundled.

import { createHash } from 'node:crypto';
import type { FieldKind, ProtectAck, ProtectFieldFingerprint, ProtectProjection, ProtectTransferEvidence, SubmitSignal } from '@detect-expert/contracts';
import { computeFieldFingerprints } from '@detect-expert/engine';
import type { RequestDetailsLike } from '../../src/chrome-api';
import type { ProtectFeatureService } from '../../src/protect/services';
import { createValueMatchService } from '../../src/protect/value-match/index';
import type { PageSenderContext } from '../../src/sender';
import { committed } from '../fake-chrome';
import { ALL_SITES, ENABLED_SETTINGS, setupController, settleProtect } from './support';
import type { ControllerSetup, RecordingService } from './support';

export const TOP_DOC = 'DOC000000000000000000000000000001';
export const SITE_HOST = 'www.shop-site.com';
export const CANARY_EMAIL = 'canary.vm-7d1e@mail-example.com';
export const CANARY_PHONE = '+7 912 555-01-37';
export const CANARY_NAME = 'Eleonora Vasilchikova';

let seed = 1;
/** Deterministic random bytes (salts differ between services). */
export function seededRandom(start = seed++ * 7919): (n: number) => Uint8Array {
  let x = start;
  return (n) => {
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      x = (Math.imul(x, 1103515245) + 12345) >>> 0;
      out[i] = x >>> 24;
    }
    return out;
  };
}

export interface VmSetup extends ControllerSetup {
  vm: ProtectFeatureService;
}

export async function setupValueMatch(features: string[] = ['value-match'], random = seededRandom()): Promise<VmSetup> {
  const vm = createValueMatchService({ random });
  const s = await setupController({
    chrome: { grantedOrigins: ALL_SITES },
    settings: { ...ENABLED_SETTINGS, features },
    services: () => [vm as unknown as RecordingService],
  });
  return { ...s, vm };
}

export function pageCtx(over: Partial<PageSenderContext> = {}): PageSenderContext {
  return { tabId: 7, frameId: 0, documentId: TOP_DOC, documentKey: '7:0:' + TOP_DOC, host: SITE_HOST, originPattern: 'https://' + SITE_HOST + '/*', documentLifecycle: 'active', frameType: null, ...over };
}

/** Top-level commit of tab 7 (the module learns the tab's site and top document). */
export function commitTop(s: ControllerSetup, url = 'https://' + SITE_HOST + '/form', documentId = TOP_DOC, tabId = 7): void {
  s.controller.onCommitted(committed({ tabId, url, documentId }));
}

export async function hello(s: ControllerSetup, ctx: PageSenderContext = pageCtx()): Promise<ProtectAck> {
  return (await s.controller.onPageMessage(ctx, { schemaVersion: 1, type: 'protect-hello', startedLate: false })) as unknown as ProtectAck;
}

export interface InputSpec {
  kind: FieldKind;
  value: string;
  fieldRef?: number;
  trigger?: ProtectFieldFingerprint['trigger'];
}

let seq = 0;
export async function input(s: ControllerSetup, ack: ProtectAck, fields: InputSpec[], opts: { ctx?: PageSenderContext; submit?: SubmitSignal; saltId?: string; neverReadFields?: number; paymentSuspended?: boolean } = {}): Promise<ProtectAck> {
  const salt = ack.salt!;
  const message = {
    schemaVersion: 1,
    type: 'protect-input',
    saltId: opts.saltId ?? ack.saltId!,
    seq: ++seq,
    fields: fields.map((f, i) => ({ fieldRef: f.fieldRef ?? i + 1, fieldKind: f.kind, trigger: f.trigger ?? 'input', entries: computeFieldFingerprints(f.kind, f.value, salt) })),
    submit: opts.submit ?? 'none',
    neverReadFields: opts.neverReadFields ?? 0,
    paymentSuspended: opts.paymentSuspended ?? false,
  };
  return (await s.controller.onPageMessage(opts.ctx ?? pageCtx(), message)) as unknown as ProtectAck;
}

let rid = 0;
export function request(over: Partial<RequestDetailsLike> & { body?: string | Uint8Array; form?: Record<string, string[]> } = {}): RequestDetailsLike {
  const { body, form, ...rest } = over;
  let requestBody: RequestDetailsLike['requestBody'];
  if (form !== undefined) requestBody = { formData: form };
  else if (body !== undefined) {
    const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : body;
    requestBody = { raw: [{ bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer }] };
  }
  return {
    tabId: 7,
    frameId: 0,
    documentId: TOP_DOC,
    url: 'https://px.tracker.example.net/tr',
    type: 'xmlhttprequest',
    timeStamp: Date.now(),
    method: body !== undefined || form !== undefined ? 'POST' : 'GET',
    requestId: 'req-' + String(++rid),
    initiator: 'https://' + SITE_HOST,
    ...(requestBody !== undefined ? { requestBody } : {}),
    ...rest,
  };
}

/** onBeforeRequest of the armed tab (through net-hub, as Chrome would call it). */
export function emitRequest(s: ControllerSetup, details: RequestDetailsLike): RequestDetailsLike {
  s.fake.webRequestEvents.beforeRequest.emit(details);
  return details;
}

export function emitSent(s: ControllerSetup, details: RequestDetailsLike): void {
  s.fake.webRequestEvents.sendHeaders.emit({ ...details, requestBody: undefined });
}

export function report(s: ControllerSetup, tabId = 7): ProtectProjection {
  const r = s.controller.getReport(tabId);
  if (r === null) throw new Error('no protect report for tab ' + String(tabId));
  return r;
}

export function transfers(s: ControllerSetup, tabId = 7): ProtectTransferEvidence[] {
  return report(s, tabId).evidence.filter((e): e is ProtectTransferEvidence => e.protectKind === 'value-match' || e.protectKind === 'opaque-after-input');
}

export function sha256Hex(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

/** Base64 without padding (a substring of the padded form, so it finds both) and base64url (no padding). */
function base64Forms(bytes: Buffer): string[] {
  return [bytes.toString('base64').replace(/=+$/, ''), bytes.toString('base64url')];
}

/**
 * A value and its variants: none may appear anywhere stored. Plain, URL-encoded, Base64 and base64url (unpadded
 * forms: they also find the padded ones), and the md5 / sha1 / sha256 / sha512 hashes as hex, Base64 and base64url.
 */
export function canaryVariants(value: string): string[] {
  const out = new Set<string>([value, encodeURIComponent(value)]);
  for (const v of [value, value.trim().toLowerCase()]) {
    out.add(v);
    for (const f of base64Forms(Buffer.from(v, 'utf8'))) out.add(f);
    for (const algo of ['md5', 'sha1', 'sha256', 'sha512']) {
      const digest = createHash(algo).update(v, 'utf8').digest();
      out.add(digest.toString('hex'));
      for (const f of base64Forms(digest)) out.add(f);
    }
  }
  return [...out];
}

export function findCanaries(text: string, values: readonly string[]): string[] {
  const hits: string[] = [];
  for (const v of values) for (const variant of canaryVariants(v)) if (text.includes(variant)) hits.push(variant.slice(0, 12));
  return hits;
}

export { settleProtect };
