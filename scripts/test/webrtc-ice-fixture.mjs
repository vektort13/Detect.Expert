// Local-only STUN/TURN fixture (RFC 8489/8656), never shipped in the extension.
// Relay destinations are restricted to this machine; no production server or credentials are used.
import dgram from 'node:dgram';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { crc32 } from 'node:zlib';
import { networkInterfaces } from 'node:os';

const COOKIE = 0x2112a442, REALM = 'detect-expert-local-fixture', NONCE = 'bounded-local-fixture-nonce';
const USER = 'fixture-user', PASSWORD = 'fixture-only-credential';
const KEY = createHash('md5').update(USER + ':' + REALM + ':' + PASSWORD).digest();
function attribute(type, value) {
  const result = Buffer.alloc(4 + ((value.length + 3) & ~3)); result.writeUInt16BE(type); result.writeUInt16BE(value.length, 2); value.copy(result, 4); return result;
}
function header(type, transaction, length) {
  const result = Buffer.alloc(20); result.writeUInt16BE(type); result.writeUInt16BE(length, 2); result.writeUInt32BE(COOKIE, 4); transaction.copy(result, 8); return result;
}
function integer(type, value) { const bytes = Buffer.alloc(4); bytes.writeUInt32BE(value); return attribute(type, bytes); }
function address(type, host, port) {
  const result = Buffer.alloc(8); result[1] = 1; result.writeUInt16BE(port ^ (COOKIE >>> 16), 2);
  host.split('.').map(Number).forEach((byte, index) => { result[index + 4] = byte ^ (COOKIE >>> ((3 - index) * 8) & 255); });
  return attribute(type, result);
}
function readAddress(value) {
  if (!value || value.length !== 8 || value[1] !== 1) return null;
  const host = [...value.subarray(4)].map((byte, index) => byte ^ (COOKIE >>> ((3 - index) * 8) & 255)).join('.');
  return { host, port: value.readUInt16BE(2) ^ (COOKIE >>> 16) };
}
function attributes(message) {
  if (message.length < 20 || message.readUInt32BE(4) !== COOKIE || message.readUInt16BE(2) + 20 !== message.length) return null;
  const result = new Map();
  for (let offset = 20; offset + 4 <= message.length;) {
    const type = message.readUInt16BE(offset), length = message.readUInt16BE(offset + 2);
    if (offset + 4 + length > message.length || result.has(type)) return null;
    result.set(type, { value: message.subarray(offset + 4, offset + 4 + length), offset }); offset += 4 + ((length + 3) & ~3);
  }
  return result;
}
function packet(type, transaction, fields, authenticated = false) {
  let body = Buffer.concat(fields);
  if (authenticated) {
    const prefix = Buffer.concat([header(type, transaction, body.length + 24), body]);
    body = Buffer.concat([body, attribute(0x0008, createHmac('sha1', KEY).update(prefix).digest())]);
  }
  const prefix = Buffer.concat([header(type, transaction, body.length + 8), body]);
  return Buffer.concat([prefix, integer(0x8028, (crc32(prefix) ^ 0x5354554e) >>> 0)]);
}
function authorized(message, fields) {
  const integrity = fields.get(0x0008);
  if (fields.get(0x0006)?.value.toString() !== USER || fields.get(0x0014)?.value.toString() !== REALM || fields.get(0x0015)?.value.toString() !== NONCE || integrity?.value.length !== 20) return false;
  const prefix = Buffer.from(message.subarray(0, integrity.offset)); prefix.writeUInt16BE(integrity.offset + 24 - 20, 2);
  return timingSafeEqual(integrity.value, createHmac('sha1', KEY).update(prefix).digest());
}
export async function createIceFixture({ mappedAddress = '198.51.100.37', bindAddress = '127.0.0.1' } = {}) {
  const ownAddresses = new Set(['127.0.0.1', ...Object.values(networkInterfaces()).flat().filter(item => item?.family === 'IPv4').map(item => item.address)]);
  if (!ownAddresses.has(bindAddress)) throw new TypeError('ICE fixtures may bind only to this machine.');
  const socket = dgram.createSocket('udp4'), allocations = new Map(); let closed = false;
  const counts = { received: 0, malformed: 0, binding: 0, challenge: 0, allocate: 0, authenticated: 0, relayPackets: 0, denied: 0 };
  await new Promise((resolve, reject) => { socket.once('error', reject); socket.bind(0, bindAddress, resolve); });
  const send = (bytes, client) => { if (!closed && ownAddresses.has(client.address)) socket.send(bytes, client.port, client.address); };
  socket.on('message', async (message, client) => {
    counts.received++;
    if (!ownAddresses.has(client.address) || message.length > 65535 || closed) { counts.denied++; return; }
    const key = client.port, allocation = allocations.get(key);
    const type = message.length >= 2 ? message.readUInt16BE(0) : 0;
    if (type >= 0x4000 && type <= 0x7fff) {
      const peer = allocation?.channels.get(type), size = message.length >= 4 ? message.readUInt16BE(2) : 0;
      if (peer && size <= message.length - 4) { counts.relayPackets++; allocation.socket.send(message.subarray(4, size + 4), peer.port, peer.host); }
      return;
    }
    const fields = attributes(message); if (!fields) { counts.malformed++; return; }
    const tx = message.subarray(8, 20);
    if (type === 0x0001) { counts.binding++; send(packet(0x0101, tx, [address(0x0020, mappedAddress, client.port)]), client); return; }
    if (type === 0x0016) {
      const peer = readAddress(fields.get(0x0012)?.value), data = fields.get(0x0013)?.value;
      if (allocation && ownAddresses.has(peer?.host) && data && allocation.permissions.has(peer.host)) { counts.relayPackets++; allocation.socket.send(data, peer.port, peer.host); }
      return;
    }
    if (![0x0003, 0x0004, 0x0008, 0x0009].includes(type)) return;
    if (!authorized(message, fields)) {
      counts.challenge++; const code = Buffer.concat([Buffer.from([0, 0, 4, 1]), Buffer.from('Unauthorized')]);
      send(packet(type | 0x0110, tx, [attribute(0x0009, code), attribute(0x0014, Buffer.from(REALM)), attribute(0x0015, Buffer.from(NONCE))]), client); return;
    }
    counts.authenticated++;
    if (type === 0x0003) {
      if (allocations.size >= 32) { counts.denied++; return; }
      let active = allocations.get(key);
      if (!active) {
        const relay = dgram.createSocket('udp4'); await new Promise(resolve => relay.bind(0, bindAddress, resolve));
        if (closed) { relay.close(); return; }
        active = { socket: relay, client: { port: client.port, address: client.address }, channels: new Map(), permissions: new Set() }; allocations.set(key, active);
        relay.on('message', (data, peer) => {
          if (!ownAddresses.has(peer.address) || !active.permissions.has(peer.address)) return;
          counts.relayPackets++;
          const channel = [...active.channels].find(([, target]) => target.host === peer.address && target.port === peer.port)?.[0];
          if (channel) { const channelHeader = Buffer.alloc(4); channelHeader.writeUInt16BE(channel); channelHeader.writeUInt16BE(data.length, 2); send(Buffer.concat([channelHeader, data]), active.client); }
          else send(packet(0x0017, Buffer.alloc(12), [address(0x0012, peer.address, peer.port), attribute(0x0013, data)]), active.client);
        });
      }
      counts.allocate++; send(packet(0x0103, tx, [address(0x0016, bindAddress, active.socket.address().port), address(0x0020, client.address, client.port), integer(0x000d, 60)], true), client); return;
    }
    if (!allocation) return;
    if (type === 0x0004) { send(packet(0x0104, tx, [integer(0x000d, fields.get(0x000d)?.value.readUInt32BE() ?? 60)], true), client); return; }
    const peer = readAddress(fields.get(0x0012)?.value);
    if (!ownAddresses.has(peer?.host) || !peer.port) { counts.denied++; return; }
    allocation.permissions.add(peer.host);
    if (type === 0x0009) { const number = fields.get(0x000c)?.value.readUInt16BE(); if (!number || number < 0x4000 || number > 0x7fff) return; allocation.channels.set(number, peer); }
    send(packet(type | 0x0100, tx, [], true), client);
  });
  return { host: bindAddress, port: socket.address().port, username: USER, credential: PASSWORD, counts,
    async close() { closed = true; for (const allocation of allocations.values()) allocation.socket.close(); allocations.clear(); await new Promise(resolve => socket.close(resolve)); } };
}
