import { SwapIcon } from './PlayerMotion'
import { useCallback, useEffect, useRef, useState, CSSProperties, ReactNode } from 'react'
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Shuffle,
  Repeat,
  Repeat1,
  Heart,
  Pin,
  ExternalLink,
  EyeOff,
  Minus,
  X,
  Music,
  Mic2,
  ListMusic,
  Radio,
  Volume2,
  VolumeX,
} from 'lucide-react'
import { useStorePick } from '../store/useStore'
import { sendPlayerCommand } from '../lib/windowSync'
import { formatDuration } from '../lib/format'
import { AlbumArtThumbnail } from './AlbumArtThumbnail'
import { ProgressiveCover } from './ProgressiveCover'
import LyricsDisplay from './LyricsDisplay'
import type { Track } from '../types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const el = (window as any).electron

const noDrag = { WebkitAppRegion: 'no-drag' } as CSSProperties

type PanelKind = 'lyrics' | 'queue'
const PANEL_LS_KEY = 'unreleased:miniPlayerPanel'
const MAX_QUEUE_SHOWN = 50

// Small frameless-window chrome button (pin / open app / minimize / close).
function WinBtn({ onClick, title, active, danger, children }: {
  onClick: () => void
  title: string
  active?: boolean
  danger?: boolean
  children: ReactNode
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      title={title}
      style={noDrag}
      className={`w-6 h-6 flex items-center justify-center rounded transition-colors ${
        danger
          ? 'text-text-muted hover:text-white hover:bg-red-600'
          : active
            ? 'text-accent hover:bg-surface-overlay'
            : 'text-text-muted hover:text-text-primary hover:bg-surface-overlay'
      }`}
    >
      {children}
    </button>
  )
}

// Compact queue row — single click jumps (unlike the main QueuePanel's
// double-click; the mini window is built for quick one-click interactions).
function MiniQueueRow({ track, isActive, isPlaying, onPlay, onRemove }: {
  track: Track
  isActive?: boolean
  isPlaying?: boolean
  onPlay?: () => void
  onRemove?: () => void
}): JSX.Element {
  return (
    <div
      className={`flex items-center gap-2 px-1.5 py-1 rounded-lg group transition-colors ${
        isActive ? 'bg-surface-overlay' : 'hover:bg-surface-overlay'
      } ${onPlay && !isActive ? 'cursor-pointer' : ''}`}
      onClick={onPlay}
    >
      <div className="w-7 h-7 rounded shrink-0 overflow-hidden bg-surface-overlay">
        <AlbumArtThumbnail track={track} size={28} fill className="w-full h-full" />
      </div>
      <div className="flex-1 min-w-0">
        <p className={`text-[11px] font-medium truncate leading-tight ${isActive ? 'text-accent' : 'text-text-primary'}`} title={track.title}>
          {track.title}
        </p>
        <p className="text-[9px] text-text-muted truncate">{track.artist}</p>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {isPlaying ? (
          <span className="flex gap-0.5 items-end h-2.5">
            {[0.4, 0.7, 1, 0.6].map((h, i) => (
              <span
                key={i}
                className="w-0.5 bg-accent rounded-full animate-pulse"
                style={{ height: `${h * 100}%`, animationDelay: `${i * 0.15}s` }}
              />
            ))}
          </span>
        ) : (
          <span className="text-text-muted text-[9px] tabular-nums opacity-50">
            {track.duration ? formatDuration(track.duration) : ''}
          </span>
        )}
        {onRemove && (
          <button
            onClick={(e) => { e.stopPropagation(); onRemove() }}
            className="opacity-0 group-hover:opacity-100 text-text-muted hover:text-red-400 transition-all p-0.5"
          >
            <X size={10} />
          </button>
        )}
      </div>
    </div>
  )
}

function SectionLabel({ children }: { children: ReactNode }): JSX.Element {
  return (
    <p className="text-text-muted text-[9px] uppercase tracking-widest px-1.5 mb-1.5 font-semibold flex items-center gap-1.5">
      {children}
    </p>
  )
}

