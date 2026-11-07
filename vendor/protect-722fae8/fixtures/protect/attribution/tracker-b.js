// Second synthetic third-party script (cdn.tracker-b.example.org): sends to the same receiver as tracker-a at the same
// moment, so the source of those two requests cannot be told apart (ambiguous).
(function () {
  'use strict';
  window.trackerB = {
    sendAmbiguous: function () {
      return fetch('http://collect-amb.example.net:' + location.port + '/attr/b', { mode: 'no-cors' });
    },
  };
})();
