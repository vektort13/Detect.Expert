// Test-only fakes of the ISOLATED module «Защита» (S05): form controls whose `value` getter counts (or refuses) reads,
// and a ProtectEnv with a fake window, a fake chrome.runtime (configurable ack) and a controllable clock. Timers use
// the globals so vitest fake timers drive them.

import type { ProtectAck, ProtectPageMessage, ProtectRelayMessage } from '@detect-expert/contracts';
import type { FieldElementLike, TypeObserverPort, TypeRecordLike } from '../src/protect/classify';
import type { ProtectEnv, ProtectEvent, ProtectTimer, ProtectWindowEvent } from '../src/protect/env';

export const SALT = 'AAAAAAAAAAAAAAAAAAAAAA';
export const SALT_ID = 'salt-0001';
export const SALT_2 = 'BBBBBBBBBBBBBBBBBBBBBB';
export const SALT_ID_2 = 'salt-0002';

/** A form control: attributes, a value set by "typing", and a getter that counts (or throws on) every read. */
export class FakeField implements FieldElementLike {
  readonly attrs = new Map<string, string>();
  reads = 0;
  isConnected = true;
  form: FakeForm | null = null;
  private text = '';
  onTypeChange: ((el: FakeField, oldValue: string | null) => void) | null = null;

  constructor(
    readonly localName: string,
    attributes: Record<string, string> = {},
    private readonly throwOnRead = false,
  ) {
    for (const [k, v] of Object.entries(attributes)) this.attrs.set(k, v);
  }

  get value(): string {
    this.reads++;
    if (this.throwOnRead) throw new Error('the value getter of a never-read field was called');
    return this.text;
  }

  type(text: string): void {
    this.text = text;
  }

  getAttribute(name: string): string | null {
    return this.attrs.get(name.toLowerCase()) ?? null;
  }

  hasAttribute(name: string): boolean {
    return this.attrs.has(name.toLowerCase());
  }

  setAttribute(name: string, v: string): void {
    const key = name.toLowerCase();
    const old = this.attrs.get(key) ?? null;
    this.attrs.set(key, v);
    if (key === 'type') this.onTypeChange?.(this, old);
  }

  closest(selector: string): unknown {
    if (selector === 'form') return this.form;
    return null;
  }
}

export class FakeForm {
  readonly localName = 'form';
  closest(selector: string): unknown {
    return selector === 'form' ? this : null;
  }
}

/** A submit control: `closest(SUBMIT_CONTROL_SELECTOR)` finds itself, `closest('form')` its form. */
export class FakeButton {
  readonly localName = 'button';
  constructor(readonly form: FakeForm | null) {}
  getAttribute(): string | null {
    return null;
  }
  hasAttribute(): boolean {
    return false;
  }
  closest(selector: string): unknown {
    if (selector === 'form') return this.form;
    return this;
  }
}

export function input(attributes: Record<string, string>, throwOnRead = false): FakeField {
  return new FakeField('input', attributes, throwOnRead);
}

/** A protect-ack; an override of `undefined` removes the key (an ack without a salt has no saltId/salt keys). */
export function ack(overrides: { [K in keyof ProtectAck]?: ProtectAck[K] | undefined } = {}): ProtectAck {
  const out: Record<string, unknown> = { schemaVersion: 1, type: 'protect-ack', active: true, groups: 3, saltId: SALT_ID, salt: SALT, ...overrides };
  for (const key of Object.keys(out)) if (out[key] === undefined) delete out[key];
  return out as unknown as ProtectAck;
}

export interface SentMessage {
  message: ProtectPageMessage;
  at: number;
}

