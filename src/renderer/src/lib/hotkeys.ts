/**
 * hotkeys.ts - the keyboard-shortcut registry and the pure helpers that turn a
 * KeyboardEvent into a canonical combo string (and back into a display label).
 *
 * The registry here is the single source of truth for *what* actions exist and
 * their default bindings. User overrides live in the store (`hotkeyBindings`,
 * an actionId → combo map) and are merged in via `effectiveBinding`. The actual
 * dispatch table - what each action *does* - lives in Player.tsx, keyed by the
 * same ids, because those handlers need the audio element and the live player
 * closures. Keeping definitions (here) and behavior (there) split lets the
 * Settings UI import the list without pulling the whole player in.
 *
 * Combo format: modifier tokens in a fixed order (Ctrl, Alt, Shift, Meta) then
 * the main key, joined by "+". Examples: "Space", "M", "Ctrl+ArrowRight",
 * "Ctrl+Shift+C", "Alt+1". A combo is layout-independent for letters/digits
 * (derived from `event.code`, so "A" is the physical A key regardless of the
 * active keyboard layout) while punctuation maps to its US-key symbol.
 */

export type HotkeyCategory = 'Playback' | 'Volume' | 'Navigation'

export interface HotkeyAction {
  id: string
  label: string
  category: HotkeyCategory
  /** Canonical combo, or '' for "no default binding". */
  defaultBinding: string
  /** Still active with its default binding for everyone, but only listed (and
   *  therefore rebindable) in Settings when Developer mode is on - keeps the
   *  shortcut list from bloating with power-user-only entries. */
  devModeOnly?: boolean
}

