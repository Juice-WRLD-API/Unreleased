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
  // maximize / close and the downloads trigger). Absent on the built-in skins,
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

// Fallback to classic dark for unknown ids (e.g. a persisted value from a
// build where a skin was renamed/removed, or a deleted custom skin).
export function getSkin(id: string | null | undefined): Skin {
  return SKINS.find((s) => s.id === id) ?? _customSkins.find((s) => s.id === id) ?? SKINS[1]
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
function isColor(value: unknown): value is string {
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
