// ADR-083 / FP-03: document inheritance hooks preserve native non-constructability.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { installApiCustomDocument } from '../../apps/production-extension/api-custom-document-runtime.js';

function fixture(install = installApiCustomDocument) {
  const calls = [], result = {}, failure = new TypeError('Native receiver');
  class Navigator {}
  class Node {
    appendChild() {
      'use strict';
      calls.push({ kind: 'operation', receiver: this, args: [...arguments] });
      if (this !== node) throw failure;
      return result;
    }
  }
  class HTMLIFrameElement {
    get contentWindow() {
      'use strict';
      calls.push({ kind: 'get', receiver: this, args: [...arguments] });
      if (this !== frame) throw failure;
      return null;
    }
  }
  class Element {
    set innerHTML(value) {
      'use strict';
      calls.push({ kind: 'set', receiver: this, args: [...arguments] });
      if (this !== element) throw failure;
      void value;
    }
  }
  const node = new Node(), frame = new HTMLIFrameElement(), element = new Element();
  const realm = { Navigator, Node, HTMLIFrameElement, Element };
  Object.defineProperty(realm, 'self', { configurable: true, get() { return this; } });
  install(realm, [{ id: 'hardware-concurrency', mode: 'custom', value: 8 }], () => {});
  return { realm, node, frame, element, calls, result, failure };
}

function rejectsConstruction(operation, calls) {
  assert.equal(Object.hasOwn(operation, 'prototype'), false);
  const before = calls.length;
  assert.throws(() => new operation(), TypeError);
  assert.throws(() => Reflect.construct(operation, []), TypeError);
  assert.equal(calls.length, before, 'construction must fail before calling the original');
}

test('document operation rejects construction before native and retains receiver, arguments, result and exception', () => {
  const f = fixture(), operation = f.realm.Node.prototype.appendChild;
  rejectsConstruction(operation, f.calls);
  const opaque = new Proxy({}, { get() { throw Error('Unexpected argument read'); } });
  assert.equal(Reflect.apply(operation, f.node, [opaque, undefined]), f.result);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].receiver, f.node);
  assert.deepEqual(f.calls[0].args, [opaque, undefined]);
  assert.throws(() => Reflect.apply(operation, null, [opaque]), error => error === f.failure);
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[1].receiver, null);
});

test('document accessor getter rejects construction before native and preserves borrowed calls', () => {
  const f = fixture(), getter = Object.getOwnPropertyDescriptor(f.realm.HTMLIFrameElement.prototype, 'contentWindow').get;
  rejectsConstruction(getter, f.calls);
  assert.equal(Reflect.apply(getter, f.frame, [Symbol.for('argument')]), null);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].receiver, f.frame);
  assert.deepEqual(f.calls[0].args, [Symbol.for('argument')]);
  assert.throws(() => Reflect.apply(getter, undefined, []), error => error === f.failure);
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[1].receiver, undefined);
});

test('document accessor setter rejects construction before native without extra argument coercion', () => {
  const f = fixture(), setter = Object.getOwnPropertyDescriptor(f.realm.Element.prototype, 'innerHTML').set;
  rejectsConstruction(setter, f.calls);
  const opaque = new Proxy({}, { get() { throw Error('Unexpected setter coercion'); } });
  assert.equal(Reflect.apply(setter, f.element, [opaque, 'extra']), undefined);
  assert.equal(f.calls.length, 1);
  assert.deepEqual(f.calls[0].args, [opaque, 'extra']);
  assert.throws(() => Reflect.apply(setter, 0, [opaque]), error => error === f.failure);
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[1].receiver, 0);
});

test('serialized document installer retains non-constructable hooks and strict primitive receiver semantics', () => {
  const context = vm.createContext({});
  const install = vm.runInContext('(' + installApiCustomDocument.toString() + ')', context);
  const f = fixture(install), operation = f.realm.Node.prototype.appendChild;
  rejectsConstruction(operation, f.calls);
  assert.throws(() => Reflect.apply(operation, undefined, []), error => error === f.failure);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].receiver, undefined);
});

