// Owned native fixtures only. Pixel arrays stay in test RAM and never enter evidence.
export function canvasFixtureProbe(realm = globalThis) {
  realm.__canvasProgress = 'start';
  const W = 16, H = 8, result = {};
  const decodeSource = `onmessage=async event=>{const{id,blob,bitmap,colorSpace}=event.data;try{const image=bitmap||await createImageBitmap(blob);const canvas=new OffscreenCanvas(image.width,image.height),context=canvas.getContext('2d',{colorSpace:colorSpace||'srgb',willReadFrequently:true});context.drawImage(image,0,0);const data=context.getImageData(0,0,canvas.width,canvas.height);postMessage({id,data:[...data.data],color:data.colorSpace,width:canvas.width,height:canvas.height});image.close();}catch(error){postMessage({id,error:error.name+':'+error.message});}};`;
  // The bytes this engine returns for alpha 80, the fixture's translucent pixels: putImageData then getImageData of every value in an uncovered
  // Worker (software and default canvas). Translucent pixels may move to any of them and to no other byte.
  const reachSource = `onmessage=()=>{const out=[];for(const frequent of [true,false]){const canvas=new OffscreenCanvas(256,1),context=canvas.getContext('2d',{willReadFrequently:frequent}),data=new Uint8ClampedArray(1024);for(let v=0;v<256;v++)data.set([v,v,v,80],v*4);context.putImageData(new ImageData(data,256,1),0,0);const got=context.getImageData(0,0,256,1).data;for(let v=0;v<256;v++)out.push(got[v*4]);}postMessage(out);};`;
  const workerUrl = realm.URL.createObjectURL(new realm.Blob([decodeSource], { type: 'text/javascript' }));
  const worker = new realm.Worker(workerUrl), pending = new Map(); let serial = 0;
  worker.onmessage = event => { const row = pending.get(event.data.id); pending.delete(event.data.id); if (event.data.error) row.reject(new Error(event.data.error)); else row.resolve(event.data); };
  worker.onerror = event => { for (const row of pending.values()) row.reject(new Error('owned decoder worker: ' + event.message)); pending.clear(); };
  function decode(blob, bitmap, colorSpace = 'srgb') { return new Promise((resolve, reject) => { const id = ++serial; pending.set(id, { resolve, reject }); worker.postMessage({ id, blob, bitmap, colorSpace }, bitmap ? [bitmap] : []); setTimeout(() => { if (pending.delete(id)) reject(new Error('owned decoder timeout at ' + realm.__canvasProgress)); }, 10000); }); }
  function canvas(off = false, settings) {
    const surface = off ? new realm.OffscreenCanvas(W, H) : realm.document.createElement('canvas');
    if (!off) { surface.width = W; surface.height = H; }
    const context = surface.getContext('2d', settings), values = new realm.Uint8ClampedArray(W * H * 4);
    for (let index = 0; index < values.length; index += 4) { values[index] = index % 256; values[index + 1] = (255 - index) & 255; values[index + 2] = (index * 7 + 47) & 255; values[index + 3] = index % 12 === 4 ? 80 : index % 12 === 8 ? 0 : 255; }
    context.putImageData(new realm.ImageData(values, W, H, settings?.colorSpace ? { colorSpace: settings.colorSpace } : undefined), 0, 0);
    return { canvas: surface, context };
  }
  function urlBlob(url) { const mime = url.slice(5, url.indexOf(';')), bytes = realm.atob(url.slice(url.indexOf(',') + 1)); return new realm.Blob([realm.Uint8Array.from(bytes, char => char.charCodeAt(0))], { type: mime }); }
  const toBlob = value => new Promise(resolve => value.toBlob(resolve));
  const first = canvas();
  // All four synchronous reads execute in the first inline script, before await.
  result.read = [...first.context.getImageData(0, 0, W, H).data];
  result.borrowed = [...realm.Reflect.apply(realm.parent.CanvasRenderingContext2D.prototype.getImageData, first.context, [0, 0, W, H]).data];
  result.repeat = [...first.context.getImageData(0, 0, W, H).data];
  result.crop = [...first.context.getImageData(5, 3, -3, -2).data];
  result.urlValue = first.canvas.toDataURL();
  result.borrowedUrlValue = realm.Reflect.apply(realm.parent.HTMLCanvasElement.prototype.toDataURL, first.canvas, []);
  const encoded = toBlob(first.canvas), originalBitmap = realm.createImageBitmap(first.canvas);
  const off = typeof realm.OffscreenCanvas === 'function' ? canvas(true) : null;
  if (off) { result.offRead = [...off.context.getImageData(0, 0, W, H).data]; }
  const converted = off?.canvas.convertToBlob();
  result.sourceAfter = [...first.context.getImageData(0, 0, W, H).data];
  result.nativeFunctionString = realm.Function.prototype.toString.toString();
  result.noNativeHandles = !realm.Object.getOwnPropertySymbols(realm).some(symbol => String(symbol).includes('canvas') && typeof realm[symbol] === 'function');
  const getImage = first.context.getImageData;
  result.receiver = (() => { try { realm.Reflect.apply(getImage, {}, [0, 0, 1, 1]); return 'allowed'; } catch (error) { return error.name; } })();
  const marker = {};
  result.errorIdentity = (() => { try { first.context.getImageData({ valueOf() { throw marker; } }, 0, 1, 1); } catch (error) { return error === marker; } return false; })();
  let conversions = 0;
  result.objectCoordinate = (() => { try { first.context.getImageData({ valueOf() { conversions++; return 0; } }, 0, 1, 1); return 'allowed'; } catch (error) { return error.name; } })();
  result.coordinateConversions = conversions;
  result.boundaries = [Infinity, -Infinity, NaN, 2147483648, -2147483649, 4294967295, -4294967295, 1n, Symbol('x')].map(value => { try { first.context.getImageData(value, 0, 1, 1); return 'allowed'; } catch (error) { return error.name; } });
  let mimeConversions = 0;
  const mime = { [realm.Symbol.toPrimitive](hint) { if (hint !== 'string') throw new Error('MIME hint'); mimeConversions++; return 'IMAGE/PNG'; } };
  result.mimeResult = first.canvas.toDataURL(mime, { valueOf() { throw new Error('HTML quality coerced'); } }).startsWith('data:image/png;');
  result.mimeConversions = mimeConversions;
  const empty = realm.document.createElement('canvas'); empty.width = 0;
  result.empty = empty.toDataURL();
  result.zeroSize = (() => { try { first.context.getImageData(0, 0, 0, 1); return 'allowed'; } catch (error) { return error.name; } })();
  const snapshot = canvas(), snapshotExpected = [...snapshot.context.getImageData(0, 0, W, H).data]; let callbackCount = 0;
  const snapshotBlob = new Promise(resolve => snapshot.canvas.toBlob(blob => { callbackCount++; resolve(blob); }));
  snapshot.context.clearRect(0, 0, W, H);
  let offSnapshot, offExpected;
  if (off) { const source = canvas(true); offExpected = [...source.context.getImageData(0, 0, W, H).data]; offSnapshot = source.canvas.convertToBlob(); source.context.clearRect(0, 0, W, H); }
  return (async () => {
    try {
      realm.__canvasProgress = 'reachable bytes';
      result.reach80 = await new Promise(resolve => { const reach = new realm.Worker(realm.URL.createObjectURL(new realm.Blob([reachSource], { type: 'text/javascript' }))); reach.onmessage = event => { reach.terminate(); resolve([...new Set(event.data)]); }; reach.postMessage(0); });
      realm.__canvasProgress = 'decode native';
      result.nativePixels = (await decode(null, await originalBitmap)).data;
      realm.__canvasProgress = 'decode URL';
      result.url = (await decode(urlBlob(result.urlValue))).data; delete result.urlValue;
      result.borrowedUrl = (await decode(urlBlob(result.borrowedUrlValue))).data; delete result.borrowedUrlValue;
      result.blob = (await decode(await encoded)).data;
      realm.__canvasProgress = 'decode Offscreen';
      result.offBlob = converted ? (await decode(await converted)).data : null;
      result.snapshot = (await decode(await snapshotBlob)).data; result.snapshotExpected = snapshotExpected; result.callbackCount = callbackCount;
      realm.__canvasProgress = 'snapshot';
      if (offSnapshot) { result.offSnapshot = (await decode(await offSnapshot)).data; result.offExpected = offExpected; }
      if (off) {
        const order = [], options = { get quality() { if (this !== options) throw new Error('dictionary receiver'); order.push('quality'); return '0.4'; }, get type() { order.push('type'); return 'image/png'; } };
        await off.canvas.convertToBlob(options); result.optionsOrder = order;
        let qualityConversions = 0;
        result.objectQuality = await off.canvas.convertToBlob({ quality: { valueOf() { qualityConversions++; return .4; } } }).then(() => 'allowed', error => error.name);
        result.qualityConversions = qualityConversions;
      }
      // Native taint is obtained from a deliberately non-CORS owned image origin.
      if (realm.location.protocol === 'http:') {
        const image = new realm.Image(); image.src = 'http://127.0.0.1:' + realm.document.documentElement.dataset.imagePort + '/pixel.png';
        await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; });
        const taint = canvas(); taint.context.drawImage(image, 0, 0);
        result.taint = [() => taint.context.getImageData(0, 0, 1, 1), () => taint.canvas.toDataURL(), () => taint.canvas.toBlob(() => {})].map(invoke => { try { invoke(); return 'allowed'; } catch (error) { return error.name; } });
      }
      const p3 = canvas(false, { colorSpace: 'display-p3' });
      realm.__canvasProgress = 'P3';
      if (p3.context.getContextAttributes?.().colorSpace === 'display-p3') {
        const image = p3.context.getImageData(0, 0, W, H); result.p3 = { read: [...image.data], color: image.colorSpace, url: (await decode(urlBlob(p3.canvas.toDataURL()), null, 'display-p3')).data };
      }
      const float = canvas(false, { colorType: 'float16' });
      if (float.context.getContextAttributes?.().colorType === 'float16') {
        result.float16 = [() => float.context.getImageData(0, 0, 1, 1), () => float.canvas.toDataURL()].map(invoke => { try { invoke(); return 'allowed'; } catch (error) { return error.name; } });
        result.float16Blob = await toBlob(float.canvas) === null;
      }
      result.webgl = [];
      realm.__canvasProgress = 'GL';
      for (const type of ['webgl', 'webgl2']) for (const preserveDrawingBuffer of [false, true]) {
        const surface = realm.document.createElement('canvas'); surface.width = W; surface.height = H;
        const gl = surface.getContext(type, { preserveDrawingBuffer }); if (!gl) continue;
        // Change native colorSpace after getContext to exercise metadata refresh.
        for (const requestedColor of ['srgb', 'display-p3']) {
          if (requestedColor === 'display-p3') { if (!('drawingBufferColorSpace' in gl)) continue; try { gl.drawingBufferColorSpace = requestedColor; } catch { continue; } if (gl.drawingBufferColorSpace !== requestedColor) continue; }
          const reference = realm.document.createElement('canvas'); reference.width = W; reference.height = H;
          const referenceContext = reference.getContext('2d', { colorSpace: requestedColor });
          const copyColorSupported = requestedColor === 'srgb' || referenceContext.getContextAttributes?.().colorSpace === requestedColor;
          gl.clearColor(.2, .4, .6, 1); gl.clear(gl.COLOR_BUFFER_BIT);
          const nativeBitmap = realm.createImageBitmap(surface); let encodedUrl;
          try { encodedUrl = surface.toDataURL(); }
          catch (error) { (await nativeBitmap).close(); result.webgl.push({ type, color: requestedColor, preserveDrawingBuffer, copyColorSupported, outcome: error.name }); continue; }
          const native = await decode(null, await nativeBitmap, requestedColor);
          referenceContext.putImageData(new realm.ImageData(new realm.Uint8ClampedArray(native.data), W, H, { colorSpace: requestedColor }), 0, 0);
          const expected = [...referenceContext.getImageData(0, 0, W, H).data];
          const encoded = await decode(urlBlob(encodedUrl), null, requestedColor);
          result.webgl.push({ type, color: requestedColor, preserveDrawingBuffer, copyColorSupported, outcome: 'allowed', expected, encoded: encoded.data });
        }
        gl.getExtension('WEBGL_lose_context')?.loseContext();
      }
      realm.__canvasProgress = 'done'; return result;
    } finally { worker.terminate(); realm.URL.revokeObjectURL(workerUrl); }
  })();
}

