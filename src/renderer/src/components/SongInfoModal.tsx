import { useEffect, useState, ReactNode } from 'react'
import { ModalOverlay, LockToggle } from './Modal'
import {
  X, Music2, Pencil, Flag,
  Clock, Hash, MicVocal, Music, Wrench, FileText, Piano, MapPin,
  Calendar, CalendarClock, CalendarDays, Droplets, Gauge, Layers,
  GitBranch, Info, StickyNote, Quote, Copy, Download, Loader2, LucideIcon,
  Activity, Music4
} from 'lucide-react'
import { useStore, useStorePick } from '../store/useStore'
import { useDragToDismiss } from '../hooks/useDragToDismiss'
import { useCanEdit } from '../hooks/useChannelRoles'
import { JWApiSong, CATEGORY_LABELS, buildImageUrl, parseDuration, apiFetch, getSongsByIds, resolvePrefCoverUrl } from '../lib/juicewrldApi'
import { versionsEnabled, getVersionGroup, SongVersionMeta } from '../lib/versionsApi'
import { formatDuration } from '../lib/format'
import { copyCoverImage, saveCoverImage } from '../lib/coverImage'
import SongPrefsSection from './SongPrefsSection'
import { ProgressiveCover } from './ProgressiveCover'

const CATEGORY_COLORS: Record<string, string> = {
  released:          'bg-emerald-500/15 text-emerald-400 border-emerald-500/25',
  unreleased:        'bg-blue-500/15 text-blue-400 border-blue-500/25',
  unsurfaced:        'bg-orange-500/15 text-orange-400 border-orange-500/25',
  recording_session: 'bg-purple-500/15 text-purple-400 border-purple-500/25',
}

// One info block styled like the reference design: a squircle icon chip on
// the left, an uppercase tracked label, and the value(s) underneath. The row
// highlights on hover and its values are text-selectable for copying.
function Section({ icon: Icon, label, children }: { icon: LucideIcon; label: string; children: ReactNode }): JSX.Element {
  return (
    <div className="group flex gap-3.5 px-3 py-3 -mx-3 rounded-xl border border-transparent hover:border-[var(--border)] hover:bg-surface-raised transition-colors">
      <div className="shrink-0 w-9 h-9 rounded-xl bg-surface-overlay border border-[var(--border)] flex items-center justify-center text-text-muted group-hover:text-text-primary transition-colors">
        <Icon size={15} strokeWidth={1.75} />
      </div>
      <div className="flex-1 min-w-0 pt-0.5">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-text-muted mb-1.5 select-none">{label}</p>
        <div className="select-text cursor-text">{children}</div>
      </div>
    </div>
  )
}

function TextSection({ icon, label, value, mono = false }: {
  icon: LucideIcon
  label: string
  value: string | null | undefined
  mono?: boolean
}): JSX.Element | null {
  if (!value) return null
  return (
    <Section icon={icon} label={label}>
      <p className={`text-text-primary leading-relaxed whitespace-pre-wrap ${mono ? 'text-[11px] font-mono' : 'text-xs'}`}>
        {value}
      </p>
    </Section>
  )
}

// A "Label: value" line inside a Section that holds several related fields.
function SubVal({ label, value }: { label: string; value: string | null | undefined }): JSX.Element | null {
  if (!value) return null
  return (
    <p className="text-text-primary text-xs leading-relaxed whitespace-pre-wrap">
      <span className="text-text-muted">{label}: </span>{value}
    </p>
  )
}

interface Props {
  song: JWApiSong | null
  onClose: () => void
  onEdit?: (songId: number) => void
}

