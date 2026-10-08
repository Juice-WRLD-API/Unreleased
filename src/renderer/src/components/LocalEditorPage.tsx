import { useState, useEffect } from 'react'
import { Loader2, Check, AlertCircle, ChevronLeft, Music2, Upload, Trash2, PictureInPicture2, Minimize2, ImageIcon } from 'lucide-react'
import { useStore, useStorePick, IS_FLOAT_WINDOW } from '../store/useStore'
import { attachToMainWindow, broadcastLibraryTrackUpdate } from '../lib/windowSync'
import { LibraryTrack } from '../types'
import { Card, FieldGrid, FieldRow, TextareaRow } from './EditorPage'
import FilePickerModal from './FilePickerModal'
import { ELECTRON_TITLEBAR_CLEARANCE_X } from '../lib/platform'

/* ══════════════════════════════════════════════════════════════════════════════
   Local-file metadata editor — the same full-page editor layout the API editor
   (EditorPage) uses, but with the ID3-tag fields a local file actually has
   (title/artist/album/credits/numbers/lyrics + embedded art) instead of the
   API's era/category/proposal machinery. Reached from the library's context
   menu → "Edit metadata"; writes tags to disk via writeTrackMetadata (MP3) and
   mirrors the change into the in-memory library so the UI updates immediately.
   ══════════════════════════════════════════════════════════════════════════════ */

type LyricsTab = 'lyrics' | 'synced'

interface MetaFields {
  title: string
  artist: string
  album: string
  albumArtist: string
  year: string
  trackNumber: string
  discNumber: string
  composer: string
  genre: string
  bpm: string
  // Additional ID3 text frames — not tracked in the in-memory library index, so
  // they're always seeded empty and populated from what's read off disk.
  conductor: string
  publisher: string
  remixArtist: string
  originalArtist: string
  copyright: string
  grouping: string
  subtitle: string
  initialKey: string
  isrc: string
  mood: string
  encodedBy: string
  comment: string
  lyrics: string
  syncedLyrics: string
  albumArt: string | null
}

const emptyFields = (t: LibraryTrack): MetaFields => ({
  title: t.title, artist: t.artist, album: t.album, albumArtist: t.albumArtist,
  year: t.year ? String(t.year) : '',
  trackNumber: t.trackNumber ? String(t.trackNumber) : '',
  discNumber: t.discNumber ? String(t.discNumber) : '',
  composer: t.composer, genre: t.genre,
  bpm: '', conductor: '', publisher: '', remixArtist: '', originalArtist: '',
  copyright: '', grouping: '', subtitle: '', initialKey: '', isrc: '',
  mood: '', encodedBy: '', comment: '',
  lyrics: '', syncedLyrics: '', albumArt: t.albumArt ?? null,
})

