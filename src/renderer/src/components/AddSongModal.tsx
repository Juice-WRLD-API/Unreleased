import { MotionOverlay } from './MotionOverlay'
import { useRef, useState } from 'react'
import { Loader2, Plus, X, Check, AlertCircle, Wand2 } from 'lucide-react'
import { hasEraCoverFile, findEraCoverFile } from '../lib/eraCoverFiles'
import { errorMessage } from '../lib/format'
import { toSiteRelativeImageUrl } from '../lib/juicewrldApi'
import FilePickerModal from './FilePickerModal'
import { BasicRow, BasicSelect, SyncedLyricsTable } from './EditorPage'
import CopyFromSong from './CopyFromSong'
import { useAddSongModal } from '../hooks/useAddSongModal'
import { useEscapeToClose } from '../hooks/useEscapeToClose'

const CATEGORIES = [
  { value: 'released', label: 'Released' },
  { value: 'unreleased', label: 'Unreleased' },
  { value: 'unsurfaced', label: 'Unsurfaced' },
  { value: 'recording_session', label: 'Session' },
]

// A small uppercase caption divider between field groups, matching the rest
// of the profile's `text-[10px] font-bold uppercase tracking-widest
// text-text-muted` convention.
function SectionLabel({ children }: { children: string }): JSX.Element {
  return <p className="text-[10px] font-bold uppercase tracking-widest text-text-muted pt-3 pb-0.5 first:pt-0">{children}</p>
}

