import { useEffect, useMemo, useRef, useState, type DragEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { AudioLines, Check, FileUp, Info, ListPlus, Loader2, Mic, MonitorSpeaker, Music2, Pause, Play, RefreshCw, RotateCcw, SearchX, X } from 'lucide-react'
import { ModalOverlay } from './Modal'
import { useStore } from '../store/useStore'
import { apiFetch, buildImageUrl, songToTrack, type JWApiSong } from '../lib/juicewrldApi'
import { checkRecognition, identifyClip } from '../lib/recognitionApi'
import { canCaptureSystemAudio, recordRecognitionClip, type RecognitionSource } from '../lib/recognitionCapture'
import { decodeRecognitionFile, sliceRecognitionClip, type DecodedRecognitionFile } from '../lib/recognitionFile'
import { RECOGNITION_SECONDS, validateRecognitionClip, type RecognitionMatch, type RecognitionResult } from '../lib/recognitionContract'

type Phase = 'checking' | 'unavailable' | 'ready' | 'requesting' | 'listening' | 'decoding' | 'trimming' | 'identifying' | 'result'
type Source = RecognitionSource | 'file'
const button = 'inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40 disabled:cursor-not-allowed'
const SOURCE_KEY = 'recognition-source'
const RING = 2 * Math.PI * 47

const SOURCES: { id: Source, label: string, icon: typeof Mic }[] = [
  { id: 'microphone', label: 'Microphone', icon: Mic },
  { id: 'system', label: 'This device', icon: MonitorSpeaker },
  { id: 'file', label: 'File', icon: FileUp },
]

const formatTime = (value: number) => {
  const total = Math.max(0, Math.floor(value))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

function storedSource(systemAvailable: boolean): Source {
  try {
    const value = localStorage.getItem(SOURCE_KEY)
    if (value === 'microphone' || value === 'file' || (value === 'system' && systemAvailable)) return value
  } catch {}
  return 'microphone'
}

function Artwork({ url, className }: { url: string | null, className: string }): JSX.Element {
  return (
    <div className={`relative shrink-0 bg-surface-overlay flex items-center justify-center overflow-hidden ${className}`}>
      <Music2 size={22} className="text-text-muted" />
      {url && <img src={buildImageUrl(url)} alt="" className="absolute inset-0 w-full h-full object-cover" onError={event => { event.currentTarget.hidden = true }} />}
    </div>
  )
}

export default function RecognitionModal(): JSX.Element {
  const systemAvailable = useMemo(canCaptureSystemAudio, [])
  const [phase, setPhase] = useState<Phase>('checking')
  const [source, setSource] = useState<Source>(() => storedSource(systemAvailable))
  const [error, setError] = useState('')
  const [result, setResult] = useState<RecognitionResult | null>(null)
  const [seconds, setSeconds] = useState(0)
  const [level, setLevel] = useState(0)
  const [action, setAction] = useState<string | null>(null)
  const [queued, setQueued] = useState<string | null>(null)
  const [decoded, setDecoded] = useState<DecodedRecognitionFile | null>(null)
  const [start, setStart] = useState(0)
  const [previewing, setPreviewing] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const controller = useRef<AbortController | null>(null)
  const actionController = useRef<AbortController | null>(null)
  const preview = useRef<{ context: AudioContext, node: AudioBufferSourceNode, raf: number } | null>(null)
  const playhead = useRef<HTMLDivElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const busy = ['requesting', 'listening', 'decoding', 'identifying'].includes(phase)
  const visibleSources = SOURCES.filter(item => item.id !== 'system' || systemAvailable)
  const segment = decoded ? Math.min(RECOGNITION_SECONDS, decoded.duration) : RECOGNITION_SECONDS

  const stopPreview = () => {
    const current = preview.current
    preview.current = null
    setPreviewing(false)
    if (!current) return
    cancelAnimationFrame(current.raf)
    current.node.onended = null
    try { current.node.stop() } catch {}
    void current.context.close().catch(() => {})
  }

  const close = () => {
    controller.current?.abort()
    actionController.current?.abort()
    stopPreview()
    useStore.getState().setShowRecognition(false)
  }

  const begin = () => {
    controller.current?.abort()
    stopPreview()
    const next = new AbortController()
    controller.current = next
    setError('')
    setResult(null)
    setQueued(null)
    setSeconds(0)
    setLevel(0)
    return next
  }

  const check = async () => {
    const next = begin()
    setPhase('checking')
    try {
      const available = await checkRecognition(next.signal)
      if (!next.signal.aborted) setPhase(available ? 'ready' : 'unavailable')
    } catch (err) {
      if (next.signal.aborted) return
      setPhase('unavailable')
      setError(err instanceof Error ? err.message : 'Song recognition is unavailable. Try again later.')
    }
  }

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null
    closeButton.current?.focus()
    void check()
    return () => {
      controller.current?.abort()
      actionController.current?.abort()
      stopPreview()
      if (previousFocus?.isConnected) previousFocus.focus()
    }
  }, [])

  // Where a failed or cancelled attempt lands: back to the picker it came from.
  const home = (): Phase => (source === 'file' && decoded ? 'trimming' : 'ready')

  const cancel = () => {
    controller.current?.abort()
    setPhase(home())
    setSeconds(0)
    setLevel(0)
  }

  useEffect(() => {
    const onHidden = () => {
      if (!document.hidden) return
      stopPreview()
      if (phase === 'requesting' || phase === 'listening') cancel()
    }
    document.addEventListener('visibilitychange', onHidden)
    return () => document.removeEventListener('visibilitychange', onHidden)
  }, [phase, source, decoded])

  const chooseSource = (next: Source) => {
    if (busy) return
    setSource(next)
    try { localStorage.setItem(SOURCE_KEY, next) } catch {}
    stopPreview()
    setError('')
    setResult(null)
    setPhase(next === 'file' && decoded ? 'trimming' : 'ready')
  }

  const submit = async (next: AbortController, clip: Blob, fallback: Phase) => {
    setPhase('identifying')
    try {
      const response = await identifyClip(clip, next.signal)
      if (next.signal.aborted) return
      setResult(response)
      setPhase('result')
    } catch (err) {
      if (next.signal.aborted) return
      setError(err instanceof Error ? err.message : 'Could not identify this clip. Please try again.')
      setPhase(fallback)
    }
  }

  const listen = async (capture: RecognitionSource) => {
    const next = begin()
    setPhase('requesting')
    // The microphone would hear this app too; device audio is often meant to.
    if (capture === 'microphone') {
      const store = useStore.getState()
      store.setIsPlaying(false)
      if (store.radioFmActive) store.setRadioFmActive(false)
    }
    try {
      const clip = await recordRecognitionClip(next.signal, (elapsed, inputLevel) => {
        if (next.signal.aborted) return
        setPhase('listening')
        setSeconds(elapsed)
        setLevel(inputLevel)
      }, capture)
      if (next.signal.aborted) return
      await submit(next, clip, 'ready')
    } catch (err) {
      if (next.signal.aborted) return
      setError(err instanceof Error ? err.message : 'Could not record audio. Please try again.')
      setPhase('ready')
    }
  }

  const openFile = async (file: File) => {
    if (busy) return
    setSource('file')
    try { localStorage.setItem(SOURCE_KEY, 'file') } catch {}
    const next = begin()
    setPhase('decoding')
    try {
      const read = await decodeRecognitionFile(file, next.signal)
      if (next.signal.aborted) return
      if (!read) {
        // This runtime cannot decode it, but the server can try a short clip as-is.
        setDecoded(null)
        validateRecognitionClip(file)
        await submit(next, file, 'ready')
        return
      }
      setDecoded(read)
      setStart(read.suggestedStart)
      setPhase('trimming')
    } catch (err) {
      if (next.signal.aborted) return
      setDecoded(null)
      setError(err instanceof Error ? err.message : 'Could not read that file. Choose another one.')
      setPhase('ready')
    }
  }

  const identifyPart = () => {
    if (!decoded) return
    const next = begin()
    void submit(next, sliceRecognitionClip(decoded, start, segment), 'trimming')
  }

  const moveTo = (value: number) => {
    if (!decoded) return
    stopPreview()
    setStart(Math.round(Math.min(Math.max(0, value), decoded.duration - segment) * 10) / 10)
  }

  const fromPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!decoded) return
    const rect = event.currentTarget.getBoundingClientRect()
    moveTo(((event.clientX - rect.left) / rect.width) * decoded.duration - segment / 2)
  }

  const togglePreview = () => {
    if (preview.current) { stopPreview(); return }
    if (!decoded) return
    try {
      const context = new AudioContext()
      const from = Math.floor(start * decoded.sampleRate)
      const samples = decoded.samples.subarray(from, from + Math.floor(segment * decoded.sampleRate))
      const buffer = context.createBuffer(1, samples.length, decoded.sampleRate)
      buffer.copyToChannel(samples as Float32Array<ArrayBuffer>, 0)
      const node = context.createBufferSource()
      node.buffer = buffer
      node.connect(context.destination)
      const state = { context, node, raf: 0 }
      const startedAt = context.currentTime
      const offset = start
      const duration = decoded.duration
      node.onended = () => { if (preview.current === state) stopPreview() }
      // The playhead is moved directly so a 60fps preview never re-renders the dialog.
      const tick = () => {
        if (preview.current !== state) return
        const at = offset + Math.min(segment, context.currentTime - startedAt)
        if (playhead.current) playhead.current.style.transform = `translateX(${(at / duration) * 100}%)`
        state.raf = requestAnimationFrame(tick)
      }
      useStore.getState().setIsPlaying(false)
      node.start()
      preview.current = state
      setPreviewing(true)
      tick()
    } catch {
      setError('Could not play a preview on this device.')
    }
  }

  const openMatch = async (match: RecognitionMatch, mode: 'play' | 'queue') => {
    if (actionController.current) return
    const next = new AbortController()
    actionController.current = next
    setAction(`${mode}:${match.recording_id}`)
    setError('')
    const timeout = setTimeout(() => next.abort(), 15_000)
    try {
      const song = await apiFetch<JWApiSong>(`/songs/${match.song_id}/`, {}, next.signal)
      if (next.signal.aborted) return
      if (song.id !== match.song_id || !song.path) throw new Error('This recording is no longer available to play.')
      const track = songToTrack(song)
      if (mode === 'play') {
        useStore.getState().playTrack(track)
        close()
      } else {
        useStore.getState().addToQueue(track)
        setQueued(match.recording_id)
      }
    } catch {
      if (controller.current?.signal.aborted) return
      setError('Could not load this recording. Check your connection and try again.')
    } finally {
      clearTimeout(timeout)
      actionController.current = null
      setAction(null)
    }
  }

  const canDrop = !busy && phase !== 'checking' && phase !== 'unavailable'
  // Always claim file drags over the dialog so a drop mid-recording is ignored
  // rather than handed to the window.
  const onDragOver = (event: DragEvent) => {
    if (!event.dataTransfer.types.includes('Files')) return
    event.preventDefault()
    event.dataTransfer.dropEffect = canDrop ? 'copy' : 'none'
    setDragOver(canDrop)
  }
  const onDrop = (event: DragEvent) => {
    if (!event.dataTransfer.types.includes('Files')) return
    event.preventDefault()
    setDragOver(false)
    const file = event.dataTransfer.files?.[0]
    if (canDrop && file) void openFile(file)
  }

  const system = source === 'system'
  const title = phase === 'checking' ? 'Checking availability…'
    : phase === 'unavailable' ? 'Recognition is unavailable'
    : phase === 'requesting' ? (system ? 'Allow device audio' : 'Allow microphone access')
    : phase === 'listening' ? 'Listening…'
    : phase === 'decoding' ? 'Reading your file…'
    : phase === 'trimming' ? 'Pick the part to identify'
    : phase === 'identifying' ? 'Finding your song…'
    : result?.status === 'match' ? 'Found it'
    : result?.status === 'ambiguous' ? 'A few possible recordings'
    : result?.status === 'no_match' ? 'No match this time'
    : source === 'file' ? 'Identify a song in a file'
    : system ? 'What’s playing on this device?' : 'What song is this?'
  const description = phase === 'checking' ? 'Making sure song recognition is ready.'
    : phase === 'unavailable' ? 'Try again later. You can keep browsing and listening in the meantime.'
    : phase === 'requesting' ? (system ? 'Confirm sharing so Unreleased can hear what this device is playing.' : 'Your device may ask for permission to use the microphone.')
    : phase === 'listening' ? (system ? 'Recording what this device is playing.' : 'Keep the music playing near your microphone.')
    : phase === 'decoding' ? 'Decoding happens on this device.'
    : phase === 'trimming' ? `Drag across the waveform to choose ${Math.round(segment)} seconds. A part with vocals works best.`
    : phase === 'identifying' ? 'Comparing your clip with the Juice WRLD catalogue.'
    : result?.status === 'ambiguous' ? 'These recordings share similar audio. Choose one to explore.'
    : result?.status === 'match' ? 'Matched against the Juice WRLD catalogue.'
    : result?.status === 'no_match' ? 'Try a clearer section with vocals. The recording may not be in the catalogue yet.'
    : source === 'file' ? 'Drop an audio or video file of any length, then pick the part to identify.'
    : system ? `Records ${RECOGNITION_SECONDS} seconds of whatever is playing — any app, including this one.`
    : `Listens through your microphone for ${RECOGNITION_SECONDS} seconds.`
  const note = source === 'file' ? 'Files are read on this device and only the part you pick is uploaded. Short clips this device can’t read are uploaded as they are.'
    : system ? 'Only audio is recorded, nothing on your screen. The clip is sent to the recognition server to identify the song and is not saved.'
    : 'Listening pauses playback in this app. The clip is sent to the recognition server to identify the song and is not saved.'

  const showOrb = phase === 'checking' || phase === 'requesting' || phase === 'listening' || phase === 'identifying'
    || (phase === 'ready' && source !== 'file')
  const listening = phase === 'listening'
  const SourceIcon = system ? MonitorSpeaker : Mic
  const remaining = Math.ceil(Math.max(0, RECOGNITION_SECONDS - seconds))
  const quiet = listening && seconds > 3 && level < 0.01

  return (
    <ModalOverlay onClose={close} standalone zIndexClassName="z-[200]" panelClassName="w-full max-w-lg max-h-[90dvh] overflow-y-auto bg-surface border border-border rounded-2xl shadow-2xl">
      {() => (
        <div ref={panel} role="dialog" aria-modal="true" aria-labelledby="recognition-title" aria-describedby="recognition-description" className="relative"
          onDragOver={onDragOver} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragOver(false) }} onDrop={onDrop}
          onKeyDown={(event) => {
            if (event.key !== 'Tab') return
            const elements = [...(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled):not([type="file"]), [tabindex="0"]') ?? [])]
            const first = elements[0], last = elements[elements.length - 1]
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
          }}>
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <span className="flex items-center gap-2 text-sm font-medium text-text-primary"><AudioLines size={17} className="text-accent" /> Identify song</span>
            <button ref={closeButton} onClick={close} aria-label="Close song recognition" className="p-2 rounded-lg text-text-muted hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"><X size={18} /></button>
          </div>

          <div className="px-6 pt-5 pb-6">
            {phase !== 'checking' && phase !== 'unavailable' && (
              <div role="radiogroup" aria-label="Listen to" className="flex p-1 rounded-xl bg-surface-overlay">
                {visibleSources.map(({ id, label, icon: Icon }) => (
                  <button key={id} role="radio" aria-checked={source === id} disabled={busy && source !== id} onClick={() => chooseSource(id)}
                    className={`flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40 ${source === id ? 'bg-surface text-text-primary shadow-sm' : 'text-text-secondary hover:text-text-primary'}`}>
                    <Icon size={14} /> {label}
                  </button>
                ))}
              </div>
            )}

            {showOrb && (
              <div className="relative w-40 h-40 mx-auto mt-7 mb-6">
                {listening && <>
                  <span aria-hidden="true" className="recog-ripple absolute inset-3 rounded-full bg-accent/30" />
                  <span aria-hidden="true" className="recog-ripple absolute inset-3 rounded-full bg-accent/30" style={{ animationDelay: '1.2s' }} />
                </>}
                <span aria-hidden="true" className="recog-level absolute inset-3 rounded-full bg-accent/30"
                  style={{ transform: `scale(${1 + level * 0.28})`, opacity: listening ? 0.4 + level * 0.6 : 0 }} />
                <svg aria-hidden="true" viewBox="0 0 100 100" className="absolute inset-0 -rotate-90">
                  <circle cx="50" cy="50" r="47" fill="none" strokeWidth="2.5" stroke="var(--surface-overlay)" />
                  {listening && <circle cx="50" cy="50" r="47" fill="none" strokeWidth="2.5" strokeLinecap="round" stroke="rgb(var(--accent-rgb))"
                    strokeDasharray={RING} strokeDashoffset={RING * (1 - seconds / RECOGNITION_SECONDS)} style={{ transition: 'stroke-dashoffset 0.1s linear' }} />}
                </svg>
                <button
                  onClick={() => listening || phase === 'requesting' ? cancel() : phase === 'ready' && source !== 'file' ? void listen(source) : undefined}
                  disabled={phase === 'checking' || phase === 'identifying' || !!action}
                  aria-label={listening || phase === 'requesting' ? 'Stop listening' : system ? 'Listen to this device' : 'Listen with microphone'}
                  className="absolute inset-3 rounded-full bg-accent text-white shadow-lg shadow-accent/30 flex items-center justify-center transition-colors hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent/40 disabled:cursor-default disabled:hover:bg-accent">
                  {phase === 'checking' || phase === 'identifying' || phase === 'requesting' ? <Loader2 size={40} className="motion-safe:animate-spin" />
                    : listening ? <span className="text-4xl font-semibold tabular-nums">{remaining}</span>
                    : <SourceIcon size={46} strokeWidth={1.75} />}
                </button>
              </div>
            )}

            {source === 'file' && (phase === 'ready' || phase === 'decoding') && (
              <button onClick={() => fileInput.current?.click()} disabled={phase === 'decoding'}
                className={`mt-5 w-full rounded-2xl border-2 border-dashed px-6 py-9 flex flex-col items-center gap-3 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${dragOver ? 'border-accent bg-accent/10' : 'border-border hover:border-accent/60 hover:bg-surface-overlay'}`}>
                <span className="w-14 h-14 rounded-full bg-accent/10 text-accent flex items-center justify-center">
                  {phase === 'decoding' ? <Loader2 size={26} className="motion-safe:animate-spin" /> : <FileUp size={26} />}
                </span>
                <span className="text-sm font-medium text-text-primary">{phase === 'decoding' ? 'Reading file…' : 'Drop an audio or video file'}</span>
                <span className="text-xs text-text-muted">{phase === 'decoding' ? 'Long files can take a moment.' : 'or click to browse · MP3, M4A, WAV, FLAC, Ogg, MP4 · up to 80 MB'}</span>
              </button>
            )}

            {phase === 'trimming' && decoded && (
              <div className="mt-5 rounded-2xl border border-border p-4 animate-recog-in">
                <div className="flex items-center justify-between gap-3 text-xs">
                  <span className="min-w-0 truncate font-medium text-text-primary" title={decoded.name}>{decoded.name}</span>
                  <span className="shrink-0 text-text-muted tabular-nums">{formatTime(decoded.duration)}</span>
                </div>
                <div className="relative h-20 mt-3 select-none touch-none cursor-pointer" aria-hidden="true"
                  onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); fromPointer(event) }}
                  onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) fromPointer(event) }}>
                  <div className="absolute inset-0 flex items-center gap-[2px]">
                    {decoded.peaks.map((peak, i) => {
                      const at = ((i + 0.5) / decoded.peaks.length) * decoded.duration
                      const inside = at >= start && at <= start + segment
                      return <span key={i} className={`flex-1 rounded-full ${inside ? 'bg-accent' : 'bg-text-muted opacity-40'}`} style={{ height: `${Math.max(6, peak * 100)}%` }} />
                    })}
                  </div>
                  <div className="absolute inset-y-0 rounded-lg border-2 border-accent bg-accent/10 pointer-events-none"
                    style={{ left: `${(start / decoded.duration) * 100}%`, width: `${(segment / decoded.duration) * 100}%` }} />
                  {previewing && <div ref={playhead} className="absolute inset-0 pointer-events-none" style={{ transform: `translateX(${(start / decoded.duration) * 100}%)` }}>
                    <span className="absolute inset-y-0 left-0 w-0.5 -ml-px bg-text-primary rounded-full" />
                  </div>}
                </div>
                <input type="range" min={0} max={Math.max(0, decoded.duration - segment)} step={0.5} value={start}
                  onChange={event => moveTo(Number(event.target.value))}
                  aria-label="Start of the part to identify" aria-valuetext={`${formatTime(start)} to ${formatTime(start + segment)}`}
                  className="w-full mt-3 accent-[var(--accent)]" />
                <div className="flex items-center justify-between gap-2 mt-1 text-xs">
                  <span className="text-text-secondary tabular-nums">{formatTime(start)} – {formatTime(start + segment)}</span>
                  {Math.abs(start - decoded.suggestedStart) < 0.05 && <span className="text-text-muted">Loudest part picked for you</span>}
                </div>
                <div className="grid grid-cols-[auto_1fr] gap-2 mt-4">
                  <button onClick={togglePreview} aria-label={previewing ? 'Stop preview' : 'Preview this part'} className={`${button} bg-surface-overlay text-text-primary`}>
                    {previewing ? <Pause size={16} /> : <Play size={16} />}{previewing ? 'Stop' : 'Preview'}
                  </button>
                  <button onClick={identifyPart} className={`${button} bg-accent text-white hover:bg-accent-hover`}><AudioLines size={16} /> Identify this part</button>
                </div>
              </div>
            )}

            <div role="status" aria-live="polite" aria-atomic="true" className={`text-center ${showOrb ? '' : 'mt-6'}`}>
              <h2 id="recognition-title" className="text-xl font-semibold text-text-primary">{title}</h2>
              <p id="recognition-description" className="mt-2 text-sm text-text-secondary leading-relaxed">{description}</p>
              {listening && <p className={`mt-2 text-xs ${quiet ? 'text-text-primary' : 'text-text-muted'}`}>
                {quiet ? (system ? 'No sound yet. Make sure something is playing and not muted.' : 'Very little sound detected. Move closer to the music.') : `Stops automatically after ${RECOGNITION_SECONDS} seconds.`}
              </p>}
            </div>

            {error && <p role="alert" className="mt-5 p-3 rounded-lg bg-surface-overlay text-sm text-text-primary">{error}</p>}

            {phase === 'result' && result?.status === 'match' && (() => {
              const match = result.matches[0]
              return (
                <div className="mt-6 flex flex-col items-center text-center animate-recog-in">
                  <Artwork url={match.image_url} className="w-40 h-40 rounded-2xl shadow-xl" />
                  <p className="mt-4 text-lg font-semibold text-text-primary break-words">{match.title}</p>
                  <p className="text-sm text-text-secondary">{match.artist}</p>
                  {match.version && <span className="mt-2 px-2.5 py-0.5 rounded-full bg-surface-overlay text-xs text-text-secondary break-words">{match.version}</span>}
                  <p className="mt-2 text-xs text-text-muted">Heard at {formatTime(match.offset_seconds)} in the recording</p>
                  <div className="flex flex-wrap justify-center gap-2 mt-5">
                    <button disabled={!!action} onClick={() => void openMatch(match, 'play')} className={`${button} bg-accent text-white hover:bg-accent-hover`}><Play size={14} />{action === `play:${match.recording_id}` ? 'Loading…' : 'Play'}</button>
                    <button disabled={!!action || queued === match.recording_id} onClick={() => void openMatch(match, 'queue')} className={`${button} bg-surface-overlay text-text-primary`}>{queued === match.recording_id ? <Check size={14} /> : <ListPlus size={14} />}{queued === match.recording_id ? 'Added' : action === `queue:${match.recording_id}` ? 'Loading…' : 'Queue'}</button>
                    <button disabled={!!action} onClick={() => { useStore.getState().setInfoSongId(match.song_id); close() }} className={`${button} text-text-secondary hover:bg-surface-overlay`}><Info size={14} /> Details</button>
                  </div>
                </div>
              )
            })()}

            {phase === 'result' && result?.status === 'ambiguous' && (
              <ul className="mt-6 space-y-2 animate-recog-in">
                {result.matches.map(match => (
                  <li key={match.recording_id} className="flex items-center gap-3 rounded-xl border border-border p-2.5">
                    <Artwork url={match.image_url} className="w-12 h-12 rounded-lg" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-text-primary truncate" title={match.title}>{match.title}</p>
                      <p className="text-xs text-text-secondary truncate">{match.artist}{match.version ? ` · ${match.version}` : ''}</p>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <button disabled={!!action} onClick={() => void openMatch(match, 'play')} aria-label={`Play ${match.title}`} title="Play" className="p-2 rounded-lg bg-accent text-white hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40">
                        {action === `play:${match.recording_id}` ? <Loader2 size={15} className="motion-safe:animate-spin" /> : <Play size={15} />}
                      </button>
                      <button disabled={!!action || queued === match.recording_id} onClick={() => void openMatch(match, 'queue')} aria-label={queued === match.recording_id ? `${match.title} added to queue` : `Add ${match.title} to queue`} title="Queue" className="p-2 rounded-lg text-text-secondary hover:bg-surface-overlay hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40">
                        {queued === match.recording_id ? <Check size={15} /> : action === `queue:${match.recording_id}` ? <Loader2 size={15} className="motion-safe:animate-spin" /> : <ListPlus size={15} />}
                      </button>
                      <button disabled={!!action} onClick={() => { useStore.getState().setInfoSongId(match.song_id); close() }} aria-label={`Details for ${match.title}`} title="Details" className="p-2 rounded-lg text-text-secondary hover:bg-surface-overlay hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40"><Info size={15} /></button>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {phase === 'result' && result?.status === 'no_match' && (
              <div className="mt-6 flex justify-center animate-recog-in" aria-hidden="true">
                <span className="w-16 h-16 rounded-full bg-surface-overlay text-text-muted flex items-center justify-center"><SearchX size={28} /></span>
              </div>
            )}

            <div className="mt-6">
              {phase === 'unavailable' ? <button onClick={() => void check()} className={`${button} w-full bg-surface-overlay text-text-primary`}><RefreshCw size={16} /> Check again</button>
                : busy ? <button onClick={cancel} className={`${button} w-full bg-surface-overlay text-text-primary`}>Cancel</button>
                : phase === 'result' ? <div className="flex flex-col gap-2">
                  {source === 'file'
                    ? decoded
                      ? <button disabled={!!action} onClick={() => { setResult(null); setError(''); setPhase('trimming') }} className={`${button} w-full bg-surface-overlay text-text-primary`}><RotateCcw size={16} /> Try another part</button>
                      : <button disabled={!!action} onClick={() => fileInput.current?.click()} className={`${button} w-full bg-surface-overlay text-text-primary`}><FileUp size={16} /> Choose another file</button>
                    : <button disabled={!!action} onClick={() => void listen(source)} className={`${button} w-full bg-surface-overlay text-text-primary`}><SourceIcon size={16} /> Listen again</button>}
                </div>
                : phase === 'trimming' ? <button onClick={() => fileInput.current?.click()} className={`${button} w-full text-text-secondary hover:bg-surface-overlay`}><FileUp size={16} /> Choose another file</button>
                : null}
              <input ref={fileInput} hidden type="file" accept="audio/*,video/*,.webm,.ogg,.opus,.m4a,.mp3,.wav,.flac,.aac,.mp4,.mov" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void openFile(file) }} />
            </div>

            {phase !== 'checking' && phase !== 'unavailable' && <p className="mt-5 text-xs text-text-muted text-center leading-relaxed">{note}</p>}
          </div>

          {dragOver && !(source === 'file' && phase === 'ready') && (
            <div aria-hidden="true" className="absolute inset-2 rounded-2xl border-2 border-dashed border-accent bg-surface/90 flex flex-col items-center justify-center gap-2 pointer-events-none">
              <FileUp size={28} className="text-accent" />
              <p className="text-sm font-medium text-text-primary">Drop to identify this file</p>
            </div>
          )}
        </div>
      )}
    </ModalOverlay>
  )
}
