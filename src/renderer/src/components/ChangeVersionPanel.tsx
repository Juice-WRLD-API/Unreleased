import { useEffect, useMemo, useState } from 'react'
import { Loader2, Star, Ban } from 'lucide-react'
import { getVersionGroup } from '../lib/versionsApi'
import { getSongsByIds, JWApiSong } from '../lib/juicewrldApi'
import { useStore } from '../store/useStore'
import { useShallow } from 'zustand/react/shallow'

interface VersionOption { song: JWApiSong; label: string | null; version: string | null }

/** The "Change version" second level of SongContextMenu - a flyout on desktop,
 *  a sheet page on touch (`mobile`), one implementation for both.
 *
 *  Siblings are fetched when the panel mounts, which ContextMenu only does once
 *  the row is opened - not eagerly whenever the menu opens. Doing that for
 *  every song regardless of whether the user ever clicks the item is exactly
 *  the needless-fetch pattern that made compact view laggy before.
 *
 *  Clicking a sibling's name plays it now (a one-off). The star pins it as the
 *  group's *default* version (lib/songPrefs) so every future play of any
 *  version of this song resolves to it - the persistent counterpart to the
 *  one-off switch, set right where the user is already comparing versions. The
 *  ban excludes it from auto-picking. */
export default function ChangeVersionPanel({ songId, onChangeVersion, mobile }: {
  songId: number
  onChangeVersion: (song: JWApiSong) => void
  mobile: boolean
}): JSX.Element {
  const [loading, setLoading] = useState(true)
  const [versions, setVersions] = useState<VersionOption[] | null>(null)
  const { songPrefs, setSongDefaultVersion, setSongExcludedVersions } = useStore(
    useShallow((s) => ({
      songPrefs: s.songPrefs,
      setSongDefaultVersion: s.setSongDefaultVersion,
      setSongExcludedVersions: s.setSongExcludedVersions,
    }))
  )

  // Own row wins if set, else the first sibling that has one - mirrors
  // queueSlice's groupDefaultVersion so the star here matches what playback
  // actually resolves to, even when the default was set from a *different*
  // version's own menu rather than this song's.
  const defaultVersion = useMemo(() => {
    const own = songPrefs[songId]?.default_version
    if (own) return own
    for (const v of versions ?? []) {
      const d = songPrefs[v.song.id]?.default_version
      if (d) return d
    }
    return null
  }, [songPrefs, songId, versions])

  // Union of every member's excluded labels - exclusion, like the default
  // version, is really a property of the whole group (queueSlice's
  // groupExcludedVersions mirrors this for the actual shuffle-play filter).
  const excludedVersions = useMemo(() => {
    const set = new Set<string>()
    for (const label of songPrefs[songId]?.excluded_versions ?? []) set.add(label.toLowerCase())
    for (const v of versions ?? []) {
      for (const label of songPrefs[v.song.id]?.excluded_versions ?? []) set.add(label.toLowerCase())
    }
    return set
  }, [songPrefs, songId, versions])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const metas = await getVersionGroup(songId)
        const songs = await getSongsByIds(metas.map(m => m.songId))
        const byId = new Map(songs.map(s => [s.id, s]))
        // Songs with no `path` (recording sessions, some unsurfaced entries)
        // have nothing to actually play - hidden here since both switching to
        // one and starring it as the group default would break playback.
        const fetched = metas
          .map((m): VersionOption | null => {
            const song = byId.get(m.songId)
            if (!song?.path) return null
            return {
              song,
              version: m.version,
              label: m.version
                ? (m.versionTitle ? `${m.version} - ${m.versionTitle}` : m.version)
                : m.versionTitle,
            }
          })
          .filter((v): v is VersionOption => !!v)
        if (!cancelled) setVersions(fetched)
      } catch {
        if (!cancelled) setVersions([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [songId])

  const toggleDefault = (version: string, isDefault: boolean): void => {
    if (!isDefault) { setSongDefaultVersion(songId, version); return }
    // Unstarring has to clear wherever the label actually lives (own row or an
    // inherited sibling's) or the star would stay lit next render.
    if (songPrefs[songId]?.default_version?.toLowerCase() === version.toLowerCase()) setSongDefaultVersion(songId, null)
    for (const v of versions ?? []) {
      if (songPrefs[v.song.id]?.default_version?.toLowerCase() === version.toLowerCase()) setSongDefaultVersion(v.song.id, null)
    }
  }

  const toggleExcluded = (version: string, isExcluded: boolean): void => {
    const label = version.toLowerCase()
    if (!isExcluded) {
      setSongExcludedVersions(songId, [...(songPrefs[songId]?.excluded_versions ?? []), version])
      return
    }
    // Un-excluding clears wherever the label actually lives, same reasoning as
    // the star above.
    const own = songPrefs[songId]?.excluded_versions ?? []
    if (own.some(v => v.toLowerCase() === label)) setSongExcludedVersions(songId, own.filter(v => v.toLowerCase() !== label))
    for (const v of versions ?? []) {
      const sib = songPrefs[v.song.id]?.excluded_versions ?? []
      if (sib.some(x => x.toLowerCase() === label)) setSongExcludedVersions(v.song.id, sib.filter(x => x.toLowerCase() !== label))
    }
  }

  const msg = mobile ? 'px-5 py-3 text-sm text-text-muted' : 'px-3.5 py-2 text-xs text-text-muted'
  if (loading) {
    return <p className={`${msg} flex items-center gap-1.5`}><Loader2 size={mobile ? 14 : 12} className="animate-spin" /> Loading…</p>
  }
  if (!versions || versions.length === 0) return <p className={msg}>No other versions linked.</p>

  const btn = mobile ? 'shrink-0 w-9 h-9 rounded-full' : 'shrink-0 w-7 h-7 rounded-md transition-colors'
  const icon = mobile ? 16 : 13

  return (
    <>
      {versions.map(({ song, label, version }) => {
        const isDefault = !!version && defaultVersion?.toLowerCase() === version.toLowerCase()
        const isExcluded = !!version && excludedVersions.has(version.toLowerCase())
        return (
          <div
            key={song.id}
            className={`flex items-center gap-1 ${mobile ? 'pl-5 pr-3' : 'pr-1.5 hover:bg-surface-overlay transition-colors'}`}
          >
            <button
              onClick={() => onChangeVersion(song)}
              className={`flex-1 min-w-0 text-left truncate text-text-primary ${mobile ? 'py-3.5 text-[15px]' : 'pl-3.5 py-2 text-sm'}`}
            >
              {song.name}
              {label && <span className="text-text-muted text-xs"> - {label}</span>}
            </button>
            {version && (
              <button
                onClick={() => toggleDefault(version, isDefault)}
                title={isDefault ? 'Default version - click to unset' : `Always play "${version}" for this song`}
                className={`${btn} flex items-center justify-center ${isDefault ? 'text-accent' : 'text-text-muted hover:text-text-primary'}`}
              >
                <Star size={icon} fill={isDefault ? 'currentColor' : 'none'} />
              </button>
            )}
            {version && (
              <button
                onClick={() => toggleExcluded(version, isExcluded)}
                title={isExcluded ? 'Excluded - click to allow again' : `Never auto-pick "${version}" for this song`}
                className={`${btn} flex items-center justify-center ${isExcluded ? 'text-red-400' : 'text-text-muted hover:text-text-primary'}`}
              >
                <Ban size={icon} />
              </button>
            )}
          </div>
        )
      })}
    </>
  )
}
