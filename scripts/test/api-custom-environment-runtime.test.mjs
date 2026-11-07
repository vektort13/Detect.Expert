import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../../apps/production-extension/api-custom-environment-runtime.js', import.meta.url), 'utf8').replace(/^export /m, '');
const entry = (id, value, mode = 'custom') => ({ id, value, mode });
const pluginValue = { plugins: [
  { name: 'Selected PDF', filename: 'selected.pdf', description: 'Selected reader', mimeTypes: [{ type: 'application/pdf', suffixes: 'pdf', description: 'PDF' }] },
  { name: 'Other Reader', filename: 'reader', description: '', mimeTypes: [{ type: 'application/pdf', suffixes: 'pdf', description: 'PDF' }] },
] };
function fixture(entries, setup = '', sharedQueries = undefined) {
  const context = vm.createContext({ input: structuredClone(entries), __sharedQueries: sharedQueries });
  vm.runInContext(`
    const D=Object.defineProperty,A=Reflect.apply;
    const navs=new WeakSet(),objects=new WeakMap(),bars=new WeakSet(),queries=__sharedQueries||new WeakMap();delete globalThis.__sharedQueries;
    globalThis.calls={nav:0,field:0,item:0,named:0,match:0,matches:0,media:0,supports:0,coercion:0,traps:0};
    globalThis.reason=new TypeError('Synthetic native brand');
    function branded(value,kind){const data=objects.get(value);if(!data||data.kind!==kind)throw reason;return data;}
    function index(value){const n=+value;return !Number.isFinite(n)||n===0?0:(Math.trunc(n)%4294967296+4294967296)%4294967296;}
    class PluginArray {
      get length(){calls.field++;return branded(this,'PluginArray').items.length;}
      item(value){calls.item++;const d=branded(this,'PluginArray');if(!arguments.length)throw reason;return d.items[index(value)]??null;}
      namedItem(value){calls.named++;branded(this,'PluginArray');if(!arguments.length)throw reason;String(value);return null;}
      refresh(){branded(this,'PluginArray');}
      [Symbol.iterator](){return branded(this,'PluginArray').items.values();}
    }
    class MimeTypeArray {
      get length(){return branded(this,'MimeTypeArray').items.length;}
      item(value){calls.item++;const d=branded(this,'MimeTypeArray');if(!arguments.length)throw reason;return d.items[index(value)]??null;}
      namedItem(value){calls.named++;branded(this,'MimeTypeArray');if(!arguments.length)throw reason;String(value);return null;}
      [Symbol.iterator](){return branded(this,'MimeTypeArray').items.values();}
    }
    class Plugin {
      get name(){return branded(this,'Plugin').name;}get filename(){return branded(this,'Plugin').filename;}
      get description(){return branded(this,'Plugin').description;}get length(){return branded(this,'Plugin').items.length;}
      item(value){calls.item++;const d=branded(this,'Plugin');if(!arguments.length)throw reason;return d.items[index(value)]??null;}
      namedItem(value){calls.named++;branded(this,'Plugin');if(!arguments.length)throw reason;String(value);return null;}
      [Symbol.iterator](){return branded(this,'Plugin').items.values();}
    }
    class MimeType {
      get type(){return branded(this,'MimeType').type;}get suffixes(){return branded(this,'MimeType').suffixes;}
      get description(){return branded(this,'MimeType').description;}get enabledPlugin(){return branded(this,'MimeType').enabledPlugin;}
    }
    const nativePlugins=new PluginArray(),nativeMimes=new MimeTypeArray();
    objects.set(nativePlugins,{kind:'PluginArray',items:[]});objects.set(nativeMimes,{kind:'MimeTypeArray',items:[]});
    class Navigator {
      constructor(){navs.add(this);}get plugins(){calls.nav++;if(!navs.has(this))throw reason;return nativePlugins;}
      get mimeTypes(){calls.nav++;if(!navs.has(this))throw reason;return nativeMimes;}
      get product(){if(!navs.has(this))throw reason;return 'Native';}
      get cookieEnabled(){if(!navs.has(this))throw reason;return true;}
    }
    class Screen {get availLeft(){if(this!==screen)throw reason;return 0;}get availTop(){if(this!==screen)throw reason;return 0;}}
    class BarProp {constructor(){bars.add(this);}get visible(){if(!bars.has(this))throw reason;return true;}}
    class MediaQueryList {constructor(query){queries.set(this,query);}get media(){calls.media++;if(!queries.has(this))throw reason;return queries.get(this);}
      get matches(){calls.matches++;if(!queries.has(this))throw reason;return false;}}
    const nav=new Navigator(),screen=new Screen(),scroll=new BarProp(),toolbar=new BarProp();
    globalThis.realm={Object,Array,Promise,Navigator,PluginArray,Plugin,MimeTypeArray,MimeType,Screen,BarProp,MediaQueryList};
    D(realm,'navigator',{get(){return nav;},configurable:true});D(realm,'innerWidth',{get(){if(this!==realm)throw reason;return 640;},configurable:true});
    D(realm,'scrollbars',{get(){if(this!==realm)throw reason;return scroll;},configurable:true});
    D(realm,'toolbar',{get(){if(this!==realm)throw reason;return toolbar;},configurable:true});
    realm.matchMedia={matchMedia(query){calls.match++;if(this!==realm)throw reason;return new MediaQueryList(String(query));}}.matchMedia;
    globalThis.nativeMatchMedia=realm.matchMedia;
    realm.CSS={supports:{supports(a,b){calls.supports++;if(arguments.length===0)throw reason;String(a);if(arguments.length>1)String(b);return false;}}.supports};
    globalThis.nativePlugins=nativePlugins;globalThis.nativeMimes=nativeMimes;globalThis.nativeItem=PluginArray.prototype.item;
    globalThis.nativeNavPlugins=D?Object.getOwnPropertyDescriptor(Navigator.prototype,'plugins').get:null;
    globalThis.nav=nav;globalThis.screen=screen;globalThis.scroll=scroll;
    ${setup}
    ${source}
    globalThis.guard=installApiCustomEnvironment(realm,input);
  `, context);
  return { context, run: code => vm.runInContext(code, context) };
}

