import { useSyncExternalStore, type CSSProperties } from 'react'

// Colour schemes for the admin terminal. The panel paints everything from CSS
// variables set from the active theme (termThemeVars), so switching is one
// state change; `termtheme <name>` picks one and it is remembered per browser.
export interface TermTheme {
  id: string
  label: string
  bg: string
  fg: string
  /** user@host in the prompt. */
  user: string
  /** The working-directory part of the prompt. */
  path: string
  ok: string
  err: string
  dim: string
  /** Title bar and the inverted bars (nano, status lines). */
  bar: string
  border: string
  /** Highlight for matrix rain, visualizer bars, the current lyric line. */
  accent: string
}

export const TERM_THEMES: TermTheme[] = [
  { id: 'default', label: 'Default', bg: '#000000', fg: '#d4d4d4', user: '#5af78e', path: '#6ab0ff', ok: '#5af78e', err: '#ff6b6b', dim: '#8a8a8a', bar: '#1b1b1b', border: '#2a2a2a', accent: '#5af78e' },
  { id: 'green', label: 'Green phosphor', bg: '#020a02', fg: '#33ff66', user: '#33ff66', path: '#99ffb3', ok: '#99ffb3', err: '#ff5555', dim: '#1f9940', bar: '#06150a', border: '#0f3a1a', accent: '#33ff66' },
  { id: 'amber', label: 'Amber', bg: '#120a00', fg: '#ffb000', user: '#ffcc4d', path: '#ffd98a', ok: '#ffd98a', err: '#ff6b4a', dim: '#a06c00', bar: '#1f1300', border: '#3a2500', accent: '#ffb000' },
  { id: 'dracula', label: 'Dracula', bg: '#282a36', fg: '#f8f8f2', user: '#50fa7b', path: '#bd93f9', ok: '#50fa7b', err: '#ff5555', dim: '#6272a4', bar: '#21222c', border: '#44475a', accent: '#ff79c6' },
  { id: 'nord', label: 'Nord', bg: '#2e3440', fg: '#d8dee9', user: '#a3be8c', path: '#88c0d0', ok: '#a3be8c', err: '#bf616a', dim: '#7b88a1', bar: '#272c36', border: '#3b4252', accent: '#88c0d0' },
  { id: 'light', label: 'Light', bg: '#fafafa', fg: '#2b2b2b', user: '#1b7f3b', path: '#1a5fb4', ok: '#1b7f3b', err: '#c01c28', dim: '#7a7a7a', bar: '#e6e6e6', border: '#d0d0d0', accent: '#1a5fb4' },
]

const STORAGE_KEY = 'terminal:theme'

function load(): TermTheme {
  try {
    const id = window.localStorage.getItem(STORAGE_KEY)
    return TERM_THEMES.find((t) => t.id === id) ?? TERM_THEMES[0]
  } catch { return TERM_THEMES[0] }
}

let current = load()
const listeners = new Set<() => void>()

export const getTermTheme = (): TermTheme => current

export function setTermTheme(id: string): TermTheme | null {
  const found = TERM_THEMES.find((t) => t.id === id.trim().toLowerCase())
  if (!found) return null
  current = found
  try { window.localStorage.setItem(STORAGE_KEY, found.id) } catch { /* the theme still applies for this session */ }
  listeners.forEach((l) => l())
  return found
}

export function useTermTheme(): TermTheme {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => { listeners.delete(cb) } },
    getTermTheme,
  )
}

export function termThemeVars(t: TermTheme): CSSProperties {
  return {
    '--t-bg': t.bg, '--t-fg': t.fg, '--t-user': t.user, '--t-path': t.path, '--t-ok': t.ok,
    '--t-err': t.err, '--t-dim': t.dim, '--t-bar': t.bar, '--t-border': t.border, '--t-accent': t.accent,
  } as CSSProperties
}
