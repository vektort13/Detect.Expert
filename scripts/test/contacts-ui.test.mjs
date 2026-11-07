import assert from 'node:assert/strict';
import test from 'node:test';
import { CONTACT_LINKS } from '../../apps/production-extension/contacts-data.js';
import { CONTACTS_LABELS, contactsLabels } from '../../apps/production-extension/contacts-labels.js';
import { createContactCopyController, createContactsUi } from '../../apps/production-extension/contacts-ui.js';
import { PRODUCTION_LANGUAGES } from '../production-languages.mjs';

// Independent owner-provided addresses catch accidental edits and copy/link drift.
const expected = [
  ['detect', 'sites', 'https://detect.expert/'],
  ['anti-bot', 'sites', 'https://anti.bot/'],
  ['antidetect', 'sites', 'https://antidetect.com/'],
  ['grid', 'sites', 'https://grid.training/'],
  ['euqlid', 'sites', 'https://euqlid.space/'],
  ['telegram-main', 'social', 'https://t.me/antidetect'],
  ['telegram-ru', 'social', 'https://t.me/antidetectchat'],
  ['telegram-en', 'social', 'https://t.me/multiacceng'],
  ['discord', 'social', 'https://discord.gg/6pENTcY7Zc'],
  ['github', 'social', 'https://github.com/vektort13'],
  ['youtube-ru', 'social', 'https://www.youtube.com/@VektorT13'],
  ['youtube-en', 'social', 'https://www.youtube.com/@VektorT13ENG'],
  ['youtube-vi', 'social', 'https://www.youtube.com/@VektorT13VN'],
  ['youtube-zh', 'social', 'https://www.youtube.com/@VektorT13CN'],
  ['youtube-es', 'social', 'https://www.youtube.com/@VektorT13ES'],
];
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

function contactsTree(locale='en',active=true){
  const cleanups=[];
  const ui=createContactsUi({h:(type,props)=>({type,props}),useState:value=>[value,()=>{}],useRef:value=>({current:value}),useEffect:callback=>{const cleanup=callback();if(cleanup)cleanups.push(cleanup);},useLocale:()=>locale,translate:key=>key});
  const tree=ui.ContactsApp({active});
  const nodes=(predicate,root=tree)=>{const result=[];const visit=node=>{if(Array.isArray(node)){node.forEach(visit);return;}if(!node?.props)return;if(predicate(node))result.push(node);visit(node.props.children);};visit(root);return result;};
  return{tree,nodes,dispose:()=>cleanups.forEach(cleanup=>cleanup())};
}

test('social groups contain every destination exactly once and preserve nested heading/link semantics in all locales',()=>{
  const services=[['telegram',['telegram-main','telegram-ru','telegram-en']],['discord',['discord']],['github',['github']],['youtube',['youtube-ru','youtube-en','youtube-vi','youtube-zh','youtube-es']]];
  for(const language of PRODUCTION_LANGUAGES){const f=contactsTree(language.id);try{
    const groups=f.nodes(node=>node.props['data-contacts-service']);assert.deepEqual(groups.map(node=>node.props['data-contacts-service']),services.map(([id])=>id));
    for(const[groupIndex,group]of groups.entries()){
      assert.equal(group.type,'section');assert.ok(group.props['aria-labelledby']);
      assert.deepEqual(f.nodes(node=>node.props['data-contact'],group).map(node=>node.props['data-contact']),services[groupIndex][1]);
      assert.equal(f.nodes(node=>node.type==='h4',group).length,1);assert.equal(f.nodes(node=>node.type==='h5',group).length,services[groupIndex][1].length);
      assert.equal(f.nodes(node=>node.type==='div'&&node.props.class==='contacts-social-list',group).length,1);
    }
    const links=f.nodes(node=>node.props['data-contact-link']),copies=f.nodes(node=>node.props['data-contact-copy']);
    assert.equal(links.length,15);assert.equal(copies.length,15);
    assert.deepEqual(links.map(node=>node.props['data-contact-link']),expected.map(([id])=>id));
    for(const link of links){const target=expected.find(([id])=>id===link.props['data-contact-link']);assert.equal(link.props.href,target[2]);assert.equal(link.props.target,'_blank');assert.equal(link.props.rel,'noopener noreferrer');}
    const sites=f.nodes(node=>node.props['data-contacts-group']==='sites')[0];assert.equal(f.nodes(node=>node.props['data-contact'],sites).length,5);assert.equal(f.nodes(node=>node.type==='h4',sites).length,5);
    assert.equal(f.nodes(node=>node.type==='img'&&node.props.src==='brand-symbol.svg').length,1);
    for(const service of services)assert.ok(f.nodes(node=>node.type==='img'&&node.props.src==='icons/contacts/'+service[0]+'.svg').length>=2);
  }finally{f.dispose();}}
});