export default function AddSongModal({ onClose, onSubmitted, channel }: {
  onClose: () => void
  onSubmitted: () => void
  channel?: string
}): JSX.Element {
  const {
    f, updateField, copiedFrom, setCopiedFrom, syncedTable, setSyncedTable,
    pickingFile, setPickingFile, eras, submitState, submitError, edNotes, setEdNotes, copyFrom, handleSubmit,
  } = useAddSongModal(onSubmitted, onClose, channel)
  const overlayRef = useRef<HTMLDivElement>(null)
  const [coverBusy, setCoverBusy] = useState(false)
  const [coverError, setCoverError] = useState<string | null>(null)
  const [pickingImage, setPickingImage] = useState(false)

  useEscapeToClose(onClose)

  const era = eras.find(e => String(e.id) === f.eraId)
  const eraHasCover = hasEraCoverFile(era?.name)
  const fillEraCover = async (): Promise<void> => {
    setCoverBusy(true); setCoverError(null)
    try {
      const path = await findEraCoverFile(era?.name)
      if (path) updateField('imageUrl', path)
      else setCoverError(`No cover found for ${era?.name}`)
    } catch (e) {
      setCoverError(errorMessage(e, 'Could not look up the era cover'))
    } finally {
      setCoverBusy(false)
    }
  }

  return (
    <MotionOverlay ref={overlayRef} className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={e => { if (e.target === overlayRef.current) onClose() }}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div role="dialog" aria-label="Propose new song" className="relative w-full max-w-4xl bg-[var(--surface)] rounded-2xl shadow-2xl border border-[var(--border)] flex flex-col max-h-[92dvh]">
        {/* Header */}
        <div className="flex items-center gap-3 px-5 pt-4 pb-3.5 border-b border-[var(--border)] shrink-0">
          <div className="w-9 h-9 rounded-2xl bg-accent/15 border border-accent/20 flex items-center justify-center shrink-0">
            <Plus size={16} className="text-accent" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-text-primary font-bold text-sm">Propose new song</p>
            <p className="text-text-muted text-xs opacity-60 mt-0.5">Admins review and add it to the database. Every field takes several lines.</p>
          </div>
          <button onClick={onClose} title="Close" className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-[var(--surface-overlay)] transition-colors shrink-0">
            <X size={15} />
          </button>
        </div>

        {/* Scrollable fields: every field is shown at once, grouped, with the
            same inputs as the editor's Basic view. */}
        <div className="flex-1 overflow-y-auto min-h-0 px-5 py-4 flex flex-col gap-1.5">
          <CopyFromSong onCopy={copyFrom} copiedFrom={copiedFrom} onClear={() => setCopiedFrom(null)} variant="desktop" />

          <SectionLabel>Song</SectionLabel>
          <BasicRow label="Name *" value={f.name} onChange={v => updateField('name', v)} placeholder="Song title" rows={2} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            <BasicSelect
              label="Era" value={f.eraId} original="" onChange={v => updateField('eraId', v)}
              options={eras.map(e => ({ value: String(e.id), label: e.name }))}
            />
            <BasicSelect label="Category" value={f.cat} original="" onChange={v => updateField('cat', v)} options={CATEGORIES} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            <BasicRow label="Album" value={f.album} onChange={v => updateField('album', v)} placeholder="Album name" rows={2} suggest="album" />
            <BasicRow label="Alternate titles (one per line)" value={f.altNames} onChange={v => updateField('altNames', v)} rows={2} />
          </div>
          <BasicRow label="Credited artists" value={f.artists} onChange={v => updateField('artists', v)} placeholder="Juice WRLD ft. …" rows={2} suggest="credited_artists" />

          <SectionLabel>Credits</SectionLabel>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            <BasicRow label="Producers" value={f.prod} onChange={v => updateField('prod', v)} placeholder="Producer names" rows={2} suggest="producers" />
            <BasicRow label="Engineers" value={f.engineer} onChange={v => updateField('engineer', v)} placeholder="Engineer names" rows={2} suggest="engineers" />
          </div>
          <BasicRow label="Recording locations" value={f.location} onChange={v => updateField('location', v)} rows={2} placeholder="Studio / city" suggest="recording_locations" />
          {f.cat === 'recording_session' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              <BasicRow label="Session titles" value={f.sessionTitles} onChange={v => updateField('sessionTitles', v)} rows={2} />
              <BasicRow label="Session tracking" value={f.sessionTracking} onChange={v => updateField('sessionTracking', v)} rows={2} />
            </div>
          )}

          <SectionLabel>Dates</SectionLabel>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            <BasicRow label="Record dates" value={f.recDate} onChange={v => updateField('recDate', v)} rows={2} placeholder="Recorded&#10;August 1-2, 2016." mono dateInput />
            <BasicRow label="Date leaked" value={f.dateLeaked} onChange={v => updateField('dateLeaked', v)} rows={2} placeholder="Surfaced January 25th 2026" mono dateInput />
            <BasicRow label="Preview date" value={f.previewDate} onChange={v => updateField('previewDate', v)} rows={2} mono dateInput />
            <BasicRow label="Release date" value={f.relDate} onChange={v => updateField('relDate', v)} rows={2} mono dateInput />
          </div>

          <SectionLabel>Audio</SectionLabel>
          <div className="grid grid-cols-3 gap-1.5">
            <BasicRow label="Length" value={f.songLength} onChange={v => updateField('songLength', v)} placeholder="3:59" mono />
            <BasicRow label="BPM" value={f.bpm} onChange={v => updateField('bpm', v)} placeholder="140" mono />
            <BasicRow label="Key" value={f.musicalKey} onChange={v => updateField('musicalKey', v)} placeholder="C# Minor" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            <BasicRow label="Bitrate" value={f.bitrate} onChange={v => updateField('bitrate', v)} rows={2} placeholder="Original File&#10;320kbps (.mp3)" mono />
            <BasicRow label="File names" value={f.fileNames} onChange={v => updateField('fileNames', v)} rows={2} />
            <BasicRow label="Leak type" value={f.leakType} onChange={v => updateField('leakType', v)} rows={2} placeholder="e.g. Stem, Master, Video…" suggest="leak_type" />
            <BasicRow label="Instrumentals" value={f.instrumentals} onChange={v => updateField('instrumentals', v)} rows={2} placeholder="Instrumental versions available" />
            <BasicRow label="Instrumental names" value={f.instrumentalNames} onChange={v => updateField('instrumentalNames', v)} rows={2} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            <BasicRow label="Image URL" value={f.imageUrl} onChange={v => updateField('imageUrl', v)} placeholder="https://…" mono
              onBrowse={() => setPickingImage(true)}
              trailing={
                <button
                  type="button"
                  onClick={e => { e.preventDefault(); void fillEraCover() }}
                  disabled={!eraHasCover || coverBusy}
                  title={!era ? 'Pick an era first' : eraHasCover ? `Use the ${era.name} cover from Cover Art / Unreleased Discography` : `No cover for ${era.name} in Unreleased Discography`}
                  className="shrink-0 -my-0.5 flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold text-text-muted hover:text-text-primary hover:bg-surface-overlay disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-text-muted transition-colors"
                >
                  {coverBusy ? <Loader2 size={11} className="animate-spin" /> : <Wand2 size={11} />}
                  From era
                </button>
              } />
            <BasicRow label="File path" value={f.filePath} onChange={v => updateField('filePath', v)} placeholder="Path to the audio file" mono onBrowse={() => setPickingFile(true)} />
          </div>

          <SectionLabel>Notes</SectionLabel>
          <BasicRow label="Additional information" value={f.addInfo} onChange={v => updateField('addInfo', v)} rows={3} placeholder="Any other info…" />
          <BasicRow label="Notes" value={f.notes} onChange={v => updateField('notes', v)} rows={2} placeholder="Internal notes…" />

          <SectionLabel>Lyrics</SectionLabel>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5 items-start">
            <BasicRow label="Lyrics" value={f.lyrics} onChange={v => updateField('lyrics', v)} rows={10} placeholder="Plain lyrics…" />

            {/* Synced lyrics get the editor's line table, with the same raw
                escape hatch for pasting a whole LRC at once. */}
            <div className="rounded-md border border-[var(--border)] bg-[var(--surface-overlay)]/60 px-2.5 py-1.5 focus-within:border-accent/50 transition-colors">
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-semibold tracking-wide text-text-muted leading-tight">Synced lyrics</span>
                <span className="flex-1" />
                <button
                  onClick={() => { setSyncedTable(v => !v); localStorage.setItem('editor:syncedFormat', syncedTable ? 'raw' : 'table') }}
                  className="px-1.5 py-0.5 rounded text-[10px] font-semibold text-text-muted opacity-60 hover:opacity-100 transition-opacity">
                  {syncedTable ? 'Raw' : 'Lines'}
                </button>
              </div>
              {syncedTable ? (
                <SyncedLyricsTable value={f.syncedLyrics} onChange={v => updateField('syncedLyrics', v)} />
              ) : (
                <textarea rows={10} value={f.syncedLyrics} onChange={e => updateField('syncedLyrics', e.target.value)} placeholder="[mm:ss.xx] line…"
                  className="w-full bg-transparent border-0 p-0 mt-1 text-xs font-mono leading-snug text-text-primary focus:outline-none resize-y placeholder:text-text-muted placeholder:opacity-40" />
              )}
            </div>
          </div>
        </div>

        {/* Footer: notes, error and submit share one row on wide screens */}
        <div className="shrink-0 border-t border-[var(--border)] px-5 py-3.5 flex flex-col gap-2.5">
          {(submitError || coverError) && (
            <div className="flex items-center gap-2 text-red-400 text-xs">
              <AlertCircle size={12} className="shrink-0" /> {submitError || coverError}
            </div>
          )}
          <div className="flex flex-col sm:flex-row gap-2.5">
            <input value={edNotes} onChange={e => setEdNotes(e.target.value)} placeholder="Editor notes (optional)…"
              className="flex-1 min-w-0 bg-[var(--surface-overlay)] border border-[var(--border)] rounded-xl px-3 py-2 text-xs text-text-primary placeholder:text-text-muted placeholder:opacity-30 focus:outline-none focus:border-accent/40 transition-colors" />
            <button onClick={handleSubmit} disabled={!f.name.trim() || submitState === 'submitting' || submitState === 'submitted'}
              className={`sm:w-52 py-2.5 rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2 ${
                submitState === 'submitted' ? 'bg-emerald-500/20 text-emerald-400' :
                submitState === 'error'     ? 'bg-red-500/20 text-red-400' :
                !f.name.trim()              ? 'bg-[var(--surface-overlay)] text-text-muted opacity-40 cursor-not-allowed' :
                'bg-accent text-white hover:bg-accent/90 shadow-lg shadow-accent/20'
              }`}>
              {submitState === 'submitting' && <Loader2 size={14} className="animate-spin" />}
              {submitState === 'submitted'  && <Check size={14} />}
              {submitState === 'error'      && <AlertCircle size={14} />}
              {submitState === 'idle'       && 'Submit proposal'}
              {submitState === 'submitting' && 'Submitting…'}
              {submitState === 'submitted'  && 'Submitted!'}
              {submitState === 'error'      && 'Try again'}
            </button>
          </div>
        </div>
      </div>

      {pickingFile && (
        <FilePickerModal
          kind="audio"
          songTitle={f.name}
          altTitles={f.altNames.split('\n').map(s => s.trim()).filter(Boolean)}
          onSelect={p => { updateField('filePath', p); setPickingFile(false) }}
          onClose={() => setPickingFile(false)}
        />
      )}

      {pickingImage && (
        <FilePickerModal
          kind="image"
          songTitle={f.name}
          altTitles={f.altNames.split('\n').map(s => s.trim()).filter(Boolean)}
          onSelect={p => { updateField('imageUrl', toSiteRelativeImageUrl(p)); setPickingImage(false) }}
          onClose={() => setPickingImage(false)}
        />
      )}
    </MotionOverlay>
  )
}
