import { useEffect, useRef, useState } from 'react'
import { X, ImagePlus, Loader2, AlertCircle, Send, ImageOff, Search } from 'lucide-react'
import { ModalOverlay, LockToggle } from './Modal'
import { useStore } from '../store/useStore'
import { buildImageUrl, searchSongs, type JWApiSong } from '../lib/juicewrldApi'
import {
  checkCoverArtFile, submitCoverArt, COVER_ART_MAX_NOTES, COVER_ART_TYPES, type CoverArtTarget,
} from '../lib/coverArtApi'
import { formatBytes, errorMessage } from '../lib/format'
import { showAppToast } from '../lib/appToast'

// Global "Submit cover art" dialog, mounted once at the app root (and in
// pop-outs, like ReportModal) and driven by the store's `coverArtModal`.
// Opened from a song's context menu, Song info and the Edit menu.
export default function CoverArtSubmitModal(): JSX.Element | null {
  const target = useStore((s) => s.coverArtModal)
  const close = useStore((s) => s.closeCoverArtSubmit)
  if (!target) return null
  // Keyed so opening it on another song starts from a clean form.
  return <CoverArtSubmitDialog key={target.songId ?? 'pick'} initial={target} onClose={close} />
}

// The search step for a dialog opened without a song (Home → Tools).
function SongSearch({ onPick }: { onPick: (target: CoverArtTarget) => void }): JSX.Element {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<JWApiSong[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const q = query.trim()
    if (!q) { setResults([]); setLoading(false); return }
    setLoading(true)
    let stale = false
    const t = setTimeout(() => {
      void searchSongs(q, 12).then((songs) => { if (!stale) { setResults(songs); setLoading(false) } })
    }, 250)
    return () => { stale = true; clearTimeout(t) }
  }, [query])

  return (
    <div className="px-5 py-4 space-y-3">
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search for the song"
          className="w-full bg-surface border border-[var(--border)] rounded-lg pl-9 pr-3 py-2.5 text-xs text-text-primary placeholder:text-text-muted/60 focus:outline-none focus:border-accent/50"
        />
      </div>
      <div className="min-h-[200px] space-y-1">
        {loading && <Loader2 size={16} className="animate-spin text-text-muted mx-auto mt-6" />}
        {!loading && query.trim() && results.length === 0 && (
          <p className="text-xs text-text-muted text-center mt-6">No songs found</p>
        )}
        {!loading && results.map((s) => {
          const cover = buildImageUrl(s.image_url)
          return (
            <button
              key={s.id}
              onClick={() => onPick({ songId: s.id, songName: s.name, currentCover: s.image_url })}
              className="w-full flex items-center gap-3 rounded-lg px-2 py-1.5 text-left hover:bg-surface-overlay transition-colors"
            >
              <span className="w-9 h-9 rounded-md overflow-hidden bg-surface-raised flex items-center justify-center shrink-0">
                {cover ? <img src={cover} alt="" className="w-full h-full object-cover" /> : <ImageOff size={14} className="text-text-muted" />}
              </span>
              <span className="flex-1 min-w-0 text-xs text-text-primary truncate">{s.name}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function CoverArtSubmitDialog({ initial, onClose }: { initial: CoverArtTarget; onClose: () => void }): JSX.Element {
  const [target, setTarget] = useState(initial)
  const account = useStore((s) => s.account)
  const setShowUserAuth = useStore((s) => s.setShowUserAuth)
  const inputRef = useRef<HTMLInputElement>(null)
  const [picked, setPicked] = useState<{ file: File; url: string; width: number; height: number } | null>(null)
  const [checking, setChecking] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [notes, setNotes] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const current = buildImageUrl(target.currentCover)

  // The preview's object URL is ours to free, on replace and on close.
  useEffect(() => () => { if (picked) URL.revokeObjectURL(picked.url) }, [picked])

  const pick = async (file: File | undefined): Promise<void> => {
    if (!file || sending) return
    setError(null)
    setChecking(true)
    try {
      const result = await checkCoverArtFile(file)
      if (typeof result === 'string') { setError(result); return }
      setPicked({ file, url: URL.createObjectURL(file), ...result })
    } finally {
      setChecking(false)
    }
  }

  const submit = async (): Promise<void> => {
    if (!picked || sending || target.songId == null) return
    setSending(true)
    setError(null)
    try {
      await submitCoverArt(target.songId, picked.file, notes)
      showAppToast('Cover art sent for review', { tone: 'info' })
      onClose()
    } catch (e) {
      setError(errorMessage(e, "Couldn't send the cover art"))
    } finally {
      setSending(false)
    }
  }

  return (
    <ModalOverlay
      onClose={onClose}
      zIndexClassName="z-[170]"
      panelClassName="bg-surface border border-[var(--border)] rounded-t-2xl md:rounded-2xl shadow-2xl w-full md:max-w-lg max-h-[92svh]"
      minWidth={420} minHeight={420}
    >
      {({ onHandleMouseDown, locked, toggleLock, canLock }) => (
      <div className="bg-surface w-full h-full overflow-y-auto">
        <div
          className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)] sticky top-0 bg-surface z-10"
          onMouseDown={onHandleMouseDown}
        >
          <h2 className="flex items-center gap-2 text-text-primary text-sm font-semibold">
            <ImagePlus size={15} className="text-accent" /> Submit cover art
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
            <p className="text-text-secondary text-sm">Sign in to send in cover art.</p>
            <button onClick={() => { setShowUserAuth(true); onClose() }}
              className="px-4 py-2 rounded-xl bg-accent text-white text-sm font-semibold hover:opacity-90">
              Log in
            </button>
          </div>
        ) : target.songId == null ? (
          <SongSearch onPick={setTarget} />
        ) : (
        <div className="px-5 py-4 space-y-3.5">
          <p className="text-xs text-text-muted">
            For <span className="text-text-secondary font-medium">{target.songName}</span>
            {initial.songId == null && (
              <button onClick={() => { setTarget(initial); setPicked(null); setError(null) }}
                className="ml-2 text-accent hover:underline">Change</button>
            )}
          </p>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-[11px] font-medium text-text-secondary mb-1.5">Now</p>
              <div className="aspect-square rounded-xl overflow-hidden border border-[var(--border)] bg-surface-raised flex items-center justify-center">
                {current
                  ? <img src={current} alt="" className="w-full h-full object-cover" />
                  : <ImageOff size={22} className="text-text-muted" />}
              </div>
            </div>
            <div>
              <p className="text-[11px] font-medium text-text-secondary mb-1.5">Yours</p>
              <button
                onClick={() => inputRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => { e.preventDefault(); setDragOver(false); void pick(e.dataTransfer.files[0]) }}
                disabled={sending}
                title={picked ? 'Pick a different image' : 'Pick an image'}
                className={`w-full aspect-square rounded-xl overflow-hidden border flex items-center justify-center transition-colors ${
                  dragOver ? 'border-accent bg-accent/10' : picked ? 'border-[var(--border)]' : 'border-dashed border-[var(--border)] bg-surface-raised hover:bg-surface-overlay'
                }`}
              >
                {checking ? (
                  <Loader2 size={20} className="animate-spin text-text-muted" />
                ) : picked ? (
                  <img src={picked.url} alt="" className="w-full h-full object-cover" />
                ) : (
                  <span className="flex flex-col items-center gap-1.5 px-3 text-text-muted text-xs">
                    <ImagePlus size={20} />
                    Pick or drop an image
                  </span>
                )}
              </button>
              <input
                ref={inputRef}
                type="file"
                accept={COVER_ART_TYPES.join(',')}
                className="hidden"
                onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = '' }}
              />
              {picked && (
                <p className="text-[10px] text-text-muted mt-1 truncate">
                  {picked.width}×{picked.height} · {formatBytes(picked.file.size)}
                </p>
              )}
            </div>
          </div>

          <div>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              maxLength={COVER_ART_MAX_NOTES}
              placeholder="Where is the art from? Anything a reviewer should know (optional)"
              className="w-full resize-none bg-surface border border-[var(--border)] rounded-lg px-3 py-2.5 text-xs text-text-primary placeholder:text-text-muted/60 focus:outline-none focus:border-accent/50 leading-relaxed"
            />
            <span className="text-[10px] text-text-muted/60">{notes.length}/{COVER_ART_MAX_NOTES}</span>
          </div>

          <p className="text-[11px] text-text-muted leading-relaxed">
            JPEG, PNG or WebP, up to 20 MB, 300 to 6000 pixels on each side. A manager reviews it before
            it shows on the song. You can follow it in Settings → Account → My cover art.
          </p>

          {error && (
            <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs">
              <AlertCircle size={13} className="shrink-0 mt-0.5" /> {error}
            </div>
          )}

          <button
            onClick={() => void submit()}
            disabled={!picked || sending || checking}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-accent text-white text-sm font-semibold transition-opacity disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90"
          >
            {sending
              ? <><Loader2 size={14} className="animate-spin" /> Sending…</>
              : <><Send size={14} /> Submit for review</>}
          </button>
        </div>
        )}
      </div>
      )}
    </ModalOverlay>
  )
}
