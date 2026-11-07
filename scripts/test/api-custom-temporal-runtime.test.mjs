import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { installIntlCustom } from '../../apps/production-extension/api-custom-intl-runtime.js';

const methods = ['timeZoneId', 'zonedDateTimeISO', 'plainDateTimeISO', 'plainDateISO', 'plainTimeISO'];
const intl = value => ({ id: 'intl-formatting', mode: 'custom', value });
const legacy = timeZone => ({ id: 'timezone', mode: 'custom', value: { timeZone, offsetMinutes: -540 } });
function fixture(entries = [intl({ timeZone: 'Asia/Tokyo' })], setup = '') {
  const context = vm.createContext({ input: structuredClone(entries) });
  vm.runInContext(`
    globalThis.window=globalThis;
    globalThis.calls={total:0,instant:0,coercion:0,getters:0,records:[]};
    globalThis.reason=new Error('owned native error');globalThis.during=null;
    function sample(name,receiver,args){
      calls.total++;calls.records.push({name,receiver,args:Array.from(args)});
      if(during)during(name);
      if(name==='timeZoneId')return 'Etc/Native';
      const zone=args[0]===undefined?'Etc/Native':String(args[0]);
      if(zone==='invalid')throw reason;
      return calls.last=Object.freeze({kind:name,zone,receiver});
    }
    globalThis.Temporal={Now:{
      timeZoneId(){return sample('timeZoneId',this,arguments);},
      zonedDateTimeISO(zone){return sample('zonedDateTimeISO',this,arguments);},
      plainDateTimeISO(zone){return sample('plainDateTimeISO',this,arguments);},
      plainDateISO(zone){return sample('plainDateISO',this,arguments);},
      plainTimeISO(zone){return sample('plainTimeISO',this,arguments);},
      instant(){calls.instant++;return Object.freeze({kind:'instant'});}
    }};
    globalThis.originalNow=Temporal.Now;globalThis.originalMethods={};
    for(const name of Object.keys(Temporal.Now))originalMethods[name]=Object.getOwnPropertyDescriptor(Temporal.Now,name);
    ${setup}
    globalThis.installer=(${installIntlCustom.toString()});
    globalThis.guard=installer(globalThis,input);
  `, context);
  return { context, guard: vm.runInContext('guard', context), run: source => vm.runInContext(source, context) };
}

test('Temporal implicit default is native-created once with canonical selected zone; install does not read the clock', () => {
  const f = fixture([intl({ timeZone: 'asia/tokyo' })]);
  assert.equal(f.run('calls.total+calls.instant'), 0);
  assert.equal(f.run('Temporal.Now===originalNow'), true);
  assert.equal(f.run('Temporal.Now.timeZoneId()'), 'Asia/Tokyo');
  assert.equal(f.run('calls.total'), 1);
  for (const name of methods.slice(1)) {
    assert.equal(f.run(`Temporal.Now.${name}()===calls.last`), true);
    assert.equal(f.run('calls.last.zone'), 'Asia/Tokyo');
    assert.equal(f.run('calls.records.at(-1).args.length'), 1);
  }
  assert.equal(f.run('calls.total'), 5);
  assert.equal(f.run('calls.instant'), 0);
  assert.equal(f.guard.snapshot().temporal.length, 5);
  assert.equal(f.guard.snapshot().temporal.every(row => row.installed === 1 && row.changed === 1), true);
});

test('Temporal undefined default preserves extra-argument identity and borrowed receiver without coercing them', () => {
  const f = fixture();
  f.run(`globalThis.extra={get value(){calls.getters++;throw reason;}};globalThis.receiver={};`);
  for (const name of methods.slice(1)) {
    assert.equal(f.run(`Reflect.apply(Temporal.Now.${name},receiver,[undefined,extra])===calls.last`), true);
    assert.equal(f.run('calls.last.receiver===receiver && calls.records.at(-1).args[1]===extra'), true);
    assert.equal(f.run('calls.records.at(-1).args.length'), 2);
    assert.equal(f.run('calls.last.zone'), 'Asia/Tokyo');
  }
  assert.equal(f.run('calls.getters+calls.coercion'), 0);
  assert.equal(f.run('calls.total'), 4);
});

