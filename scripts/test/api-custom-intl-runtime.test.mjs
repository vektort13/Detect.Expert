import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { installIntlCustom } from '../../apps/production-extension/api-custom-intl-runtime.js';

const entry = value => [{ id: 'intl-formatting', mode: 'custom', value }];
function context() {
  const realm = vm.createContext({});
  vm.runInContext(`globalThis.window=globalThis;
    globalThis.originals={};for(const name of ['DateTimeFormat','NumberFormat','Collator','RelativeTimeFormat','PluralRules','ListFormat','DisplayNames','Segmenter','DurationFormat'])originals[name]=Intl[name];
    globalThis.nativePrototype=Object.getPrototypeOf;globalThis.nativeDefine=Object.defineProperty;
  `, realm);
  return realm;
}
function fixture(value = { locale: 'fr-FR', timeZone: 'Pacific/Honolulu' }, setup = '') {
  const realm = context(); if (setup) vm.runInContext(setup, realm);
  const installer = vm.runInContext('(' + installIntlCustom.toString() + ')', realm);
  const guard = installer(vm.runInContext('globalThis', realm), entry(value));
  return { realm, installer, guard, run: source => vm.runInContext(source, realm) };
}
const sameJson = (actual, expected) => assert.deepEqual(JSON.parse(JSON.stringify(actual)), JSON.parse(JSON.stringify(expected)));
// Shared in-realm comparison: same resolved metadata and the same formatting of a probe value.
const SAME = 'const same=(actual,expected,value=0)=>JSON.stringify(actual.resolvedOptions())===JSON.stringify(expected.resolvedOptions())&&actual.format(value)===expected.format(value);';

test('Intl selected native slots drive real formatting, parts, ranges and metadata for default arguments', () => {
  const f = fixture({ locale: 'fr-FR', timeZone: 'Pacific/Honolulu', calendar: 'buddhist', numberingSystem: 'arab' });
  assert.equal(f.run(`(()=>{
    const options={year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'};
    const result=new Intl.DateTimeFormat(undefined,options);
    const expected=new originals.DateTimeFormat('fr-FR',{...options,timeZone:'Pacific/Honolulu',calendar:'buddhist',numberingSystem:'arab'});
    const date=new Date(0);
    return result.format(date)===expected.format(date)&&JSON.stringify(result.formatToParts(date))===JSON.stringify(expected.formatToParts(date))&&
      result.resolvedOptions().locale==='fr-FR'&&result.resolvedOptions().timeZone==='Pacific/Honolulu'&&
      result.resolvedOptions().calendar==='buddhist'&&result.resolvedOptions().numberingSystem==='arab'&&
      (!result.formatRange||result.formatRange(0,86400000)===expected.formatRange(0,86400000))&&
      (!result.formatRangeToParts||JSON.stringify(result.formatRangeToParts(0,86400000))===JSON.stringify(expected.formatRangeToParts(0,86400000)));
  })()`), true);
  assert.equal(f.run(`(()=>{
    const result=new Intl.NumberFormat(undefined,{style:'currency',currency:'EUR'}),expected=new originals.NumberFormat('fr-FR',{style:'currency',currency:'EUR',numberingSystem:'arab'});
    return result.format(1234567.89)===expected.format(1234567.89)&&JSON.stringify(result.formatToParts(-0))===JSON.stringify(expected.formatToParts(-0))&&result.resolvedOptions().numberingSystem==='arab'&&
      (!result.formatRange||result.formatRange(1,3)===expected.formatRange(1,3));
  })()`), true);
  assert.equal(f.run(`(()=>{const result=new Intl.Collator(),expected=new originals.Collator('fr-FR');return ['a','B','ä','z'].sort(result.compare).join('')===['a','B','ä','z'].sort(expected.compare).join('')&&result.resolvedOptions().locale==='fr';})()`), true);
  assert.equal(f.guard.snapshot().changed, 3);
});

