// Local decorative SVGs for settings, side-panel navigation and result clearing.
export function createActionIcons(h) {
  const icon = (name, children) => h('svg', { class: 'ui-action-icon', 'data-action-icon': name, width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.7, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false', children });
  function GearIcon() {
    return icon('settings', [
      h('path', { d: 'm9.5 3-.5 2a7.5 7.5 0 0 0-1.6.9l-2-.6L3 9.5l1.5 1.4a7.5 7.5 0 0 0 0 2.2L3 14.5l2.4 4.2 2-.6A7.5 7.5 0 0 0 9 19l.5 2h5l.5-2a7.5 7.5 0 0 0 1.6-.9l2 .6 2.4-4.2-1.5-1.4a7.5 7.5 0 0 0 0-2.2L21 9.5l-2.4-4.2-2 .6A7.5 7.5 0 0 0 15 5l-.5-2Z' }),
      h('circle', { cx: 12, cy: 12, r: 3 })
    ]);
  }
  function BroomIcon() {
    return icon('broom', [
      h('path', { d: 'm20 3-8 8M10 10l4 4M10 10c-3 1-5.5 3.5-7 7l4 4c3.5-1.5 6-4 7-7ZM6 16l3 3M8.5 13.5l4 4M15 21h6' })
    ]);
  }
  function PinIcon() {
    return icon('pin', [
      h('path', { d: 'M8 3h8M9 3v6l-3 4v2h12v-2l-3-4V3M12 15v7' })
    ]);
  }
  return { GearIcon, BroomIcon, PinIcon };
}
