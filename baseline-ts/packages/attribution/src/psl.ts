// Both ICANN and PRIVATE sections participate; normalization happens at build time.
export function parsePsl(text: string): string[] {
  const rules = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const rule = line.trim();
    if (!rule || rule.startsWith('//')) continue;
    const prefix = rule.startsWith('!') ? '!' : rule.startsWith('*.') ? '*.' : '';
    rules.add(prefix + new URL('http://' + rule.slice(prefix.length)).hostname);
  }
  return [...rules].sort();
}
/** Reverse-character sorting and front coding: decimal prefix length, colon, remainder. */
export function packRules(rules: readonly string[]): string {
  let previous = '';
  return rules.map((r) => [...r].reverse().join('')).sort().map((r) => {
    let n = 0;
    while (n < previous.length && previous[n] === r[n]) n++;
    const row = n + ':' + r.slice(n);
    previous = r;
    return row;
  }).join('\n');
}
export function unpackRules(packed: string): string[] {
  let previous = '';
  return packed.split('\n').map((row) => {
    const colon = row.indexOf(':');
    previous = previous.slice(0, Number(row.slice(0, colon))) + row.slice(colon + 1);
    return [...previous].reverse().join('');
  });
}