test('environment metadata: passive install, present getters only, exact native brand errors', () => {
  const f = fixture([entry('navigator-metadata', { product: 'Gecko', cookieEnabled: false, buildID: 'x' })]);
  assert.equal(f.run('calls.nav'), 0);assert.equal(f.run('realm.navigator.product'), 'Gecko');
  assert.equal(f.run('realm.navigator.cookieEnabled'), false);assert.equal(f.run(`'buildID' in Navigator.prototype`), false);
  assert.ok(f.run('guard.snapshot().unavailable') >= 1);
  assert.throws(() => f.run(`A(Object.getOwnPropertyDescriptor(Navigator.prototype,'product').get,{},[])`), e => e === f.run('reason'));
});

test('environment geometry: selected dimensions and lazily identified BarProp handles', () => {
  const f = fixture([entry('screen-geometry', { innerWidth: 1280, availLeft: -10, scrollbarsVisible: false })]);
  assert.equal(f.run('realm.innerWidth'), 1280);assert.equal(f.run('screen.availLeft'), -10);
  assert.equal(f.run('realm.scrollbars.visible'), false);assert.equal(f.run('realm.toolbar.visible'), true);
  assert.equal(f.run('new BarProp().visible'), true);
  assert.throws(() => f.run(`A(Object.getOwnPropertyDescriptor(BarProp.prototype,'visible').get,{},[])`), e => e === f.run('reason'));
});

