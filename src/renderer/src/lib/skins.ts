// Skin registry - the single source of truth for every selectable look.
// Each skin owns the full CSS-variable palette that index.css establishes for
// the classic light/dark themes; App.tsx writes `vars` onto <html> whenever
// the active skin changes (inline vars win over the :root/.dark fallbacks,
// which remain only for first paint before React mounts). Adding a skin here
// is all it takes for it to show up in Settings → Appearance.

// Built-in skin ids are a closed set; user-created skins get generated string
// ids (see newSkinId). The `(string & {})` arm keeps autocomplete for the
// built-ins while still accepting any custom id where a SkinId is expected.
export type BuiltinSkinId =
  | 'light'
  | 'dark'
  | 'midnight'
  | 'ocean'
  | 'ember'
  | 'mocha'
  | 'forest'
  | 'blossom'
  | 'song'
  | 'glass-dark'
  | 'glass-light'
  | 'aurora'
  | 'neon'
  | '999'
  | 'graphite'
  | 'retro'
  | 'paper'
  | 'arctic'
  | 'mint'
  | 'lavender'
  | 'phosphor'
  | 'cosmos'
  | 'moss'
  | 'sunset'
  | 'steel'
  | 'lagoon'
  | 'solar'
  | 'peach'
  | 'sunshine'
  | 'sage'
  | 'mist'

// eslint-disable-next-line @typescript-eslint/ban-types
export type SkinId = BuiltinSkinId | (string & {})

export interface SkinVars {
  '--surface': string
  '--surface-raised': string
  '--surface-overlay': string
  '--surface-highest': string
  '--sidebar': string
  '--titlebar': string
  '--text-primary': string
  '--text-secondary': string
  '--text-muted': string
  '--border': string
  '--scrollbar': string
  // Optional overrides for the frameless-window title-bar cluster (minimize /
  // maximize / close). Absent on the built-in skins,
  // which inherit --text-muted (idle) / --text-primary (hover) via CSS var
  // fallback - see WindowControls. A custom skin can set these to make the
  // window controls legible on a title bar where muted text is too faint.
  '--titlebar-icon'?: string
  '--titlebar-icon-hover'?: string
}

export interface Skin {
  id: SkinId
  name: string
  // Whether the `.dark` class goes on <html> - drives Tailwind `dark:`
  // variants and the CSS `color-scheme` (native controls, scrollbars).
  dark: boolean
  // Signature accent applied via setAccentColor when the skin is picked.
  // The classic light/dark skins leave it unset so switching between them
  // keeps whatever accent the user already chose.
  accent?: string
  // Dynamic skins derive their palette at runtime (from the current song's
  // cover art - see useThemeEffects); `vars` is only the fallback shown while
  // nothing is playing or extraction fails.
  dynamic?: boolean
  // User-created (built in the in-app skin editor / imported). Custom skins
  // live in the store's `customSkins`, not this hardcoded registry, and are
  // editable, deletable, and exportable - see lib/skins helpers below.
  custom?: boolean
  vars: SkinVars
}

// The palette variables in edit order, with UI labels/hints - the single
// source the skin editor iterates over and importer validates against, so a
// new variable only has to be added here (and to SkinVars) once.
export const SKIN_VAR_META: { key: keyof SkinVars; label: string; hint: string }[] = [
  { key: '--surface', label: 'Background', hint: 'Main app background' },
  { key: '--surface-raised', label: 'Raised surface', hint: 'Cards, rows, panels' },
  { key: '--surface-overlay', label: 'Overlay', hint: 'Hover / menus' },
  { key: '--surface-highest', label: 'Highest surface', hint: 'Active / pressed' },
  { key: '--sidebar', label: 'Sidebar', hint: 'Side navigation' },
  { key: '--titlebar', label: 'Title bar', hint: 'Window title strip' },
  { key: '--text-primary', label: 'Primary text', hint: 'Headings, main text' },
  { key: '--text-secondary', label: 'Secondary text', hint: 'Subtitles' },
  { key: '--text-muted', label: 'Muted text', hint: 'Hints, captions' },
  { key: '--border', label: 'Border', hint: 'Dividers, outlines' },
  { key: '--scrollbar', label: 'Scrollbar', hint: 'Scrollbar thumb' },
]

