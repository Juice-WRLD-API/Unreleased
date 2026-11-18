// The async half of the "rotate suggested covers" setting: finding the covers
// a song can rotate through, and stepping to the next one.
//
// Split from coverRotation.ts because that module must stay import-free to be
// readable from juicewrldApi's songToTrack without a cycle; everything here
// runs at play time, well away from that path, so it can import freely.
import {
  getSongById, buildStreamUrl, searchFiles, coverSearchQueries, filterSearchResults, fetchChannels,
  JWApiSong, JWApiChannel,
} from './juicewrldApi'
import { getMediaType } from './fileTypes'
import { peekRotatedCover, rememberRotatedCover, clearRotatedCovers } from './coverRotation'

/** songId → candidate cover URLs in rotation order. Session-only: it's a
 *  search result, cheap to rebuild and stale the moment files change. */
const _candidates = new Map<number, string[]>()

/** In-flight searches, so two surfaces asking at once share one request. */
const _pending = new Map<number, Promise<string[]>>()

let _channels: Promise<JWApiChannel[]> | null = null

/** The comps to look for covers in: the primary one only, or every comp
 *  (primary first) when "Covers from every comp" is on. `undefined` is the
 *  primary comp, which file URLs leave without a `channel` param. */
async function coverChannels(allComps: boolean): Promise<(string | undefined)[]> {
  if (!allComps) return [undefined]
  _channels ??= fetchChannels()
  const list = await _channels
  if (list.length === 0) { _channels = null; return [undefined] }
  const primary = list.find((c) => c.is_primary) ?? list[0]
  return [undefined, ...list.filter((c) => c.slug !== primary.slug).map((c) => c.slug)]
}

export interface CoverImageHit { path: string; channel?: string; url: string }

/** Every image filed under any of `queries`, from the primary comp or, with
 *  `allComps`, from every comp. Shared by the Personalize panel's "Found in
 *  API files" grid and the rotation below, so both offer the same covers. */
export async function searchCoverImages(queries: string[], allComps: boolean): Promise<CoverImageHit[]> {
  if (queries.length === 0) return []
  const channels = await coverChannels(allComps)
  const lists = await Promise.all(channels.flatMap((channel) => queries.map((q) =>
    searchFiles(q, channel ? { channel } : {})
      .then((entries) => filterSearchResults(entries, q).map((e) => ({ e, channel })))
      .catch(() => [])
  )))
  const seen = new Set<string>()
  const out: CoverImageHit[] = []
  for (const list of lists) {
    for (const { e, channel } of list) {
      const key = `${channel ?? ''}\u0000${e.path}`
      if (e.type !== 'file' || getMediaType(e.name) !== 'image' || seen.has(key)) continue
      seen.add(key)
      out.push({ path: e.path, channel, url: buildStreamUrl(e.path, channel) })
    }
  }
  return out
}

/** Every image the file storage has filed under this song's title or any of
 *  its alt titles — the same suggestions SongPrefsSection's "Found in API
 *  files" grid offers, so what rotates is what the Personalize panel shows. */
async function fetchCandidates(songId: number, allComps: boolean): Promise<string[]> {
  let queries: string[]
  try {
    // getSongById caches, and the song is usually already cached from whatever
    // list it was played out of.
    const song = await getSongById(songId)
    queries = coverSearchQueries(song.name, (song.track_titles ?? []).filter(Boolean))
  } catch {
    return []
  }
  return (await searchCoverImages(queries, allComps)).map((hit) => hit.url)
}

function getCandidates(songId: number, allComps: boolean): Promise<string[]> {
  const cached = _candidates.get(songId)
  if (cached) return Promise.resolve(cached)
  const inFlight = _pending.get(songId)
  if (inFlight) return inFlight
  const run = fetchCandidates(songId, allComps)
    .then((list) => { _candidates.set(songId, list); return list })
    .catch(() => [])
    .finally(() => { _pending.delete(songId) })
  _pending.set(songId, run)
  return run
}

/** Steps a song onto its next suggested cover and returns it — undefined when
 *  the storage has none, which leaves the song on its own art.
 *
 *  Position is derived by looking the current URL up in the candidate list
 *  rather than from a stored index, so a list that gained or lost files
 *  between plays can't leave the rotation pointing past the end.
 *
 *  Callers gate this on the setting being on and the user not having set their
 *  own cover; this just rotates. */
export async function advanceRotatedCover(songId: number, allComps = false): Promise<string | undefined> {
  const candidates = await getCandidates(songId, allComps)
  if (candidates.length === 0) return undefined
  const current = peekRotatedCover(songId)
  const idx = current ? candidates.indexOf(current) : -1
  const next = candidates[(idx + 1) % candidates.length]
  rememberRotatedCover(songId, next)
  return next
}

/** Drops both the remembered choices and the cached searches — used when the
 *  setting is turned off. */
export function resetCoverRotation(): void {
  clearRotatedCovers()
  _candidates.clear()
}

/** Drops the cached searches only, so the next play searches again — used when
 *  "Covers from every comp" changes which comps count. */
export function resetCoverCandidates(): void {
  _candidates.clear()
}
