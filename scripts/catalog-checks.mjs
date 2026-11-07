// REQ-008/010/011, F065/F066: conservative seed dialect, never execute regex probes here.
/** Regex safety: anchored, compiles, no backreferences, no lookbehind, no nested quantifiers. */
export function checkRegex(source, where, err) {
  if (typeof source !== 'string' || source.length === 0 || source.length > 256) return err(where + ': regex must be a string of 1..256 chars');
  try {
    new RegExp(source);
  } catch (e) {
    return err(where + ': regex does not compile: ' + (e && e.message));
  }
  if (!source.startsWith('^') || !source.endsWith('$')) err(where + ': regex must be anchored with ^ and $');
  if (source.includes('(?<=') || source.includes('(?<!')) err(where + ': lookbehind is not allowed');

  // Tokenize: track escapes, character classes and group nesting.
  const groupStack = [];
  let inClass = false;
  let terminalAnchor = false;
  const unboundedAt = (i) => {
    // quantifier following position i that allows repetition > 1
    const c = source[i];
    if (c === '*' || c === '+') return true;
    if (c === '{') {
      const m = /^\{(\d+)(,(\d*))?\}/.exec(source.slice(i));
      if (!m) return false;
      const max = m[2] === undefined ? Number(m[1]) : m[3] === '' ? Infinity : Number(m[3]);
      return max > 1;
    }
    return false;
  };
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (c === '\\') {
      const n = source[i + 1];
      if (n >= '1' && n <= '9') err(where + ': backreference \\' + n + ' is not allowed');
      if (n === 'k' && source[i + 2] === '<') err(where + ': named backreference is not allowed');
      i++;
      continue;
    }
    if (inClass) {
      if (c === ']') inClass = false;
      continue;
    }
    if (c === '[') {
      inClass = true;
      continue;
    }
    if (c === '$' && i === source.length - 1) terminalAnchor = true;
    if (c === '|') {
      if (groupStack.length === 0) err(where + ': top-level alternation bypasses anchoring');
      for (const group of groupStack) group.hasAlternation = true;
    }
    if (c === '(') {
      groupStack.push({ start: i, hasRepeat: false, hasAlternation: false });
      continue;
    }
    if (c === ')') {
      const g = groupStack.pop();
      if (!g) continue;
      const followedByRepeat = unboundedAt(i + 1);
      if (followedByRepeat && g.hasAlternation) err(where + ': alternation inside a repeated group is outside the safe dialect');
      if (followedByRepeat && g.hasRepeat) err(where + ': nested quantifier (repeated group containing a quantifier) at index ' + g.start);
      if ((followedByRepeat || g.hasRepeat) && groupStack.length > 0) groupStack[groupStack.length - 1].hasRepeat = true;
      continue;
    }
    if (c === '?' && source[i - 1] !== '(' && groupStack.length > 0) groupStack[groupStack.length - 1].hasRepeat = true;
    if (c === '*' || c === '+' || c === '{') {
      if (unboundedAt(i) && groupStack.length > 0) groupStack[groupStack.length - 1].hasRepeat = true;
      if (c === '*' || c === '+') err(where + ': unbounded quantifier "' + c + '" (prefer bounded {n,m})');
      if (c === '{') {
        const m = /^\{(\d+)(,(\d*))?\}/.exec(source.slice(i));
        if (m && m[2] !== undefined && m[3] === '') err(where + ': unbounded quantifier {n,} (prefer bounded {n,m})');
      }
    }
  }
  if (!terminalAnchor) err(where + ': terminal $ must be an unescaped assertion outside a class');
}

// F068: reject ambiguous alternatives before compiling executable rules.
export function validAlternatives(value) {
  return Array.isArray(value) && value.length >= 1 && value.length <= 16 && value.every((x) => typeof x === 'string' && x.length > 0);
}