// Optional palette variables - editable in the skin editor but not required in
// a skin file (they fall back via CSS var() when unset). Kept apart from the
// core meta above so import validation only *requires* the core keys.
export const SKIN_OPTIONAL_VAR_META: { key: keyof SkinVars; label: string; hint: string }[] = [
  { key: '--titlebar-icon', label: 'Title-bar icons', hint: 'Min / max / close, downloads' },
  { key: '--titlebar-icon-hover', label: 'Title-bar icons (hover)', hint: 'Hover state of those icons' },
]

export const SKIN_OPTIONAL_VAR_KEYS = SKIN_OPTIONAL_VAR_META.map((m) => m.key)

export const SKINS: Skin[] = [
  {
    id: 'light',
    name: 'Light',
    dark: false,
    vars: {
      '--surface': '#ffffff',
      '--surface-raised': '#f5f5f5',
      '--surface-overlay': '#ebebeb',
      '--surface-highest': '#e0e0e0',
      '--sidebar': '#f0f0f0',
      '--titlebar': '#e8e8e8',
      '--text-primary': '#121212',
      '--text-secondary': '#535353',
      '--text-muted': '#6b6b6b',
      '--border': 'rgba(0, 0, 0, 0.08)',
      '--scrollbar': '#cccccc',
    },
  },
  {
    id: 'dark',
    name: 'Dark',
    dark: true,
    vars: {
      '--surface': '#121212',
      '--surface-raised': '#1a1a1a',
      '--surface-overlay': '#242424',
      '--surface-highest': '#2a2a2a',
      '--sidebar': '#000000',
      '--titlebar': '#000000',
      '--text-primary': '#ffffff',
      '--text-secondary': '#b3b3b3',
      '--text-muted': '#6b6b6b',
      '--border': 'rgba(255, 255, 255, 0.08)',
      '--scrollbar': '#404040',
    },
  },
  {
    id: 'midnight',
    name: 'Midnight',
    dark: true,
    accent: '#f43f5e',
    vars: {
      '--surface': '#000000',
      '--surface-raised': '#0b0b0b',
      '--surface-overlay': '#161616',
      '--surface-highest': '#1f1f1f',
      '--sidebar': '#000000',
      '--titlebar': '#000000',
      '--text-primary': '#ffffff',
      '--text-secondary': '#a3a3a3',
      '--text-muted': '#636363',
      '--border': 'rgba(255, 255, 255, 0.1)',
      '--scrollbar': '#333333',
    },
  },
  {
    id: 'ocean',
    name: 'Ocean',
    dark: true,
    accent: '#38bdf8',
    vars: {
      '--surface': '#0c1425',
      '--surface-raised': '#121d33',
      '--surface-overlay': '#1b2a49',
      '--surface-highest': '#24365c',
      '--sidebar': '#060b16',
      '--titlebar': '#060b16',
      '--text-primary': '#e8eefc',
      '--text-secondary': '#9fb3d1',
      '--text-muted': '#64748b',
      '--border': 'rgba(148, 163, 184, 0.14)',
      '--scrollbar': '#2b3d5f',
    },
  },
  {
    id: 'ember',
    name: 'Ember',
    dark: true,
    accent: '#f97316',
    vars: {
      '--surface': '#1c1210',
      '--surface-raised': '#251a16',
      '--surface-overlay': '#31221c',
      '--surface-highest': '#3d2a22',
      '--sidebar': '#140c0a',
      '--titlebar': '#140c0a',
      '--text-primary': '#fdf2ec',
      '--text-secondary': '#d3b8a8',
      '--text-muted': '#8a6f61',
      '--border': 'rgba(255, 180, 120, 0.12)',
      '--scrollbar': '#4a352b',
    },
  },
  {
    id: 'mocha',
    name: 'Mocha',
    dark: true,
    accent: '#cba6f7',
    vars: {
      '--surface': '#1e1e2e',
      '--surface-raised': '#26263a',
      '--surface-overlay': '#313244',
      '--surface-highest': '#3b3b54',
      '--sidebar': '#161623',
      '--titlebar': '#161623',
      '--text-primary': '#cdd6f4',
      '--text-secondary': '#a6adc8',
      '--text-muted': '#6c7086',
      '--border': 'rgba(205, 214, 244, 0.1)',
      '--scrollbar': '#45475a',
    },
  },
  {
    id: 'forest',
    name: 'Forest',
    dark: true,
    accent: '#10b981',
    vars: {
      '--surface': '#0e1613',
      '--surface-raised': '#14201b',
      '--surface-overlay': '#1b2b24',
      '--surface-highest': '#23372e',
      '--sidebar': '#0a110e',
      '--titlebar': '#0a110e',
      '--text-primary': '#e7f3ec',
      '--text-secondary': '#a8c3b4',
      '--text-muted': '#64796d',
      '--border': 'rgba(167, 243, 208, 0.1)',
      '--scrollbar': '#2c4437',
    },
  },
  {
    // Cool arctic slate with a frost-blue accent.
    id: 'aurora',
    name: 'Aurora',
    dark: true,
    accent: '#88c0d0',
    vars: {
      '--surface': '#2e3440',
      '--surface-raised': '#343a48',
      '--surface-overlay': '#3b4252',
      '--surface-highest': '#434c5e',
      '--sidebar': '#272c36',
      '--titlebar': '#272c36',
      '--text-primary': '#eceff4',
      '--text-secondary': '#c0c8d6',
      '--text-muted': '#97a3b8',
      '--border': 'rgba(216, 222, 233, 0.1)',
      '--scrollbar': '#4c566a',
    },
  },
  {
    // Deep synthwave purple with a hot-pink accent.
    id: 'neon',
    name: 'Neon',
    dark: true,
    accent: '#f472b6',
    vars: {
      '--surface': '#120b1f',
      '--surface-raised': '#1a1030',
      '--surface-overlay': '#24173f',
      '--surface-highest': '#2e1e50',
      '--sidebar': '#0c0716',
      '--titlebar': '#0c0716',
      '--text-primary': '#f5ecff',
      '--text-secondary': '#c4b2e0',
      '--text-muted': '#8a78a8',
      '--border': 'rgba(240, 171, 252, 0.12)',
      '--scrollbar': '#3b2763',
    },
  },
  {
    // Near-black with red-tinted surfaces and a true red accent.
    id: '999',
    name: '999',
    dark: true,
    accent: '#e11d2e',
    vars: {
      '--surface': '#0f0a0a',
      '--surface-raised': '#181010',
      '--surface-overlay': '#231616',
      '--surface-highest': '#2d1c1c',
      '--sidebar': '#090606',
      '--titlebar': '#090606',
      '--text-primary': '#fbeeee',
      '--text-secondary': '#c9a9a9',
      '--text-muted': '#957575',
      '--border': 'rgba(255, 90, 90, 0.12)',
      '--scrollbar': '#3f2626',
    },
  },
  {
    // Neutral warm-gray dark with a teal accent.
    id: 'graphite',
    name: 'Graphite',
    dark: true,
    accent: '#2dd4bf',
    vars: {
      '--surface': '#1b1c1e',
      '--surface-raised': '#222326',
      '--surface-overlay': '#2b2d30',
      '--surface-highest': '#34363a',
      '--sidebar': '#141517',
      '--titlebar': '#141517',
      '--text-primary': '#ececec',
      '--text-secondary': '#b4b6ba',
      '--text-muted': '#868990',
      '--border': 'rgba(255, 255, 255, 0.09)',
      '--scrollbar': '#44474c',
    },
  },
  {
    // Earthy retro brown-gray with cream text and a gold accent.
    id: 'retro',
    name: 'Retro',
    dark: true,
    accent: '#fabd2f',
    vars: {
      '--surface': '#282828',
      '--surface-raised': '#32302f',
      '--surface-overlay': '#3c3836',
      '--surface-highest': '#504945',
      '--sidebar': '#1d2021',
      '--titlebar': '#1d2021',
      '--text-primary': '#ebdbb2',
      '--text-secondary': '#d5c4a1',
      '--text-muted': '#a89984',
      '--border': 'rgba(235, 219, 178, 0.1)',
      '--scrollbar': '#504945',
    },
  },
  {
    // Old-terminal black-green with a phosphor-green accent.
    id: 'phosphor',
    name: 'Phosphor',
    dark: true,
    accent: '#22c55e',
    vars: {
      '--surface': '#050a06',
      '--surface-raised': '#0b130d',
      '--surface-overlay': '#121d15',
      '--surface-highest': '#1a281d',
      '--sidebar': '#020502',
      '--titlebar': '#020502',
      '--text-primary': '#dcf5e1',
      '--text-secondary': '#9cc9a5',
      '--text-muted': '#5f8a68',
      '--border': 'rgba(74, 222, 128, 0.12)',
      '--scrollbar': '#24392a',
    },
  },
  {
    // Blue-violet night sky with a periwinkle accent.
    id: 'cosmos',
    name: 'Cosmos',
    dark: true,
    accent: '#818cf8',
    vars: {
      '--surface': '#0d0e1c',
      '--surface-raised': '#141528',
      '--surface-overlay': '#1d1f36',
      '--surface-highest': '#262945',
      '--sidebar': '#080913',
      '--titlebar': '#080913',
      '--text-primary': '#eceeff',
      '--text-secondary': '#b3b6d8',
      '--text-muted': '#7b7fa6',
      '--border': 'rgba(165, 180, 252, 0.12)',
      '--scrollbar': '#2f3354',
    },
  },
  {
    // Dark olive with a lime accent.
    id: 'moss',
    name: 'Moss',
    dark: true,
    accent: '#a3e635',
    vars: {
      '--surface': '#16170f',
      '--surface-raised': '#1e2015',
      '--surface-overlay': '#282a1c',
      '--surface-highest': '#323524',
      '--sidebar': '#10110a',
      '--titlebar': '#10110a',
      '--text-primary': '#f0f2e4',
      '--text-secondary': '#bfc4a3',
      '--text-muted': '#7f8466',
      '--border': 'rgba(217, 249, 157, 0.1)',
      '--scrollbar': '#3c402b',
    },
  },
  {
    // Dark plum with a coral accent.
    id: 'sunset',
    name: 'Sunset',
    dark: true,
    accent: '#fb7185',
    vars: {
      '--surface': '#1d1218',
      '--surface-raised': '#271820',
      '--surface-overlay': '#32202a',
      '--surface-highest': '#3e2834',
      '--sidebar': '#150c11',
      '--titlebar': '#150c11',
      '--text-primary': '#fcecf1',
      '--text-secondary': '#d1b3bf',
      '--text-muted': '#9a7a87',
      '--border': 'rgba(253, 164, 175, 0.12)',
      '--scrollbar': '#4a3040',
    },
  },
  {
    // Cool blue-gray with a bright blue accent.
    id: 'steel',
    name: 'Steel',
    dark: true,
    accent: '#58a6ff',
    vars: {
      '--surface': '#0f1318',
      '--surface-raised': '#161b22',
      '--surface-overlay': '#1f262f',
      '--surface-highest': '#28303b',
      '--sidebar': '#0a0d11',
      '--titlebar': '#0a0d11',
      '--text-primary': '#e6edf3',
      '--text-secondary': '#b7c0cc',
      '--text-muted': '#7d8794',
      '--border': 'rgba(201, 209, 217, 0.1)',
      '--scrollbar': '#323b47',
    },
  },
  {
    // Deep teal water with an aqua accent.
    id: 'lagoon',
    name: 'Lagoon',
    dark: true,
    accent: '#22d3ee',
    vars: {
      '--surface': '#0a1a1d',
      '--surface-raised': '#102428',
      '--surface-overlay': '#172f34',
      '--surface-highest': '#1f3b41',
      '--sidebar': '#061215',
      '--titlebar': '#061215',
      '--text-primary': '#e3f7f9',
      '--text-secondary': '#a8cdd1',
      '--text-muted': '#6c9196',
      '--border': 'rgba(103, 232, 249, 0.12)',
      '--scrollbar': '#27484e',
    },
  },
  {
    // Palette is generated from the current song's cover art at runtime;
    // these vars are the resting state (classic dark) shown while nothing is
    // playing or when the art can't be sampled.
    id: 'song',
    name: 'Now Playing',
    dark: true,
    dynamic: true,
    vars: {
      '--surface': '#121212',
      '--surface-raised': '#1a1a1a',
      '--surface-overlay': '#242424',
      '--surface-highest': '#2a2a2a',
      '--sidebar': '#000000',
      '--titlebar': '#000000',
      '--text-primary': '#ffffff',
      '--text-secondary': '#b3b3b3',
      '--text-muted': '#6b6b6b',
      '--border': 'rgba(255, 255, 255, 0.08)',
      '--scrollbar': '#404040',
    },
  },
  {
    id: 'blossom',
    name: 'Blossom',
    dark: false,
    accent: '#ec4899',
    vars: {
      '--surface': '#fdf3f6',
      '--surface-raised': '#f9e8ee',
      '--surface-overlay': '#f3dce5',
      '--surface-highest': '#eccfdb',
      '--sidebar': '#f7e5eb',
      '--titlebar': '#f3dee6',
      '--text-primary': '#3b1226',
      '--text-secondary': '#815b6b',
      '--text-muted': '#a17f8d',
      '--border': 'rgba(190, 24, 93, 0.12)',
      '--scrollbar': '#e3bfcd',
    },
  },
  {
    // Warm off-white paper with a burnt-orange accent.
    id: 'paper',
    name: 'Paper',
    dark: false,
    accent: '#c2410c',
    vars: {
      '--surface': '#faf6ee',
      '--surface-raised': '#f3ecdf',
      '--surface-overlay': '#ebe2d1',
      '--surface-highest': '#e1d5c0',
      '--sidebar': '#f1e9da',
      '--titlebar': '#ece3d2',
      '--text-primary': '#2b2118',
      '--text-secondary': '#5e4f40',
      '--text-muted': '#7a6a58',
      '--border': 'rgba(90, 60, 30, 0.12)',
      '--scrollbar': '#d6c8af',
    },
  },
  {
    // Cool icy light with a sky-blue accent.
    id: 'arctic',
    name: 'Arctic',
    dark: false,
    accent: '#0284c7',
    vars: {
      '--surface': '#f7fafc',
      '--surface-raised': '#edf3f8',
      '--surface-overlay': '#e2ebf3',
      '--surface-highest': '#d4e0eb',
      '--sidebar': '#eaf1f7',
      '--titlebar': '#e4edf5',
      '--text-primary': '#0f1b2a',
      '--text-secondary': '#42556b',
      '--text-muted': '#5f7186',
      '--border': 'rgba(15, 40, 70, 0.1)',
      '--scrollbar': '#c3d2e0',
    },
  },
  {
    // Soft green-tinted light with an emerald accent.
    id: 'mint',
    name: 'Mint',
    dark: false,
    accent: '#059669',
    vars: {
      '--surface': '#f5fbf8',
      '--surface-raised': '#eaf5ef',
      '--surface-overlay': '#ddefe5',
      '--surface-highest': '#cde5d8',
      '--sidebar': '#e6f3ec',
      '--titlebar': '#e0efe7',
      '--text-primary': '#0f2a1e',
      '--text-secondary': '#3f5f50',
      '--text-muted': '#56736a',
      '--border': 'rgba(6, 95, 70, 0.12)',
      '--scrollbar': '#bcd9c9',
    },
  },
  {
    // Pale violet light with a violet accent.
    id: 'lavender',
    name: 'Lavender',
    dark: false,
    accent: '#7c3aed',
    vars: {
      '--surface': '#f9f7fe',
      '--surface-raised': '#f1edfc',
      '--surface-overlay': '#e7e0f9',
      '--surface-highest': '#dcd2f4',
      '--sidebar': '#efeafb',
      '--titlebar': '#e9e3f8',
      '--text-primary': '#1f1537',
      '--text-secondary': '#54497a',
      '--text-muted': '#6e6590',
      '--border': 'rgba(91, 33, 182, 0.12)',
      '--scrollbar': '#d2c7ef',
    },
  },
  {
    // Warm cream with a calm blue accent.
    id: 'solar',
    name: 'Solar',
    dark: false,
    accent: '#1f78b8',
    vars: {
      '--surface': '#fdf6e3',
      '--surface-raised': '#f5eed6',
      '--surface-overlay': '#ece4c9',
      '--surface-highest': '#e2d9bb',
      '--sidebar': '#f3ebd2',
      '--titlebar': '#eee5ca',
      '--text-primary': '#073642',
      '--text-secondary': '#4f5f66',
      '--text-muted': '#5b6f77',
      '--border': 'rgba(88, 110, 117, 0.16)',
      '--scrollbar': '#d6cca9',
    },
  },
  {
    // Soft peach with a rose-red accent.
    id: 'peach',
    name: 'Peach',
    dark: false,
    accent: '#d63a52',
    vars: {
      '--surface': '#fff6f1',
      '--surface-raised': '#fdebe2',
      '--surface-overlay': '#f8dfd3',
      '--surface-highest': '#f1d1c2',
      '--sidebar': '#fbe8de',
      '--titlebar': '#f8e2d6',
      '--text-primary': '#331d17',
      '--text-secondary': '#5e463d',
      '--text-muted': '#86675b',
      '--border': 'rgba(154, 52, 18, 0.12)',
      '--scrollbar': '#ecc6b4',
    },
  },
  {
    // Pale buttery yellow with an amber accent.
    id: 'sunshine',
    name: 'Sunshine',
    dark: false,
    accent: '#b45309',
    vars: {
      '--surface': '#fffbeb',
      '--surface-raised': '#fdf3d3',
      '--surface-overlay': '#f8eabf',
      '--surface-highest': '#f1dea8',
      '--sidebar': '#fcf1cd',
      '--titlebar': '#f9ecc2',
      '--text-primary': '#2e2410',
      '--text-secondary': '#5a4b26',
      '--text-muted': '#7c6a3c',
      '--border': 'rgba(146, 64, 14, 0.12)',
      '--scrollbar': '#e8d69c',
    },
  },
  {
    // Muted gray-green with an olive accent.
    id: 'sage',
    name: 'Sage',
    dark: false,
    accent: '#4d7c0f',
    vars: {
      '--surface': '#f4f6f1',
      '--surface-raised': '#e9eee4',
      '--surface-overlay': '#dee5d7',
      '--surface-highest': '#d1dac8',
      '--sidebar': '#e7ece1',
      '--titlebar': '#e1e7da',
      '--text-primary': '#1c2418',
      '--text-secondary': '#45513f',
      '--text-muted': '#62705a',
      '--border': 'rgba(63, 98, 18, 0.12)',
      '--scrollbar': '#c3cfb6',
    },
  },
  {
    // Neutral cool gray with a deep teal accent.
    id: 'mist',
    name: 'Mist',
    dark: false,
    accent: '#0f766e',
    vars: {
      '--surface': '#f5f6f8',
      '--surface-raised': '#eceef2',
      '--surface-overlay': '#e1e4ea',
      '--surface-highest': '#d4d8e0',
      '--sidebar': '#eaecf0',
      '--titlebar': '#e4e7ec',
      '--text-primary': '#16191f',
      '--text-secondary': '#454b56',
      '--text-muted': '#646b78',
      '--border': 'rgba(30, 41, 59, 0.1)',
      '--scrollbar': '#c5cad3',
    },
  },
  {
    // iOS system colors: true black with the grouped grays for raised
    // surfaces, and the music-app red accent. The black lets the frosted
    // player and panels read most clearly.
    id: 'glass-dark',
    name: 'Glass Dark',
    dark: true,
    accent: '#fa2d48',
    vars: {
      '--surface': '#000000',
      '--surface-raised': '#1c1c1e',
      '--surface-overlay': '#2c2c2e',
      '--surface-highest': '#3a3a3c',
      '--sidebar': '#000000',
      '--titlebar': '#000000',
      '--text-primary': '#ffffff',
      '--text-secondary': '#aeaeb2',
      '--text-muted': '#8e8e93',
      '--border': 'rgba(84, 84, 88, 0.6)',
      '--scrollbar': '#3a3a3c',
    },
  },
  {
    // Light counterpart. Muted text is #6e6e73 rather than iOS's #8e8e93,
    // which misses 4.5:1 on white at caption sizes.
    id: 'glass-light',
    name: 'Glass Light',
    dark: false,
    accent: '#fa2d48',
    vars: {
      '--surface': '#ffffff',
      '--surface-raised': '#f2f2f7',
      '--surface-overlay': '#e9e9eb',
      '--surface-highest': '#d1d1d6',
      '--sidebar': '#f2f2f7',
      '--titlebar': '#f2f2f7',
      '--text-primary': '#000000',
      '--text-secondary': '#3c3c43',
      '--text-muted': '#6e6e73',
      '--border': 'rgba(60, 60, 67, 0.29)',
      '--scrollbar': '#c7c7cc',
    },
  },
]

