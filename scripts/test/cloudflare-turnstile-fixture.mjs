// Public dummy keys from Cloudflare's testing documentation, not production keys.
export const TURNSTILE_TEST_REFERENCE = 'https://developers.cloudflare.com/turnstile/troubleshooting/testing/';
export const TURNSTILE_CASES = Object.freeze([
  { id: 'visible-pass', key: '1x00000000000000000000AA', expected: 'success' },
  { id: 'visible-fail', key: '2x00000000000000000000AB', expected: 'error' },
  { id: 'invisible-pass', key: '1x00000000000000000000BB', expected: 'success' },
  { id: 'invisible-fail', key: '2x00000000000000000000BB', expected: 'error' },
]);
export function turnstileFixture(spec, { awaitPro = false } = {}) {
  return '<!doctype html><meta charset="utf-8"><title>Owned Turnstile dummy fixture</title><h1>Owned Turnstile dummy fixture</h1><div id="widget"></div><script>' +
    'window.fixture={sdkLoaded:false,rendered:false,success:false,error:false,timeout:false,expired:false,errorCodes:[],renderError:false,initialCpuCustom16:navigator.hardwareConcurrency===16,proReadyBeforeSdk:null,proMathAtRender:null,proReadyTimedOut:false};' +
    'window.fixtureFacts=(' + turnstileFixtureFacts.toString() + ');' +
    'window.onTurnstile=()=>{fixture.sdkLoaded=true;fixture.proMathAtRender=!Function.prototype.toString.call(Math.sin).includes("[native code]");try{turnstile.render("#widget",{sitekey:' + JSON.stringify(spec.key) +
    ',retry:"never",callback:()=>{fixture.success=true},"error-callback":code=>{fixture.error=true;if(typeof code==="string"&&/^\\d{6}$/.test(code)&&fixture.errorCodes.length<8)fixture.errorCodes.push(code);return true},"timeout-callback":()=>{fixture.timeout=true},"expired-callback":()=>{fixture.expired=true}});fixture.rendered=true}catch{fixture.renderError=true}};' +
    '</script>' + (awaitPro ? '<script>(()=>{const deadline=Date.now()+5000;function ready(){if(!Function.prototype.toString.call(Math.sin).includes("[native code]")){fixture.proReadyBeforeSdk=true;const sdk=document.createElement("script");sdk.src="https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onTurnstile&render=explicit";sdk.async=true;document.head.appendChild(sdk)}else if(Date.now()>=deadline){fixture.proReadyTimedOut=true}else{setTimeout(ready,50)}}ready()})()</script>' :
      '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onTurnstile&render=explicit" async defer></script>');
}
export function safeTurnstileResource(raw, ownedHost) {
  try { const url = new URL(raw); return { host: url.hostname === ownedHost ? 'owned-local-fixture' : url.hostname,
    path: url.hostname === ownedHost ? '/owned-fixture' : url.pathname === '/turnstile/v0/api.js' ? '/turnstile/v0/api.js' : url.pathname.startsWith('/cdn-cgi/challenge-platform/') ? '/cdn-cgi/challenge-platform/…' : '/other' }; }
  catch { return { host: 'non-http', path: '/' }; }
}
// Never access the success callback argument or the widget's hidden token input.
export function turnstileFixtureFacts() {
  return { ...window.fixture, webdriver: navigator.webdriver, frameCount: document.querySelectorAll('iframe').length,
    cpuCustom16: navigator.hardwareConcurrency === 16, userAgentEmpty: navigator.userAgent === '',
    userAgentWithheld: typeof navigator.userAgent === 'undefined',
    proMathWrapped: !Function.prototype.toString.call(Math.sin).includes('[native code]') };
}
