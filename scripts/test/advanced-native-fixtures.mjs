// ADR-030/031/032: owned loopback pages and synthetic values only; no vendor SDKs execute.
export const advancedBeaconFixtures = [
  { service: 'google-analytics', method: 'GET', url: 'https://www.google-analytics.com/g/collect?v=2&en=purchase&epn.value=49.99&cu=EUR&cid=BEACON_CLIENT_ID_CANARY&gcs=G111&gcd=BEACON_CONSENT_CANARY' },
  { service: 'meta', method: 'GET', url: 'https://www.facebook.com/tr/?ev=Purchase&cd%5Bvalue%5D=49.99&cd%5Bcurrency%5D=EUR&ud%5Bem%5D=' + 'e'.repeat(64) + '&fbp=BEACON_BROWSER_ID_CANARY' },
  { service: 'linkedin', method: 'GET', url: 'https://px.ads.linkedin.com/collect/?pid=BEACON_PARTNER_ID_CANARY&fmt=gif&conversionId=BEACON_CONVERSION_ID_CANARY' },
  { service: 'tiktok', method: 'GET', url: 'https://analytics.tiktok.com/api/v2/pixel?event=Purchase&value=49.99&email=BEACON_RAW_EMAIL_CANARY' },
  { service: 'yandex', method: 'GET', url: 'https://mc.yandex.ru/watch/123456?browser-info=BEACON_BROWSER_INFO_CANARY&ms=BEACON_PAYLOAD_CANARY' },
  { service: 'google-analytics', method: 'POST', url: 'https://region1.google-analytics.com/mp/collect?api_secret=BEACON_SECRET_CANARY', body: JSON.stringify({ client_id: 'BEACON_CLIENT_ID_CANARY', user_id: 'BEACON_USER_ID_CANARY', user_data: { sha256_email_address: 'e'.repeat(64) }, consent: { ad_user_data: 'DENIED', ad_personalization: 'GRANTED' }, events: [{ name: 'purchase', params: { value: 49.99, currency: 'EUR', session_id: 'BEACON_SESSION_ID_CANARY', order: 'BEACON_ORDER_CANARY' } }] }) }
];
export const advancedBeaconHosts = [...new Set(advancedBeaconFixtures.map(row => new URL(row.url).hostname))];
export const advancedCanaries = ['BEACON_CLIENT_ID_CANARY', 'BEACON_BROWSER_ID_CANARY', 'BEACON_USER_ID_CANARY', 'BEACON_SECRET_CANARY', 'BEACON_RAW_EMAIL_CANARY', 'BEACON_BROWSER_INFO_CANARY', 'BEACON_PAYLOAD_CANARY', 'BEACON_ORDER_CANARY', 'BEACON_SESSION_ID_CANARY', 'BEACON_CONVERSION_ID_CANARY', 'BEACON_PARTNER_ID_CANARY', 'BEACON_CONSENT_CANARY', 'eeeeeeeeeeeeeeee', 'STORAGE_KEY_CANARY', 'DATABASE_NAME_CANARY', 'OBJECT_STORE_CANARY', 'CACHE_NAME_CANARY', 'WORKER_PRIVATE_PATH_CANARY', 'SCRIPT_PRIVATE_PATH_CANARY', 'SYNC_TAG_CANARY', 'PERIODIC_TAG_CANARY', 'COOKIE_PROBE_IDENTIFIER_CANARY'];
export const advancedNativeMain = `(() => {
  const fixture = document.createElement('section'); fixture.id='advanced-native-fixture';
  fixture.innerHTML='<button id="advanced-beacons">Send owned beacons</button><button id="advanced-background">Register owned worker</button><button id="advanced-storage">Seed owned storage</button><button id="advanced-restore-on">Enable owned restoration</button><button id="advanced-restore-off">Disable owned restoration</button>';
  document.body.appendChild(fixture);
  const result = window.advancedFixture = {ready:true,beacons:false,background:false,storage:false,errors:[]};
  const cookieValue = () => document.cookie.split(';').map(row=>row.trim()).find(row=>row.startsWith('_ga='))?.slice(4);
  const withNativePromiseCheck = call => {
    const descriptor=Object.getOwnPropertyDescriptor(Promise.prototype,'then');let reads=0;
    Object.defineProperty(Promise.prototype,'then',{configurable:true,get(){reads++;return descriptor.value;}});
    try {const promise=call();return{promise,reads,nativePromise:promise instanceof Promise};}
    finally {Object.defineProperty(Promise.prototype,'then',descriptor);}
  };
  document.querySelector('#advanced-beacons').onclick = async () => {
    try {
      let methodReads=0,bodyReads=0;
      const native=withNativePromiseCheck(()=>fetch('/advanced/native-promise',{get method(){methodReads++;return'POST';},get body(){bodyReads++;return'SYNTHETIC_SEMANTICS_FIXTURE';}}));
      result.fetchSemantics={thenReads:native.reads,nativePromise:native.nativePromise,methodReads,bodyReads};await native.promise;
      const script=document.createElement('script');script.src='/advanced/SCRIPT_PRIVATE_PATH_CANARY/beacons/main.js';script.onerror=()=>result.errors.push('beacon-script');document.head.appendChild(script);
    }catch(error){result.errors.push('beacons:'+error.name);}
  };
  document.querySelector('#advanced-background').onclick = async () => {
    try {
      if(!navigator.serviceWorker){result.backgroundUnsupported=true;result.background=true;return;}
      let scopeReads=0;
      const native=withNativePromiseCheck(()=>navigator.serviceWorker.register('/advanced/WORKER_PRIVATE_PATH_CANARY/sw.js',{get scope(){scopeReads++;return'/advanced/';}}));
      result.workerSemantics={thenReads:native.reads,nativePromise:native.nativePromise,scopeReads};
      const registration=await native.promise;
      if(!registration.active)await new Promise((resolve,reject)=>{const worker=registration.installing||registration.waiting;if(!worker){reject(Error('worker'));return;}worker.addEventListener('statechange',()=>{if(worker.state==='activated')resolve();else if(worker.state==='redundant')reject(Error('worker'));});});
      await registration.pushManager?.getSubscription();
      if(registration.sync){try{await registration.sync.register('SYNC_TAG_CANARY');result.sync='registered';}catch(error){result.sync=error.name;}}
      else result.sync='unsupported';
      if(registration.periodicSync){try{await registration.periodicSync.register('PERIODIC_TAG_CANARY',{minInterval:3600000});result.periodic='registered';}catch(error){result.periodic=error.name;}}
      else result.periodic='unsupported';
      result.background=true;
    }catch(error){result.errors.push('background:'+error.name);}
  };
  document.querySelector('#advanced-storage').onclick = async () => {
    try {
      const value=cookieValue();if(!value)throw Error('cookie');localStorage.setItem('STORAGE_KEY_CANARY',value);
      const database=await new Promise((resolve,reject)=>{const request=indexedDB.open('DATABASE_NAME_CANARY',1);request.onupgradeneeded=()=>request.result.createObjectStore('OBJECT_STORE_CANARY');request.onerror=()=>reject(request.error);request.onsuccess=()=>resolve(request.result);});
      await new Promise((resolve,reject)=>{const transaction=database.transaction('OBJECT_STORE_CANARY','readwrite');transaction.objectStore('OBJECT_STORE_CANARY').put(value,'STORAGE_KEY_CANARY');transaction.oncomplete=resolve;transaction.onerror=()=>reject(transaction.error);});database.close();
      if(window.caches){const cache=await caches.open('CACHE_NAME_CANARY');await cache.put(location.origin+'/',new Response(value,{headers:{'Content-Type':'text/plain'}}));}
      result.storage=true;
    }catch(error){result.errors.push('storage:'+error.name);}
  };
  let restoreTimer=null;
  document.querySelector('#advanced-restore-on').onclick=()=>{const value=cookieValue();if(!value)throw Error('cookie');clearInterval(restoreTimer);restoreTimer=setInterval(()=>{if(!cookieValue())document.cookie='_ga='+value+'; Max-Age=3600; Path=/; SameSite=Lax';},50);result.restoration=true;};
  document.querySelector('#advanced-restore-off').onclick=()=>{clearInterval(restoreTimer);restoreTimer=null;result.restoration=false;};
})();`;
export function serveAdvancedNative(request, response) {
  const path = new URL(request.url, 'http://fixture.test').pathname;
  if (!path.startsWith('/advanced/')) return false;
  response.setHeader('Cache-Control', 'no-store');
  if (path.endsWith('/beacons/main.js')) {
    response.setHeader('Content-Type', 'application/javascript');
    response.end('const ownedBeaconJobs=[];for(const row of ' + JSON.stringify(advancedBeaconFixtures) + ')ownedBeaconJobs.push(fetch(row.url,row.method==="POST"?{method:"POST",headers:{"Content-Type":"application/json"},body:row.body}:{method:"GET"}));Promise.all(ownedBeaconJobs).then(()=>{window.advancedFixture.beacons=true;},error=>{window.advancedFixture.errors.push("beacons:"+error.name);});');
  }
  else if (path.endsWith('/main.js')) { response.setHeader('Content-Type', 'application/javascript'); response.end(advancedNativeMain); }
  else if (path.endsWith('/sw.js')) {
    response.setHeader('Content-Type', 'application/javascript'); response.setHeader('Service-Worker-Allowed', '/advanced/');
    response.end('self.addEventListener("install",event=>event.waitUntil(self.skipWaiting()));self.addEventListener("activate",event=>event.waitUntil(self.clients.claim()));self.addEventListener("sync",event=>event.waitUntil(Promise.resolve()));self.addEventListener("periodicsync",event=>event.waitUntil(Promise.resolve()));');
  } else if (path === '/advanced/native-promise') { response.writeHead(204); response.end(); }
  else {
    response.setHeader('Set-Cookie', ['_ga=COOKIE_PROBE_IDENTIFIER_CANARY_123; Max-Age=3600; Path=/; SameSite=Lax', 'PHPSESSID=COOKIE_AUTH_CANARY; HttpOnly; Path=/; SameSite=Lax']);
    response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end('<!doctype html><html><meta charset="utf-8"><title>Owned advanced fixture</title><body><h1>Owned advanced fixture</h1><script src="/advanced/SCRIPT_PRIVATE_PATH_CANARY/main.js"></script></body></html>');
  }
  return true;
}
export function serveAdvancedBeacon(request, response) {
  const url = new URL(request.url, 'https://' + request.headers.host);
  if (!advancedBeaconFixtures.some(row => new URL(row.url).hostname === url.hostname && new URL(row.url).pathname === url.pathname)) return false;
  response.writeHead(request.method === 'OPTIONS' ? 204 : 200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Cache-Control': 'no-store' });
  response.end(request.method === 'OPTIONS' ? '' : '{}'); return true;
}
