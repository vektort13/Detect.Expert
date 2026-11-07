// The built companion speaks http/https upstream profiles over its real native-messaging protocol. Owned loopback fakes only,
// an isolated vault (APPDATA of a temporary directory), no browser. Set DETECT_PROXY_COMPANION_EXE to test another build.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import http from 'node:http';
import net from 'node:net';
import { PROXY_PHASES, PROXY_SAFE_CODES } from '../../apps/production-extension/proxy-shared.js';

const root = resolve(import.meta.dirname, '../..');
const exe = process.env.DETECT_PROXY_COMPANION_EXE ?? join(root, 'release/proxy-native/windows-amd64/detect-expert-proxy.exe');
const skip = process.platform !== 'win32' ? 'the companion is built for Windows' : !existsSync(exe) ? 'build the companion first: node scripts/build-proxy-companion.mjs' : false;
const caller = 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/';
const basic = (user, pass) => Buffer.from(user + ':' + pass).toString('base64');

function startHost() {
  const run = mkdtempSync(join(tmpdir(), 'detect-proxy-upstreams-')), base = join(run, 'host');
  mkdirSync(base);
  copyFileSync(exe, join(base, 'detect-expert-proxy.exe'));
  writeFileSync(join(base, 'allowed-callers.json'), JSON.stringify([caller]));
  const child = spawn(join(base, 'detect-expert-proxy.exe'), [caller], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, APPDATA: join(run, 'data') } });
  const jobs = new Map();
  let pending = Buffer.alloc(0), sequence = 0;
  child.stderr.resume();
  child.stdout.on('data', data => {
    pending = Buffer.concat([pending, data]);
    while (pending.length >= 4) {
      const size = pending.readUInt32LE();
      if (pending.length < 4 + size) return;
      const message = JSON.parse(pending.subarray(4, 4 + size));
      pending = pending.subarray(4 + size);
      jobs.get(message.id)?.(message);
      jobs.delete(message.id);
    }
  });
  const command = (op, payload = {}) => new Promise((resolveJob, reject) => {
    const id = 'upstreams-' + (++sequence), body = Buffer.from(JSON.stringify({ v: 1, id, op, ...payload })), header = Buffer.alloc(4);
    header.writeUInt32LE(body.length);
    const timer = setTimeout(() => { jobs.delete(id); reject(new Error('native-timeout')); }, 30000);
    jobs.set(id, message => { clearTimeout(timer); resolveJob(message); });
    child.stdin.write(Buffer.concat([header, body]));
  });
  const stop = async () => {
    child.stdin.end();
    let timer;
    await Promise.race([once(child, 'exit'), new Promise(done => { timer = setTimeout(done, 3000); })]);
    clearTimeout(timer);
    if (child.exitCode === null) child.kill();
    rmSync(run, { recursive: true, force: true });
  };
  return { command, stop };
}

// A forward proxy that tunnels to a local origin; every header block it receives is recorded. It wants Basic credentials when
// username is given, and it refuses every request with the fixed response `answer` when that is given.
function startProxy({ username, password, origin, answer }) {
  const seen = [];
  const server = net.createServer(socket => {
    let buffer = Buffer.alloc(0);
    socket.on('error', () => {});
    socket.on('data', function onData(chunk) {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer[0] !== 0x43) { // not "CONNECT": a TLS ClientHello, say; a real HTTP server answers such input at once
        socket.off('data', onData);
        socket.end('HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\n\r\n');
        return;
      }
      const end = buffer.indexOf('\r\n\r\n');
      if (end < 0) return;
      socket.off('data', onData);
      const head = buffer.subarray(0, end).toString('latin1'), rest = buffer.subarray(end + 4);
      seen.push(head);
      if (answer !== undefined) { socket.end(answer); return; }
      if (username !== undefined && !head.includes('\r\nProxy-Authorization: Basic ' + basic(username, password))) {
        socket.end('HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="owned"\r\nContent-Length: 0\r\n\r\n');
        return;
      }
      const upstream = net.connect(origin.address().port, '127.0.0.1', () => {
        socket.write('HTTP/1.1 200 Connection established\r\n\r\n');
        if (rest.length) upstream.write(rest);
        socket.pipe(upstream);
        upstream.pipe(socket);
      });
      upstream.on('error', () => socket.destroy());
      socket.on('close', () => upstream.destroy());
      upstream.on('close', () => socket.end());
    });
  });
  return new Promise(done => server.listen(0, '127.0.0.1', () => done({ seen, port: server.address().port, close: () => server.close() })));
}

