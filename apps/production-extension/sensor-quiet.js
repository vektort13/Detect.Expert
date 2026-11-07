// ADR-113: the user's opt-in choice not to run the observation sensors (the registered scripts detector-isolated-v1 and detector-main-v1)
// while Antidetect is on. Service-worker side only. One boolean setting in storage.local, a pure decision, the periods during which the
// sensors were withheld from pages (storage.session, so the Detector can say "paused" instead of leaving a silent gap) and the two
// UI messages that read and write the setting. Nothing here reads a page, a header, a cookie or a network response; nothing is exported,
// reported or logged. Default OFF: an absent or malformed record means OFF and nothing changes for anyone who never opens the setting.
// REQ-012: every change goes through ScopeController.ensureRegistration() and applies on the fly (stop new data, unregister); documents that
// are already loaded keep the wrappers they have until they are reloaded, and the interface says so. Antidetect's own registration (the
// Custom scripts of api-configuration-controller.js) is NOT touched: it keeps using ScopeController.desiredMatches().

export const SENSOR_QUIET_KEY = 'antidetect-quiet-sensors:v1';
export const SENSOR_QUIET_PERIODS_KEY = 'antidetect-quiet-periods:v1';
export const SENSOR_QUIET_MAX_PERIODS = 8;
export const SENSOR_QUIET_MESSAGES = Object.freeze(['ui-sensor-quiet-get', 'ui-sensor-quiet-set']);
export const SENSOR_QUIET_STATUSES = Object.freeze(['off', 'waiting', 'idle', 'active']);
const CONFIGURATION_KEY = 'api-configuration:v1';
const STATE_KEYS = Object.freeze(['schemaVersion', 'type', 'setting', 'antidetect', 'scoped', 'effective', 'healthy']);
// States a quiet period may replace: a stronger state (no access, unsupported) and an existing pause keep their own meaning.
const REPLACEABLE_STATES = Object.freeze(['active', 'partial', 'late-start', 'degraded']);

const hasData = (value, key) => { const descriptor = Object.getOwnPropertyDescriptor(value, key); return descriptor !== undefined && Object.hasOwn(descriptor, 'value'); };
const own = (value, key) => value !== null && typeof value === 'object' ? Object.getOwnPropertyDescriptor(value, key)?.value : undefined;
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value, keys) => { const actual = Reflect.ownKeys(value); return actual.length === keys.length && keys.every(key => actual.includes(key) && hasData(value, key)); };
const error = code => ({ schemaVersion: 1, type: 'error', code });

/** Strict reader of the stored setting: only the exact record { version: 1, enabled: true } turns it on; anything else is OFF. Never throws. */
export function readSensorQuietSetting(raw) {
  try { return isRecord(raw) && exactKeys(raw, ['version', 'enabled']) && raw.version === 1 && raw.enabled === true; } catch { return false; }
}

/** Strict reader of the session record of withheld periods: at most 8, ascending, only the last one may be open. A bad record reads as []. */
export function readQuietPeriods(raw) {
  try {
    if (!Array.isArray(raw) || raw.length > SENSOR_QUIET_MAX_PERIODS) return [];
    const out = [];
    for (const item of raw) {
      if (!isRecord(item) || !exactKeys(item, ['from', 'to'])) return [];
      const from = item.from, to = item.to, previous = out.at(-1);
      if (!Number.isSafeInteger(from) || from < 0 || to !== null && (!Number.isSafeInteger(to) || to < from)) return [];
      if (previous !== undefined && (previous.to === null || from < previous.to)) return [];
      out.push({ from, to });
    }
    return out;
  } catch { return []; }
}

/** What the setting means right now: off | waiting (on, Antidetect not on) | idle (on, but no persistent observation scope) | active. */
export function sensorQuietStatus(state) {
  if (!isRecord(state) || state.setting !== true) return 'off';
  if (state.antidetect !== true) return 'waiting';
  return state.effective === true ? 'active' : 'idle';
}

/** The reply of ui-sensor-quiet-get/-set as the interface may trust it: the exact seven fields, booleans only. Anything else is null. */
export function readSensorQuietState(reply) {
  try {
    if (!isRecord(reply) || !exactKeys(reply, STATE_KEYS) || reply.schemaVersion !== 1 || reply.type !== 'sensor-quiet-state') return null;
    for (const key of STATE_KEYS.slice(2)) if (typeof reply[key] !== 'boolean') return null;
    return { setting: reply.setting, antidetect: reply.antidetect, scoped: reply.scoped, effective: reply.effective, healthy: reply.healthy };
  } catch { return null; }
}

/**
 * A document that was opened while the sensors were withheld never ran them. Its report says "paused" (REQ-006) instead of leaving a silent gap.
 * Only a document that is in scope, not revoked and has never delivered an observation is affected; a stronger or existing state stays.
 * Findings carry a coverageRef that names the state, so it is recomputed for the same flags.
 */
export function presentQuietCoverage(projection, report, meta, gate, coverageRef) {
  try {
    if (!isRecord(projection) || !isRecord(report) || !isRecord(meta) || gate === null || typeof gate?.coversDocument !== 'function' || typeof coverageRef !== 'function') return projection;
    if (meta.sensorSeen === true || meta.revoked === true || meta.accessGranted === false || !REPLACEABLE_STATES.includes(projection.coverageState)) return projection;
    if (gate.coversDocument(report.createdAt) !== true) return projection;
    const reference = coverageRef('paused', projection.coverageFlags);
    return { ...projection, coverageState: 'paused', findings: projection.findings.map(finding => ({ ...finding, coverageRef: reference })) };
  } catch { return projection; }
}

