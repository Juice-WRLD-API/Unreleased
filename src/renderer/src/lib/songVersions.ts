import { getOwnVersionMeta, getVersionGroup, type SongVersionMeta } from './versionsApi'
import { getSongsByIds, type JWApiSong } from './juicewrldApi'
import { hasPlayableSessionEdit } from './sessionEditsApi'

/** Whether a song has something to actually play: its own `path`, or - for a
 *  recording session without one - a session edit (looked up once, like a
 *  play). Unsurfaced entries and pathless sessions with no edit fail, and
 *  switching to or starring one of those would break playback. */
export async function isPlayableSong(song: Pick<JWApiSong, 'id' | 'path' | 'category'>): Promise<boolean> {
  if (song.path) return true
  return song.category === 'recording_session' && hasPlayableSessionEdit(song.id)
}

/** One sibling version: its song row, its /versions/ metadata, and whether it
 *  can be played (isPlayableSong). */
export interface SongVersionEntry {
  song: JWApiSong
  meta: SongVersionMeta
  playable: boolean
}

/** The song rows behind `metas`, each with whether it can be played. Metas
 *  whose song can't be found are dropped. */
async function entriesFor(metas: SongVersionMeta[]): Promise<SongVersionEntry[]> {
  const songs = await getSongsByIds(metas.map(m => m.songId))
  const byId = new Map(songs.map(s => [s.id, s]))
  const entries = await Promise.all(metas.map(async (meta): Promise<SongVersionEntry | null> => {
    const song = byId.get(meta.songId)
    return song ? { song, meta, playable: await isPlayableSong(song) } : null
  }))
  return entries.filter((e): e is SongVersionEntry => !!e)
}

/** Every sibling of `songId` (itself excluded) that resolves to a song row,
 *  playable or not - callers that switch or star versions filter on
 *  `playable`; Song info lists them all. */
export async function loadVersionEntries(songId: number): Promise<SongVersionEntry[]> {
  return entriesFor(await getVersionGroup(songId))
}

/** loadVersionEntries plus `songId`'s own entry (null when it isn't in a
 *  group), for the lists that show the song itself among its versions so it
 *  can be preferred or excluded from there too. */
export async function loadVersionGroupEntries(songId: number): Promise<{ self: SongVersionEntry | null; siblings: SongVersionEntry[] }> {
  // Both read /versions/{songId}/; apiRequest shares the one request.
  const [own, group] = await Promise.all([getOwnVersionMeta(songId), getVersionGroup(songId)])
  const entries = await entriesFor(own ? [own, ...group] : group)
  return {
    self: entries.find(e => e.song.id === songId) ?? null,
    siblings: entries.filter(e => e.song.id !== songId),
  }
}