// ── Custom-skin cache ─────────────────────────────────────────────────────────
// User-created skins live in the Zustand store (persisted to localStorage), but
// getSkin() is a pure lookup called from places that can't reach the store -
// the store's own `theme` initializer, and songToTrack-style module code. So the
// store mirrors its `customSkins` array into this module cache on every write
// (setCustomSkinsCache), exactly like lib/songPrefs. Seed it before the store's
// `theme` initializer runs so a persisted custom skin resolves on first paint.
let _customSkins: Skin[] = []

export function setCustomSkinsCache(skins: Skin[]): void {
  _customSkins = skins
}

/** Built-in skins followed by the user's custom skins - the full pick list. */
export function allSkins(): Skin[] {
  return [...SKINS, ..._customSkins]
}

// The skin a new install starts on, and what unknown or deleted ids fall back
// to. Its resting palette is classic dark, which matches the first paint.
export const DEFAULT_SKIN_ID: BuiltinSkinId = 'song'

// Fallback to the default skin for unknown ids (e.g. a persisted value from a
// build where a skin was renamed/removed, or a deleted custom skin).
export function getSkin(id: string | null | undefined): Skin {
  return (
    SKINS.find((s) => s.id === id) ??
    _customSkins.find((s) => s.id === id) ??
    SKINS.find((s) => s.id === DEFAULT_SKIN_ID) ??
    SKINS[1]
  )
}

