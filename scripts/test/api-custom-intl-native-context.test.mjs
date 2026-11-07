import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { installIntlCustom } from '../../apps/production-extension/api-custom-intl-runtime.js';

function fixture(entries = [{ id: 'timezone', mode: 'custom', value: { timeZone: 'Asia/Tokyo', offsetMinutes: -540 } }], setup = '') {
  const context = vm.createContext({ entries: structuredClone(entries) });
  vm.runInContext(`
    globalThis.calls={from:0,zone:0,offset:0,now:0,coercion:0};
    globalThis.NativeDate=Date;globalThis.reason=Error('owned native failure');globalThis.throwStage='';
    class ZonedDateTime { constructor(ns){this.ns=ns;} get offsetNanoseconds(){calls.offset++;if(throwStage==='offset')throw reason;return this.ns;} }
    class Instant {
      constructor(ms){this.ms=ms;}
      static fromEpochMilliseconds(ms){calls.from++;if(throwStage==='from')throw reason;return new Instant(ms);}
      toZonedDateTimeISO(zone){calls.zone++;if(throwStage==='zone')throw reason;globalThis.lastZone=zone;return new ZonedDateTime(zone==='America/New_York'?(this.ms===0?-18000000000000:-14400000000000):zone==='Europe/Paris'?561000000000:zone==='Africa/Monrovia'?-2588000000000:32400000000000);}
    }
    globalThis.Temporal={Instant,ZonedDateTime,Now:{timeZoneId(){calls.now++;return'UTC';},plainDateISO(){calls.now++;return{};}}};
    ${setup}
    globalThis.install=(${installIntlCustom.toString()});globalThis.guard=install(globalThis,entries);
  `, context);
  return { context, run: source => vm.runInContext(source, context) };
}
const row = (id, value) => ({ id, mode: 'custom', value });

test('private native rule context samples no clock, uses caller Date once and is absent from snapshots', () => {
  const f = fixture();
  assert.equal(f.run('typeof guard.nativeContext'), 'function'); assert.equal(f.run('guard.nativeContext.name'), 'selectedOffsetForDate');
  assert.equal(f.run('Object.isFrozen(guard.nativeContext)'), true);
  assert.equal(f.run('calls.from+calls.zone+calls.offset+calls.now'), 0);
  assert.equal(f.run('guard.nativeContext(new Date(0))'), -540);
  assert.equal(f.run('calls.from===1&&calls.zone===1&&calls.offset===1&&calls.now===0'), true);
  assert.equal(f.run('JSON.stringify(guard.snapshot()).includes("Asia/Tokyo")||JSON.stringify(guard.snapshot()).includes("nativeContext")'), false);
});

test('selected IANA priority and canonicalization follow Intl over legacy; helper follows the supplied epoch', () => {
  const f = fixture([row('timezone', { timeZone: 'Asia/Tokyo', offsetMinutes: -540 }), row('intl-formatting', { timeZone: 'America/New_York' })]);
  assert.equal(f.run('guard.nativeContext(new Date(0))'), 300);
  assert.equal(f.run('guard.nativeContext(new Date(1))'), 240);
  assert.equal(f.run('lastZone'), 'America/New_York');
  const canonical = fixture([row('timezone', { timeZone: 'asia/tokyo', offsetMinutes: -540 })]);
  assert.equal(canonical.run('guard.nativeContext(new Date(0))'), -540); assert.equal(canonical.run('lastZone'), 'Asia/Tokyo');
});

test('historical sub-minute rules answer with the whole minutes V8 reports (truncated toward zero), whatever the native value is', () => {
  const paris = fixture([row('timezone', { timeZone: 'Europe/Paris', offsetMinutes: -9 })]);
  const monrovia = fixture([row('timezone', { timeZone: 'Africa/Monrovia', offsetMinutes: 43 })]);
  // 561 s east of UTC is -9.35 minutes: V8 getTimezoneOffset() returns -9, never a fraction.
  assert.equal(paris.run('guard.nativeContext(new Date(0))'), -9);
  assert.equal(paris.run('guard.nativeContext(new Date(0),-9.35)'), -9);
  assert.equal(paris.run('guard.nativeContext(new Date(0),-9)'), -9);
  assert.equal(paris.run('guard.nativeContext(new Date(0),-10)'), -9);
  // 2588 s west of UTC is +43.13 minutes -> 43.
  assert.equal(monrovia.run('guard.nativeContext(new Date(0))'), 43);
  assert.equal(monrovia.run('guard.nativeContext(new Date(0),43)'), 43);
  assert.equal(monrovia.run('guard.nativeContext(new Date(0),60)'), 43);
});

