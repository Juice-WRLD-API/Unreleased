// Selectable font stacks for the app UI and for lyrics.
//
// Every built-in stack is made from fonts that ship with Windows/macOS/Linux
// (plus the already-imported Josefin Sans), so switching fonts never waits on a
// network fetch - this app runs offline and a webfont download would leave text
// swapping mid-session. Fonts the user adds are covered under "Custom fonts"
// below. useThemeEffects writes the chosen stacks onto <html>
// as --font-app / --font-lyrics; Tailwind's `font-sans` resolves to the former
// (see tailwind.config.js), so a change reaches every screen at once.

export interface FontChoice {
  id: string
  name: string
  stack: string
  /** Added by the user rather than built in. */
  custom?: boolean
}

// 'system' must stay first - it's the fallback for unknown persisted ids.
export const FONTS: FontChoice[] = [
  {
    id: 'system',
    name: 'System',
    stack: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  },
  {
    id: 'grotesk',
    name: 'Grotesk',
    stack: "'Helvetica Neue', Helvetica, Arial, sans-serif",
  },
  {
    id: 'humanist',
    name: 'Humanist',
    stack: "'Trebuchet MS', 'Segoe UI', Tahoma, sans-serif",
  },
  {
    id: 'wide',
    name: 'Wide',
    stack: "Verdana, Geneva, 'DejaVu Sans', sans-serif",
  },
  {
    id: 'serif',
    name: 'Serif',
    stack: "Georgia, 'Times New Roman', 'Liberation Serif', serif",
  },
  {
    id: 'mono',
    name: 'Mono',
    stack: "Consolas, Menlo, 'DejaVu Sans Mono', monospace",
  },
  {
    id: 'display',
    name: 'Display',
    stack: "'Josefin Sans', 'Century Gothic', 'Segoe UI', sans-serif",
  },
]

// ── Custom fonts ──────────────────────────────────────────────────────────
//
// Two kinds, both added by the user:
//   file:<uuid>   a .ttf/.otf/.woff/.woff2 they import. The bytes live in
//                 IndexedDB and are registered with the FontFace API at
//                 startup (binary data, so the CSP's `font-src 'self'` doesn't
//                 apply). Only this device has the file.
//   local:<name>  a font already installed on the OS, referenced by family
//                 name. Nothing to store, so the id means the same on any device.
// The list itself (not the bytes) is kept in localStorage so getFont() can stay
// synchronous - the store resolves persisted ids while it is being created.

export interface CustomFont {
  id: string
  name: string
  kind: 'file' | 'installed'
  /** The CSS family name the stack uses (unique per imported file). */
  family: string
}

export const MAX_FONT_BYTES = 20 * 1024 * 1024
const FONT_EXTENSIONS = ['ttf', 'otf', 'woff', 'woff2']
export const FONT_ACCEPT = FONT_EXTENSIONS.map((e) => `.${e}`).join(',')
const FALLBACK_STACK = FONTS[0].stack
const LIST_KEY = 'unreleased:customFonts'
const DB_NAME = 'unreleased-fonts'
const STORE = 'files'

