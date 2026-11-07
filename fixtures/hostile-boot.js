// F008/F168, REQ-004/006/011: page-readable boot IDs are routing, never authentication.
// Also loaded with Playwright addInitScript so the listener precedes the first queued hello.
(function () {
  if (window.__hostileBoot) return;
  var CHANNEL = 'detect.expert/v1';
  var state = { bootId: null, lastSeq: 0, mismatched: false, restored: true, attack: attack };
  window.__hostileBoot = state;
  var preHandshake = new URL(location.href).searchParams.get('attack') === 'pre-handshake';
  function dispatch(data) {
    window.dispatchEvent(new MessageEvent('message', { source: window, data: data }));
  }
  window.addEventListener('message', function (event) {
    var data = event.data;
    if (event.source !== window || !data || data.channel !== CHANNEL) return;
    if (data.type === 'sensor-hello' && state.bootId === null) {
      state.bootId = data.sensorBootId;
      if (preHandshake) {
        state.mismatched = true;
        // Synchronous dispatch races the queued genuine bridge-hello, without blocking it.
        dispatch({ channel: CHANNEL, sensorBootId: state.bootId, type: 'bridge-hello', protocolVersion: data.protocolVersion + 1, bridgeSessionId: 'page-mismatch', paused: false });
      }
    }
    if (data.type === 'sensor-batch' && data.sensorBootId === state.bootId) state.lastSeq = data.sensorSeq;
  });
  function attack(mode, maxCount) {
    if (!state.bootId) throw new Error('The genuine sensor-hello was not captured');
    var base = { channel: CHANNEL, sensorBootId: state.bootId };
    if (mode === 'sequence') {
      // The plausible DET-040 spoof is separate from MAX_COUNT: both use the real boot.
      var next = state.lastSeq + 1;
      var observation = { techniqueId: 'DET-040', count: 1, countQuality: 'exact', phase: 'attempted', signalCodes: ['api-use'], intervalBucket: 1 };
      window.postMessage(Object.assign({}, base, { type: 'sensor-batch', sensorSeq: maxCount, observations: [observation], coverageDelta: [] }), '*');
      window.postMessage(Object.assign({}, base, { type: 'sensor-batch', sensorSeq: next, observations: [observation], coverageDelta: [] }), '*');
    } else if (mode === 'boot-churn') {
      for (var i = 0; i < 100; i++) window.postMessage({ channel: CHANNEL, sensorBootId: 'churn-' + i, type: 'sensor-hello', protocolVersion: 1, startedLate: false, coverageFlags: [] }, '*');
    } else if (mode === 'status') {
      window.postMessage(Object.assign({}, base, { type: 'sensor-status', state: 'stopped', coverageFlags: ['revoked'], droppedSinceLast: 0 }), '*');
    } else if (mode === 'stop' || mode === 'pause') {
      var control = Object.assign({}, base, { type: 'bridge-' + mode });
      if (mode === 'stop') control.reason = 'revoked';
      dispatch(control);
    } else if (mode === 'pre-handshake') {
      if (!state.mismatched) throw new Error('The pre-handshake attack did not run');
    } else if (mode === 'array-push' || mode === 'set-add') {
      var prototype = mode === 'array-push' ? Array.prototype : Set.prototype;
      var key = mode === 'array-push' ? 'push' : 'add';
      var descriptor = Object.getOwnPropertyDescriptor(prototype, key);
      state.restored = false;
      Object.defineProperty(prototype, key, Object.assign({}, descriptor, { value: function () { throw new Error('fixture prototype tampering'); } }));
      // Restore even if an observer fails; leave the mutation in place across a flush window.
      setTimeout(function () {
        Object.defineProperty(prototype, key, descriptor);
        state.restored = true;
      }, 1000);
      // Set.add is used by addFlag(), not the normal readback path. Force a new diagnostic
      // while it is patched; the real sensor must either report the pause or an explicit gap.
      if (mode === 'set-add') dispatch(Object.assign({}, base, { type: 'bridge-pause' }));
    } else {
      throw new Error('Unknown hostile scenario: ' + mode);
    }
  }
})();