export default function LocalEditorPage(): JSX.Element {
  const el = (window as any).electron
  const { pendingLocalEditTrack: track, setPendingLocalEditTrack, updateLibraryTrack, setActiveView, previousView } = useStorePick('pendingLocalEditTrack', 'setPendingLocalEditTrack', 'updateLibraryTrack', 'setActiveView', 'previousView')
  // "Edit metadata" can be triggered from anywhere a local track shows up
  // (library, now playing, mini player) — return to wherever that was rather
  // than always dumping the user back in the library.
  const backView = previousView && previousView !== 'local-editor' ? previousView : 'library'

  const [loading, setLoading] = useState(true)
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const [lyricsTab, setLyricsTab] = useState<LyricsTab>('lyrics')
  const [original, setOriginal] = useState<MetaFields | null>(null)
  const [fields, setFields]     = useState<MetaFields | null>(null)
  const [showCoverPicker, setShowCoverPicker] = useState(false)
  const [artLoading, setArtLoading] = useState(false)

  // In the pop-out window there's no in-app page to return to — closing the
  // whole window is the equivalent of "back" (mirrors EditorPage's pop-out).
  const goBack = (): void => {
    setPendingLocalEditTrack(null)
    if (IS_FLOAT_WINDOW) { el?.closeSelf?.(); return }
    setActiveView(backView)
  }

  // Load the full tag set off disk (embedded art, lyrics — things the library
  // index doesn't keep in memory) once the target track is known.
  useEffect(() => {
    if (!track) return
    const seed = emptyFields(track)
    setOriginal(seed)
    setFields(seed)
    setLoading(true)
    setError(null)
    if (!el) { setLoading(false); return }
    el.readTrackMetadata(track.filePath).then((meta: Record<string, any> | null) => {
      if (meta && !meta.error) {
        const loaded: MetaFields = {
          title: meta.title || track.title,
          artist: meta.artist || track.artist,
          album: meta.album || track.album,
          albumArtist: meta.albumArtist || track.albumArtist,
          year: meta.year ? String(meta.year) : (track.year ? String(track.year) : ''),
          trackNumber: meta.trackNumber ? String(meta.trackNumber) : (track.trackNumber ? String(track.trackNumber) : ''),
          discNumber: meta.discNumber ? String(meta.discNumber) : (track.discNumber ? String(track.discNumber) : ''),
          composer: meta.composer || track.composer,
          genre: meta.genre || track.genre,
          bpm: meta.bpm || '',
          conductor: meta.conductor || '',
          publisher: meta.publisher || '',
          remixArtist: meta.remixArtist || '',
          originalArtist: meta.originalArtist || '',
          copyright: meta.copyright || '',
          grouping: meta.grouping || '',
          subtitle: meta.subtitle || '',
          initialKey: meta.initialKey || '',
          isrc: meta.isrc || '',
          mood: meta.mood || '',
          encodedBy: meta.encodedBy || '',
          comment: meta.comment || '',
          lyrics: meta.lyrics || '',
          syncedLyrics: meta.syncedLyrics || '',
          albumArt: meta.albumArt || track.albumArt || null,
        }
        setOriginal(loaded)
        setFields(loaded)
      }
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [track?.filePath])

  // Landed here with nothing to edit — send the user back where they came from.
  useEffect(() => {
    if (!track) setActiveView(backView)
  }, [track, setActiveView, backView])

  if (!track || !fields || !original) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 size={20} className="animate-spin text-text-muted" />
      </div>
    )
  }

  const set = (key: keyof MetaFields, val: string | null): void =>
    setFields(f => (f ? { ...f, [key]: val as any } : f))

  const changed = (key: keyof MetaFields): boolean =>
    fields[key] !== original[key] && !(fields[key] === '' && original[key] === '')

  const changedCount = (Object.keys(fields) as (keyof MetaFields)[]).filter(changed).length

  const pickArt = async (): Promise<void> => {
    if (!el) return
    const dataUrl = await el.selectImageFile()
    if (dataUrl) set('albumArt', dataUrl)
  }

  // FilePickerModal hands back an absolute API image URL; the main process
  // downloads it and returns an embeddable JPEG data URL (dodging renderer CORS
  // and capping the size). Fetching remotely can be slow/fail, so it drives a
  // spinner over the art and surfaces any error rather than silently no-op'ing.
  const useApiCover = async (url: string): Promise<void> => {
    setShowCoverPicker(false)
    if (!el?.fetchImageAsDataUrl) return
    setArtLoading(true)
    setError(null)
    try {
      const res = await el.fetchImageAsDataUrl(url)
      if (res?.dataUrl) set('albumArt', res.dataUrl)
      else setError(res?.error || 'Failed to load cover from API')
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load cover from API')
    } finally {
      setArtLoading(false)
    }
  }

  const handleSave = async (): Promise<void> => {
    if (!el || changedCount === 0) return
    // What's on screen is a 512px preview of the embedded cover, not the cover
    // itself (see read-track-metadata's coverToThumbDataUri). Writing it back
    // unconditionally would re-encode the file's full-resolution art down to
    // that preview — and again, a little smaller, on every later save. So the
    // art only travels when the user actually changed it; leaving
    // albumArtBase64 out entirely tells the handler to keep the existing frame.
    const artChanged = fields.albumArt !== original.albumArt
    const common = {
      title: fields.title, artist: fields.artist, album: fields.album,
      albumArtist: fields.albumArtist,
      year: fields.year ? parseInt(fields.year) : null,
      trackNumber: fields.trackNumber ? parseInt(fields.trackNumber) : null,
      discNumber: fields.discNumber ? parseInt(fields.discNumber) : null,
      composer: fields.composer, genre: fields.genre,
      // Same reasoning for the in-memory mirror: updateLibraryTrack treats any
      // albumArt key as an art change and re-keys libraryArt, the queue and the
      // current track off it, so don't hand it one when nothing changed.
      ...(artChanged ? { albumArt: fields.albumArt, hasAlbumArt: !!fields.albumArt } : {}),
    }

    // Tag writing is only implemented for MP3 — for other formats keep the edit
    // in the in-memory index so the UI reflects it, but warn it wasn't persisted.
    if (track.ext !== 'mp3') {
      updateLibraryTrack(track.id, common)
      broadcastLibraryTrackUpdate(track.id, common)
      setError('Metadata writing is only supported for MP3 files. The change is shown here but was not written to disk.')
      return
    }

    setSaving(true)
    setError(null)
    try {
      const result = await el.writeTrackMetadata(track.filePath, {
        title: fields.title, artist: fields.artist, album: fields.album,
        albumArtist: fields.albumArtist,
        year: fields.year ? parseInt(fields.year) : null,
        trackNumber: fields.trackNumber ? parseInt(fields.trackNumber) : null,
        composer: fields.composer, genre: fields.genre,
        bpm: fields.bpm,
        conductor: fields.conductor, publisher: fields.publisher,
        remixArtist: fields.remixArtist, originalArtist: fields.originalArtist,
        copyright: fields.copyright, grouping: fields.grouping,
        subtitle: fields.subtitle, initialKey: fields.initialKey,
        isrc: fields.isrc, mood: fields.mood, encodedBy: fields.encodedBy,
        comment: fields.comment,
        lyrics: fields.lyrics,
        syncedLyrics: fields.syncedLyrics,
        albumArtBase64: fields.albumArt,
      })
      if (result.error) { setError(result.error); return }
      const updates = { ...common, hasAlbumArt: !!fields.albumArt }
      updateLibraryTrack(track.id, updates)
      broadcastLibraryTrackUpdate(track.id, updates)
      goBack()
    } catch (e: any) {
      setError(e?.message ?? 'Failed to save metadata')
    } finally {
      setSaving(false)
    }
  }

  const fileName = track.filePath.split(/[/\\]/).pop()

  return (
    <div className="flex-1 flex flex-col min-h-0">

      {/* Top bar */}
      <div className="shrink-0 flex items-center gap-2 px-5 py-3 border-b border-[var(--border)]" style={el ? { paddingRight: ELECTRON_TITLEBAR_CLEARANCE_X } : undefined}>
        {/* Back — only in the in-app editor; the pop-out window has nowhere to go back to */}
        {!IS_FLOAT_WINDOW && (
          <button onClick={goBack} className="p-1.5 -ml-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-overlay transition-colors shrink-0">
            <ChevronLeft size={16} />
          </button>
        )}
        {/* Manual pop-out — detach the in-app editor into its own window. */}
        {!IS_FLOAT_WINDOW && el?.openFloatWindow && (
          <button
            onClick={() => {
              el.openFloatWindow('local-editor', { trackId: track.id })
              // Clear the in-app editor so the track isn't open in two places.
              setPendingLocalEditTrack(null)
            }}
            title="Open in a separate window"
            className="text-text-muted opacity-65 hover:opacity-100 transition-colors"
          >
            <PictureInPicture2 size={15} />
          </button>
        )}
        {/* Manual attach — from the pop-out window, dock back into the main
            window (opens its in-app editor for this track), then close. */}
        {IS_FLOAT_WINDOW && (
          <button
            onClick={() => {
              attachToMainWindow({ view: 'local-editor', trackId: track.id })
              el?.closeSelf?.()
            }}
            title="Dock into main window"
            className="text-text-muted opacity-65 hover:opacity-100 transition-colors"
          >
            <Minimize2 size={15} />
          </button>
        )}
        <span className="flex-1 font-bold text-[15px] text-text-primary">Edit metadata</span>
        {changedCount > 0 && (
          <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-accent/20 text-accent shrink-0">
            {changedCount} change{changedCount !== 1 ? 's' : ''}
          </span>
        )}
        <span className="text-text-muted opacity-75 text-[10px] uppercase tracking-wider shrink-0">
          {track.ext.toUpperCase()}{track.bitrate ? ` · ${track.bitrate}k` : ''}
        </span>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {loading ? (
          <div className="flex items-center justify-center h-40">
            <Loader2 size={18} className="animate-spin text-text-muted" />
          </div>
        ) : (
          <div className="mx-auto w-full max-w-6xl px-6 py-6">
            <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6 items-start">

              {/* ── Left rail: art + actions ── */}
              <aside className="flex flex-col gap-4 lg:sticky lg:top-6">
                <div className="rounded-2xl border border-[var(--border)] bg-surface-raised/50 overflow-hidden">
                  <div className="relative overflow-hidden">
                    {fields.albumArt && (
                      <img src={fields.albumArt} alt=""
                        className="absolute inset-0 w-full h-full object-cover scale-150 blur-3xl opacity-[0.22] pointer-events-none select-none" />
                    )}
                    <div className="relative flex flex-col items-center gap-3 px-5 pt-6 pb-5">
                      <button onClick={pickArt} title="Change album art" disabled={artLoading}
                        className="w-28 h-28 rounded-xl overflow-hidden shadow-xl ring-1 ring-white/10 relative group bg-surface-overlay flex items-center justify-center">
                        {fields.albumArt
                          ? <img src={fields.albumArt} alt="" className="w-full h-full object-cover" />
                          : <Music2 size={26} className="text-text-muted" />}
                        {artLoading ? (
                          <span className="absolute inset-0 bg-black/60 flex items-center justify-center">
                            <Loader2 size={18} className="text-white animate-spin" />
                          </span>
                        ) : (
                          <span className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                            <Upload size={18} className="text-white" />
                          </span>
                        )}
                      </button>
                      <div className="min-w-0 w-full text-center">
                        <p className="text-text-primary font-bold text-sm leading-snug truncate">
                          {fields.title || track.title || 'Untitled'}
                        </p>
                        <div className="flex items-center justify-center gap-1.5 mt-2 flex-wrap">
                          {fields.genre && (
                            <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-surface-overlay text-text-muted">
                              {fields.genre}
                            </span>
                          )}
                          {fields.album && <span className="text-text-muted opacity-75 text-[11px] truncate">{fields.album}</span>}
                        </div>
                        <p className="text-text-muted opacity-25 text-[11px] truncate mt-1">{fileName}</p>
                      </div>
                      <div className="flex items-center gap-3">
                        <button onClick={() => setShowCoverPicker(true)} disabled={artLoading}
                          className="inline-flex items-center gap-1 text-[11px] text-text-muted opacity-60 hover:opacity-100 hover:text-accent transition-colors disabled:opacity-30 disabled:pointer-events-none">
                          <ImageIcon size={11} /> From API
                        </button>
                        {fields.albumArt && (
                          <button onClick={() => set('albumArt', null)} disabled={artLoading}
                            className="inline-flex items-center gap-1 text-[11px] text-text-muted opacity-60 hover:opacity-100 hover:text-red-400 transition-colors disabled:opacity-30 disabled:pointer-events-none">
                            <Trash2 size={11} /> Remove art
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl border border-[var(--border)] bg-surface-raised/50 p-4 space-y-2.5">
                  {error && (
                    <div className="flex items-center gap-2 text-amber-400 text-xs">
                      <AlertCircle size={12} className="shrink-0" /> <span className="min-w-0">{error}</span>
                    </div>
                  )}
                  {!error && track.ext !== 'mp3' && (
                    <p className="text-text-muted opacity-65 text-[11px]">Note: tag writing is only supported for MP3 files.</p>
                  )}
                  <div className="flex items-center justify-between px-0.5">
                    <span className="text-[11px] text-text-muted opacity-65">Changes</span>
                    <span className={`text-xs font-bold tabular-nums ${changedCount > 0 ? 'text-accent' : 'text-text-muted opacity-30'}`}>
                      {changedCount} field{changedCount !== 1 ? 's' : ''}
                    </span>
                  </div>
                  <button
                    onClick={handleSave}
                    disabled={saving || loading || changedCount === 0}
                    className={`w-full py-2.5 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
                      changedCount === 0 ? 'bg-surface-overlay text-text-muted opacity-30 cursor-not-allowed'
                        : 'bg-accent text-white hover:bg-accent/90 shadow-lg shadow-accent/20'
                    }`}>
                    {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                    {saving ? 'Saving…' : 'Save changes'}
                  </button>
                  <button onClick={goBack}
                    className="w-full py-2 rounded-xl text-xs font-semibold text-text-muted hover:text-text-primary hover:bg-surface-overlay transition-colors">
                    Cancel
                  </button>
                </div>
              </aside>

              {/* ── Right: field cards ── */}
              <div className="flex flex-col gap-5 min-w-0">
                <Card title="Identity">
                  <FieldGrid>
                    <FieldRow label="Title"       value={fields.title}       original={original.title}       onChange={v => set('title', v)} />
                    <FieldRow label="Artist"      value={fields.artist}      original={original.artist}      onChange={v => set('artist', v)} />
                    <FieldRow label="Album"       value={fields.album}       original={original.album}       onChange={v => set('album', v)} />
                    <FieldRow label="Alb. Artist" value={fields.albumArtist} original={original.albumArtist} onChange={v => set('albumArtist', v)} />
                  </FieldGrid>
                </Card>

                <Card title="Credits">
                  <FieldGrid>
                    <FieldRow label="Composer"        value={fields.composer}       original={original.composer}       onChange={v => set('composer', v)} />
                    <FieldRow label="Genre"           value={fields.genre}          original={original.genre}          onChange={v => set('genre', v)} />
                    <FieldRow label="Conductor"       value={fields.conductor}      original={original.conductor}      onChange={v => set('conductor', v)} />
                    <FieldRow label="Publisher"       value={fields.publisher}      original={original.publisher}      onChange={v => set('publisher', v)} />
                    <FieldRow label="Remix Artist"    value={fields.remixArtist}    original={original.remixArtist}    onChange={v => set('remixArtist', v)} />
                    <FieldRow label="Original Artist" value={fields.originalArtist} original={original.originalArtist} onChange={v => set('originalArtist', v)} />
                  </FieldGrid>
                </Card>

                <Card title="Numbers">
                  <FieldGrid cols={3}>
                    <FieldRow label="Year"    value={fields.year}        original={original.year}        onChange={v => set('year', v)}        placeholder="2019" mono />
                    <FieldRow label="Track #" value={fields.trackNumber} original={original.trackNumber} onChange={v => set('trackNumber', v)} placeholder="1" mono />
                    <FieldRow label="Disc #"  value={fields.discNumber}  original={original.discNumber}  onChange={v => set('discNumber', v)}  placeholder="1" mono />
                    <FieldRow label="BPM"     value={fields.bpm}         original={original.bpm}         onChange={v => set('bpm', v)}         placeholder="120" mono />
                    <FieldRow label="Key"     value={fields.initialKey}  original={original.initialKey}  onChange={v => set('initialKey', v)}  placeholder="A Minor" />
                    <FieldRow label="ISRC"    value={fields.isrc}        original={original.isrc}        onChange={v => set('isrc', v)}        placeholder="US-XXX-00-00000" mono />
                  </FieldGrid>
                </Card>

                <Card title="Details">
                  <FieldGrid>
                    <FieldRow label="Grouping"  value={fields.grouping}  original={original.grouping}  onChange={v => set('grouping', v)} />
                    <FieldRow label="Mood"      value={fields.mood}      original={original.mood}      onChange={v => set('mood', v)} />
                    <FieldRow label="Subtitle"  value={fields.subtitle}  original={original.subtitle}  onChange={v => set('subtitle', v)} span={2} />
                    <FieldRow label="Copyright" value={fields.copyright} original={original.copyright} onChange={v => set('copyright', v)} span={2} />
                    <FieldRow label="Encoded By" value={fields.encodedBy} original={original.encodedBy} onChange={v => set('encodedBy', v)} span={2} />
                    <TextareaRow label="Comment" value={fields.comment} original={original.comment} onChange={v => set('comment', v)} rows={4} placeholder="Free-form comment…" span={2} />
                  </FieldGrid>
                </Card>

                <Card
                  title="Lyrics"
                  action={
                    <div className="flex items-center gap-1">
                      {(['lyrics', 'synced'] as LyricsTab[]).map(tab => {
                        const active = lyricsTab === tab
                        const dirty = tab === 'lyrics' ? changed('lyrics') : changed('syncedLyrics')
                        return (
                          <button key={tab} onClick={() => setLyricsTab(tab)}
                            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all ${
                              active ? 'bg-surface-overlay text-text-primary' : 'text-text-muted opacity-75 hover:text-text-muted'
                            }`}>
                            {tab === 'lyrics' ? 'Lyrics' : 'Synced'}
                            {dirty && <span className="w-1 h-1 rounded-full bg-accent inline-block" />}
                          </button>
                        )
                      })}
                    </div>
                  }
                >
                  {lyricsTab === 'lyrics' ? (
                    <textarea
                      rows={14} value={fields.lyrics} onChange={e => set('lyrics', e.target.value)}
                      placeholder="Full lyrics…"
                      className={`w-full bg-surface-overlay/70 rounded-xl px-3.5 py-3 text-sm text-text-primary focus:outline-none resize-none placeholder:text-text-muted placeholder:opacity-25 border transition-colors leading-relaxed ${
                        changed('lyrics') ? 'border-accent/40' : 'border-[var(--border)] focus:border-accent/40'
                      }`}
                    />
                  ) : (
                    <textarea
                      rows={14} value={fields.syncedLyrics} onChange={e => set('syncedLyrics', e.target.value)}
                      placeholder={'[00:00.00] Line one\n[00:05.20] Line two\n…'}
                      className={`w-full bg-surface-overlay/70 rounded-xl px-3.5 py-3 text-sm font-mono text-text-primary focus:outline-none resize-none placeholder:text-text-muted placeholder:opacity-25 border transition-colors ${
                        changed('syncedLyrics') ? 'border-accent/40' : 'border-[var(--border)] focus:border-accent/40'
                      }`}
                    />
                  )}
                </Card>
              </div>
            </div>
          </div>
        )}
      </div>

      {showCoverPicker && (
        <FilePickerModal
          songTitle={fields.title || track.title}
          onSelect={useApiCover}
          onClose={() => setShowCoverPicker(false)}
        />
      )}
    </div>
  )
}
