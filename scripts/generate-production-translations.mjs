import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { EXTENSION_NAME } from './production-languages.mjs';

const directory = resolve('apps/production-extension');
const reference = JSON.parse(await readFile(resolve(directory, '_locales/en/messages.json'), 'utf8'));
const languages = ['de', 'pl', 'id'];
const tables = Object.fromEntries(languages.map((locale) => [locale, {}]));
const source = await readFile(resolve('scripts/production-translations-europe.tsv'), 'utf8');
for (const line of source.split(/\r?\n/)) {
  if (line === '' || line.startsWith('#')) continue;
  const [key, ...translations] = line.split('|');
  if (!reference[key]) throw new Error(`Unknown translation key: ${key}`);
  if (translations.length !== languages.length) throw new Error(`${key}: expected ${languages.length} translations`);
  for (let index = 0; index < languages.length; index++) {
    const locale = languages[index];
    if (tables[locale][key]) throw new Error(`${locale}:${key}: duplicate`);
    const message = translations[index];
    if (message === '') throw new Error(`${locale}:${key}: empty`);
    tables[locale][key] = { ...reference[key], message };
  }
}
for (const locale of languages) {
  tables[locale].extName = { ...reference.extName, message: EXTENSION_NAME };
  await mkdir(resolve(directory, '_locales', locale), { recursive: true });
  await writeFile(resolve(directory, '_locales', locale, 'messages.json'), JSON.stringify(tables[locale], null, 2) + '\n', 'utf8');
  const missing = Object.keys(reference).filter((key) => !tables[locale][key]);
  console.log(`${locale}: ${Object.keys(tables[locale]).length}/${Object.keys(reference).length} messages; missing ${missing.length}`);
  if (process.argv.includes('--strict') && missing.length) throw new Error(`${locale}: missing ${missing.join(', ')}`);
}