test('Intl explicit page locale, zone, calendar and numbering stay exactly as passed; selected values fill only the gaps', () => {
  const f = fixture({ locale: 'fr-FR', timeZone: 'Pacific/Honolulu', calendar: 'buddhist', numberingSystem: 'arab' });
  const probe = `${SAME}const date=Date.UTC(2026,6,15,15,5,9);`;
  // Explicit locale and explicit numbering beat the selected pair (German currency format, Latin digits).
  assert.equal(f.run(`(()=>{${probe}
    const options={style:'currency',currency:'EUR',numberingSystem:'latn'};
    const result=new Intl.NumberFormat('de-DE',options);
    return same(result,new originals.NumberFormat('de-DE',options),1234.5)&&result.format(1234.5)!==new originals.NumberFormat('fr-FR',options).format(1234.5);
  })()`), true);
  // Nothing missing: the request is exactly the native one.
  assert.equal(f.run(`(()=>{${probe}
    const options={dateStyle:'full',timeZone:'UTC',calendar:'gregory',numberingSystem:'latn'};
    const result=new Intl.DateTimeFormat('de-DE',options);
    return same(result,new originals.DateTimeFormat('de-DE',options),date)&&result.resolvedOptions().locale==='de-DE'&&result.resolvedOptions().timeZone==='UTC';
  })()`), true);
  assert.equal(f.run(`(()=>{${probe}
    const result=new Intl.DateTimeFormat('fr-FR',{dateStyle:'full',timeZone:'UTC',calendar:'gregory',numberingSystem:'latn'});
    return result.format(Date.UTC(2026,6,15))===new originals.DateTimeFormat('fr-FR',{dateStyle:'full',timeZone:'UTC'}).format(Date.UTC(2026,6,15));
  })()`), true);
  // Explicit locale only: zone, calendar and numbering come from the selection.
  assert.equal(f.run(`(()=>{${probe}
    return same(new Intl.DateTimeFormat('de-DE',{dateStyle:'full'}),new originals.DateTimeFormat('de-DE',{dateStyle:'full',timeZone:'Pacific/Honolulu',calendar:'buddhist',numberingSystem:'arab'}),date);
  })()`), true);
  // Explicit zone only: locale, calendar and numbering come from the selection.
  assert.equal(f.run(`(()=>{${probe}
    return same(new Intl.DateTimeFormat(undefined,{hour:'numeric',timeZone:'UTC'}),new originals.DateTimeFormat('fr-FR',{hour:'numeric',timeZone:'UTC',calendar:'buddhist',numberingSystem:'arab'}),date);
  })()`), true);
  // Explicit calendar only.
  assert.equal(f.run(`(()=>{${probe}
    const result=new Intl.DateTimeFormat('de-DE',{year:'numeric',calendar:'gregory'});
    return same(result,new originals.DateTimeFormat('de-DE',{year:'numeric',calendar:'gregory',timeZone:'Pacific/Honolulu',numberingSystem:'arab'}),date)&&result.resolvedOptions().calendar==='gregory';
  })()`), true);
  // A partial request (only hour) still receives the selected locale, zone, calendar and numbering.
  assert.equal(f.run(`(()=>{${probe}
    const result=new Intl.DateTimeFormat(undefined,{hour:'numeric'});
    return same(result,new originals.DateTimeFormat('fr-FR',{hour:'numeric',timeZone:'Pacific/Honolulu',calendar:'buddhist',numberingSystem:'arab'}),date)&&result.resolvedOptions().timeZone==='Pacific/Honolulu';
  })()`), true);
  // Explicit undefined values mean omitted, exactly as in the native constructor.
  assert.equal(f.run(`(()=>{${probe}
    return same(new Intl.DateTimeFormat(undefined,{timeZone:undefined,calendar:undefined,numberingSystem:undefined,hour:'numeric'}),new originals.DateTimeFormat('fr-FR',{hour:'numeric',timeZone:'Pacific/Honolulu',calendar:'buddhist',numberingSystem:'arab'}),date);
  })()`), true);
  // Locale lists resolve natively, including unsupported leading tags.
  assert.equal(f.run(`(()=>{${probe}
    const options={dateStyle:'short',timeZone:'UTC',calendar:'gregory',numberingSystem:'latn'};
    const result=new Intl.DateTimeFormat(['xx-XX','de-DE'],options);
    return same(result,new originals.DateTimeFormat(['xx-XX','de-DE'],options),date)&&result.resolvedOptions().locale==='de-DE';
  })()`), true);
  assert.equal(f.run(`(()=>{${probe}
    const result=new Intl.DateTimeFormat(['xx-XX','de-DE'],{dateStyle:'short'});
    return result.resolvedOptions().locale==='de-DE'&&result.resolvedOptions().timeZone==='Pacific/Honolulu';
  })()`), true);
  // The metadata of a fully explicit request is the native metadata.
  assert.equal(f.run(`(()=>{
    const options={timeZone:'UTC',hour:'2-digit',hourCycle:'h23',calendar:'gregory',numberingSystem:'latn'};
    return JSON.stringify(new Intl.DateTimeFormat('en-GB',options).resolvedOptions())===JSON.stringify(new originals.DateTimeFormat('en-GB',options).resolvedOptions());
  })()`), true);
  assert.equal(f.guard.snapshot().unavailable, 0);
});

test('Intl explicit locale of the other constructors wins; the default call still follows the selected locale', () => {
  const f = fixture({ locale: 'fr-FR' });
  const cases = [
    ['RelativeTimeFormat', "new X('en').format(-2,'day')", "new X('fr-FR').format(-2,'day')"],
    ['PluralRules', "new X('en').select(0)", "new X('fr-FR').select(0)"],
    ['ListFormat', "new X('en').format(['a','b'])", "new X('fr-FR').format(['a','b'])"],
    ['DisplayNames', "new X('en',{type:'region'}).of('DE')", "new X('fr-FR',{type:'region'}).of('DE')"],
    ['Segmenter', "Array.from(new X('en',{granularity:'word'}).segment('un mot')).map(row=>row.segment).join('|')", "Array.from(new X('fr-FR',{granularity:'word'}).segment('un mot')).map(row=>row.segment).join('|')"],
    ['Collator', "new X('sv').compare('ä','z')", "new X('fr-FR').compare('ä','z')"],
    ['NumberFormat', "new X('de-DE').format(1234.5)", "new X('fr-FR').format(1234.5)"]
  ];
  for (const [name, explicit, selected] of cases) {
    if (f.run('typeof originals.' + name) !== 'function') continue;
    const native = f.run(`(()=>{const X=originals.${name};return ${explicit};})()`);
    assert.equal(f.run(`(()=>{const X=Intl.${name};return ${explicit};})()`), native, name + ' explicit locale');
    assert.equal(f.run(`(()=>{const X=Intl.${name};return ${explicit.replace(/'en'|'sv'|'de-DE'/, 'undefined')};})()`), f.run(`(()=>{const X=originals.${name};return ${selected};})()`), name + ' default locale');
  }
  assert.equal(f.run("new Intl.PluralRules('en').resolvedOptions().locale"), 'en');
  assert.equal(f.run("new Intl.Collator('sv').resolvedOptions().locale"), 'sv');
  assert.equal(f.guard.snapshot().unavailable, 0);
});

