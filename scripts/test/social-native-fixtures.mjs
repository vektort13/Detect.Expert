// ADR-028: only local stub responses are served for these native recognition fixtures.
// Expected classifications are explicit and independent of the production classifier.
export const socialNativeFixtures = [
  { url: 'https://accounts.google.com/gsi/client', service: 'google', kind: 'sdk-load', transport: 'script' },
  { url: 'https://s.pinimg.com/ct/core.js', service: 'pinterest', kind: 'tracking-sdk', transport: 'script' },
  { url: 'https://www.redditstatic.com/ads/pixel.js', service: 'reddit', kind: 'tracking-sdk', transport: 'script' },
  { url: 'https://a.quora.com/qevents.js', service: 'quora', kind: 'tracking-sdk', transport: 'script' },
  { url: 'https://d.line-scdn.net/n/line_tag/public/release/v1/lt.js', service: 'line', kind: 'tracking-sdk', transport: 'script' },
  { url: 'https://analytics.tiktok.com/i18n/pixel/events.js', service: 'tiktok', kind: 'tracking-sdk', transport: 'script' },
  { url: 'https://bat.bing.com/bat.js', service: 'microsoft', kind: 'tracking-sdk', transport: 'script' },
  { url: 'https://mc.yandex.ru/metrika/tag.js', service: 'yandex', kind: 'tracking-sdk', transport: 'script' },
  { url: 'https://www.threads.com/embed.js', service: 'threads', kind: 'sdk-load', transport: 'script' },
  { url: 'https://player.vimeo.com/api/player.js', service: 'vimeo', kind: 'sdk-load', transport: 'script' },
  { url: 'https://ct.pinterest.com/v3/', service: 'pinterest', kind: 'tracking-pixel', transport: 'image' },
  { url: 'https://alb.reddit.com/rp.gif', service: 'reddit', kind: 'tracking-pixel', transport: 'image' },
  { url: 'https://www.facebook.com/tr/', service: 'facebook', kind: 'tracking-pixel', transport: 'beacon' },
].map(fixture => ({ ...fixture, url: fixture.url + '?secret=SOCIAL_REQUEST_QUERY_CANARY' }));

export const socialNativeExpected = socialNativeFixtures.map(({ service, kind }) => service + ':' + kind).sort();
export const socialNativePixel = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
export const socialNativeStub = 'window.fixtureSocialLoadedCount=(window.fixtureSocialLoadedCount||0)+1;';
export const socialNativeMain = `window.fixtureSocialRemaining=${socialNativeFixtures.filter(fixture => fixture.transport !== 'beacon').length};
window.fixtureSocialNodes=[];const done=()=>{if(--window.fixtureSocialRemaining===0)window.fixtureSocialReady=true;};
for(const fixture of ${JSON.stringify(socialNativeFixtures)}){
  if(fixture.transport==='beacon'){window.fixtureSocialBeaconResult=navigator.sendBeacon(fixture.url,'SOCIAL_REQUEST_BODY_CANARY');continue;}
  const node=document.createElement(fixture.transport==='script'?'script':'img');node.onload=done;
  node.onerror=()=>{window.fixtureSocialError=true;};window.fixtureSocialNodes.push(node);
  if(fixture.transport==='script'){document.head.appendChild(node);node.setAttribute('src',fixture.url);}
  else node.setAttribute('src',fixture.url);
}`;