function documentOpenFixture() {
  const calls = [], installed = [], windows = new WeakSet(), reason = new TypeError('Native Document receiver');
  let result, thrown = null;
  class Document {
    open() {
      'use strict';
      calls.push({ receiver: this, args: [...arguments] });
      if (this !== document) throw reason;
      if (thrown) throw thrown;
      return result;
    }
  }
  const realm = { Navigator: class Navigator {}, Document };
  const child = { Navigator: class Navigator {} };
  const document = new Document(); realm.document = document;
  windows.add(realm); windows.add(child);
  Object.defineProperty(realm, 'self', { configurable: true, get() {
    if (!windows.has(this)) throw new TypeError('Native Window receiver');
    return this;
  } });
  installApiCustomDocument(realm, [{ id: 'hardware-concurrency', mode: 'custom', value: 8 }], target => installed.push(target));
  return { realm, child, document, calls, installed, reason, returns(value) { result = value; }, throws(value) { thrown = value; } };
}

test('ADR-084: document.open three-argument Window result inherits before being returned, with original this/args once', () => {
  const f = documentOpenFixture(); f.returns(f.child);
  const opaque = new Proxy({}, { get() { throw Error('Unexpected argument coercion'); } });
  assert.equal(Reflect.apply(f.document.open, f.document, [opaque, '_blank', 'width=420']), f.child);
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].receiver, f.document);
  assert.deepEqual(f.calls[0].args, [opaque, '_blank', 'width=420']);
  assert.deepEqual(f.installed, [f.realm, f.child]);
  assert.equal(f.child[Symbol.for('detect.expert/api-custom/value-capture-deny/v1')], true);
  assert.equal(Reflect.apply(f.document.open, f.document, ['about:blank', '_blank', '']), f.child);
  assert.equal(f.calls.length, 2); assert.equal(f.installed.length, 2, 'Already protected Window is not reinstalled');
});

test('ADR-084: document.open null or Document result is returned unchanged without creating a Window profile', () => {
  const f = documentOpenFixture();
  for (const value of [null, f.document]) {
    f.returns(value); assert.equal(f.document.open(), value);
  }
  assert.equal(f.calls.length, 2); assert.deepEqual(f.installed, [f.realm]);
});

test('ADR-084: document.open native brand/error and non-extensible returned Window retain native outcome', () => {
  const f = documentOpenFixture();
  assert.throws(() => Reflect.apply(f.document.open, null, []), error => error === f.reason);
  const reason = new Error('Native operation failure'); f.throws(reason);
  assert.throws(() => f.document.open('about:blank', '_blank', ''), error => error === reason);
  assert.equal(f.calls.length, 2); assert.deepEqual(f.installed, [f.realm]);
  f.throws(null); f.returns(Object.preventExtensions(f.child));
  assert.equal(f.document.open('about:blank', '_blank', ''), f.child);
  assert.equal(f.calls.length, 3);
});