test('Intl DurationFormat follows the selected locale by default and keeps explicit locale and options', () => {
  const f = fixture({ locale: 'fr-FR', numberingSystem: 'arab' });
  if (f.run('typeof originals.DurationFormat') !== 'function') return;
  const duration = '{hours:1,minutes:2,seconds:3}';
  const same = `const same=(actual,expected)=>JSON.stringify(actual.resolvedOptions())===JSON.stringify(expected.resolvedOptions())&&actual.format(${duration})===expected.format(${duration});`;
  assert.equal(f.run(`new Intl.DurationFormat().format(${duration})`), f.run(`new originals.DurationFormat('fr-FR',{numberingSystem:'arab'}).format(${duration})`));
  assert.equal(f.run('new Intl.DurationFormat().resolvedOptions().locale'), f.run("new originals.DurationFormat('fr-FR').resolvedOptions().locale"));
  assert.equal(f.run(`new Intl.DurationFormat('en',{numberingSystem:'latn'}).format(${duration})`), f.run(`new originals.DurationFormat('en',{numberingSystem:'latn'}).format(${duration})`));
  for (const options of ["{style:'long'}", "{style:'short'}", "{style:'narrow'}", "{style:'digital',fractionalDigits:2}", "{hours:'numeric',minutes:'2-digit',seconds:'2-digit'}", "{daysDisplay:'always'}"]) {
    assert.equal(f.run(`(()=>{${same}return same(new Intl.DurationFormat(undefined,${options}),new originals.DurationFormat('fr-FR',{numberingSystem:'arab',...${options}}));})()`), true, options);
  }
  assert.equal(f.guard.snapshot().unavailable, 0);
});

test('Intl DateTimeFormat dayPeriod survives the selected-locale formatter', () => {
  const f = fixture({ locale: 'fr-FR', timeZone: 'Pacific/Honolulu' });
  assert.equal(f.run(`(()=>{
    const options={hour:'numeric',minute:'numeric',hour12:true,dayPeriod:'long',timeZone:'UTC'},date=Date.UTC(2026,6,15,15,5,9);
    const result=new Intl.DateTimeFormat(undefined,options),expected=new originals.DateTimeFormat('fr-FR',options);
    return result.resolvedOptions().dayPeriod==='long'&&result.format(date)===expected.format(date)&&result.format(date)!==new originals.DateTimeFormat('fr-FR',{...options,dayPeriod:undefined}).format(date);
  })()`), true);
  assert.equal(f.run(`(()=>{
    const date=Date.UTC(2026,6,15,15,5,9),result=new Intl.DateTimeFormat('en-US',{hour:'numeric',minute:'numeric',dayPeriod:'long'});
    return result.resolvedOptions().dayPeriod==='long'&&result.format(date)===new originals.DateTimeFormat('en-US',{hour:'numeric',minute:'numeric',dayPeriod:'long',timeZone:'Pacific/Honolulu'}).format(date);
  })()`), true);
});

test('Intl calendar and numbering keywords inside the page locale tag count as explicit page requests', () => {
  const f = fixture({ locale: 'de-DE', calendar: 'buddhist', numberingSystem: 'arab' });
  const probe = `${SAME}const date=Date.UTC(2020,0,15,13,5,9);`;
  // Japanese calendar requested by the tag: only the numbering is filled in from the selection.
  assert.equal(f.run(`(()=>{${probe}return same(new Intl.DateTimeFormat('ja-JP-u-ca-japanese'),new originals.DateTimeFormat('ja-JP-u-ca-japanese',{numberingSystem:'arab'}),date);})()`), true);
  // Latin digits requested by the tag: only the calendar is filled in.
  assert.equal(f.run(`(()=>{${probe}return same(new Intl.DateTimeFormat('ar-EG-u-nu-latn'),new originals.DateTimeFormat('ar-EG-u-nu-latn',{calendar:'buddhist'}),date);})()`), true);
  assert.equal(f.run(`(()=>{${probe}return same(new Intl.DateTimeFormat('AR-eg-U-NU-latn'),new originals.DateTimeFormat('AR-eg-U-NU-latn',{calendar:'buddhist'}),date);})()`), true);
  // Both requested by the tag: nothing is missing, the request is the native one.
  assert.equal(f.run(`(()=>{${probe}return same(new Intl.DateTimeFormat('th-TH-u-ca-gregory-nu-thai'),new originals.DateTimeFormat('th-TH-u-ca-gregory-nu-thai'),date);})()`), true);
  assert.equal(f.run("new Intl.NumberFormat('ar-EG-u-nu-latn').format(1234.5)===new originals.NumberFormat('ar-EG-u-nu-latn').format(1234.5)"), true);
  assert.equal(f.run("new Intl.NumberFormat('ar-EG').format(1234.5)===new originals.NumberFormat('ar-EG',{numberingSystem:'arab'}).format(1234.5)"), true);
  // A keyword outside the Unicode extension is not a request.
  assert.equal(f.run(`(()=>{${probe}return same(new Intl.DateTimeFormat('de-DE-x-ca-nu'),new originals.DateTimeFormat('de-DE',{calendar:'buddhist',numberingSystem:'arab'}),date);})()`), true);
  assert.equal(f.guard.snapshot().unavailable, 0);
});