test('all grouped copy buttons still route synchronously through one controller to their exact listed URL',async t=>{
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,'navigator'),writes=[];let inClick=false;
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{clipboard:{writeText:value=>{assert.equal(inClick,true);writes.push(value);return Promise.resolve();}}}});
  t.after(()=>{if(descriptor)Object.defineProperty(globalThis,'navigator',descriptor);else delete globalThis.navigator;});
  const f=contactsTree();try{
    for(const button of f.nodes(node=>node.props['data-contact-copy'])){inClick=true;const pending=button.props.onClick();inClick=false;assert.equal(await pending,true);}
    assert.deepEqual(writes,expected.map(([, ,href])=>href));
    const hidden=contactsTree('ru',false);try{
      for(const button of hidden.nodes(node=>node.props['data-contact-copy'])){assert.equal(button.props.disabled,true);assert.equal(await button.props.onClick(),false);}
      assert.equal(writes.length,15);
    }finally{hidden.dispose();}
  }finally{f.dispose();}
});
function fixture(t, { write = () => Promise.resolve(), clipboard: customClipboard, getClipboard: customGetClipboard } = {}) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const changes = [], writes = [], life = { active: true, epoch: 0 };
  let clipboardAccesses = 0, clipboardReads = 0;
  const clipboard = customClipboard ?? {
    writeText(...args) { writes.push({ receiver: this, args }); return write(...args); },
    get readText() { clipboardReads++; throw Error('Clipboard reads are forbidden'); },
    get read() { clipboardReads++; throw Error('Clipboard reads are forbidden'); },
  };
  const controller = createContactCopyController({
    onChange: value => changes.push(value),
    isActive: () => life.active,
    getEpoch: () => life.epoch,
    getClipboard: () => { clipboardAccesses++; return customGetClipboard ? customGetClipboard() : clipboard; },
  });
  t.after(() => controller.dispose());
  return { controller, clipboard, changes, writes, life,
    get clipboardAccesses() { return clipboardAccesses; },
    get clipboardReads() { return clipboardReads; },
    tick: milliseconds => t.mock.timers.tick(milliseconds),
  };
}

test('contact destinations preserve all 15 exact owner-provided HTTPS addresses and immutable records', () => {
  assert.deepEqual(CONTACT_LINKS.map(({ id, group, href }) => [id, group, href]), expected);
  assert.equal(new Set(CONTACT_LINKS.map(link => link.id)).size, 15);
  assert.equal(CONTACT_LINKS.filter(link => link.group === 'sites').length, 5);
  assert.equal(CONTACT_LINKS.filter(link => link.group === 'social').length, 10);
  assert.ok(Object.isFrozen(CONTACT_LINKS));
  for (const link of CONTACT_LINKS) {
    assert.equal(new URL(link.href).protocol, 'https:');
    assert.ok(Object.isFrozen(link), link.id);
    assert.ok(!link.language || Object.isFrozen(link.language), link.id);
    assert.throws(() => { link.href = 'https://changed.invalid/'; }, TypeError);
  }
  assert.throws(() => { CONTACT_LINKS.push({}); }, TypeError);
  assert.deepEqual(CONTACT_LINKS.map(({ id, group, href }) => [id, group, href]), expected);
});

test('controller initialization is inert and every copy writes the exact listed address without reading clipboard', async t => {
  const f = fixture(t);
  assert.equal(f.clipboardAccesses, 0);
  assert.equal(f.clipboardReads, 0);
  assert.deepEqual(f.changes, []);
  for (const [id, , href] of expected) {
    assert.equal(await f.controller.copy(id), true, id);
    assert.deepEqual(f.writes.at(-1).args, [href], id);
    assert.equal(f.writes.at(-1).receiver, f.clipboard, id);
    assert.deepEqual(f.changes.at(-1), { id, status: 'copied', epoch: 0 });
    assert.ok(Object.isFrozen(f.changes.at(-1)));
  }
  assert.equal(f.clipboardAccesses, 15);
  assert.equal(f.writes.length, 15);
  assert.equal(f.clipboardReads, 0);
});

