// Local catalog authoring only. No requests or external translation services.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXTENSION_NAME } from '../production-languages.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const base = resolve(root, 'apps/production-extension/_locales');
const source = JSON.parse(readFileSync(resolve(base, 'en/messages.json'), 'utf8'));
const translations = new Map();
for (const line of readFileSync(resolve(root, 'scripts/production-translations-mr.tsv'), 'utf8').split(/\r?\n/)) {
  if (!line) continue;
  const index = line.indexOf('\t');
  const key = line.slice(0, index), message = line.slice(index + 1);
  if (index < 0 || !source[key] || !message || translations.has(key)) throw new Error('Invalid or duplicate Marathi row: ' + key);
  translations.set(key, message);
}
const placeholders = (message) => (message.match(/\$[A-Za-z_]+\$|\$[1-9]\d*/g) ?? []).sort().join('|');
const catalog = {};
for (const [key, original] of Object.entries(source)) {
  const message = key === 'extName' ? EXTENSION_NAME : translations.get(key);
  if (!message) throw new Error('Missing Marathi message: ' + key);
  if (placeholders(message) !== placeholders(original.message)) throw new Error('Marathi placeholder mismatch: ' + key);
  catalog[key] = { ...original, message };
}
mkdirSync(resolve(base, 'mr'), { recursive: true });
writeFileSync(resolve(base, 'mr/messages.json'), JSON.stringify(catalog, null, 2) + '\n');
console.log('Marathi: ' + Object.keys(catalog).length + ' complete local messages; placeholders preserved; no external translation service');
