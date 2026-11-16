// The game's icons: one hand-drawn set on a 24 by 24 grid, all in the same 2px round line, so they sit with the
// type instead of beside it the way emoji do. Each entry is the inside of an <svg>; icon() wraps it.
export const ICONS = {
  // controls
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"/>',
  swords: '<path d="M5 19 19 5M19 5h-5M19 5v5M5 5l14 14M5 5h5M5 5v5"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  rain: '<path d="M7 15a4 4 0 0 1 .5-8 5.5 5.5 0 0 1 10.6 1.5A3.4 3.4 0 0 1 17.5 15z"/><path d="M8 18v3M12 18v3M16 18v3"/>',
  pencil: '<path d="M4 20l1-4L16 5l3 3L8 19zM14 7l3 3"/>',
  left: '<path d="M15 5l-7 7 7 7"/>',
  right: '<path d="M9 5l7 7-7 7"/>',
  up: '<path d="M5 15l7-7 7 7"/>',
  down: '<path d="M5 9l7 7 7-7"/>',
  zap: '<path d="M13 2 5 13h6l-1 9 8-11h-6z"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  // the skill tree
  reach: '<path d="M3 12h18M17 8l4 4-4 4M3 8v8"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  lamp: '<path d="M4 9h6l4-3v12l-4-3H4zM18 9l3-1M18 12h3M18 15l3 1"/>',
  rocket: '<path d="M12 3c4 2 6 6 6 10l-3 3H9l-3-3c0-4 2-8 6-10zM9 16l-2 5 5-2 5 2-2-5"/><circle cx="12" cy="10" r="2"/>',
  feather: '<path d="M20 4c-8 0-13 5-13 12v4M7 16c6 0 10-3 13-12M7 12h6"/>',
  wing: '<path d="M3 15c6-1 12-4 18-9v4c-5 5-11 7-18 8zM3 21h18"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>',
  snow: '<path d="M12 2v20M3.3 7l17.4 10M3.3 17 20.7 7"/>',
  chip: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/>',
  bigchip: '<rect x="6" y="6" width="12" height="12" rx="2"/><rect x="9.5" y="9.5" width="5" height="5"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/>',
  magnet: '<path d="M6 4v8a6 6 0 0 0 12 0V4h-4v8a2 2 0 0 1-4 0V4zM6 8h4M14 8h4"/>',
  flag: '<path d="M5 21V4M5 4h13l-3 4 3 4H5"/>',
  flags: '<path d="M4 21V5M4 5h8l-2 3 2 3H4M14 21V9M14 9h7l-2 2.5 2 2.5h-7"/>',
  wide: '<path d="M3 12h18M7 8l-4 4 4 4M17 8l4 4-4 4"/>',
  mountain: '<path d="M2 20l7-12 4 6 3-4 6 10z"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>',
  warning: '<path d="M12 3 2 20h20zM12 10v5M12 17.5v.5"/>',
  buoy: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><path d="M5.6 5.6l3.6 3.6M14.8 14.8l3.6 3.6M18.4 5.6l-3.6 3.6M9.2 14.8l-3.6 3.6"/>',
  cog: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/>',
  stop: '<path d="M8 3h8l5 5v8l-5 5H8l-5-5V8zM8 12h8"/>',
  wind: '<path d="M3 8h10a3 3 0 1 0-3-3M3 12h15a3 3 0 1 1-3 3M3 16h7"/>',
  drop: '<path d="M12 3c4 5 6 8 6 11a6 6 0 0 1-12 0c0-3 2-6 6-11z"/>',
  notes: '<path d="M5 21V11a6 6 0 0 1 6-6h8M15 1l4 4-4 4"/>',
  narrow: '<path d="M9 3v18M15 3v18M2 12h5M4 9l3 3-3 3M22 12h-5M20 9l-3 3 3 3"/>',
  leaf: '<path d="M5 19c0-9 5-14 15-14 0 10-5 15-14 15M5 19l8-8"/>',
  // badges
  medal: '<circle cx="12" cy="15" r="5"/><path d="M8 3l4 7 4-7"/>',
  sparkle: '<path d="M11 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
  trophy: '<path d="M7 4h10v5a5 5 0 0 1-10 0zM7 6H4c0 3 1.5 4.5 3.5 5M17 6h3c0 3-1.5 4.5-3.5 5M12 14v4M8 21h8M9 18h6"/>',
  crown: '<path d="M3 18 5 8l4 5 3-7 3 7 4-5 2 10z"/>',
  calendar: '<rect x="4" y="5" width="16" height="16" rx="2"/><path d="M4 10h16M8 3v4M16 3v4"/>',
  wheel: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2"/><path d="M12 14v7M10.2 11.2 3.5 9M13.8 11.2 20.5 9"/>',
  cap: '<path d="M2 9l10-5 10 5-10 5zM6 11.5V16c2 2 10 2 12 0v-4.5"/>',
  tree: '<path d="M12 22v-6M12 16c-4 0-7-2.5-7-6s3-7 7-7 7 3.5 7 7-3 6-7 6z"/>',
  flame: '<path d="M12 3c1 3 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-6 1-9z"/>',
  repeat: '<path d="M4 11V9a3 3 0 0 1 3-3h11M15 3l3 3-3 3M20 13v2a3 3 0 0 1-3 3H6M9 21l-3-3 3-3"/>',
  megaphone: '<path d="M3 10v4h3l8 5V5l-8 5zM18 9a4 4 0 0 1 0 6"/>',
  flask: '<path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3M7.5 15h9"/>',
} as const

export type IconName = keyof typeof ICONS

// An icon as markup, sized by the text around it (1em)
export const icon = (name: IconName) => '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">' + ICONS[name] + '</svg>'
