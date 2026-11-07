import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { parsePsl, packRules } from '../packages/attribution/src/psl.ts';
const source = new URL('../packages/attribution/data/public_suffix_list.dat', import.meta.url);
const target = new URL('../packages/attribution/src/psl-index.json', import.meta.url);
const sha256 = '4b673689999dbaca60b93fa3e1da5752505ef9717b1c4dc44acbfdafd35679ea';
const bytes = readFileSync(source);
if (createHash('sha256').update(bytes).digest('hex') !== sha256) throw new Error('PSL snapshot hash mismatch');
const rules = parsePsl(bytes.toString('utf8'));
const rows = packRules(rules).split('\n');
const chunks = [];
for (let i = 0; i < rows.length; i += 128) chunks.push(rows.slice(i, i + 128).join('\n'));
const output = JSON.stringify({ sha256, rules: chunks }) + '\n';
if (Buffer.byteLength(output) > 150_000) throw new Error('PSL index exceeds 150 KB');
if (process.argv.includes('--check')) {
  if (readFileSync(target, 'utf8') !== output) throw new Error('PSL index is stale');
} else writeFileSync(target, output);
console.log(`PSL: ${rules.length} rules, ${Buffer.byteLength(output)} B, sha256 ${sha256}`);
