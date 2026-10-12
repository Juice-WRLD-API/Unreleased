// Most-recently-opened playlists, for ordering Home's playlist row.
//
// Playlist plays go through dozens of call sites, so "opened" (selected in the
// Playlists view) stands in for "played". Keys match HomePlaylistCard.key
// ('p<id>' own, 'f<id>' followed, 'g<id>' guest); we only see numeric ids from
// the view's selectedId, so 'p' and 'f' both get stamped.

import { ls } from './persist'

const KEY = 'recent-playlists'
const LIMIT = 30

export function loadRecentPlaylistIds(): number[] {
  const saved = ls.get<number[]>(KEY)
  return Array.isArray(saved) ? saved.slice(0, LIMIT) : []
}

export function rememberRecentPlaylist(id: number): void {
  ls.set(KEY, [id, ...loadRecentPlaylistIds().filter((x) => x !== id)].slice(0, LIMIT))
}
