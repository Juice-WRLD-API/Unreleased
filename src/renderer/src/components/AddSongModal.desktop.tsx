import { useRef } from 'react'
import { Loader2, Plus, X, Check, AlertCircle, ChevronDown, ChevronUp } from 'lucide-react'
import FilePickerModal from './FilePickerModal'
import { BasicRow, BasicSelect, SyncedLyricsTable } from './EditorPage.desktop'
import CopyFromSong from './CopyFromSong'
import { useAddSongModal } from '../hooks/useAddSongModal'

const CATEGORIES = [
  { value: 'released', label: 'Released' },
  { value: 'unreleased', label: 'Unreleased' },
  { value: 'unsurfaced', label: 'Unsurfaced' },
  { value: 'recording_session', label: 'Session' },
]

// A small uppercase caption divider between field groups, matching the rest
// of the profile's `text-[10px] font-bold uppercase tracking-widest
// text-text-muted` convention instead of the plain blank space that used to
// separate these groups.
function SectionLabel({ children }: { children: string }): JSX.Element {
  return <p className="text-[10px] font-bold uppercase tracking-widest text-text-muted pt-2 pb-0.5">{children}</p>
}

export default function AddSongModal({ onClose, onSubmitted, channel }: {
  onClose: () => void
  onSubmitted: () => void
  channel?: string
}): JSX.Element {
  const {
    f, updateField, showMore, setShowMore, copiedFrom, setCopiedFrom, syncedTable, setSyncedTable,
    pickingFile, setPickingFile, eras, submitState, submitError, edNotes, setEdNotes, copyFrom, handleSubmit,
  } = useAddSongModal(onSubmitted, onClose, channel)
  const overlayRef = useRef<HTMLDivElement>(null)

  return (
    <div ref={overlayRef} className="fixed inset-0 z-50 flex items-end justify-center" onClick={e => { if (e.target === overlayRef.current) onClose() }}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-2xl bg-[var(--surface)] rounded-t-2xl shadow-2xl border border-[var(--border)] border-b-0 animate-slide-up flex flex-col max-h-[88dvh]">
        {/* Header */}
        <div className="flex items-center gap-3 px-5 pt-5 pb-4 border-b border-[var(--border)] shrink-0">
          <div className="w-9 h-9 rounded-2xl bg-accent/15 border border-accent/20 flex items-center justify-center shrink-0">
            <Plus size={16} className="text-accent" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-text-primary font-bold text-sm">Propose new song</p>
            <p className="text-text-muted text-xs opacity-60 mt-0.5">Admins review and add it to the database</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-[var(--surface-overlay)] transition-colors shrink-0">
            <X size={15} />
          </button>
        </div>

        {/* Scrollable fields - same flat layout as the editor's Basic view, so
            creating a song and editing one look and behave alike. */}
        <div className="flex-1 overflow-y-auto min-h-0 px-4 py-3 flex flex-col gap-1.5">
          <CopyFromSong onCopy={copyFrom} copiedFrom={copiedFrom} onClear={() => setCopiedFrom(null)} variant="desktop" />

          <BasicRow label="Name *" value={f.name} onChange={v => updateField('name', v)} placeholder="Song title" />
          <div className="grid grid-cols-2 gap-1.5">
            <BasicSelect
              label="Era" value={f.eraId} original="" onChange={v => updateField('eraId', v)}
              options={eras.map(e => ({ value: String(e.id), label: e.name }))}
            />
            <BasicSelect label="Category" value={f.cat} original="" onChange={v => updateField('cat', v)} options={CATEGORIES} />
          </div>
          <BasicRow label="Album" value={f.album} onChange={v => updateField('album', v)} placeholder="Album name" suggest="album" />
          <BasicRow label="Alternate titles (one per line)" value={f.altNames} onChange={v => updateField('altNames', v)} rows={3} />
          <BasicRow label="Credited artists" value={f.artists} onChange={v => updateField('artists', v)} placeholder="Juice WRLD ft. …" suggest="credited_artists" />

          <button onClick={() => setShowMore(v => !v)}
            className="flex items-center gap-1.5 self-start px-1 py-1 text-[11px] font-semibold text-text-muted opacity-60 hover:opacity-100 transition-opacity select-none">
            {showMore ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
            {showMore ? 'Fewer fields' : 'More fields'}
          </button>

          {showMore && (
            <>
              <SectionLabel>Credits & dates</SectionLabel>
              <div className="grid grid-cols-2 gap-1.5">
                <BasicRow label="Producers" value={f.prod} onChange={v => updateField('prod', v)} placeholder="Producer names" suggest="producers" />
                <BasicRow label="Engineers" value={f.engineer} onChange={v => updateField('engineer', v)} placeholder="Engineer name" suggest="engineers" />
              </div>
              <BasicRow label="Recording locations" value={f.location} onChange={v => updateField('location', v)} rows={2} placeholder="Studio / city" suggest="recording_locations" />
              <BasicRow label="Record dates" value={f.recDate} onChange={v => updateField('recDate', v)} rows={2} placeholder="YYYY-MM-DD" mono />
              {f.cat === 'recording_session' && (
                <div className="grid grid-cols-2 gap-1.5">
                  <BasicRow label="Session titles" value={f.sessionTitles} onChange={v => updateField('sessionTitles', v)} rows={2} />
                  <BasicRow label="Session tracking" value={f.sessionTracking} onChange={v => updateField('sessionTracking', v)} rows={2} />
                </div>
              )}
              <div className="grid grid-cols-2 gap-1.5">
                <BasicRow label="Length" value={f.songLength} onChange={v => updateField('songLength', v)} placeholder="3:59" mono />
                <BasicRow label="Bitrate" value={f.bitrate} onChange={v => updateField('bitrate', v)} placeholder="320 kbps" mono />
              </div>

              <SectionLabel>Notes & files</SectionLabel>
              <BasicRow label="Additional information" value={f.addInfo} onChange={v => updateField('addInfo', v)} rows={3} placeholder="Any other info…" />
              <div className="grid grid-cols-2 gap-1.5">
                <BasicRow label="File names" value={f.fileNames} onChange={v => updateField('fileNames', v)} rows={2} />
                <BasicRow label="Instrumentals" value={f.instrumentals} onChange={v => updateField('instrumentals', v)} rows={2} placeholder="Instrumental versions available" />
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                <BasicRow label="Preview date" value={f.previewDate} onChange={v => updateField('previewDate', v)} placeholder="YYYY-MM-DD" mono />
                <BasicRow label="Release date" value={f.relDate} onChange={v => updateField('relDate', v)} placeholder="YYYY-MM-DD" mono />
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                <BasicRow label="Instrumental names" value={f.instrumentalNames} onChange={v => updateField('instrumentalNames', v)} rows={2} />
                <BasicRow label="Notes" value={f.notes} onChange={v => updateField('notes', v)} rows={2} placeholder="Internal notes…" />
              </div>

              <SectionLabel>Lyrics</SectionLabel>
              <BasicRow label="Lyrics" value={f.lyrics} onChange={v => updateField('lyrics', v)} rows={8} placeholder="Plain lyrics…" />

              {/* Synced lyrics get the editor's line table, with the same raw
                  escape hatch for pasting a whole LRC at once. */}
              <div className="rounded-md border border-[var(--border)] bg-[var(--surface-overlay)]/60 px-2.5 py-1.5">
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
                  <textarea rows={6} value={f.syncedLyrics} onChange={e => updateField('syncedLyrics', e.target.value)} placeholder="[mm:ss.xx] line…"
                    className="w-full bg-transparent border-0 p-0 mt-1 text-xs font-mono leading-snug text-text-primary focus:outline-none resize-y placeholder:text-text-muted placeholder:opacity-40" />
                )}
              </div>

              <SectionLabel>Leak & media</SectionLabel>
              <div className="grid grid-cols-2 gap-1.5">
                <BasicRow label="Date leaked" value={f.dateLeaked} onChange={v => updateField('dateLeaked', v)} placeholder="YYYY-MM-DD" mono />
                <BasicRow label="Leak type" value={f.leakType} onChange={v => updateField('leakType', v)} placeholder="e.g. Stem, Master, Video…" suggest="leak_type" />
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                <BasicRow label="Image URL" value={f.imageUrl} onChange={v => updateField('imageUrl', v)} placeholder="https://…" mono />
                <BasicRow label="File path" value={f.filePath} onChange={v => updateField('filePath', v)} placeholder="Path to the audio file" mono onBrowse={() => setPickingFile(true)} />
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="shrink-0 border-t border-[var(--border)] px-5 py-4 space-y-3">
          <input value={edNotes} onChange={e => setEdNotes(e.target.value)} placeholder="Editor notes (optional)…"
            className="w-full bg-[var(--surface-overlay)] border border-[var(--border)] rounded-xl px-3 py-2 text-xs text-text-primary placeholder:text-text-muted placeholder:opacity-30 focus:outline-none focus:border-accent/40 transition-colors" />
          {submitError && (
            <div className="flex items-center gap-2 text-red-400 text-xs">
              <AlertCircle size={12} className="shrink-0" /> {submitError}
            </div>
          )}
          <button onClick={handleSubmit} disabled={!f.name.trim() || submitState === 'submitting' || submitState === 'submitted'}
            className={`w-full py-2.5 rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2 ${
              submitState === 'submitted' ? 'bg-emerald-500/20 text-emerald-400' :
              submitState === 'error'     ? 'bg-red-500/20 text-red-400' :
              !f.name.trim()              ? 'bg-[var(--surface-overlay)] text-text-muted opacity-40 cursor-not-allowed' :
              'bg-accent text-white hover:bg-accent/90 shadow-lg shadow-accent/20'
            }`}>
            {submitState === 'submitting' && <Loader2 size={14} className="animate-spin" />}
            {submitState === 'submitted'  && <Check size={14} />}
            {submitState === 'error'      && <AlertCircle size={14} />}
            {submitState === 'idle'       && 'Stage proposal'}
            {submitState === 'submitting' && 'Staging…'}
            {submitState === 'submitted'  && 'Staged!'}
            {submitState === 'error'      && 'Try again'}
          </button>
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
    </div>
  )
}
