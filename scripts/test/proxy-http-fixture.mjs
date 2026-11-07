// Owned loopback HTTP / HTTPS forward proxy for the browser natives (ADR-070, round 5). It serves absolute-URI requests and CONNECT
// tunnels, but only to the one owned origin on loopback: every other host or port is refused. The log keeps method, host, port and
// whether the login matched; never a header value or a credential. Nothing here talks to an external server.
import { createHash, X509Certificate } from 'node:crypto';
import { createServer as createHttpServer, request as httpRequest } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { connect as tcpConnect } from 'node:net';
import { spawnSync } from 'node:child_process';

// An ephemeral self-signed certificate for the HTTPS proxy, made by .NET like the headers native does it. Chromium trusts it by
// its SPKI hash (--ignore-certificate-errors-spki-list); Firefox needs the session capability acceptInsecureCerts.
export function ephemeralCertificate(commonName = '127.0.0.1') {
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', [
    "$ErrorActionPreference = 'Stop'", '$rsa = [System.Security.Cryptography.RSA]::Create(2048)',
    "$request = [System.Security.Cryptography.X509Certificates.CertificateRequest]::new('CN=" + commonName + "', $rsa, [System.Security.Cryptography.HashAlgorithmName]::SHA256, [System.Security.Cryptography.RSASignaturePadding]::Pkcs1)",
    '$certificate = $request.CreateSelfSigned([System.DateTimeOffset]::UtcNow.AddDays(-1), [System.DateTimeOffset]::UtcNow.AddDays(1))',
    "[Convert]::ToBase64String($certificate.Export([System.Security.Cryptography.X509Certificates.X509ContentType]::Pfx, ''))", '[Convert]::ToBase64String($certificate.RawData)',
    '$certificate.Dispose()', '$rsa.Dispose()',
  ].join(String.fromCharCode(10))], { encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw Error('owned ephemeral certificate: ' + result.stderr);
  const [pfxText, derText] = result.stdout.trim().split(/\s+/);
  const spki = createHash('sha256').update(new X509Certificate(Buffer.from(derText, 'base64')).publicKey.export({ type: 'spki', format: 'der' })).digest('base64');
  return { pfx: Buffer.from(pfxText, 'base64'), passphrase: '', spki };
}

// options: originPort (the only port reachable), allowedHosts (Set of names the tunnel/forward may name), tls ({ pfx, passphrase }
// for an HTTPS proxy), credentials ({ username, password } to require Basic Proxy-Authorization).
export async function startOwnedHttpProxy({ originPort, allowedHosts, tls = null, credentials = null }) {
  const log = [], sockets = new Set();
  const expected = credentials ? 'Basic ' + Buffer.from(credentials.username + ':' + credentials.password).toString('base64') : null;
  const authorized = headers => expected === null || headers['proxy-authorization'] === expected;
  const refuse = (response, status) => { response.writeHead(status, { 'Content-Length': '0', Connection: 'close', ...(status === 407 ? { 'Proxy-Authenticate': 'Basic realm="owned"' } : {}) }); response.end(); };
  const handler = (request, response) => {
    let target;
    try { target = new URL(request.url); } catch { return refuse(response, 400); }
    const port = Number(target.port || 80), entry = { method: request.method, host: target.hostname, port, authorized: authorized(request.headers) };
    log.push(entry);
    if (!entry.authorized) return refuse(response, 407);
    if (!allowedHosts.has(target.hostname) || port !== originPort) return refuse(response, 403);
    const upstream = httpRequest({ host: '127.0.0.1', port: originPort, method: request.method, path: target.pathname + target.search, headers: { host: target.host, connection: 'close' } }, reply => { response.writeHead(reply.statusCode, reply.headers); reply.pipe(response); });
    upstream.on('error', () => refuse(response, 502));
    request.pipe(upstream);
  };
  const server = tls ? createHttpsServer({ pfx: tls.pfx, passphrase: tls.passphrase }, handler) : createHttpServer(handler);
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); socket.on('error', () => {}); });
  server.on('secureConnection', socket => socket.on('error', () => {}));
  server.on('tlsClientError', () => {});
  server.on('connect', (request, socket, head) => {
    const separator = request.url.lastIndexOf(':'), host = request.url.slice(0, separator).replace(/^\[|\]$/g, ''), port = Number(request.url.slice(separator + 1));
    const entry = { method: 'CONNECT', host, port, authorized: authorized(request.headers) };
    log.push(entry);
    if (!entry.authorized) return void socket.end('HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="owned"\r\nContent-Length: 0\r\n\r\n');
    if (!allowedHosts.has(host) || port !== originPort) return void socket.end('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n');
    const upstream = tcpConnect(originPort, '127.0.0.1', () => { socket.write('HTTP/1.1 200 Connection Established\r\n\r\n'); if (head.length) upstream.write(head); upstream.pipe(socket); socket.pipe(upstream); });
    upstream.on('error', () => socket.destroy()); socket.on('error', () => upstream.destroy()); socket.on('close', () => upstream.destroy());
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  let stopped = false;
  return {
    port: server.address().port, log, secure: Boolean(tls),
    // Terminates the proxy for good: the listener closes and every open connection is destroyed.
    async stop() { if (stopped) return; stopped = true; for (const socket of sockets) socket.destroy(); await new Promise(done => server.close(done)); },
    count: method => log.filter(entry => entry.method === method).length,
    hits: (host, method = null) => log.filter(entry => entry.host === host && (method === null || entry.method === method)),
  };
}
