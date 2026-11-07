// ADR-070: aggregate WebRTC ownership and restore only our prediction layer.
import { ProxyError } from './proxy-shared.js';
export function createProxyPrivacyOverlay(api, configurationController) {
  const native = globalThis.browser?.runtime?.id === api.runtime?.id ? globalThis.browser : api;
  const KEY = 'proxy-privacy-owner:v1';
  let queue = Promise.resolve();
  const fail = code => { throw new ProxyError(code); };
  let predictionActive = false, listening = null;
  function watchPrediction() {
    const event = native.privacy?.network?.networkPredictionEnabled?.onChange;
    if (!event?.addListener || event === listening) return;
    listening = event;
    event.addListener(() => {
      if (predictionActive) return;
      const task = queue.then(() => prediction(false), () => prediction(false));
      queue = task.then(() => undefined, () => undefined);
    });
  }
  async function prediction(active) {
    const setting = native.privacy?.network?.networkPredictionEnabled;
    if (!setting?.get || !setting?.set || !setting?.clear) { if (active) fail('privacy-unavailable'); return; }
    const current = await setting.get({});
    const saved = (await native.storage.local.get(KEY))[KEY];
    if (active) {
      if (!['controllable_by_this_extension', 'controlled_by_this_extension'].includes(current?.levelOfControl)) fail('privacy-conflict');
      if (!saved || saved.version !== 1) await native.storage.local.set({ [KEY]: { version: 1, previous: current.levelOfControl === 'controlled_by_this_extension' && typeof current.value === 'boolean' ? current.value : null } });
      if (current.levelOfControl !== 'controlled_by_this_extension' || current.value !== false) if (await setting.set({ value: false, scope: 'regular' }) === false) fail('privacy-unavailable');
      const actual = await setting.get({});
      if (actual?.levelOfControl !== 'controlled_by_this_extension' || actual.value !== false) fail('privacy-conflict');
    } else if (saved?.version === 1) {
      if (current?.levelOfControl === 'controlled_by_this_extension' && current.value === false) {
        if (typeof saved.previous === 'boolean') { if (await setting.set({ value: saved.previous, scope: 'regular' }) === false) fail('privacy-unavailable'); }
        else if (await setting.clear({ scope: 'regular' }) === false) fail('privacy-unavailable');
        const actual = await setting.get({});
        if (typeof saved.previous === 'boolean' ? actual?.levelOfControl !== 'controlled_by_this_extension' || actual.value !== saved.previous : actual?.levelOfControl === 'controlled_by_this_extension') fail('privacy-conflict');
      } else if (['controlled_by_other_extensions', 'not_controllable'].includes(current?.levelOfControl)) {
        // Clear our hidden layer; never set over the newer owner.
        if (await setting.clear({ scope: 'regular' }) === false) fail('privacy-unavailable');
        if (typeof saved.previous === 'boolean') {
          // Restore the former local preference only when the other owner
          // releases control. Until then no native set is permitted.
          await native.storage.local.set({ [KEY]: { ...saved, released: true } });
          return;
        }
      } else if (saved.released === true && typeof saved.previous === 'boolean' && current?.levelOfControl === 'controllable_by_this_extension') {
        if (await setting.set({ value: saved.previous, scope: 'regular' }) === false) fail('privacy-unavailable');
        const actual = await setting.get({});
        if (actual?.levelOfControl !== 'controlled_by_this_extension' || actual.value !== saved.previous) fail('privacy-conflict');
      }
      await native.storage.local.remove(KEY);
    }
  }
  return {
    setActive(active, { protectWebRTC = true, disablePrediction = true } = {}) {
      const operation = async () => {
        // Retain the stronger persisted Proxy requirement before Antidetect's
        // startup reconciliation can release its independent policy layer.
        if (active && protectWebRTC) await configurationController.webrtcNetwork.setProxyActive(true);
        await configurationController.start();
        const allowed = await native.permissions.contains({ permissions: ['privacy'] });
        if (!allowed) {
          if (active && (protectWebRTC || disablePrediction)) fail('privacy-permission-required');
          await configurationController.webrtcNetwork.setProxyActive(false);
          await native.storage.local.remove(KEY);
          return { status: 'inactive' };
        }
        predictionActive = active && disablePrediction;
        watchPrediction();
        const rtc = await configurationController.webrtcNetwork.setProxyActive(active && protectWebRTC);
        if (active && protectWebRTC && rtc.status !== 'applied') fail(rtc.status === 'not-controllable' ? 'privacy-conflict' : 'privacy-unavailable');
        await prediction(active && disablePrediction);
        return { status: active ? 'applied' : 'inactive' };
      };
      const result = queue.then(operation, operation);
      queue = result.then(() => undefined, () => undefined);
      return result;
    },
  };
}
