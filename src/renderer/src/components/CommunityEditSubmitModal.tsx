import { useEffect, useRef, useState } from 'react'
import { AlertCircle, AudioLines, FileAudio, Loader2, Search, Send, X } from 'lucide-react'
import { ModalOverlay, LockToggle } from './Modal'
import { useStore } from '../store/useStore'
import { searchSongs, type JWApiSong } from '../lib/juicewrldApi'
import {
  COMMUNITY_EDIT_ACCEPT, COMMUNITY_EDIT_KINDS, COMMUNITY_EDIT_MAX_NOTES, COMMUNITY_EDIT_MAX_TITLE,
  DuplicateEditError, checkCommunityEditFile, checkCommunityEditHash, sha256OfFile, submitCommunityEdit,
  type CommunityEditKind, type CommunityEditMatch,
} from '../lib/communityEditsApi'
import { errorMessage, formatBytes } from '../lib/format'
import { showAppToast } from '../lib/appToast'
import { isAbortError } from '../lib/apiClient'
import { MatchCard, formatLength } from './communityEditShared'

// Global "Submit a remix or edit" dialog, mounted once at the app root and
// driven by the store's `communityEditModal`. Opened from Home → Tools and the
// Tools menu. Before anything is uploaded the file's hash is checked, so an
// exact copy of something we have never leaves the device; the server then
// checks how it sounds and turns away anything too similar, with the file it
// matched.
export default function CommunityEditSubmitModal(): JSX.Element | null {
  const open = useStore((s) => s.communityEditModal)
  const close = useStore((s) => s.closeCommunityEditSubmit)
  if (!open) return null
  return <CommunityEditDialog onClose={close} />
}

type Picked = { file: File; duration: number | null }
type Duplicate = { match: CommunityEditMatch; message: string }

const titleFromName = (name: string): string => name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim().slice(0, COMMUNITY_EDIT_MAX_TITLE)

function readDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const audio = new Audio()
    const done = (value: number | null): void => { URL.revokeObjectURL(url); resolve(value) }
    audio.preload = 'metadata'
    audio.onloadedmetadata = () => done(Number.isFinite(audio.duration) ? audio.duration : null)
    // Formats this runtime can't play (ALAC, AIFF) still go up; the server measures them.
    audio.onerror = () => done(null)
    audio.src = url
  })
}

function duplicateMessage(match: CommunityEditMatch): string {
  if (match.target === 'file') return `This exact file is already in Files at ${match.path}.`
  if (match.target === 'song') return `This exact file is already in the catalogue as "${match.song.name}".`
  return match.mine ? 'You already sent in this exact file. It is waiting for review.' : 'Someone already sent in this exact file. It is waiting for review.'
}