// Private native-like tree operations deliberately bypass public appendChild:
// the old installer must not receive inheritance accidentally from the fixture.
function insertionFixture({ install = installApiCustomDocument, absent = [] } = {}) {
  const nodes=new WeakMap(),ranges=new WeakMap(),windows=new WeakSet(),children=new WeakMap(),installed=[],operations=[],queries=[];
  const reason=new TypeError('Native DOM receiver'),result={nativeResult:true};let thrown=null,pending=null,body;
  function data(node){const value=nodes.get(node);if(!value)throw reason;return value;}
  function frames(root){const output=[];function walk(node){for(const child of data(node).children){if(data(child).name==='iframe')output.push(child);walk(child);}}walk(root);return output;}
  function connected(node){let current=node;for(let depth=0;current&&depth<32;depth++){if(current===document)return true;const value=data(current);current=value.parent??value.host;}return false;}
  function publish(){let index=0;function walk(node){for(const child of data(node).children){if(data(child).name==='iframe')realm[index++]=children.get(child);walk(child);}if(data(node).shadow)walk(data(node).shadow);}walk(document);for(const key of Object.keys(realm))if(/^\d+$/u.test(key)&&Number(key)>=index)delete realm[key];}
  function insert(parent,node){const target=data(parent),value=data(node);if(value.type===11&&!value.host){const moving=[...value.children];value.children=[];for(const child of moving){data(child).parent=null;insert(parent,child);}publish();return;}if(value.parent){const before=data(value.parent).children,at=before.indexOf(node);if(at>=0)before.splice(at,1);}value.parent=parent;target.children.push(node);publish();}
  function replace(parent,node){for(const child of data(parent).children)data(child).parent=null;data(parent).children=[];if(node)insert(parent,node);publish();}
  function operation(kind,receiver,args){operations.push({kind,receiver,args:[...args]});if(thrown)throw thrown;return result;}
  class Navigator{get hardwareConcurrency(){return 2;}}
  class Node{
    constructor(type){nodes.set(this,{type,name:null,parent:null,children:[]});}
    get nodeType(){return data(this).type;}
    get parentNode(){return data(this).parent;}
    appendChild(node){const value=operation('appendChild',this,arguments);data(this);insert(this,node);return value;}
  }
  class Element extends Node{
    constructor(name='div'){super(1);data(this).name=name;}
    get localName(){const value=data(this);if(value.type!==1)throw reason;return value.name;}
    querySelectorAll(){if(data(this).type!==1)throw reason;queries.push(this);return frames(this);}
    setHTMLUnsafe(value){const outcome=operation('Element.setHTMLUnsafe',this,arguments);if(data(this).type!==1)throw reason;void String(value);replace(this,pending);return outcome;}
    moveBefore(node){const outcome=operation('Element.moveBefore',this,arguments);if(data(this).type!==1)throw reason;insert(this,node);return outcome;}
  }
  class DocumentFragment extends Node{
    constructor(){super(11);}
    querySelectorAll(){if(data(this).type!==11)throw reason;queries.push(this);return frames(this);}
    moveBefore(node){const outcome=operation('DocumentFragment.moveBefore',this,arguments);if(data(this).type!==11)throw reason;insert(this,node);return outcome;}
  }
  class ShadowRoot extends DocumentFragment{
    constructor(host){super();data(this).host=host;data(host).shadow=this;}
    setHTMLUnsafe(value){const outcome=operation('ShadowRoot.setHTMLUnsafe',this,arguments);if(!data(this).host)throw reason;void String(value);replace(this,pending);return outcome;}
  }
  class Document extends Node{
    constructor(){super(9);}
    querySelectorAll(){if(data(this).type!==9)throw reason;queries.push(this);return frames(this);}
    get body(){if(this!==document)throw reason;return body;}
    set body(value){operation('Document.body',this,arguments);if(this!==document||data(value).name!=='body')throw reason;if(body)data(body).parent=null;body=value;replace(document,value);}
    moveBefore(node){const outcome=operation('Document.moveBefore',this,arguments);if(this!==document)throw reason;insert(this,node);return outcome;}
  }
  class Range{
    constructor(anchor){ranges.set(this,{anchor});}
    get commonAncestorContainer(){const value=ranges.get(this);if(!value)throw reason;return value.anchor;}
    insertNode(node){const outcome=operation('Range.insertNode',this,arguments),range=ranges.get(this);if(!range)throw reason;const anchor=data(range.anchor).type===3?data(range.anchor).parent:range.anchor;insert(anchor,node);return outcome;}
    surroundContents(parent){const outcome=operation('Range.surroundContents',this,arguments),range=ranges.get(this);if(!range)throw reason;if(pending)insert(parent,pending);insert(range.anchor,parent);return outcome;}
  }
  class HTMLIFrameElement extends Element{
    constructor(){super('iframe');}
    get contentWindow(){if(data(this).name!=='iframe')throw reason;return connected(this)?children.get(this):null;}
  }
  const document=new Document(),realm={Navigator,Node,Element,Document,DocumentFragment,ShadowRoot,Range,HTMLIFrameElement,document,navigator:new Navigator()};windows.add(realm);
  Object.defineProperty(realm,'self',{configurable:true,get(){if(!windows.has(this))throw reason;return this;}});
  body=new Element('body');insert(document,body);
  for(const name of absent){const [type,key]=name.split('.');delete realm[type].prototype[key];}
  const returns=install(realm,[{id:'hardware-concurrency',mode:'custom',value:8}],target=>{installed.push(target);Object.defineProperty(target.Navigator.prototype,'hardwareConcurrency',{configurable:true,get(){return 8;}});});
  queries.length=0;
  function frame(){const node=new HTMLIFrameElement(),ChildNavigator=class Navigator{get hardwareConcurrency(){return 2;}},child={Navigator:ChildNavigator,navigator:new ChildNavigator()};windows.add(child);children.set(node,child);return{node,child};}
  return{realm,document,body,frame,Element,DocumentFragment,ShadowRoot,Range,Node,installed,operations,queries,result,reason,returns,insert,replace,data,queue(node){pending=node;},throws(value){thrown=value;}};
}