const coordinateSetup = `
  globalThis.coordinateCalls={screenX:0,screenY:0,screenLeft:0,screenTop:0};
  for(const [key,value] of [['screenX',40],['screenY',50],['screenLeft',40],['screenTop',50]]){
    D(realm,key,{configurable:true,enumerable:true,get(){coordinateCalls[key]++;if(this!==realm)throw reason;return value;}});
  }
  globalThis.nativeLeft=Object.getOwnPropertyDescriptor(realm,'screenLeft').get;
  globalThis.nativeTop=Object.getOwnPropertyDescriptor(realm,'screenTop').get;
`;
test('environment geometry aliases: coordinates agree, installation is passive and each native getter validates once', () => {
  const f=fixture([entry('screen-geometry',{screenX:-200,screenY:120})],coordinateSetup);
  assert.equal(f.run('Object.values(coordinateCalls).reduce((a,b)=>a+b,0)'),0);
  assert.deepEqual(JSON.parse(f.run('JSON.stringify([realm.screenX,realm.screenLeft,realm.screenY,realm.screenTop])')),[-200,-200,120,120]);
  assert.deepEqual(JSON.parse(f.run('JSON.stringify(coordinateCalls)')),{screenX:1,screenY:1,screenLeft:1,screenTop:1});
  assert.throws(()=>f.run(`A(Object.getOwnPropertyDescriptor(realm,'screenLeft').get,{},[])`),e=>e===f.run('reason'));
  assert.equal(f.run('coordinateCalls.screenLeft'),2);
  assert.throws(()=>f.run(`A(Object.getOwnPropertyDescriptor(realm,'screenTop').get,{},[])`),e=>e===f.run('reason'));
  assert.equal(f.run('coordinateCalls.screenTop'),2);
  assert.equal(f.run(`Object.getOwnPropertyDescriptor(realm,'screenLeft').set`),undefined);
});
test('environment geometry aliases: unselected, absent and immutable aliases retain native behavior',()=>{
  const f=fixture([entry('screen-geometry',{screenX:-3})],coordinateSetup);
  assert.equal(f.run('realm.screenLeft'),-3);assert.equal(f.run('realm.screenTop'),50);assert.equal(f.run(`Object.getOwnPropertyDescriptor(realm,'screenTop').get===nativeTop`),true);
  const absent=fixture([entry('screen-geometry',{screenX:-3,screenY:4})],coordinateSetup+`delete realm.screenLeft;delete realm.screenTop;`);
  assert.equal(absent.run(`'screenLeft' in realm||'screenTop' in realm`),false);assert.equal(absent.run('realm.screenX'),-3);
  const fixed=fixture([entry('screen-geometry',{screenX:9})],coordinateSetup+`D(realm,'screenLeft',{configurable:false,get:nativeLeft});`);
  assert.equal(fixed.run('realm.screenLeft'),40);assert.equal(fixed.run(`Object.getOwnPropertyDescriptor(realm,'screenLeft').get===nativeLeft`),true);assert.ok(fixed.run('guard.snapshot().unavailable')>0);
});
test('environment geometry aliases: saved wrappers and stop restore native values without clobbering a newer owner',()=>{
  const f=fixture([entry('screen-geometry',{screenX:9})],coordinateSetup);
  f.run(`globalThis.retainedLeft=Object.getOwnPropertyDescriptor(realm,'screenLeft').get;guard.stop();`);
  assert.equal(f.run('realm.screenLeft'),40);assert.equal(f.run('A(retainedLeft,realm,[])'),40);assert.equal(f.run(`Object.getOwnPropertyDescriptor(realm,'screenLeft').get===nativeLeft`),true);
  const next=fixture([entry('screen-geometry',{screenX:9})],coordinateSetup);
  next.run(`D(realm,'screenLeft',{configurable:true,get(){return 77;}});guard.stop();`);assert.equal(next.run('realm.screenLeft'),77);
});

