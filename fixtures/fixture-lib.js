// Shared helper for detect.expert fixtures. Plain script, same-origin, no external resources.
// Every fixture publishes one machine-readable result into <pre id="result"> and window.__fixtureResult
// so the extension tests and the differential (with/without extension) runs compare the same object.
// Nothing here talks to the extension; the result stays page-side and never contains pixels or data URLs.
(function () {
  'use strict';

  function publish(result) {
    window.__fixtureResult = result;
    var pre = document.getElementById('result');
    if (pre) pre.textContent = JSON.stringify(result, null, 2);
    document.documentElement.setAttribute('data-fixture-done', '1');
    return result;
  }

  /** The second loopback origin of the fixture stand (4173 <-> 4174). */
  function otherOrigin() {
    var port = location.port === '4173' ? '4174' : '4173';
    return location.protocol + '//' + location.hostname + ':' + port;
  }

  /** 32-bit FNV-1a over a string or a byte array. Page-side only: used to compare runs, never exported. */
  function fnv1a(input) {
    var h = 0x811c9dc5;
    if (typeof input === 'string') {
      for (var i = 0; i < input.length; i++) {
        h ^= input.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
      }
    } else {
      for (var j = 0; j < input.length; j++) {
        h ^= input[j];
        h = Math.imul(h, 0x01000193) >>> 0;
      }
    }
    return ('00000000' + h.toString(16)).slice(-8);
  }

  function errorInfo(e) {
    if (e === null || typeof e !== 'object') return { thrown: e === undefined ? 'undefined' : typeof e };
    return {
      name: String(e.name),
      message: String(e.message),
      isDOMException: e instanceof DOMException,
      isTypeError: e instanceof TypeError,
      isRangeError: e instanceof RangeError,
      code: typeof e.code === 'number' ? e.code : null
    };
  }

  function attempt(fn) {
    try {
      return { threw: false, value: fn() };
    } catch (e) {
      return { threw: true, error: errorInfo(e) };
    }
  }

  /** Draws a few text lines in different fonts: the usual "test drawing" before a readback. */
  function drawSample(ctx, label) {
    var fonts = ['14px Arial', 'bold 16px "Times New Roman"', 'italic 13px Courier', '15px sans-serif', '12px serif'];
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#f60';
    ctx.fillRect(10, 5, 60, 20);
    for (var i = 0; i < fonts.length; i++) {
      ctx.font = fonts[i];
      ctx.fillStyle = 'rgb(' + (30 * i) + ',102,204)';
      ctx.fillText(label + ' 😀 ☃', 2, 14 + i * 10);
    }
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = 'rgba(255,0,255,0.5)';
    ctx.beginPath();
    ctx.arc(60, 30, 20, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    return fonts.length;
  }

  window.__fixture = { publish: publish, otherOrigin: otherOrigin, fnv1a: fnv1a, errorInfo: errorInfo, attempt: attempt, drawSample: drawSample };
})();