test('Intl locale defaults such as the Thai ignorePunctuation come from the selected locale, not from the first formatter', () => {
  const f = fixture({ locale: 'th-TH' });
  assert.equal(f.run(`(()=>{
    const result=new Intl.Collator(),expected=new originals.Collator('th-TH');
    return JSON.stringify(result.resolvedOptions())===JSON.stringify(expected.resolvedOptions())&&result.compare('a-b','ab')===expected.compare('a-b','ab')&&expected.resolvedOptions().ignorePunctuation===true;
  })()`), true);
  assert.equal(f.run("new Intl.Collator(undefined,{ignorePunctuation:false}).resolvedOptions().ignorePunctuation"), false);
  assert.equal(f.run("new Intl.Collator('en-US').resolvedOptions().ignorePunctuation"), false);
});

test('Intl a request that already names every selected field keeps the genuine first formatter', () => {
  const f = fixture({ locale: 'fr-FR', timeZone: 'Pacific/Honolulu' }, `globalThis.constructions=0;
    Intl.DateTimeFormat=new Proxy(originals.DateTimeFormat,{construct(target,args,newTarget){constructions++;return Reflect.construct(target,args,newTarget);}});`);
  f.run('constructions=0'); // the install itself validates the selection once per method through the same captured constructor
  f.run("new Intl.DateTimeFormat('en',{timeZone:'UTC'})");
  assert.equal(f.run('constructions'), 1);
  assert.equal(f.guard.snapshot().changed, 0);
  f.run("new Intl.DateTimeFormat('en')");
  assert.equal(f.run('constructions'), 3, 'a missing zone adds exactly one private construction');
  assert.equal(f.guard.snapshot().changed, 1);
});

test('Intl preserves one caller options pass, native invalid-option errors and thrown identity', () => {
  const f = fixture();
  assert.equal(f.run(`(()=>{
    let nativeGets=0,customGets=0;const make=counter=>({get year(){counter();return 'numeric';},get timeZone(){counter();return 'UTC';}});
    new originals.DateTimeFormat('en-US',make(()=>nativeGets++));
    new Intl.DateTimeFormat('en-US',make(()=>customGets++));
    const marker={};let caught=false;try{new Intl.DateTimeFormat('en-US',{get timeZone(){throw marker;}});}catch(error){caught=error===marker;}
    return nativeGets===customGets&&customGets>0&&caught;
  })()`), true);
  assert.equal(f.run(`(()=>{
    let nativeGets=0,customGets=0;const make=counter=>({get year(){counter();return 'numeric';}});
    new originals.DateTimeFormat(undefined,make(()=>nativeGets++));
    new Intl.DateTimeFormat(undefined,make(()=>customGets++));
    return nativeGets===1&&customGets===1;
  })()`), true);
  for (const expression of [
    "new Intl.DateTimeFormat('bad_locale')", "new Intl.DateTimeFormat('en',{timeZone:'not/a_zone'})",
    "new Intl.NumberFormat('en',{style:'currency'})", "new Intl.NumberFormat('en',{maximumFractionDigits:-1})",
    "new Intl.Collator('en',{sensitivity:'invalid'})", "Intl.RelativeTimeFormat()",
    "new Intl.DateTimeFormat(null)", "new Intl.NumberFormat(null)", "new Intl.DateTimeFormat('')", "new Intl.DateTimeFormat(undefined,{timeZone:'not/a_zone'})"
  ]) {
    const original = expression.replace(/Intl\./g, 'originals.');
    const errorName = f.run(`(()=>{try{${original};return null;}catch(error){return error.name;}})()`);
    assert.ok(errorName);
    assert.equal(f.run(`(()=>{try{${expression};return null;}catch(error){return error.name;}})()`), errorName);
  }
});

