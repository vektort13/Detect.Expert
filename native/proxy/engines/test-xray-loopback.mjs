// Local real-engine interoperability fixture. No external targets or secrets.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const engine = process.argv[2] || join(root, 'release/proxy-native/windows-amd64/engines/xray.exe');
await mkdir(join(root, '.tmp'), { recursive: true });
const work = await mkdtemp(join(root, '.tmp/proxy-xray-loopback-'));
const children = [];
const sockets = new Set();
let requests = 0;
const origin = http.createServer((_request, response) => { requests++; response.end('detect-proxy-loopback-ok'); });
await new Promise(resolve => origin.listen(0, '127.0.0.1', resolve));
async function port() {
  const listener = net.createServer();
  await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
  const number = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  return number;
}
async function ready(number, child) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Engine exited: ${child.exitCode}`);
    const good = await new Promise(resolve => {
      const socket = net.connect(number, '127.0.0.1');
      socket.once('connect', () => { socket.destroy(); resolve(true); });
      socket.once('error', () => resolve(false));
    });
    if (good) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('Engine listener did not start');
}
class Reader {
  constructor(socket) {
    this.bytes = Buffer.alloc(0); this.ended = false; this.waiter = null;
    socket.on('data', data => { this.bytes = Buffer.concat([this.bytes, data]); this.waiter?.(); });
    socket.on('end', () => { this.ended = true; this.waiter?.(); });
    socket.on('error', () => { this.ended = true; this.waiter?.(); });
  }
  async read(count) {
    while (this.bytes.length < count) {
      if (this.ended) throw new Error('Connection closed');
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => { this.waiter = null; reject(new Error('Read timeout')); }, 5000);
        this.waiter = () => { clearTimeout(timeout); this.waiter = null; resolve(); };
      });
    }
    const result = this.bytes.subarray(0, count); this.bytes = this.bytes.subarray(count); return result;
  }
}
async function throughSocks(number) {
  const socket = net.connect(number, '127.0.0.1'); sockets.add(socket);
  try {
    await once(socket, 'connect');
    const reader = new Reader(socket);
    socket.write(Buffer.from([5, 1, 0]));
    assert.deepEqual(await reader.read(2), Buffer.from([5, 0]));
    const request = Buffer.from([5, 1, 0, 1, 127, 0, 0, 1, 0, 0]);
    request.writeUInt16BE(origin.address().port, 8); socket.write(request);
    const header = await reader.read(4); assert.equal(header[1], 0);
    if (header[3] === 1) await reader.read(6);
    else if (header[3] === 4) await reader.read(18);
    else { const length = await reader.read(1); await reader.read(length[0] + 2); }
    socket.write('GET / HTTP/1.1\r\nHost: loopback.invalid\r\nConnection: close\r\n\r\n');
    let response = '';
    while (!response.includes('detect-proxy-loopback-ok')) response += (await reader.read(1)).toString();
    assert.ok(response.includes('200 OK'));
  } finally { socket.destroy(); sockets.delete(socket); }
}
const uuid = '647cb51b-84d4-41ca-a9ba-1f9c68d4ab52';
const results = [];
try {
  for (const network of ['raw', 'ws', 'grpc', 'xhttp']) {
    const serverPort = await port(); const clientPort = await port();
    const streamSettings = { network, security: 'none' };
    if (network === 'ws') streamSettings.wsSettings = { path: '/owned-loopback' };
    if (network === 'grpc') streamSettings.grpcSettings = { serviceName: 'owned-loopback' };
    if (network === 'xhttp') streamSettings.xhttpSettings = { path: '/owned-loopback', mode: 'auto' };
    const configs = [
      { log: { loglevel: 'none' }, inbounds: [{ listen: '127.0.0.1', port: serverPort, protocol: 'vless', settings: { clients: [{ id: uuid }], decryption: 'none' }, streamSettings }], outbounds: [{ protocol: 'freedom' }] },
      { log: { loglevel: 'none' }, inbounds: [{ listen: '127.0.0.1', port: clientPort, protocol: 'socks', settings: { auth: 'noauth', udp: false } }], outbounds: [{ protocol: 'vless', settings: { address: '127.0.0.1', port: serverPort, id: uuid, encryption: 'none' }, streamSettings }] },
    ];
    const running = [];
    for (let index = 0; index < configs.length; index++) {
      const path = join(work, `${network}-${index}.json`); await writeFile(path, JSON.stringify(configs[index]));
      const child = spawn(engine, ['run', '-config', path], { windowsHide: true, stdio: 'ignore' });
      children.push(child); running.push(child);
      await ready(index === 0 ? serverPort : clientPort, child);
    }
    const before = requests; await throughSocks(clientPort); assert.equal(requests, before + 1);
    running.forEach(child => child.kill());
    results.push({ network, actualSocksToVlessToHttp: true });
  }
  await writeFile(join(work, 'result.json'), JSON.stringify({ passed: results.length, results, ownedLoopbackOnly: true }, null, 2));
  console.log(`Xray real loopback transports PASS: ${results.map(item => item.network).join(', ')} (${work})`);
} finally {
  sockets.forEach(socket => socket.destroy()); children.forEach(child => child.kill());
  origin.closeAllConnections(); await new Promise(resolve => origin.close(resolve));
}
