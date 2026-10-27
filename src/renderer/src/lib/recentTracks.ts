// Recently played, for the Home screen.
//
// The store already records every play in `listeningPlays`, but those events
// hold song ids only - turning them back into something displayable means
// resolving against the stats catalog, which costs ~25 requests on a cold
// cache (see lib/statsCatalog.ts). Far too heavy for a landing screen, so this
// keeps its own small ring of whole Tracks instead: written where a play is
// credited (Player.tsx's creditPlayIfListened, which has the Track in hand),
// read synchronously, never touches the network.
//
// Storing the whole Track rather than a slim snapshot is what lets a Home row
// be tapped straight into playTrack() without a lookup. It starts empty on
// upgrade - there's nothing to backfill from, so Home shows an empty state
// until the next song plays.

import { ls } from './persist'
import type { Track } from '../types'

const KEY = 'recent-tracks'
export const RECENT_TRACKS_LIMIT = 20
const LIMIT = RECENT_TRACKS_LIMIT

export function loadRecentTracks(): Track[] {
  const saved = ls.get<Track[]>(KEY)
  return Array.isArray(saved) ? saved.slice(0, LIMIT) : []
}

/** Move `track` to the front, de-duplicated by id. */
export function rememberRecentTrack(track: Track): void {
  const next = [track, ...loadRecentTracks().filter((t) => t.id !== track.id)].slice(0, LIMIT)
  ls.set(KEY, next)
}

/** Backfills the ring with tracks it doesn't have yet - e.g. plays credited
 *  on another device, which never wrote into *this* device's local-only
 *  ring. `orderedSongIds` is `listeningPlays` (already merged with the
 *  synced server copy), newest first; `resolved` holds whatever of those
 *  ids got looked up over the network. Entries for ids outside that list are
 *  kept as-is, oldest ones falling off once back over LIMIT. */
export function backfillRecentTracks(orderedSongIds: number[], resolved: Map<number, Track>): void {
  const existing = loadRecentTracks()
  const existingById = new Map(existing.map((t) => [t.id, t]))
  const seen = new Set<string>()
  const merged: Track[] = []
  for (const songId of orderedSongIds) {
    const trackId = `jw-${songId}`
    const track = resolved.get(songId) ?? existingById.get(trackId)
    if (track && !seen.has(trackId)) { merged.push(track); seen.add(trackId) }
  }
  for (const t of existing) if (!seen.has(t.id)) { merged.push(t); seen.add(t.id) }
  ls.set(KEY, merged.slice(0, LIMIT))
}
