import { useEffect, useRef, useState } from 'react'
import { Upload, X, CheckCircle2, AlertCircle, Loader2, ArrowUpFromLine, FolderPlus, FolderInput, Send, Pencil, Trash2, Plus, Archive, Check } from 'lucide-react'
import { useStorePick, UploadItem, StagedFileChange, StagedSongChange } from '../store/useStore'
import { formatBytes } from '../lib/format'
import { cancelCompUpload, cancelAllCompUploads } from '../lib/compUploads'
import { cancelDonorUpload, cancelAllDonorUploads, isDonorUploadId } from '../lib/donorUploads'
import { cancelChatUpload, cancelAllChatUploads, isChatUploadId } from '../lib/chatUploads'
import { cancelZipTask } from '../lib/clientZip'
import { proposeStagedChanges, stagedChangeLabel } from '../lib/compStagedChanges'
import { proposeStagedSongChanges, stagedSongChangeLabel } from '../lib/compStagedSongChanges'

// Triggered from the Uploads row in the side menu (see Sidebar.tsx) - this
// is a lightweight anchored popup (no backdrop, no drag/resize/lock), not the
// sandbox/draggable modal system the other panels use. Closes on outside
// click, same as the old self-contained floating version.
export default function UploadManager(): JSX.Element {
  const { uploads, setShowUploadManager, clearCompletedUploads, stagedFileChanges, stagedSongChanges } = useStorePick('uploads', 'setShowUploadManager', 'clearCompletedUploads', 'stagedFileChanges', 'stagedSongChanges')
  const panelRef = useRef<HTMLDivElement>(null)
  // Lives out here rather than in StagedChanges: a fully successful propose
  // empties the queue, which unmounts that section - and with it the only
  // confirmation the user would ever see.
  const [proposeResult, setProposeResult] = useState<string | null>(null)

  useEffect(() => {
    const handler = (e: MouseEvent): void => {
      if (!panelRef.current?.contains(e.target as Node)) setShowUploadManager(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [setShowUploadManager])

  const active = uploads.filter((d) => d.state === 'downloading').length

  return (
    <div ref={panelRef} style={{ top: 'calc(env(safe-area-inset-top, 0px) + 0.5rem)' }} className="fixed right-3 z-[9990] w-[320px] max-w-[calc(100vw-1.5rem)] rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-[0_8px_32px_rgba(0,0,0,0.4)] overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2.5 bg-[var(--surface-overlay)] border-b border-[var(--border)]">
        <Upload size={13} className="text-[var(--accent)] shrink-0" />
        <span className="text-[var(--text-primary)] text-xs font-semibold flex-1">
          Transfers
          {active > 0
            ? <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-[var(--accent)]/20 text-[var(--accent)] text-[10px] font-medium">{active} active</span>
            : uploads.length > 0
              ? <span className="ml-1 text-[var(--text-muted)] font-normal text-[10px]">· {uploads.length}</span>
              : null}
        </span>
        {uploads.some(d => d.state !== 'downloading') && (
          <button onClick={clearCompletedUploads} className="text-[10px] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors px-1 rounded">
            Clear
          </button>
        )}
        {uploads.filter((d) => d.type === 'upload' && d.state === 'downloading').length > 1 && (
          <button onClick={() => { cancelAllCompUploads(); cancelAllDonorUploads(); cancelAllChatUploads() }} className="text-[10px] text-[var(--text-muted)] hover:text-red-400 transition-colors px-1 rounded">
            Cancel All
          </button>
        )}
        <button onClick={() => setShowUploadManager(false)} className="p-0.5 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors">
          <X size={13} />
        </button>
      </div>
      {/* List */}
      <div className="max-h-72 overflow-y-auto">
        {(stagedFileChanges.length > 0 || stagedSongChanges.length > 0) && (
          <StagedChanges fileChanges={stagedFileChanges} songChanges={stagedSongChanges} onResult={setProposeResult} />
        )}
        {proposeResult && (
          <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border)]">
            <CheckCircle2 size={13} className="text-emerald-400 shrink-0" />
            <span className="text-[var(--text-muted)] text-[11px] flex-1">{proposeResult}</span>
            <button onClick={() => setProposeResult(null)} className="p-0.5 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors">
              <X size={11} />
            </button>
          </div>
        )}
        {uploads.length === 0 ? (
          stagedFileChanges.length === 0 && stagedSongChanges.length === 0 && !proposeResult &&
            <p className="text-[var(--text-muted)] text-xs text-center py-6">No transfers</p>
        ) : (
          <div className="divide-y divide-[var(--border)]/40">
            {uploads.map((item) => <UploadRow key={item.id} item={item} />)}
          </div>
        )}
      </div>
    </div>
  )
}

// Changes dragged together in the Files tab, plus song edits/deletions staged
// from the Tracker's editors, all waiting on one Propose. They sit above the
// transfer list because they're the only rows here the user still has to act
// on - everything below is already in flight or finished.
function StagedChanges({ fileChanges, songChanges, onResult }: {
  fileChanges: StagedFileChange[]
  songChanges: StagedSongChange[]
  onResult: (message: string | null) => void
}): JSX.Element {
  const { clearStagedFileChanges, clearStagedSongChanges } =
    useStorePick('clearStagedFileChanges', 'clearStagedSongChanges')
  const [proposing, setProposing] = useState(false)

  const total = fileChanges.length + songChanges.length
  const discardAll = (): void => { clearStagedFileChanges(); clearStagedSongChanges() }

  const propose = async (): Promise<void> => {
    if (proposing) return
    setProposing(true)
    onResult(null)
    const [fileResult, songResult] = await Promise.all([
      fileChanges.length ? proposeStagedChanges() : Promise.resolve({ proposed: 0, failed: 0 }),
      songChanges.length ? proposeStagedSongChanges() : Promise.resolve({ proposed: 0, failed: 0 }),
    ])
    setProposing(false)
    const proposed = fileResult.proposed + songResult.proposed
    const failed = fileResult.failed + songResult.failed
    const parts = [`Proposed ${proposed}`]
    if (failed > 0) parts.push(`${failed} failed`)
    onResult(parts.join(' · '))
  }

  return (
    <div className="border-b border-[var(--border)] bg-[var(--accent)]/[0.04]">
      <div className="flex items-center gap-2 px-3 py-2">
        <span className="text-[var(--text-primary)] text-[11px] font-semibold flex-1">
          Staged changes
          <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-[var(--accent)]/20 text-[var(--accent)] text-[10px] font-medium">{total}</span>
        </span>
        <button onClick={discardAll} disabled={proposing}
          className="text-[10px] text-[var(--text-muted)] hover:text-red-400 disabled:opacity-40 transition-colors px-1 rounded">
          Discard
        </button>
      </div>
      <div className="divide-y divide-[var(--border)]/40">
        {fileChanges.map((change) => <StagedFileRow key={change.id} change={change} disabled={proposing} />)}
        {songChanges.map((change) => <StagedSongRow key={change.id} change={change} disabled={proposing} />)}
      </div>
      <div className="px-3 py-2 flex items-center gap-2">
        <button onClick={propose} disabled={proposing}
          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--accent)] text-white text-xs font-medium disabled:opacity-50 hover:opacity-90 transition-opacity">
          {proposing
            ? <><Loader2 size={12} className="animate-spin" /> Proposing…</>
            : <><Send size={12} /> Propose {total} change{total === 1 ? '' : 's'}</>}
        </button>
      </div>
    </div>
  )
}