test('Temporal zero-argument Proxy lists do not read inherited Array index zero', () => {
  const f = fixture([legacy('Asia/Tokyo')]);
  f.run(`Object.defineProperty(Array.prototype,'0',{configurable:true,get(){calls.getters++;throw reason;},set(value){Object.defineProperty(this,'0',{value,configurable:true,writable:true,enumerable:true});}});`);
  for (const name of methods.slice(1)) {
    assert.equal(f.run(`Reflect.apply(originalMethods.${name}.value,originalNow,[]).zone`), 'Etc/Native', 'unwrapped native positive control');
    assert.equal(f.run(`Temporal.Now.${name}()===calls.last`), true);
    assert.equal(f.run('calls.last.zone'), 'Asia/Tokyo');
    assert.equal(f.run(`Temporal.Now.${name}(undefined).zone`), 'Asia/Tokyo');
    assert.equal(f.run(`Temporal.Now.${name}('UTC').zone`), 'UTC');
  }
  assert.equal(f.run(`Temporal.Now.plainDateISO({toString(){calls.coercion++;return 'UTC';}}).zone`), 'UTC');
  assert.equal(f.run('calls.coercion'), 1);
  assert.equal(f.run('calls.getters'), 0);
  assert.equal(f.run('calls.total'), 17);
});

test('Intl zero/one-argument Proxy lists avoid inherited index one while actual option getters run once', () => {
  const f = fixture([intl({ locale: 'fr-FR' })], `globalThis.nativeNumberFormat=Intl.NumberFormat;globalThis.nativeDateTimeFormat=Intl.DateTimeFormat;calls.optionReads=0;`);
  f.run(`Object.defineProperty(Array.prototype,'1',{configurable:true,get(){calls.getters++;throw reason;},set(value){Object.defineProperty(this,'1',{value,configurable:true,writable:true,enumerable:true});}});`);
  assert.equal(f.run(`typeof Reflect.construct(nativeNumberFormat,[]).format(1)`), 'string', 'unwrapped native positive control');
  assert.equal(f.run(`typeof Reflect.construct(nativeDateTimeFormat,[]).resolvedOptions().locale`), 'string');
  for (const name of ['NumberFormat', 'DateTimeFormat']) {
    assert.equal(f.run(`new Intl.${name}().resolvedOptions().locale`), 'fr-FR');
    assert.equal(f.run(`new Intl.${name}(undefined).resolvedOptions().locale`), 'fr-FR');
    assert.equal(f.run(`new Intl.${name}(undefined,undefined).resolvedOptions().locale`), 'fr-FR');
    assert.equal(f.run(`new Intl.${name}('en-US').resolvedOptions().locale`), 'en-US', 'an explicit page locale wins over the selection');
    assert.equal(f.run(`new Intl.${name}('en-US',undefined).resolvedOptions().locale`), 'en-US');
  }
  assert.equal(f.run(`new Intl.NumberFormat('en-US',{get minimumFractionDigits(){calls.optionReads++;return 2;}}).resolvedOptions().minimumFractionDigits`), 2);
  assert.equal(f.run('calls.optionReads'), 1);
  assert.equal(f.run('calls.getters'), 0);
});

test('Temporal explicit zones and their native coercion/errors are untouched', () => {
  const f = fixture();
  for (const name of methods.slice(1)) {
    assert.equal(f.run(`Temporal.Now.${name}('UTC').zone`), 'UTC');
    assert.equal(f.run(`Temporal.Now.${name}({toString(){calls.coercion++;return 'Europe/Paris';}}).zone`), 'Europe/Paris');
    assert.throws(() => f.run(`Temporal.Now.${name}({toString(){calls.coercion++;throw reason;}})`), error => error === f.run('reason'));
    assert.throws(() => f.run(`Temporal.Now.${name}('invalid')`), error => error === f.run('reason'));
  }
  assert.equal(f.run('calls.coercion'), 8);
  assert.equal(f.run('calls.total'), 16);
  assert.equal(f.guard.snapshot().temporal.every(row => row.changed === 0), true);
});