export class FakeProtectEnv implements ProtectEnv {
  readonly sent: SentMessage[] = [];
  readonly posted: ProtectRelayMessage[] = [];
  readonly controls: FieldElementLike[] = [];
  ready = 'loading';
  alive = true;
  mono = 10_000;
  /** Answer policy of chrome.runtime.sendMessage: a value (resolved), a Promise, or throw (rejected). */
  respond: (message: ProtectPageMessage) => unknown = () => ack();
  private readonly listeners = new Map<ProtectWindowEvent, Set<(event: ProtectEvent) => void>>();
  private readonly messageHandlers = new Set<(fromSelf: boolean, data: unknown) => void>();
  private readonly controlHandlers = new Set<(fromServiceWorker: boolean, data: unknown) => void>();
  private observerCallback: ((records: readonly TypeRecordLike[]) => void) | null = null;
  private pendingRecords: TypeRecordLike[] = [];
  private ids = 0;

  listen(type: ProtectWindowEvent, handler: (event: ProtectEvent) => void): () => void {
    let set = this.listeners.get(type);
    if (set === undefined) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(handler);
    return () => set!.delete(handler);
  }

  listenMessages(handler: (fromSelf: boolean, data: unknown) => void): () => void {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  onControl(listener: (fromServiceWorker: boolean, data: unknown) => void): () => void {
    this.controlHandlers.add(listener);
    return () => this.controlHandlers.delete(listener);
  }

  sendToBackground(message: ProtectPageMessage): Promise<unknown> {
    this.sent.push({ message: JSON.parse(JSON.stringify(message)) as ProtectPageMessage, at: Date.now() });
    if (!this.alive) return Promise.reject(new Error('Extension context invalidated.'));
    try {
      return Promise.resolve(this.respond(message));
    } catch (error) {
      return Promise.reject(error);
    }
  }

  isContextAlive(): boolean {
    return this.alive;
  }

  readyState(): string {
    return this.ready;
  }

  formControls(limit: number): readonly FieldElementLike[] {
    return this.controls.slice(0, limit);
  }

  observeTypeAttributes(callback: (records: readonly TypeRecordLike[]) => void): TypeObserverPort | null {
    this.observerCallback = callback;
    return {
      takeRecords: () => this.pendingRecords.splice(0),
      disconnect: () => {
        this.observerCallback = null;
      },
    };
  }

  now(): number {
    return Date.now();
  }

  monotonicNow(): number {
    return this.mono;
  }

  setTimer(fn: () => void, ms: number): ProtectTimer {
    return setTimeout(fn, ms);
  }

  clearTimer(handle: ProtectTimer): void {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  }

  randomId(): string {
    this.ids++;
    return ('0000000000000000' + this.ids.toString(16)).slice(-16);
  }

  // ---- test drivers ----

  /** Dispatches a window event to the session's listeners (trusted unless said otherwise). */
  fire(type: ProtectWindowEvent, target: unknown, isTrusted = true): void {
    for (const h of [...(this.listeners.get(type) ?? [])]) h({ isTrusted, target });
  }

  listenerCount(): number {
    let n = this.messageHandlers.size + this.controlHandlers.size;
    for (const set of this.listeners.values()) n += set.size;
    return n;
  }

  postWindow(data: unknown, fromSelf = true): void {
    for (const h of [...this.messageHandlers]) h(fromSelf, JSON.parse(JSON.stringify(data)) as unknown);
  }

  control(data: unknown, fromServiceWorker = true): void {
    for (const h of [...this.controlHandlers]) h(fromServiceWorker, data);
  }

  /** A `type` attribute change observed by the MutationObserver (pending until taken or delivered). */
  watch(field: FakeField): void {
    field.onTypeChange = (el, oldValue) => this.pendingRecords.push({ target: el, oldValue });
  }

  deliverMutations(): void {
    const records = this.pendingRecords.splice(0);
    if (records.length > 0) this.observerCallback?.(records);
  }

  messages<T extends ProtectPageMessage['type']>(type: T): Extract<ProtectPageMessage, { type: T }>[] {
    return this.sent.filter((s) => s.message.type === type).map((s) => s.message as Extract<ProtectPageMessage, { type: T }>);
  }
}

/** Lets pending promise callbacks (acks) run. */
export async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}
