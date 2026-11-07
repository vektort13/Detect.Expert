// Explicit user-provider diagnostic. Profile and credentials are read locally;
// only bounded capability flags/counts are emitted. Raw engine logs are dropped.
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import net from 'node:net';
import tls from 'node:tls';
import { resolve } from 'node:path';

const [credentialsPath, profilePath] = process.argv.slice(2);
if (!credentialsPath || !profilePath) throw new Error('Provide local credentials JSON and original profile paths');
const credentials = JSON.parse(await readFile(credentialsPath, 'utf8'));
const profile = await readFile(profilePath, 'utf8');
const listener = net.createServer();
await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
const port = listener.address().port;
await new Promise(resolve => listener.close(resolve));
const executable = resolve(process.argv[4] || 'release/proxy-native/windows-amd64/engines/openvpn2socks.exe');
const child = spawn(executable, ['-config', '-', '-listen', `127.0.0.1:${port}`, '-timeout', '30s', '-allow-no-server-identity', '-v'], {
  windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'],
  env: Object.fromEntries([...['SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE'].filter(key => process.env[key]).map(key => [key, process.env[key]]), ['OVPN_USER', credentials.username], ['OVPN_PASS', credentials.password]]),
});
child.stdin.end(profile);
const output = { tlsSessionUp: false, socksReady: false, ekmAnnounced: null, cipher: null, pushedDNSCount: null, incomingDataDecryptErrors: 0, incomingKeepalive: 0, tcpSynPackets: 0, tests: [] };
let logRemainder = '';
child.stderr.on('data', data => {
  logRemainder += data.toString();
  if (logRemainder.length > 32768) logRemainder = logRemainder.slice(-16384);
  for (;;) {
    const newline = logRemainder.indexOf('\n'); if (newline < 0) break;
    const line = logRemainder.slice(0, newline); logRemainder = logRemainder.slice(newline + 1);
    if (line.includes('openvpn session up')) output.tlsSessionUp = true;
    if (line.includes('SOCKS5 listening')) output.socksReady = true;
    if (line.includes('openvpn pushed options')) output.ekmAnnounced = /(?:key-derivation|protocol-flags)[^,\r\n]*\btls-ekm\b/.test(line);
    if (line.includes('VPN up')) {
      const cipher = /cipher=(AES-256-GCM|AES-128-GCM|CHACHA20-POLY1305)/.exec(line); if (cipher) output.cipher = cipher[1];
      const dns = /dns="?\[([^\]]*)\]/.exec(line); if (dns) output.pushedDNSCount = dns[1].trim() ? dns[1].trim().split(/\s+/).length : 0;
    }
    if (line.includes('data open failed')) output.incomingDataDecryptErrors++;
    if (line.includes('keepalive PING received')) output.incomingKeepalive++;
    if (line.includes('SYN')) output.tcpSynPackets++;
  }
});
class Reader {
  constructor(socket) { this.data = Buffer.alloc(0); this.waiter = null; this.ended = false; socket.on('data', b => { this.data = Buffer.concat([this.data, b]); this.waiter?.(); }); socket.on('end', () => { this.ended = true; this.waiter?.(); }); socket.on('error', () => { this.ended = true; this.waiter?.(); }); }
  async read(n) { while (this.data.length < n) { if (this.ended) throw new Error('CLOSED'); await new Promise((resolve, reject) => { const timer = setTimeout(() => { this.waiter = null; reject(new Error('TIMEOUT')); }, 12000); this.waiter = () => { clearTimeout(timer); this.waiter = null; resolve(); }; }); } const b = this.data.subarray(0, n); this.data = this.data.subarray(n); return b; }
}
async function connectTarget(host, targetPort) {
  const socket = net.connect(port, '127.0.0.1');
  let phase = 'local-socks';
  try {
    await once(socket, 'connect'); const reader = new Reader(socket); socket.write(Buffer.from([5, 1, 0]));
    const greeting = await reader.read(2); if (greeting[1] !== 0) throw new Error('SOCKS_AUTH');
    phase = 'remote-connect';
    let request;
    if (net.isIP(host) === 4) request = Buffer.from([5, 1, 0, 1, ...host.split('.').map(Number), targetPort >> 8, targetPort & 255]);
    else { const domain = Buffer.from(host); request = Buffer.concat([Buffer.from([5, 1, 0, 3, domain.length]), domain, Buffer.from([targetPort >> 8, targetPort & 255])]); }
    socket.write(request); const reply = await reader.read(4);
    const result = { literal: net.isIP(host) !== 0, stage: phase, socksReply: reply[1], connected: reply[1] === 0 };
    output.tests.push(result);
    if (reply[1] !== 0 || net.isIP(host)) return;
    if (reply[3] === 1) await reader.read(6);
    else if (reply[3] === 4) await reader.read(18);
    else { const length = await reader.read(1); await reader.read(length[0] + 2); }
    socket.removeAllListeners('data');
    phase = 'tls'; result.stage = phase;
    const secure = tls.connect({ socket, servername: host, rejectUnauthorized: true, minVersion: 'TLSv1.2' });
    secure.setTimeout(12000, () => secure.destroy(new Error('TIMEOUT')));
    await once(secure, 'secureConnect');
    result.tlsAuthorized = secure.authorized === true;
    phase = 'https-response'; result.stage = phase;
    secure.write(`GET ${host === 'api.ipify.org' ? '/?format=json' : '/'} HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n\r\n`);
    let body = Buffer.alloc(0);
    for await (const chunk of secure) { body = Buffer.concat([body, chunk]); if (body.length > 65536) { secure.destroy(); break; } }
    const text = body.toString();
    const status = /^HTTP\/1\.[01] ([0-9]{3})/.exec(text); result.httpStatus = status ? Number(status[1]) : null;
    if (host === 'api.ipify.org') { try { result.ipReturned = net.isIP(JSON.parse(text.split('\r\n\r\n')[1]).ip) !== 0; } catch { result.ipReturned = false; } }
    body.fill(0);
  } catch (error) { output.tests.push({ literal: net.isIP(host) !== 0, stage: phase, error: ['CLOSED', 'TIMEOUT', 'SOCKS_AUTH'].includes(error.message) ? error.message : 'CONNECTION_ERROR' }); }
  finally { socket.destroy(); }
}
try {
  const deadline = Date.now() + 35000;
  while (!output.socksReady && child.exitCode === null && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
  if (output.socksReady) { await connectTarget('example.com', 443); await connectTarget('api.ipify.org', 443); }
  await new Promise(resolve => setTimeout(resolve, 1000));
  console.log(JSON.stringify(output, null, 2));
} finally { logRemainder = ''; child.kill(); await Promise.race([once(child, 'exit'), new Promise(resolve => setTimeout(resolve, 2000))]); }
