import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Layers, ChevronRight, Loader2, Star } from 'lucide-react'
import { getVersionGroup } from '../lib/versionsApi'
import { getSongsByIds, JWApiSong } from '../lib/juicewrldApi'
import { useStore } from '../store/useStore'
import { useShallow } from 'zustand/react/shallow'
import { placeFlyout } from '../lib/menuFlyout'

interface Props {
  songId: number
  onChangeVersion: (song: JWApiSong) => void
  /** Open state lives in the parent menu so only one submenu is open at a time. */
  open: boolean
  onToggle: () => void
  /** Created by the parent (it hover-tests the row); attached here. */
  itemRef: React.RefObject<HTMLButtonElement>
  /** The menu element this flyout positions itself beside. */
  menuRef: React.RefObject<HTMLElement>
  /** The menu's own position - reposition the flyout when the menu moves. */
  menuPos: { top: number; left: number }
}

interface VersionOption { song: JWApiSong; label: string | null; version: string | null }

/** "Change version" row + submenu for the song context menu (which every view
 *  in the app funnels through - Tracker, Liked Songs, Playlists, Player, WRLD).
 *  Renders as a flyout beside the menu, like "Add to playlist" and "File
 *  actions". The parent owns the open state so only one submenu shows at a
 *  time; everything else (the sibling fetch, its own placement) stays here.
 *  Siblings are fetched lazily on first open rather than eagerly whenever
 *  the parent menu opens - doing that for every song regardless of whether
 *  the user ever clicks this item is exactly the kind of needless-fetch
 *  pattern that made compact view laggy before.
 *
 *  Clicking a sibling's name plays it now (a one-off). The star pins it as the
 *  group's *default* version (lib/songPrefs) so every future play of any
 *  version of this song resolves to it - the persistent counterpart to the
 *  one-off switch, set right where the user is already comparing versions. */
export default function ChangeVersionMenuItem({
  songId, onChangeVersion, open, onToggle, itemRef, menuRef, menuPos,
}: Props): JSX.Element {
  const [loading, setLoading] = useState(false)
  const [versions, setVersions] = useState<VersionOption[] | null>(null)
  const flyoutRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ top: 0, left: 0 })
  const { songPrefs, setSongDefaultVersion } = useStore(
    useShallow((s) => ({
      songPrefs: s.songPrefs,
      setSongDefaultVersion: s.setSongDefaultVersion,
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

  // Siblings load on first open, not when the parent menu mounts - see the
  // needless-fetch note above.
  useEffect(() => {
    if (!open || versions != null || loading) return
    let cancelled = false
    setLoading(true)
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
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [open, songId])

  // Re-placed once the list has loaded, since the flyout's height jumps from
  // the one-line "Loading…" to the full list.
  useLayoutEffect(() => {
    if (!open) return
    const item = itemRef.current, menu = menuRef.current, sub = flyoutRef.current
    if (!item || !menu || !sub) return
    const next = placeFlyout(item, menu, sub)
    setPos(prev => (prev.top === next.top && prev.left === next.left ? prev : next))
  }, [open, loading, versions, menuPos])

  return (
    <>
      <button
        ref={itemRef}
        onClick={(e) => { e.stopPropagation(); onToggle() }}
        className="w-full flex items-center justify-between gap-2.5 px-3 py-2 text-sm text-left text-text-secondary hover:text-text-primary hover:bg-surface-raised transition-colors"
      >
        <span className="flex items-center gap-2.5"><Layers size={14} /> Change version</span>
        <ChevronRight size={13} className="text-text-muted shrink-0" />
      </button>
      {open && (
        // Same flyout treatment as the menu's other submenus: rendered inside
        // the menu element (so its outside-click handler still counts this as
        // "inside") but positioned as a fixed panel beside it.
        <div
          ref={flyoutRef}
          onClick={(e) => e.stopPropagation()}
          style={{ position: 'fixed', zIndex: 10000, top: pos.top, left: pos.left }}
          className="w-52 bg-surface border border-[var(--border)] rounded-xl shadow-2xl overflow-hidden py-1"
        >
          <div className="max-h-44 overflow-y-auto">
          {loading ? (
            <p className="px-3.5 py-2 text-xs text-text-muted flex items-center gap-1.5">
              <Loader2 size={12} className="animate-spin" /> Loading…
            </p>
          ) : !versions || versions.length === 0 ? (
            <p className="px-3.5 py-2 text-xs text-text-muted">No other versions linked.</p>
          ) : (
            versions.map(({ song, label, version }) => {
              const isDefault = !!version && defaultVersion?.toLowerCase() === version.toLowerCase()
              return (
                <div
                  key={song.id}
                  className="w-full flex items-center gap-1 pr-1.5 hover:bg-surface-overlay transition-colors"
                >
                  <button
                    onClick={(e) => { e.stopPropagation(); onChangeVersion(song) }}
                    className="flex-1 min-w-0 text-left pl-3.5 py-2 text-sm text-text-secondary hover:text-text-primary truncate"
                  >
                    {song.name}
                    {label && <span className="text-text-muted text-xs"> - {label}</span>}
                  </button>
                  {version && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        if (!isDefault) { setSongDefaultVersion(songId, version); return }
                        // Unstarring has to clear wherever the label actually
                        // lives (own row or an inherited sibling's) or the
                        // star would stay lit next render.
                        if (songPrefs[songId]?.default_version?.toLowerCase() === version.toLowerCase()) {
                          setSongDefaultVersion(songId, null)
                        }
                        for (const v of versions ?? []) {
                          if (songPrefs[v.song.id]?.default_version?.toLowerCase() === version.toLowerCase()) {
                            setSongDefaultVersion(v.song.id, null)
                          }
                        }
                      }}
                      title={isDefault ? 'Default version - click to unset' : `Always play "${version}" for this song`}
                      className={`shrink-0 w-7 h-7 flex items-center justify-center rounded-md transition-colors ${isDefault ? 'text-accent' : 'text-text-muted hover:text-text-primary'}`}
                    >
                      <Star size={13} fill={isDefault ? 'currentColor' : 'none'} />
                    </button>
                  )}
                </div>
              )
            })
          )}
          </div>
        </div>
      )}
    </>
  )
}