const inputClass = 'w-full px-2 py-1 rounded-md bg-[var(--surface-overlay)] border border-[var(--border)] text-[var(--text-primary)] text-[11px] focus:outline-none focus:border-[var(--accent)]'

function RowActions({ editing, disabled, onEdit, onRemove }: {
  editing: boolean
  disabled: boolean
  onEdit: () => void
  onRemove: () => void
}): JSX.Element {
  return (
    <div className="flex items-center shrink-0">
      {!editing && (
        <button onClick={onEdit} disabled={disabled} title="Edit"
          className="p-1 rounded hover:bg-[var(--surface-raised)] text-[var(--text-muted)] hover:text-[var(--text-primary)] disabled:opacity-40 transition-colors">
          <Pencil size={11} />
        </button>
      )}
      <button onClick={onRemove} disabled={disabled} title="Remove from queue"
        className="p-1 rounded hover:bg-[var(--surface-raised)] text-[var(--text-muted)] hover:text-red-400 disabled:opacity-40 transition-colors">
        <X size={12} />
      </button>
    </div>
  )
}

function EditButtons({ onCancel, onSave, canSave = true }: { onCancel: () => void; onSave: () => void; canSave?: boolean }): JSX.Element {
  return (
    <div className="flex justify-end gap-1.5 pt-0.5">
      <button onClick={onCancel} className="px-2 py-0.5 rounded-md text-[10px] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors">Cancel</button>
      <button onClick={onSave} disabled={!canSave}
        className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-[var(--accent)] text-white text-[10px] font-medium disabled:opacity-40 hover:opacity-90 transition-opacity">
        <Check size={10} /> Save
      </button>
    </div>
  )
}

