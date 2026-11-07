// DET-043: ReportProjection keeps signal presence, not per-signal/phase counts.
import {detectorPointerLabels} from './detector-pointer-labels.js';

const MAX_COUNT = 2147483647;
function own(value, key) {
  if (value === null || typeof value !== 'object') return undefined;
  const field = Object.getOwnPropertyDescriptor(value, key);
  return field && Object.hasOwn(field, 'value') ? field.value : undefined;
}
export function detectorPointerPresence(report, {loading = false, available = false} = {}) {
  const result = {listeners: false, coordinates: false};
  if (loading || !available) return result;
  try {
    if (own(report, 'coverageState') === 'no-access' || own(report, 'scopeMode') === 'off') return result;
    const rows = own(report, 'techniques'), length = own(rows, 'length');
    if (!Array.isArray(rows) || !Number.isSafeInteger(length) || length > 128) return result;
    let row = null;
    for (let index = 0; index < length; index++) {
      const candidate = own(rows, index);
      if (own(candidate, 'techniqueId') !== 'DET-043') continue;
      if (row !== null) return result;
      row = candidate;
    }
    const count = own(row, 'count'), signals = own(row, 'signalCodes'), signalCount = own(signals, 'length');
    if (!Number.isSafeInteger(count) || count < 1 || count > MAX_COUNT ||
        own(row, 'evidenceSource') !== 'page-hook' || own(row, 'integrity') !== 'page-controlled' ||
        !Array.isArray(signals) || !Number.isSafeInteger(signalCount) || signalCount > 64) return result;
    let listeners = false, coordinates = false;
    for (let index = 0; index < signalCount; index++) {
      const signal = own(signals, index);
      if (typeof signal !== 'string') return result;
      if (signal === 'movement-listener') listeners = true;
      if (signal === 'pointer-coordinate-read') coordinates = true;
    }
    return {listeners, coordinates};
  } catch { return result; }
}

export function createDetectorPointerUi({h, useLocale}) {
  function PointerActivity({report = null, loading = false, available = false, movement = null} = {}) {
    const labels = detectorPointerLabels(useLocale()), facts = detectorPointerPresence(report, {loading, available});
    const state = loading ? 'loading' : !available || report === null ? 'unavailable' : 'ready';
    const movementCount = own(movement, 'count'), movementFrames = own(movement, 'frameCount'), partialFlag = own(movement, 'partial');
    const movementPartial = partialFlag === true || own(movement, 'state') === 'partial';
    const movementReady = !loading && available === true && report !== null &&
      !['no-access', 'paused', 'unsupported'].includes(own(report, 'coverageState')) && own(report, 'scopeMode') !== 'off' && ['ready', 'partial'].includes(own(movement, 'state')) &&
      Number.isSafeInteger(movementCount) && movementCount >= 0 && movementCount <= MAX_COUNT &&
      Number.isSafeInteger(movementFrames) && movementFrames >= 1 && movementFrames <= 64 && typeof partialFlag === 'boolean';
    const icon = h('svg', {viewBox: '0 0 24 24', width: 19, height: 19, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.7, 'stroke-linejoin': 'round', 'aria-hidden': true, focusable: false, children: [
      h('path', {d: 'm5 3 14 9-7 2-3 7L5 3Z'}), h('path', {d: 'm13 15 4 5'})
    ]});
    return h('section', {class: 'detector-pointer', 'data-detector-pointer': true, 'data-pointer-state': state, 'aria-label': labels.title, 'aria-busy': loading, children: [
      h('header', {class: 'detector-pointer__heading', children: [h('span', {class: 'detector-pointer__icon', 'aria-hidden': true, children: icon}), h('h3', {children: labels.title})]}),
      h('div', {class: 'detector-pointer__cards', children: [...['listeners', 'coordinates'].map(id => h('div', {class: 'detector-pointer__card', 'data-pointer-kind': id, key: id, children: [
        h('strong', {class: 'detector-pointer__label', children: labels[id]}),
        h('span', {class: 'detector-pointer__status', 'data-pointer-observed': facts[id], 'aria-label': facts[id] ? labels.observed : loading ? labels.loading : labels.noData, children: facts[id] ? labels.observed : '—'})
      ]})), h('div', {class: 'detector-pointer__card', 'data-pointer-kind': 'movement', children: [
        h('strong', {class: 'detector-pointer__label', children: labels.movement}),
        h('bdi', {class: 'detector-pointer__movement', dir: 'ltr', 'data-movement-state': movementReady ? movementPartial ? 'partial' : 'ready' : 'unavailable', children: movementReady ? (movementPartial ? '≥' : '') + String(movementCount) : '—'}),
        h('span', {class: 'detector-pointer__status small', children: movementReady ? movementPartial ? labels.partial : labels.period : loading ? labels.loading : labels.noData})
      ]})]})
    ]});
  }
  return {PointerActivity};
}