// Order here is the order shown in Settings (within each category block).
export const HOTKEY_ACTIONS: readonly HotkeyAction[] = [
  // ── Playback ──────────────────────────────────────────────────────────────
  { id: 'play-pause',       label: 'Play / pause',              category: 'Playback', defaultBinding: 'Space' },
  { id: 'play',             label: 'Play',                      category: 'Playback', defaultBinding: '' },
  { id: 'pause',            label: 'Pause',                     category: 'Playback', defaultBinding: '' },
  { id: 'next',             label: 'Next track',                category: 'Playback', defaultBinding: 'Ctrl+ArrowRight' },
  { id: 'previous',         label: 'Previous track',            category: 'Playback', defaultBinding: 'Ctrl+ArrowLeft' },
  { id: 'seek-forward',     label: 'Skip forward',              category: 'Playback', defaultBinding: 'Shift+ArrowRight' },
  { id: 'seek-backward',    label: 'Skip backward',             category: 'Playback', defaultBinding: 'Shift+ArrowLeft' },
  { id: 'speed-up',         label: 'Increase playback speed',   category: 'Playback', defaultBinding: ']' },
  { id: 'speed-down',       label: 'Decrease playback speed',   category: 'Playback', defaultBinding: '[' },
  { id: 'shuffle',          label: 'Toggle shuffle',            category: 'Playback', defaultBinding: 'S' },
  { id: 'loop',             label: 'Toggle loop / repeat',      category: 'Playback', defaultBinding: 'R' },
  { id: 'clear-queue',      label: 'Clear queue',               category: 'Playback', defaultBinding: 'Ctrl+Shift+C' },
  { id: 'like',             label: 'Like current song',         category: 'Playback', defaultBinding: 'L' },
  { id: 'song-info',        label: 'Show current song info',    category: 'Playback', defaultBinding: 'I' },
  { id: 'edit-song',        label: 'Edit current song',         category: 'Playback', defaultBinding: 'E' },
  { id: 'toggle-lyrics',    label: 'Toggle lyrics visibility',  category: 'Playback', defaultBinding: 'Shift+L' },
  { id: 'equalizer',        label: 'Toggle equalizer panel',    category: 'Playback', defaultBinding: 'Shift+E' },
  { id: 'ab-loop',          label: 'Set A-B loop point',        category: 'Playback', defaultBinding: '' },
  { id: 'crossfade',        label: 'Toggle crossfade',          category: 'Playback', defaultBinding: '' },
  { id: 'smooth-playback',  label: 'Toggle smooth playback',    category: 'Playback', defaultBinding: '' },
  { id: 'prefer-og',        label: 'Toggle prefer OG version',  category: 'Playback', defaultBinding: '' },
  { id: 'sleep-timer',      label: 'Start / stop sleep timer',  category: 'Playback', defaultBinding: '' },
  { id: 'seek-0',           label: 'Seek to 0%',                category: 'Playback', defaultBinding: '0' },
  { id: 'seek-10',          label: 'Seek to 10%',               category: 'Playback', defaultBinding: '1' },
  { id: 'seek-20',          label: 'Seek to 20%',               category: 'Playback', defaultBinding: '2' },
  { id: 'seek-30',          label: 'Seek to 30%',               category: 'Playback', defaultBinding: '3' },
  { id: 'seek-40',          label: 'Seek to 40%',               category: 'Playback', defaultBinding: '4' },
  { id: 'seek-50',          label: 'Seek to 50%',               category: 'Playback', defaultBinding: '5' },
  { id: 'seek-60',          label: 'Seek to 60%',               category: 'Playback', defaultBinding: '6' },
  { id: 'seek-70',          label: 'Seek to 70%',               category: 'Playback', defaultBinding: '7' },
  { id: 'seek-80',          label: 'Seek to 80%',               category: 'Playback', defaultBinding: '8' },
  { id: 'seek-90',          label: 'Seek to 90%',               category: 'Playback', defaultBinding: '9' },

  // ── Volume ────────────────────────────────────────────────────────────────
  { id: 'volume-up',        label: 'Volume up',                 category: 'Volume', defaultBinding: 'Ctrl+ArrowUp' },
  { id: 'volume-down',      label: 'Volume down',               category: 'Volume', defaultBinding: 'Ctrl+ArrowDown' },
  { id: 'mute',             label: 'Mute / unmute',             category: 'Volume', defaultBinding: 'M' },

  // ── Navigation ────────────────────────────────────────────────────────────
  { id: 'view-tracker',     label: 'Go to Tracker',             category: 'Navigation', defaultBinding: 'Alt+1' },
  { id: 'view-playlists',   label: 'Go to Playlists',           category: 'Navigation', defaultBinding: 'Alt+2' },
  { id: 'view-wrld',        label: 'Go to WRLD',                category: 'Navigation', defaultBinding: 'Alt+4' },
  { id: 'view-admin',       label: 'Go to Admin / Editor profile', category: 'Navigation', defaultBinding: 'Alt+5' },
  { id: 'open-settings',    label: 'Open settings',             category: 'Navigation', defaultBinding: 'Ctrl+,' },
  { id: 'open-diagnostics', label: 'Open diagnostics',          category: 'Navigation', defaultBinding: '' },
  { id: 'toggle-queue',     label: 'Toggle queue panel',        category: 'Navigation', defaultBinding: 'Q' },
  { id: 'focus-search',     label: 'Focus search box',          category: 'Navigation', defaultBinding: 'Ctrl+F' },
] as const

export const HOTKEY_CATEGORIES: readonly HotkeyCategory[] = ['Playback', 'Volume', 'Navigation']

// actionId → action, for O(1) lookups from both the dispatcher and the UI.
const ACTIONS_BY_ID = new Map(HOTKEY_ACTIONS.map((a) => [a.id, a]))

export function getAction(id: string): HotkeyAction | undefined {
  return ACTIONS_BY_ID.get(id)
}

/** The combo currently bound to `id`: the user override if one exists (an
 *  override of '' means the user deliberately cleared it), else the default. */
export function effectiveBinding(id: string, overrides: Record<string, string>): string {
  if (Object.prototype.hasOwnProperty.call(overrides, id)) return overrides[id]
  return ACTIONS_BY_ID.get(id)?.defaultBinding ?? ''
}

/** Reverse lookup: which action (if any) is bound to `combo`. Bindings are kept
 *  unique at write time (see the store's setHotkeyBinding), so first match wins. */
export function resolveAction(combo: string, overrides: Record<string, string>): string | null {
  if (!combo) return null
  for (const a of HOTKEY_ACTIONS) {
    if (effectiveBinding(a.id, overrides) === combo) return a.id
  }
  return null
}