test('virtual plugins: stable linked collections, iterator/index/namedItem and private selected snapshot', () => {
  const f = fixture([entry('navigator-plugins', pluginValue)]);
  assert.equal(f.run('calls.nav+calls.field+calls.item'), 0);
  assert.equal(f.run(`globalThis.list=nav.plugins;list===nav.plugins&&list.length===2&&list instanceof PluginArray`), true);
  assert.equal(f.run(`list[0]===list.item(0)&&list[0]===list.namedItem('Selected PDF')&&list[0]===list['Selected PDF']&&[...list][1]===list[1]`), true);
  assert.equal(f.run(`globalThis.mimes=nav.mimeTypes;mimes.length===1&&mimes[0]===list[0][0]&&mimes[0]===list[1][0]&&mimes[0].enabledPlugin===list[0]`), true);
  assert.equal(f.run(`mimes.namedItem('application/pdf')===list[0].namedItem('application/pdf')`), true);
  f.run(`input[0].value.plugins[0].name='Mutated';`);assert.equal(f.run('list[0].name'), 'Selected PDF');
  assert.equal(f.run(`A(Object.getOwnPropertyDescriptor(Plugin.prototype,'name').get,list[0],[])`), 'Selected PDF');
  assert.equal(f.run('calls.item+calls.named'), 0);
});

test('virtual plugins: Object.keys and JSON traverse indexed entries without metadata cycles',()=>{
  const f=fixture([entry('navigator-plugins',pluginValue)]);
  assert.equal(f.run(`JSON.stringify(Object.keys(nav.plugins))`),'["0","1"]');
  assert.equal(f.run(`JSON.stringify(Object.keys(nav.mimeTypes))`),'["0"]');
  assert.equal(f.run(`JSON.stringify(Object.keys(nav.plugins[0]))`),'["0"]');
  assert.equal(f.run(`JSON.stringify(Object.keys(nav.mimeTypes[0]))`),'[]');
  assert.equal(f.run('JSON.stringify(nav.plugins)'),'{"0":{"0":{}},"1":{"0":{}}}');
  assert.equal(f.run('JSON.stringify(nav.mimeTypes)'),'{"0":{}}');
  assert.equal(f.run(`nav.plugins['Selected PDF']===nav.plugins[0]&&nav.plugins[0]['application/pdf']===nav.mimeTypes[0]&&nav.mimeTypes[0].enabledPlugin===nav.plugins[0]`),true);
  f.run(`globalThis.retainedPlugins=nav.plugins;guard.stop();`);
  assert.equal(f.run('retainedPlugins[0].name'),'Selected PDF');assert.equal(f.run('JSON.stringify(retainedPlugins)'),'{"0":{"0":{}},"1":{"0":{}}}');
});
test('virtual plugins: every supplementary field remains readable but is absent from own enumerable keys',()=>{
  const f=fixture([entry('navigator-plugins',pluginValue)]);
  const fields=[['nav.plugins',['length']],['nav.mimeTypes',['length']],['nav.plugins[0]',['name','filename','description','length']],['nav.mimeTypes[0]',['type','suffixes','description','enabledPlugin']]];
  for(const[expression,keys]of fields)for(const key of keys){assert.equal(f.run(`Object.getOwnPropertyDescriptor(${expression},${JSON.stringify(key)}).enumerable`),false);assert.equal(f.run(`typeof ${expression}[${JSON.stringify(key)}]==='undefined'`),false);}
});

test('virtual plugins: empty, fake/Proxy brand rejection and native existing handles forwarded once', () => {
  const f = fixture([entry('navigator-plugins', { plugins: [] })]);
  assert.equal(f.run('nav.plugins.length'), 0);assert.equal(f.run('nav.plugins.item(0)'), null);
  assert.equal(f.run('A(PluginArray.prototype.item,nativePlugins,[0])'), null);assert.equal(f.run('calls.item'), 1);
  for (const receiver of ['{}', 'new Proxy(nav.plugins,new Proxy({}, {get(){calls.traps++;throw reason;}}))']) {
    assert.throws(() => f.run(`A(PluginArray.prototype.item,${receiver},[0])`), e => e === f.run('reason'));
  }
  assert.equal(f.run('calls.traps'), 0);
  assert.throws(() => f.run('new PluginArray.prototype.item()'), e => e.name === 'TypeError');
  assert.equal(f.run('calls.item'), 3);
});