test('Intl locale-only profiles use the selected locale hour/calendar/numbering defaults',()=>{
  for(const locale of ['fr-FR','th-TH','ar-EG','fr-FR-u-ca-buddhist-hc-h24-nu-arab']){
    const f=fixture({locale});f.realm.selectedLocale=locale;
    assert.equal(f.run(`(()=>{
      const options={year:'numeric',month:'long',day:'numeric',hour:'numeric',minute:'numeric'};
      const result=new Intl.DateTimeFormat(undefined,options),expected=new originals.DateTimeFormat(selectedLocale,options);
      return JSON.stringify(result.resolvedOptions())===JSON.stringify(expected.resolvedOptions())&&result.format(0)===expected.format(0)&&
        JSON.stringify(result.formatToParts(0))===JSON.stringify(expected.formatToParts(0));
    })()`),true,locale+' DateTimeFormat');
    assert.equal(f.run(`(()=>{const result=new Intl.NumberFormat(),expected=new originals.NumberFormat(selectedLocale);return JSON.stringify(result.resolvedOptions())===JSON.stringify(expected.resolvedOptions())&&result.format(12345.67)===expected.format(12345.67);})()`),true,locale+' NumberFormat');
    assert.equal(f.run(`(()=>{const result=new Intl.DateTimeFormat(),expected=new originals.DateTimeFormat(selectedLocale);return result.resolvedOptions().calendar===expected.resolvedOptions().calendar&&result.resolvedOptions().numberingSystem===expected.resolvedOptions().numberingSystem&&result.format(0)===expected.format(0);})()`),true,locale+' omitted options');
    // The same page-visible request with an explicit locale is the native request, not the selected one.
    assert.equal(f.run(`(()=>{const result=new Intl.DateTimeFormat('en-US',{hour:'numeric'}),expected=new originals.DateTimeFormat('en-US',{hour:'numeric'});return JSON.stringify(result.resolvedOptions())===JSON.stringify(expected.resolvedOptions())&&result.format(0)===expected.format(0);})()`),true,locale+' explicit locale');
  }
});
test('Intl preserves explicit primitive options while locale defaults are selected anew',()=>{
  const f=fixture({locale:'fr-FR'});
  for(const options of [
    {hour:'numeric',hour12:true}, {hour:'numeric',hourCycle:'h24'}, {hour:'numeric',hour12:false,hourCycle:'h11'},
    {year:'numeric',calendar:'buddhist',numberingSystem:'arab'},
    {hour:'numeric',formatMatcher:'basic',localeMatcher:'lookup'}, {year:'numeric',calendar:'unknown',numberingSystem:'unknown'}
  ]){
    f.realm.selectedOptions=options;
    assert.equal(f.run(`(()=>{const result=new Intl.DateTimeFormat(undefined,selectedOptions),expected=new originals.DateTimeFormat('fr-FR',selectedOptions);return JSON.stringify(result.resolvedOptions())===JSON.stringify(expected.resolvedOptions())&&result.format(0)===expected.format(0);})()`),true,JSON.stringify(options));
  }
  // Selected calendar/numbering fill only what the page did not request; an explicit request wins.
  const override=fixture({locale:'fr-FR',calendar:'buddhist',numberingSystem:'arab'});
  assert.equal(override.run(`(()=>{const result=new Intl.DateTimeFormat(undefined,{year:'numeric',calendar:'gregory',numberingSystem:'latn'});return result.resolvedOptions().calendar==='gregory'&&result.resolvedOptions().numberingSystem==='latn'&&result.resolvedOptions().locale==='fr-FR';})()`),true);
  assert.equal(override.run(`(()=>{const result=new Intl.DateTimeFormat(undefined,{year:'numeric'});return result.resolvedOptions().calendar==='buddhist'&&result.resolvedOptions().numberingSystem==='arab';})()`),true);
  assert.equal(override.run(`(()=>{const result=new Intl.DateTimeFormat(undefined,{year:'numeric',calendar:'gregory'});return result.resolvedOptions().calendar==='gregory'&&result.resolvedOptions().numberingSystem==='arab';})()`),true);
});
test('Intl option forwarding preserves getter receiver, Proxy trap receiver/order/count and frozen option invariants',()=>{
  const f=fixture({locale:'fr-FR'});
  assert.equal(f.run(`(()=>{
    const make=log=>{const target={get hour(){if(this!==proxy)throw Error('getter receiver');return 'numeric';},get hour12(){if(this!==proxy)throw Error('getter receiver');return undefined;}};
      const proxy=new Proxy(target,{get(target,key,receiver){log.push([String(key),receiver===proxy]);return Reflect.get(target,key,receiver);}});return proxy;};
    const nativeLog=[],customLog=[];new originals.DateTimeFormat('en-US',make(nativeLog));new Intl.DateTimeFormat('en-US',make(customLog));
    const defaultNativeLog=[],defaultCustomLog=[];new originals.DateTimeFormat(undefined,make(defaultNativeLog));new Intl.DateTimeFormat(undefined,make(defaultCustomLog));
    const options=Object.freeze({hour:'numeric',hour12:true,calendar:'buddhist'});
    const result=new Intl.DateTimeFormat(undefined,options),expected=new originals.DateTimeFormat('fr-FR',options);
    const explicit=new Intl.DateTimeFormat('en-US',options),explicitExpected=new originals.DateTimeFormat('en-US',options);
    return JSON.stringify(nativeLog)===JSON.stringify(customLog)&&customLog.every(row=>row[1])&&JSON.stringify(defaultNativeLog)===JSON.stringify(defaultCustomLog)&&defaultCustomLog.every(row=>row[1])&&
      result.format(0)===expected.format(0)&&explicit.format(0)===explicitExpected.format(0);
  })()`),true);
});
test('Intl coercive option values are consumed once and only normalized primitives reach the selected formatter',()=>{
  const f=fixture({locale:'fr-FR'});
  assert.equal(f.run(`(()=>{
    let nativeCoercions=0,customCoercions=0;
    const make=count=>({hour:{toString(){count();return 'numeric';}},calendar:{toString(){count();return 'buddhist';}},numberingSystem:{toString(){count();return 'arab';}}});
    new originals.DateTimeFormat('en-US',make(()=>nativeCoercions++));const result=new Intl.DateTimeFormat(undefined,make(()=>customCoercions++));
    const expected=new originals.DateTimeFormat('fr-FR',{hour:'numeric',calendar:'buddhist',numberingSystem:'arab'});
    return customCoercions===nativeCoercions&&customCoercions===3&&result.format(0)===expected.format(0);
  })()`), true);
  const before=f.guard.snapshot().unavailable;
  assert.equal(f.run(`(()=>{let calls=0;const result=new Intl.DateTimeFormat('en-US',{hour:'numeric',formatMatcher:{toString(){calls++;return 'basic';}}});return calls===1&&result.resolvedOptions().locale==='en-US';})()`), true);
  assert.equal(f.guard.snapshot().unavailable,before,'an explicit locale with nothing to fill never reaches the projection');
  assert.equal(f.run(`(()=>{let calls=0;const result=new Intl.DateTimeFormat(undefined,{hour:'numeric',formatMatcher:{toString(){calls++;return 'basic';}}});return calls===1&&result.resolvedOptions().locale===new originals.DateTimeFormat().resolvedOptions().locale;})()`), true);
  assert.equal(f.guard.snapshot().unavailable,before+1,'unresolved coercive matcher is a native boundary, not a second coercion');
});
test('Intl primitive option boxing remains the original native operation with explicit unavailable projection',()=>{
  const f=fixture({locale:'fr-FR'});
  assert.equal(f.run(`(()=>{
    let reads=0;Object.defineProperty(Number.prototype,'hour',{configurable:true,get(){reads++;return 'numeric';}});
    const result=new Intl.DateTimeFormat('en-US',42),expected=new originals.DateTimeFormat('en-US',42);
    delete Number.prototype.hour;return reads===2&&result.format(0)===expected.format(0)&&result.resolvedOptions().locale==='en-US';
  })()`), true);
  assert.equal(f.guard.snapshot().unavailable,1);assert.equal(f.guard.snapshot().changed,0);
});

