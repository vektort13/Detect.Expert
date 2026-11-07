// ADR-020 §E (S11): our own synthetic session recorder for the replay stand. It registers page-level listeners
// (keyboard input and pointer / scroll on the document and the window), observes the document, and sends filler
// bodies periodically. It never reads a field value, a key or a coordinate: the bodies are 'x' characters only.
(function () {
  'use strict';
  var noop = function () {};

  function listen(mode) {
    if (mode === 'elements') {
      // Element-level only: fields and a plain div (S1 counts window / document only).
      var fields = document.querySelectorAll('input');
      for (var i = 0; i < fields.length; i++) {
        fields[i].addEventListener('keydown', noop);
        fields[i].addEventListener('input', noop);
      }
      var area = document.getElementById('area');
      if (area) {
        area.addEventListener('mousemove', noop);
        area.addEventListener('scroll', noop);
      }
      return;
    }
    document.addEventListener('keydown', noop, true);
    document.addEventListener('input', noop, true);
    window.addEventListener('mousemove', noop, { passive: true });
    window.addEventListener('scroll', noop, { passive: true });
  }

  function observe(target) {
    new MutationObserver(noop).observe(target || document, { childList: true, subtree: true, attributes: true, characterData: true });
  }

  function filler(bytes) {
    return new Array(bytes + 1).join('x');
  }

  function wait(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  /** One send with `bytes` of filler. transport: 'fetch' (default), 'beacon' or 'ws' (an open WebSocket). */
  function sendOnce(opts) {
    var body = filler(opts.bytes || 0);
    if (opts.transport === 'beacon') return Promise.resolve(navigator.sendBeacon(opts.url, body));
    if (opts.transport === 'ws') {
      opts.socket.send(body);
      return Promise.resolve(true);
    }
    var init = { method: opts.method || 'POST', mode: 'no-cors', cache: 'no-store' };
    if (init.method !== 'GET') {
      init.body = body;
      init.headers = { 'content-type': 'text/plain' };
    }
    return fetch(opts.url, init).then(
      function () {
        return true;
      },
      function () {
        return false;
      },
    );
  }

  /** `count` sends every `every` ms. Resolves with the number of sends made. */
  function sendSeries(opts) {
    var made = 0;
    var step = function () {
      if (made >= opts.count) return Promise.resolve(made);
      return sendOnce(opts).then(function () {
        made++;
        return made >= opts.count ? made : wait(opts.every).then(step);
      });
    };
    return step();
  }

  /** Opens a WebSocket to the stand's /ws handshake (frames are never read by the server). */
  function socket(origin) {
    return new Promise(function (resolve, reject) {
      var ws = new WebSocket(origin.replace(/^http/, 'ws') + '/ws');
      ws.onopen = function () {
        resolve(ws);
      };
      ws.onerror = function () {
        reject(new Error('ws failed'));
      };
    });
  }

  window.replaySim = { listen: listen, observe: observe, sendSeries: sendSeries, socket: socket, wait: wait };
})();
