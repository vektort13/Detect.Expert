// Synthetic third-party script of the attribution stand (ADR-020 §F, S10), served from cdn.tracker-a.example.org.
// Every send of this file is called by the page, so the nearest page frame on the stack is this file.
(function () {
  'use strict';
  function url(host, path) {
    return 'http://' + host + ':' + location.port + '/attr/' + path;
  }
  window.trackerA = {
    sendFetch: function () {
      return fetch(url('collect-ext.example.net', 'fetch'), { method: 'POST', mode: 'no-cors', body: 'a=1' });
    },
    sendXhr: function () {
      var xhr = new XMLHttpRequest();
      xhr.open('POST', url('collect-xhr.example.net', 'xhr'));
      xhr.send('a=1');
      return xhr;
    },
    sendBeacon: function () {
      return navigator.sendBeacon(url('collect-beacon.example.net', 'beacon'), 'a=1');
    },
    sendAmbiguous: function () {
      return fetch(url('collect-amb.example.net', 'a'), { mode: 'no-cors' });
    },
  };
})();