test('virtual plugins: WebIDL required args and single unsigned-long/DOMString coercion', () => {
  const f = fixture([entry('navigator-plugins', pluginValue)]);
  assert.equal(f.run(`nav.plugins.item({valueOf(){calls.coercion++;return 4294967296;}})===nav.plugins[0]`), true);
  assert.equal(f.run(`nav.plugins.namedItem({toString(){calls.coercion++;return 'Selected PDF';}})===nav.plugins[0]`), true);
  assert.equal(f.run('calls.coercion'), 2);
  for (const code of ['nav.plugins.item()', 'nav.plugins.namedItem()', 'nav.plugins.item(1n)', 'nav.plugins.namedItem(Symbol())']) assert.throws(() => f.run(code), e => e.name === 'TypeError');
  assert.throws(() => f.run('nav.plugins.item({valueOf(){throw reason;}})'), e => e === f.run('reason'));
  assert.equal(f.run('calls.item+calls.named'), 0);
});

test('CSS media: native handles/conversion once; selected scalar/range/gamut and unsupported pass-through', () => {
  const f = fixture([entry('css-media', { colorScheme: 'dark', colorGamut: 'p3', dynamicRange: 'high', viewportWidth: 1280, resolutionDppx: 2 })]);
  assert.equal(f.run(`realm.matchMedia({toString(){calls.coercion++;return '(prefers-color-scheme: dark)';}}).matches`), true);
  assert.equal(f.run('calls.coercion'), 1);assert.equal(f.run('calls.match'), 1);
  for (const query of ['(min-width: 800px)', '(min-resolution: 192dpi)', '(color-gamut: srgb)', '(color-gamut: p3)', '(dynamic-range: standard)', '(dynamic-range: high)']) assert.equal(f.run(`realm.matchMedia(${JSON.stringify(query)}).matches`), true);
  assert.equal(f.run(`realm.matchMedia('(color-gamut: rec2020)').matches`), false);
  assert.equal(f.run(`realm.matchMedia('(unsupported: custom)').matches`), false);
  assert.throws(() => f.run('A(realm.matchMedia,{},["(color-gamut: p3)"])'), e => e === f.run('reason'));
  assert.throws(() => f.run('new realm.matchMedia("x")'), e => e.name === 'TypeError');
});

test('CSS supports: exact explicit metadata, both overloads, opaque conversion/error and no constructor', () => {
  const f = fixture([entry('css-supports', { queries: [{ query: 'display:grid', supported: true }] })]);
  assert.equal(f.run(`realm.CSS.supports('display:grid')`), true);assert.equal(f.run(`realm.CSS.supports('display','grid')`), true);
  assert.equal(f.run(`realm.CSS.supports({toString(){calls.coercion++;return 'display:grid';}})`), false);
  assert.equal(f.run('calls.coercion'), 1);assert.equal(f.run('calls.supports'), 3);
  assert.throws(() => f.run('realm.CSS.supports({toString(){throw reason;}})'), e => e === f.run('reason'));
  assert.throws(() => f.run('new realm.CSS.supports("display:grid")'), e => e.name === 'TypeError');
});

