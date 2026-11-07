// ADR-103/107 round 5: inline icons of the Proxy manager. Every glyph is a local stroke path on a 24 x 24 grid (no external icon
// font or image). Each proxy type has its own shape, and a state is always a shape plus a word, never a colour alone.
export const PROXY_GLYPHS = Object.freeze({
  proxy: 'M4 7h16M4 17h16M7 4v6m10 4v6M4 12h16',
  socks5: 'M12 3 4 7v5c0 5 8 9 8 9s8-4 8-9V7zM9 12l2 2 4-4',
  http: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M3 12h18M12 3c3 3.2 3 14.8 0 18M12 3c-3 3.2-3 14.8 0 18',
  https: 'M12 3 5 6v5c0 4.5 3 8 7 10 4-2 7-5.5 7-10V6zM9.5 11.5h5v4h-5zM10.5 11.5v-1a1.5 1.5 0 0 1 3 0v1',
  vless: 'm5 4 7 16 7-16M7 4h10',
  openvpn: 'M7 13v-3a5 5 0 0 1 10 0v3M6 13h12v8H6zM12 16v2',
  plus: 'M12 5v14M5 12h14',
  connect: 'M12 3v9M6 6a8 8 0 1 0 12 0',
  disconnect: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M9.5 9.5h5v5h-5z',
  export: 'M12 3v12m-4-4 4 4 4-4M4 16v5h16v-5',
  edit: 'm15 4 5 5M4 20l1-6L16 3l5 5L10 19z',
  delete: 'M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7',
  copy: 'M8 8h12v13H8zM4 16H3V3h12v1',
  check: 'M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14m5 12 6 6M7 10l2 2 4-4',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14m9 16-4.2-4.2',
  filter: 'M4 5h16l-6 7.5V18l-4 2v-7.5z',
  sort: 'M8 4v15m-4-4 4 4 4-4M16 20V5m-4 4 4-4 4 4',
  caret: 'm7 10 5 5 5-5',
  chevron: 'm10 7 5 5-5 5',
  import: 'M4 6h11M4 12h11M4 18h7m11-4v6m-3-3h6',
  file: 'M7 3h7l5 5v13H7zM14 3v5h5',
  pass: 'm5 12.5 4.5 4.5L19 7.5',
  fail: 'M7 7l10 10M17 7 7 17',
  pending: 'M12 7v5l3 2M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18',
  unknown: 'M7 12h10',
  status: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18m-4 9 3 3 5-6',
  dice: 'M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1M8.5 8.5h.01M15.5 8.5h.01M12 12h.01M8.5 15.5h.01M15.5 15.5h.01',
  close: 'm6 6 12 12M18 6 6 18',
  more: 'M4 12a1.1 1.1 0 1 0 2.2 0 1.1 1.1 0 1 0-2.2 0M10.9 12a1.1 1.1 0 1 0 2.2 0 1.1 1.1 0 1 0-2.2 0M17.8 12a1.1 1.1 0 1 0 2.2 0 1.1 1.1 0 1 0-2.2 0',
  columns: 'M4 5h16v14H4zM9.5 5v14M14.5 5v14',
  rows: 'M4 6h16M4 12h16M4 18h16',
  eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6',
  eyeOff: 'M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.5 6.6C3.7 8.4 2 12 2 12s3.6 7 10 7c1.5 0 2.9-.4 4.1-.9M9.9 9.9a3 3 0 0 0 4.2 4.2',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3A4 4 0 0 0 13 5.3l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3A4 4 0 0 0 11 18.7l1-1',
  history: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2',
  warning: 'M12 3 2 20h20zM12 10v5M12 18h.01',
  info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M12 11v6M12 7.5h.01',
  help: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.8.4-1 1-1 1.7M12 17h.01',
  lock: 'M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3',
  globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M3 12h18M12 3c3 3.2 3 14.8 0 18M12 3c-3 3.2-3 14.8 0 18',
  spinner: 'M12 3a9 9 0 0 1 9 9',
  up: 'M12 19V5m-5 5 5-5 5 5',
  down: 'M12 5v14m-5-5 5 5 5-5',
  shield: 'M12 3 4 7v5c0 5 8 9 8 9s8-4 8-9V7z',
  droplet: 'M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z',
  route: 'M6 3v12a4 4 0 0 0 4 4h8M3 6l3-3 3 3m6 10 3 3-3 3M6 11h8a4 4 0 0 0 4-4V3',
  companion: 'M4 4h16v12H4zM8 20h8m-4-4v4',
  panel: 'M4 5h16v14H4zM14 5v14',
  external: 'M14 4h6v6M20 4l-9 9M18 14v6H4V6h6',
  filter: 'M4 5h16l-6 7v6l-4 2v-8z',
});

export function createProxyIcons({ h }) {
  const path = kind => PROXY_GLYPHS[kind] ?? PROXY_GLYPHS.proxy;
  // A plain icon: decorative, never named (its button or label carries the name).
  const icon = (kind, size = 18, properties = {}) => h('svg', { class: 'pm-icon', width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.7, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false', 'data-icon': kind, ...properties, children: h('path', { d: path(kind) }) });
  // The small shape inside a status chip: heavier stroke so it stays legible at 14 px.
  const badgeIcon = kind => h('svg', { class: 'pm-badge-icon', width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 2.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false', 'data-glyph': kind, children: h('path', { d: path(kind) }) });
  // The progress spinner: an arc turned by CSS (and not at all under reduced motion, where it stays a static arc).
  const spinner = (size = 14) => h('svg', { class: 'pm-spinner', width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 3, 'stroke-linecap': 'round', 'aria-hidden': 'true', focusable: 'false', 'data-glyph': 'pending', children: [h('circle', { cx: 12, cy: 12, r: 9, opacity: 0.25 }), h('path', { d: PROXY_GLYPHS.spinner })] });
  // The empty-list picture: a small server, a dashed route and a node, drawn only from currentColor so every theme tints it.
  const illustration = () => h('svg', { class: 'pm-illustration', width: 132, height: 92, viewBox: '0 0 132 92', fill: 'none', 'aria-hidden': 'true', focusable: 'false', children: [
    h('rect', { x: 8, y: 14, width: 52, height: 22, rx: 6, stroke: 'currentColor', 'stroke-width': 2 }),
    h('rect', { x: 8, y: 42, width: 52, height: 22, rx: 6, stroke: 'currentColor', 'stroke-width': 2, opacity: 0.7 }),
    h('circle', { cx: 20, cy: 25, r: 2.5, fill: 'currentColor' }), h('circle', { cx: 20, cy: 53, r: 2.5, fill: 'currentColor', opacity: 0.7 }),
    h('path', { d: 'M28 25h22M28 53h22', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', opacity: 0.45 }),
    h('path', { d: 'M60 25c18 0 14 41 32 41', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-dasharray': '2 6', opacity: 0.8 }),
    h('circle', { cx: 104, cy: 66, r: 14, stroke: 'currentColor', 'stroke-width': 2 }),
    h('path', { d: 'M98 66h12M104 60v12', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round' }),
    h('path', { d: 'M12 80h40', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', opacity: 0.3 }),
  ] });
  return { icon, badgeIcon, spinner, illustration };
}
