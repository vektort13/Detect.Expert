// ADR-110: owned pages for the HTML/CSS font shield natives. Classic font enumeration, written for this project: the width-difference
// method (DOM, SVG text, Canvas and OffscreenCanvas measureText over three base families and three styles), FontFace local() loads,
// document.fonts facts and queryLocalFonts status, run in the first inline script of the top page, of a script-written about:blank
// frame, of a srcdoc frame, of a cross-origin frame and inside a shadow root. Nothing here reaches the network.
export const FIXTURE_TEXT = 'mmmmmmmmmmlli';

// Runs inside a document (any realm). Returns plain JSON data: one array of 9 widths (3 styles x 3 base families) per family name and
// method, plus the widths of the bare base families (key "").
export function measureContext(doc, win, names, options) {
  const TEXT = 'mmmmmmmmmmlli', BASES = ['monospace', 'sans-serif', 'serif'], STYLES = [['400', 'normal'], ['700', 'normal'], ['400', 'italic']];
  const host = doc.body || doc.documentElement;
  let root = null;
  if (options.shadow) { const holder = doc.createElement('div'); host.appendChild(holder); root = holder.attachShadow({ mode: 'open' }); }
  const mount = root || host;
  const span = doc.createElement('span');
  span.textContent = TEXT;
  span.style.cssText = 'position:absolute;left:-9999px;top:-9999px;font-size:72px;white-space:nowrap;visibility:hidden;letter-spacing:normal';
  mount.appendChild(span);
  const canvas = doc.createElement('canvas'), context = canvas.getContext('2d');
  const svgNs = 'http://www.w3.org/2000/svg', svg = doc.createElementNS(svgNs, 'svg'), text = doc.createElementNS(svgNs, 'text');
  text.textContent = TEXT; text.setAttribute('font-size', '72'); svg.appendChild(text); mount.appendChild(svg);
  let offscreen = null;
  try { offscreen = new win.OffscreenCanvas(8, 8).getContext('2d'); } catch { offscreen = null; }
  const out = { dom: {}, canvas: {}, svg: {}, offscreen: {}, offscreenAvailable: offscreen !== null };
  function read(name) {
    const dom = [], cv = [], sv = [], off = [];
    for (const [weight, style] of STYLES) for (const base of BASES) {
      const family = name === '' ? base : '"' + name + '", ' + base;
      span.style.fontFamily = family; span.style.fontWeight = weight; span.style.fontStyle = style;
      dom.push(span.getBoundingClientRect().width);
      context.font = style + ' ' + weight + ' 72px ' + family;
      cv.push(context.measureText(TEXT).width);
      text.setAttribute('font-family', family); text.setAttribute('font-weight', weight); text.setAttribute('font-style', style);
      sv.push(text.getComputedTextLength());
      if (offscreen) { offscreen.font = style + ' ' + weight + ' 72px ' + family; off.push(offscreen.measureText(TEXT).width); }
    }
    out.dom[name] = dom; out.canvas[name] = cv; out.svg[name] = sv; out.offscreen[name] = off;
  }
  read('');
  for (const name of names) read(name);
  span.remove(); svg.remove(); if (root) root.host.remove();
  return out;
}