/** Normalizes a typed comp path: forward slashes, no empty/leading/trailing segments. */
function cleanPath(path: string): string {
  return path.replace(/\\/g, '/').split('/').map(p => p.trim()).filter(Boolean).join('/')
}

function StagedFileRow({ change, disabled }: { change: StagedFileChange; disabled: boolean }): JSX.Element {
  const { updateStagedFileChange, unstageFileChange } = useStorePick('updateStagedFileChange', 'unstageFileChange')
  const isMove = change.changeType === 'move' || change.changeType === 'move_folder'
  const [editing, setEditing] = useState(false)
  // The one path that can change: where a move lands, or where a new folder
  // or upload goes. A move's source is fixed - it's the thing being moved.
  const [target, setTarget] = useState('')
  const [notes, setNotes] = useState('')
  const [isNewLeak, setIsNewLeak] = useState(false)

  const startEdit = (): void => {
    setTarget((isMove ? change.destination : change.path) ?? '')
    setNotes(change.notes ?? '')
    setIsNewLeak(!!change.isNewLeak)
    setEditing(true)
  }
  const cleaned = cleanPath(target)
  const save = (): void => {
    if (!cleaned) return
    updateStagedFileChange(change.id, {
      ...(isMove ? { destination: cleaned } : { path: cleaned }),
      notes: notes.trim() || undefined,
      ...(change.changeType === 'upload' ? { isNewLeak } : {}),
      error: undefined,
    })
    setEditing(false)
  }

  return (
    <div className="flex items-start gap-2 px-3 py-2">
      <div className="mt-0.5 shrink-0">
        {change.changeType === 'create_folder'
          ? <FolderPlus size={13} className="text-[var(--accent)]" />
          : change.changeType === 'upload'
            ? <ArrowUpFromLine size={13} className="text-[var(--accent)]" />
            : <FolderInput size={13} className="text-[var(--accent)]" />}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[var(--text-primary)] text-xs truncate leading-snug" title={change.path}>{stagedChangeLabel(change)}</p>
        {editing ? (
          <div className="mt-1.5 space-y-1.5">
            <label className="block text-[10px] text-[var(--text-muted)]">
              {isMove ? 'Move to' : change.changeType === 'upload' ? 'Upload to' : 'Folder path'}
              <input autoFocus value={target} onChange={e => setTarget(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false) }}
                className={`${inputClass} mt-0.5`} />
            </label>
            <label className="block text-[10px] text-[var(--text-muted)]">
              Notes
              <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
                placeholder="Optional notes for reviewers" className={`${inputClass} mt-0.5 resize-none`} />
            </label>
            {change.changeType === 'upload' && (
              <label className="flex items-center gap-1.5 text-[10px] text-[var(--text-muted)]">
                <input type="checkbox" checked={isNewLeak} onChange={e => setIsNewLeak(e.target.checked)} className="accent-[var(--accent)]" />
                New leak
              </label>
            )}
            <EditButtons onCancel={() => setEditing(false)} onSave={save} canSave={!!cleaned} />
          </div>
        ) : (
          <>
            <p className="text-[var(--text-muted)] text-[10px] truncate" title={change.destination ?? change.path}>
              {change.destination ? `→ ${change.destination}` : change.path}
              {change.file ? ` · ${formatBytes(change.file.size)}` : ''}
              {change.isNewLeak ? ' · new leak' : ''}
            </p>
            {change.notes && <p className="text-[var(--text-muted)] text-[10px] italic truncate" title={change.notes}>{change.notes}</p>}
          </>
        )}
        {change.error && <p className="text-red-400 text-[10px] mt-0.5 truncate" title={change.error}>{change.error}</p>}
      </div>
      <RowActions editing={editing} disabled={disabled} onEdit={startEdit} onRemove={() => unstageFileChange(change.id)} />
    </div>
  )
}

