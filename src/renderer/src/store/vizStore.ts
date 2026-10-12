import { create } from 'zustand'
import { ls } from '../lib/persist'
import { normalizeMode, type Boost, type Quality } from '../lib/viz'

// Fullscreen visualizer preferences. Kept on this device rather than synced to
// the account: quality in particular is a per-GPU choice that shouldn't follow
// someone from a desktop to a laptop.
//
// Whether lyrics show in fullscreen is deliberately NOT stored here: it's the
// app's own lyrics toggle (the store's lyricsOverride and its "Toggle lyrics"
// hotkey). A second, fullscreen-only switch could disagree with it - lyrics
// hidden by one while the other says they're on, so the key appears dead.

export type CaptionPos = 'bl' | 'br' | 'tl' | 'tr'
export type VizCycle = 'off' | 'track' | 'album'

const QUALITIES: readonly Quality[] = ['low', 'medium', 'high', 'ultra']
const BOOSTS: readonly Boost[] = ['off', 'auto', '2', '4', '8']
const CYCLES: readonly VizCycle[] = ['off', 'track', 'album']
const CORNERS: readonly CaptionPos[] = ['bl', 'br', 'tl', 'tr']

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback
}

const savedMode = normalizeMode(ls.get<string>('vizMode') ?? 'aurora')

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
  /** Visualizer-only layout: hides the player and lyrics, leaving a caption. */
  immMinimal: boolean
  immCaptionPos: CaptionPos

  selectMode: (id: string, persist: boolean) => void
  setVizQuality: (q: Quality) => void
  setVizUseArtwork: (on: boolean) => void
  setVizBoost: (b: Boost) => void
  setVizCycle: (c: VizCycle) => void
  setImmMinimal: (on: boolean) => void
  setImmCaptionPos: (p: CaptionPos) => void
}

export const useVizStore = create<VizState>((set) => ({
  vizMode: savedMode,
  activeMode: savedMode,
  vizQuality: pick(ls.get('vizQuality'), QUALITIES, 'medium'),
  vizUseArtwork: ls.get<boolean>('vizUseArtwork') ?? true,
  vizBoost: pick(ls.get('vizBoost'), BOOSTS, 'off'),
  vizCycle: pick(ls.get('vizCycle'), CYCLES, 'off'),
  immMinimal: ls.get<boolean>('immMinimal') ?? false,
  immCaptionPos: pick(ls.get('immCaptionPos'), CORNERS, 'bl'),

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
  setImmMinimal: (immMinimal) => { set({ immMinimal }); ls.set('immMinimal', immMinimal) },
  setImmCaptionPos: (immCaptionPos) => { set({ immCaptionPos }); ls.set('immCaptionPos', immCaptionPos) },
}))
