import { useEffect, useMemo, useState } from 'react'
import type { JWApiSong } from '../lib/juicewrldApi'
import { prefLabel } from '../lib/versionPrefs'
import { loadVersionGroupEntries, type SongVersionEntry } from '../lib/songVersions'
import type { VersionPrefMember } from './useVersionPrefToggles'

interface GroupEntries { self: SongVersionEntry | null; siblings: SongVersionEntry[] }

const NO_ENTRIES: GroupEntries = { self: null, siblings: [] }

// Last result per song, so reopening a versions list shows it instantly
// instead of "Loading…" every time; each mount still refetches in the
// background (stale-while-revalidate), so links/merges made since show up.
const lastEntries = new Map<number, GroupEntries>()

/** Every sibling version of `songId` (lib/songVersions loadVersionGroupEntries),
 *  cached per song, plus the song's own entry (`self`, null when it isn't in
 *  a group). `songId` null = none. Song info lists the siblings as-is;
 *  useSongVersions narrows them to the playable ones. */
export function useVersionEntries(songId: number | null): { entries: SongVersionEntry[] | null; self: SongVersionEntry | null; loading: boolean } {
  const cachedNow = songId != null ? lastEntries.get(songId) : undefined
  const [loading, setLoading] = useState(() => songId != null && !cachedNow)
  const [group, setGroup] = useState<GroupEntries | null>(() => (songId == null ? NO_ENTRIES : cachedNow ?? null))

  useEffect(() => {
    if (songId == null) { setGroup(NO_ENTRIES); setLoading(false); return }
    let cancelled = false
    const cached = lastEntries.get(songId)
    setGroup(cached ?? null)
    setLoading(!cached)
    loadVersionGroupEntries(songId)
      .then(fetched => {
        lastEntries.set(songId, fetched)
        if (!cancelled) setGroup(fetched)
      })
      .catch(() => {
        // A failed refresh keeps a cached list rather than blanking it.
        if (!cancelled && !cached) setGroup(NO_ENTRIES)
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [songId])

  return { entries: group?.siblings ?? null, self: group?.self ?? null, loading }
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

const toOption = ({ song, meta }: SongVersionEntry): SongVersionOption => {
  const version = prefLabel(meta)
  return {
    song,
    version,
    versionTitle: meta.versionTitle,
    label: version ? (meta.versionTitle ? `${version} - ${meta.versionTitle}` : version) : meta.versionTitle,
  }
}

/** The playable sibling versions of `songId` - shared by the context menu's
 *  Change-version panel and WRLD's version notch so both list the same songs
 *  from the same cache. Unplayable ones are left out, since switching to or
 *  starring one would break playback.
 *
 *  `current` is `songId` itself, listed above its siblings so its own
 *  version can be preferred or excluded too (null when it isn't in a group
 *  or can't be played). `members` is the whole group for
 *  useVersionPrefToggles: the siblings plus this song's own row, so a star
 *  stored on it still counts. */
export function useSongVersions(songId: number | null): {
  versions: SongVersionOption[] | null
  current: SongVersionOption | null
  loading: boolean
  members: VersionPrefMember[]
} {
  const { entries, self, loading } = useVersionEntries(songId)

  const versions = useMemo(() => entries && entries.filter(e => e.playable).map(toOption), [entries])
  const current = useMemo(() => (self?.playable ? toOption(self) : null), [self])

  const members = useMemo(
    () => (songId == null ? [] : [
      { songId, version: self ? prefLabel(self.meta) : null },
      ...(versions ?? []).map(v => ({ songId: v.song.id, version: v.version })),
    ]),
    [songId, self, versions]
  )

  return { versions, current, loading, members }
}
