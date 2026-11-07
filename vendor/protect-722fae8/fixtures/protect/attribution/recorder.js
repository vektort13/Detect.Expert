// Synthetic session-recording-like script of the attribution stand (cdn.replay.example.net): registers listeners on
// the window, the document, the root and a password field, and observes the body. It never reads a field value.
(function () {
  'use strict';
  window.recorder = {
    start: function (password) {
      var noop = function () {};
      document.addEventListener('keydown', noop, true);
      window.addEventListener('scroll', noop, { passive: true });
      document.documentElement.addEventListener('pointermove', noop);
      password.addEventListener('input', noop);
      password.addEventListener('keyup', noop);
      new MutationObserver(noop).observe(document.body, { childList: true, subtree: true, characterData: true });
      return 6;
    },
  };
})();