// What a page can read about its font set without measuring: document.fonts, adopted sheets, check() and the queryLocalFonts status.
export function describeContext(doc, win, names) {
  const faces = [];
  try { let count = 0; doc.fonts.forEach(face => { if (count++ < 3) faces.push(face.family + '|' + face.status + '|' + face.unicodeRange + '|' + face.stretch); }); } catch { /* unreadable */ }
  // Every family of document.fonts (ADR-110 addendum 2: the page can tell which regional families carry a shield face), unquoted, once each.
  const families = [];
  try { const seen = new Set(); doc.fonts.forEach(face => seen.add(String(face.family).replace(/^["']|["']$/g, ''))); families.push(...seen); } catch { /* unreadable */ }
  const check = {};
  for (const name of names) { try { check[name] = doc.fonts.check('72px "' + name + '"'); } catch (error) { check[name] = 'threw:' + error.name; } }
  return {
    fontsSize: doc.fonts.size, fontsStatus: doc.fonts.status, faces, families, check,
    styleSheets: doc.styleSheets.length, adoptedStyleSheets: doc.adoptedStyleSheets.length,
    queryLocalFonts: typeof win.queryLocalFonts,
  };
}

// FontFace local() loads for every name: "resolved" when the platform has the font, "rejected:<name>" when it has not.
export async function localFontLoads(win, names) {
  const out = {};
  const settle = async name => {
    try { const face = new win.FontFace('probe-' + name.length, 'local("' + name + '")'); await face.load(); out[name] = 'resolved'; }
    catch (error) { out[name] = 'rejected:' + error.name; }
  };
  for (let at = 0; at < names.length; at += 50) await Promise.all(names.slice(at, at + 50).map(settle));
  return out;
}

// queryLocalFonts without a user gesture: the status is recorded and never changed by the extension.
export async function localFontAccess(win) {
  if (typeof win.queryLocalFonts !== 'function') return 'absent';
  try { const rows = await win.queryLocalFonts(); return 'resolved:' + (Array.isArray(rows) ? rows.length : 'non-array'); } catch (error) { return 'rejected:' + error.name; }
}

const json = value => JSON.stringify(value).replace(/</gu, '\\u003c');
const functions = [measureContext, describeContext, localFontLoads, localFontAccess].map(fn => fn.toString()).join('\n');

// A frame page: measures in its own first inline script and reports to its opener/parent.
export function framePageHtml(names, label = 'cross') {
  return '<!doctype html><html><head><meta charset="utf-8"><title>font-shield frame</title></head><body><script>' + functions + '\n' +
    // A throttled frame (out of process, not yet painted) answers every layout query with zero: it is measured again until it has layout (the same
    // for the plain browser and the extension; the first attempt is the first inline script).
    '(function(){const names=' + json(names) + ';let report=measureContext(document,window,names,{});let attempts=1;const facts=describeContext(document,window,names.slice(0,8));' +
    'const send=function(){try{parent.postMessage({fontShield:1,label:' + json(label) + ',vectors:report,facts:facts,attempts:attempts},"*");}catch(e){}};' +
    'const laid=function(){return report.dom[""][0]>0;};' +
    'if(laid()){send();}else{const retry=function(){report=measureContext(document,window,names,{});attempts++;if(laid()||attempts>60){send();}else{setTimeout(retry,50);}};setTimeout(retry,50);}})();</' + 'script></body></html>';
}

// The top page. Options: crossPort (a second owned server), ordinary (a hidden name used for the ordinary-stack checks).
export function topPageHtml(names, { crossPort, ordinary = 'Century Gothic', localNames = names } = {}) {
  const srcdoc = framePageHtml(names, 'srcdoc'), sandboxed = framePageHtml(names, 'sandbox');
  return '<!doctype html><html><head><meta charset="utf-8"><title>font-shield</title>' +
    '<script>window.__violations=[];document.addEventListener("securitypolicyviolation",function(e){window.__violations.push(e.violatedDirective+" "+e.blockedURI);});</' + 'script></head><body>' +
    '<script>' + functions + '\n' +
    '(function(){' +
    'const names=' + json(names) + ',localNames=' + json(localNames) + ',ordinaryName=' + json(ordinary) + ';' +
    'const result=window.__fontShield={done:false,contexts:{},errors:[],fontEvents:{loading:0,loadingdone:0,loadingerror:0}};' +
    'for(const kind of ["loading","loadingdone","loadingerror"])document.fonts.addEventListener(kind,function(){result.fontEvents[kind]++;});' +
    // 1. the top document, in the first inline script
    'try{result.contexts.top={vectors:measureContext(document,window,names,{}),facts:describeContext(document,window,names.slice(0,8))};}catch(e){result.errors.push("top:"+e.message);}' +
    // ordinary stacks (a hidden family first, then Arial or a generic)
    'try{const s=document.createElement("span");s.textContent="mmmmmmmmmmlli";s.style.cssText="position:absolute;left:-9999px;font-size:48px;white-space:nowrap";document.body.appendChild(s);' +
    'const w=f=>{s.style.fontFamily=f;return s.getBoundingClientRect().width;};' +
    'result.ordinary={name:ordinaryName,hiddenThenArial:w("\\""+ordinaryName+"\\", Arial, sans-serif"),arial:w("Arial, sans-serif"),hiddenThenGeneric:w("\\""+ordinaryName+"\\", sans-serif"),generic:w("sans-serif"),hiddenOnly:w("\\""+ordinaryName+"\\""),defaultFont:w("serif"),' +
    'computed:(s.style.fontFamily="\\""+ordinaryName+"\\", Arial, sans-serif",getComputedStyle(s).fontFamily),fontsStatus:document.fonts.status};s.remove();}catch(e){result.errors.push("ordinary:"+e.message);}' +
    // 2. a script-written about:blank frame
    'try{const f=document.createElement("iframe");document.body.appendChild(f);const d=f.contentDocument;d.open();d.write("<!doctype html><html><body></body></html>");d.close();' +
    'result.contexts.blank={vectors:measureContext(d,f.contentWindow,names,{}),facts:describeContext(d,f.contentWindow,names.slice(0,8))};}catch(e){result.errors.push("blank:"+e.message);}' +
    // 3. a shadow root of the top document
    'try{result.contexts.shadow={vectors:measureContext(document,window,names,{shadow:true})};}catch(e){result.errors.push("shadow:"+e.message);}' +
    // 4. a srcdoc frame (measures in its own first inline script) and 5. a cross-origin frame
    'addEventListener("message",function(e){if(e.data&&e.data.fontShield){result.contexts[e.data.label]={vectors:e.data.vectors,facts:e.data.facts,attempts:e.data.attempts};}});' +
    'try{const s=document.createElement("iframe");s.srcdoc=' + json(srcdoc) + ';document.body.appendChild(s);}catch(e){result.errors.push("srcdoc:"+e.message);}' +
    'try{const b=document.createElement("iframe");b.setAttribute("sandbox","allow-scripts");b.srcdoc=' + json(sandboxed) + ';document.body.appendChild(b);}catch(e){result.errors.push("sandbox:"+e.message);}' +
    (crossPort ? 'try{const c=document.createElement("iframe");c.src="http://localhost:' + crossPort + '/frame";document.body.appendChild(c);}catch(e){result.errors.push("cross:"+e.message);}' : '') +
    // 6. FontFace local() loads and queryLocalFonts, then done once every frame has reported
    '(async function(){try{result.localLoads=await localFontLoads(window,localNames);result.localFontAccess=await localFontAccess(window);}catch(e){result.errors.push("local:"+e.message);}' +
    'const wanted=' + (crossPort ? '["srcdoc","cross","sandbox"]' : '["srcdoc","sandbox"]') + ';for(let i=0;i<300&&!wanted.every(function(k){return result.contexts[k];});i++)await new Promise(function(r){setTimeout(r,50);});' +
    'try{await document.fonts.ready;}catch(e){result.errors.push("ready:"+e.name);}await new Promise(function(r){setTimeout(r,100);});result.fontsSettled=document.fonts.status;' +
    'result.violations=window.__violations.slice();result.done=true;})();' +
    '})();</' + 'script></body></html>';
}

// A page that defines a web font under a probed family name (weight 700 only) in an external style sheet (so that a strict page CSP allows it) and
// reports which requests use it. The probe element is styled through CSSOM only: an inline style attribute would be blocked by that CSP.
export const webFontCss = (name = 'Century Gothic') => '@font-face{font-family:' + json(name) + ';src:url(/webfont.ttf);font-weight:700}';
export function webFontPageHtml(name = 'Century Gothic') {
  return '<!doctype html><html><head><meta charset="utf-8"><title>font-shield web font</title><link rel="stylesheet" href="/webfont.css"></head><body>' +
    '<span id="s">mmmmmmmmmmlli</span><script>' +
    '(async function(){const result=window.__fontShield={done:false};const s=document.getElementById("s");const name=' + json(name) + ';' +
    's.style.cssText="position:absolute;left:-9999px;font-size:72px;white-space:nowrap";' +
    'try{await document.fonts.load("700 72px \\""+name+"\\"");}catch(e){result.loadError=e.name;}' +
    'const w=(weight,style)=>{s.style.fontFamily="\\""+name+"\\", monospace";s.style.fontWeight=weight;s.style.fontStyle=style;return s.getBoundingClientRect().width;};' +
    'result.widths={w700:w("700","normal"),w400:w("400","normal"),w300:w("300","normal"),w900:w("900","normal"),italic700:w("700","italic"),italic400:w("400","italic")};' +
    's.style.fontFamily="monospace";s.style.fontWeight="400";s.style.fontStyle="normal";result.monospace=s.getBoundingClientRect().width;' +
    'result.faceStatuses=[];document.fonts.forEach(function(f){if(f.family.replace(/"/g,"")===name)result.faceStatuses.push(f.status+"|"+f.unicodeRange);});result.done=true;})();</' + 'script></body></html>';
}