function script(source) { return '<script>' + source.replaceAll('</script', '<\\/script') + '</script>'; }
export async function canvasFixtureBenchmark() {
  const rows = [];
  for (const size of [256, 1024]) {
    const canvas = document.createElement('canvas'); canvas.width = size; canvas.height = size;
    const context = canvas.getContext('2d', { willReadFrequently: true }); context.fillStyle = 'rgb(83,129,207)'; context.fillRect(0, 0, size, size);
    const read = [];
    for (let index = 0; index < 3; index++) { const before = performance.now(); context.getImageData(0, 0, size, size); read.push(performance.now() - before); }
    let before = performance.now(); canvas.toDataURL(); const url = performance.now() - before;
    before = performance.now(); await new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve() : reject(new Error('benchmark encoder returned null')))); const blob = performance.now() - before;
    rows.push({ size, pixels: size * size, getImageDataMs: read, medianGetImageDataMs: [...read].sort((a, b) => a - b)[1], toDataURLMs: url, toBlobMs: blob });
  }
  return rows;
}
export function canvasBenchmarkHtml() { return '<!doctype html><html><head>' + script('globalThis.__canvasBenchmark=' + canvasFixtureBenchmark.toString() + ';') + '</head><body>Owned Canvas benchmark</body></html>'; }
export function canvasBorrowedMatrix() {
  const frames = [document.createElement('iframe'), document.createElement('iframe')]; for (const frame of frames) document.body.append(frame);
  const realms = [window, ...frames.map(frame => frame.contentWindow)], sources = [];
  for (const realm of realms) {
    const canvas = realm.document.createElement('canvas'); canvas.width = 8; canvas.height = 4;
    const context = realm.Reflect.apply(window.HTMLCanvasElement.prototype.getContext, canvas, ['2d']); context.fillStyle = 'rgb(83,129,207)'; context.fillRect(0, 0, 8, 4);
    sources.push({ canvas, context });
  }
  const reads = [], urls = [];
  for (const source of sources) for (const realm of realms) {
    reads.push([...Reflect.apply(realm.CanvasRenderingContext2D.prototype.getImageData, source.context, [0, 0, 8, 4]).data]);
    urls.push(Reflect.apply(realm.HTMLCanvasElement.prototype.toDataURL, source.canvas, []));
  }
  for (const frame of frames) frame.remove(); return { reads, urls };
}
export function canvasFixtureHtml(imagePort, child = false) {
  const source = '(' + canvasFixtureProbe.toString() + ')()';
  if (child) return '<!doctype html><html data-image-port="' + imagePort + '"><head>' + script('try{' + source + `.then(result=>parent.postMessage({channel:'owned-canvas',srcdoc:result},'*'),error=>parent.postMessage({channel:'owned-canvas',error:error.stack},'*'));}catch(error){parent.postMessage({channel:'owned-canvas',error:'srcdoc synchronous: '+error.stack},'*');}`) + '</head><body>Owned Canvas frame</body></html>';
  const opaque = '<!doctype html>' + script(`try{Object.defineProperty(globalThis,Symbol.for('detect.expert/api-custom/document/v2'),{value:true});}catch{}const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');const operations=[()=>ctx.getImageData(0,0,1,1),()=>canvas.toDataURL(),()=>canvas.toBlob(()=>{})];if(typeof OffscreenCanvas==='function'){const off=new OffscreenCanvas(1,1);operations.push(()=>off.getContext('2d').getImageData(0,0,1,1),()=>off.convertToBlob());}const values=operations.map(invoke=>{try{const r=invoke();if(r?.catch)r.catch(()=>{});return 'allowed';}catch(error){return error.name;}});parent.postMessage({channel:'owned-canvas',opaque:values},'*');`);
  return '<!doctype html><html data-image-port="' + imagePort + '"><head>' + script(`
    try{Object.defineProperty(globalThis,Symbol.for('detect.expert/api-custom/document/v2'),{value:true});}catch{}
    const capture=${canvasFixtureProbe.toString()};
    globalThis.__canvasBenchmark=${canvasFixtureBenchmark.toString()};
    globalThis.__canvasResult={};
    const mainReady=capture().then(result=>{__canvasResult.main=result;return result;},error=>{__canvasResult.error=error.stack;return null;});
    addEventListener('message',event=>{if(event.data?.channel==='owned-canvas'){if(event.data.srcdoc)__canvasResult.srcdoc=event.data.srcdoc;if(event.data.opaque)__canvasResult.opaque=event.data.opaque;if(event.data.error)__canvasResult.error=event.data.error;}});
    addEventListener('DOMContentLoaded',async()=>{
      if(!await mainReady)return;
      try{__canvasResult.borrowedMatrix=(${canvasBorrowedMatrix.toString()})();}catch(error){__canvasResult.error=error.stack;return;}
      const blank=document.createElement('iframe');document.body.append(blank);try{__canvasResult.blank=await capture(blank.contentWindow);}catch(error){__canvasResult.error=error.stack;return;}
      const child=document.createElement('iframe');child.srcdoc=${JSON.stringify(canvasFixtureHtml(imagePort, true))};document.body.append(child);
      const opaque=document.createElement('iframe');opaque.sandbox='allow-scripts';opaque.srcdoc=${JSON.stringify(opaque)};document.body.append(opaque);
    },{once:true});
  `) + '</head><body>Owned Canvas fixture</body></html>';
}

