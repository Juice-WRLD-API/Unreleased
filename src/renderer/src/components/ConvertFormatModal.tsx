import { useEffect, useMemo, useRef, useState, CSSProperties } from 'react'
import { X, FileAudio2, Loader2, Check, AlertCircle, Folder, Eraser, Download } from 'lucide-react'
import { useStore } from '../store/useStore'
import { broadcastLibraryTrackAdd } from '../lib/windowSync'
import { LibraryTrack } from '../types'
import { ModalOverlay, LockToggle } from './Modal'

// "Convert format" dialog for a local file, driven by the store's `convertModal`
// target. Transcodes via the on-demand ffmpeg (main process `convert-audio`;
// first use shows a one-time download gate), writing the result next to the
// original and registering it in the library.
//
// Two mounts: the app root mounts it as an in-app modal (backdrop + centered
// card), and the pop-out window (FloatApp's `convert` view) mounts it with
// floating=true, which drops the backdrop, fills the window, turns the header
// into the drag handle, and closes the window itself instead of the dialog.

type FormatId = 'mp3' | 'm4a' | 'flac' | 'wav' | 'ogg' | 'opus'

interface FormatOption {
  id: FormatId
  label: string
  blurb: string
  lossy: boolean
}

const FORMATS: FormatOption[] = [
  { id: 'mp3',  label: 'MP3',  blurb: 'Universal, small files',        lossy: true },
  { id: 'm4a',  label: 'M4A',  blurb: 'AAC — efficient, Apple-native', lossy: true },
  { id: 'opus', label: 'Opus', blurb: 'Best quality per KB',           lossy: true },
  { id: 'ogg',  label: 'OGG',  blurb: 'Vorbis, open format',           lossy: true },
  { id: 'flac', label: 'FLAC', blurb: 'Lossless, compressed',          lossy: false },
  { id: 'wav',  label: 'WAV',  blurb: 'Lossless, uncompressed',        lossy: false },
]

const BITRATES = ['320k', '256k', '192k', '128k']

const extOf = (p: string): string => (p.split('.').pop() || '').toLowerCase()
const fileName = (p: string): string => p.split(/[/\\]/).pop() || p