test('native write happens synchronously in the click activation stack with the clipboard receiver', async t => {
  let inClick = false, calls = 0;
  const clipboard = { writeText(...args) {
    assert.equal(inClick, true, 'no asynchronous boundary before writeText');
    assert.equal(this, clipboard);
    assert.deepEqual(args, ['https://discord.gg/6pENTcY7Zc']);
    calls++;
    return Promise.resolve();
  } };
  const f = fixture(t, { clipboard });
  inClick = true;
  const job = f.controller.copy('discord');
  inClick = false;
  assert.equal(calls, 1);
  assert.deepEqual(f.changes, [{ id: 'discord', status: 'copying', epoch: 0 }]);
  assert.equal(await job, true);
  assert.equal(f.changes.at(-1).status, 'copied');
});

test('unavailable clipboard, throwing getters, synchronous failures and rejected writes never report copied', async t => {
  const failures = {
    unavailable: () => null,
    missingWrite: () => ({}),
    nonCallableWrite: () => ({ writeText: true }),
    clipboardGetterThrows: () => { throw Error('denied'); },
    writeGetterThrows: () => ({ get writeText() { throw Error('denied'); } }),
    nativeThrows: () => ({ writeText() { throw Error('denied'); } }),
    nativeRejects: () => ({ writeText() { return Promise.reject(Error('denied')); } }),
  };
  for (const [name, getClipboard] of Object.entries(failures)) await t.test(name, async t => {
    const f = fixture(t, { getClipboard });
    assert.equal(await f.controller.copy('github'), false);
    assert.equal(f.changes.at(-1).status, 'error');
    assert.equal(f.changes.some(value => value.status === 'copied'), false);
    f.tick(8000);
    assert.equal(f.changes.at(-1).status, 'error');
  });
});

test('inactive, unknown and disposed actions never access the native clipboard', async t => {
  const f = fixture(t, { getClipboard() { throw Error('must not be accessed'); } });
  f.life.active = false;
  assert.equal(await f.controller.copy('detect'), false);
  f.life.active = true;
  for (const id of [undefined, null, {}, '', 'unknown', '__proto__', 'https://detect.expert/']) assert.equal(await f.controller.copy(id), false);
  f.controller.dispose();
  assert.equal(await f.controller.copy('detect'), false);
  assert.equal(f.clipboardAccesses, 0);
  assert.deepEqual(f.changes, []);
});

test('one pending physical write blocks a second write and stale settlement cannot overwrite its feedback', async t => {
  for (const settlement of ['resolve', 'reject']) await t.test(settlement, async t => {
    const held = deferred(), f = fixture(t, { write: () => held.promise });
    const first = f.controller.copy('detect');
    assert.equal(await f.controller.copy('anti-bot'), false);
    assert.equal(f.writes.length, 1);
    assert.equal(f.clipboardAccesses, 1);
    assert.deepEqual(f.changes.at(-1), { id: 'anti-bot', status: 'error', epoch: 0 });
    const before = f.changes.length;
    held[settlement](settlement === 'reject' ? Error('late failure') : undefined);
    await first;
    assert.equal(f.changes.length, before);
    assert.equal(f.changes.some(value => value.status === 'copied'), false);
    assert.equal(await f.controller.copy('github'), settlement === 'resolve');
    assert.equal(f.writes.length, 2, 'physical slot is released only when native write settles');
  });
});

test('hiding and reentering advances the generation and old success or failure cannot update the new view', async t => {
  for (const settlement of ['resolve', 'reject']) await t.test(settlement, async t => {
    const held = deferred(), f = fixture(t, { write: () => held.promise });
    const first = f.controller.copy('telegram-main');
    f.life.active = false;
    f.life.epoch++;
    f.tick(1000);
    f.life.active = true;
    f.life.epoch++;
    const before = f.changes.length;
    held[settlement](settlement === 'reject' ? Error('late failure') : undefined);
    await first;
    assert.equal(f.changes.length, before, 'no status from the old panel lifetime');
    assert.equal(await f.controller.copy('youtube-en'), settlement === 'resolve');
    assert.equal(f.changes.at(-1).epoch, 2);
    assert.equal(f.changes.at(-1).id, 'youtube-en');
  });
});