// Flat 2560x1440 export (ADR-104 addendum 3): the layout where stable-rgb-v1 turned a 76 KB PNG into 4.6 MB. Reports the byte size of every
// export path and checks, in a Worker the installer does not cover, that what the exports decode to equals what the page reads back.
// Pixel arrays stay in the page; only counters and SHA-256 digests leave it.
export async function canvasFlatProbe() {
  const W = 2560, H = 1440, result = { width: W, height: H };
  const hex = buffer => [...new Uint8Array(buffer)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  const digest = async bytes => hex(await crypto.subtle.digest('SHA-256', bytes));
  const stats = data => {
    let changed = 0, multi = 0, big = 0, alpha = 0;
    for (let index = 0; index < data.length; index += 4) {
      const dr = data[index] - 83, dg = data[index + 1] - 129, db = data[index + 2] - 207, moved = (dr !== 0) + (dg !== 0) + (db !== 0);
      if (data[index + 3] !== 255) alpha++;
      if (moved) { changed++; if (moved > 1) multi++; if (Math.abs(dr) > 1 || Math.abs(dg) > 1 || Math.abs(db) > 1) big++; }
    }
    return { changed, multi, big, alpha };
  };
  const workerMain = () => {
    onmessage = async event => {
      const { id, blob } = event.data;
      try {
        const bitmap = await createImageBitmap(blob), canvas = new OffscreenCanvas(bitmap.width, bitmap.height), context = canvas.getContext('2d', { willReadFrequently: true });
        context.drawImage(bitmap, 0, 0); const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
        let changed = 0, multi = 0, big = 0, alpha = 0;
        for (let index = 0; index < data.length; index += 4) {
          const dr = data[index] - 83, dg = data[index + 1] - 129, db = data[index + 2] - 207, moved = (dr !== 0) + (dg !== 0) + (db !== 0);
          if (data[index + 3] !== 255) alpha++;
          if (moved) { changed++; if (moved > 1) multi++; if (Math.abs(dr) > 1 || Math.abs(dg) > 1 || Math.abs(db) > 1) big++; }
        }
        const sum = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
        postMessage({ id, width: canvas.width, height: canvas.height, changed, multi, big, alpha, hash: [...sum].map(byte => byte.toString(16).padStart(2, '0')).join('') });
      } catch (error) { postMessage({ id, error: error.name + ':' + error.message }); }
    };
  };
  const workerUrl = URL.createObjectURL(new Blob(['(' + workerMain.toString() + ')()'], { type: 'text/javascript' })), worker = new Worker(workerUrl), pending = new Map();
  let serial = 0;
  worker.onmessage = event => { const row = pending.get(event.data.id); pending.delete(event.data.id); if (event.data.error) row.reject(new Error(event.data.error)); else row.resolve(event.data); };
  const decode = blob => new Promise((resolve, reject) => { const id = ++serial; pending.set(id, { resolve, reject }); worker.postMessage({ id, blob }); setTimeout(() => { if (pending.delete(id)) reject(new Error('flat decoder timeout')); }, 120000); });
  try {
    const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
    const context = canvas.getContext('2d', { willReadFrequently: true }); context.fillStyle = 'rgb(83,129,207)'; context.fillRect(0, 0, W, H);
    const time = {}, stamp = label => { const now = performance.now(); if (label) time[label] = +(now - stamp.last).toFixed(1); stamp.last = now; };
    stamp(); const read = context.getImageData(0, 0, W, H); stamp('getImageData');
    result.read = { ...stats(read.data), hash: await digest(read.data) };
    stamp(); const url = canvas.toDataURL(); stamp('toDataURL');
    const bytes = atob(url.slice(url.indexOf(',') + 1)), urlBlob = new Blob([Uint8Array.from(bytes, char => char.charCodeAt(0))], { type: 'image/png' });
    stamp(); const blob = await new Promise(resolve => canvas.toBlob(resolve)); stamp('toBlob');
    result.urlBytes = urlBlob.size; result.blobBytes = blob.size;
    if (typeof OffscreenCanvas === 'function') {
      const off = new OffscreenCanvas(W, H), offContext = off.getContext('2d'); offContext.fillStyle = 'rgb(83,129,207)'; offContext.fillRect(0, 0, W, H);
      stamp(); const offBlob = await off.convertToBlob(); stamp('convertToBlob'); result.offBytes = offBlob.size;
      result.off = await decode(offBlob);
    }
    result.url = await decode(urlBlob); result.blob = await decode(blob); result.time = time;
    result.afterHash = await digest(context.getImageData(0, 0, W, H).data);
    // The same canvas read in pieces equals the whole read (rectangles are independent of one another).
    let seed = 0x1234567, mismatches = 0, rects = 0;
    const next = () => (seed = (Math.imul(seed, 1664525) + 1013904223) | 0) >>> 0;
    for (let index = 0; index < 24; index++) {
      const w = 1 + next() % 90, h = 1 + next() % 60, x = next() % (W - w + 1), y = next() % (H - h + 1), part = context.getImageData(x, y, w, h).data;
      rects++;
      for (let row = 0; row < h && mismatches === 0; row++) for (let column = 0; column < w * 4; column++) if (part[row * w * 4 + column] !== read.data[((y + row) * W + x) * 4 + column]) { mismatches++; break; }
    }
    result.rects = { count: rects, mismatches };
    return result;
  } finally { worker.terminate(); URL.revokeObjectURL(workerUrl); }
}
export function canvasFlatHtml() { return '<!doctype html><html><head>' + script('globalThis.__canvasFlat=' + canvasFlatProbe.toString() + ';') + '</head><body>Owned Canvas flat export fixture</body></html>'; }
