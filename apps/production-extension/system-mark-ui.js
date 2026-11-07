// ADR-034/078: shared decorative system marks, with the accessible name kept in text.
import { systemBrand } from './system-branding.js';

export function createSystemMarkUi({ h }) {
  function SystemMark({ identity, size = 20, className = '', loading = 'lazy' }) {
    const mark = systemBrand(identity);
    const pixels = size === 28 ? 28 : 20;
    if (!mark) return h('svg', { class: className, width: pixels, height: pixels, viewBox: '0 0 24 24',
      fill: 'none', stroke: 'currentColor', 'stroke-width': 1.7, 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
      'aria-hidden': true, focusable: false, 'data-system-fallback': true,
      children: h('path', { d: 'M5 4h14v16H5zM9 8h6M9 12h6M9 16h3' }) });
    return h('img', { class: className, src: mark.src, alt: '', width: pixels, height: pixels,
      loading: loading === 'eager' ? 'eager' : 'lazy', decoding: 'async', draggable: false, 'aria-hidden': true,
      'data-system-logo': mark.id, 'data-system-icon-kind': mark.kind,
      ...(mark.kind === 'brand' ? { 'data-company-logo': mark.brandId ?? mark.id } : {}) });
  }

  function SystemLabel({ name, identity = name, size = 'compact' }) {
    const mark = systemBrand(identity), large = size === 'large';
    return h('span', { class: 'company-label company-label--' + (large ? 'large' : 'compact'),
      'data-system-label': mark?.id ?? 'generic',
      ...(mark?.kind === 'brand' ? { 'data-company-brand': mark.brandId ?? mark.id, 'data-company-role': 'company' } : {}),
      children: [
        h('span', { class: 'company-label__mark', 'aria-hidden': true, children:
          SystemMark({ identity, size: large ? 28 : 20, className: 'company-logo', loading: 'eager' }) }),
        h('bdi', { class: 'company-label__name', children: name })
      ] });
  }

  return { SystemMark, SystemLabel };
}