test('CSS media selected dimensions agree across legacy, modern, reversed and chained range syntax', () => {
  const f = fixture([entry('css-media', { viewportWidth: 1280, viewportHeight: 720, resolutionDppx: 2 })]);
  const cases = [
    ['(width >= 1280px)', true], ['(width > 1280px)', false], ['(1280px = width)', true],
    ['(800px < width <= 1280px)', true], ['(1280px >= width > 800px)', true],
    ['(800px < width < 1280px)', false], ['(height <= 720px)', true], ['(0 <= height)', true],
    ['(resolution >= 192dpi)', true], ['(2dppx = resolution)', true], ['(1dppx < resolution <= 2dppx)', true],
    ['(width >= 1.28e3px)', true], ['(width > -1px)', true], ['(max-width: 1280px)', true],
  ];
  for (const [query, expected] of cases) assert.equal(f.run(`realm.matchMedia(${JSON.stringify(query)}).matches`), expected, query);
  assert.equal(f.run('calls.match'), cases.length, 'one requested native handle per query');
  assert.equal(f.run('calls.coercion'), 0);
});

test('CSS media boolean and negated feature queries agree with selected preference values', () => {
  const f = fixture([entry('css-media', { colorScheme: 'dark', reducedMotion: 'reduce', forcedColors: 'none', pointer: 'fine', hover: 'hover', grid: false, viewportWidth: 1280 })]);
  const cases = [
    ['(prefers-color-scheme)', true], ['(prefers-reduced-motion)', true], ['(pointer)', true], ['(hover)', true],
    ['(forced-colors)', false], ['(grid)', false], ['(width)', true],
    ['not (prefers-color-scheme: light)', true], ['not (pointer: fine)', false], ['not (forced-colors)', true],
    ['(width >= 800px) and (prefers-reduced-motion)', true],
  ];
  for (const [query, expected] of cases) assert.equal(f.run(`realm.matchMedia(${JSON.stringify(query)}).matches`), expected, query);
});

test('CSS media unknown, unsupported units, inconsistent chains and bounded inputs remain native', () => {
  const f = fixture([entry('css-media', { viewportWidth: 1280, resolutionDppx: 2 })]);
  for (const query of ['(width >= 20em)', '(1px < width > 2px)', '(width < height)', '(resolution >= 0)', '(width >= 1px) and (unknown: value)', '('.repeat(4097), Array(34).fill('(width: 1280px)').join(', ')]) {
    assert.equal(f.run(`realm.matchMedia(${JSON.stringify(query)}).matches`), false, query.slice(0, 100));
  }
  f.run(`globalThis.savedMatches=Object.getOwnPropertyDescriptor(MediaQueryList.prototype,'matches').get;globalThis.handle=realm.matchMedia('(1280px <= width)');guard.stop();`);
  assert.equal(f.run('A(savedMatches,handle,[])'), false, 'retained getter follows stop');
});

test('CSS media mixed known/unknown queries retain dominant selected OR true and AND false', () => {
  const or = fixture([entry('css-media', { colorScheme: 'dark' })]);
  for (const query of ['(prefers-color-scheme: dark), (hover: hover)', '(hover: hover), (prefers-color-scheme: dark)']) {
    assert.equal(or.run(`realm.matchMedia(${JSON.stringify(query)}).matches`), true, query);
  }
  const and = fixture([entry('css-media', { viewportWidth: 1280 })], `D(MediaQueryList.prototype,'matches',{configurable:true,get(){calls.matches++;if(!queries.has(this))throw reason;return true;}});`);
  for (const query of ['(width < 800px) and (hover: hover)', '(hover: hover) and (width < 800px)']) {
    assert.equal(and.run(`realm.matchMedia(${JSON.stringify(query)}).matches`), false, query);
  }
  assert.equal(or.run(`realm.matchMedia('(prefers-color-scheme: light), (hover: hover)').matches`), false, 'unresolved OR remains native false');
  assert.equal(and.run(`realm.matchMedia('(width > 800px) and (hover: hover)').matches`), true, 'unresolved AND remains native true');
  assert.equal(and.run(`realm.matchMedia('not screen and (width > 800px)').matches`), false, 'media-type NOT negates the whole decided conjunction (native would say true)');
  assert.equal(and.run(`realm.matchMedia('not screen and (width > 800px) and (hover: hover)').matches`), true, 'an undecided conjunction is never negated: the whole query stays native');
  assert.equal(or.run(`realm.matchMedia('not screen and (width < 800px), (prefers-color-scheme: dark)').matches`), true, 'a selected true alternative decides the OR; the undecided NOT alternative is not negated');
});