/** A staged value as editable text: strings as-is, everything else as JSON. */
function toEditText(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value)
}

/** Reads edited text back in the original value's shape, or null if it doesn't parse. */
function fromEditText(text: string, original: unknown): { value: unknown } | null {
  if (typeof original === 'string') return { value: text }
  if (typeof original === 'number') {
    const n = Number(text)
    return text.trim() !== '' && Number.isFinite(n) ? { value: n } : null
  }
  try { return { value: JSON.parse(text) } } catch { return null }
}

function StagedSongRow({ change, disabled }: { change: StagedSongChange; disabled: boolean }): JSX.Element {
  const { updateStagedSongChange, unstageSongChange } = useStorePick('updateStagedSongChange', 'unstageSongChange')
  const [editing, setEditing] = useState(false)
  const [notes, setNotes] = useState('')
  // Field name -> edited text; a field missing here was dropped in this edit.
  const [fields, setFields] = useState<Record<string, string>>({})
  const hasFields = change.changeType === 'update' || change.changeType === 'create'
  const fieldCount = Object.keys(change.proposedData).length

  const startEdit = (): void => {
    setNotes(change.editorNotes ?? '')
    setFields(Object.fromEntries(Object.entries(change.proposedData).map(([k, v]) => [k, toEditText(v)])))
    setEditing(true)
  }
  const parsed = Object.entries(fields).map(([k, text]) => [k, fromEditText(text, change.proposedData[k])] as const)
  const invalid = new Set(parsed.filter(([, r]) => r === null).map(([k]) => k))
  const save = (): void => {
    if (invalid.size > 0) return
    updateStagedSongChange(change.id, {
      editorNotes: notes.trim(),
      ...(hasFields ? { proposedData: Object.fromEntries(parsed.map(([k, r]) => [k, r?.value])) } : {}),
      error: undefined,
    })
    setEditing(false)
  }

  return (
    <div className="flex items-start gap-2 px-3 py-2">
      <div className="mt-0.5 shrink-0">
        {change.changeType === 'delete'
          ? <Trash2 size={13} className="text-red-400" />
          : change.changeType === 'create'
            ? <Plus size={13} className="text-[var(--accent)]" />
            : <Pencil size={13} className="text-[var(--accent)]" />}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[var(--text-primary)] text-xs truncate leading-snug" title={change.title}>{stagedSongChangeLabel(change)}</p>
        {editing ? (
          <div className="mt-1.5 space-y-1.5">
            {hasFields && Object.entries(fields).map(([key, text]) => (
              <div key={key} className="text-[10px] text-[var(--text-muted)]">
                <div className="flex items-center gap-1">
                  <span className="flex-1 truncate font-mono">{key}</span>
                  <button title="Drop this field from the proposal"
                    onClick={() => setFields(f => { const n = { ...f }; delete n[key]; return n })}
                    className="p-0.5 rounded hover:text-red-400 transition-colors">
                    <X size={10} />
                  </button>
                </div>
                <textarea value={text} rows={text.length > 60 || text.includes('\n') ? 3 : 1}
                  onChange={e => setFields(f => ({ ...f, [key]: e.target.value }))}
                  className={`${inputClass} mt-0.5 resize-y ${invalid.has(key) ? 'border-red-400' : ''}`} />
              </div>
            ))}
            <label className="block text-[10px] text-[var(--text-muted)]">
              Notes
              <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
                placeholder="Optional notes for reviewers" className={`${inputClass} mt-0.5 resize-none`} />
            </label>
            <EditButtons onCancel={() => setEditing(false)} onSave={save} canSave={invalid.size === 0} />
          </div>
        ) : (
          <>
            {hasFields && (
              <p className="text-[var(--text-muted)] text-[10px] truncate">
                {fieldCount} field{fieldCount === 1 ? '' : 's'} changed
              </p>
            )}
            {change.editorNotes && <p className="text-[var(--text-muted)] text-[10px] italic truncate" title={change.editorNotes}>{change.editorNotes}</p>}
          </>
        )}
        {change.error && <p className="text-red-400 text-[10px] mt-0.5 truncate" title={change.error}>{change.error}</p>}
      </div>
      <RowActions editing={editing} disabled={disabled} onEdit={startEdit} onRemove={() => unstageSongChange(change.id)} />
    </div>
  )
}