// Queue panel content — a trimmed-down QueuePanel. All mutations go through
// sendPlayerCommand: the main window owns the queue, this is just a viewport.
function MiniQueue(): JSX.Element {
  const {
    queue, queueIndex, currentTrack, isPlaying, radioMode, radioNext, queueLoadingMore,
    radioFmActive, radioFmNowPlaying, radioFmUpNext, radioFmQueuePreview,
  } = useStorePick('queue', 'queueIndex', 'currentTrack', 'isPlaying', 'radioMode', 'radioNext', 'queueLoadingMore', 'radioFmActive', 'radioFmNowPlaying', 'radioFmUpNext', 'radioFmQueuePreview')
  const [visibleCount, setVisibleCount] = useState(MAX_QUEUE_SHOWN)

  if (radioFmActive) {
    return (
      <div className="h-full overflow-y-auto px-3 py-3" style={{ scrollbarWidth: 'thin' }}>
        <SectionLabel>
          <Radio size={9} className="text-red-400" />
          <span className="text-red-400">999 FM</span>
          <span className="opacity-60">· On air</span>
        </SectionLabel>
        {radioFmNowPlaying && (
          <div className="px-1.5 py-1">
            <p className="text-[11px] font-medium text-red-400 truncate">{radioFmNowPlaying.title}</p>
            <p className="text-[9px] text-text-muted truncate">{radioFmNowPlaying.artist}</p>
          </div>
        )}
        {(radioFmUpNext || radioFmQueuePreview.length > 0) && (
          <div className="mt-3">
            <SectionLabel>Up next</SectionLabel>
            {radioFmUpNext && (
              <div className="px-1.5 py-1">
                <p className="text-[11px] font-medium text-text-primary truncate">{radioFmUpNext.title}</p>
                <p className="text-[9px] text-text-muted truncate">{radioFmUpNext.artist}</p>
              </div>
            )}
            {radioFmQueuePreview.map((title, i) => (
              <p key={`${title}-${i}`} className="px-1.5 py-1 text-[11px] text-text-secondary truncate">{title}</p>
            ))}
          </div>
        )}
      </div>
    )
  }

  const upcoming = queue.slice(queueIndex + 1)

  return (
    <div className="h-full overflow-y-auto px-3 py-3" style={{ scrollbarWidth: 'thin' }}>
      {currentTrack ? (
        <>
          <SectionLabel>Now playing</SectionLabel>
          <MiniQueueRow track={currentTrack} isActive isPlaying={isPlaying} />
        </>
      ) : (
        <div className="flex flex-col items-center justify-center h-full gap-2 text-center px-6">
          <ListMusic className="text-text-muted w-6 h-6 opacity-20" />
          <p className="text-text-muted text-xs">Queue is empty</p>
        </div>
      )}

      {radioMode ? (
        <div className="mt-3">
          <SectionLabel>
            <Radio size={9} className="text-accent" />
            <span className="text-accent">Random</span>
            <span className="opacity-60">· Up next</span>
          </SectionLabel>
          {radioNext ? (
            <MiniQueueRow track={radioNext} />
          ) : (
            <div className="flex items-center gap-2 px-1.5 py-1.5 text-text-muted text-[11px] opacity-50">
              <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
              Finding next song…
            </div>
          )}
        </div>
      ) : upcoming.length > 0 ? (
        <div className="mt-3">
          <SectionLabel>
            Up next
            <span className="opacity-60">· {upcoming.length}</span>
            {queueLoadingMore && <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse ml-auto" />}
          </SectionLabel>
          {upcoming.slice(0, visibleCount).map((track, i) => (
            <MiniQueueRow
              key={`up-${track.id}-${queueIndex + 1 + i}`}
              track={track}
              onPlay={() => sendPlayerCommand('jump', queueIndex + 1 + i)}
              onRemove={() => sendPlayerCommand('remove-queue', queueIndex + 1 + i)}
            />
          ))}
          {upcoming.length > visibleCount && (
            <button
              onClick={() => setVisibleCount((c) => c + MAX_QUEUE_SHOWN)}
              className="w-full text-text-muted hover:text-text-primary text-[11px] text-center py-1.5 rounded-lg hover:bg-surface-overlay transition-colors"
            >
              +{upcoming.length - visibleCount} more
            </button>
          )}
        </div>
      ) : currentTrack ? (
        <p className="text-text-muted text-[11px] text-center py-3 opacity-50">Nothing up next</p>
      ) : null}
    </div>
  )
}

// Compact always-on-top pop-out player. Renders inside a small frameless
// float window (see main.js FLOAT_SIZES['mini-player']); playback state is
// mirrored from the main window over window-sync, and every control sends a
// command back — no audio element lives here.
export default function MiniPlayer(): JSX.Element {
  const {
    currentTrack, currentTrackFull, isPlaying, progress, currentTime,
    shuffle, repeat, likedTrackIds, volume, playbackSpeed,
    radioFmActive, radioFmNowPlaying, radioFmMatchedSong,
    toggleLike, setVolume,
  } = useStorePick('currentTrack', 'currentTrackFull', 'isPlaying', 'progress', 'currentTime', 'shuffle', 'repeat', 'likedTrackIds', 'volume', 'playbackSpeed', 'radioFmActive', 'radioFmNowPlaying', 'radioFmMatchedSong', 'toggleLike', 'setVolume')

  const fm = radioFmActive
  // Wayland compositors intentionally reject application-driven window
  // resizing. main.js opens the mini player at a stable panel height there
  // and marks the URL so this view always keeps useful content below the bar.
  const fixedHeight = new URLSearchParams(window.location.search).get('fixedHeight') === 'true'

  // ── Panel (lyrics / queue) ────────────────────────────────────────────────
  const [panel, setPanel] = useState<PanelKind | null>(() => {
    const saved = localStorage.getItem(PANEL_LS_KEY)
    if (saved === 'lyrics' || saved === 'queue') return saved
    return fixedHeight ? 'lyrics' : null
  })
  useEffect(() => {
    if (panel) localStorage.setItem(PANEL_LS_KEY, panel)
    else localStorage.removeItem(PANEL_LS_KEY)
    // X11/Windows can grow and shrink the OS window. Native Wayland starts at
    // the panel height and stays there because the compositor owns resizing.
    if (!fixedHeight) el?.miniPlayerSetExpanded?.(panel !== null)
  }, [fixedHeight, panel])
  const togglePanel = (kind: PanelKind): void => setPanel((p) => (p === kind ? (fixedHeight ? p : null) : kind))

  // ── Always-on-top pin (window is created pinned) ──────────────────────────
  const [pinned, setPinned] = useState(true)
  const togglePin = async (): Promise<void> => {
    const next = await el?.toggleAlwaysOnTopSelf?.()
    setPinned(!!next)
  }

  // ── Interpolated playback clock ───────────────────────────────────────────
  // currentTime only syncs over IPC ~4x/sec; synced lyrics need a smooth
  // clock, so interpolate between patches using the synced playback speed.
  const baseRef = useRef({ t: 0, at: performance.now() })
  useEffect(() => { baseRef.current = { t: currentTime, at: performance.now() } }, [currentTime])
  const playingRef = useRef(isPlaying)
  playingRef.current = isPlaying
  const speedRef = useRef(playbackSpeed)
  speedRef.current = playbackSpeed
  const getTime = useCallback((): number => {
    const { t, at } = baseRef.current
    if (!playingRef.current) return t
    return t + ((performance.now() - at) / 1000) * speedRef.current
  }, [])

  // ── FM elapsed time — ticks locally between WS updates (mirrors Player) ──
  const [fmElapsedMs, setFmElapsedMs] = useState(0)
  const fmBaseRef = useRef<{ elapsed: number; at: number }>({ elapsed: 0, at: 0 })
  const fmTickRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const fmElapsed = radioFmNowPlaying?.elapsed_ms
  useEffect(() => {
    if (!radioFmActive || !fmElapsed) {
      if (fmTickRef.current) { clearInterval(fmTickRef.current); fmTickRef.current = null }
      setFmElapsedMs(0)
      return
    }
    fmBaseRef.current = { elapsed: fmElapsed, at: Date.now() }
    setFmElapsedMs(fmElapsed)
    if (!fmTickRef.current) {
      fmTickRef.current = setInterval(() => {
        const { elapsed, at } = fmBaseRef.current
        setFmElapsedMs(elapsed + (Date.now() - at))
      }, 500)
    }
  }, [radioFmActive, fmElapsed])
  useEffect(() => () => { if (fmTickRef.current) clearInterval(fmTickRef.current) }, [])
  const fmDurationMs = radioFmNowPlaying?.duration_ms ?? 0
  const fmProgress = fmDurationMs > 0 ? Math.min(fmElapsedMs / fmDurationMs, 1) : 0
  const getFmTime = useCallback((): number => {
    const { elapsed, at } = fmBaseRef.current
    if (!at) return 0
    return (elapsed + (Date.now() - at)) / 1000
  }, [])

  // ── Seek: buffer while dragging, commit as a command on release. The bar
  // holds the drag position until the post-seek progress patch lands (with a
  // timeout fallback), so it doesn't flick back to the stale position. ──────
  const duration = currentTrack?.duration || 0
  const [seekDrag, setSeekDrag] = useState<number | null>(null)
  const seekCommittedRef = useRef(false)
  const commitSeek = (): void => {
    if (seekDrag === null) return
    if (duration > 0 && currentTrack && !fm) {
      sendPlayerCommand('seek', seekDrag * duration)
      seekCommittedRef.current = true
      window.setTimeout(() => {
        if (seekCommittedRef.current) { seekCommittedRef.current = false; setSeekDrag(null) }
      }, 800)
    } else {
      setSeekDrag(null)
    }
  }
  useEffect(() => {
    if (seekCommittedRef.current) { seekCommittedRef.current = false; setSeekDrag(null) }
  }, [currentTime])

  // ── Volume / mute (volume is a synced store key — the main window's
  // Player applies it to the audio element) ─────────────────────────────────
  const [prevMute, setPrevMute] = useState(0.8)
  const isMuted = volume === 0
  const toggleMute = (): void => {
    if (isMuted) setVolume(prevMute || 0.8)
    else { setPrevMute(volume); setVolume(0) }
  }

  // Spacebar play/pause, same guard as the main window's shortcut.
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (e.code !== 'Space' && e.key !== ' ') return
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement).isContentEditable) return
      e.preventDefault()
      sendPlayerCommand('play-pause')
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [])

  // ── Display values ────────────────────────────────────────────────────────
  const title = fm ? (radioFmNowPlaying?.title || '999 FM') : (currentTrack?.title || 'Nothing playing')
  const artist = fm ? (radioFmNowPlaying?.artist ?? '') : (currentTrack?.artist ?? '')
  const artSrc = fm
    ? (radioFmMatchedSong?.imageUrl ?? null)
    : (currentTrackFull?.albumArt ?? currentTrack?.imageUrl ?? null)
  const [artError, setArtError] = useState(false)
  useEffect(() => { setArtError(false) }, [artSrc])

  const canLike = !!currentTrack && !fm && /^jw-\d+$/.test(currentTrack.id)
  const liked = !!currentTrack && likedTrackIds.includes(currentTrack.id)
  const controlsDisabled = !currentTrack || fm
  const shownProgress = fm ? fmProgress : (seekDrag !== null ? seekDrag : progress)

  const lyricsOverride = fm
    ? { lyrics: radioFmMatchedSong?.lyrics ?? null, syncedLyrics: radioFmMatchedSong?.syncedLyrics ?? null }
    : null

  const chipCls = (active: boolean): string =>
    `flex items-center gap-1 px-2 py-1 rounded-full text-[9px] font-semibold uppercase tracking-wider border transition-colors ${
      active
        ? 'text-accent border-accent/40 bg-accent/10'
        : 'text-text-muted border-[var(--border)] hover:text-text-primary hover:bg-surface-overlay'
    }`

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* ── Compact bar — fills the whole window until a panel expands it.
          Height must match FLOAT_SIZES['mini-player'].height in main.js.
          The bar is the drag region; interactive elements opt out. ── */}
      <div
        className="relative shrink-0 select-none h-[192px]"
        style={{ WebkitAppRegion: 'drag' } as CSSProperties}
      >
        {/* Window buttons */}
        <div className="absolute top-1.5 right-1.5 z-10 flex items-center gap-0.5" style={noDrag}>
          <WinBtn onClick={togglePin} title={pinned ? 'Unpin from top' : 'Pin on top'} active={pinned}>
            <Pin size={12} className={pinned ? '' : 'opacity-60'} style={pinned ? undefined : { transform: 'rotate(45deg)' }} />
          </WinBtn>
          <WinBtn onClick={() => el?.hideOtherWindows?.()} title="Close all other windows">
            <EyeOff size={12} />
          </WinBtn>
          <WinBtn onClick={() => el?.focusMainWindow?.()} title="Show full app">
            <ExternalLink size={12} />
          </WinBtn>
          <WinBtn onClick={() => el?.minimizeSelf?.()} title="Minimize">
            <Minus size={12} />
          </WinBtn>
          <WinBtn onClick={() => el?.closeSelf?.()} title="Close" danger>
            <X size={12} />
          </WinBtn>
        </div>

        <div className="flex items-center gap-3.5 h-full px-4 py-3">
          {/* Art */}
          <div className="w-[104px] h-[104px] rounded-xl overflow-hidden bg-surface-overlay shrink-0 shadow-lg">
            {fm && !artSrc ? (
              <div className="w-full h-full bg-gradient-to-br from-red-900/70 to-black flex items-center justify-center">
                <Radio size={28} className="text-red-400 opacity-80" />
              </div>
            ) : artSrc && !artError ? (
              <ProgressiveCover src={artSrc} className="w-full h-full object-cover" onError={() => setArtError(true)} />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-text-muted">
                <Music size={28} className="opacity-40" />
              </div>
            )}
          </div>

          {/* Info + controls */}
          <div className="flex-1 min-w-0 flex flex-col justify-center gap-1">
            {/* Title / artist (padded clear of the window buttons) */}
            <div className="min-w-0 pr-36">
              <p className="text-text-primary text-sm font-semibold truncate" title={title}>{title}</p>
              <div className="flex items-center gap-1.5 min-w-0">
                <p className="text-text-muted text-xs truncate">{artist}</p>
                {fm && (
                  <span className="flex items-center gap-0.5 text-[8px] font-semibold uppercase tracking-widest shrink-0 text-red-400">
                    <Radio size={8} /> 999 FM
                  </span>
                )}
              </div>
            </div>

            {/* Transport */}
            <div className="flex items-center justify-center gap-3 py-0.5" style={noDrag}>
              {!fm && (
                <button
                  onClick={() => sendPlayerCommand('toggle-shuffle')}
                  className={`transition-colors ${shuffle ? 'text-accent' : 'text-text-secondary hover:text-text-primary'}`}
                  title="Shuffle"
                >
                  <Shuffle size={14} />
                </button>
              )}
              <button
                onClick={() => sendPlayerCommand('previous')}
                disabled={controlsDisabled}
                className="text-text-secondary hover:text-text-primary transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <SkipBack size={17} fill="currentColor" />
              </button>
              <button
                onClick={() => sendPlayerCommand('play-pause')}
                disabled={controlsDisabled}
                className="w-8 h-8 rounded-full bg-white flex items-center justify-center hover:scale-105 active:scale-95 transition-transform disabled:opacity-30"
              >
                <SwapIcon swapKey={isPlaying}>
                  {isPlaying
                    ? <Pause size={14} fill="#000" className="text-black" />
                    : <Play size={14} fill="#000" className="text-black ml-0.5" />}
                </SwapIcon>
              </button>
              <button
                onClick={() => sendPlayerCommand('next')}
                disabled={controlsDisabled}
                className="text-text-secondary hover:text-text-primary transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <SkipForward size={17} fill="currentColor" />
              </button>
              {!fm && (
                <button
                  onClick={() => sendPlayerCommand('toggle-repeat')}
                  className={`transition-colors ${repeat !== 'none' ? 'text-accent' : 'text-text-secondary hover:text-text-primary'}`}
                  title="Repeat"
                >
                  {repeat === 'one' ? <Repeat1 size={14} /> : <Repeat size={14} />}
                </button>
              )}
              {canLike && (
                <button
                  onClick={() => currentTrack && toggleLike(currentTrack.id)}
                  className={`transition-colors ${liked ? 'text-accent' : 'text-text-muted hover:text-accent'}`}
                  title="Like"
                >
                  <Heart size={13} fill={liked ? 'currentColor' : 'none'} />
                </button>
              )}
            </div>

            {/* Progress */}
            <div className="flex items-center gap-2" style={noDrag}>
              <span className="text-text-muted text-[10px] w-9 text-right tabular-nums">
                {fm
                  ? formatDuration(Math.floor(fmElapsedMs / 1000))
                  : formatDuration(seekDrag !== null ? seekDrag * duration : currentTime)}
              </span>
              <div className="flex-1 progress-track">
                <input
                  type="range" min={0} max={1} step={0.001}
                  value={shownProgress}
                  onMouseDown={fm ? undefined : () => setSeekDrag(progress)}
                  onTouchStart={fm ? undefined : () => setSeekDrag(progress)}
                  onChange={(e) => { if (!fm) setSeekDrag(parseFloat(e.target.value)) }}
                  onMouseUp={fm ? undefined : commitSeek}
                  onTouchEnd={fm ? undefined : commitSeek}
                  onKeyUp={fm ? undefined : commitSeek}
                  disabled={!currentTrack && !fm}
                  className="w-full"
                  style={{ '--val': `${shownProgress * 100}%`, ...(fm ? { pointerEvents: 'none' as const } : {}) } as CSSProperties}
                />
              </div>
              <span className="text-text-muted text-[10px] w-9 tabular-nums">
                {fm ? formatDuration(Math.floor(fmDurationMs / 1000)) : formatDuration(duration)}
              </span>
            </div>

            {/* Bottom row: panel toggles + volume */}
            <div className="flex items-center justify-between pt-0.5" style={noDrag}>
              <div className="flex items-center gap-1">
                <button onClick={() => togglePanel('lyrics')} className={chipCls(panel === 'lyrics')} title="Lyrics">
                  <Mic2 size={10} /> Lyrics
                </button>
                <button onClick={() => togglePanel('queue')} className={chipCls(panel === 'queue')} title="Queue">
                  <ListMusic size={10} /> Queue
                </button>
              </div>
              <div className="flex items-center gap-1.5">
                <button onClick={toggleMute} className="text-text-secondary hover:text-text-primary transition-colors" title="Mute">
                  {isMuted ? <VolumeX size={14} /> : <Volume2 size={14} />}
                </button>
                <div className="w-16 progress-track">
                  <input
                    type="range" min={0} max={1} step={0.01} value={volume}
                    onChange={(e) => setVolume(parseFloat(e.target.value))}
                    className="w-full block"
                    style={{ '--val': `${volume * 100}%` } as CSSProperties}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Expanded panel ── */}
      {panel === 'lyrics' && (
        <div className="flex-1 min-h-0 border-t border-[var(--border)]" style={noDrag}>
          <LyricsDisplay
            compact
            getTime={fm ? getFmTime : getTime}
            onSeek={fm ? () => {} : (t) => sendPlayerCommand('seek', t)}
            override={lyricsOverride}
          />
        </div>
      )}
      {panel === 'queue' && (
        <div className="flex-1 min-h-0 border-t border-[var(--border)]" style={noDrag}>
          <MiniQueue />
        </div>
      )}
    </div>
  )
}
