// ADR-104: stroke icons for the Antidetect device/OS/browser/network levels. 24x24, stroke=currentColor.
//
// Each value is either a single path-data string or an array of strings (one <path> each),
// so multi-stroke glyphs stay readable. Geometry matches the existing Icon convention in
// antidetect-ui.js / fingerprint-profile-ui.js: simple, geometric, stroke-width 1.6, rounded
// joins, fill none. Only M L H V C Q A Z commands (and lowercase relatives) are used.

export const DEVICE_ICON_PATHS = Object.freeze({
  // Device level ------------------------------------------------------------
  // Clamshell: screen rectangle over a slanted keyboard deck.
  laptop: 'M5 5h14v9H5ZM3 18l2-4h14l2 4Z',
  // Desktop PC: tower beside a monitor on a stand.
  desktop: ['M3 4h5v15H3Z', 'M11 5h10v9H11ZM16 14v3m-3 0h6'],

  // OS level ----------------------------------------------------------------
  // Windows 10: four window panes, slightly wide, sharp corners (classic feel).
  'windows-10': [
    'M4 5h6.5v6H4Z',
    'M13.5 5h6.5v6h-6.5Z',
    'M4 13h6.5v6H4Z',
    'M13.5 13h6.5v6h-6.5Z',
  ],
  // Windows 11: four panes, taller/upright with rounded corners (modern feel).
  'windows-11': [
    'M5.5 3.5h4a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1v-5a1 1 0 0 1 1-1Z',
    'M14.5 3.5h4a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1v-5a1 1 0 0 1 1-1Z',
    'M5.5 12.5h4a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1v-5a1 1 0 0 1 1-1Z',
    'M14.5 12.5h4a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1v-5a1 1 0 0 1 1-1Z',
  ],

  // Browser level -----------------------------------------------------------
  // Generic browser wheel: outer rim, hub, three spokes 120 deg apart.
  chrome: [
    'M3 12a9 9 0 1 0 18 0 9 9 0 1 0-18 0Z',
    'M8.5 12a3.5 3.5 0 1 0 7 0 3.5 3.5 0 1 0-7 0Z',
    'M12 15.5V21',
    'M9 10.3 4.2 7.5',
    'M15 10.3 19.8 7.5',
  ],
  // Swirl / arc ring.
  edge: [
    'M4.5 15a8.5 8.5 0 1 1 15.5-3',
    'M20 12c-1 4-5 7-9 6-3-1-5-4-4-7 1-2 4-2 5 0',
  ],

  // Hardware controls -------------------------------------------------------
  // Graphics card: board, fan circle with hub, chip lines, bottom pins.
  gpu: [
    'M3 6h18v9H3Z',
    'M6 10.5a3 3 0 1 0 6 0 3 3 0 1 0-6 0Z',
    'M9 10.5h.01',
    'M15 9h4M15 12h4',
    'M6 15v3m4-3v3m4-3v3',
  ],
  // CPU: chip body, inner die, pins on all four sides.
  cpu: 'M6 6h12v12H6ZM9 9h6v6H9ZM9 6V3m3 3V3m3 3V3M9 18v3m3-3v3m3-3v3M6 9H3m3 3H3m3 3H3M18 9h3m-3 3h3m-3 3h3',
  // RAM: module board, chip divisions, contact pins with a center notch gap.
  ram: 'M3 7h18v8H3ZM7 7v4m4-4v4m4-4v4M4 15v3M6 15v3M8 15v3M10 15v3M14 15v3M16 15v3M18 15v3M20 15v3',
  // Disk: storage cylinder (top cap ellipse + body).
  disk: ['M5 7a7 3 0 1 0 14 0 7 3 0 1 0-14 0Z', 'M5 7v10a7 3 0 0 1 14 0V7'],
  // Monitor: display with pedestal stand.
  monitor: 'M3 5h18v11H3ZM8 20h8M12 16v4',
  // Touch: index finger / hand tapping a surface.
  touch: [
    'M10 12V5.5a2 2 0 0 1 4 0V12',
    'M8 12h8v4a3 3 0 0 1-3 3h-2a3 3 0 0 1-3-3Z',
    'M5 21h14',
  ],
  // Timezone: globe with equator and curved meridians.
  timezone: 'M3 12a9 9 0 1 0 18 0 9 9 0 1 0-18 0ZM3 12h18M12 3v18M7 12a5 9 0 1 0 10 0 5 9 0 1 0-10 0Z',
  // Region: map pin with a centred dot.
  region: ['M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11Z', 'M9.5 10a2.5 2.5 0 1 0 5 0 2.5 2.5 0 1 0-5 0Z'],
  // HTTP headers: request lines with a pointer arrow.
  headers: ['M4 6h16M4 12h9M4 18h16', 'M16.5 9.5l3 2.5-3 2.5'],
  // Fonts: uppercase A with crossbar sitting on a baseline.
  fonts: 'M7.5 19 12 5l4.5 14M9.5 13.5h5M5 21h14',
  // Randomize: two crossing shuffle arrows.
  randomize: 'M3 7h4l10 10h3M3 17h4l10-10h3M17 14l3 3-3 3M17 4l3 3-3 3',

  // Generic + actions -------------------------------------------------------
  // Generic device: PC tower with drive bays and a power button.
  device: 'M6 3h12v18H6ZM9 6h6M9 8.5h6M10.5 16a1.5 1.5 0 1 0 3 0 1.5 1.5 0 1 0-3 0Z',
  // Reset: circular refresh arrow.
  reset: ['M21 12a9 9 0 1 1-9-9c2.5 0 4.9 1 6.7 2.7L21 8', 'M21 3v5h-5'],
});