test('Temporal callable shape, native throw identity and instant remain unchanged', () => {
  const f = fixture();
  for (const name of methods) {
    assert.equal(f.run(`Temporal.Now.${name}.name===originalMethods.${name}.value.name && Temporal.Now.${name}.length===originalMethods.${name}.value.length`), true);
    assert.throws(() => f.run(`new Temporal.Now.${name}()`), error => error.name === 'TypeError');
  }
  assert.equal(f.run('calls.total'), 0);
  assert.equal(f.run('Temporal.Now.instant===originalMethods.instant.value'), true);
  f.run('Temporal.Now.instant()'); assert.equal(f.run('calls.instant'), 1);
  f.run('during=()=>{throw reason;}');
  assert.throws(() => f.run('Temporal.Now.timeZoneId()'), error => error === f.run('reason'));
  assert.equal(f.run('calls.total'), 1);
});

test('Temporal uses legacy timezone alone or as locale-only fallback; explicit Intl zone wins', () => {
  for (const entries of [[legacy('Asia/Tokyo')], [intl({ locale: 'fr-FR' }), legacy('Asia/Tokyo')], [intl({ timeZone: 'Asia/Tokyo' }), legacy('UTC')]]) {
    const f = fixture(entries);
    assert.equal(f.run('Temporal.Now.timeZoneId()'), 'Asia/Tokyo');
    assert.equal(f.run('Temporal.Now.plainDateISO().zone'), 'Asia/Tokyo');
  }
});

test('Temporal dormant/missing selection does not alter any method or sample a clock', () => {
  for (const entries of [[], [intl({ locale: 'fr-FR' })], [{ ...legacy('Asia/Tokyo'), mode: 'off' }], [{ ...intl({ timeZone: 'Asia/Tokyo' }), mode: 'bypass' }]]) {
    const f = fixture(entries);
    assert.equal(f.run('Object.keys(originalMethods).every(name=>Temporal.Now[name]===originalMethods[name].value)'), true);
    assert.equal(f.run('calls.total+calls.instant'), 0);
    assert.equal(f.guard.snapshot().temporal, undefined);
  }
});

test('Temporal absent/accessor namespaces and missing/immutable methods are never synthesized or read', () => {
  for (const setup of [`delete globalThis.Temporal;`, `Object.defineProperty(globalThis,'Temporal',{configurable:true,get(){calls.getters++;throw reason;}});`, `Object.defineProperty(Temporal,'Now',{configurable:true,get(){calls.getters++;throw reason;}});`]) {
    const f = fixture([legacy('Asia/Tokyo')], setup);
    assert.equal(f.run('calls.total+calls.instant+calls.getters'), 0);
    assert.equal(f.guard.snapshot().installed, 0);
  }
  const f = fixture([legacy('Asia/Tokyo')], `delete Temporal.Now.timeZoneId;Object.defineProperty(Temporal.Now,'plainDateISO',{value:originalMethods.plainDateISO.value,writable:false,configurable:false});Object.defineProperty(Temporal.Now,'plainTimeISO',{configurable:true,get(){calls.getters++;throw reason;}});`);
  assert.equal(f.run(`Object.hasOwn(Temporal.Now,'timeZoneId')`), false);
  assert.equal(f.run('Temporal.Now.plainDateISO===originalMethods.plainDateISO.value'), true);
  assert.equal(f.run('calls.getters'), 0);
  assert.equal(f.guard.snapshot().temporal.filter(row => row.unavailable === 1).length, 3);
  assert.equal(f.guard.snapshot().temporal.filter(row => row.installed === 1).length, 2);
});

