import { useEffect, useMemo, useState } from 'react'
import type { JWApiSong } from '../lib/juicewrldApi'
import { prefLabel } from '../lib/versionPrefs'
import { loadVersionEntries, type SongVersionEntry } from '../lib/songVersions'
import type { VersionPrefMember } from './useVersionPrefToggles'

// Last result per song, so reopening a versions list shows it instantly
// instead of "Loading…" every time; each mount still refetches in the
// background (stale-while-revalidate), so links/merges made since show up.
const lastEntries = new Map<number, SongVersionEntry[]>()

/** Every sibling version of `songId` (lib/songVersions loadVersionEntries),
 *  cached per song. `songId` null = none. Song info lists these as-is;
 *  useSongVersions narrows them to the playable ones. */
export function useVersionEntries(songId: number | null): { entries: SongVersionEntry[] | null; loading: boolean } {
  const cachedNow = songId != null ? lastEntries.get(songId) : undefined
  const [loading, setLoading] = useState(() => songId != null && !cachedNow)
  const [entries, setEntries] = useState<SongVersionEntry[] | null>(() => (songId == null ? [] : cachedNow ?? null))

  useEffect(() => {
    if (songId == null) { setEntries([]); setLoading(false); return }
    let cancelled = false
    const cached = lastEntries.get(songId)
    setEntries(cached ?? null)
    setLoading(!cached)
    loadVersionEntries(songId)
      .then(fetched => {
        lastEntries.set(songId, fetched)
        if (!cancelled) setEntries(fetched)
      })
      .catch(() => {
        // A failed refresh keeps a cached list rather than blanking it.
        if (!cancelled && !cached) setEntries([])
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [songId])

  return { entries, loading }
}

export interface SongVersionOption {
  song: JWApiSong
  /** The label preferences key it by (lib/versionPrefs prefLabel); null = it
   *  can be neither preferred nor excluded. */
  version: string | null
  /** The group's shared title. */
  versionTitle: string | null
  /** `version - versionTitle`, or whichever of the two exists. */
  label: string | null
}

/** The playable sibling versions of `songId` - shared by the context menu's
 *  Change-version panel and WRLD's version notch so both list the same songs
 *  from the same cache. Unplayable ones are left out, since switching to or
 *  starring one would break playback.
 *
 *  `members` is the whole group for useVersionPrefToggles: the siblings plus
 *  this song's own row, so a star stored on it still counts. */
export function useSongVersions(songId: number | null): {
  versions: SongVersionOption[] | null
  loading: boolean
  members: VersionPrefMember[]
} {
  const { entries, loading } = useVersionEntries(songId)

  const versions = useMemo(() => entries && entries.filter(e => e.playable).map(({ song, meta }): SongVersionOption => {
    const version = prefLabel(meta)
    return {
      song,
      version,
      versionTitle: meta.versionTitle,
      label: version ? (meta.versionTitle ? `${version} - ${meta.versionTitle}` : version) : meta.versionTitle,
    }
  }), [entries])

  const members = useMemo(
    () => (songId == null ? [] : [{ songId, version: null }, ...(versions ?? []).map(v => ({ songId: v.song.id, version: v.version }))]),
    [songId, versions]
  )

  return { versions, loading, members }
}