test('environment stop: restore ownership, retained wrapper native result, existing virtual snapshot remains usable', () => {
  const f = fixture([entry('navigator-metadata', { product: 'Gecko' }), entry('navigator-plugins', pluginValue)]);
  f.run(`globalThis.savedGetter=Object.getOwnPropertyDescriptor(Navigator.prototype,'plugins').get;globalThis.selectedSnapshot=nav.plugins;guard.stop();`);
  assert.equal(f.run('nav.product'), 'Native');assert.equal(f.run('nav.plugins===nativePlugins'), true);
  assert.equal(f.run('A(savedGetter,nav,[])===nativePlugins'), true);
  assert.equal(f.run(`selectedSnapshot.item(0).name`), 'Selected PDF');
  const next = fixture([entry('navigator-metadata', { product: 'Gecko' })]);
  next.run(`D(Navigator.prototype,'product',{configurable:true,get(){return 'new-owner';}});guard.stop();`);
  assert.equal(next.run('nav.product'), 'new-owner');
});

test('environment absence/OFF: no synthesized Plugin interface or new metadata and unchanged native path', () => {
  const absent = fixture([entry('navigator-plugins', pluginValue)], 'delete realm.MimeType;');
  assert.equal(absent.run('nav.plugins===nativePlugins'), true);assert.ok(absent.run('guard.snapshot().unavailable') > 0);
  const off = fixture([entry('navigator-metadata', { product: 'Gecko' }, 'off')]);
  assert.equal(off.run('nav.product'), 'Native');assert.equal(off.run('guard.snapshot().installed'), 0);
});

test('environment inherited realm: target prototypes, late globals and descriptor-prototype poison never execute', () => {
  const parent = fixture([]), child = fixture([]);
  const installer = parent.run('installApiCustomEnvironment');
  parent.run(`D(Object.prototype,'get',{configurable:true,get(){calls.traps++;throw reason;}});
    D(Object.prototype,'value',{configurable:true,get(){calls.traps++;throw reason;}});`);
  const target = child.run('realm');
  const guard = installer(target, [entry('navigator-plugins', structuredClone(pluginValue))]);
  assert.ok(guard.snapshot().installed > 0);
  assert.equal(child.run('nav.plugins instanceof PluginArray && nav.plugins[0] instanceof Plugin && nav.mimeTypes[0] instanceof MimeType'), true);
  assert.equal(parent.run('calls.traps'), 0);
  child.run(`D(realm,'Object',{configurable:true,get(){calls.traps++;throw reason;}});
    D(realm,'Array',{configurable:true,get(){calls.traps++;throw reason;}});`);
  assert.equal(child.run('nav.plugins.item(0).name'), 'Selected PDF');assert.equal(child.run('calls.traps'), 0);
  guard.stop();assert.equal(child.run('nav.plugins===nativePlugins'), true);
});

test('environment media/supports copied input and missing interface preserve native behavior', () => {
  const f = fixture([entry('css-media', { colorScheme: 'dark' }), entry('css-supports', { queries: [{ query: 'display:grid', supported: true }] })]);
  f.run(`input[0].value.colorScheme='light';input[1].value.queries[0].supported=false;`);
  assert.equal(f.run(`realm.matchMedia('(prefers-color-scheme: dark)').matches`), true);
  assert.equal(f.run(`realm.CSS.supports('display:grid')`), true);
  const missing = fixture([entry('navigator-plugins', pluginValue)], `delete Plugin.prototype.namedItem;`);
  assert.equal(missing.run('nav.plugins===nativePlugins'), true);
  assert.equal(missing.run('guard.snapshot().installed'), 0);
});