function SongPicker({ value, onChange }: {
  value: { id: number; name: string } | null
  onChange: (song: { id: number; name: string } | null) => void
}): JSX.Element {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<JWApiSong[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const q = query.trim()
    if (!q || value) { setResults([]); setLoading(false); return }
    setLoading(true)
    let stale = false
    const t = setTimeout(() => {
      void searchSongs(q, 6).then((songs) => { if (!stale) { setResults(songs); setLoading(false) } })
    }, 250)
    return () => { stale = true; clearTimeout(t) }
  }, [query, value])

  if (value) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-surface px-3 py-2 text-xs">
        <span className="flex-1 min-w-0 truncate text-text-primary">{value.name}</span>
        <button onClick={() => { onChange(null); setQuery('') }} className="text-text-muted hover:text-text-primary" title="Clear">
          <X size={13} />
        </button>
      </div>
    )
  }
  return (
    <div>
      <div className="relative">
        <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Made from which song? (optional)"
          className="w-full bg-surface border border-[var(--border)] rounded-lg pl-8 pr-3 py-2 text-xs text-text-primary placeholder:text-text-muted/60 focus:outline-none focus:border-accent/50"
        />
        {loading && <Loader2 size={12} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-text-muted" />}
      </div>
      {results.length > 0 && (
        <div className="mt-1 rounded-lg border border-[var(--border)] bg-surface-raised overflow-hidden">
          {results.map((s) => (
            <button key={s.id} onClick={() => onChange({ id: s.id, name: s.name })}
              className="w-full px-3 py-1.5 text-left text-xs text-text-primary truncate hover:bg-surface-overlay transition-colors">
              {s.name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function CommunityEditDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const account = useStore((s) => s.account)
  const setShowUserAuth = useStore((s) => s.setShowUserAuth)
  const inputRef = useRef<HTMLInputElement>(null)
  const [picked, setPicked] = useState<Picked | null>(null)
  const [checking, setChecking] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [duplicate, setDuplicate] = useState<Duplicate | null>(null)
  const [title, setTitle] = useState('')
  const [kind, setKind] = useState<CommunityEditKind>('remix')
  const [song, setSong] = useState<{ id: number; name: string } | null>(null)
  const [notes, setNotes] = useState('')
  // null while idle; 0-1 while uploading; 1 then means the server is checking it.
  const [progress, setProgress] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const sending = progress !== null

  // Closing mid-upload cancels it.
  useEffect(() => () => abortRef.current?.abort(), [])

  const pick = async (file: File | undefined): Promise<void> => {
    if (!file || sending) return
    setError(null)
    setDuplicate(null)
    const problem = checkCommunityEditFile(file)
    if (problem) { setError(problem); return }
    setChecking(true)
    try {
      const [sha, duration] = await Promise.all([sha256OfFile(file), readDuration(file)])
      // Only the hash goes up here; an exact copy is caught without an upload.
      const match = await checkCommunityEditHash(sha).catch(() => null)
      if (match) { setPicked(null); setDuplicate({ match, message: duplicateMessage(match) }); return }
      setPicked({ file, duration })
      if (!title.trim()) setTitle(titleFromName(file.name))
    } catch (e) {
      setError(errorMessage(e, "Couldn't read that file"))
    } finally {
      setChecking(false)
    }
  }

  const submit = async (): Promise<void> => {
    if (!picked || sending || !title.trim()) return
    setError(null)
    setProgress(0)
    const controller = new AbortController()
    abortRef.current = controller
    try {
      await submitCommunityEdit(picked.file, { title, kind, songId: song?.id ?? null, notes }, setProgress, controller.signal)
      showAppToast('Edit sent for review', { tone: 'info' })
      onClose()
    } catch (e) {
      if (isAbortError(e)) return
      if (e instanceof DuplicateEditError) { setPicked(null); setDuplicate({ match: e.match, message: e.message }); return }
      setError(errorMessage(e, "Couldn't send the edit"))
    } finally {
      abortRef.current = null
      setProgress(null)
    }
  }

  const reset = (): void => { setDuplicate(null); setPicked(null); setError(null) }

  return (
    <ModalOverlay
      onClose={onClose}
      zIndexClassName="z-[170]"
      panelClassName="bg-surface border border-[var(--border)] rounded-t-2xl md:rounded-2xl shadow-2xl w-full md:max-w-lg max-h-[92svh]"
      minWidth={420} minHeight={360}
    >
      {({ onHandleMouseDown, locked, toggleLock, canLock }) => (
      <div className="bg-surface w-full h-full overflow-y-auto">
        <div
          className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)] sticky top-0 bg-surface z-10"
          onMouseDown={onHandleMouseDown}
        >
          <h2 className="flex items-center gap-2 text-text-primary text-sm font-semibold">
            <AudioLines size={15} className="text-accent" /> Submit a remix or edit
          </h2>
          <div className="flex items-center gap-1">
            {canLock && <LockToggle locked={locked} onClick={toggleLock} />}
            <button onClick={onClose} title="Close" className="text-text-muted hover:text-text-primary transition-colors">
              <X size={18} />
            </button>
          </div>
        </div>

        {!account ? (
          <div className="px-5 py-8 flex flex-col items-center text-center gap-3">
            <p className="text-text-secondary text-sm">Sign in to send in a remix or edit.</p>
            <button onClick={() => { setShowUserAuth(true); onClose() }}
              className="px-4 py-2 rounded-xl bg-accent text-white text-sm font-semibold hover:opacity-90">
              Log in
            </button>
          </div>
        ) : (
        <div className="px-5 py-4 space-y-3.5">
          {duplicate ? (
            <>
              <MatchCard match={duplicate.match} message={duplicate.message} onOpened={onClose} />
              <button onClick={reset} className="text-xs text-accent hover:underline">Pick a different file</button>
            </>
          ) : (
            <>
              <button
                onClick={() => inputRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => { e.preventDefault(); setDragOver(false); void pick(e.dataTransfer.files[0]) }}
                disabled={sending || checking}
                className={`w-full rounded-xl border px-4 py-5 flex items-center gap-3 text-left transition-colors ${
                  dragOver ? 'border-accent bg-accent/10' : picked ? 'border-[var(--border)] bg-surface-raised' : 'border-dashed border-[var(--border)] bg-surface-raised hover:bg-surface-overlay'
                }`}
              >
                {checking ? <Loader2 size={20} className="animate-spin text-text-muted shrink-0" /> : <FileAudio size={20} className="text-accent shrink-0" />}
                <span className="min-w-0 flex-1">
                  {checking ? (
                    <span className="block text-xs text-text-muted">Checking whether we have it…</span>
                  ) : picked ? (
                    <>
                      <span className="block text-xs text-text-primary font-medium truncate">{picked.file.name}</span>
                      <span className="block text-[10px] text-text-muted">
                        {picked.duration != null ? `${formatLength(picked.duration)} · ` : ''}{formatBytes(picked.file.size)} · click to pick another
                      </span>
                    </>
                  ) : (
                    <span className="block text-xs text-text-muted">Pick or drop an audio file</span>
                  )}
                </span>
              </button>
              <input
                ref={inputRef}
                type="file"
                accept={COMMUNITY_EDIT_ACCEPT}
                className="hidden"
                onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = '' }}
              />

              {picked && (
                <>
                  <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    maxLength={COMMUNITY_EDIT_MAX_TITLE}
                    placeholder="Title"
                    className="w-full bg-surface border border-[var(--border)] rounded-lg px-3 py-2 text-xs text-text-primary placeholder:text-text-muted/60 focus:outline-none focus:border-accent/50"
                  />
                  <div className="flex gap-1">
                    {COMMUNITY_EDIT_KINDS.map((k) => (
                      <button key={k.id} onClick={() => setKind(k.id)}
                        className={`px-3 py-1.5 rounded-full text-[11px] font-medium transition-colors ${
                          kind === k.id ? 'bg-accent/15 text-accent' : 'text-text-muted hover:text-text-primary hover:bg-surface-overlay'
                        }`}>
                        {k.label}
                      </button>
                    ))}
                  </div>
                  <SongPicker value={song} onChange={setSong} />
                  <div>
                    <textarea
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      rows={3}
                      maxLength={COMMUNITY_EDIT_MAX_NOTES}
                      placeholder="What did you change? Anything a reviewer should know (optional)"
                      className="w-full resize-none bg-surface border border-[var(--border)] rounded-lg px-3 py-2.5 text-xs text-text-primary placeholder:text-text-muted/60 focus:outline-none focus:border-accent/50 leading-relaxed"
                    />
                    <span className="text-[10px] text-text-muted/60">{notes.length}/{COMMUNITY_EDIT_MAX_NOTES}</span>
                  </div>
                </>
              )}

              <p className="text-[11px] text-text-muted leading-relaxed">
                MP3, M4A, FLAC, WAV, Ogg, Opus or AIFF, up to 95 MB, 10 seconds to 20 minutes. Files that sound too
                much like one we have are turned away. A manager reviews it before it shows up in Files, in the
                Community channel under Remixes &amp; Edits → Community-Made.
              </p>

              {error && (
                <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs">
                  <AlertCircle size={13} className="shrink-0 mt-0.5" /> {error}
                </div>
              )}

              <button
                onClick={() => void submit()}
                disabled={!picked || sending || checking || !title.trim()}
                className="relative w-full overflow-hidden flex items-center justify-center gap-2 py-2.5 rounded-xl bg-accent text-white text-sm font-semibold transition-opacity disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90"
              >
                {sending && progress! < 1 && (
                  <span className="absolute inset-y-0 left-0 bg-white/15 origin-left w-full transition-transform duration-300"
                    style={{ transform: `scaleX(${progress})` }} />
                )}
                <span className="relative flex items-center gap-2">
                  {sending
                    ? <><Loader2 size={14} className="animate-spin" /> {progress! < 1 ? `Uploading ${Math.round(progress! * 100)}%` : 'Checking it against what we have…'}</>
                    : <><Send size={14} /> Submit for review</>}
                </span>
              </button>
            </>
          )}
        </div>
        )}
      </div>
      )}
    </ModalOverlay>
  )
}