test('Intl genuine selected objects retain arbitrary native formatting coercion, bound identity and invalid receivers', () => {
  const f = fixture();
  assert.equal(f.run(`(()=>{
    const dtf=new Intl.DateTimeFormat(),nf=new Intl.NumberFormat(),collator=new Intl.Collator();
    let dates=0,numbers=0,strings=0;const marker={};
    dtf.format({[Symbol.toPrimitive](hint){if(hint!=='number')throw Error('hint');dates++;return 0;}});
    nf.format({valueOf(){numbers++;return 1234.5;}});collator.compare({toString(){strings++;return 'ä';}},'z');
    let caught=false;try{nf.format({valueOf(){throw marker;}});}catch(error){caught=error===marker;}
    let invalid=false;try{Intl.DateTimeFormat.prototype.resolvedOptions.call({});}catch(error){invalid=error.name==='TypeError';}
    return dates===1&&numbers===1&&strings===1&&caught&&invalid&&dtf.format===dtf.format&&nf.format===nf.format&&collator.compare===collator.compare;
  })()`), true);
});

test('Intl constructor preserves subclass/newTarget prototype reads once and native prototype identity', () => {
  const f = fixture();
  assert.equal(f.run(`(()=>{
    class Child extends Intl.DateTimeFormat{};const result=new Child('en');
    let reads=0;const prototype={};const newTarget=new Proxy(function(){},{get(target,key,receiver){if(key==='prototype'){reads++;return prototype;}return Reflect.get(target,key,receiver);}});
    const custom=Reflect.construct(Intl.DateTimeFormat,['en'],newTarget);
    const explicit=new Child('en',{timeZone:'UTC'});
    return result instanceof Child&&result instanceof Intl.DateTimeFormat&&nativePrototype(result)===Child.prototype&&
      originals.DateTimeFormat.prototype.resolvedOptions.call(result).timeZone==='Pacific/Honolulu'&&
      originals.DateTimeFormat.prototype.resolvedOptions.call(explicit).timeZone==='UTC'&&nativePrototype(explicit)===Child.prototype&&
      nativePrototype(custom)===prototype&&reads===1&&Intl.DateTimeFormat.prototype.constructor===Intl.DateTimeFormat;
  })()`), true);
});

test('Intl callable factories preserve legacy ChainDateTimeFormat/NumberFormat identity with explicit unavailable boundary', () => {
  const f = fixture();
  for (const name of ['DateTimeFormat', 'NumberFormat']) {
    f.realm.name = name;
    assert.equal(f.run(`(()=>{const chain=Object.create(Intl[name].prototype);const result=Intl[name].call(chain,'en-US');return result===chain&&typeof result.format==='function';})()`), true);
  }
  assert.equal(f.guard.snapshot().unavailable, 2);
  assert.equal(f.guard.snapshot().changed, 0);
  assert.equal(f.run("Intl.DateTimeFormat('en-US').resolvedOptions().timeZone"), 'Pacific/Honolulu');
});