test('Temporal invalid or unverifiable selected zone is unavailable without a native Now operation', () => {
  for (const [entries, setup] of [[[legacy('Not/A-Time-Zone')], ''], [[legacy('Asia/Tokyo')], 'delete globalThis.Intl;']]) {
    const f = fixture(entries, setup);
    assert.equal(f.run('Object.keys(originalMethods).every(name=>Temporal.Now[name]===originalMethods[name].value)'), true);
    assert.equal(f.run('calls.total+calls.instant'), 0);
    assert.equal(f.guard.snapshot().unavailable, 1);
  }
});

test('Temporal throwing namespace/method descriptor traps fail unavailable without escaping installation', () => {
  for (const setup of [
    `globalThis.Temporal=new Proxy(Temporal,{getOwnPropertyDescriptor(){throw reason;}});`,
    `Temporal.Now=new Proxy(Temporal.Now,{getOwnPropertyDescriptor(){throw reason;}});`,
  ]) {
    const f = fixture([legacy('Asia/Tokyo')], setup);
    assert.equal(f.run('calls.total+calls.instant'), 0);
    assert.ok(f.guard.snapshot().unavailable > 0);
    assert.equal(f.guard.snapshot().installed, 0);
  }
  const f = fixture([legacy('Asia/Tokyo')], `Object.defineProperty(input[0].value,'timeZone',{get(){calls.getters++;throw reason;}});`);
  assert.equal(f.run('calls.getters+calls.total'), 0); assert.equal(f.guard.snapshot().installed, 0);
});

test('Temporal oversized implicit argument lists remain one unmodified native call with unavailable projection', () => {
  const f = fixture([legacy('Asia/Tokyo')]);
  assert.equal(f.run(`Reflect.apply(Temporal.Now.plainDateISO,Temporal.Now,Array(1025).fill(undefined)).zone`), 'Etc/Native');
  assert.equal(f.run('calls.total'), 1); assert.equal(f.run('calls.records[0].args.length'), 1025);
  const row = f.guard.snapshot().temporal.find(row => row.name === 'plainDateISO');
  assert.equal(row.unavailable, 1); assert.equal(row.changed, 0);
});

test('Temporal stop restores ownership and retained methods become native; a new owner survives', () => {
  const f = fixture([legacy('Asia/Tokyo')]);
  f.run(`globalThis.saved=Temporal.Now.plainDateISO;globalThis.replacement={timeZoneId(){return 'new-owner';}}.timeZoneId;Object.defineProperty(Temporal.Now,'timeZoneId',{value:replacement,writable:true,configurable:true});guard.stop();`);
  assert.equal(f.run('Temporal.Now.timeZoneId===replacement'), true);
  assert.equal(f.run('Temporal.Now.plainDateISO===originalMethods.plainDateISO.value'), true);
  assert.equal(f.run('saved().zone'), 'Etc/Native');
  const next = f.run(`installer(globalThis,[{id:'timezone',mode:'custom',value:{timeZone:'UTC',offsetMinutes:0}}])`);
  assert.equal(f.run('Temporal.Now.plainDateISO().zone'), 'UTC');
  f.guard.stop(); assert.equal(f.run('Temporal.Now.plainDateISO().zone'), 'UTC'); next.stop();
});

test('Temporal stop during native execution preserves the one native result and prevents post-call metadata projection', () => {
  const f = fixture([legacy('Asia/Tokyo')]);
  f.run(`during=()=>guard.stop();`);
  assert.equal(f.run('Temporal.Now.timeZoneId()'), 'Etc/Native');
  assert.equal(f.run('calls.total'), 1);
  assert.equal(f.guard.snapshot().temporal.every(row => row.changed === 0), true);
  const g = fixture([legacy('Asia/Tokyo')]); g.run('during=()=>guard.stop();');
  assert.equal(g.run('Temporal.Now.plainDateISO()===calls.last'), true);
  assert.equal(g.run('calls.total'), 1);
});