const quote = (family: string): string => `'${family.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
const stackFor = (family: string): string => `${quote(family)}, ${FALLBACK_STACK}`

function readList(): CustomFont[] {
  try {
    const raw = JSON.parse(localStorage.getItem(LIST_KEY) ?? '[]')
    return Array.isArray(raw)
      ? raw.filter((f): f is CustomFont => !!f && typeof f.id === 'string' && typeof f.name === 'string' && typeof f.family === 'string' && (f.kind === 'file' || f.kind === 'installed'))
      : []
  } catch { return [] }
}

let customFonts: CustomFont[] = readList()
const listeners = new Set<() => void>()
const faces = new Map<string, FontFace>()

function commit(next: CustomFont[]): void {
  customFonts = next
  try { localStorage.setItem(LIST_KEY, JSON.stringify(next)) } catch (e) { console.warn('[fonts] failed to save the font list:', e) }
  listeners.forEach((l) => l())
}

export function listCustomFonts(): CustomFont[] { return customFonts }

export function subscribeCustomFonts(cb: () => void): () => void {
  listeners.add(cb)
  return () => { listeners.delete(cb) }
}

const toChoice = (f: CustomFont): FontChoice => ({ id: f.id, name: f.name, stack: stackFor(f.family), custom: true })

export function allFonts(): FontChoice[] { return [...FONTS, ...customFonts.map(toChoice)] }

export function getFont(id: string | null | undefined): FontChoice {
  const builtin = FONTS.find((f) => f.id === id)
  if (builtin) return builtin
  const custom = customFonts.find((f) => f.id === id)
  if (custom) return toChoice(custom)
  // An installed font needs no entry in the list - the id carries the name, so
  // a choice synced from another device still works here if the font is too.
  if (id?.startsWith('local:') && id.length > 6) return { id, name: id.slice(6), stack: stackFor(id.slice(6)), custom: true }
  return FONTS[0]
}

/** The id to apply for a font choice synced from the account, or null to keep
 *  the current one (an imported file this device doesn't have). */
export function syncedFontId(id: string): string | null {
  if (id.startsWith('file:') && getFont(id).id !== id) return null
  return getFont(id).id
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => { req.result.createObjectStore(STORE, { keyPath: 'id' }) }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function dbRun<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await openDb()
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE))
      req.onsuccess = () => resolve(req.result as T)
      req.onerror = () => reject(req.error)
    })
  } finally { db.close() }
}

async function register(font: CustomFont, data: ArrayBuffer): Promise<void> {
  const face = new FontFace(font.family, data)
  await face.load()
  document.fonts.add(face)
  faces.set(font.id, face)
}

/** Registers every imported file that isn't registered yet. Runs at startup in
 *  each window, and again when another window changes the list. */
async function registerStored(): Promise<void> {
  for (const font of customFonts) {
    if (font.kind !== 'file' || faces.has(font.id)) continue
    try {
      const row = await dbRun<{ id: string; data: ArrayBuffer } | undefined>('readonly', (s) => s.get(font.id))
      // A cleared IndexedDB leaves the name behind; the stack just falls back.
      if (row) await register(font, row.data)
    } catch (e) {
      console.warn(`[fonts] could not load "${font.name}":`, e)
    }
  }
  listeners.forEach((l) => l())
}

if (typeof window !== 'undefined') {
  void registerStored()
  // Another window (the pop-out player, a second main window) added or removed one.
  window.addEventListener('storage', (e) => {
    if (e.key !== LIST_KEY) return
    customFonts = readList()
    for (const [id, face] of faces) {
      if (!customFonts.some((f) => f.id === id)) { document.fonts.delete(face); faces.delete(id) }
    }
    void registerStored()
  })
}

/** Imports a font file. Throws a readable message if it isn't a usable font. */
export async function addFontFile(file: File): Promise<FontChoice> {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  if (!FONT_EXTENSIONS.includes(ext)) throw new Error('Pick a .ttf, .otf, .woff or .woff2 font file')
  if (file.size > MAX_FONT_BYTES) throw new Error('That font file is over 20 MB')
  const data = await file.arrayBuffer()
  const uid = crypto.randomUUID()
  const font: CustomFont = {
    id: `file:${uid}`,
    name: file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim().slice(0, 40) || 'Custom font',
    kind: 'file',
    family: `Imported ${uid.slice(0, 8)}`,
  }
  try { await register(font, data) } catch { throw new Error("That file isn't a font the app can read") }
  try {
    await dbRun('readwrite', (s) => s.put({ id: font.id, data }))
  } catch (e) {
    const face = faces.get(font.id)
    if (face) document.fonts.delete(face)
    faces.delete(font.id)
    throw new Error(`Couldn't store the font: ${e instanceof Error ? e.message : 'storage error'}`)
  }
  commit([...customFonts, font])
  return toChoice(font)
}

// A font that isn't installed silently renders as the fallback, so compare
// widths against two generic families: an installed font differs from at least one.
function isInstalled(family: string): boolean {
  const ctx = document.createElement('canvas').getContext('2d')
  if (!ctx) return true
  const sample = 'mmmmmmmmmmlliWWW0123 Agjq'
  const width = (stack: string): number => { ctx.font = `64px ${stack}`; return ctx.measureText(sample).width }
  return width(`${quote(family)}, monospace`) !== width('monospace') || width(`${quote(family)}, serif`) !== width('serif')
}

/** Adds a font that is already installed on this computer, by family name. */
export function addInstalledFont(rawName: string): FontChoice {
  const name = rawName.trim().replace(/^['"]|['"]$/g, '').trim()
  if (!name) throw new Error('Type the name of an installed font')
  if (name.length > 64 || /[\u0000-\u001f;{}]/.test(name)) throw new Error("That doesn't look like a font name")
  const existing = customFonts.find((f) => f.kind === 'installed' && f.name.toLowerCase() === name.toLowerCase())
  if (existing) return toChoice(existing)
  if (!isInstalled(name)) throw new Error(`"${name}" isn't installed on this computer (use the exact family name, e.g. "Comic Sans MS")`)
  const font: CustomFont = { id: `local:${name}`, name, kind: 'installed', family: name }
  commit([...customFonts, font])
  return toChoice(font)
}

/** Forgets a custom font. Callers that have it selected should switch away
 *  first (see lib/fontActions.ts) - rendering falls back to System either way. */
export async function removeCustomFont(id: string): Promise<void> {
  const font = customFonts.find((f) => f.id === id)
  if (!font) return
  const face = faces.get(id)
  if (face) { document.fonts.delete(face); faces.delete(id) }
  commit(customFonts.filter((f) => f.id !== id))
  if (font.kind === 'file') await dbRun('readwrite', (s) => s.delete(id)).catch(() => {})
}