test('Intl optional factories keep their genuine behavior and selected locale', () => {
  const f = fixture({ locale: 'fr-FR', numberingSystem: 'arab' });
  const cases = [
    ['RelativeTimeFormat', "new Intl.RelativeTimeFormat().format(-2,'day')", "new originals.RelativeTimeFormat('fr-FR',{numberingSystem:'arab'}).format(-2,'day')"],
    ['PluralRules', "new Intl.PluralRules().select(0)", "new originals.PluralRules('fr-FR').select(0)"],
    ['ListFormat', "new Intl.ListFormat().format(['a','b'])", "new originals.ListFormat('fr-FR').format(['a','b'])"],
    ['DisplayNames', "new Intl.DisplayNames(undefined,{type:'region'}).of('DE')", "new originals.DisplayNames('fr-FR',{type:'region'}).of('DE')"],
    ['Segmenter', "Array.from(new Intl.Segmenter(undefined,{granularity:'word'}).segment('un mot')).map(row=>row.segment).join('|')", "Array.from(new originals.Segmenter('fr-FR',{granularity:'word'}).segment('un mot')).map(row=>row.segment).join('|')"]
  ];
  for (const [name, actual, expected] of cases) if (f.run('typeof originals.' + name) === 'function') assert.equal(f.run(actual), f.run(expected), name);
});

test('Intl applies only relevant selected fields, snapshots values, and leaves existing instances native', () => {
  const realm = context();
  vm.runInContext("globalThis.existing=new Intl.DateTimeFormat('en',{timeZone:'UTC'});", realm);
  const installer = vm.runInContext('(' + installIntlCustom.toString() + ')', realm);
  const value = { timeZone: 'Pacific/Honolulu' }, guard = installer(vm.runInContext('globalThis', realm), entry(value));
  value.timeZone = 'Asia/Tokyo';
  assert.equal(vm.runInContext("existing.resolvedOptions().timeZone==='UTC'&&new Intl.DateTimeFormat('en').resolvedOptions().timeZone==='Pacific/Honolulu'&&new Intl.DateTimeFormat('en',{timeZone:'UTC'}).resolvedOptions().timeZone==='UTC'&&Intl.NumberFormat===originals.NumberFormat&&Intl.Collator===originals.Collator", realm), true);
  assert.equal(guard.snapshot().installed, 1);
});

test('Intl missing/accessor APIs are not manufactured or read and absent value/dormant modes do not install', () => {
  const f = fixture({ locale: 'fr-FR' }, `globalThis.reads=0;delete Intl.Segmenter;Object.defineProperty(Intl,'NumberFormat',{configurable:true,get(){reads++;throw Error('page constructor getter');}});`);
  assert.equal(f.run('reads'), 0); assert.equal(f.run("'Segmenter' in Intl"), false);
  assert.ok(f.guard.snapshot().unavailable >= 2);
  for (const mode of ['off', 'bypass', 'on']) {
    const realm = context(), installer = vm.runInContext('(' + installIntlCustom.toString() + ')', realm);
    let reads = 0;
    const guard = installer(vm.runInContext('globalThis', realm), [{ id: 'intl-formatting', mode, get value() { reads++;throw Error('dormant'); } }]);
    assert.equal(reads, 0); assert.equal(guard.snapshot().installed, 0);
    assert.equal(vm.runInContext('Intl.DateTimeFormat===originals.DateTimeFormat', realm), true);
  }
  const empty = fixture({}); assert.equal(empty.guard.snapshot().installed, 0);
});

test('Intl absent or accessor-only realm Intl reports unavailable without synthesizing or invoking it', () => {
  for (const accessor of [false, true]) {
    const realm = context(), installer = vm.runInContext('(' + installIntlCustom.toString() + ')', realm);
    const target = {}; let reads = 0;
    if (accessor) Object.defineProperty(target, 'Intl', { configurable: true, get() { reads++;throw Error('Absent native Intl'); } });
    const guard = installer(target, entry({ locale: 'fr-FR' }));
    assert.equal(reads, 0);assert.equal(guard.snapshot().installed, 0);assert.equal(guard.snapshot().unavailable, 1);
    assert.equal(guard.snapshot().constructors.length, 0);
    assert.equal(Object.hasOwn(target, 'Intl'), accessor);
  }
});

test('Intl inherited child outputs retain child prototype and survive later parent intrinsic/iterator poisoning', () => {
  const parent = context(), child = context();
  const installer = vm.runInContext('(' + installIntlCustom.toString() + ')', parent);
  installer(vm.runInContext('globalThis', parent), entry({ locale: 'fr-FR', timeZone: 'Pacific/Honolulu' }));
  vm.runInContext(`const define=Object.defineProperty,names=['create','defineProperty','getOwnPropertyDescriptor','getPrototypeOf','setPrototypeOf'];
    for(let index=0;index<names.length;index++)Object[names[index]]=()=>{throw Error('page intrinsic');};
    define(Array.prototype,Symbol.iterator,{configurable:true,value(){throw Error('page iterator');}});`, parent);
  const guard = installer(vm.runInContext('globalThis', child), entry({ locale: 'de-DE', timeZone: 'Asia/Tokyo' }));
  assert.ok(guard.snapshot().installed >= 3);
  assert.equal(vm.runInContext(`(()=>{const f=new Intl.DateTimeFormat('en');return nativePrototype(f)===Intl.DateTimeFormat.prototype&&nativePrototype(f.resolvedOptions())===Object.prototype&&f.resolvedOptions().timeZone==='Asia/Tokyo'&&nativePrototype(f.formatToParts(0))===Array.prototype;})()`, child), true);
});