test('Temporal late globals are not reread and cross-realm native results keep their target identity', () => {
  const parent = fixture([]), child = fixture([]);
  const installer = parent.run('installer'), target = child.run('globalThis');
  const guard = installer(target, [legacy('Asia/Tokyo')]);
  child.run(`Object.defineProperty(globalThis,'Temporal',{configurable:true,get(){calls.getters++;throw reason;}});Object.defineProperty(globalThis,'Intl',{configurable:true,get(){calls.getters++;throw reason;}});`);
  const now = child.run('originalNow');
  const result = now.plainDateISO();
  assert.equal(result, child.run('calls.last'));
  assert.equal(result.zone, 'Asia/Tokyo');
  assert.equal(child.run('calls.getters'), 0);
  guard.stop(); assert.equal(now.plainDateISO().zone, 'Etc/Native');
});

test('Temporal diagnostic snapshots contain method counters, never selected zones or actual clock results', () => {
  const f = fixture([legacy('Asia/Tokyo')]); f.run('Temporal.Now.plainTimeISO()');
  const value = JSON.stringify(f.guard.snapshot());
  assert.doesNotMatch(value, /Asia|Tokyo|Etc\/Native|"(?:timeZone|offset|zone|receiver|records)":/u);
  assert.equal(f.guard.snapshot().temporal.every(row => Object.keys(row).sort().join(',') === 'changed,installed,name,unavailable'), true);
});

test('genuine Node24 experimental Temporal oracle preserves native object identity, explicit behavior and one sample', () => {
  const moduleUrl = new URL('../../apps/production-extension/api-custom-intl-runtime.js', import.meta.url).href;
  const script = `import assert from 'node:assert/strict';import {installIntlCustom} from ${JSON.stringify(moduleUrl)};
    assert.equal(typeof Temporal,'object');const names=['timeZoneId','zonedDateTimeISO','plainDateTimeISO','plainDateISO','plainTimeISO'];
    const now=Temporal.Now,records=[],originals=new Map();
    for(const name of names){const field=Object.getOwnPropertyDescriptor(now,name);if(typeof field?.value!=='function')continue;originals.set(name,field);Object.defineProperty(now,name,{...field,value:new Proxy(field.value,{apply(target,receiver,args){records.push({name,args});return records.at(-1).value=Reflect.apply(target,receiver,args);}})});}
    const guard=installIntlCustom(globalThis,[{id:'timezone',mode:'custom',value:{timeZone:'Asia/Tokyo',offsetMinutes:-540}}]);
    assert.equal(records.length,0);let checks=0;
    for(const name of names.slice(1)){assert.ok(originals.has(name));const returned=now[name]();assert.equal(returned,records.at(-1).value);assert.equal(records.at(-1).args[0],'Asia/Tokyo');assert.equal(typeof returned.toString(),'string');checks+=3;
      const explicit=now[name]('UTC');assert.equal(explicit,records.at(-1).value);assert.equal(records.at(-1).args[0],'UTC');checks+=2;
      const before=records.length;assert.throws(()=>now[name]('Not/A-Time-Zone'),{name:'RangeError'});assert.equal(records.length,before+1);checks+=2;
      assert.throws(()=>new now[name](),{name:'TypeError'});checks++;}
    assert.equal(records.length,12);if(!originals.has('timeZoneId'))assert.equal(Object.hasOwn(now,'timeZoneId'),false);
    guard.stop();for(const[name,field]of originals)Object.defineProperty(now,name,field);
    console.log(JSON.stringify({genuineTemporal:true,experimental:true,nativeMethods:originals.size,modernTimeZoneId:originals.has('timeZoneId'),checks}));`;
  const output = execFileSync(process.execPath, ['--harmony-temporal', '--input-type=module', '-e', script], { encoding: 'utf8', timeout: 20000, windowsHide: true });
  const result = JSON.parse(output.trim());
  assert.equal(result.genuineTemporal, true); assert.equal(result.experimental, true);
  assert.ok(result.nativeMethods >= 4); assert.equal(result.checks, 32);
});