export default function SongInfoModal({ song, onClose, onEdit }: Props): JSX.Element | null {
  const songPrefs = useStore((s) => s.songPrefs)
  const openReport = useStore((s) => s.openReport)

  // Clicking a linked version swaps the displayed song in place, without the
  // caller needing to manage that - falls back to the `song` prop otherwise.
  const [overrideSong, setOverrideSong] = useState<JWApiSong | null>(null)
  useEffect(() => { setOverrideSong(null) }, [song?.id])
  const displaySong = overrideSong ?? song

  // "Other versions" - a separate database from juicewrldapi.com (see
  // lib/versionsApi.ts), since that API has no concept of grouping e.g.
  // "Song (v1)" / "(v2)" / "(TV Mix)" together as the same underlying song.
  // Linking/unlinking only happens from the editor (Edit song → Versions) -
  // this view is read-only.
  const [versions, setVersions] = useState<{ song: JWApiSong; meta: SongVersionMeta }[]>([])
  const [loadingVersions, setLoadingVersions] = useState(false)

  // Cover art actions (copy to clipboard / save to disk). `coverMsg` briefly
  // takes over the cover tile to report the outcome, since neither action
  // changes anything visible on its own.
  const [coverBusy, setCoverBusy] = useState<'copy' | 'save' | null>(null)
  const [coverMsg, setCoverMsg] = useState<string | null>(null)

  const refreshVersions = (id: number): void => {
    if (!versionsEnabled) return
    setLoadingVersions(true)
    getVersionGroup(id)
      .then(async metas => {
        const songs = await getSongsByIds(metas.map(m => m.songId))
        const byId = new Map(songs.map(s => [s.id, s]))
        return metas
          .map((meta): { song: JWApiSong; meta: SongVersionMeta } | null => {
            const song = byId.get(meta.songId)
            return song ? { song, meta } : null
          })
          .filter((e): e is { song: JWApiSong; meta: SongVersionMeta } => !!e)
      })
      .then(entries => setVersions(entries))
      .finally(() => setLoadingVersions(false))
  }

  useEffect(() => {
    if (displaySong) refreshVersions(displaySong.id)
    else setVersions([])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displaySong?.id])

  const handleViewVersion = async (id: number): Promise<void> => {
    try {
      const s = await apiFetch<JWApiSong>(`/songs/${id}/`)
      setOverrideSong(s)
    } catch {}
  }

  // Swipe-down-to-dismiss on mobile, same curtain gesture as WRLD's full-
  // screen player. Only armed from the hero (cover/header) area - same
  // region the desktop drag-handle uses - so it doesn't fight the scrollable
  // info list below. dragY/dragging get handed to ModalOverlay so it can
  // translate the backdrop *with* the panel - otherwise the panel would slide
  // away while an opaque backdrop stayed put, hiding the app behind it until
  // the modal actually closed.
  // Called before the `!displaySong` early return below (hooks must run
  // unconditionally on every render) even though it's only used once we know
  // we're actually rendering the modal.
  const { dragY, dragging, handlers: dragHandlers } = useDragToDismiss(onClose)

  if (!displaySong) return null

  // The user's per-song override (custom name/cover). Subscribing to the whole
  // map keeps the hero in step when it's edited from the Personalize section
  // below (or another window) - the map's reference only changes on a write,
  // so this modal isn't re-rendering on unrelated store churn.
  const pref = songPrefs[displaySong.id]
  const apiCoverUrl = buildImageUrl(displaySong.image_url)
  const coverUrl = resolvePrefCoverUrl(pref?.cover_url) ?? apiCoverUrl
  const apiPrimaryTitle = displaySong.name
  const primaryTitle = pref?.name || apiPrimaryTitle
  // Every OTHER known title, not just track_titles[1:] - track_titles is an
  // unordered alias list, so its first entry isn't reliably the primary name
  // (see EditorPage's baseline() for the same mismatch). Excluding by value
  // rather than by index keeps a real alias from vanishing off this list just
  // because it happened to sort first.
  const altTitles = (displaySong.track_titles ?? []).filter(t => t && t !== apiPrimaryTitle)
  const duration = formatDuration(parseDuration(displaySong.length), '—')
  const catColor = CATEGORY_COLORS[displaySong.category] ?? 'bg-surface-overlay text-text-muted border-[var(--border)]'
  const catLabel = CATEGORY_LABELS[displaySong.category] ?? displaySong.category

  const hasInstrumentals = displaySong.instrumentals || displaySong.instrumental_names
  const hasSession = displaySong.session_titles || displaySong.session_tracking

  const flashCoverMsg = (msg: string): void => {
    setCoverMsg(msg)
    setTimeout(() => setCoverMsg(null), 1900)
  }

  const runCoverAction = async (kind: 'copy' | 'save'): Promise<void> => {
    if (!coverUrl || coverBusy) return
    setCoverBusy(kind)
    try {
      if (kind === 'copy') {
        await copyCoverImage(coverUrl)
        flashCoverMsg('Copied')
      } else if (await saveCoverImage(coverUrl, primaryTitle) === 'saved') {
        flashCoverMsg('Saved')
      }
    } catch {
      flashCoverMsg(kind === 'copy' ? "Couldn't copy" : "Couldn't save")
    } finally {
      setCoverBusy(null)
    }
  }

  let notesDisplay: string | null = null
  if (displaySong.notes) {
    try {
      const parsed = JSON.parse(displaySong.notes)
      if (typeof parsed === 'object' && parsed !== null) {
        notesDisplay = Object.entries(parsed)
          .filter(([, v]) => v)
          .map(([k, v]) => `${k}: ${v}`)
          .join('\n')
      } else {
        notesDisplay = String(parsed)
      }
    } catch {
      notesDisplay = displaySong.notes
    }
  }

  // ModalOverlay portals to <body> so the overlay is never trapped inside a
  // caller with a CSS transform/animation/overflow (e.g. NowPlaying's
  // slide-in panel) - a transformed ancestor becomes the containing block for
  // position: fixed, which would otherwise render this "modal" clipped
  // inside that panel.
  return (
    <ModalOverlay
      onClose={onClose}
      zIndexClassName="z-[160]"
      panelClassName="bg-surface border border-[var(--border)] rounded-t-2xl md:rounded-2xl shadow-2xl w-full md:max-w-lg max-h-[92svh] md:max-h-[86vh]"
      minWidth={420} minHeight={480}
      dragY={dragY} dragging={dragging}
    >
      {({ onHandleMouseDown, locked, toggleLock, canLock }) => (
      <div
        className="select-text bg-surface w-full flex-1 min-h-0 flex flex-col overflow-hidden"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >

        <div
          className={`relative shrink-0 overflow-hidden ${canLock ? 'cursor-grab active:cursor-grabbing' : ''}`}
          onMouseDown={onHandleMouseDown}
          {...dragHandlers}
        >
          {coverUrl && (
            <div
              className="absolute inset-0 bg-cover bg-center scale-110"
              style={{ backgroundImage: `url(${coverUrl})`, filter: 'blur(24px) brightness(0.35)' }}
            />
          )}
          <div className="absolute inset-0 bg-gradient-to-b from-transparent to-surface" />
          <div className="absolute top-3 right-3 z-10 flex items-center gap-1.5">
            {canLock && (
              <LockToggle
                locked={locked}
                onClick={toggleLock}
                className={`w-7 h-7 flex items-center justify-center rounded-full transition-colors ${
                  locked ? 'bg-accent/80 text-white' : 'bg-black/40 text-white/70 hover:text-white'
                }`}
              />
            )}
            {onEdit && (
              <button
                onClick={() => { onEdit(displaySong.id); onClose() }}
                className="w-7 h-7 flex items-center justify-center rounded-full bg-black/40 text-white/70 hover:text-white transition-colors"
                title="Edit song info"
              >
                <Pencil size={13} />
              </button>
            )}
            <button
              onClick={onClose}
              className="w-7 h-7 flex items-center justify-center rounded-full bg-black/40 text-white/70 hover:text-white transition-colors"
            >
              <X size={15} />
            </button>
          </div>
          <div className="relative flex items-end gap-4 px-5 pt-8 pb-5">
            <div className="relative shrink-0 w-24 h-24 rounded-xl overflow-hidden shadow-2xl bg-surface-overlay">
              {coverUrl ? (
                <ProgressiveCover src={coverUrl} alt={primaryTitle} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <Music2 size={32} className="text-text-muted opacity-30" />
                </div>
              )}
              {coverUrl && (coverMsg ? (
                <div className="absolute inset-0 flex items-center justify-center bg-black/75 px-1 text-center">
                  <span className="text-white text-[10px] font-semibold">{coverMsg}</span>
                </div>
              ) : (
                // Copy/save actions - always visible (no hover on touch),
                // tucked in the bottom-right corner so they don't compete with
                // the cover itself.
                <div className="absolute bottom-1 right-1 flex items-center gap-1">
                  <button
                    onClick={() => runCoverAction('copy')}
                    disabled={!!coverBusy}
                    className="w-6 h-6 flex items-center justify-center rounded-lg bg-black/50 text-white active:bg-black/70 disabled:opacity-50 transition-colors"
                    title="Copy cover image"
                  >
                    {coverBusy === 'copy' ? <Loader2 size={11} className="animate-spin" /> : <Copy size={11} />}
                  </button>
                  <button
                    onClick={() => runCoverAction('save')}
                    disabled={!!coverBusy}
                    className="w-6 h-6 flex items-center justify-center rounded-lg bg-black/50 text-white active:bg-black/70 disabled:opacity-50 transition-colors"
                    title="Save cover image"
                  >
                    {coverBusy === 'save' ? <Loader2 size={11} className="animate-spin" /> : <Download size={11} />}
                  </button>
                </div>
              ))}
            </div>
            <div className="flex-1 min-w-0 pb-0.5">
              <h2 className="text-white font-bold text-xl leading-tight">{primaryTitle}</h2>
              {altTitles.length > 0 && (
                <p className="text-white/50 text-xs mt-0.5 truncate italic">aka {altTitles.join(' · ')}</p>
              )}
              <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${catColor}`}>
                  {catLabel}
                </span>
                {displaySong.era?.name && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/10 text-white/60 border border-white/15">
                    {displaySong.era.name}
                  </span>
                )}
                {displaySong.leak_type && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full text-white/60 border border-white/20">
                    {displaySong.leak_type}
                  </span>
                )}
                {!!parseDuration(displaySong.length) && (
                  <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-black/30 text-white/70 border border-white/15">
                    <Clock size={9} /> {duration}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Scrollable info */}
        <div className="overflow-y-auto flex-1 min-h-0 px-5 py-4">

          <SongPrefsSection
            songId={displaySong.id}
            apiTitle={apiPrimaryTitle}
            apiImageUrl={apiCoverUrl}
            ownImageRaw={displaySong.image_url}
            ownHasFile={!!displaySong.path}
            versions={versions}
            altTitles={altTitles}
          />

          {/* Alt names as chips right under the hero, like the reference -
              they're also what widens the cover picker's search (see
              SongPrefsSection's altTitles prop). */}
          {altTitles.length > 0 && (
            <div className="px-3 py-3 -mx-3 rounded-xl border border-transparent hover:border-[var(--border)] hover:bg-surface-raised transition-colors">
              <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-text-muted mb-2 select-none">
                <Hash size={11} /> Also Known As
              </p>
              <div className="flex flex-wrap gap-1.5">
                {altTitles.map((t) => (
                  <span key={t} className="select-text cursor-text text-xs px-2.5 py-1 rounded-full bg-surface-overlay border border-[var(--border)] text-text-primary">
                    {t}
                  </span>
                ))}
              </div>
            </div>
          )}

          <TextSection icon={MicVocal} label="Credited Artist(s)" value={displaySong.credited_artists || 'Juice WRLD'} />
          <TextSection icon={Music} label="Producer(s)" value={displaySong.producers} />
          <TextSection icon={Wrench} label="Engineer(s)" value={displaySong.engineers} />

          {displaySong.file_names && (
            <Section icon={FileText} label="File Name(s)">
              <p className="text-text-primary text-[11px] font-mono leading-relaxed whitespace-pre-wrap">
                {displaySong.file_names}
              </p>
            </Section>
          )}

          {hasInstrumentals && (
            <Section icon={Piano} label="Instrumental Name(s)">
              <div className="space-y-0.5">
                {displaySong.instrumentals && (
                  <p className="text-text-primary text-xs leading-relaxed whitespace-pre-wrap">{displaySong.instrumentals}</p>
                )}
                {displaySong.instrumental_names && displaySong.instrumental_names !== displaySong.instrumentals && (
                  <p className="text-text-primary text-xs leading-relaxed whitespace-pre-wrap">{displaySong.instrumental_names}</p>
                )}
              </div>
            </Section>
          )}

          <TextSection icon={MapPin} label="Recording Location" value={displaySong.recording_locations} />
          <TextSection icon={Calendar} label="Record Date(s)" value={displaySong.record_dates} />
          <TextSection icon={CalendarClock} label="Preview Date" value={displaySong.preview_date} />
          <TextSection icon={CalendarDays} label="Release Date" value={displaySong.release_date} />
          <TextSection icon={CalendarDays} label="Other Date(s)" value={displaySong.dates} />

          {(displaySong.leak_type || displaySong.date_leaked) && (
            <Section icon={Droplets} label="Leak Info">
              <div className="space-y-0.5">
                <SubVal label="Type" value={displaySong.leak_type} />
                <SubVal label="Date leaked" value={displaySong.date_leaked} />
              </div>
            </Section>
          )}

          <TextSection icon={Gauge} label="Bitrate" value={displaySong.bitrate} />
          <TextSection icon={Activity} label="BPM" value={displaySong.bpm != null ? String(displaySong.bpm) : null} />
          <TextSection icon={Music4} label="Key" value={displaySong.key} />

          {hasSession && (
            <Section icon={Layers} label="Session">
              <div className="space-y-0.5">
                <SubVal label="Titles" value={displaySong.session_titles} />
                <SubVal label="Tracking" value={displaySong.session_tracking} />
              </div>
            </Section>
          )}

          {versionsEnabled && (
            <Section icon={GitBranch} label="Other Versions">
              {loadingVersions ? (
                <p className="text-text-muted text-xs py-0.5">Loading…</p>
              ) : versions.length === 0 ? (
                <p className="text-text-muted text-xs py-0.5">No other versions linked.</p>
              ) : (
                <div className="space-y-1">
                  {versions.map(({ song: v, meta }) => (
                    <button
                      key={v.id}
                      onClick={() => handleViewVersion(v.id)}
                      className="w-full text-left cursor-pointer hover:bg-surface-overlay rounded-lg px-1.5 py-1 -mx-1.5 transition-colors"
                    >
                      <span className="text-text-primary text-xs truncate block">
                        {v.name}
                        {meta.version && <span className="text-text-muted"> ({meta.version}{meta.versionTitle ? ` - ${meta.versionTitle}` : ''})</span>}
                        {!meta.version && meta.versionTitle && <span className="text-text-muted"> ({meta.versionTitle})</span>}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </Section>
          )}

          <TextSection icon={Info} label="Additional Info" value={displaySong.additional_information} />
          <TextSection icon={StickyNote} label="Notes" value={notesDisplay} />

          {displaySong.lyrics && (
            <Section icon={Quote} label="Lyrics">
              <pre className="text-text-secondary text-xs leading-relaxed whitespace-pre-wrap font-sans">
                {displaySong.lyrics}
              </pre>
            </Section>
          )}

          <button
            onClick={() => openReport({ kind: 'song', songId: displaySong.id, songName: apiPrimaryTitle })}
            className="mt-4 w-full flex items-center justify-center gap-2 py-2 rounded-lg border border-[var(--border)] text-text-muted hover:text-text-primary hover:bg-surface-overlay transition-colors text-xs"
          >
            <Flag size={13} /> Report wrong or missing info / lyrics
          </button>

        </div>
      </div>
      )}
    </ModalOverlay>
  )
}

// Global host for the song-info modal, driven purely by `infoSongId` (e.g.
// ChangesFeedPanel opening info for a feed item). Renders nothing until
// something sets it, then fetches that song and shows the modal in-app.
export function GlobalSongInfoHost(): JSX.Element | null {
  const { infoSongId, setInfoSongId } = useStorePick('infoSongId', 'setInfoSongId')
  const [song, setSong] = useState<JWApiSong | null>(null)

  useEffect(() => {
    if (infoSongId == null) { setSong(null); return }
    let stale = false
    apiFetch<JWApiSong>(`/songs/${infoSongId}/`).then((s) => { if (!stale) setSong(s) }).catch(() => {})
    return () => { stale = true }
  }, [infoSongId])

  const canEdit = useCanEdit()

  if (infoSongId == null || !song) return null
  return (
    <SongInfoModal
      song={song}
      onClose={() => setInfoSongId(null)}
      onEdit={canEdit ? (id) => useStore.getState().openSongEditor(id) : undefined}
    />
  )
}
