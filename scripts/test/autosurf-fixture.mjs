// ADR-075: all navigation/input validation uses this owned loopback fixture.
import { createServer } from 'node:http';

export async function createAutosurfFixture() {
  const requests = [], cookies = [];
  const server = createServer((request, response) => {
    request.resume();
    const path = new URL(request.url, 'http://fixture.test').pathname;
    requests.push(path); cookies.push({ path, cookie: request.headers.cookie ?? '' });
    if (path === '/cookie-set') response.setHeader('Set-Cookie', 'surf_header=1; Path=/');
    if (path === '/redirect') { response.writeHead(302, { Location: '/article' }); response.end(); return; }
    if (path === '/external-redirect') { response.writeHead(302, { Location: 'http://external-autosurf.example.com:' + server.address().port + '/other-site' }); response.end(); return; }
    if (path === '/blocked') response.statusCode = 403;
    if (path === '/rate') response.statusCode = 429;
    if (path === '/challenge') response.setHeader('cf-mitigated', 'challenge');
    if (path === '/loader.js') { response.setHeader('Content-Type', 'text/javascript'); response.end('/* passive fixture, no challenge */'); return; }
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');
    response.end(`<!doctype html><html><head><meta charset="utf-8"><title>Owned Autosurf fixture</title>
      <style>html{scroll-behavior:auto}body{margin:0;background:#fff;color:#111;font:18px sans-serif}main{max-width:900px;margin:auto}nav{position:sticky;top:0;display:flex;gap:24px;padding:30px;background:#eee;z-index:2}a{display:inline-block;padding:20px;color:#145}a:hover{background:#bfd}article{min-height:4000px;padding:24px}button{padding:14px}</style></head><body>
      <main><nav><a id="first-link" href="/article">Article</a><a id="second-link" href="/other">Other page</a></nav>
      <article><h1>Owned browsing measurement fixture</h1><p>Visible, selectable content.</p>
      <form action="/submitted"><input name="private" type="password" value="AUTOSURF_PASSWORD_CANARY"><button>Submit</button></form>
      <a href="/logout">Sign out</a><a href="/delete/item">Delete</a><a href="/query?token=AUTOSURF_QUERY_CANARY">Token URL</a><a href="/fragment#AUTOSURF_FRAGMENT_CANARY">Fragment URL</a><a href="/download.zip" download>Download</a><a href="/advert" rel="sponsored">Advertisement</a>
      <p style="margin-top:800px">Middle</p><p style="margin-top:1800px">End</p></article></main>
      ${path === '/passive' ? '<script src="/loader.js"></script><div class="cf-turnstile"></div><script type="text/plain" src="/cdn-cgi/challenge-platform/h/g/scripts/jsd/0123456789ab/main.js"></script>' : ''}
      <script>
      ${path === '/cookie-set' ? 'document.cookie="surf_js=1; path=/";' : ''}
      globalThis.__autosurfFixture = {moves:0,trustedMoves:0,wheels:0,trustedWheels:0,hovers:0,clicks:0,keys:0,submits:0,maxScroll:0};
      addEventListener('mousemove', e=>{__autosurfFixture.moves++;if(e.isTrusted)__autosurfFixture.trustedMoves++});
      addEventListener('wheel', e=>{__autosurfFixture.wheels++;if(e.isTrusted)__autosurfFixture.trustedWheels++},{passive:true});
      addEventListener('click', ()=>__autosurfFixture.clicks++);
      addEventListener('keydown', ()=>__autosurfFixture.keys++);
      addEventListener('submit', e=>{__autosurfFixture.submits++;e.preventDefault()});
      addEventListener('scroll', ()=>__autosurfFixture.maxScroll=Math.max(scrollY,__autosurfFixture.maxScroll),{passive:true});
      for(const link of document.querySelectorAll('nav a'))link.addEventListener('mouseenter',()=>__autosurfFixture.hovers++);
      </script></body></html>`);
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  // A port nobody listens on: the connection is refused at once, which is how an unreachable site looks to the browser.
  const closed = createServer(); await new Promise(done => closed.listen(0, '127.0.0.1', done)); const deadPort = closed.address().port; await new Promise(done => closed.close(done));
  return {
    url: 'http://autosurf.example.com:' + server.address().port,
    deadUrl: 'http://autosurf.example.com:' + deadPort,
    requests,
    cookies,
    close: () => new Promise(done => server.close(done)),
  };
}
