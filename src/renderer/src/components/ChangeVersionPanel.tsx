import { useEffect, useMemo, useState } from 'react'
import { Loader2, Star, Ban } from 'lucide-react'
import { getVersionGroup } from '../lib/versionsApi'
import { getSongsByIds, JWApiSong } from '../lib/juicewrldApi'
import { useVersionPrefToggles } from '../hooks/useVersionPrefToggles'

interface VersionOption { song: JWApiSong; label: string | null; version: string | null }

/** The "Change version" second level of SongContextMenu - a flyout on desktop,
 *  a sheet page on touch (`mobile`), one implementation for both.
 *
 *  Siblings are fetched when the panel mounts, which ContextMenu only does once
 *  the row is opened - not eagerly whenever the menu opens. Doing that for
 *  every song regardless of whether the user ever clicks the item is exactly
 *  the needless-fetch pattern that made compact view laggy before.
 *
 *  Clicking a sibling's name plays it now (a one-off). The star marks it as a
 *  *preferred* version (lib/versionPrefs) so every future play of any version
 *  of this song resolves to one of the preferred ones - the persistent counterpart to the
 *  one-off switch, set right where the user is already comparing versions. The
 *  ban excludes it from auto-picking. */
export default function ChangeVersionPanel({ songId, onChangeVersion, mobile }: {
  songId: number
  onChangeVersion: (song: JWApiSong) => void
  mobile: boolean
}): JSX.Element {
  const [loading, setLoading] = useState(true)
  const [versions, setVersions] = useState<VersionOption[] | null>(null)
  // The panel only lists siblings, so this song's own row joins them for the
  // group-wide preferred/excluded union (its label isn't needed for that).
  const members = useMemo(
    () => [{ songId, version: null }, ...(versions ?? []).map(v => ({ songId: v.song.id, version: v.version }))],
    [songId, versions]
  )
  const { isPreferred, isExcluded, togglePreferred, toggleExcluded } = useVersionPrefToggles(members)

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
        const isDefault = isPreferred(version)
        const excluded = isExcluded(version)
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
                onClick={() => togglePreferred({ songId: song.id, version })}
                title={isDefault ? 'Preferred version - click to unset' : `Prefer "${version}" for this song (several preferred = one picked at random)`}
                className={`${btn} flex items-center justify-center ${isDefault ? 'text-accent' : 'text-text-muted hover:text-text-primary'}`}
              >
                <Star size={icon} fill={isDefault ? 'currentColor' : 'none'} />
              </button>
            )}
            {version && (
              <button
                onClick={() => toggleExcluded({ songId: song.id, version })}
                title={excluded ? 'Excluded - click to allow again' : `Never auto-pick "${version}" for this song`}
                className={`${btn} flex items-center justify-center ${excluded ? 'text-red-400' : 'text-text-muted hover:text-text-primary'}`}
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
