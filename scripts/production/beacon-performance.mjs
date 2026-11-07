import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { decodeBeacon, beaconProfile } from '../../apps/production-extension/beacon-decoder.js';
const root = resolve(import.meta.dirname, '../..');
const urls = [
  'https://www.google-analytics.com/g/collect?v=2&en=purchase&epn.value=49.99&cu=EUR&cid=LOCAL_ID_CANARY&gcs=G111&gcd=LOCAL_CONSENT_CANARY',
  'https://www.facebook.com/tr?ev=Purchase&cd%5Bvalue%5D=49.99&cd%5Bcurrency%5D=EUR&ud%5Bem%5D=' + 'e'.repeat(64),
  'https://mc.yandex.ru/collect?cid=LOCAL_ID_CANARY&t=ecommerce&ev=7&tr=49.99&cu=RUB&ms=LOCAL_SECRET_CANARY',
  'https://px.ads.linkedin.com/collect?pid=LOCAL_ID_CANARY&conversionId=LOCAL_ID_CANARY&eventId=LOCAL_ID_CANARY',
];
const json = JSON.stringify({ client_id: 'LOCAL_ID_CANARY', user_data: { sha256_email_address: 'e'.repeat(64) }, events: [{ name: 'purchase', params: { value: 49.99, currency: 'EUR' } }], consent: { ad_user_data: 'DENIED', ad_personalization: 'GRANTED' } });
const raw = new TextEncoder().encode(json).buffer;
const inputs = [...urls.map(url => ({ url, method: 'GET', bodyAvailable: false })), { url: 'https://www.google-analytics.com/mp/collect?api_secret=LOCAL_SECRET_CANARY', method: 'POST', bodyAvailable: true, body: { raw: [{ bytes: raw }] } }];
for (let index = 0; index < 1000; index++) decodeBeacon(inputs[index % inputs.length]);
const measure = fn => {
  const samples = [];
  for (let sample = 0; sample < 30; sample++) {
    const begin = performance.now(); for (let event = 0; event < 3000; event++) fn(event);
    samples.push(performance.now() - begin);
  }
  samples.sort((a, b) => a - b);
  return { samples: 30, eventsPerSample: 3000, medianBatchMs: samples[15], p95BatchMs: samples[28], medianEventUs: samples[15] * 1000 / 3000, p95EventUs: samples[28] * 1000 / 3000 };
};
const hashes = Object.fromEntries(['packages/contracts/src/beacons.mjs', 'apps/production-extension/beacon-decoder.js', 'apps/production-extension/beacon-observer.js', 'scripts/production/beacon-sensor-runtime.mjs'].map(file => [file, createHash('sha256').update(readFileSync(resolve(root, file))).digest('hex')]));
const result = { schemaVersion: 1, measuredAt: new Date().toISOString(), environment: { node: process.version, platform: process.platform, architecture: process.arch }, decoder: measure(index => decodeBeacon(inputs[index % inputs.length])), endpointMiss: measure(() => beaconProfile('https://accounts.google.com/ServiceLogin?PRIVATE_CANARY=1')), hashes };
const output = resolve(root, 'test-results/production-1.1.0/inspection/beacon-performance.json'); mkdirSync(resolve(root, 'test-results/production-1.1.0/inspection'), { recursive: true }); writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ decoder: result.decoder, endpointMiss: result.endpointMiss, output }));