// Deterministic stand-in for the zone rules of the Temporal engine: offsets in nanoseconds east of UTC.
const RULES = `
  const hours = count => count * 3600e9;
  const rules = {
    'America/New_York': { standard: hours(-5), daylight: hours(-4), southern: false },
    'Europe/Berlin': { standard: hours(1), daylight: hours(2), southern: false },
    'Australia/Sydney': { standard: hours(10), daylight: hours(11), southern: true },
    'Europe/Paris': { standard: hours(1), daylight: hours(2), southern: false, mean: 561e9 },
    'Asia/Kolkata': { standard: hours(5.5), daylight: hours(5.5), southern: false },
    'UTC': { standard: 0, daylight: 0, southern: false }
  };
  Temporal.Instant.prototype.toZonedDateTimeISO = function (zone) {
    calls.zone++;
    const date = new NativeDate(this.ms), month = date.getUTCMonth(), rule = rules[zone];
    const northernSummer = month >= 3 && month <= 9, daylight = rule.southern ? !northernSummer : northernSummer;
    if (rule.mean !== undefined && date.getUTCFullYear() < 1891) return new Temporal.ZonedDateTime(rule.mean);
    return new Temporal.ZonedDateTime(daylight ? rule.daylight : rule.standard);
  };
`;
// [zone, UTC date, whole minutes V8 getTimezoneOffset() reports for that zone at that instant]
const DST_CASES = [
  ['America/New_York', Date.UTC(2026, 6, 15, 12), 240], ['America/New_York', Date.UTC(2026, 0, 15, 12), 300],
  ['Europe/Berlin', Date.UTC(2026, 6, 15, 12), -120], ['Europe/Berlin', Date.UTC(2026, 0, 15, 12), -60],
  ['Australia/Sydney', Date.UTC(2026, 0, 15, 12), -660], ['Australia/Sydney', Date.UTC(2026, 6, 15, 12), -600],
  ['Europe/Paris', Date.UTC(1850, 5, 1), -9]
];

test('selected zone answers its own DST summer and pre-1900 offsets for northern and southern zones, never the native value', () => {
  for (const [zone, time, minutes] of DST_CASES) {
    const f = fixture([row('timezone', { timeZone: zone, offsetMinutes: 1 })], RULES);
    f.context.probe = new Date(time);
    // The native offset of the host (any number) must not leak through when it differs from the selected rule.
    assert.equal(f.run('guard.nativeContext(probe,-221)'), minutes, zone + ' ' + new Date(time).toISOString());
    assert.equal(f.run('guard.nativeContext(probe)'), minutes, zone + ' without native value');
    assert.equal(f.run('guard.nativeContext(probe,' + minutes + ')'), minutes, zone + ' matching native value');
  }
});

test('the helper never returns a fraction or negative zero', () => {
  const f = fixture([row('timezone', { timeZone: 'UTC', offsetMinutes: 0 })], RULES + `Temporal.Instant.prototype.toZonedDateTimeISO = function () { return new Temporal.ZonedDateTime(globalThis.nextNs); };`);
  for (const [ns, minutes] of [[0, 0], [24e9, 0], [-24e9, 0], [3600e9, -60], [-3600e9, 60], [561e9, -9], [-2588e9, 43], [-1e9, 0], [19800e9, -330]]) {
    f.context.nextNs = ns;
    const result = f.run('guard.nativeContext(new Date(0),12345)');
    assert.equal(Object.is(result, minutes), true, 'offset ' + ns + ' ns -> ' + result + ' not ' + minutes);
    assert.equal(Number.isInteger(result), true);
  }
});

test('the DST and historical expectations equal what the real engine reports for the same zones and instants', () => {
  const hostZone = new Intl.DateTimeFormat().resolvedOptions().timeZone;
  try {
    for (const [zone, time, minutes] of DST_CASES) {
      process.env.TZ = zone;
      assert.equal(new Date(time).getTimezoneOffset(), minutes, zone + ' ' + new Date(time).toISOString());
    }
  } finally { process.env.TZ = hostZone; }
});