// A SOCKS5 server that tunnels to a local origin. With a username it wants a login and answers the RFC 1929 sub-negotiation with
// version byte 5 instead of 1, as sloppy servers do; without one it wants none.
function startSloppySocks({ username, password, origin }) {
  const server = net.createServer(socket => {
    let stage = 'greeting', buffer = Buffer.alloc(0);
    socket.on('error', () => {});
    socket.on('data', function onData(chunk) {
      buffer = Buffer.concat([buffer, chunk]);
      if (stage === 'greeting') {
        if (buffer.length < 2 || buffer.length < 2 + buffer[1]) return;
        const offered = [...buffer.subarray(2, 2 + buffer[1])];
        buffer = buffer.subarray(2 + buffer[1]);
        const method = username === undefined ? (offered.includes(0) ? 0 : 255) : (offered.includes(2) ? 2 : 255); // no login wanted without a username
        socket.write(Buffer.from([5, method]));
        stage = method === 2 ? 'login' : 'request';
      }
      if (stage === 'login') {
        if (buffer.length < 2 || buffer.length < 3 + buffer[1] + buffer[2 + buffer[1]]) return;
        const ulen = buffer[1], size = 3 + ulen + buffer[2 + ulen];
        const accepted = buffer.subarray(2, 2 + ulen).toString() === username && buffer.subarray(3 + ulen, size).toString() === password;
        buffer = buffer.subarray(size);
        socket.write(Buffer.from([5, accepted ? 0 : 1]));
        if (!accepted) { socket.end(); return; }
        stage = 'request';
      }
      if (stage === 'request') {
        if (buffer.length < 5 || buffer.length < 7 + buffer[4]) return;
        socket.off('data', onData);
        const upstream = net.connect(origin.address().port, '127.0.0.1', () => {
          socket.write(Buffer.from([5, 0, 0, 1, 0, 0, 0, 0, 0, 0]));
          socket.pipe(upstream);
          upstream.pipe(socket);
        });
        upstream.on('error', () => socket.destroy());
        socket.on('close', () => upstream.destroy());
        upstream.on('close', () => socket.end());
      }
    });
  });
  return new Promise(done => server.listen(0, '127.0.0.1', () => done({ port: server.address().port, close: () => server.close() })));
}

function socksClient(port) {
  const socket = net.connect({ host: '127.0.0.1', port });
  const chunks = [];
  let waiting = null;
  socket.on('data', data => { chunks.push(data); waiting?.(); });
  socket.on('error', () => waiting?.());
  socket.on('close', () => waiting?.());
  const take = async size => {
    for (let waited = 0; Buffer.concat(chunks).length < size && waited < 100; waited++) await new Promise(done => { waiting = done; setTimeout(done, 100); });
    const all = Buffer.concat(chunks);
    chunks.length = 0;
    if (all.length > size) chunks.push(all.subarray(size));
    return all.subarray(0, size);
  };
  return { socket, take, chunks, closed: new Promise(done => socket.on('close', done)) };
}

