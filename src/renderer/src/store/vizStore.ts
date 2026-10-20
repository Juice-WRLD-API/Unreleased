import { create } from 'zustand'
import { ls } from '../lib/persist'
import { normalizeMode, EDGE_PREFIX, type Boost, type Quality } from '../lib/viz'
import { LOOKS } from '../desktop/light/looks'
import { useStore } from './useStore'

// Fullscreen visualizer preferences. Kept on this device rather than synced to
// the account: quality in particular is a per-GPU choice that shouldn't follow
// someone from a desktop to a laptop.
//
// Whether lyrics show in fullscreen is deliberately NOT stored here: it's the
// app's own lyrics toggle (the store's lyricsOverride and its "Toggle lyrics"
// hotkey). A second, fullscreen-only switch could disagree with it - lyrics
// hidden by one while the other says they're on, so the key appears dead.

export type VizCycle = 'off' | 'track' | 'album'

const QUALITIES: readonly Quality[] = ['low', 'medium', 'high', 'ultra']
const BOOSTS: readonly Boost[] = ['off', 'auto', '2', '4', '8']
const CYCLES: readonly VizCycle[] = ['off', 'track', 'album']

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback
}

const edgeLook = (id: unknown): string | null => (LOOKS.some((l) => l.id === id) ? (id as string) : null)

// An Edge light saved as the visualizer itself, from before it was a setting of its own: Off, with that light round it.
const savedId = ls.get<string>('vizMode') ?? 'aurora'
const savedEdge = savedId.startsWith(EDGE_PREFIX) ? edgeLook(savedId.slice(EDGE_PREFIX.length)) : null
if (savedEdge) {
  ls.set('vizMode', 'none')
  ls.set('vizEdgeOverlay', savedEdge)
}
const savedMode = savedEdge ? 'none' : normalizeMode(savedId)

interface VizState {
  /** The saved default visualizer. */
  vizMode: string
  /** What's on screen now. Differs from vizMode after an auto-switch, which is
   *  deliberately not saved, so the chosen default survives a reload. */
  activeMode: string
  vizQuality: Quality
  vizUseArtwork: boolean
  vizBoost: Boost
  vizCycle: VizCycle
  /** Widgets layout: the desktop's player, playlist and clock stand in the tab instead of WRLD's own player and lyrics. */
  wrldWidgets: boolean
  /** The Edge light (its look's id) drawn round the edges: over the visualizer, or on its own with it Off; null for none. */
  vizEdgeOverlay: string | null

  selectMode: (id: string, persist: boolean) => void
  setVizQuality: (q: Quality) => void
  setVizUseArtwork: (on: boolean) => void
  setVizBoost: (b: Boost) => void
  setVizCycle: (c: VizCycle) => void
  setWrldWidgets: (on: boolean) => void
  setVizEdgeOverlay: (look: string | null) => void
}

export const useVizStore = create<VizState>((set) => ({
  vizMode: savedMode,
  activeMode: savedMode,
  vizQuality: pick(ls.get('vizQuality'), QUALITIES, 'medium'),
  vizUseArtwork: ls.get<boolean>('vizUseArtwork') ?? true,
  vizBoost: pick(ls.get('vizBoost'), BOOSTS, 'off'),
  vizCycle: pick(ls.get('vizCycle'), CYCLES, 'off'),
  // The default. Someone who had the retired visualizer-only layout gets the widgets, where hiding all three is the same.
  wrldWidgets: ls.get<boolean>('immMinimal') ? true : (ls.get<boolean>('wrldWidgets') ?? true),
  vizEdgeOverlay: edgeLook(ls.get('vizEdgeOverlay')),

  selectMode: (id, persist) => {
    const mode = normalizeMode(id)
    if (persist) {
      set({ activeMode: mode, vizMode: mode })
      ls.set('vizMode', mode)
    } else {
      set({ activeMode: mode })
    }
  },
  setVizQuality: (vizQuality) => { set({ vizQuality }); ls.set('vizQuality', vizQuality) },
  setVizUseArtwork: (vizUseArtwork) => { set({ vizUseArtwork }); ls.set('vizUseArtwork', vizUseArtwork) },
  setVizBoost: (vizBoost) => { set({ vizBoost }); ls.set('vizBoost', vizBoost) },
  setVizCycle: (vizCycle) => { set({ vizCycle }); ls.set('vizCycle', vizCycle) },
  setWrldWidgets: (wrldWidgets) => {
    set({ wrldWidgets })
    ls.set('wrldWidgets', wrldWidgets)
    ls.set('immMinimal', false)
  },
  // A light picked for WRLD is the screen light's look too: there's one look, the screen light's (Settings > Desktop).
  setVizEdgeOverlay: (look) => {
    const vizEdgeOverlay = edgeLook(look)
    set({ vizEdgeOverlay })
    ls.set('vizEdgeOverlay', vizEdgeOverlay)
    if (vizEdgeOverlay) useStore.getState().setDesktop({ light: { look: vizEdgeOverlay } })
  },
}))

// WRLD's Edge light draws the screen light's look; vizEdgeOverlay only says whether it's on. Read through these, not
// vizEdgeOverlay itself, which can hold an older pick (or one made in a popped-out Settings window, where the look
// changed but this window's vizEdgeOverlay didn't).

/** The look WRLD's Edge light draws, or null while it's off. */
export function wrldEdgeLook(): string | null {
  return useVizStore.getState().vizEdgeOverlay !== null ? useStore.getState().desktop.light.look : null
}

export function useWrldEdgeLook(): string | null {
  const on = useVizStore((s) => s.vizEdgeOverlay !== null)
  const look = useStore((s) => s.desktop.light.look)
  return on ? look : null
}
