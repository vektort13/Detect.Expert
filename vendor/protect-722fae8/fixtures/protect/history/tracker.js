// S12 (ADR-020 §G) history stand: a third-party "tracker" script. It sends one image request and one XHR to
// /history/collect on its own host (the fixture server answers 204 and never reads the body). It sends no page data.
(function () {
  'use strict';
  var script = document.currentScript;
  var base = script !== null && typeof script.src === 'string' ? new URL(script.src).origin : '';
  var img = new Image();
  img.src = base + '/history/collect?kind=img';
  var xhr = new XMLHttpRequest();
  xhr.open('POST', base + '/history/collect?kind=xhr');
  xhr.send('ping');
  window.__historyTracker = 'sent';
})();
