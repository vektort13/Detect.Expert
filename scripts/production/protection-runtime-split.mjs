// ADR-046: each standalone MAIN script carries the shared runtime and only its own switch case.
const SWITCH_LINE = '  switch (feature) {\n';
const SWITCH_END = '\n  }\n  return {';
const CASE_START = /^ {4}case "([a-z0-9-]+)":/gm;

// Splits at the single feature switch: head ends with the switch line, body holds the case blocks
// with their final line break, tail starts at the closing '  }' line.
export function switchBounds(source) {
  const found = source.indexOf('\n' + SWITCH_LINE);
  const start = source.startsWith(SWITCH_LINE) ? 0 : found < 0 ? -1 : found + 1;
  const bodyStart = start < 0 ? -1 : start + SWITCH_LINE.length;
  const end = bodyStart < 0 ? -1 : source.indexOf(SWITCH_END, bodyStart - 1);
  if (start < 0 || end < 0) throw new Error('Protection runtime switch boundary missing');
  if (source.indexOf('\n' + SWITCH_LINE, bodyStart - 1) >= 0) throw new Error('Protection runtime switch boundary ambiguous');
  return { head: source.slice(0, bodyStart), body: source.slice(bodyStart, end + 1), tail: source.slice(end + 1) };
}

function terminated(chunk) {
  const code = chunk.trimEnd();
  return code.endsWith('break;') || code.endsWith('break;\n    }');
}

// Returns Map(feature -> head + own case + tail) in contract order; every feature needs exactly one terminated case.
export function splitProtectionRuntime(runtime, features) {
  const { head, body, tail } = switchBounds(runtime);
  const matches = [...body.matchAll(CASE_START)];
  if (matches.length > 0 ? matches[0].index !== 0 : body.length > 0) {
    throw new Error('Unexpected code before first protection case' + (matches.length > 0 ? ': ' + matches[0][1] : ''));
  }
  const chunks = new Map(), duplicate = [], unterminated = [];
  for (let index = 0; index < matches.length; index++) {
    const id = matches[index][1], next = index + 1 < matches.length ? matches[index + 1].index : body.length;
    const chunk = body.slice(matches[index].index, next);
    if (chunks.has(id)) duplicate.push(id);
    else chunks.set(id, chunk);
    if (!terminated(chunk)) unterminated.push(id);
  }
  const wanted = new Set(), repeated = [];
  for (const feature of features) {
    if (wanted.has(feature)) repeated.push(feature);
    wanted.add(feature);
  }
  const missing = [...wanted].filter(feature => !chunks.has(feature));
  const extra = [...chunks.keys()].filter(id => !wanted.has(id));
  const problems = [];
  if (repeated.length) problems.push('duplicate protection feature: ' + repeated.join(', '));
  if (duplicate.length) problems.push('duplicate protection case: ' + duplicate.join(', '));
  if (unterminated.length) problems.push('protection case without final break: ' + unterminated.join(', '));
  if (missing.length) problems.push('missing protection case: ' + missing.join(', '));
  if (extra.length) problems.push('protection case without contract feature: ' + extra.join(', '));
  if (problems.length) throw new Error('Protection runtime split failed: ' + problems.join('; '));
  return new Map([...wanted].map(feature => [feature, head + chunks.get(feature) + tail]));
}
