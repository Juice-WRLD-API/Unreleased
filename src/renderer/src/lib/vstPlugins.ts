// The desktop app's VST3 bridge (electron/vstHost.js) and the shared list of installed
// plug-ins. The Session Maker's lane popovers and Settings both show that list; main
// sends every change to all windows, so they never disagree.

import { useEffect, useSyncExternalStore } from 'react'

export interface VstPluginInfo {
  path: string
  cid: string
  name: string
  vendor: string
  version: string
  /** VST3 sub-categories, "|"-separated ("Fx|Pitch Shift"). */
  sub: string
  /** Hidden from the Session Maker's lists - still works on lanes that have it. */
  hidden: boolean
}
export interface VstScan {
  plugins: VstPluginInfo[]
  /** Modules that wouldn't load, and why. */
  failed: { path: string; error: string }[]
  /** Folders added by hand. */
  folders: string[]
  /** Where plug-in installers put them - always looked in. */
  standardFolders: string[]
  scannedAt: number | null
  scanning: boolean
}
/** One plug-in parameter in the generic controls. `value` is normalized 0-1; `text` is the plug-in's own readout. */
export interface VstParam { id: number; name: string; units: string; steps: number; def: number; value: number; text: string; ro: boolean; bypass: boolean; options?: string[] | null }
export interface VstEditorEvent {
  key: string; type: 'open' | 'state' | 'closed' | 'error' | 'params' | 'param'
  state?: string; error?: string
  /** 'params': the full list. 'param': one change (id, value, text). */
  params?: VstParam[]; id?: number; value?: number; text?: string
}
export interface PluginRef { path: string; cid: string; state: string }

interface VstApi {
  vstAvailable: () => Promise<boolean>
  vstScan: (force?: boolean) => Promise<VstScan>
  vstAddFolder: () => Promise<VstScan | null>
  vstRemoveFolder: (folder: string) => Promise<VstScan>
  vstSetHidden: (keys: string[], hide: boolean) => Promise<VstScan>
  vstOpenFolder: (folder: string) => Promise<boolean>
  vstShowModule: (path: string) => Promise<boolean>
  vstProcess: (req: { sampleRate: number; bpm: number; chain: PluginRef[]; channels: Float32Array[] }) => Promise<{ channels?: Float32Array<ArrayBuffer>[]; error?: string; plugin?: number }>
  vstEditOpen: (req: { key: string; generic?: boolean; lanes?: string[]; path: string; cid: string; state: string; title: string; sampleRate: number }) => Promise<{ error?: string }>
  vstEditClose: (key: string) => Promise<void>
  vstEditParam: (key: string, param: number, value: number) => Promise<void>
  vstControlsGet: (key: string) => Promise<VstParam[] | null>
  onVstControls: (cb: (e: VstEditorEvent) => void) => () => void
  onVstEditor: (cb: (e: VstEditorEvent) => void) => () => void
  onVstPlugins: (cb: (l: VstScan) => void) => () => void
}

/** The desktop app's plug-in bridge; null on the web. */
export function vstApi(): VstApi | null {
  const e = typeof window !== 'undefined' ? (window as unknown as { electron?: Partial<VstApi> }).electron : undefined
  return e?.vstProcess ? (e as VstApi) : null
}

/** How a plug-in is named in the hidden list. */
export const vstPluginKey = (p: { path: string; cid: string }): string => `${p.path}|${p.cid}`

// ─── The shared list ─────────────────────────────────────────────────────────

interface VstState {
  /** Whether this build can host plug-ins - null until asked. */
  available: boolean | null
  list: VstScan | null
  /** Waiting on a folder picker or a scan this window asked for. */
  busy: boolean
}
let state: VstState = { available: null, list: null, busy: false }
const listeners = new Set<() => void>()
let started = false

function set(patch: Partial<VstState>): void {
  state = { ...state, ...patch }
  for (const fn of listeners) fn()
}

function start(): void {
  if (started) return
  started = true
  const api = vstApi()
  if (!api) { set({ available: false }); return }
  api.onVstPlugins?.((list) => set({ list }))
  api.vstAvailable().then((available) => set({ available }), () => set({ available: false }))
}

function subscribe(fn: () => void): () => void {
  start()
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

/** Runs one call that hands back a fresh list, showing busy meanwhile. */
async function withList(call: (api: VstApi) => Promise<VstScan | null>): Promise<void> {
  const api = vstApi()
  if (!api) return
  set({ busy: true })
  try {
    const list = await call(api)
    if (list) set({ list })
  } catch (err) {
    alert(err instanceof Error ? err.message : String(err))
  } finally {
    set({ busy: false })
  }
}

export const vstPlugins = {
  /** Loads the list - the cached one if there is one, else a scan. */
  load: (): Promise<void> => withList((api) => api.vstScan(false)),
  rescan: (): Promise<void> => withList((api) => api.vstScan(true)),
  addFolder: (): Promise<void> => withList((api) => api.vstAddFolder()),
  removeFolder: (folder: string): Promise<void> => withList((api) => api.vstRemoveFolder(folder)),
  setHidden: (keys: string[], hide: boolean): Promise<void> => withList((api) => api.vstSetHidden(keys, hide)),
  openFolder: (folder: string): void => { void vstApi()?.vstOpenFolder(folder) },
  showModule: (path: string): void => { void vstApi()?.vstShowModule(path) },
}

/** The installed plug-ins, kept current. With `load`, fetches the list the first time
 *  it's needed (a scan, if the app has never scanned). */
export function useVstPlugins(load = false): VstState & { scanning: boolean } {
  const s = useSyncExternalStore(subscribe, () => state)
  useEffect(() => {
    if (load && s.available && !s.list && !s.busy) void vstPlugins.load()
  }, [load, s.available, s.list, s.busy])
  return { ...s, scanning: s.busy || !!s.list?.scanning }
}
