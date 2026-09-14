// Data + persistence for the Tier List game - drag songs into ranked rows and
// save the result locally. Unlike Heardle/Wordle this has no daily puzzle or
// scoring: it's a personal ranking, so state is just "what tiers exist" and
// "which tier each song landed in", both kept in localStorage.
import type { HeardleSong } from './heardle'

export interface Tier {
  id: string
  label: string
  color: string
}

export const TIER_COLOR_PRESETS = [
  '#ff7f7f', '#ffbf7f', '#ffdf7f', '#ffff7f', '#bfff7f',
  '#7fffbf', '#7fdfff', '#7fbfff', '#bf7fff', '#ff7fdf',
]

function defaultTiers(): Tier[] {
  return [
    { id: 's', label: 'S', color: '#ff7f7f' },
    { id: 'a', label: 'A', color: '#ffbf7f' },
    { id: 'b', label: 'B', color: '#ffdf7f' },
    { id: 'c', label: 'C', color: '#ffff7f' },
    { id: 'd', label: 'D', color: '#bfff7f' },
    { id: 'unheard', label: "Haven't heard", color: '#7fffbf' },
  ]
}

export interface TierlistState {
  tiers: Tier[]
  // songId -> tierId. Absent = still in the unsorted pool.
  assignments: Record<number, string>
}

function defaultState(): TierlistState {
  return { tiers: defaultTiers(), assignments: {} }
}

const LS_KEY = 'unreleased:tierlist:v1'

export function loadTierlistState(): TierlistState {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return defaultState()
    const parsed = JSON.parse(raw) as Partial<TierlistState>
    if (!Array.isArray(parsed.tiers) || parsed.tiers.length === 0) return defaultState()
    return { tiers: parsed.tiers, assignments: parsed.assignments ?? {} }
  } catch {
    return defaultState()
  }
}

export function saveTierlistState(state: TierlistState): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(state))
  } catch {}
}

export function resetTierlistState(): TierlistState {
  const state = defaultState()
  saveTierlistState(state)
  return state
}

let nextTierSeq = 1

export function newTierId(): string {
  return `tier-${Date.now()}-${nextTierSeq++}`
}

/** Songs still unranked - everything in `pool` whose id has no assignment. */
export function unsortedSongs(pool: HeardleSong[], assignments: Record<number, string>): HeardleSong[] {
  return pool.filter((s) => !(s.id in assignments))
}

/** Songs assigned to `tierId`, in the order they appear in `pool` - stable
 *  regardless of drop order since nothing here tracks per-tier position. */
export function songsInTier(pool: HeardleSong[], assignments: Record<number, string>, tierId: string): HeardleSong[] {
  return pool.filter((s) => assignments[s.id] === tierId)
}