test('Navigator GPC: explicit metadata only for an existing getter; native brand/errors and absence retained', () => {
  const f = fixture([entry('navigator-metadata', { globalPrivacyControl: true })], `
    D(Navigator.prototype,'globalPrivacyControl',{configurable:true,get(){calls.field++;if(!navs.has(this))throw reason;return false;}});
  `);
  assert.equal(f.run('calls.field'), 0);assert.equal(f.run('nav.globalPrivacyControl'), true);assert.equal(f.run('calls.field'), 1);
  assert.throws(() => f.run(`A(Object.getOwnPropertyDescriptor(Navigator.prototype,'globalPrivacyControl').get,{},[])`), e => e === f.run('reason'));
  const absent = fixture([entry('navigator-metadata', { globalPrivacyControl: true })]);
  assert.equal(absent.run(`'globalPrivacyControl' in Navigator.prototype`), false);assert.ok(absent.run('guard.snapshot().unavailable') >= 1);
});

test('CSS media cross-Window WebIDL brands: borrowed getter uses callee preferences without public media getters', () => {
  const sharedQueries = new WeakMap();
  const parent = fixture([entry('css-media', { colorScheme: 'dark' })], '', sharedQueries);
  const child = fixture([entry('css-media', { colorScheme: 'light' })], '', sharedQueries);
  child.context.foreign = parent.run(`realm.matchMedia('(prefers-color-scheme: light)')`);
  parent.context.foreign = child.run(`realm.matchMedia('(prefers-color-scheme: dark)')`);
  for (const f of [parent, child]) {
    f.run(`D(foreign,'media',{configurable:true,get(){calls.traps++;throw reason;}});
      globalThis.borrowedGetter=Object.getOwnPropertyDescriptor(MediaQueryList.prototype,'matches').get;`);
    const beforeMatches = f.run('calls.matches'), beforeMedia = f.run('calls.media');
    assert.equal(f.run('A(borrowedGetter,foreign,[])'), true);
    assert.equal(f.run('calls.matches'), beforeMatches + 1);assert.equal(f.run('calls.media'), beforeMedia + 1);
    assert.equal(f.run('A(borrowedGetter,foreign,[])'), true);
    assert.equal(f.run('calls.media'), beforeMedia + 1, 'authenticated known query is cached per callee');
    assert.equal(f.run('calls.traps'), 0);
    assert.throws(() => f.run(`A(borrowedGetter,new Proxy(foreign,new Proxy({}, {get(){calls.traps++;throw reason;}})),[])`), e => e === f.run('reason'));
    assert.equal(f.run('calls.traps'), 0);
  }
  const nativeParent = fixture([], '', sharedQueries);
  child.context.unmapped = nativeParent.run(`A(nativeMatchMedia,realm,['(prefers-color-scheme: light)'])`);
  assert.equal(child.run('A(borrowedGetter,unmapped,[])'), true);
  assert.equal(nativeParent.run('guard.snapshot().installed'), 0, 'foreign profile was never activated');
});

test('ADR-112: replaced environment getters report the name and length of the native getters (copied descriptors, no toString masking)', () => {
  const f = fixture([entry('navigator-metadata', { product: 'Gecko' }), entry('screen-geometry', { innerWidth: 1280, scrollbarsVisible: false })]);
  assert.equal(f.run('realm.navigator.product'), 'Gecko');
  for (const [owner, key] of [['Navigator', 'product'], ['BarProp', 'visible']]) {
    const facts = f.run('(() => { const getter = Object.getOwnPropertyDescriptor(' + owner + '.prototype, ' + JSON.stringify(key) + ').get; return { name: getter.name, length: getter.length, source: Function.prototype.toString.call(getter) }; })()');
    assert.equal(facts.name, 'get ' + key, owner + '.' + key); assert.equal(facts.length, 0, owner + '.' + key); assert.match(facts.source, /selected/, 'the source text is not masked');
  }
});