test('Intl late page constructor is called only for requested operation; private shadow uses pristine constructor and authentic native slots', () => {
  const realm = context(), installer = vm.runInContext('(' + installIntlCustom.toString() + ')', realm);
  installer(vm.runInContext('globalThis', realm), []);
  vm.runInContext(`globalThis.requested=0;globalThis.argReads=0;
    Intl.DateTimeFormat=new Proxy(originals.DateTimeFormat,{construct(target,args,newTarget){requested++;return Reflect.construct(target,args,newTarget);}});`, realm);
  installer(vm.runInContext('globalThis', realm), entry({ timeZone: 'Pacific/Honolulu' }));
  assert.equal(vm.runInContext(`new Intl.DateTimeFormat('en',{get year(){argReads++;return 'numeric';}}).resolvedOptions().timeZone`, realm), 'Pacific/Honolulu');
  assert.equal(vm.runInContext('requested===1&&argReads===1', realm), true);
  assert.equal(vm.runInContext(`new Intl.DateTimeFormat('en',{get timeZone(){argReads++;return 'UTC';}}).resolvedOptions().timeZone`, realm), 'UTC');
  assert.equal(vm.runInContext('requested===2&&argReads===2', realm), true, 'an explicit zone needs no private shadow');
});

test('Intl requested and private constructions total two, while caller options run only in the first', () => {
  const f = fixture({ timeZone: 'Pacific/Honolulu' }, `
    globalThis.constructions=[];globalThis.callerOptions={get year(){globalThis.optionReads=(globalThis.optionReads||0)+1;return 'numeric';}};
    Intl.DateTimeFormat=new Proxy(originals.DateTimeFormat,{construct(target,args,newTarget){constructions.push({options:args[1],newTarget});return Reflect.construct(target,args,newTarget);}});
  `);
  assert.equal(f.run("new Intl.DateTimeFormat('en',callerOptions).resolvedOptions().timeZone"), 'Pacific/Honolulu');
  assert.equal(f.run('constructions.length===2&&constructions[0].options!==constructions[1].options&&constructions[1].options!==callerOptions&&nativePrototype(constructions[1].options)===null&&optionReads===1'), true);
  assert.equal(f.run(`(()=>{const marker={};try{new Intl.DateTimeFormat('en',{get timeZone(){throw marker;}});}catch(error){return error===marker&&constructions.length===3;}return false;})()`), true);
});

test('Intl valid style/rounding options survive private construction and stop during original options prevents projection', () => {
  const f = fixture({ locale: 'fr-FR', timeZone: 'Pacific/Honolulu' });
  for (const expression of [
    "new Intl.DateTimeFormat('en',{dateStyle:'full',timeStyle:'long'}).format(0)",
    "new Intl.DateTimeFormat(undefined,{dateStyle:'full',timeStyle:'long'}).format(0)",
    "new Intl.NumberFormat('en',{minimumSignificantDigits:3,maximumSignificantDigits:5}).format(1234.567)",
    "new Intl.NumberFormat(undefined,{minimumSignificantDigits:3,maximumSignificantDigits:5}).format(1234.567)",
    "new Intl.NumberFormat(undefined,{style:'unit',unit:'kilometer-per-hour',notation:'compact'}).format(1234.5)",
    "new Intl.PluralRules(undefined,{type:'ordinal',maximumFractionDigits:2}).select(2)"
  ]) assert.equal(typeof f.run(expression), 'string');
  assert.equal(f.guard.snapshot().unavailable, 0);
  f.realm.stopInstallation = f.guard.stop;
  assert.equal(f.run(`new Intl.DateTimeFormat('en',{get timeZone(){stopInstallation();return 'UTC';}}).resolvedOptions().timeZone`), 'UTC');
});

test('Intl private ownership restore preserves newer descriptor and retained constructor becomes native after stop', () => {
  const f = fixture({ timeZone: 'Pacific/Honolulu' });
  f.run('globalThis.retained=Intl.DateTimeFormat;');
  f.guard.stop();
  assert.equal(f.run("Intl.DateTimeFormat===originals.DateTimeFormat&&new retained('en',{timeZone:'UTC'}).resolvedOptions().timeZone==='UTC'&&Intl.DateTimeFormat.prototype.constructor===originals.DateTimeFormat"), true);
  const next = fixture({ timeZone: 'Pacific/Honolulu' });
  next.run("globalThis.replacement=function PageIntl(){};Intl.DateTimeFormat=replacement;"); next.guard.stop();
  assert.equal(next.run('Intl.DateTimeFormat===replacement'), true);
});

test('Intl serialized installer has no module dependency and snapshots contain counters only', () => {
  const f = fixture({ locale: 'fr-FR' }); f.run("new Intl.NumberFormat().format(123.4)");
  const snapshot = f.guard.snapshot();
  sameJson(Object.keys(snapshot).sort(), ['changed', 'constructors', 'installed', 'localeMethods', 'stopped', 'unavailable'].sort());
  assert.equal(snapshot.changed, 1); assert.equal(snapshot.constructors.some(row => 'locale' in row || 'timeZone' in row || 'input' in row || 'result' in row), false);
  assert.equal(snapshot.localeMethods.some(row => Object.keys(row).sort().join() !== 'changed,installed,name,unavailable'), false);
});
