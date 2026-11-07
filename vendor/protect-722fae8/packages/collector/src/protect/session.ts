// ISOLATED lifecycle of the module «Защита» in one document (ADR-020 §A, §4, §8; S05). protect.js is registered only
// while the user has the module on; even then nothing is read before the SW answers `protect-hello` with
// `protect-ack {active: true}` (an excluded site, a stopped module or an invalid answer stop everything here).
// Trusted events only (`isTrusted`): focusin arms the tab's body listener (protect-arm), input marks a tracked field
// dirty (debounce), focusout / submit / a submit control / pagehide flush. Every flush reads the value through
// field-value.ts (the single audited reader) — only while the SW ack carries a salt (value-match on; S07) —, keys its
// fingerprints with that salt (engine protect/match) and
// keeps only a 32-bit FNV of the last value for dedup. protect-input carries fingerprints, a submit signal and two
// counters: never a value. Bounds: ≤ 8 fields per document, ≤ 4 fields and ≤ 16 KiB per message, ≤ 4 messages/s;
// a failed sendMessage is not retried. Coordinates, key data and the text of clicked controls are never read.

import { MAX_COUNT, PROTECT_BUDGETS, PROTECT_WIRE_LIMITS, jsonLengthUpTo, validateProtectAck, validateProtectControl } from '@detect-expert/contracts';
import type {
  FieldKind,
  FingerprintTrigger,
  ProtectArmMessage,
  ProtectFieldFingerprint,
  ProtectFingerprintEntry,
  ProtectHelloMessage,
  ProtectInputMessage,
  SubmitSignal,
} from '@detect-expert/contracts';
import { computeFieldFingerprints } from '../../../engine/src/protect/match/index';
import { EverPasswordTracker, asFieldElement, classify, isPaymentControl } from './classify';
import type { FieldElementLike } from './classify';
import type { ProtectEnv, ProtectEvent, ProtectTimer, ProtectWindowEvent } from './env';
import { readTrackedValue } from './field-value';
import { validatedValue } from './validated';
import type { FieldValueElement, ReadContext } from './field-value';

/** Controls whose click inside a form counts as a submit boundary (`submit-control`); never their text. */
export const SUBMIT_CONTROL_SELECTOR = 'button, input[type=submit], input[type=image], [role=button]';
export const SUBMIT_CONTROL_INTERVAL_MS = 1000;
export const INPUT_MESSAGES_PER_SECOND = 4;
/** Form controls scanned for a payment field per read (attributes only). */
export const PAYMENT_SCAN_LIMIT = 256;

export interface ProtectSessionOptions {
  /** First active ack: the MAIN group mask of this document (the relay starts only when it is not 0). */
  onActive?(groups: number): void;
  /** SW protect-control pause / resume (the relay follows). */
  onPause?(paused: boolean): void;
  /** The module stopped in this document (ack inactive, control stop, context gone). */
  onStop?(): void;
  /** Keyed fingerprints of one value (engine S07). Injectable for tests; the default is the engine function. */
  fingerprints?(fieldKind: FieldKind, value: string, salt: string): ProtectFingerprintEntry[];
}

export type ProtectSessionState = 'starting' | 'active' | 'stopped';

/** Numbers only (tests, diagnostics): never a value, a hash or a fingerprint. */
export interface ProtectSessionSnapshot {
  state: ProtectSessionState;
  paused: boolean;
  trackedFields: number;
  dirtyFields: number;
  pendingFields: number;
  neverReadFields: number;
  paymentSuspended: boolean;
  hasSalt: boolean;
  groups: number;
  seq: number;
  sent: number;
  sendFailures: number;
}

interface TrackedField {
  readonly ref: number;
  fieldKind: FieldKind;
  readonly element: WeakRef<FieldValueElement>;
  dirty: boolean;
  /** The field turned out never-read (e.g. its type became password): it is never read again. */
  never: boolean;
  /** FNV-1a 32 of the last value read and the salt its fingerprints were keyed with (dedup only, memory only). */
  lastHash: number | null;
  lastSaltId: string | null;
}

interface ReadResult {
  hash: number;
  entries: ProtectFingerprintEntry[] | null;
}

