// ADR-110 addendum (2026-11-07, owner decision): deterministic noise for GENERATED Windows font lists. Pure functions, no browser calls.
//
// What it is. A generated Windows list may leave out a few OPTIONAL families, chosen from the profile's random seed, so that the lists of two
// generated profiles differ in a few families. The same seed and the same claimed list always give the same result. It only shapes the list that is
// stored in the Custom row (families + fallback: the contract is untouched); nothing is measured, nothing is created, and the list stays visible
// and editable in the row editor.
// What it is not. It does not model a real machine, so it does not make the list more genuine, and it promises nothing about what a page can tell.
//
// Rules.
//  - About 3 % of the OPTIONAL names are left out: round(0.03 x the optional names of the list), normally exactly that many (the walk below skips a
//    family that no longer fits the budget). The Windows 10 list (96 names, 57 of them optional) leaves out 2, a list with the Office group 5. A list of real
//    size (at least FONT_NOISE_FLOOR_FROM optional names) never leaves out fewer than FONT_NOISE_MIN = 2 names, so that profiles differ in "several"
//    families: only the Japanese Windows 10 list (48 optional names, 1.4 rounded) is affected.
//  - Mandatory families are never left out (FONT_NOISE_MANDATORY): the Latin web and UI families that every Windows has and every probe starts
//    from, the Windows interface/symbol families, the tells that mark a Windows list, and the five platform aliases. For a claimed region the
//    caller adds roots (`lockedRoots`: the families of its regional CJK group and the base-script families of that region, ADR-110 addendum 2);
//    they are mandatory for that list only, so the 29 roots above stay the same for every other claim.
//  - A family is a UNIT: a name together with the names that continue it after a space ("Candara" + "Candara Light", "Segoe UI" + "Segoe UI
//    Semibold"). A unit is left out whole or not at all, and a unit that holds a mandatory name is mandatory as a whole, so no weight variant is
//    ever left behind without its base and no base without its variants.
//  - Which units go: every optional unit gets a 32-bit score from (seed, its root name) and the walk takes them in ascending score order, skipping
//    one that does not fit the remaining budget, until the budget is spent. Ties are broken by the root name. Integer arithmetic only, so the
//    result is the same in every engine.
// removedByNoise() is the inverse used to recognize a stored list: which names a candidate lacks compared with the clean list, if that is a valid
// noise set (a few whole optional units, at most the limit). followFontNoise() keeps a list noisy when the claimed Windows changes.
// FONT_NOISE_VERSION names the algorithm below. Saved profiles keep the list they were generated with; a change of the algorithm only changes lists
// that are generated afterwards (scripts/test/fingerprint-font-noise.test.mjs pins a few vectors).
export const FONT_NOISE_VERSION = 1;
export const FONT_NOISE_SHARE = 0.03;
export const FONT_NOISE_MIN = 2;
export const FONT_NOISE_FLOOR_FROM = 40;
const SALT = 0x666f6e74; // "font"
const MAX_NAMES = 512;

// Roots of the families that noise never hides (their units are mandatory too).
export const FONT_NOISE_MANDATORY = Object.freeze([
  // Latin text and the CSS-default Windows families that sites style with and every font probe starts from.
  'Arial', 'Calibri', 'Cambria', 'Comic Sans MS', 'Consolas', 'Courier New', 'Georgia', 'Impact', 'Lucida Console', 'Lucida Sans Unicode',
  'Microsoft Sans Serif', 'Palatino Linotype', 'Tahoma', 'Times New Roman', 'Trebuchet MS', 'Verdana',
  // The interface, symbol and icon families of Windows itself, and the tells that mark a Windows list.
  'Segoe UI', 'Segoe MDL2 Assets', 'Marlett', 'Symbol', 'Webdings', 'Wingdings', 'MS UI Gothic', 'Franklin Gothic Medium',
  // The platform aliases: a Windows browser answers for them wherever it answers for the families they stand for.
  'Courier', 'Helvetica', 'MS Sans Serif', 'MS Serif', 'Times',
]);
const MANDATORY_KEYS = FONT_NOISE_MANDATORY.map(name => name.toLowerCase());
// A name is mandatory when it is a mandatory root or continues one after a space (even if the list does not hold that root). `extra` holds the
// lower-cased roots that the caller adds for one list.
const continues = (key, root) => key === root || key.startsWith(root + ' ');
const isMandatory = (key, extra) => MANDATORY_KEYS.some(root => continues(key, root)) || extra.some(root => continues(key, root));

