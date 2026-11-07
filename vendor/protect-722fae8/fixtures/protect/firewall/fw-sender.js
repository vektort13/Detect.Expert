// Synthetic third-party "sender" of the firewall stand (ADR-020 §C, S08). Loaded from cdn.example.org by the stand
// pages. It hashes the e-mail typed into #email (own SHA-256: no crypto.subtle on http pages, SP-13) and sends the
// hash to the receiver through sendBeacon, fetch, an image and XHR. Counts only: window.__fwAttempts (calls made by
// the page) and window.__fwSettled (fetch/XHR/image callbacks). The stand server never reads bodies or values.
(function () {
  'use strict';
  var params = new URLSearchParams(location.search);
  var receiver = params.get('to') || 'collect.example.net';
  var receiverPort = params.get('rport') || '4174';
  var attempts = { beacon: 0, fetch: 0, img: 0, xhr: 0 };
  var settled = { ok: 0, failed: 0 };
  window.__fwAttempts = attempts;
  window.__fwSettled = settled;

  // SHA-256 (FIPS 180-4) over UTF-8, hex lower.
  function sha256Hex(text) {
    var bytes = new TextEncoder().encode(text);
    var K = [
      0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01,
      0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
      0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
      0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
      0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08,
      0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
      0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
    ];
    var H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    var bitLen = bytes.length * 8;
    var padded = new Uint8Array(((bytes.length + 9 + 63) >> 6) << 6);
    padded.set(bytes);
    padded[bytes.length] = 0x80;
    var view = new DataView(padded.buffer);
    view.setUint32(padded.length - 4, bitLen >>> 0);
    view.setUint32(padded.length - 8, Math.floor(bitLen / 0x100000000));
    var w = new Uint32Array(64);
    for (var off = 0; off < padded.length; off += 64) {
      for (var i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4);
      for (i = 16; i < 64; i++) {
        var a0 = w[i - 15], a1 = w[i - 2];
        var s0 = ((a0 >>> 7) | (a0 << 25)) ^ ((a0 >>> 18) | (a0 << 14)) ^ (a0 >>> 3);
        var s1 = ((a1 >>> 17) | (a1 << 15)) ^ ((a1 >>> 19) | (a1 << 13)) ^ (a1 >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
      }
      var a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (i = 0; i < 64; i++) {
        var S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
        var ch = (e & f) ^ (~e & g);
        var t1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
        var S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
        var maj = (a & b) ^ (a & c) ^ (b & c);
        var t2 = (S0 + maj) >>> 0;
        h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
      H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
    }
    var out = '';
    for (i = 0; i < 8; i++) out += ('00000000' + H[i].toString(16)).slice(-8);
    return out;
  }
  window.__fwSha256 = sha256Hex;

  function target(kind, hash) {
    return location.protocol + '//' + receiver + ':' + receiverPort + '/fw/collect?k=' + kind + '&h=' + hash;
  }

  function currentHash() {
    var field = document.getElementById('email');
    var value = field ? String(field.value).trim().toLowerCase() : '';
    return sha256Hex(value);
  }

  function done(ok) {
    if (ok) settled.ok++;
    else settled.failed++;
  }

  /** One attempt of `kind` ('beacon' | 'fetch' | 'img' | 'xhr'), or all four when omitted. */
  window.__fwSend = function (kind) {
    var hash = currentHash();
    var kinds = kind ? [kind] : ['beacon', 'fetch', 'img', 'xhr'];
    for (var i = 0; i < kinds.length; i++) {
      var k = kinds[i];
      attempts[k]++;
      if (k === 'beacon') navigator.sendBeacon(target(k, hash), 'h=' + hash);
      else if (k === 'fetch') fetch(target(k, hash), { mode: 'no-cors', cache: 'no-store' }).then(function () { done(true); }, function () { done(false); });
      else if (k === 'img') {
        var img = new Image();
        img.onload = function () { done(true); };
        img.onerror = function () { done(false); };
        img.src = target(k, hash);
      } else {
        var xhr = new XMLHttpRequest();
        xhr.onloadend = function () { done(xhr.status > 0); };
        xhr.open('GET', target(k, hash));
        xhr.send();
      }
    }
    return attempts;
  };

  // Like a pixel on blur: the first request leaves before any decision (it is never "stopped").
  var field = document.getElementById('email');
  if (field && params.get('onblur') !== '0') field.addEventListener('blur', function () { window.__fwSend('fetch'); });
  window.__fixtureResult = { ready: true, receiver: receiver };
})();