// ─── Action dispatch bridge ─────────────────────────────────────────────────
// Player.tsx owns what each action *does* (those handlers need the audio
// element and the live player closures). UI outside the player - the app menu -
// triggers actions by id through this bridge instead of duplicating that logic,
// so a menu entry and its keyboard shortcut always run the exact same code.

let dispatchHotkeyAction: ((id: string) => void) | null = null

export function registerHotkeyDispatch(fn: (id: string) => void): () => void {
  dispatchHotkeyAction = fn
  return () => { if (dispatchHotkeyAction === fn) dispatchHotkeyAction = null }
}

/** Run a hotkey action by id. No-op until the Player has mounted and
 *  registered its dispatch table. */
export function runHotkeyAction(id: string): void {
  dispatchHotkeyAction?.(id)
}

// ─── Event → combo ─────────────────────────────────────────────────────────

const MODIFIER_CODES = new Set([
  'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight',
  'ShiftLeft', 'ShiftRight', 'MetaLeft', 'MetaRight',
])

// event.code → canonical key token for the punctuation / navigation keys that
// aren't letters or digits. Codes are physical-key based, so this stays correct
// regardless of keyboard layout and independent of the Shift state.
const CODE_KEY: Record<string, string> = {
  Space: 'Space',
  ArrowUp: 'ArrowUp', ArrowDown: 'ArrowDown', ArrowLeft: 'ArrowLeft', ArrowRight: 'ArrowRight',
  Comma: ',', Period: '.', Slash: '/', Semicolon: ';', Quote: "'",
  BracketLeft: '[', BracketRight: ']', Backslash: '\\', Minus: '-', Equal: '=', Backquote: '`',
  Enter: 'Enter', Backspace: 'Backspace', Delete: 'Delete', Insert: 'Insert', Tab: 'Tab',
  Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown',
}

/** The non-modifier "main key" of an event, or null if the event is a bare
 *  modifier press (or a key we don't support binding). */
function normalizeKey(e: KeyboardEvent): string | null {
  const code = e.code
  if (MODIFIER_CODES.has(code)) return null
  if (/^Key[A-Z]$/.test(code)) return code.slice(3)            // KeyA  → A
  if (/^Digit[0-9]$/.test(code)) return code.slice(5)          // Digit1 → 1
  if (/^Numpad[0-9]$/.test(code)) return 'Num' + code.slice(6) // Numpad1 → Num1
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(e.key)) return e.key     // F1..F24
  if (CODE_KEY[code]) return CODE_KEY[code]
  // Media keys carry no stable `code` across platforms - fall back to `key`.
  if (e.key && e.key.startsWith('Media')) return e.key
  return null
}

/** Turn a keydown into its canonical combo string, or null if it's just a
 *  modifier being held (or an unbindable key). Escape returns null on purpose:
 *  the recorder uses it to cancel, and it should never become a binding. */
export function eventToCombo(e: KeyboardEvent): string | null {
  if (e.key === 'Escape') return null
  const key = normalizeKey(e)
  if (!key) return null
  const parts: string[] = []
  if (e.ctrlKey) parts.push('Ctrl')
  if (e.altKey) parts.push('Alt')
  if (e.shiftKey) parts.push('Shift')
  if (e.metaKey) parts.push('Meta')
  parts.push(key)
  return parts.join('+')
}

// ─── Combo → display ─────────────────────────────────────────────────────────

const IS_MAC = typeof navigator !== 'undefined' &&
  /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent || '')

const DISPLAY: Record<string, string> = {
  Ctrl: IS_MAC ? '⌃' : 'Ctrl',
  Alt: IS_MAC ? '⌥' : 'Alt',
  Shift: IS_MAC ? '⇧' : 'Shift',
  Meta: IS_MAC ? '⌘' : 'Win',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  Space: 'Space', Enter: 'Enter', Backspace: '⌫', Delete: 'Del',
  MediaPlayPause: 'Play/Pause', MediaTrackNext: 'Next', MediaTrackPrevious: 'Prev', MediaStop: 'Stop',
}

/** Split a combo into display tokens for rendering as individual <kbd> chips.
 *  Returns [] for an empty/unbound combo. */
