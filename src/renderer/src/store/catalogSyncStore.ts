import { create } from 'zustand'
import { ls } from '../lib/persist'

// Sync (Home → Tools, desktop only): what the dialog, the Home card and the
// terminal's `offline` command read. lib/catalogSync is the only writer.

export type CatalogSyncCategory = 'released' | 'unreleased'
export const CATALOG_SYNC_CATEGORIES: CatalogSyncCategory[] = ['released', 'unreleased']

export interface CatalogSyncSettings {
  enabled: boolean
  /** Paused by the user. Kept across restarts: a pause on a metered
   *  connection shouldn't end because the app was reopened. */
  paused: boolean
  categories: CatalogSyncCategory[]
}

export type CatalogSyncPhase =
  | 'off'
  | 'checking'   // reading the catalogue and the library
  | 'syncing'    // downloading
  | 'paused'
  | 'waiting'    // no connection; picks up again when it's back
  | 'nospace'    // the drive is full
  | 'error'      // the catalogue couldn't be read
  | 'idle'       // nothing left to get

export interface CatalogSyncActive {
  songId: number
  title: string
  imageUrl: string | null
  received: number
  total: number
}

export interface CatalogSyncFailure {
  songId: number
  title: string
  error: string
}

export interface CatalogSyncFinished {
  songId: number
  title: string
  imageUrl: string | null
  at: number
}

export interface CatalogSyncCategoryStat {
  songs: number
  seconds: number
}

export interface CatalogSyncState {
  settings: CatalogSyncSettings
  phase: CatalogSyncPhase
  /** Songs the chosen categories hold that have audio to download. */
  target: number
  /** Of those, how many are on this computer. */
  have: number
  /** Their size on disk. */
  bytes: number
  /** Seconds of audio not downloaded yet, for the size estimate. */
  remainingSeconds: number
  /** Bytes per second of audio, measured from the songs already on disk. */
  bytesPerSecond: number
  /** Every category's song count and running time, from the last catalogue read. */
  categoryStats: Partial<Record<CatalogSyncCategory, CatalogSyncCategoryStat>>
  active: CatalogSyncActive[]
  failures: CatalogSyncFailure[]
  recent: CatalogSyncFinished[]
  speedBps: number
  lastCheckedAt: number | null
  error: string | null
  folder: string | null
  diskFree: number | null
  /** The dialog is open. */
  open: boolean
  setOpen: (open: boolean) => void
}

const SETTINGS_KEY = 'catalogSync'
const DEFAULT_SETTINGS: CatalogSyncSettings = { enabled: false, paused: false, categories: [...CATALOG_SYNC_CATEGORIES] }

function loadSettings(): CatalogSyncSettings {
  const saved = ls.get<Partial<CatalogSyncSettings>>(SETTINGS_KEY)
  const categories = Array.isArray(saved?.categories)
    ? CATALOG_SYNC_CATEGORIES.filter((c) => saved.categories!.includes(c))
    : DEFAULT_SETTINGS.categories
  return { enabled: !!saved?.enabled, paused: !!saved?.paused, categories }
}

export function saveCatalogSyncSettings(patch: Partial<CatalogSyncSettings>): CatalogSyncSettings {
  const settings = { ...useCatalogSync.getState().settings, ...patch }
  ls.set(SETTINGS_KEY, settings)
  useCatalogSync.setState({ settings })
  return settings
}

/** 320 kbps MP3, the catalogue's usual file, until real sizes are on disk. */
export const DEFAULT_BYTES_PER_SECOND = 40_000

export const useCatalogSync = create<CatalogSyncState>((set) => ({
  settings: loadSettings(),
  phase: 'off',
  target: 0,
  have: 0,
  bytes: 0,
  remainingSeconds: 0,
  bytesPerSecond: DEFAULT_BYTES_PER_SECOND,
  categoryStats: {},
  active: [],
  failures: [],
  recent: [],
  speedBps: 0,
  lastCheckedAt: null,
  error: null,
  folder: null,
  diskFree: null,
  open: false,
  setOpen: (open) => set({ open }),
}))

/** Bytes still to download, estimated from running time. */
export function remainingBytes(s: Pick<CatalogSyncState, 'remainingSeconds' | 'bytesPerSecond'>): number {
  return Math.round(s.remainingSeconds * s.bytesPerSecond)
}

/** Whether everything chosen is on this computer. */
export const catalogSyncComplete = (s: Pick<CatalogSyncState, 'have' | 'target'>): boolean =>
  s.target > 0 && s.have >= s.target

/** One line for the Home card and the terminal. */
export function catalogSyncSummary(s: Pick<CatalogSyncState, 'phase' | 'have' | 'target' | 'failures'>): string {
  const count = s.target ? `${s.have.toLocaleString()} of ${s.target.toLocaleString()}` : ''
  switch (s.phase) {
    case 'off': return 'Off · keep every song on this computer'
    case 'checking': return 'Checking for new songs…'
    case 'syncing': return count ? `Syncing · ${count}` : 'Syncing'
    case 'paused': return count ? `Paused · ${count}` : 'Paused'
    case 'waiting': return 'Waiting for a connection'
    case 'nospace': return 'The drive is full'
    case 'error': return 'Couldn’t sync'
    case 'idle':
      if (catalogSyncComplete(s)) return `All ${s.target.toLocaleString()} songs offline`
      return s.failures.length ? `${count} offline · ${s.failures.length} failed` : `${count} offline`
  }
}

/** "about 12 min" / "about 1 h 20 min". */
export function formatSyncEta(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return ''
  if (seconds < 60) return 'under a minute'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `about ${minutes} min`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m ? `about ${h} h ${m} min` : `about ${h} h`
}