// ── Custom-skin authoring / import-export ─────────────────────────────────────

const SKIN_FILE_FORMAT = 'unreleased-skin'
const SKIN_FILE_VERSION = 1

// Generated id for a user skin - the `custom-` prefix keeps it clear of every
// built-in id, and the random suffix avoids collisions across quick creates.
export function newSkinId(): string {
  return `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

// Accepts the CSS color forms the palettes actually use - hex, rgb/rgba,
// hsl/hsla, and bare keywords - while rejecting anything long or structural, so
// an imported file can't smuggle arbitrary text into a style property.
export function isColor(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 64 &&
    /^(#[0-9a-fA-F]{3,8}|rgba?\([\d.,\s%]*\)|hsla?\([\d.,\s%deg]*\)|[a-zA-Z]+)$/.test(value.trim())
  )
}

/** A fresh editable skin cloned from `base` (defaults to classic dark). */
export function createCustomSkin(base: Skin = SKINS[1], name?: string): Skin {
  return {
    id: newSkinId(),
    name: (name ?? `${base.name} copy`).slice(0, 40),
    dark: base.dark,
    custom: true,
    accent: base.accent,
    // Never carry `dynamic` onto a custom skin - its vars are the real palette.
    vars: { ...base.vars },
  }
}

/** Serializes a skin to the text written to an exported `.json` file. */
export function skinToFileText(skin: Skin): string {
  return JSON.stringify(
    {
      format: SKIN_FILE_FORMAT,
      version: SKIN_FILE_VERSION,
      skin: { name: skin.name, dark: skin.dark, accent: skin.accent, vars: skin.vars },
    },
    null,
    2,
  )
}

/** A filesystem-safe base name for the exported file. */
export function skinFileName(skin: Skin): string {
  const base = skin.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return `${base || 'skin'}.jwskin.json`
}

/**
 * Parses (and validates) an exported skin file back into a fresh Skin with a
 * new id. Accepts either the wrapped `{ format, version, skin }` envelope or a
 * bare skin object. Returns null on anything malformed - every palette variable
 * must be present and a plausible color, so a bad file can't half-apply.
 */
export function parseSkinFile(text: string): Skin | null {
  let obj: unknown
  try {
    obj = JSON.parse(text)
  } catch {
    return null
  }
  if (!obj || typeof obj !== 'object') return null
  const wrapped = obj as { skin?: unknown }
  const src = (wrapped.skin && typeof wrapped.skin === 'object' ? wrapped.skin : obj) as {
    name?: unknown
    dark?: unknown
    accent?: unknown
    vars?: Record<string, unknown>
  }
  const vars = {} as SkinVars
  for (const { key } of SKIN_VAR_META) {
    const v = src.vars?.[key]
    if (!isColor(v)) return null
    vars[key] = v
  }
  // Optional vars only carry over when present and valid; a missing one just
  // stays unset (and inherits at render time).
  for (const key of SKIN_OPTIONAL_VAR_KEYS) {
    const v = src.vars?.[key]
    if (isColor(v)) vars[key] = v
  }
  const name =
    typeof src.name === 'string' && src.name.trim() ? src.name.trim().slice(0, 40) : 'Imported skin'
  return {
    id: newSkinId(),
    name,
    dark: !!src.dark,
    custom: true,
    accent: isColor(src.accent) ? src.accent : undefined,
    vars,
  }
}
