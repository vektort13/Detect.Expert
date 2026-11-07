// P04: these readbacks belong to the worker realm and must not appear in Window observations.
self.onmessage = async function (event) {
  const canvas = event.data;
  const ctx = canvas.getContext('2d');
  const hashes = [];
  for (let i = 0; i < 7; i++) {
    ctx.fillText('P04-worker-private-canary', 2, 16);
    const pixels = ctx.getImageData(0, 0, 96, 32);
    let hash = 2166136261;
    for (const byte of pixels.data) hash = Math.imul(hash ^ byte, 16777619);
    hashes.push(hash >>> 0);
    await canvas.convertToBlob();
  }
  self.postMessage({ readbacks: 7, hashes });
};
