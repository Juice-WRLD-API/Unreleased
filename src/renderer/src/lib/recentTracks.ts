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
const LIMIT = 20

export function loadRecentTracks(): Track[] {
  const saved = ls.get<Track[]>(KEY)
  return Array.isArray(saved) ? saved.slice(0, LIMIT) : []
}

/** Move `track` to the front, de-duplicated by id. */
export function rememberRecentTrack(track: Track): void {
  const next = [track, ...loadRecentTracks().filter((t) => t.id !== track.id)].slice(0, LIMIT)
  ls.set(KEY, next)
}