export function comboTokens(combo: string): string[] {
  if (!combo) return []
  return combo.split('+').map((p) => DISPLAY[p] ?? p)
}

// ─── Global (OS-wide) shortcuts ──────────────────────────────────────────────
// A combo can only be registered as an OS-global shortcut (Electron's
// globalShortcut) when it carries a modifier or is a media key - a bare letter
// registered globally would swallow that key in every application, so we refuse
// to. These helpers translate our combo strings into Electron accelerators.

const MODIFIER_TOKENS = new Set(['Ctrl', 'Alt', 'Shift', 'Meta'])

// Combo main-key token → Electron accelerator key. Only keys that differ from
// their combo token need an entry; anything else (A-Z, 0-9, punctuation, F-keys)
// passes through unchanged.
const ACCEL_KEY: Record<string, string> = {
  ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
  Enter: 'Return',
  MediaPlayPause: 'MediaPlayPause',
  MediaTrackNext: 'MediaNextTrack',
  MediaTrackPrevious: 'MediaPreviousTrack',
  MediaStop: 'MediaStop',
}

const MEDIA_TOKENS = new Set(Object.keys(ACCEL_KEY).filter((k) => k.startsWith('Media')))

/** True when `combo` is eligible for OS-global registration (has a modifier, or
 *  is a media key). Bare single keys are in-app only. */
export function isGloballyRegistrable(combo: string): boolean {
  if (!combo) return false
  const parts = combo.split('+')
  const key = parts[parts.length - 1]
  if (MEDIA_TOKENS.has(key)) return true
  return parts.slice(0, -1).some((p) => MODIFIER_TOKENS.has(p))
}

/** The global-registration default for `id` - deliberately nothing: the Global
 *  column is opt-in, per action.
 *
 *  Mirroring the in-app defaults here would hand the OS every eligible one the
 *  moment global shortcuts are switched on, and an OS-global accelerator is
 *  taken from *every* application: Shift+ArrowLeft/Right would stop selecting
 *  text system-wide, Ctrl+F would stop opening Find, and Ctrl+M / Ctrl+, /
 *  Alt+1-5 would be swallowed everywhere. Only the user can say a shortcut is
 *  worth taking machine-wide, so they pick each one explicitly. */
export function defaultGlobalBinding(_id: string): string {
  return ''
}

/** The OS-global combo currently bound to `id`: the user override if one
 *  exists (an explicit '' means the user cleared it), else
 *  defaultGlobalBinding(id). Fully independent of effectiveBinding - the
 *  in-app and global shortcuts for an action can differ, or either can be
 *  unset while the other stays bound. */
export function effectiveGlobalBinding(id: string, overrides: Record<string, string>): string {
  if (Object.prototype.hasOwnProperty.call(overrides, id)) return overrides[id]
  return defaultGlobalBinding(id)
}

/** Reverse lookup for the global-binding namespace: which action (if any) is
 *  globally bound to `combo`. Mirrors resolveAction for the in-app namespace. */
export function resolveGlobalAction(combo: string, overrides: Record<string, string>): string | null {
  if (!combo) return null
  for (const a of HOTKEY_ACTIONS) {
    if (effectiveGlobalBinding(a.id, overrides) === combo) return a.id
  }
  return null
}

/** Convert a combo to an Electron accelerator string, or null if it can't be a
 *  global shortcut. "Ctrl" maps to CommandOrControl so it's Cmd on macOS. */
export function comboToAccelerator(combo: string): string | null {
  if (!isGloballyRegistrable(combo)) return null
  const parts = combo.split('+')
  const key = parts[parts.length - 1]
  const out: string[] = []
  for (const p of parts.slice(0, -1)) {
    if (p === 'Ctrl') out.push('CommandOrControl')
    else if (p === 'Alt') out.push('Alt')
    else if (p === 'Shift') out.push('Shift')
    else if (p === 'Meta') out.push('Super')
    else return null
  }
  if (/^Num[0-9]$/.test(key)) out.push('num' + key.slice(3))
  else out.push(ACCEL_KEY[key] ?? key)
  return out.join('+')
}