const namesOf = list => Array.isArray(list) && list.length <= MAX_NAMES ? list.filter(item => typeof item === 'string') : [];
// 32-bit FNV-1a over the UTF-16 code units, seeded, followed by the murmur3 finalizer (full avalanche). No floating point.
function mix(seed, text) {
  let hash = (seed ^ SALT ^ 0x9e3779b9) >>> 0;
  for (let index = 0; index < text.length; index++) hash = Math.imul(hash ^ text.charCodeAt(index), 0x01000193) >>> 0;
  hash ^= hash >>> 16; hash = Math.imul(hash, 0x85ebca6b) >>> 0; hash ^= hash >>> 13; hash = Math.imul(hash, 0xc2b2ae35) >>> 0; hash ^= hash >>> 16;
  return hash >>> 0;
}
const asSeed = seed => Number.isInteger(seed) ? seed >>> 0 : null;
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;

// The units of a list: [{ root, key, names, locked }] in order of first appearance, and the limit (names that noise may leave out).
// `lockedRoots` (optional) are extra mandatory roots for this list, such as the families of a claimed region.
export function fontNoiseModel(list, lockedRoots = []) {
  const names = namesOf(list), keys = names.map(name => name.toLowerCase()), extra = namesOf(lockedRoots).map(name => name.toLowerCase());
  const bases = [...new Set(keys)].sort((a, b) => a.length - b.length || compare(a, b));
  const byRoot = new Map(), order = [];
  for (let index = 0; index < names.length; index++) {
    const key = keys[index];
    // The shortest other name that this one continues after a space is its root; a name that continues nothing is its own root.
    const rootKey = bases.find(base => base.length < key.length && key.startsWith(base + ' ')) ?? key;
    let unit = byRoot.get(rootKey);
    if (!unit) { unit = { key: rootKey, root: null, names: [], locked: false }; byRoot.set(rootKey, unit); order.push(unit); }
    unit.names.push(names[index]);
    if (key === rootKey) unit.root = names[index];
    if (isMandatory(key, extra)) unit.locked = true;
  }
  const optional = order.reduce((sum, unit) => unit.locked ? sum : sum + unit.names.length, 0);
  const share = Math.round(optional * FONT_NOISE_SHARE);
  return { units: order, optional, limit: optional >= FONT_NOISE_FLOOR_FROM ? Math.max(FONT_NOISE_MIN, share) : share };
}

// The names a seed leaves out of `list`, in list order. Nothing is left out for a seed that is not an integer.
export function fontNoiseHidden(list, seed, lockedRoots = []) {
  const value = asSeed(seed);
  if (value === null) return [];
  const model = fontNoiseModel(list, lockedRoots), ranked = model.units.filter(unit => !unit.locked).map(unit => ({ unit, score: mix(value, unit.key) }))
    .sort((a, b) => a.score - b.score || compare(a.unit.key, b.unit.key));
  const hidden = new Set();
  let budget = model.limit;
  for (const { unit } of ranked) {
    if (budget <= 0) break;
    if (unit.names.length > budget) continue;
    for (const name of unit.names) hidden.add(name);
    budget -= unit.names.length;
  }
  return namesOf(list).filter(name => hidden.has(name));
}

// `list` without the names that `seed` leaves out (a fresh array, same order). A seed that is not an integer leaves the list whole.
export function noisyFontList(list, seed, lockedRoots = []) {
  const hidden = new Set(fontNoiseHidden(list, seed, lockedRoots));
  return Array.isArray(list) ? list.filter(item => !(typeof item === 'string' && hidden.has(item))) : [];
}

// The names that `candidate` lacks compared with the clean `list` when that is a valid noise set: `candidate` is a subsequence of `list`, the missing
// names are whole optional units and no more than the limit. Equal lists give []; anything else gives null.
export function removedByNoise(list, candidate, model = fontNoiseModel(list)) {
  const clean = namesOf(list);
  if (!Array.isArray(candidate) || candidate.length > clean.length || candidate.length < clean.length - model.limit) return null;
  const removed = [];
  let at = 0;
  for (const name of clean) { if (at < candidate.length && candidate[at] === name) at++; else removed.push(name); }
  if (at !== candidate.length) return null;
  if (removed.length > model.limit) return null;
  if (removed.length === 0) return removed;
  const gone = new Set(removed.map(name => name.toLowerCase()));
  for (const unit of model.units) {
    let inside = 0;
    for (const name of unit.names) if (gone.has(name.toLowerCase())) inside++;
    if (inside === 0) continue;
    if (unit.locked || inside !== unit.names.length) return null;
  }
  return removed;
}

// A seed derived from the names a list had left out: how noise follows the list when the claimed Windows changes (the same names give the same seed).
export function noiseSeedFromNames(names) {
  const sorted = namesOf(names).map(name => name.toLowerCase()).sort(compare);
  return mix(0x6e6f6973, sorted.join('\u0000'));
}
// `list` (clean, for the newly claimed Windows) with noise that follows `previousHidden`, the names the earlier list had left out.
export function followFontNoise(list, previousHidden, lockedRoots = []) {
  return noisyFontList(list, noiseSeedFromNames(previousHidden), lockedRoots);
}
