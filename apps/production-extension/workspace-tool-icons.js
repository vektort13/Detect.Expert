// ADR-111: the decorative glyphs of the compact header tools (Tour, Refresh, Export). Local SVG paths only; every glyph is hidden from
// assistive technology because the button around it carries the name.
const PATHS = Object.freeze({
  refresh: Object.freeze(['M20 11a8 8 0 0 0-14.9-3M4 5v4h4M4 13a8 8 0 0 0 14.9 3M20 19v-4h-4']),
  export: Object.freeze(['M12 3v12m-4-4 4 4 4-4M4 16v5h16v-5']),
  tour: Object.freeze(['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z', 'm15.6 8.4-2.1 5.1-5.1 2.1 2.1-5.1Z']),
});
export const WORKSPACE_TOOL_ICONS = Object.freeze(Object.keys(PATHS));

/** A 16 px outline glyph for a header tool; an unknown name draws nothing. */
export function workspaceToolIcon(h, name) {
  if (!Object.hasOwn(PATHS, name)) return null;
  return h('svg', { class: 'workspace-tool__glyph', 'data-tool-glyph': name, width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false',
    children: PATHS[name].map(d => h('path', { d })) });
}