test('captured Date and Temporal operations ignore late globals and caller overrides without coercion', () => {
  const f = fixture();
  f.run(`globalThis.date=new NativeDate(0);Object.defineProperties(date,{getTime:{get(){calls.coercion++;throw reason;}},valueOf:{value(){calls.coercion++;throw reason;}},toString:{value(){calls.coercion++;throw reason;}}});
    Date=function(){calls.coercion++;throw reason;};Temporal.Instant.fromEpochMilliseconds=()=>{calls.coercion++;throw reason;};Temporal.Instant.prototype.toZonedDateTimeISO=()=>{calls.coercion++;throw reason;};Object.defineProperty(Temporal.ZonedDateTime.prototype,'offsetNanoseconds',{get(){calls.coercion++;throw reason;}});Temporal={};`);
  assert.equal(f.run('guard.nativeContext(date)'), -540); assert.equal(f.run('calls.coercion'), 0);
  assert.equal(f.run('calls.from===1&&calls.zone===1&&calls.offset===1'), true);
});

test('invalid Date, fake receivers and Proxy Dates do not coerce or call Temporal', () => {
  const f = fixture();
  for (const expression of ['new Date(NaN)', '{}', 'undefined', '1', "new Proxy(new Date(0),{get(){calls.coercion++;throw reason;}})"])
    assert.equal(f.run('guard.nativeContext(' + expression + ')'), undefined);
  assert.equal(f.run('calls.from+calls.zone+calls.offset+calls.coercion'), 0);
});

test('cross-realm genuine Date works without consulting its realm constructors', () => {
  const f = fixture(), foreign = vm.runInNewContext('new Date(0)'); f.context.foreign = foreign;
  assert.equal(f.run('guard.nativeContext(foreign)'), -540); assert.equal(f.run('calls.from'), 1);
});

test('missing APIs, invalid selected zone and Stop leave the private context unavailable', () => {
  for (const setup of ['delete Temporal.Instant;', 'delete Temporal.Instant.fromEpochMilliseconds;', 'delete Temporal.Instant.prototype.toZonedDateTimeISO;', "delete Temporal.ZonedDateTime.prototype.offsetNanoseconds;", 'delete globalThis.Temporal;']) {
    const f = fixture(undefined, setup); assert.equal(f.run('guard.nativeContext(new Date(0))'), undefined);
  }
  const invalid = fixture([row('timezone', { timeZone: 'Owned/Invalid', offsetMinutes: 0 })]);
  assert.equal(invalid.run('guard.nativeContext(new Date(0))'), undefined);
  const stopped = fixture(); stopped.run('guard.stop()');
  assert.equal(stopped.run('guard.nativeContext(new Date(0))'), undefined); assert.equal(stopped.run('calls.from'), 0);
});

test('native rule lookup failure is unavailable and never replaces native errors or samples the clock', () => {
  for (const stage of ['from', 'zone', 'offset']) {
    const f = fixture(); f.context.throwStage = stage;
    assert.equal(f.run('guard.nativeContext(new Date(0))'), undefined); assert.equal(f.run('calls.now'), 0);
  }
});

test('genuine Node24 experimental Temporal agrees with native Date historical seconds and New York DST', () => {
  const script = `
    import assert from 'node:assert/strict';
    const install=(${installIntlCustom.toString()});
    const zones=['Europe/Paris','Europe/Rome','Africa/Monrovia','Asia/Colombo','America/New_York'];
    let checks=0,historicalSeconds=0,roundingDiscriminators=0;
    for(const zone of zones){
      process.env.TZ=zone;
      // Separate installer copies preserve a pristine per-zone initial capture.
      const installer=Function('return ('+install.toString()+')')();
      const guard=installer(globalThis,[{id:'timezone',mode:'custom',value:{timeZone:zone,offsetMinutes:0}}]);
      for(const ms of [Date.UTC(1900,0,1,12),Date.UTC(2026,0,1,12),Date.UTC(2026,6,1,12)]){
        const date=new Date(ms),ns=Temporal.Instant.fromEpochMilliseconds(ms).toZonedDateTimeISO(zone).offsetNanoseconds;
        const nativeOffset=date.getTimezoneOffset();assert.equal(guard.nativeContext(date,nativeOffset),nativeOffset);checks++;
        if(ns%60000000000!==0){historicalSeconds++;if(Math.round(-ns/60000000000)!==date.getTimezoneOffset())roundingDiscriminators++;}
      }
      guard.stop();assert.equal(guard.nativeContext(new Date(0)),undefined);checks++;
    }
    assert.ok(historicalSeconds>0);assert.ok(roundingDiscriminators>0);
    process.stdout.write(JSON.stringify({checks,historicalSeconds,roundingDiscriminators,experimental:true}));
  `;
  const result = JSON.parse(execFileSync(process.execPath, ['--harmony-temporal', '--input-type=module', '-e', script], { encoding: 'utf8' }));
  assert.equal(result.experimental, true); assert.equal(result.checks, 20); assert.ok(result.historicalSeconds > 0); assert.ok(result.roundingDiscriminators > 0);
});
