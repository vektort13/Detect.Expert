// ADR-020 §H (S13): dedicated Worker of gpc-top.html. Reports whether navigator.globalPrivacyControl exists in the
// worker (the module sets it only in documents: a coverage gap) and the Sec-GPC the server saw on the worker's fetch.
'use strict';
var value = self.navigator.globalPrivacyControl;
fetch('/gpc-echo/worker-fetch', { cache: 'no-store' })
  .then(function (r) { return r.json(); })
  .then(function (j) { return j.secGpc; }, function () { return 'error'; })
  .then(function (secGpc) { self.postMessage({ value: value === undefined ? 'undefined' : value, fetch: secGpc }); });