export default function ConvertFormatModal({ floating = false }: { floating?: boolean } = {}): JSX.Element | null {
  const track = useStore((s) => s.convertModal)
  const closeConvert = useStore((s) => s.closeConvert)
  const addLibraryTrack = useStore((s) => s.addLibraryTrack)
  const el = (window as any).electron

  const [format, setFormat] = useState<FormatId>('mp3')
  const [bitrate, setBitrate] = useState('256k')
  const [stripMeta, setStripMeta] = useState(false)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<{ outPath: string } | null>(null)
  // ffmpeg is fetched on demand (see main.js "On-demand tool binaries") — when
  // it isn't on disk yet the form is replaced by a one-time download gate.
  const [needsFfmpeg, setNeedsFfmpeg] = useState(false)
  const [dlBusy, setDlBusy] = useState(false)
  const [dlPercent, setDlPercent] = useState(0)
  const [dlError, setDlError] = useState<string | null>(null)
  const convertId = useRef<string | null>(null)

  const sourceExt = track ? extOf(track.path) : ''

  // Default the target away from the source format so "Convert" is meaningful.
  useEffect(() => {
    if (!track) return
    const firstDifferent = FORMATS.find((f) => f.id !== sourceExt)?.id ?? 'mp3'
    setFormat(firstDifferent)
    setBitrate('256k')
    setStripMeta(false)
    setBusy(false)
    setProgress(0)
    setError(null)
    setDone(null)
    setNeedsFfmpeg(false)
    setDlBusy(false)
    setDlPercent(0)
    setDlError(null)
    convertId.current = null
  }, [track?.id])

  // Is ffmpeg present? Checked per open so the gate clears once downloaded
  // (possibly by the URL-import dialog or another window).
  useEffect(() => {
    if (!track || !el?.toolsStatus) return
    let cancelled = false
    el.toolsStatus().then((s: { ffmpeg: boolean }) => {
      if (!cancelled && s && !s.ffmpeg) setNeedsFfmpeg(true)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [track?.id, el])

  useEffect(() => {
    if (!track || !el?.onToolsDownloadProgress) return
    const off = el.onToolsDownloadProgress((d: { tool: string; percent: number }) => {
      if (d.tool === 'ffmpeg') setDlPercent(d.percent)
    })
    return () => off?.()
  }, [track?.id, el])

  const downloadFfmpeg = async (): Promise<void> => {
    if (!el?.toolsDownload || dlBusy) return
    setDlBusy(true)
    setDlError(null)
    setDlPercent(0)
    try {
      const r = await el.toolsDownload({ tools: ['ffmpeg'] })
      if (r?.error) { setDlError(r.error); return }
      setNeedsFfmpeg(false)
    } catch (e: any) {
      setDlError(e?.message ?? 'Download failed')
    } finally {
      setDlBusy(false)
    }
  }

  // Progress events are keyed by the id we pass into convertAudio.
  useEffect(() => {
    if (!el?.onConvertProgress) return
    const off = el.onConvertProgress((d: { id: string; percent: number }) => {
      if (d.id === convertId.current) setProgress(d.percent)
    })
    return off
  }, [el])

  const selected = useMemo(() => FORMATS.find((f) => f.id === format)!, [format])

  if (!track) return null

  const noElectron = !el?.convertAudio

  const run = async (): Promise<void> => {
    if (busy || noElectron) return
    const id = `${track.id}:${Date.now()}`
    convertId.current = id
    setBusy(true)
    setError(null)
    setProgress(0)
    try {
      const result = await el.convertAudio({
        id,
        filePath: track.path,
        format,
        bitrate: selected.lossy ? bitrate : undefined,
        stripMetadata: stripMeta,
      })
      if (result?.error) { setError(result.error); return }
      if (result?.track) {
        // Apply locally, then tell the other windows — libraryTracks isn't in
        // the blanket sync mirror, so without this a converted file made in the
        // pop-out wouldn't show up in the main window's Library until a rescan.
        addLibraryTrack(result.track as LibraryTrack)
        broadcastLibraryTrackAdd(result.track as LibraryTrack)
      }
      setProgress(100)
      setDone({ outPath: result?.outPath || '' })
    } catch (e: any) {
      setError(e?.message ?? 'Conversion failed')
    } finally {
      setBusy(false)
    }
  }

  // In a pop-out there's no dialog to dismiss — closing means closing the window.
  const close = (): void => {
    if (busy) return
    if (floating) el?.closeSelf?.()
    else closeConvert()
  }

  return (
    <ModalOverlay
      onClose={close}
      floating={floating}
      zIndexClassName="z-[60]"
      panelClassName="bg-surface border border-[var(--border)] rounded-t-2xl md:rounded-2xl shadow-2xl w-full md:max-w-md max-h-[92svh]"
      minWidth={380} minHeight={440}
    >
      {({ onHandleMouseDown, locked, toggleLock }) => (
      <div className="bg-surface w-full h-full flex flex-col overflow-y-auto">
        <div
          className={`flex items-center justify-between px-5 py-4 border-b border-[var(--border)] sticky top-0 bg-surface z-10 shrink-0`}
          style={floating ? ({ WebkitAppRegion: 'drag' } as CSSProperties) : undefined}
          onMouseDown={onHandleMouseDown}
        >
          <h2 className="flex items-center gap-2 text-text-primary text-sm font-semibold">
            <FileAudio2 size={15} className="text-accent" /> Convert format
          </h2>
          <div className="flex items-center gap-1" style={floating ? ({ WebkitAppRegion: 'no-drag' } as CSSProperties) : undefined}>
            {!floating && <LockToggle locked={locked} onClick={toggleLock} />}
            <button
              onClick={close}
              disabled={busy}
              className="text-text-muted hover:text-text-primary transition-colors disabled:opacity-40"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="px-5 py-4 space-y-4">
          {/* Source */}
          <div className="min-w-0">
            <p className="text-text-primary text-sm font-medium truncate">{track.title}</p>
            <p className="text-text-muted text-xs truncate">
              {fileName(track.path)}
              {sourceExt && <span className="uppercase opacity-70"> · {sourceExt}</span>}
            </p>
          </div>

          {needsFfmpeg ? (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-5 text-sm text-text-primary flex flex-col items-center gap-2 text-center">
              <Download size={22} className="text-amber-400" />
              <p className="font-medium">One-time download needed</p>
              <p className="text-text-muted text-xs max-w-[280px]">
                Converting uses an open-source audio converter (ffmpeg). It downloads once (~40 MB) and stays on this device.
              </p>
              {dlError && (
                <div className="flex items-start gap-2 text-red-400 text-xs max-w-[280px]">
                  <AlertCircle size={13} className="shrink-0 mt-0.5" />
                  <span className="min-w-0 break-words">{dlError}</span>
                </div>
              )}
              {dlBusy && (
                <div className="w-full max-w-[280px] space-y-1.5 mt-1">
                  <div className="h-1.5 rounded-full bg-surface-overlay overflow-hidden">
                    <div className="h-full bg-accent transition-[width] duration-200" style={{ width: `${dlPercent}%` }} />
                  </div>
                  <p className="text-[11px] text-text-muted text-center tabular-nums">
                    Downloading… {dlPercent > 0 && `${dlPercent}%`}
                  </p>
                </div>
              )}
              <div className="flex flex-col items-center gap-2 mt-2 w-full">
                {el?.toolsDownload && (
                  <button
                    onClick={downloadFfmpeg}
                    disabled={dlBusy}
                    className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold bg-accent text-white hover:bg-accent/90 transition-colors disabled:opacity-60"
                  >
                    {dlBusy ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
                    {dlBusy ? 'Downloading…' : 'Download converter'}
                  </button>
                )}
                <button
                  onClick={close}
                  className="px-3 py-1.5 text-xs font-semibold text-text-muted hover:text-text-primary transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
          ) : done ? (
            <div className="rounded-xl border border-accent/40 bg-accent/10 px-4 py-4 text-sm text-text-primary flex flex-col items-center gap-2 text-center">
              <Check size={22} className="text-accent" />
              <p className="font-medium">Converted to {selected.label}</p>
              {done.outPath && (
                <p className="text-text-muted text-xs break-all">{fileName(done.outPath)}</p>
              )}
              <div className="flex gap-2 mt-1">
                {done.outPath && el?.showItemInFolder && (
                  <button
                    onClick={() => el.showItemInFolder(done.outPath)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-text-secondary hover:text-text-primary bg-surface-overlay hover:bg-surface-raised transition-colors"
                  >
                    <Folder size={13} /> Show folder
                  </button>
                )}
                <button
                  onClick={close}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-accent text-white hover:bg-accent/90 transition-colors"
                >
                  Done
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Target format */}
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted mb-2">Convert to</p>
                <div className="grid grid-cols-3 gap-2">
                  {FORMATS.map((f) => {
                    const active = f.id === format
                    return (
                      <button
                        key={f.id}
                        disabled={busy}
                        onClick={() => setFormat(f.id)}
                        className={`flex flex-col items-start gap-0.5 rounded-xl border px-3 py-2 text-left transition-colors disabled:opacity-50 ${
                          active
                            ? 'border-accent bg-accent/10'
                            : 'border-[var(--border)] bg-surface-overlay/50 hover:bg-surface-overlay'
                        }`}
                      >
                        <span className={`text-sm font-bold ${active ? 'text-accent' : 'text-text-primary'}`}>{f.label}</span>
                        <span className="text-[10px] leading-tight text-text-muted">{f.blurb}</span>
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Bitrate (lossy only) */}
              {selected.lossy ? (
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted mb-2">Bitrate</p>
                  <div className="flex gap-2">
                    {BITRATES.map((b) => {
                      const active = b === bitrate
                      return (
                        <button
                          key={b}
                          disabled={busy}
                          onClick={() => setBitrate(b)}
                          className={`flex-1 py-1.5 rounded-lg text-xs font-semibold border transition-colors disabled:opacity-50 ${
                            active
                              ? 'border-accent bg-accent/10 text-accent'
                              : 'border-[var(--border)] text-text-secondary hover:bg-surface-overlay'
                          }`}
                        >
                          {b.replace('k', '')}<span className="opacity-60"> kbps</span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              ) : (
                <p className="text-[11px] text-text-muted opacity-75">
                  {selected.label} is lossless — the full audio quality is preserved.
                </p>
              )}

              {/* Remove metadata */}
              <button
                type="button"
                disabled={busy}
                onClick={() => setStripMeta((v) => !v)}
                className="w-full flex items-center gap-3 rounded-xl border border-[var(--border)] bg-surface-overlay/50 px-3 py-2.5 text-left hover:bg-surface-overlay transition-colors disabled:opacity-50"
              >
                <Eraser size={16} className={stripMeta ? 'text-accent shrink-0' : 'text-text-muted shrink-0'} />
                <span className="flex-1 min-w-0">
                  <span className="block text-xs font-semibold text-text-primary">Remove metadata</span>
                  <span className="block text-[10px] text-text-muted leading-tight">Strip tags &amp; cover art from the new file</span>
                </span>
                <span
                  className={`relative w-9 h-5 rounded-full transition-colors shrink-0 ${stripMeta ? 'bg-accent' : 'bg-surface-raised'}`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${stripMeta ? 'translate-x-4' : ''}`}
                  />
                </span>
              </button>

              {noElectron && (
                <div className="flex items-center gap-2 text-amber-400 text-xs">
                  <AlertCircle size={13} className="shrink-0" />
                  <span>Conversion is only available in the desktop app.</span>
                </div>
              )}

              {error && (
                <div className="flex items-start gap-2 text-red-400 text-xs">
                  <AlertCircle size={13} className="shrink-0 mt-0.5" />
                  <span className="min-w-0 break-words">{error}</span>
                </div>
              )}

              {busy && (
                <div className="space-y-1.5">
                  <div className="h-1.5 rounded-full bg-surface-overlay overflow-hidden">
                    <div className="h-full bg-accent transition-[width] duration-200" style={{ width: `${progress}%` }} />
                  </div>
                  <p className="text-[11px] text-text-muted text-center tabular-nums">{progress}%</p>
                </div>
              )}

              <button
                onClick={run}
                disabled={busy || noElectron}
                className="w-full py-2.5 rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2 bg-accent text-white hover:bg-accent/90 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {busy ? <Loader2 size={15} className="animate-spin" /> : <FileAudio2 size={15} />}
                {busy ? 'Converting…' : `Convert to ${selected.label}`}
              </button>
              <p className="text-[10px] text-text-muted opacity-60 text-center">
                Saves a new file next to the original — the source is kept.
              </p>
            </>
          )}
        </div>
      </div>
      )}
    </ModalOverlay>
  )
}
