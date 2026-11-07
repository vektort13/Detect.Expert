// ADR-020 §E (S11): loader of the synthetic session-recording vendor `test-replay` (test profile only). Served by
// tests/fixture-routes/replay.mjs at http://127.0.0.1:4174/replay/loader.js. It observes the document (S2) and, when
// the page asks for it (window.__replayVendorSends), sends filler bodies to the vendor endpoint
// http://collect.replay.example.org:4174/replay/collect. It never reads a field, a key or a coordinate.
(function () {
  'use strict';
  var noop = function () {};
  new MutationObserver(noop).observe(document, { childList: true, subtree: true });
  var sends = Number(window.__replayVendorSends || 0);
  var made = 0;
  var body = new Array(2049).join('x');
  function step() {
    if (made >= sends) {
      if (typeof window.__replayVendorDone === 'function') window.__replayVendorDone(made);
      return;
    }
    fetch('http://collect.replay.example.org:4174/replay/collect', { method: 'POST', mode: 'no-cors', body: body, headers: { 'content-type': 'text/plain' } }).then(
      function () {
        made++;
        setTimeout(step, 1500);
      },
      function () {
        made++;
        setTimeout(step, 1500);
      },
    );
  }
  step();
})();
