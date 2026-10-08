import { useEffect, useMemo, useState } from 'react'
import { X, ImageIcon, RotateCcw, Star, Music2, Play, Sparkles } from 'lucide-react'
import { useStore } from '../store/useStore'
import { useShallow } from 'zustand/react/shallow'
import { JWApiSong, resolvePrefCoverUrl, smallCoverUrl } from '../lib/juicewrldApi'
import { getOwnVersionMeta, SongVersionMeta } from '../lib/versionsApi'
import CoverEditor from './CoverEditor'

// The "Personalize" editor shown inside SongInfoModal - the one place a user
// sets the per-song overrides in lib/songPrefs (custom name, custom cover,
// preferred version) and sees their playcount. Everything here writes through
// the store's song-preference actions, which are local-first, so it works
// logged out; the changes propagate to every surface that builds a Track from
// this song (player, queue, lists) on the next render.

interface VersionEntry { song: JWApiSong; meta: SongVersionMeta }

function GroupLabel({ children }: { children: string }): JSX.Element {
  return (
    <p className="text-[10px] font-semibold uppercase tracking-widest text-text-muted pt-4 pb-1.5">
      {children}
    </p>
  )
}

export default function SongPrefsSection({
  songId, apiTitle, apiImageUrl, ownImageRaw, ownHasFile, versions, altTitles = [],
}: {
  songId: number
  /** The song's own primary title - the placeholder/reset target for the name. */
  apiTitle: string
  /** The song's own cover, resolved - the reset target and default swatch. */
  apiImageUrl?: string
  /** The song's own raw image_url (as the API returned it), stored verbatim
   *  when the user picks "this song's cover" so the value matches the backend's
   *  own pointer shape rather than an app-resolved absolute URL. */
  ownImageRaw: string | null
  /** Whether this song has an actual playable file (`song.path`) - recording
   *  sessions and some unsurfaced entries don't. Excluded from the default
   *  version picker below since defaulting to one would leave nothing to play. */
  ownHasFile: boolean
  /** Linked version siblings, already fetched by the modal. */
  versions: VersionEntry[]
  /** This song's other known titles - widens the cover picker's search so
   *  covers filed under an alt name still surface. */
  altTitles?: string[]
}): JSX.Element {
  const { pref, songPrefs, setSongName, setSongCover, setSongDefaultVersion, clearSongPref, account } = useStore(
    useShallow((s) => ({
      pref: s.songPrefs[songId],
      songPrefs: s.songPrefs,
      setSongName: s.setSongName,
      setSongCover: s.setSongCover,
      setSongDefaultVersion: s.setSongDefaultVersion,
      clearSongPref: s.clearSongPref,
      account: s.account,
    }))
  )

  // ── Name ──────────────────────────────────────────────────────────────────
  const [nameDraft, setNameDraft] = useState(pref?.name ?? '')
  // Re-seed when switching songs, or when the stored name changes underneath us
  // (another window edited it, or a save rolled back).
  useEffect(() => { setNameDraft(pref?.name ?? '') }, [pref?.name, songId])
  const commitName = (): void => {
    const next = nameDraft.trim() || null
    if (next !== (pref?.name ?? null)) setSongName(songId, next)
  }

  // ── Own version label ─────────────────────────────────────────────────────
  // The modal hands us the siblings but not the song's own row, so fetch it -
  // needed both to offer "this song" as a default-version choice and to show
  // which label is currently preferred.
  const [ownMeta, setOwnMeta] = useState<SongVersionMeta | null>(null)
  useEffect(() => {
    let alive = true
    getOwnVersionMeta(songId).then((m) => { if (alive) setOwnMeta(m) }).catch(() => {})
    return () => { alive = false }
  }, [songId])

  // ── Default-version choices ───────────────────────────────────────────────
  // One entry per distinct version label across the whole group (this song +
  // siblings). Storing the label (not a song id) is what lets a default set
  // here govern the group no matter which member is played - see queueSlice's
  // groupDefaultVersion.
  const versionChoices = useMemo(() => {
    const out: { label: string; title: string }[] = []
    const seen = new Set<string>()
    const push = (v: string | null | undefined, title: string, hasFile: boolean): void => {
      const label = v?.trim()
      if (!label || !hasFile || seen.has(label.toLowerCase())) return
      seen.add(label.toLowerCase())
      out.push({ label, title })
    }
    push(ownMeta?.version, apiTitle, ownHasFile)
    for (const v of versions) push(v.meta.version, v.song.name, !!v.song.path)
    return out
  }, [ownMeta, versions, apiTitle, ownHasFile])

  // The group's effective default - own row wins if set, else the first
  // sibling that has one - mirrors queueSlice's groupDefaultVersion so this
  // picker highlights the same choice playback will actually resolve to, even
  // when the default was set while viewing a *different* version of this song.
  const groupDefaultVersion = useMemo(() => {
    if (pref?.default_version) return pref.default_version
    for (const v of versions) {
      const d = songPrefs[v.song.id]?.default_version
      if (d) return d
    }
    return null
  }, [pref, versions, songPrefs])

  // Setting a label always writes to this song's own row (it wins per the
  // resolution above). Clearing has to reach wherever the label actually
  // lives - own row or an inherited sibling's - or "unstarring" an inherited
  // default would silently do nothing and the star would stay lit.
  const clearDefaultVersionLabel = (label: string): void => {
    if (pref?.default_version?.toLowerCase() === label.toLowerCase()) setSongDefaultVersion(songId, null)
    for (const v of versions) {
      if (songPrefs[v.song.id]?.default_version?.toLowerCase() === label.toLowerCase()) setSongDefaultVersion(v.song.id, null)
    }
  }

  // "As selected" means no forced default anywhere in the group, not just on
  // this song's own row.
  const clearGroupDefaultVersion = (): void => {
    if (pref?.default_version) setSongDefaultVersion(songId, null)
    for (const v of versions) {
      if (songPrefs[v.song.id]?.default_version) setSongDefaultVersion(v.song.id, null)
    }
  }

  // ── Cover ──────────────────────────────────────────────────────────────────
  const [coverOpen, setCoverOpen] = useState(false)
  const effectiveCover = resolvePrefCoverUrl(pref?.cover_url) ?? apiImageUrl
  const nameOverridden = !!pref?.name
  const coverOverridden = !!pref?.cover_url
  const hasOverrides = nameOverridden || coverOverridden || !!pref?.default_version
  const playcount = pref?.playcount ?? 0

  return (
    <div className="rounded-xl border border-[var(--border)] bg-surface-raised px-4 py-3.5 mt-2 mb-4">
      <div className="flex items-center gap-2">
        <Sparkles size={13} className="text-accent" />
        <span className="text-xs font-semibold text-text-primary">Personalize</span>
        {hasOverrides && (
          <button
            onClick={() => clearSongPref(songId)}
            className="ml-auto flex items-center gap-1 text-[10px] text-text-muted hover:text-red-400 transition-colors"
            title="Remove all personalizations for this song"
          >
            <RotateCcw size={11} /> Reset all
          </button>
        )}
      </div>

      {/* ── Name ── */}
      <GroupLabel>Custom name</GroupLabel>
      <div className="flex items-center gap-1.5">
        <input
          value={nameDraft}
          onChange={(e) => setNameDraft(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.currentTarget.blur() }
            if (e.key === 'Escape') { setNameDraft(pref?.name ?? ''); e.currentTarget.blur() }
          }}
          placeholder={apiTitle}
          className="flex-1 min-w-0 bg-surface border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-xs text-text-primary placeholder:text-text-muted/60 focus:outline-none focus:border-accent/50"
        />
        {nameOverridden && (
          <button
            onClick={() => { setNameDraft(''); setSongName(songId, null) }}
            className="shrink-0 w-7 h-7 flex items-center justify-center rounded-lg text-text-muted hover:text-red-400 hover:bg-surface transition-colors"
            title="Use the original name"
          >
            <X size={13} />
          </button>
        )}
      </div>
      {/* The song's other known titles, one click away - renaming to an alt
          name is the common case, and retyping one by hand is needless. */}
      {altTitles.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-1.5">
          {altTitles.map((alt) => {
            const active = pref?.name === alt
            return (
              <button
                key={alt}
                onClick={() => { setNameDraft(alt); setSongName(songId, alt) }}
                title={`Use "${alt}" as the custom name`}
                className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${active
                  ? 'bg-accent/15 text-accent border-accent/40'
                  : 'text-text-secondary border-[var(--border)] hover:bg-surface'}`}
              >
                {alt}
              </button>
            )
          })}
        </div>
      )}

      {/* ── Cover ── */}
      <GroupLabel>Custom cover</GroupLabel>
      <div className="flex items-center gap-2.5">
        <div className="shrink-0 w-12 h-12 rounded-lg overflow-hidden bg-surface-overlay flex items-center justify-center">
          {effectiveCover ? (
            // Keyed by URL: onError hides the element imperatively, and React
            // would otherwise reuse that hidden node when the cover changes -
            // leaving a working cover invisible after one bad URL.
            <img key={effectiveCover} src={smallCoverUrl(effectiveCover)} alt="" className="w-full h-full object-cover"
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }} />
          ) : (
            <Music2 size={18} className="text-text-muted opacity-30" />
          )}
        </div>
        <button
          onClick={() => setCoverOpen((v) => !v)}
          className="flex items-center gap-1.5 text-xs text-text-secondary hover:text-text-primary px-2.5 py-1.5 rounded-lg border border-[var(--border)] hover:bg-surface transition-colors"
        >
          <ImageIcon size={13} /> {coverOverridden ? 'Change cover' : 'Choose cover'}
        </button>
        {coverOverridden && (
          <button
            onClick={() => setSongCover(songId, null)}
            className="text-[10px] text-text-muted hover:text-red-400 transition-colors"
            title="Use the original cover"
          >
            Reset
          </button>
        )}
      </div>

      {coverOpen && (
        <div className="mt-2.5 rounded-lg border border-[var(--border)] bg-surface p-2.5">
          <CoverEditor
            songId={songId}
            apiTitle={apiTitle}
            ownImageRaw={ownImageRaw}
            versions={versions}
            altTitles={altTitles}
            onPicked={() => setCoverOpen(false)}
          />
        </div>
      )}

      {/* ── Default version ── */}
      {/* A default only means anything when there's more than one label to
          choose between - a single-version song has nothing to default to. */}
      {versionChoices.length > 1 && (
        <>
          <GroupLabel>Default version</GroupLabel>
          <p className="text-[10px] text-text-muted -mt-1 mb-1.5">
            Play this version whenever you pick any version of this song.
          </p>
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={clearGroupDefaultVersion}
              className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${!groupDefaultVersion
                ? 'bg-accent/15 text-accent border-accent/40'
                : 'text-text-secondary border-[var(--border)] hover:bg-surface'}`}
            >
              As selected
            </button>
            {versionChoices.map((c) => {
              const active = groupDefaultVersion?.toLowerCase() === c.label.toLowerCase()
              return (
                <button
                  key={c.label}
                  onClick={() => (active ? clearDefaultVersionLabel(c.label) : setSongDefaultVersion(songId, c.label))}
                  title={c.title}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs border transition-colors ${active
                    ? 'bg-accent/15 text-accent border-accent/40'
                    : 'text-text-secondary border-[var(--border)] hover:bg-surface'}`}
                >
                  <Star size={11} fill={active ? 'currentColor' : 'none'} /> {c.label}
                </button>
              )
            })}
          </div>
        </>
      )}

      {/* ── Playcount ── */}
      <GroupLabel>Your plays</GroupLabel>
      <div className="flex items-center gap-2 text-xs text-text-secondary">
        <Play size={12} className="text-text-muted" fill="currentColor" />
        {playcount > 0
          ? <span>Played <span className="text-text-primary font-semibold">{playcount.toLocaleString()}</span> {playcount === 1 ? 'time' : 'times'}</span>
          : <span className="text-text-muted">Not played yet</span>}
      </div>

      {!account && hasOverrides && (
        <p className="text-[10px] text-text-muted/70 mt-3 leading-relaxed">
          Saved on this device. Log in to sync your personalizations across devices.
        </p>
      )}
    </div>
  )
}