// Every fixed code and phase the companion can send must be one the extension accepts (PROXY_SAFE_CODES / PROXY_PHASES).
function emitted(sources) {
  const codes = new Set(), phases = new Set();
  for (const source of sources) {
    for (const match of source.matchAll(/\bfail\("([a-z][a-z-]*)"/g)) codes.add(match[1]);
    for (const match of source.matchAll(/\bdiagnostic\{"([a-z][a-z-]*)"/g)) codes.add(match[1]);
    for (const match of source.matchAll(/\bcode(?: :)?= "([a-z][a-z-]*)"/g)) codes.add(match[1]);
    for (const match of source.matchAll(/\bfail\([^,()]+, "([a-z][a-z-]*)"/g)) phases.add(match[1]);
    for (const match of source.matchAll(/\bdiagnostic\{[^,]+, "([a-z][a-z-]*)"/g)) phases.add(match[1]);
    for (const match of source.matchAll(/\bphase(?: :)?= "([a-z][a-z-]*)"/g)) phases.add(match[1]);
  }
  // socksConnectCode returns the codes of SOCKS5 replies; they are the first value of each return in that function
  const relay = sources.find(source => source.includes('func socksConnectCode'));
  if (relay) for (const match of relay.slice(relay.indexOf('func socksConnectCode')).split('\n}\n')[0].matchAll(/return "([a-z][a-z-]*)"/g)) codes.add(match[1]);
  return { codes, phases };
}
test('every code and phase the companion can emit is known to the extension', () => {
  const directory = join(root, 'native/proxy/host'), sources = readdirSync(directory).filter(name => name.endsWith('.go') && !name.endsWith('_test.go')).map(name => readFileSync(join(directory, name), 'utf8'));
  const { codes, phases } = emitted(sources);
  for (const code of ['proxy-denied', 'network-unreachable', 'host-unreachable', 'auth-required', 'auth-failed', 'tls-failed', 'unsupported', 'proxy-error']) assert.ok(codes.has(code), 'scan finds ' + code);
  assert.deepEqual([...codes].filter(code => !PROXY_SAFE_CODES.includes(code)).sort(), [], 'codes missing from PROXY_SAFE_CODES');
  assert.deepEqual([...phases].filter(phase => !PROXY_PHASES.includes(phase)).sort(), [], 'phases missing from PROXY_PHASES');
  // The check can fail: a code or phase the extension does not know is reported.
  const drifted = emitted([...sources, 'return fail("brand-new-code", "brand-new-phase", true)']);
  assert.deepEqual([...drifted.codes].filter(code => !PROXY_SAFE_CODES.includes(code)), ['brand-new-code']);
  assert.deepEqual([...drifted.phases].filter(phase => !PROXY_PHASES.includes(phase)), ['brand-new-phase']);
});

test('the built companion serves http and https upstream profiles', { skip }, async t => {
  const host = startHost();
  const origin = http.createServer((request, response) => { response.setHeader('Connection', 'close'); response.end('{"ip":"203.0.113.9"}'); });
  await new Promise(done => origin.listen(0, '127.0.0.1', done));
  const proxy = await startProxy({ username: 'alice', password: 's3cr:et', origin });
  t.after(async () => { await host.stop(); proxy.close(); origin.close(); });
  const profile = (extra = {}) => ({ type: 'http', host: '127.0.0.1', port: proxy.port, username: 'alice', password: 's3cr:et', ...extra });

  await t.test('hello advertises http and https and keeps the four legacy keys', async () => {
    const hello = await host.command('hello');
    assert.equal(hello.ok, true);
    assert.equal(hello.result.capabilities.socks5, true);
    assert.equal(hello.result.capabilities.http, true);
    assert.equal(hello.result.capabilities.https, true);
    for (const key of ['socks5', 'vless', 'openvpn', 'vault']) assert.equal(typeof hello.result.capabilities[key], 'boolean', key);
  });

  await t.test('profiles are validated with fixed codes and exported unchanged', async () => {
    for (const [name, bad, code, phase] of [
      ['colon in the username', profile({ username: 'al:ice' }), 'invalid-config', 'auth'],
      ['username without password', profile({ password: undefined }), 'invalid-config', 'parse'],
      ['a URI field', profile({ uri: 'http://proxy.example:3128' }), 'invalid-config', 'parse'],
      ['SOCKS4', profile({ type: 'socks4' }), 'unsupported-profile', 'parse'],
    ]) {
      const refused = await host.command('save', { profileId: 'bad', profile: bad });
      assert.equal(refused.ok, false, name);
      assert.deepEqual([refused.error.code, refused.error.phase], [code, phase], name);
    }
    for (const [id, saved] of [['web', profile()], ['plain', profile({ type: 'https', username: undefined, password: undefined })]]) {
      const answer = await host.command('save', { profileId: id, profile: saved });
      assert.equal(answer.ok, true);
      assert.deepEqual(answer.result.summary, { type: saved.type, host: '127.0.0.1', port: proxy.port });
    }
    const exported = await host.command('export', { profileIds: ['web', 'plain'] });
    assert.equal(exported.ok, true);
    assert.deepEqual(exported.result.profiles.map(row => row.profile.type), ['http', 'https']);
    assert.equal(exported.result.profiles[0].profile.password, 's3cr:et');
  });

  await t.test('check goes through the proxy with the destination name unresolved and nothing else added', async () => {
    const before = proxy.seen.length;
    const answer = await host.command('check', { profileId: 'web', url: 'http://must-remain-remote.invalid/ip' });
    assert.equal(answer.ok, true, JSON.stringify(answer.error));
    assert.deepEqual(Object.keys(answer.result).sort(), ['elapsedMs', 'httpStatus', 'ip', 'reachable', 'remoteDns', 'tlsVerified']);
    assert.equal(answer.result.reachable, true);
    assert.equal(answer.result.remoteDns, true);
    assert.equal(answer.result.httpStatus, 200);
    assert.equal(answer.result.ip, '203.0.113.9');
    assert.equal(proxy.seen[before], 'CONNECT must-remain-remote.invalid:80 HTTP/1.1\r\nHost: must-remain-remote.invalid:80\r\nProxy-Authorization: Basic ' + basic('alice', 's3cr:et'));
    const status = await host.command('status');
    assert.equal(status.result.state, 'off', 'a check must not start a tunnel');
  });

  await t.test('a wrong password and a missing one are told apart, a TLS handshake against a plain port is a TLS failure', async () => {
    await host.command('save', { profileId: 'wrong', profile: profile({ password: 'nope' }) });
    const wrong = await host.command('check', { profileId: 'wrong', url: 'http://must-remain-remote.invalid/ip' });
    assert.deepEqual([wrong.ok, wrong.error.code, wrong.error.phase, wrong.error.retryable], [false, 'auth-failed', 'auth', false]);
    await host.command('save', { profileId: 'anonymous', profile: profile({ username: undefined, password: undefined }) });
    const anonymous = await host.command('check', { profileId: 'anonymous', url: 'http://must-remain-remote.invalid/ip' });
    assert.deepEqual([anonymous.ok, anonymous.error.code, anonymous.error.phase], [false, 'auth-required', 'auth']);
    await host.command('save', { profileId: 'tls', profile: profile({ type: 'https' }) });
    const tls = await host.command('check', { profileId: 'tls', url: 'http://must-remain-remote.invalid/ip' });
    assert.deepEqual([tls.ok, tls.error.code, tls.error.phase], [false, 'tls-failed', 'tls']);
    for (const answer of [wrong, anonymous, tls]) assert.deepEqual(Object.keys(answer.error).sort(), ['code', 'phase', 'retryable']);
    assert.equal(JSON.stringify([wrong, anonymous, tls]).includes('s3cr'), false);
  });

  await t.test('a SOCKS5 server that answers the login with version 5 still works, and a refused login is told apart', async () => {
    const sloppy = await startSloppySocks({ username: 'alice', password: 's3cr:et', origin });
    t.after(() => sloppy.close());
    const saved = await host.command('save', { profileId: 'sloppy', profile: { type: 'socks5', host: '127.0.0.1', port: sloppy.port, username: 'alice', password: 's3cr:et' } });
    assert.equal(saved.ok, true);
    const good = await host.command('check', { profileId: 'sloppy', url: 'http://must-remain-remote.invalid/ip' });
    assert.equal(good.ok, true, JSON.stringify(good.error));
    assert.equal(good.result.ip, '203.0.113.9');
    await host.command('save', { profileId: 'sloppy-wrong', profile: { type: 'socks5', host: '127.0.0.1', port: sloppy.port, username: 'alice', password: 'nope' } });
    const refused = await host.command('check', { profileId: 'sloppy-wrong', url: 'http://must-remain-remote.invalid/ip' });
    assert.deepEqual([refused.ok, refused.error.code, refused.error.phase], [false, 'auth-failed', 'auth']);
  });

  await t.test('a typed diagnose endpoint probes an http or https server directly: no profile, no login, no tunnel', async () => {
    const open = await startProxy({ origin });
    const refuses = await startProxy({ origin, answer: 'HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n' });
    const badGateway = await startProxy({ origin, answer: 'HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n' });
    const plainSocks = await startSloppySocks({ origin });
    t.after(() => { open.close(); refuses.close(); badGateway.close(); plainSocks.close(); });
    const url = 'http://must-remain-remote.invalid/ip', diagnose = endpoint => host.command('diagnose', { url, endpoint });
    const failure = answer => [answer.ok, answer.error?.code, answer.error?.phase, answer.error?.retryable];

    const passed = await diagnose({ type: 'http', host: '127.0.0.1', port: open.port });
    assert.equal(passed.ok, true, JSON.stringify(passed.error));
    assert.deepEqual(Object.keys(passed.result).sort(), ['elapsedMs', 'httpStatus', 'ip', 'reachable', 'remoteDns', 'tlsVerified']);
    assert.deepEqual([passed.result.reachable, passed.result.remoteDns, passed.result.httpStatus, passed.result.ip], [true, true, 200, '203.0.113.9']);
    assert.deepEqual(open.seen, ['CONNECT must-remain-remote.invalid:80 HTTP/1.1\r\nHost: must-remain-remote.invalid:80'], 'no login, the name unresolved, nothing else');

    // The proxy that wanted alice's login for the profile checks above: this endpoint has none to give.
    assert.deepEqual(failure(await diagnose({ type: 'http', host: '127.0.0.1', port: proxy.port })), [false, 'auth-required', 'auth', false]);
    assert.deepEqual(failure(await diagnose({ type: 'http', host: '127.0.0.1', port: refuses.port })), [false, 'proxy-denied', 'proxy', false]);
    assert.deepEqual(failure(await diagnose({ type: 'http', host: '127.0.0.1', port: badGateway.port })), [false, 'host-unreachable', 'proxy', true]);
    assert.deepEqual(failure(await diagnose({ type: 'https', host: '127.0.0.1', port: open.port })), [false, 'tls-failed', 'tls', false]);

    // Without a type, and with "socks5", the endpoint is a plain SOCKS5 server as before.
    for (const endpoint of [{ host: '127.0.0.1', port: plainSocks.port }, { type: 'socks5', host: '127.0.0.1', port: plainSocks.port }]) {
      const socks = await diagnose(endpoint);
      assert.equal(socks.ok, true, JSON.stringify(socks.error));
      assert.deepEqual([socks.result.reachable, socks.result.remoteDns, socks.result.ip], [true, true, '203.0.113.9']);
    }

    // Nothing but the probe is accepted: no login, no URI, no config, no other type, no other field, no alias spelling.
    const contacts = open.seen.length;
    for (const endpoint of [
      { type: 'http', host: '127.0.0.1', port: open.port, username: 'alice', password: 'secret-never-sent' },
      { type: 'https', host: '127.0.0.1', port: open.port, username: 'alice' },
      { type: 'http', host: '127.0.0.1', port: open.port, uri: 'http://proxy.example:3128' },
      { type: 'http', host: '127.0.0.1', port: open.port, config: 'client' },
      { type: 'http', host: '127.0.0.1', port: open.port, scheme: 'http' },
      { type: 'socks4', host: '127.0.0.1', port: open.port },
      { type: 'HTTP', host: '127.0.0.1', port: open.port },
      { type: '', host: '127.0.0.1', port: open.port },
      { type: null, host: '127.0.0.1', port: open.port },
      { Type: 'http', host: '127.0.0.1', port: open.port },
      { type: 'http', host: 'bad host', port: open.port },
      { type: 'http', host: '127.0.0.1', port: 0 },
    ]) {
      const refused = await diagnose(endpoint);
      assert.deepEqual([refused.ok, refused.error.code, refused.error.retryable], [false, 'invalid-input', false], JSON.stringify(endpoint));
      assert.equal(JSON.stringify(refused).includes('secret-never-sent'), false);
    }
    assert.equal(open.seen.length, contacts, 'a refused endpoint must not reach the server');

    assert.equal((await host.command('status')).result.state, 'off', 'a diagnose must not start a tunnel');
    const exported = await host.command('export', { profileIds: ['web'] });
    assert.equal(exported.ok, true, 'the vault still holds only the profiles that were saved');
  });

  await t.test('connect opens a loopback SOCKS5 relay that tunnels through the proxy, and disconnect closes it', async () => {
    const connected = await host.command('connect', { profileId: 'web' });
    assert.equal(connected.ok, true, JSON.stringify(connected.error));
    assert.equal(connected.result.host, '127.0.0.1');
    const port = connected.result.port;

    const refused = socksClient(port);
    refused.socket.write(Buffer.from([5, 0]));
    assert.deepEqual([...await refused.take(2)], [5, 255], 'NMETHODS 0');
    refused.socket.destroy();

    const bind = socksClient(port);
    bind.socket.write(Buffer.from([5, 1, 0]));
    assert.deepEqual([...await bind.take(2)], [5, 0]);
    bind.socket.write(Buffer.from([5, 2, 0, 1, 192, 0, 2, 1, 0, 80]));
    assert.deepEqual([...await bind.take(10)], [5, 7, 0, 1, 0, 0, 0, 0, 0, 0], 'BIND');
    bind.socket.destroy();

    const client = socksClient(port);
    client.socket.write(Buffer.from([5, 1, 0]));
    assert.deepEqual([...await client.take(2)], [5, 0]);
    const name = Buffer.from('must-remain-remote.invalid');
    client.socket.write(Buffer.concat([Buffer.from([5, 1, 0, 3, name.length]), name, Buffer.from([0, 80])]));
    assert.deepEqual([...await client.take(10)], [5, 0, 0, 1, 0, 0, 0, 0, 0, 0]);
    client.socket.write('GET /ip HTTP/1.1\r\nHost: must-remain-remote.invalid\r\nConnection: close\r\n\r\n');
    let timer;
    await Promise.race([client.closed, new Promise(done => { timer = setTimeout(done, 5000); })]); // the origin closes after its answer
    clearTimeout(timer);
    assert.match(Buffer.concat(client.chunks).toString(), /203\.0\.113\.9/);
    client.socket.destroy();

    const disconnected = await host.command('disconnect');
    assert.equal(disconnected.ok, true);
    const closed = await new Promise(done => { const probe = net.connect({ host: '127.0.0.1', port }); probe.on('error', () => done(true)); probe.on('connect', () => { probe.destroy(); done(false); }); });
    assert.equal(closed, true, 'the relay must stop listening after disconnect');
  });
});
