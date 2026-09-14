// The async half of the "rotate suggested covers" setting: finding the covers
// a song can rotate through, and stepping to the next one.
//
// Split from coverRotation.ts because that module must stay import-free to be
// readable from juicewrldApi's songToTrack without a cycle; everything here
// runs at play time, well away from that path, so it can import freely.
import {
  apiFetch, buildStreamUrl, parseBrowseEntries, cleanTitleForSearch,
  JWApiSong, JWApiBrowseResponse,
} from './juicewrldApi'
import { getMediaType } from './fileTypes'
import { peekRotatedCover, rememberRotatedCover, clearRotatedCovers } from './coverRotation'

/** songId → candidate cover URLs in rotation order. Session-only: it's a
 *  search result, cheap to rebuild and stale the moment files change. */
const _candidates = new Map<number, string[]>()

/** In-flight searches, so two surfaces asking at once share one request. */
const _pending = new Map<number, Promise<string[]>>()

/** Every image the file storage has filed under this song's title or any of
 *  its alt titles - the same suggestions SongPrefsSection's "Found in API
 *  files" grid offers, so what rotates is what the Personalize panel shows. */
async function fetchCandidates(songId: number): Promise<string[]> {
  let titles: string[]
  try {
    // apiFetch caches, and the song is usually already cached from whatever
    // list it was played out of.
    const song = await apiFetch<JWApiSong>(`/songs/${songId}/`)
    titles = (song.track_titles?.length ? song.track_titles : [song.name]).filter(Boolean)
  } catch {
    return []
  }

  const queries = titles
    .map(cleanTitleForSearch)
    .filter((q, i, arr) => q && arr.indexOf(q) === i)
  if (queries.length === 0) return []

  const lists = await Promise.all(queries.map((q) =>
    apiFetch<JWApiBrowseResponse>('/files/browse/', { search: q })
      .then(parseBrowseEntries)
      .catch(() => [])
  ))

  const seenPaths = new Set<string>()
  const out: string[] = []
  for (const list of lists) {
    for (const e of list) {
      if (e.type !== 'file' || getMediaType(e.name) !== 'image' || seenPaths.has(e.path)) continue
      seenPaths.add(e.path)
      out.push(buildStreamUrl(e.path))
    }
  }
  return out
}

function getCandidates(songId: number): Promise<string[]> {
  const cached = _candidates.get(songId)
  if (cached) return Promise.resolve(cached)
  const inFlight = _pending.get(songId)
  if (inFlight) return inFlight
  const run = fetchCandidates(songId)
    .then((list) => { _candidates.set(songId, list); return list })
    .catch(() => [])
    .finally(() => { _pending.delete(songId) })
  _pending.set(songId, run)
  return run
}

/** Steps a song onto its next suggested cover and returns it - undefined when
 *  the storage has none, which leaves the song on its own art.
 *
 *  Position is derived by looking the current URL up in the candidate list
 *  rather than from a stored index, so a list that gained or lost files
 *  between plays can't leave the rotation pointing past the end.
 *
 *  Callers gate this on the setting being on and the user not having set their
 *  own cover; this just rotates. */
export async function advanceRotatedCover(songId: number): Promise<string | undefined> {
  const candidates = await getCandidates(songId)
  if (candidates.length === 0) return undefined
  const current = peekRotatedCover(songId)
  const idx = current ? candidates.indexOf(current) : -1
  const next = candidates[(idx + 1) % candidates.length]
  rememberRotatedCover(songId, next)
  return next
}

/** Drops both the remembered choices and the cached searches - used when the
 *  setting is turned off. */
export function resetCoverRotation(): void {
  clearRotatedCovers()
  _candidates.clear()
}