function UploadRow({ item }: { item: UploadItem }): JSX.Element {
  const isDone = item.state === 'done'
  const isError = item.state === 'error' || item.state === 'cancelled'
  const isActive = item.state === 'downloading'
  const isUpload = item.type === 'upload'
  const isZip = item.type === 'zip'

  const sizeLabel = item.total && item.total > 0
    ? `${formatBytes(item.received ?? 0)} / ${formatBytes(item.total)}`
    : item.received ? formatBytes(item.received) : null

  const speedLabel = isActive && item.speedBps ? `${formatBytes(item.speedBps)}/s` : null

  return (
    <div className="px-3 py-2.5 hover:bg-[var(--surface-overlay)] transition-colors">
      <div className="flex items-start gap-2">
        <div className="mt-0.5 shrink-0">
          {isDone ? <CheckCircle2 size={13} className="text-emerald-400" />
            : isError ? <AlertCircle size={13} className="text-red-400" />
            : isUpload ? <ArrowUpFromLine size={13} className="text-[var(--accent)] animate-pulse" />
            : isZip ? <Archive size={13} className="text-[var(--accent)] animate-pulse" />
            : <Loader2 size={13} className="text-[var(--accent)] animate-spin" />}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[var(--text-primary)] text-xs truncate leading-snug" title={item.filename}>{item.filename}</p>
          {isActive && (item.detail || sizeLabel || speedLabel) && (
            <p className="text-[var(--text-muted)] text-[10px] mt-0.5">
              {[item.detail, sizeLabel, speedLabel].filter(Boolean).join(' · ')}
            </p>
          )}
          {isDone && item.detail && <p className="text-[var(--text-muted)] text-[10px] mt-0.5 truncate">{item.detail}</p>}
          {isError && item.error && <p className="text-red-400 text-[10px] mt-0.5 truncate">{item.error}</p>}
          {isActive && (
            <div className="mt-1.5 h-1 bg-[var(--surface-overlay)] rounded-full overflow-hidden">
              <div className="h-full bg-[var(--accent)] rounded-full transition-all duration-200" style={{ width: `${item.percent}%` }} />
            </div>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {isActive && <span className="text-[var(--text-muted)] text-[10px]">{item.percent}%</span>}
          {isActive && isZip && (
            <button onClick={() => cancelZipTask(item.id)} title="Cancel download"
              className="p-1 rounded hover:bg-[var(--surface-raised)] text-[var(--text-muted)] hover:text-red-400 transition-colors">
              <X size={12} />
            </button>
          )}
          {isActive && isUpload && (
            <button onClick={() => (isChatUploadId(item.id) ? cancelChatUpload(item.id) : isDonorUploadId(item.id) ? cancelDonorUpload(item.id) : cancelCompUpload(item.id))} title="Cancel upload"
              className="p-1 rounded hover:bg-[var(--surface-raised)] text-[var(--text-muted)] hover:text-red-400 transition-colors">
              <X size={12} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