test('document Range.insertNode protects fresh iframe before the immediate indexed Window read',()=>{
  const f=insertionFixture(),fresh=f.frame(),range=new f.Range(f.body);
  assert.equal(fresh.child.navigator.hardwareConcurrency,2);assert.equal(f.operations.length,0);
  const opaque=new Proxy({}, {get(){throw Error('Unexpected extra argument read');}});
  assert.equal(Reflect.apply(range.insertNode,range,[fresh.node,opaque]),f.result);
  assert.equal(f.realm[0].navigator.hardwareConcurrency,8);assert.deepEqual(f.operations.map(row=>row.kind),['Range.insertNode']);assert.deepEqual(f.operations[0].args,[fresh.node,opaque]);assert.equal(f.queries.includes(f.document),false);
  assert.equal(Object.getOwnPropertyDescriptor(fresh.child,Symbol.for('detect.expert/api-custom/value-capture-deny/v1')).value,true);
});

test('document Range fragment insertion covers emptied fragments and Text ancestor using local native scope',()=>{
  for(const textAncestor of[false,true]){const f=insertionFixture(),fresh=f.frame(),fragment=new f.DocumentFragment();f.insert(fragment,fresh.node);let anchor=f.body;if(textAncestor){anchor=new f.Node(3);f.insert(f.body,anchor);}const range=new f.Range(anchor);f.operations.length=0;f.queries.length=0;
   assert.equal(range.insertNode(fragment),f.result);assert.equal(f.data(fragment).children.length,0);assert.equal(f.realm[0].navigator.hardwareConcurrency,8);assert.equal(f.operations.length,1);assert.equal(f.queries.includes(f.document),false);assert.ok(f.queries.includes(f.body));}
});

test('document Range.surroundContents protects frames introduced in the new parent synchronously',()=>{
 const f=insertionFixture(),fresh=f.frame(),parent=new f.Element('section');f.queue(fresh.node);const range=new f.Range(f.body);assert.equal(range.surroundContents(parent),f.result);assert.equal(f.realm[0].navigator.hardwareConcurrency,8);assert.deepEqual(f.operations.map(row=>row.kind),['Range.surroundContents']);assert.equal(f.queries.includes(f.document),false);
});

test('document available setHTMLUnsafe operations preserve one native coercion and inherit local light/shadow descendants',()=>{
 for(const shadow of[false,true]){const f=insertionFixture(),fresh=f.frame(),target=shadow?new f.ShadowRoot(f.body):f.body;f.queue(fresh.node);let coercions=0;const value={toString(){coercions++;return'<iframe></iframe>';}};assert.equal(target.setHTMLUnsafe(value),f.result);assert.equal(coercions,1);assert.equal(f.operations.length,1);assert.equal(f.realm[0].navigator.hardwareConcurrency,8);assert.equal(f.queries.includes(f.document),false);}
});

test('document moveBefore on available ParentNode interfaces protects inserted descendants before indexed access',()=>{
 for(const kind of['element','fragment','document']){const f=insertionFixture(),fresh=f.frame();let target=f.body;if(kind==='fragment')target=new f.ShadowRoot(f.body);else if(kind==='document')target=f.document;assert.equal(target.moveBefore(fresh.node,null),f.result);assert.equal(f.realm[0].navigator.hardwareConcurrency,8);assert.equal(f.operations.length,1);}
});

