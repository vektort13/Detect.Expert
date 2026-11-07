// REQ-005: the wire contract must not even have a place for raw values. Every property name in every schema
// is checked against a deny-list, every string is bounded, and the runtime validator rejects payloads that
// try to smuggle such fields.

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validatePageBatch, validateSensorMessage } from '@detect-expert/contracts';

const schemasDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'packages', 'contracts', 'schemas');

const FORBIDDEN_FIELD_NAMES = new Set([
  'url', 'href', 'fullUrl', 'rawUrl', 'query', 'fragment', 'path', 'pathname', 'search', 'username', 'password', 'userinfo',
  'stack', 'rawStack', 'stackTrace', 'sourceUrl', 'sourceURL',
  'dataUrl', 'dataURL', 'pixels', 'imageData', 'readPixels', 'canvasData',
  'audio', 'audioSamples', 'samples', 'sample', 'buffer',
  'args', 'arguments', 'result', 'results', 'returnValue', 'mathArgs', 'mathResult',
  'text', 'measuredText', 'fonts', 'fontList', 'screen', 'hardware', 'codecs', 'userAgent',
  'keys', 'keystrokes', 'coordinates', 'formData', 'clipboard',
  'cookie', 'cookies', 'cookieValue', 'token', 'authorization', 'headers', 'body', 'requestBody', 'responseBody',
  'ip', 'ipAddress', 'candidate', 'candidates', 'ice', 'sdp', 'dnsLabel', 'labels',
]);

type Node = Record<string, unknown> | unknown[];

function collectPropertyNames(node: unknown, out: Array<{ name: string; at: string }>, at = '$'): void {
  if (Array.isArray(node)) {
    node.forEach((child, i) => collectPropertyNames(child, out, at + '[' + String(i) + ']'));
    return;
  }
  if (typeof node !== 'object' || node === null) return;
  const record = node as Record<string, unknown>;
  const props = record['properties'];
  if (typeof props === 'object' && props !== null) {
    for (const name of Object.keys(props)) out.push({ name, at: at + '.properties' });
  }
  for (const [key, child] of Object.entries(record)) {
    if (key === 'enum' || key === 'const' || key === 'required') continue;
    collectPropertyNames(child, out, at + '.' + key);
  }
}

function collectStringSchemas(node: unknown, out: Array<{ at: string; schema: Record<string, unknown> }>, at = '$'): void {
  if (Array.isArray(node)) {
    node.forEach((child, i) => collectStringSchemas(child, out, at + '[' + String(i) + ']'));
    return;
  }
  if (typeof node !== 'object' || node === null) return;
  const record = node as Record<string, unknown>;
  if (record['type'] === 'string') out.push({ at, schema: record });
  for (const [key, child] of Object.entries(record)) {
    if (key === 'enum' || key === 'const' || key === 'required') continue;
    collectStringSchemas(child, out, at + '.' + key);
  }
}

const schemaFiles = readdirSync(schemasDir).filter((f) => f.endsWith('.schema.json'));

describe('wire schemas (REQ-005 allowlist)', () => {
  it('finds the schema files', () => {
    expect(schemaFiles.length).toBeGreaterThanOrEqual(8);
  });

  for (const file of schemaFiles) {
    const schema = JSON.parse(readFileSync(join(schemasDir, file), 'utf8')) as Node;

    it(file + ': no forbidden field names', () => {
      const names: Array<{ name: string; at: string }> = [];
      collectPropertyNames(schema, names);
      const offenders = names.filter((n) => FORBIDDEN_FIELD_NAMES.has(n.name));
      expect(offenders).toEqual([]);
    });

    it(file + ': every string is bounded (maxLength) or enumerated', () => {
      const strings: Array<{ at: string; schema: Record<string, unknown> }> = [];
      collectStringSchemas(schema, strings);
      const unbounded = strings.filter((s) => typeof s.schema['maxLength'] !== 'number' && !Array.isArray(s.schema['enum']));
      expect(unbounded.map((s) => s.at)).toEqual([]);
      for (const s of strings) {
        if (typeof s.schema['maxLength'] === 'number') expect(s.schema['maxLength']).toBeLessThanOrEqual(512);
      }
    });
  }
});

describe('runtime validator refuses smuggled raw data', () => {
  const observation = { techniqueId: 'DET-001', count: 1, countQuality: 'exact', phase: 'attempted', signalCodes: [], intervalBucket: 0 };
  const batch = { schemaVersion: 1, type: 'sensor-events', sensorBootId: 'b', bridgeSessionId: 's', batchSeq: 1, observations: [observation], coverageDelta: [] };

  it('rejects extra observation fields such as url, stack, dataUrl, args', () => {
    for (const field of ['url', 'stack', 'dataUrl', 'args', 'pixels', 'cookie', 'ip', 'text']) {
      const r = validatePageBatch({ ...batch, observations: [{ ...observation, [field]: 'raw' }] });
      expect(r.ok, field).toBe(false);
    }
  });

  it('rejects trusted ids supplied by the page', () => {
    for (const field of ['tabId', 'frameId', 'documentId', 'documentKey', 'integrity', 'observationId']) {
      const r = validatePageBatch({ ...batch, [field]: 'x' });
      expect(r.ok, field).toBe(false);
    }
    const m = validateSensorMessage({ channel: 'detect.expert/v1', sensorBootId: 'b', type: 'sensor-hello', protocolVersion: 1, startedLate: false, coverageFlags: [], documentKey: '1:0:X' });
    expect(m.ok).toBe(false);
  });

  it('rejects free-form strings where enums are required', () => {
    const r = validatePageBatch({ ...batch, observations: [{ ...observation, signalCodes: ['https://tracker.example/pixel'] }] });
    expect(r.ok).toBe(false);
  });
});