test('disposed controller cancels its timer and suppresses late success and rejection callbacks', async t => {
  for (const settlement of ['resolve', 'reject']) await t.test(settlement, async t => {
    const held = deferred(), f = fixture(t, { write: () => held.promise });
    const first = f.controller.copy('grid');
    f.controller.dispose();
    const before = f.changes.length;
    f.tick(8000);
    assert.equal(f.changes.length, before);
    held[settlement](settlement === 'reject' ? Error('late failure') : undefined);
    await first;
    assert.equal(f.changes.length, before);
    assert.equal(await f.controller.copy('detect'), false);
    assert.equal(f.writes.length, 1);
  });
});

test('four-second timeout releases visible copying but retains the physical slot until native settlement', async t => {
  for (const settlement of ['resolve', 'reject']) await t.test(settlement, async t => {
    const held = deferred();
    let nativeCalls = 0;
    const f = fixture(t, { write: () => ++nativeCalls === 1 ? held.promise : Promise.resolve() });
    let settled = false;
    const first = f.controller.copy('euqlid');
    void first.then(() => { settled = true; });
    f.tick(3999);
    assert.equal(f.changes.at(-1).status, 'copying');
    f.tick(1);
    assert.deepEqual(f.changes.at(-1), { id: 'euqlid', status: 'error', epoch: 0 });
    assert.equal(settled, false, 'timeout cannot cancel an in-flight native write');
    assert.equal(await f.controller.copy('antidetect'), false);
    assert.equal(nativeCalls, 1, 'a retry cannot overlap an unsettled write');
    const before = f.changes.length;
    held[settlement](settlement === 'reject' ? Error('late failure') : undefined);
    assert.equal(await first, false, 'late success is not reported as a successful copy');
    assert.equal(f.changes.length, before, 'late physical settlement leaves the newer feedback intact');
    assert.equal(await f.controller.copy('antidetect'), true);
    assert.equal(nativeCalls, 2);
    assert.deepEqual(f.changes.at(-1), { id: 'antidetect', status: 'copied', epoch: 0 });
    f.tick(8000);
    assert.equal(f.changes.at(-1).status, 'copied', 'completed writes leave no timeout callback');
  });
});

test('all 21 localized contact dictionaries are complete, immutable and resolve language tags safely', () => {
  const fields = ['sites', 'social', 'copy', 'copied', 'copyFailed', 'open', 'mainGroup', 'russianChat', 'englishChat', 'discordChat', 'github', 'proxyCards', 'userId', 'antidetect', 'training', 'wifiMap'];
  assert.deepEqual(Object.keys(CONTACTS_LABELS).sort(), PRODUCTION_LANGUAGES.map(locale => locale.id).sort());
  assert.ok(Object.isFrozen(CONTACTS_LABELS));
  for (const { id } of PRODUCTION_LANGUAGES) {
    const labels = contactsLabels({ id });
    assert.equal(labels, CONTACTS_LABELS[id]);
    assert.ok(Object.isFrozen(labels), id);
    assert.deepEqual(Object.keys(labels).sort(), [...fields].sort(), id);
    for (const field of fields) assert.ok(typeof labels[field] === 'string' && labels[field].trim() && !labels[field].includes('\uFFFD'), `${id}.${field}`);
    assert.equal(labels.github, 'GitHub');
  }
  for (const [tag, id] of [['zh-Hans', 'zh_CN'], ['pt-BR', 'pt_BR'], ['yue-Hans', 'yue'], ['wuu-Hans', 'wuu'], ['ru-RU', 'ru']]) assert.equal(contactsLabels(tag), CONTACTS_LABELS[id]);
  for (const value of [undefined, null, 12, {}, 'unknown', 'constructor', '__proto__']) assert.equal(contactsLabels(value), CONTACTS_LABELS.en);
  assert.equal(contactsLabels('ru').copy, 'Скопировать ссылку');
  assert.equal(contactsLabels('en').copy, 'Copy link');
});
