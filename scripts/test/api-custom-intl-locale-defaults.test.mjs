import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { installIntlCustom } from '../../apps/production-extension/api-custom-intl-runtime.js';

// Narrow exception under test (same kind as the ADR-100 Temporal.Now default): for the locale-sensitive
// built-ins only an omitted/undefined locales argument, and options the page did not provide, receive the
// selected Intl values, inside the one native call. Everything else is the original call.
const entry = value => [{ id: 'intl-formatting', mode: 'custom', value }];
function context() {
  const realm = vm.createContext({});
  vm.runInContext(`globalThis.window=globalThis;
    globalThis.originals={};for(const name of ['DateTimeFormat','NumberFormat','Collator'])originals[name]=Intl[name];
    globalThis.native={
      dateString:Date.prototype.toLocaleString,dateDate:Date.prototype.toLocaleDateString,dateTime:Date.prototype.toLocaleTimeString,
      number:Number.prototype.toLocaleString,bigint:BigInt.prototype.toLocaleString,compare:String.prototype.localeCompare,
      upper:String.prototype.toLocaleUpperCase,lower:String.prototype.toLocaleLowerCase,call:Reflect.apply
    };
    globalThis.moment=new Date(Date.UTC(2020,0,15,13,5,9));
  `, realm);
  return realm;
}
function fixture(value = { locale: 'ru-RU' }, setup = '') {
  const realm = context(); if (setup) vm.runInContext(setup, realm);
  const installer = vm.runInContext('(' + installIntlCustom.toString() + ')', realm);
  const guard = installer(vm.runInContext('globalThis', realm), entry(value));
  return { realm, installer, guard, run: source => vm.runInContext(source, realm) };
}
// Each in-realm probe returns a list of mismatches; an empty string means every comparison held.
const CHECK = 'const bad=[];const check=(name,actual,expected)=>{if(actual!==expected)bad.push(name+": "+JSON.stringify(actual)+" !== "+JSON.stringify(expected));};';
const FIELDS = {
  dateString: { year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' },
  dateDate: { year: 'numeric', month: 'numeric', day: 'numeric' },
  dateTime: { hour: 'numeric', minute: 'numeric', second: 'numeric' }
};
const sameJson = (actual, expected) => assert.deepEqual(JSON.parse(JSON.stringify(actual)), JSON.parse(JSON.stringify(expected)));

test('omitted locale: Number, BigInt and Array/TypedArray elements behave as if the selected locale had been passed', () => {
  const f = fixture({ locale: 'ru-RU' });
  assert.equal(f.run(`(()=>{${CHECK}
    check('number',(1234567.891).toLocaleString(),native.call(native.number,1234567.891,['ru-RU']));
    check('number undefined',(1234567.891).toLocaleString(undefined),native.call(native.number,1234567.891,['ru-RU']));
    check('number matches Intl',(1234567.891).toLocaleString(),new originals.NumberFormat('ru-RU').format(1234567.891));
    check('number options',(0.5).toLocaleString(undefined,{style:'percent'}),native.call(native.number,0.5,['ru-RU',{style:'percent'}]));
    check('number currency',(1234.5).toLocaleString(undefined,{style:'currency',currency:'RUB'}),new originals.NumberFormat('ru-RU',{style:'currency',currency:'RUB'}).format(1234.5));
    check('number options undefined',(1234.5).toLocaleString(undefined,undefined),new originals.NumberFormat('ru-RU').format(1234.5));
    check('negative zero',(-0).toLocaleString(),native.call(native.number,-0,['ru-RU']));
    check('NaN',NaN.toLocaleString(),native.call(native.number,NaN,['ru-RU']));
    check('boxed',new Number(7.5).toLocaleString(),native.call(native.number,7.5,['ru-RU']));
    check('bigint',(12345678901234567890n).toLocaleString(),new originals.NumberFormat('ru-RU').format(12345678901234567890n));
    check('bigint options',(1234567n).toLocaleString(undefined,{style:'currency',currency:'EUR'}),native.call(native.bigint,1234567n,['ru-RU',{style:'currency',currency:'EUR'}]));
    check('array',[1234.5,1234567.891].toLocaleString(),native.call(Array.prototype.toLocaleString,[1234.5,1234567.891],['ru-RU']));
    check('array holes and nullish',[null,undefined,1234.5].toLocaleString(),native.call(Array.prototype.toLocaleString,[null,undefined,1234.5],['ru-RU']));
    check('array of dates',[moment].toLocaleString(),native.call(Array.prototype.toLocaleString,[moment],['ru-RU']));
    check('float typed array',new Float64Array([1234.5,0.25]).toLocaleString(),native.call(Float64Array.prototype.toLocaleString,new Float64Array([1234.5,0.25]),['ru-RU']));
    check('bigint typed array',new BigInt64Array([1234567n]).toLocaleString(),native.call(BigInt64Array.prototype.toLocaleString,new BigInt64Array([1234567n]),['ru-RU']));
    return bad.join('; ');
  })()`), '');
  assert.equal(f.guard.snapshot().unavailable, 0);
});

test('omitted locale: Date methods equal the native call with the selected locale and the matching DateTimeFormat', () => {
  const f = fixture({ locale: 'ru-RU' });
  for (const [method, name] of [['toLocaleString', 'dateString'], ['toLocaleDateString', 'dateDate'], ['toLocaleTimeString', 'dateTime']]) {
    f.realm.method = method; f.realm.nativeName = name; f.realm.fields = FIELDS[name];
    assert.equal(f.run(`(()=>{${CHECK}
      check('default',moment[method](),native.call(native[nativeName],moment,['ru-RU']));
      check('undefined',moment[method](undefined),native.call(native[nativeName],moment,['ru-RU']));
      check('undefined options',moment[method](undefined,undefined),native.call(native[nativeName],moment,['ru-RU']));
      check('Intl equivalent',moment[method](),new originals.DateTimeFormat('ru-RU',fields).format(moment));
      const options={weekday:'long',month:'long',day:'numeric',hour:'numeric',minute:'numeric'};
      check('options',moment[method](undefined,options),native.call(native[nativeName],moment,['ru-RU',options]));
      check('explicit zone',moment[method](undefined,{timeZone:'UTC'}),native.call(native[nativeName],moment,['ru-RU',{timeZone:'UTC'}]));
      check('hour12',moment[method](undefined,{hour:'numeric',hour12:true}),native.call(native[nativeName],moment,['ru-RU',{hour:'numeric',hour12:true}]));
      return bad.join('; ');
    })()`), '', method);
  }
  assert.equal(f.run("new Date(NaN).toLocaleString()+'|'+new Date(NaN).toLocaleDateString()+'|'+new Date(NaN).toLocaleTimeString()"), 'Invalid Date|Invalid Date|Invalid Date');
  assert.equal(f.guard.snapshot().unavailable, 0);
});

test('omitted locale: localeCompare follows the selected collator and the case mappings the selected language', () => {
  const sv = fixture({ locale: 'sv-SE' });
  assert.equal(sv.run(`(()=>{${CHECK}
    check('ä after z in Swedish',"ä".localeCompare('z'),1);
    check('matches Intl.Collator',"ä".localeCompare('z'),new originals.Collator('sv-SE').compare("ä",'z'));
    check('undefined',"ä".localeCompare('z',undefined),1);
    check('sort',['z',"ä",'a'].sort((x,y)=>x.localeCompare(y)).join(''),['z',"ä",'a'].sort(new originals.Collator('sv-SE').compare).join(''));
    check('options',"a".localeCompare('B',undefined,{sensitivity:'base'}),native.call(native.compare,'a',['B','sv-SE',{sensitivity:'base'}]));
    check('numeric',"a2".localeCompare('a10',undefined,{numeric:true}),-1);
    check('no argument',"undefined".localeCompare(),native.call(native.compare,'undefined',[undefined,'sv-SE']));
    check('explicit locale wins',"ä".localeCompare('z','en-US'),native.call(native.compare,"ä",['z','en-US']));
    check('explicit list wins',"ä".localeCompare('z',['de-DE']),native.call(native.compare,"ä",['z',['de-DE']]));
    return bad.join('; ');
  })()`), '');
  const tr = fixture({ locale: 'tr-TR' });
  assert.equal(tr.run(`(()=>{${CHECK}
    check('upper i',"i".toLocaleUpperCase(),'İ');
    check('lower I',"I".toLocaleLowerCase(),'ı');
    check('upper undefined',"i".toLocaleUpperCase(undefined),'İ');
    check('explicit en wins',"i".toLocaleUpperCase('en-US'),'I');
    check('explicit en wins lower',"I".toLocaleLowerCase('en-US'),'i');
    check('explicit tr',"i".toLocaleUpperCase('tr'),'İ');
    check('plain ascii',"Hello".toLocaleUpperCase(),native.call(native.upper,'Hello',['tr-TR']));
    return bad.join('; ');
  })()`), '');
  assert.equal(sv.guard.snapshot().unavailable + tr.guard.snapshot().unavailable, 0);
});

test('explicit locale is the native call: strings, lists, options and every argument position stay as passed', () => {
  const f = fixture({ locale: 'ru-RU' });
  assert.equal(f.run(`(()=>{${CHECK}
    check('number',(1234567.891).toLocaleString('en-US'),native.call(native.number,1234567.891,['en-US']));
    check('number list',(1234567.891).toLocaleString(['xx-XX','de-DE']),native.call(native.number,1234567.891,[['xx-XX','de-DE']]));
    check('number options',(1234.5).toLocaleString('de-DE',{style:'currency',currency:'EUR'}),new originals.NumberFormat('de-DE',{style:'currency',currency:'EUR'}).format(1234.5));
    check('bigint',(1234567n).toLocaleString('de-DE'),native.call(native.bigint,1234567n,['de-DE']));
    check('date',moment.toLocaleDateString('en-US',{timeZone:'UTC'}),native.call(native.dateDate,moment,['en-US',{timeZone:'UTC'}]));
    check('date string',moment.toLocaleString('en-GB',{timeZone:'UTC'}),native.call(native.dateString,moment,['en-GB',{timeZone:'UTC'}]));
    check('time',moment.toLocaleTimeString('de-DE',{timeZone:'UTC'}),native.call(native.dateTime,moment,['de-DE',{timeZone:'UTC'}]));
    check('compare',"ä".localeCompare('z','sv'),native.call(native.compare,"ä",['z','sv']));
    check('upper',"i".toLocaleUpperCase('tr'),native.call(native.upper,'i',['tr']));
    check('lower',"I".toLocaleLowerCase('tr'),native.call(native.lower,'I',['tr']));
    check('array explicit',[1234.5].toLocaleString('de-DE'),native.call(Array.prototype.toLocaleString,[1234.5],['de-DE']));
    check('empty list is not undefined',(1234567.891).toLocaleString([]),native.call(native.number,1234567.891,[[]]));
    return bad.join('; ');
  })()`), '');
  assert.equal(f.guard.snapshot().changed, 0, 'explicit requests are never counted as changed');
});

test('invalid and null locale arguments, wrong receivers and thrown errors are exactly the native ones', () => {
  const f = fixture({ locale: 'ru-RU' });
  const probe = (label, expression) => {
    const result = f.run(`(()=>{try{${expression};return 'no error';}catch(error){return error.name+': '+error.message;}})()`);
    return { label, result };
  };
  const pairs = [
    ['null locale number', "(1234.5).toLocaleString(null)", "native.call(native.number,1234.5,[null])"],
    ['null locale date', "moment.toLocaleString(null)", "native.call(native.dateString,moment,[null])"],
    ['null locale compare', "'a'.localeCompare('b',null)", "native.call(native.compare,'a',['b',null])"],
    ['null locale upper', "'a'.toLocaleUpperCase(null)", "native.call(native.upper,'a',[null])"],
    ['bad tag number', "(1).toLocaleString('bad_locale')", "native.call(native.number,1,['bad_locale'])"],
    ['empty tag date', "moment.toLocaleDateString('')", "native.call(native.dateDate,moment,[''])"],
    ['bad zone', "moment.toLocaleString(undefined,{timeZone:'not/a_zone'})", "native.call(native.dateString,moment,['ru-RU',{timeZone:'not/a_zone'}])"],
    ['bad option', "(1).toLocaleString(undefined,{style:'currency'})", "native.call(native.number,1,['ru-RU',{style:'currency'}])"],
    ['null options date', "moment.toLocaleString(undefined,null)", "native.call(native.dateString,moment,['ru-RU',null])"],
    ['null options number', "(1).toLocaleString(undefined,null)", "native.call(native.number,1,['ru-RU',null])"],
    ['date wrong receiver', "Date.prototype.toLocaleString.call({})", "native.call(native.dateString,{},[])"],
    ['date string receiver', "Date.prototype.toLocaleDateString.call('2020')", "native.call(native.dateDate,'2020',[])"],
    ['time wrong receiver', "Date.prototype.toLocaleTimeString.call(undefined)", "native.call(native.dateTime,undefined,[])"],
    ['number wrong receiver', "Number.prototype.toLocaleString.call('x')", "native.call(native.number,'x',[])"],
    ['bigint wrong receiver', "BigInt.prototype.toLocaleString.call(1)", "native.call(native.bigint,1,[])"],
    ['compare null receiver', "String.prototype.localeCompare.call(null,'a')", "native.call(native.compare,null,['a'])"],
    ['upper undefined receiver', "String.prototype.toLocaleUpperCase.call(undefined)", "native.call(native.upper,undefined,[])"],
    ['lower null receiver', "String.prototype.toLocaleLowerCase.call(null)", "native.call(native.lower,null,[])"]
  ];
  for (const [label, custom, nativeExpression] of pairs) {
    const actual = probe(label, custom), expected = probe(label, nativeExpression);
    assert.notEqual(expected.result, 'no error', label + ' must be an error natively');
    assert.equal(actual.result, expected.result, label);
  }
  // The same error object is rethrown, not a copy.
  assert.equal(f.run(`(()=>{const marker={};try{moment.toLocaleString(undefined,{get hour(){throw marker;}});}catch(error){return error===marker;}return false;})()`), true);
  assert.equal(f.run(`(()=>{const marker={};try{(1).toLocaleString(undefined,{get style(){throw marker;}});}catch(error){return error===marker;}return false;})()`), true);
  assert.equal(f.run(`(()=>{const marker={};try{String.prototype.localeCompare.call({toString(){throw marker;}},'a');}catch(error){return error===marker;}return false;})()`), true);
});

test('the original is called exactly once with the original receiver and a copy of the arguments', () => {
  const setup = `globalThis.calls=[];
    const hook=(owner,name)=>{const original=owner[name];Object.defineProperty(owner,name,{value:{[name]:function(){'use strict';calls.push({name,self:this,args:Array.prototype.slice.call(arguments)});return Reflect.apply(original,this,arguments);}}[name],writable:true,configurable:true});};
    for(const name of ['toLocaleString','toLocaleDateString','toLocaleTimeString'])hook(Date.prototype,name);
    hook(Number.prototype,'toLocaleString');hook(BigInt.prototype,'toLocaleString');
    for(const name of ['localeCompare','toLocaleUpperCase','toLocaleLowerCase'])hook(String.prototype,name);`;
  const f = fixture({ locale: 'ru-RU' }, setup);
  assert.equal(f.run(`(()=>{${CHECK}
    const options={style:'percent'},input=[];
    const result=Reflect.apply(Number.prototype.toLocaleString,0.5,input);
    check('calls',calls.length,1);check('receiver',calls[0].self,0.5);check('forwarded',calls[0].args.length,1);check('locale',calls[0].args[0],'ru-RU');
    check('caller list untouched',input.length,0);
    check('result',result,native.call(native.number,0.5,['ru-RU']));
    calls.length=0;(0.5).toLocaleString(undefined,options);
    check('options calls',calls.length,1);check('options forwarded',calls[0].args.length,2);check('same options object',calls[0].args[1],options);
    calls.length=0;moment.toLocaleString(undefined,undefined,'extra');
    check('extra arguments kept',calls.length===1&&calls[0].args.length===3&&calls[0].args[0]==='ru-RU'&&calls[0].args[1]===undefined&&calls[0].args[2]==='extra',true);
    calls.length=0;moment.toLocaleDateString('en-US',options);
    check('explicit calls',calls.length===1&&calls[0].args.length===2&&calls[0].args[0]==='en-US'&&calls[0].args[1]===options,true);
    check('explicit receiver',calls[0].self,moment);
    calls.length=0;'a'.localeCompare('b');
    check('compare forwarded',calls.length===1&&calls[0].args.length===2&&calls[0].args[0]==='b'&&calls[0].args[1]==='ru-RU',true);
    calls.length=0;'a'.localeCompare();
    check('compare without arguments',calls.length===1&&calls[0].args.length===2&&calls[0].args[0]===undefined&&calls[0].args[1]==='ru-RU',true);
    calls.length=0;'a'.localeCompare('b',undefined,options);
    check('compare options',calls.length===1&&calls[0].args.length===3&&calls[0].args[1]==='ru-RU'&&calls[0].args[2]===options,true);
    calls.length=0;'a'.localeCompare('b','sv',options);
    check('compare explicit',calls.length===1&&calls[0].args.length===3&&calls[0].args[1]==='sv'&&calls[0].args[2]===options,true);
    calls.length=0;Reflect.apply(String.prototype.localeCompare,'a',['b',undefined,options,'third','fourth']);
    check('compare with extra arguments',calls.length===1&&calls[0].args.length===5&&calls[0].args[0]==='b'&&calls[0].args[1]==='ru-RU'&&calls[0].args[2]===options&&calls[0].args[3]==='third'&&calls[0].args[4]==='fourth',true);
    calls.length=0;Reflect.apply(Number.prototype.toLocaleString,1.5,[undefined,options,'a','b']);
    check('number with extra arguments',calls.length===1&&calls[0].args.length===4&&calls[0].args[0]==='ru-RU'&&calls[0].args[1]===options&&calls[0].args[3]==='b',true);
    calls.length=0;'i'.toLocaleUpperCase();
    check('upper',calls.length===1&&calls[0].args.length===1&&calls[0].args[0]==='ru-RU',true);
    calls.length=0;(12n).toLocaleString();
    check('bigint',calls.length===1&&calls[0].args.length===1&&calls[0].args[0]==='ru-RU',true);
    calls.length=0;[1234.5,5].toLocaleString();
    check('array calls each element once',calls.filter(row=>row.name==='toLocaleString').length,2);
    return bad.join('; ');
  })()`), '');
});

test('the wrapper never coerces page arguments and leaves non-undefined locale values to the native call', () => {
  const f = fixture({ locale: 'ru-RU' });
  assert.equal(f.run(`(()=>{${CHECK}
    let coercions=0;const trap={toString(){coercions++;return 'x';},valueOf(){coercions++;return 1;},[Symbol.toPrimitive](){coercions++;return 'x';}};
    check('object locale is native',(1234567.891).toLocaleString(trap),native.call(native.number,1234567.891,[trap]));
    check('object options are native',(1234567.891).toLocaleString(undefined,trap),native.call(native.number,1234567.891,['ru-RU',trap]));
    check('date object locale',moment.toLocaleString(trap),native.call(native.dateString,moment,[trap]));
    check('number locale',(1234567.891).toLocaleString(5),native.call(native.number,1234567.891,[5]));
    check('coercions',coercions,0);
    let thatCoercions=0,thisCoercions=0,optionReads=0;
    "a".localeCompare({toString(){thatCoercions++;return 'b';}});
    String.prototype.localeCompare.call({toString(){thisCoercions++;return 'a';}},'b');
    moment.toLocaleString(undefined,{get hour(){optionReads++;return 'numeric';}});
    check('that coerced once',thatCoercions,1);check('this coerced once',thisCoercions,1);check('option read once',optionReads,1);
    let nativeReads=0;native.call(native.dateString,moment,['ru-RU',{get hour(){nativeReads++;return 'numeric';}}]);
    check('same option reads as native',optionReads,nativeReads);
    const listReads=[],list=new Proxy(['en-US'],{get(target,key,receiver){listReads.push(String(key));return Reflect.get(target,key,receiver);},has(target,key){listReads.push('has:'+String(key));return Reflect.has(target,key);}});
    native.call(native.number,1,[list]);
    const nativeListReads=listReads.join();listReads.length=0;
    (1).toLocaleString(list);
    check('locale list reads are native',listReads.join(),nativeListReads);
    return bad.join('; ');
  })()`), '');
});

test('property descriptors, names and lengths stay native', () => {
  const realm = context();
  const before = vm.runInContext(`(()=>{const out={};for(const [owner,name] of [[Date.prototype,'toLocaleString'],[Date.prototype,'toLocaleDateString'],[Date.prototype,'toLocaleTimeString'],[Number.prototype,'toLocaleString'],[BigInt.prototype,'toLocaleString'],[String.prototype,'localeCompare'],[String.prototype,'toLocaleUpperCase'],[String.prototype,'toLocaleLowerCase']]){
    const field=Object.getOwnPropertyDescriptor(owner,name);out[owner.constructor.name+'.'+name]=[field.writable,field.enumerable,field.configurable,owner[name].name,owner[name].length];}return JSON.stringify(out);})()`, realm);
  const installer = vm.runInContext('(' + installIntlCustom.toString() + ')', realm);
  installer(vm.runInContext('globalThis', realm), entry({ locale: 'ru-RU' }));
  const after = vm.runInContext(`(()=>{const out={};for(const [owner,name] of [[Date.prototype,'toLocaleString'],[Date.prototype,'toLocaleDateString'],[Date.prototype,'toLocaleTimeString'],[Number.prototype,'toLocaleString'],[BigInt.prototype,'toLocaleString'],[String.prototype,'localeCompare'],[String.prototype,'toLocaleUpperCase'],[String.prototype,'toLocaleLowerCase']]){
    const field=Object.getOwnPropertyDescriptor(owner,name);out[owner.constructor.name+'.'+name]=[field.writable,field.enumerable,field.configurable,owner[name].name,owner[name].length];}return JSON.stringify(out);})()`, realm);
  assert.equal(after, before);
  assert.equal(vm.runInContext('Date.prototype.toLocaleString!==native.dateString&&Number.prototype.toLocaleString!==native.number', realm), true, 'the methods are actually wrapped');
});

test('page-visible poisoning of Array, Object and Reflect intrinsics never runs page code or breaks the wrappers', () => {
  const f = fixture({ locale: 'ru-RU', timeZone: 'Pacific/Honolulu', calendar: 'buddhist', numberingSystem: 'arab' });
  assert.equal(f.run(`(()=>{${CHECK}
    const expected={
      number:native.call(native.number,1234.5,['ru-RU',{numberingSystem:'arab'}]),
      date:native.call(native.dateString,moment,['ru-RU',{timeZone:'Pacific/Honolulu',calendar:'buddhist',numberingSystem:'arab'}]),
      options:native.call(native.dateString,moment,['ru-RU',{hour:'numeric',timeZone:'Pacific/Honolulu',calendar:'buddhist',numberingSystem:'arab'}]),
      compare:native.call(native.compare,'a',['b','ru-RU']),upper:native.call(native.upper,'i',['ru-RU'])
    };
    globalThis.poison=0;
    const define=Object.defineProperty,trap=function(){poison++;throw Error('page code');};
    const groups=[[Array.prototype,['push','slice','concat','map','indexOf']],[Function.prototype,['apply','call','bind']],[Object,['create','getOwnPropertyDescriptor','getPrototypeOf','setPrototypeOf','freeze','assign','keys']],[Reflect,['apply','construct','get']]];
    for(let group=0;group<groups.length;group++)for(let item=0;item<groups[group][1].length;item++)groups[group][0][groups[group][1][item]]=trap;
    for(let index=0;index<4;index++)define(Array.prototype,index,{configurable:true,get(){poison++;return undefined;},set(){poison++;}});
    define(Array.prototype,Symbol.iterator,{configurable:true,value:trap});
    globalThis.Proxy=trap;
    Object.defineProperty=trap;
    check('number',(1234.5).toLocaleString(),expected.number);
    check('date',moment.toLocaleString(),expected.date);
    check('options',moment.toLocaleString(undefined,{hour:'numeric'}),expected.options);
    check('compare',"a".localeCompare('b'),expected.compare);
    check('upper',"i".toLocaleUpperCase(),expected.upper);
    check('explicit',(1234.5).toLocaleString('de-DE',{numberingSystem:'latn'}),'1.234,5');
    check('five arguments',native.call(String.prototype.localeCompare,'a',['b',undefined,undefined,undefined,undefined]),expected.compare);
    check('four arguments with options',native.call(Date.prototype.toLocaleString,moment,[undefined,{hour:'numeric'},undefined,undefined]),expected.options);
    check('poison',poison,0);
    return bad.join('; ');
  })()`), '');
});

test('a method that cannot be wrapped does not stop the others; each failure is counted per method', () => {
  const f = fixture({ locale: 'ru-RU' }, `Object.defineProperty(Date.prototype,'toLocaleDateString',{writable:false,configurable:false});
    delete BigInt.prototype.toLocaleString;Object.defineProperty(String.prototype,'localeCompare',{value:42,writable:true,configurable:true});`);
  const rows = Object.fromEntries(f.guard.snapshot().localeMethods.map(row => [row.name, row]));
  assert.equal(rows['Date.toLocaleDateString'].unavailable, 1); assert.equal(rows['Date.toLocaleDateString'].installed, 0);
  assert.equal(rows['BigInt.toLocaleString'].unavailable, 1);
  assert.equal(rows['String.localeCompare'].unavailable, 1);
  for (const name of ['Date.toLocaleString', 'Date.toLocaleTimeString', 'Number.toLocaleString', 'String.toLocaleUpperCase', 'String.toLocaleLowerCase']) assert.equal(rows[name].installed, 1, name);
  assert.equal(f.run("(1234.5).toLocaleString()===native.call(native.number,1234.5,['ru-RU'])&&moment.toLocaleString()===native.call(native.dateString,moment,['ru-RU'])"), true);
  assert.equal(f.run('Date.prototype.toLocaleDateString===native.dateDate&&String.prototype.localeCompare===42'), true);
});

test('nothing is installed without a selected locale or outside Custom mode', () => {
  for (const value of [{ timeZone: 'Pacific/Honolulu' }, { calendar: 'buddhist' }, { numberingSystem: 'arab' }, {}]) {
    const f = fixture(value);
    assert.equal(f.run(`Date.prototype.toLocaleString===native.dateString&&Date.prototype.toLocaleDateString===native.dateDate&&Date.prototype.toLocaleTimeString===native.dateTime&&
      Number.prototype.toLocaleString===native.number&&BigInt.prototype.toLocaleString===native.bigint&&String.prototype.localeCompare===native.compare&&
      String.prototype.toLocaleUpperCase===native.upper&&String.prototype.toLocaleLowerCase===native.lower`), true, JSON.stringify(value));
    assert.equal(f.guard.snapshot().localeMethods, undefined);
  }
  for (const mode of ['off', 'bypass', 'on']) {
    const realm = context(), installer = vm.runInContext('(' + installIntlCustom.toString() + ')', realm);
    installer(vm.runInContext('globalThis', realm), [{ id: 'intl-formatting', mode, value: { locale: 'ru-RU' } }]);
    assert.equal(vm.runInContext('Number.prototype.toLocaleString===native.number&&Date.prototype.toLocaleString===native.dateString', realm), true, mode);
  }
  // Another row alone never touches the locale methods.
  const realm = context(), installer = vm.runInContext('(' + installIntlCustom.toString() + ')', realm);
  installer(vm.runInContext('globalThis', realm), [{ id: 'timezone', mode: 'custom', value: { timeZone: 'Asia/Tokyo', offsetMinutes: -540 } }]);
  assert.equal(vm.runInContext('Number.prototype.toLocaleString===native.number&&Date.prototype.toLocaleString===native.dateString', realm), true);
});

test('selected zone, calendar and numbering fill only the options the page did not provide', () => {
  const profile = { locale: 'ru-RU', timeZone: 'Pacific/Honolulu', calendar: 'buddhist', numberingSystem: 'arab' };
  const f = fixture(profile);
  assert.equal(f.run(`(()=>{${CHECK}
    const all={timeZone:'Pacific/Honolulu',calendar:'buddhist',numberingSystem:'arab'};
    check('date defaults',moment.toLocaleString(),native.call(native.dateString,moment,['ru-RU',all]));
    check('date only',moment.toLocaleDateString(),native.call(native.dateDate,moment,['ru-RU',all]));
    check('time only',moment.toLocaleTimeString(),native.call(native.dateTime,moment,['ru-RU',all]));
    check('partial options',moment.toLocaleString(undefined,{hour:'numeric'}),native.call(native.dateString,moment,['ru-RU',{hour:'numeric',...all}]));
    check('page zone wins',moment.toLocaleString(undefined,{timeZone:'UTC'}),native.call(native.dateString,moment,['ru-RU',{...all,timeZone:'UTC'}]));
    check('page calendar wins',moment.toLocaleString(undefined,{calendar:'gregory'}),native.call(native.dateString,moment,['ru-RU',{...all,calendar:'gregory'}]));
    check('page numbering wins',moment.toLocaleString(undefined,{numberingSystem:'latn'}),native.call(native.dateString,moment,['ru-RU',{...all,numberingSystem:'latn'}]));
    check('everything explicit is native',moment.toLocaleString('en-US',{timeZone:'UTC',calendar:'gregory',numberingSystem:'latn'}),native.call(native.dateString,moment,['en-US',{timeZone:'UTC',calendar:'gregory',numberingSystem:'latn'}]));
    check('explicit locale keeps selected zone',moment.toLocaleString('en-US'),native.call(native.dateString,moment,['en-US',all]));
    check('explicit locale with options',moment.toLocaleDateString('de-DE',{month:'long'}),native.call(native.dateDate,moment,['de-DE',{month:'long',...all}]));
    check('undefined values are omitted',moment.toLocaleString(undefined,{timeZone:undefined,calendar:undefined,numberingSystem:undefined}),native.call(native.dateString,moment,['ru-RU',all]));
    check('number numbering',(1234.5).toLocaleString(),native.call(native.number,1234.5,['ru-RU',{numberingSystem:'arab'}]));
    check('number explicit locale',(1234.5).toLocaleString('de-DE'),native.call(native.number,1234.5,['de-DE',{numberingSystem:'arab'}]));
    check('number page numbering',(1234.5).toLocaleString(undefined,{numberingSystem:'latn'}),native.call(native.number,1234.5,['ru-RU',{numberingSystem:'latn'}]));
    check('bigint numbering',(1234567n).toLocaleString(),native.call(native.bigint,1234567n,['ru-RU',{numberingSystem:'arab'}]));
    check('collation unaffected',"a".localeCompare('b'),native.call(native.compare,'a',['b','ru-RU']));
    check('matches DateTimeFormat',moment.toLocaleString(),new Intl.DateTimeFormat(undefined,{year:'numeric',month:'numeric',day:'numeric',hour:'numeric',minute:'numeric',second:'numeric'}).format(moment));
    return bad.join('; ');
  })()`), '');
});

test('calendar and numbering keywords inside a string locale tag are explicit page requests', () => {
  const f = fixture({ locale: 'ru-RU', timeZone: 'Pacific/Honolulu', calendar: 'buddhist', numberingSystem: 'arab' });
  assert.equal(f.run(`(()=>{${CHECK}
    const zone={timeZone:'Pacific/Honolulu'};
    check('latin digits requested',(1234.5).toLocaleString('ar-EG-u-nu-latn'),native.call(native.number,1234.5,['ar-EG-u-nu-latn']));
    check('upper case tag',(1234.5).toLocaleString('AR-eg-U-NU-latn'),native.call(native.number,1234.5,['AR-eg-U-NU-latn']));
    check('bigint',(1234567n).toLocaleString('ar-EG-u-nu-latn'),native.call(native.bigint,1234567n,['ar-EG-u-nu-latn']));
    check('gregorian requested',moment.toLocaleDateString('th-TH-u-ca-gregory'),native.call(native.dateDate,moment,['th-TH-u-ca-gregory',{...zone,numberingSystem:'arab'}]));
    check('both requested',moment.toLocaleString('th-TH-u-ca-gregory-nu-thai'),native.call(native.dateString,moment,['th-TH-u-ca-gregory-nu-thai',zone]));
    check('options still get the rest',moment.toLocaleString('ja-JP-u-ca-japanese',{hour:'numeric'}),native.call(native.dateString,moment,['ja-JP-u-ca-japanese',{hour:'numeric',...zone,numberingSystem:'arab'}]));
    check('private use is not a request',moment.toLocaleDateString('de-DE-x-ca-nu'),native.call(native.dateDate,moment,['de-DE-x-ca-nu',{...zone,calendar:'buddhist',numberingSystem:'arab'}]));
    check('plain tag still filled',(1234.5).toLocaleString('ar-EG'),native.call(native.number,1234.5,['ar-EG',{numberingSystem:'arab'}]));
    return bad.join('; ');
  })()`), '');
});

test('option defaults keep getter receivers, Proxy trap order/count/receivers and frozen invariants', () => {
  const f = fixture({ locale: 'ru-RU', timeZone: 'Pacific/Honolulu', calendar: 'buddhist', numberingSystem: 'arab' });
  assert.equal(f.run(`(()=>{${CHECK}
    const all={timeZone:'Pacific/Honolulu',calendar:'buddhist',numberingSystem:'arab'};
    let receiver=null;const options={get hour(){receiver=this;return 'numeric';}};
    moment.toLocaleString(undefined,options);check('getter receiver is the page object',receiver,options);
    const make=log=>{const proxy=new Proxy({hour:'numeric'},{get(target,key,receiver){log.push([String(key),receiver===proxy]);return Reflect.get(target,key,receiver);}});return proxy;};
    const nativeLog=[],customLog=[];native.call(native.dateString,moment,['ru-RU',make(nativeLog)]);moment.toLocaleString(undefined,make(customLog));
    check('Proxy get order, count and receivers',JSON.stringify(customLog),JSON.stringify(nativeLog));
    const numberNative=[],numberCustom=[];native.call(native.number,1234.5,['ru-RU',make(numberNative)]);(1234.5).toLocaleString(undefined,make(numberCustom));
    check('Proxy number reads',JSON.stringify(numberCustom),JSON.stringify(numberNative));
    let frozenFailed=false,frozen=Object.freeze({timeZone:undefined,hour:'numeric'});
    try{check('frozen undefined zone stays native',moment.toLocaleString(undefined,frozen),native.call(native.dateString,moment,['ru-RU',{...frozen,calendar:'buddhist',numberingSystem:'arab'}]));}catch(error){frozenFailed=true;}
    check('frozen options do not throw',frozenFailed,false);
    let setterOnly=false;const accessor=Object.defineProperty({hour:'numeric'},'timeZone',{set(){},configurable:false});
    try{moment.toLocaleString(undefined,accessor);}catch(error){setterOnly=true;}
    check('setter-only zone does not throw',setterOnly,false);
    const sealed=Object.seal({timeZone:undefined,hour:'numeric'});
    check('sealed writable undefined zone is filled',moment.toLocaleString(undefined,sealed),native.call(native.dateString,moment,['ru-RU',{hour:'numeric',...all}]));
    let reads=0,nativeReads=0;
    moment.toLocaleString(undefined,{get timeZone(){reads++;return 'UTC';}});native.call(native.dateString,moment,['ru-RU',{get timeZone(){nativeReads++;return 'UTC';}}]);
    check('zone getter read once like native',reads,nativeReads);check('zone getter read once',reads,1);
    reads=0;moment.toLocaleString(undefined,{get timeZone(){reads++;return undefined;}});check('undefined getter read once',reads,1);
    check('Invalid Date reads nothing',new Date(NaN).toLocaleString(undefined,{get timeZone(){throw Error('read');}}),'Invalid Date');
    check('primitive options stay native',moment.toLocaleString(undefined,42),native.call(native.dateString,moment,['ru-RU',42]));
    check('string options stay native',moment.toLocaleString(undefined,'short'),native.call(native.dateString,moment,['ru-RU','short']));
    check('revoked options throw natively',(()=>{const revoked=Proxy.revocable({},{});revoked.revoke();try{moment.toLocaleString(undefined,revoked.proxy);return 'no error';}catch(error){return error.name;}})(),(()=>{const revoked=Proxy.revocable({},{});revoked.revoke();try{native.call(native.dateString,moment,['ru-RU',revoked.proxy]);return 'no error';}catch(error){return error.name;}})());
    return bad.join('; ');
  })()`), '');
});

test('the neutral profile of inaccessible realms governs the locale methods as well as the constructors', () => {
  const f = fixture({ locale: 'en-US', timeZone: 'UTC', calendar: 'gregory', numberingSystem: 'latn' });
  assert.equal(f.run(`(()=>{${CHECK}
    const all={timeZone:'UTC',calendar:'gregory',numberingSystem:'latn'};
    check('date',moment.toLocaleString(),native.call(native.dateString,moment,['en-US',all]));
    check('matches the constructor default',moment.toLocaleString(),new Intl.DateTimeFormat(undefined,{year:'numeric',month:'numeric',day:'numeric',hour:'numeric',minute:'numeric',second:'numeric'}).format(moment));
    check('constructor locale',new Intl.DateTimeFormat().resolvedOptions().locale,'en-US');
    check('constructor zone',new Intl.DateTimeFormat().resolvedOptions().timeZone,'UTC');
    check('number',(1234567.891).toLocaleString(),native.call(native.number,1234567.891,['en-US',{numberingSystem:'latn'}]));
    check('arabic digits are withheld',(1234.5).toLocaleString('ar-EG'),native.call(native.number,1234.5,['ar-EG',{numberingSystem:'latn'}]));
    return bad.join('; ');
  })()`), '');
});

test('every realm the installer covers is wrapped with its own selected profile and restores independently', () => {
  const parent = context(), child = context();
  const installer = vm.runInContext('(' + installIntlCustom.toString() + ')', parent);
  const parentGuard = installer(vm.runInContext('globalThis', parent), entry({ locale: 'ru-RU' }));
  // The parent page poisons its intrinsics after the first install; the child install must not depend on them.
  vm.runInContext(`const define=Object.defineProperty;
    define(Array.prototype,Symbol.iterator,{configurable:true,value(){throw Error('page iterator');}});
    const names=['create','defineProperty','getOwnPropertyDescriptor','getPrototypeOf','setPrototypeOf'];
    for(let index=0;index<names.length;index++)Object[names[index]]=()=>{throw Error('page intrinsic');};`, parent);
  const childGuard = installer(vm.runInContext('globalThis', child), entry({ locale: 'de-DE' }));
  const expectation = (realm, locale) => vm.runInContext(`(1234567.891).toLocaleString()===native.call(native.number,1234567.891,[${JSON.stringify(locale)}])&&moment.toLocaleDateString()===native.call(native.dateDate,moment,[${JSON.stringify(locale)}])&&Number.prototype.toLocaleString!==native.number`, realm);
  assert.equal(expectation(parent, 'ru-RU'), true);
  assert.equal(expectation(child, 'de-DE'), true);
  assert.equal(childGuard.snapshot().localeMethods.filter(row => row.installed === 1).length, 8);
  childGuard.stop();
  assert.equal(vm.runInContext('Number.prototype.toLocaleString===native.number&&String.prototype.localeCompare===native.compare', child), true);
  assert.equal(vm.runInContext('Number.prototype.toLocaleString!==native.number', parent), true, 'the other realm keeps its wrappers');
  parentGuard.stop();
  assert.equal(vm.runInContext('Number.prototype.toLocaleString===native.number&&Date.prototype.toLocaleString===native.dateString', parent), true);
});

test('Stop restores owned descriptors, keeps newer ones and turns retained wrappers into the native call', () => {
  const f = fixture({ locale: 'ru-RU' });
  f.run('globalThis.retained=Number.prototype.toLocaleString;globalThis.retainedDate=Date.prototype.toLocaleString;globalThis.replacement=function toLocaleString(){return "page";};Object.defineProperty(Date.prototype,"toLocaleString",{value:replacement,writable:true,configurable:true});');
  f.guard.stop();
  assert.equal(f.run('Number.prototype.toLocaleString===native.number&&String.prototype.localeCompare===native.compare&&Date.prototype.toLocaleDateString===native.dateDate'), true);
  assert.equal(f.run('Date.prototype.toLocaleString===replacement'), true, 'a newer owner is retained');
  assert.equal(f.run("retained.call(1234567.891)===native.call(native.number,1234567.891,[])&&retainedDate.call(moment)===native.call(native.dateString,moment,[])"), true, 'a retained wrapper is native after Stop');
  assert.equal(f.guard.snapshot().stopped, true);
});

test('very long argument lists and exotic argument shapes stay on the native path without extra work', () => {
  const f = fixture({ locale: 'ru-RU', timeZone: 'Pacific/Honolulu' });
  assert.equal(f.run(`(()=>{${CHECK}
    const long=new Array(5000).fill(undefined);
    check('long list is native',Reflect.apply(Number.prototype.toLocaleString,1234.5,long),native.call(native.number,1234.5,long));
    check('long list date',Reflect.apply(Date.prototype.toLocaleString,moment,long),native.call(native.dateString,moment,long));
    check('one explicit position beyond the locale index',Reflect.apply(String.prototype.localeCompare,'a',['b',undefined,undefined,undefined]),native.call(native.compare,'a',['b','ru-RU']));
    return bad.join('; ');
  })()`), '');
  const snapshot = f.guard.snapshot();
  assert.equal(snapshot.localeMethods.find(row => row.name === 'Number.toLocaleString').unavailable >= 1, true);
});

test('snapshot rows are counters only and count actual replacements', () => {
  const f = fixture({ locale: 'ru-RU' });
  f.run("(1).toLocaleString();(2).toLocaleString('en-US');moment.toLocaleString();moment.toLocaleString('en-US');'a'.localeCompare('b');'a'.localeCompare('b','en')");
  const rows = Object.fromEntries(f.guard.snapshot().localeMethods.map(row => [row.name, row]));
  assert.equal(rows['Number.toLocaleString'].changed, 1);
  assert.equal(rows['Date.toLocaleString'].changed, 1);
  assert.equal(rows['String.localeCompare'].changed, 1);
  assert.equal(rows['Date.toLocaleDateString'].changed, 0);
  sameJson(Object.keys(rows).sort(), ['BigInt.toLocaleString', 'Date.toLocaleDateString', 'Date.toLocaleString', 'Date.toLocaleTimeString', 'Number.toLocaleString', 'String.localeCompare', 'String.toLocaleLowerCase', 'String.toLocaleUpperCase']);
  assert.equal(JSON.stringify(f.guard.snapshot()).includes('ru-RU'), false);
  for (const row of Object.values(rows)) sameJson(Object.keys(row).sort(), ['changed', 'installed', 'name', 'unavailable']);
});