test('document native body setter inherits replacement body frames without changing getter identity or adding coercion',()=>{
 const f=insertionFixture(),fresh=f.frame(),body=new f.Element('body');f.insert(body,fresh.node);const setter=Object.getOwnPropertyDescriptor(f.realm.Document.prototype,'body').set,getter=Object.getOwnPropertyDescriptor(f.realm.Document.prototype,'body').get;
 assert.equal(Reflect.apply(setter,f.document,[body]),undefined);assert.equal(f.document.body,body);assert.equal(f.realm[0].navigator.hardwareConcurrency,8);assert.equal(Object.getOwnPropertyDescriptor(f.realm.Document.prototype,'body').get,getter);assert.equal(f.operations.length,1);assert.equal(f.queries.includes(f.document),false);
});

test('document insertion hooks retain native errors, receiver checks and non-constructability without inheritance after failure',()=>{
 const f=insertionFixture(),fresh=f.frame(),range=new f.Range(f.body),reason=Error('native insertion failure');f.throws(reason);const operations=[()=>range.insertNode(fresh.node),()=>range.surroundContents(f.body),()=>f.body.setHTMLUnsafe('fixture'),()=>f.body.moveBefore(fresh.node,null),()=>Reflect.apply(Object.getOwnPropertyDescriptor(f.realm.Document.prototype,'body').set,f.document,[f.body])];
 for(const operation of operations){const count=f.operations.length;assert.throws(operation,error=>error===reason);assert.equal(f.operations.length,count+1);assert.equal(fresh.child.navigator.hardwareConcurrency,2);assert.equal(f.installed.length,1);}
 f.throws(null);for(const operation of[f.realm.Range.prototype.insertNode,f.realm.Range.prototype.surroundContents,f.realm.Element.prototype.setHTMLUnsafe,f.realm.ShadowRoot.prototype.setHTMLUnsafe,f.realm.Element.prototype.moveBefore]){rejectsConstruction(operation,f.operations);const count=f.operations.length;assert.throws(()=>Reflect.apply(operation,undefined,[fresh.node]),error=>error===f.reason);assert.equal(f.operations.length,count+1);assert.equal(fresh.child.navigator.hardwareConcurrency,2);}
});

test('document insertion does not fabricate absent methods and repeated inheritance is idempotent with capture veto unread',()=>{
 const f=insertionFixture({absent:['Range.insertNode','Range.surroundContents','Element.setHTMLUnsafe','ShadowRoot.setHTMLUnsafe','Element.moveBefore','DocumentFragment.moveBefore','Document.moveBefore','Document.body']});assert.equal(Object.hasOwn(f.realm.Range.prototype,'insertNode'),false);assert.equal(Object.hasOwn(f.realm.Element.prototype,'setHTMLUnsafe'),false);assert.equal(Object.hasOwn(f.realm.Document.prototype,'body'),false);
 const g=insertionFixture(),fresh=g.frame(),range=new g.Range(g.body);let reads=0;Object.defineProperty(fresh.child,Symbol.for('detect.expert/api-custom/value-capture-deny/v1'),{get(){reads++;throw Error('capture marker must not execute');},configurable:false});range.insertNode(fresh.node);range.insertNode(fresh.node);assert.equal(fresh.child.navigator.hardwareConcurrency,8);assert.equal(g.installed.length,2);assert.equal(reads,0);assert.equal(g.returns,undefined,'The immutable installer exposes no restore/stop command');
});

test('document insertion preserves the existing 1024-realm cap instead of claiming uncapped coverage',()=>{
 const f=insertionFixture(),container=new f.Element('section'),fresh=[];for(let i=0;i<1025;i++){const frame=f.frame();fresh.push(frame);f.insert(container,frame.node);}new f.Range(f.body).insertNode(container);assert.equal(f.installed.length,1024);assert.equal(fresh.filter(frame=>frame.child.navigator.hardwareConcurrency===8).length,1023);assert.equal(fresh.at(-1).child.navigator.hardwareConcurrency,2);
});

test('serialized document insertion installer covers Range without depending on ambient module bindings',()=>{
 const install=vm.runInNewContext('('+installApiCustomDocument.toString()+')'),f=insertionFixture({install}),fresh=f.frame();new f.Range(f.body).insertNode(fresh.node);assert.equal(f.realm[0].navigator.hardwareConcurrency,8);assert.equal(f.operations.length,1);
});
