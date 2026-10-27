import { Loader2, Star, Ban } from 'lucide-react'
import type { JWApiSong } from '../lib/juicewrldApi'
import { useVersionPrefToggles } from '../hooks/useVersionPrefToggles'
import { useSongVersions, type SongVersionOption } from '../hooks/useSongVersions'

/** The "Change version" second level of SongContextMenu - a flyout on desktop,
 *  a sheet page on touch (`mobile`), one implementation for both.
 *
 *  Siblings are fetched when the panel mounts, which ContextMenu only does once
 *  the row is opened - not eagerly whenever the menu opens. Doing that for
 *  every song regardless of whether the user ever clicks the item is exactly
 *  the needless-fetch pattern that made compact view laggy before. The list
 *  itself comes from useSongVersions, shared with WRLD's version notch.
 *
 *  Clicking a sibling's name plays it now (a one-off). The star marks it as a
 *  *preferred* version (lib/versionPrefs) so any version of this song the app
 *  picks or reaches in the queue resolves to one of the preferred ones (a
 *  version the user clicks still plays as itself) - the persistent counterpart to the
 *  one-off switch, set right where the user is already comparing versions. The
 *  ban excludes it from auto-picking. The song itself heads the list, marked
 *  current, so its own version can be starred or banned from here too. */
export default function ChangeVersionPanel({ songId, onChangeVersion, mobile }: {
  songId: number
  onChangeVersion: (song: JWApiSong) => void
  mobile: boolean
}): JSX.Element {
  const { versions, current, loading, members } = useSongVersions(songId)
  const { isPreferred, isExcluded, togglePreferred, toggleExcluded } = useVersionPrefToggles(members)

  const msg = mobile ? 'px-5 py-3 text-sm text-text-muted' : 'px-3.5 py-2 text-xs text-text-muted'
  if (loading) {
    return <p className={`${msg} flex items-center gap-1.5`}><Loader2 size={mobile ? 14 : 12} className="animate-spin" /> Loading…</p>
  }
  if (!versions || versions.length === 0) return <p className={msg}>No other versions linked.</p>

  const btn = mobile ? 'shrink-0 w-9 h-9 rounded-full' : 'shrink-0 w-7 h-7 rounded-md transition-colors'
  const icon = mobile ? 16 : 13

  const row = ({ song, label, version }: SongVersionOption, isCurrent: boolean): JSX.Element => {
    const isDefault = isPreferred(version)
    const excluded = isExcluded(version)
    const name = (
      <>
        {song.name}
        {label && <span className="text-text-muted text-xs"> - {label}</span>}
      </>
    )
    const nameClass = `flex-1 min-w-0 text-left truncate text-text-primary ${mobile ? 'py-3.5 text-[15px]' : 'pl-3.5 py-2 text-sm'}`
    return (
      <div
        key={song.id}
        className={`flex items-center gap-1 ${mobile ? 'pl-5 pr-3' : `pr-1.5 ${isCurrent ? '' : 'hover:bg-surface-overlay transition-colors'}`}`}
      >
        {isCurrent ? (
          // Already this version, so nothing to switch to.
          <div className={`${nameClass} flex items-center gap-1.5`}>
            <span className="min-w-0 truncate">{name}</span>
            <span className="shrink-0 px-1.5 py-px rounded text-[10px] font-medium text-accent bg-accent/15">Current</span>
          </div>
        ) : (
          <button onClick={() => onChangeVersion(song)} className={nameClass}>
            {name}
          </button>
        )}
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
  }

  return (
    <>
      {current && row(current, true)}
      {versions.map(v => row(v, false))}
    </>
  )
}
