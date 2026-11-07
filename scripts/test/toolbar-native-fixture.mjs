import assert from 'node:assert/strict';

// Runs inside the real privileged extension UI in either browser.
export async function readNativeToolbar(tabId) {
  const action = (globalThis.browser ?? globalThis.chrome).action;
  return Promise.all([{}, {tabId}].map(async target => ({
    ...target, text: await action.getBadgeText(target),
    color: await action.getBadgeBackgroundColor(target),
    title: await action.getTitle(target)
  })));
}

export async function verifyNativeToolbar(read, mode, evidence) {
  const matches = states => states.every(state => mode === 'observing'
    ? /^(\d+)?$/.test(state.text) && state.color.join(',') === '220,38,38,255' && !/ — (ON|OFF)$/.test(state.title)
    : state.text === (mode === 'blocking' ? 'ON' : '') && state.color.join(',') === (mode === 'blocking' ? '22,132,81,255' : '141,146,156,255') && state.title.endsWith(mode === 'blocking' ? ' — ON' : ' — OFF'));
  let states;
  for (let attempt = 0; attempt < 60; attempt++) {
    states = await read();
    if (matches(states)) break;
    await new Promise(done => setTimeout(done, 100));
  }
  assert.ok(matches(states), mode + ': ' + JSON.stringify(states));
  (evidence.toolbar ??= []).push({mode, states});
}