export class SensorQuietGate {
  constructor({ api, scope, whenReady = () => Promise.resolve(), verifyUiSender, now = () => Date.now() }) {
    Object.assign(this, { api, scope, whenReady, verifyUiSender, now });
    this.setting = false; this.antidetect = false; this.known = false; this.periods = []; this.chain = Promise.resolve(); this.writes = Promise.resolve(); this.pending = 0;
  }

  /**
   * Startup, before the first registration: the stored setting and the periods. The stored Antidetect master (the configuration can be several
   * megabytes) is read here only for someone who turned the setting on, so that the sensors never flash on a page while the worker wakes; the
   * configuration controller confirms or corrects it once it has loaded. Whoever left the setting off pays one tiny read.
   */
  async load() {
    this.setting = readSensorQuietSetting(own(await this.api.storage.local.get(SENSOR_QUIET_KEY), SENSOR_QUIET_KEY));
    if (this.setting) await this.ensureMaster();
    try { this.periods = readQuietPeriods(own(await this.api.storage.session.get(SENSOR_QUIET_PERIODS_KEY), SENSOR_QUIET_PERIODS_KEY)); } catch { this.periods = []; }
  }

  /** The master of the stored configuration, read once if neither the controller nor start-up has told the gate yet. A failed read leaves it unknown (off). */
  async ensureMaster() {
    if (this.known) return;
    try {
      const stored = await this.api.storage.local.get(CONFIGURATION_KEY);
      if (!this.known) { this.antidetect = own(own(own(stored, CONFIGURATION_KEY), 'configuration'), 'antidetectEnabled') === true; this.known = true; }
    } catch { /* unknown stays off */ }
  }

  /** The decision: the user asked for it and Antidetect's master is on. Whether any site is in scope is ScopeController.sensorsWithheld(). */
  quiet() { return this.setting === true && this.antidetect === true; }

  /** ApiConfigurationController.reconcile(): the master of the configuration it just loaded or saved. */
  noteAntidetect(on) {
    const next = on === true;
    this.known = true;
    if (next === this.antidetect) return Promise.resolve();
    this.antidetect = next;
    return this.setting ? this.refresh() : Promise.resolve();
  }

  /** The registration follows the decision. ensureRegistration() coalesces concurrent callers and never rejects. */
  refresh() { return Promise.resolve(this.scope.ensureRegistration()).catch(() => {}); }

  /** ScopeController.reconcileRegistration(): true when the sensors are being withheld from the sites in scope, false once they are registered again. */
  noteWithheld(withheld) {
    const last = this.periods.at(-1), open = last !== undefined && last.to === null;
    if (withheld === true && !open) {
      this.periods.push({ from: this.now(), to: null });
      while (this.periods.length > SENSOR_QUIET_MAX_PERIODS) this.periods.shift();
      this.persistPeriods();
    } else if (withheld !== true && open) {
      last.to = Math.max(last.from, this.now());
      this.persistPeriods();
    }
  }

  persistPeriods() {
    const value = this.periods.map(period => ({ from: period.from, to: period.to }));
    this.writes = this.writes.then(() => this.api.storage.session.set({ [SENSOR_QUIET_PERIODS_KEY]: value })).catch(() => {});
    return this.writes;
  }

  /** Was this document (by the time its report was created) opened while the sensors were withheld? */
  coversDocument(createdAt) {
    if (typeof createdAt !== 'number' || !Number.isFinite(createdAt)) return false;
    return this.periods.some(period => createdAt >= period.from && (period.to === null || createdAt < period.to));
  }

  state() {
    return { schemaVersion: 1, type: 'sensor-quiet-state', setting: this.setting, antidetect: this.antidetect, scoped: this.scope.desiredMatches().length > 0,
      effective: this.scope.sensorsWithheld() === true, healthy: this.scope.registrationHealthy !== false };
  }

  set(enabled) {
    const run = async () => {
      await this.ensureMaster();
      try { await this.api.storage.local.set({ [SENSOR_QUIET_KEY]: { version: 1, enabled } }); } catch { return error('storage-error'); }
      this.setting = enabled;
      await this.refresh();
      return this.state();
    };
    const next = this.chain.then(run, run);
    this.chain = next.then(() => undefined, () => undefined);
    return next;
  }

  /** runtime.onMessage route: extension pages only, exact keys, a boolean. Returns null for every other message. */
  route(message, sender) {
    const type = own(message, 'type');
    if (!SENSOR_QUIET_MESSAGES.includes(type)) return null;
    if (this.pending >= 16) return Promise.resolve(error('busy'));
    const expected = type === 'ui-sensor-quiet-get' ? ['schemaVersion', 'type'] : ['schemaVersion', 'type', 'enabled'];
    let shaped = false;
    try { shaped = isRecord(message) && exactKeys(message, expected) && message.schemaVersion === 1 && (type === 'ui-sensor-quiet-get' || typeof message.enabled === 'boolean'); } catch { shaped = false; }
    if (!shaped) return Promise.resolve(error('invalid-request'));
    if (!this.verifyUiSender(sender, this.api.runtime.id)) return Promise.resolve(error('unauthorized-sender'));
    const enabled = type === 'ui-sensor-quiet-set' ? message.enabled : null;
    this.pending++;
    return (async () => {
      await this.whenReady();
      if (!this.scope.hasDataConsent) return error('no-access');
      await this.ensureMaster();
      return enabled === null ? this.state() : this.set(enabled);
    })().catch(() => error('storage-error')).finally(() => { this.pending--; });
  }
}