const SUBMIT_RANK: Readonly<Record<SubmitSignal, number>> = { none: 0, 'submit-control': 1, 'submit-event': 2 };

/** FNV-1a over UTF-16 code units (dedup of the last value; never leaves this document's memory). */
export function fnv1a32(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function hasClosest(target: unknown): target is { closest(selector: string): unknown } {
  return typeof target === 'object' && target !== null && typeof (target as { closest?: unknown }).closest === 'function';
}

function isConnected(el: object): boolean {
  return (el as { isConnected?: unknown }).isConnected === true;
}

export class ProtectSession {
  private state: ProtectSessionState = 'starting';
  private paused = false;
  private startedLate = false;
  private groups = 0;
  private salt: string | null = null;
  private saltId: string | null = null;
  private seq = 0;
  private sent = 0;
  private sendFailures = 0;
  private neverReadFields = 0;
  private paymentSuspended = false;
  /** The counters or the payment flag changed since the last protect-input. */
  private stateDirty = false;
  private pendingSubmit: SubmitSignal = 'none';
  private readonly pendingFields = new Map<number, ProtectFieldFingerprint>();
  private readonly fields: TrackedField[] = [];
  private readonly byElement = new WeakMap<object, TrackedField>();
  private readonly countedNever = new WeakSet<object>();
  private readonly sendTimes: number[] = [];
  private readonly removers: (() => void)[] = [];
  private readonly tracker: EverPasswordTracker;
  private readonly readCtx: ReadContext;
  private readonly fingerprints: (fieldKind: FieldKind, value: string, salt: string) => ProtectFingerprintEntry[];
  private debounceTimer: ProtectTimer | null = null;
  private drainTimer: ProtectTimer | null = null;
  private lastArmAt = Number.NEGATIVE_INFINITY;
  private lastSubmitControlAt = Number.NEGATIVE_INFINITY;
  private activated = false;
  private rekeyPending = false;

  constructor(
    private readonly env: ProtectEnv,
    private readonly options: ProtectSessionOptions = {},
  ) {
    // The type observer starts with the session (document_start), so an early "show password" toggle is seen.
    this.tracker = new EverPasswordTracker((callback) => env.observeTypeAttributes(callback));
    this.readCtx = { tracker: this.tracker, documentHasPaymentField: () => this.documentHasPaymentField() };
    this.fingerprints = options.fingerprints ?? computeFieldFingerprints;
  }

  /** Listeners first (events before the ack only mark fields dirty), then protect-hello. */
  start(): void {
    if (this.state !== 'starting' || this.removers.length > 0) return;
    this.startedLate = this.env.readyState() !== 'loading';
    const on = (type: ProtectWindowEvent, handler: (event: ProtectEvent) => void): void => {
      this.removers.push(this.env.listen(type, (event) => this.guard(() => handler(event))));
    };
    on('focusin', (e) => this.onFocusIn(e));
    on('input', (e) => this.onInput(e));
    on('focusout', (e) => this.onFocusOut(e));
    on('submit', (e) => this.onSubmit(e));
    on('click', (e) => this.onClick(e));
    on('pagehide', (e) => this.onPageHide(e));
    this.removers.push(this.env.onControl((fromServiceWorker, data) => this.guard(() => this.onControl(fromServiceWorker, data))));
    // A prerendered document says hello once it is shown: the SW decides on the tab's top-level site from
    // MessageSender.tab.url, which during prerendering belongs to another page (it answers inactive then). Nothing is
    // typed into a page that is not shown yet.
    if (this.isPrerendering() && this.env.onActivation !== undefined) {
      let sent = false;
      this.removers.push(this.env.onActivation(() => this.guard(() => {
        if (sent || this.state !== 'starting') return;
        sent = true;
        this.sendHello();
      })));
      return;
    }
    this.sendHello();
  }

  private isPrerendering(): boolean {
    try {
      return this.env.prerendering?.() === true;
    } catch {
      return false;
    }
  }

  /** Full stop: listeners, observer and timers go; nothing is read or sent afterwards. */
  stop(): void {
    if (this.state === 'stopped') return;
    this.state = 'stopped';
    for (const remove of this.removers.splice(0)) {
      try {
        remove();
      } catch {
        // A listener that cannot be removed only sees `stopped` and returns.
      }
    }
    this.tracker.stop();
    this.clearDebounce();
    if (this.drainTimer !== null) this.env.clearTimer(this.drainTimer);
    this.drainTimer = null;
    this.pendingFields.clear();
    this.pendingSubmit = 'none';
    this.stateDirty = false;
    for (const field of this.fields) field.dirty = false;
    try {
      this.options.onStop?.();
    } catch {
      // The relay stops itself on its own errors.
    }
  }

  snapshot(): ProtectSessionSnapshot {
    return {
      state: this.state,
      paused: this.paused,
      trackedFields: this.fields.length,
      dirtyFields: this.fields.filter((f) => f.dirty).length,
      pendingFields: this.pendingFields.size,
      neverReadFields: this.neverReadFields,
      paymentSuspended: this.paymentSuspended,
      hasSalt: this.saltId !== null,
      groups: this.groups,
      seq: this.seq,
      sent: this.sent,
      sendFailures: this.sendFailures,
    };
  }

  // ---------------------------------------------------------------------------
  // SW channel
  // ---------------------------------------------------------------------------

  private guard(fn: () => void): void {
    try {
      fn();
    } catch {
      // Never throw into the page's event loop; a failed step only loses that observation.
    }
  }

  private sendHello(): void {
    const hello: ProtectHelloMessage = { schemaVersion: 1, type: 'protect-hello', startedLate: this.startedLate };
    this.env.sendToBackground(hello).then(
      (raw) => this.guard(() => this.onHelloAck(raw)),
      () => this.guard(() => this.onSendFailed(true)),
    );
  }

  private onSendFailed(fatal: boolean): void {
    this.sendFailures = Math.min(MAX_COUNT, this.sendFailures + 1);
    // No retry. Without an answer to the hello, or once the extension context is gone, the module is not active here.
    if (fatal || !this.env.isContextAlive()) this.stop();
  }

  private onHelloAck(raw: unknown): void {
    if (this.state === 'stopped') return;
    const r = validateProtectAck(raw);
    if (!r.ok) {
      this.stop(); // fail closed: an answer we cannot read is not an activation
      return;
    }
    const ack = validatedValue(r);
    if (!ack.active) {
      this.stop();
      return;
    }
    const wasActive = this.state === 'active';
    this.state = 'active';
    this.groups = ack.groups;
    const rekey = this.rekeyPending;
    this.rekeyPending = false;
    // S07 (FOLLOWUPS 89): the answer to a hello is authoritative about the salt. Without one the value-match feature
    // is off: the salt and every fingerprint still queued under it go, and nothing is read until a salt comes back.
    if (ack.saltId === undefined || ack.salt === undefined) this.dropSalt();
    const saltChanged = this.adoptSalt(ack.saltId, ack.salt);
    if (!wasActive && !this.activated) {
      this.activated = true;
      try {
        this.options.onActive?.(ack.groups);
      } catch {
        // The relay is optional: the session works without it.
      }
    }
    if (rekey || (wasActive && saltChanged)) this.rereadAll();
    else if (this.fields.some((f) => f.dirty)) this.scheduleDebounce();
    this.drain();
  }

  /** Answer to protect-arm / protect-input: inactive -> stop; a new salt -> re-key the fields once. */
  private onAck(raw: unknown): void {
    if (this.state !== 'active') return;
    const r = validateProtectAck(raw);
    if (!r.ok) return;
    const ack = validatedValue(r);
    if (!ack.active) {
      this.stop();
      return;
    }
    // A throttled answer carries no salt: the current salt stays (it is only replaced, never cleared, here).
    if (this.adoptSalt(ack.saltId, ack.salt)) {
      this.rereadAll();
      this.drain();
    }
  }

  private dropSalt(): void {
    this.salt = null;
    this.saltId = null;
    this.pendingFields.clear();
    for (const field of this.fields) field.lastSaltId = null;
  }

  /** True when a salt different from the current one was adopted. */
  private adoptSalt(saltId: string | undefined, salt: string | undefined): boolean {
    if (saltId === undefined || salt === undefined || saltId === this.saltId) return false;
    this.saltId = saltId;
    this.salt = salt;
    return true;
  }

  private onControl(fromServiceWorker: boolean, data: unknown): void {
    if (!fromServiceWorker || this.state === 'stopped') return;
    const r = validateProtectControl(data);
    if (!r.ok) return;
    const control = validatedValue(r);
    switch (control.command) {
      case 'stop':
        this.stop();
        return;
      case 'pause':
        this.setPaused(true);
        return;
      case 'resume':
        this.setPaused(false);
        return;
      case 'rekey':
        // The SW has a new salt (SW restart): fetch it with the same hello, then re-read the fields once.
        if (this.state !== 'active') return;
        this.rekeyPending = true;
        this.sendHello();
        return;
    }
  }

  private setPaused(paused: boolean): void {
    if (this.paused === paused) return;
    this.paused = paused;
    if (paused) this.clearDebounce();
    try {
      this.options.onPause?.(paused);
    } catch {
      // The relay follows on its own.
    }
    if (!paused) {
      if (this.fields.some((f) => f.dirty)) this.scheduleDebounce();
      this.drain();
    }
  }

  private send(message: ProtectArmMessage | ProtectInputMessage): void {
    this.sent = Math.min(MAX_COUNT, this.sent + 1);
    this.env.sendToBackground(message).then(
      (raw) => this.guard(() => this.onAck(raw)),
      () => this.guard(() => this.onSendFailed(false)),
    );
  }

  // ---------------------------------------------------------------------------
  // Trusted page events (capture, passive). Before the active ack only bookkeeping happens: no read, no message.
  // ---------------------------------------------------------------------------

  private live(e: ProtectEvent): boolean {
    return e.isTrusted && this.state !== 'stopped' && !this.paused;
  }

  private onFocusIn(e: ProtectEvent): void {
    if (!this.live(e)) return;
    const el = asFieldElement(e.target);
    if (el === null) return;
    this.tracker.note(el);
    const fieldKind = this.noteControl(el);
    if (fieldKind === null || this.state !== 'active') return;
    const now = this.env.now();
    if (now - this.lastArmAt < PROTECT_BUDGETS.armThrottleMs) return;
    this.lastArmAt = now;
    this.send({ schemaVersion: 1, type: 'protect-arm', fieldKind });
  }

  private onInput(e: ProtectEvent): void {
    if (!this.live(e)) return;
    const el = asFieldElement(e.target);
    if (el === null) return;
    const fieldKind = this.noteControl(el);
    if (fieldKind === null) return;
    const field = this.track(el as FieldValueElement, fieldKind);
    if (field === null || field.never) return;
    field.dirty = true;
    if (this.state === 'active') this.scheduleDebounce();
  }

  private onFocusOut(e: ProtectEvent): void {
    if (!this.live(e) || this.state !== 'active') return;
    const el = asFieldElement(e.target);
    if (el === null) return;
    const field = this.byElement.get(el);
    if (field === undefined || !field.dirty) return;
    this.readField(field, 'blur');
    this.drain();
  }

  private onSubmit(e: ProtectEvent): void {
    if (!this.live(e)) return;
    // Values first, then the boundary (the last protect-input of this flush carries it).
    this.flushDirty('submit');
    this.raiseSubmit('submit-event');
    this.drain();
  }

  private onClick(e: ProtectEvent): void {
    if (!this.live(e) || !hasClosest(e.target)) return;
    const control = e.target.closest(SUBMIT_CONTROL_SELECTOR);
    if (!hasClosest(control) || control.closest('form') === null) return;
    const now = this.env.now();
    if (now - this.lastSubmitControlAt < SUBMIT_CONTROL_INTERVAL_MS) return;
    this.lastSubmitControlAt = now;
    this.flushDirty('submit');
    this.raiseSubmit('submit-control');
    this.drain();
  }

  private onPageHide(e: ProtectEvent): void {
    if (!this.live(e)) return;
    // The pending debounce is flushed now: the document may never get another task.
    this.flushDirty('input');
    this.drain();
  }

  /**
   * Classification bookkeeping of a focused / edited control: never-read fields are counted (saturating), a payment
   * control suspends reading in this document. Returns the kind of a tracked field, else null.
   */
  private noteControl(el: FieldElementLike): FieldKind | null {
    if (isPaymentControl(el)) this.notePayment();
    const cls = classify(el, this.tracker);
    if (cls === null) return null;
    if ('never' in cls) {
      this.countNever(el);
      if (cls.never === 'payment') this.notePayment();
      return null;
    }
    return cls.kind;
  }

  private countNever(el: object): void {
    if (this.countedNever.has(el)) return;
    this.countedNever.add(el);
    if (this.neverReadFields >= PROTECT_WIRE_LIMITS.maxNeverReadFields) return;
    this.neverReadFields++;
    this.stateDirty = true;
  }

  private notePayment(): void {
    if (this.paymentSuspended) return;
    this.paymentSuspended = true;
    this.stateDirty = true;
    // Nothing that is still pending may be sent with a value read before the suspension was known.
    for (const field of this.fields) field.dirty = false;
    this.pendingFields.clear();
  }

  private documentHasPaymentField(): boolean {
    if (this.paymentSuspended) return true;
    for (const el of this.env.formControls(PAYMENT_SCAN_LIMIT)) {
      if (isPaymentControl(el)) {
        this.notePayment();
        return true;
      }
    }
    return false;
  }

  /** Field slot 1..maxTrackedFieldsPerDocument (WeakMap per element); null once all slots are taken. */
  private track(el: FieldValueElement, fieldKind: FieldKind): TrackedField | null {
    const known = this.byElement.get(el);
    if (known !== undefined) {
      known.fieldKind = fieldKind;
      return known;
    }
    if (this.fields.length >= PROTECT_BUDGETS.maxTrackedFieldsPerDocument) return null;
    const field: TrackedField = { ref: this.fields.length + 1, fieldKind, element: new WeakRef(el), dirty: false, never: false, lastHash: null, lastSaltId: null };
    this.fields.push(field);
    this.byElement.set(el, field);
    return field;
  }

  // ---------------------------------------------------------------------------
  // Reads and protect-input
  // ---------------------------------------------------------------------------

  private scheduleDebounce(): void {
    this.clearDebounce();
    this.debounceTimer = this.env.setTimer(() => {
      this.debounceTimer = null;
      this.guard(() => {
        this.flushDirty('input');
        this.drain();
      });
    }, PROTECT_BUDGETS.inputDebounceMs);
  }

  private clearDebounce(): void {
    if (this.debounceTimer !== null) this.env.clearTimer(this.debounceTimer);
    this.debounceTimer = null;
  }

  private flushDirty(trigger: FingerprintTrigger): void {
    this.clearDebounce();
    if (this.state !== 'active' || this.paused) return;
    for (const field of this.fields) if (field.dirty) this.readField(field, trigger);
  }

  /** Once per rekey: every tracked field still in the document is read again under the new salt. */
  private rereadAll(): void {
    if (this.state !== 'active' || this.paused) return;
    this.clearDebounce();
    for (const field of this.fields) {
      const el = field.element.deref();
      if (el === undefined || field.never || !isConnected(el)) continue;
      this.readField(field, 'rekey');
    }
  }

  private readField(field: TrackedField, trigger: FingerprintTrigger): void {
    if (this.state !== 'active' || this.paused) return;
    // S07 (FOLLOWUPS 89): without the SW salt (the value-match feature is off) no value is read at all. The field
    // stays dirty; a salt that arrives later re-reads every tracked field once (adoptSalt → rereadAll).
    if (this.salt === null || this.saltId === null) return;
    field.dirty = false;
    const el = field.element.deref();
    if (el === undefined || field.never) return;
    const saltId = this.saltId;
    const salt = this.salt;
    const outcome = readTrackedValue<ReadResult>(el, this.readCtx, (fieldKind, typed) => {
      const hash = fnv1a32(typed);
      if (trigger !== 'rekey' && hash === field.lastHash && saltId === field.lastSaltId) return { hash, entries: null };
      return { hash, entries: salt === null ? [] : this.fingerprints(fieldKind, typed, salt) };
    });
    switch (outcome.status) {
      case 'read': {
        const { fieldKind, result } = outcome;
        field.fieldKind = fieldKind;
        field.lastHash = result.hash;
        field.lastSaltId = saltId;
        const entries = result.entries;
        // Before S07 (or without a salt) there are no fingerprints: nothing about the value is queued.
        if (saltId === null || entries === null || entries.length === 0) return;
        this.pendingFields.delete(field.ref);
        this.pendingFields.set(field.ref, { fieldRef: field.ref, fieldKind, trigger, entries: entries.slice(0, PROTECT_BUDGETS.maxVariantsPerField) });
        return;
      }
      case 'never':
        field.never = true;
        field.lastHash = null;
        this.pendingFields.delete(field.ref);
        this.countNever(el);
        return;
      case 'payment-suspended':
        this.notePayment();
        return;
      case 'not-tracked':
      case 'rejected-shape':
        return;
    }
  }

  private raiseSubmit(signal: SubmitSignal): void {
    if (SUBMIT_RANK[signal] > SUBMIT_RANK[this.pendingSubmit]) this.pendingSubmit = signal;
  }

  private hasWork(): boolean {
    return this.pendingFields.size > 0 || this.pendingSubmit !== 'none' || this.stateDirty;
  }

  /** Sliding one-second window of protect-input sends (≤ INPUT_MESSAGES_PER_SECOND). */
  private takeSendSlot(now: number): number {
    while (this.sendTimes.length > 0 && now - this.sendTimes[0]! >= 1000) this.sendTimes.shift();
    if (this.sendTimes.length < INPUT_MESSAGES_PER_SECOND) {
      this.sendTimes.push(now);
      return 0;
    }
    return Math.max(1, this.sendTimes[0]! + 1000 - now);
  }

  /** Sends pending fingerprints, the submit boundary and the counters as protect-input within the budgets. */
  private drain(): void {
    if (this.state !== 'active' || this.paused || this.saltId === null) return;
    while (this.hasWork()) {
      const wait = this.takeSendSlot(this.env.now());
      if (wait > 0) {
        if (this.drainTimer === null) {
          this.drainTimer = this.env.setTimer(() => {
            this.drainTimer = null;
            this.guard(() => this.drain());
          }, wait);
        }
        return;
      }
      const message = this.nextInputMessage(this.saltId);
      this.send(message);
    }
  }

  /** ≤ maxFieldsPerInputMessage fields and ≤ maxInputMessageBytes; the submit signal rides on the last message. */
  private nextInputMessage(saltId: string): ProtectInputMessage {
    const fields: ProtectFieldFingerprint[] = [];
    for (const [ref, field] of this.pendingFields) {
      if (fields.length >= PROTECT_BUDGETS.maxFieldsPerInputMessage) break;
      fields.push(field);
      this.pendingFields.delete(ref);
    }
    this.seq = Math.min(MAX_COUNT, this.seq + 1);
    const build = (): ProtectInputMessage => ({
      schemaVersion: 1,
      type: 'protect-input',
      saltId,
      seq: this.seq,
      fields,
      submit: this.pendingFields.size === 0 ? this.pendingSubmit : 'none',
      neverReadFields: this.neverReadFields,
      paymentSuspended: this.paymentSuspended,
    });
    let message = build();
    // Over the byte budget (only possible with long variants): return fields to the queue until it fits.
    while (fields.length > 1 && jsonLengthUpTo(message, PROTECT_BUDGETS.maxInputMessageBytes) > PROTECT_BUDGETS.maxInputMessageBytes) {
      const back = fields.pop()!;
      this.pendingFields.set(back.fieldRef, back);
      message = build();
    }
    if (fields.length === 1 && jsonLengthUpTo(message, PROTECT_BUDGETS.maxInputMessageBytes) > PROTECT_BUDGETS.maxInputMessageBytes) {
      // One field alone does not fit: its entries are cut to fit rather than sending an invalid message.
      const only = fields[0]!;
      while (only.entries.length > 1 && jsonLengthUpTo(message, PROTECT_BUDGETS.maxInputMessageBytes) > PROTECT_BUDGETS.maxInputMessageBytes) {
        only.entries = only.entries.slice(0, Math.max(1, only.entries.length >> 1));
        message = build();
      }
    }
    if (message.submit !== 'none') this.pendingSubmit = 'none';
    this.stateDirty = false;
    return message;
  }
}
