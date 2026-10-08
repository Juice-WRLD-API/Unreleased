import React, { useEffect, useRef, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Download } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { parseLrc, getCurrentLineIndex, isLrcFormat, downloadSyncedLyrics, splitAdLibs, splitColorWords, ADLIB_OPACITY } from '../lib/lyrics'
import { useStore } from '../store/useStore'
import { seekAudio, getAudioCurrentTime } from './Player'

interface LyricsDisplayProps {
  /** Playback-clock source for synced-line highlighting. Defaults to the live
   *  audio element - pop-out windows (no local audio) pass an interpolated
   *  clock built from the synced currentTime instead. */
  getTime?: () => number
  /** Called when a synced line is clicked. Defaults to seeking the local
   *  audio element - pop-outs send a seek command to the main window. */
  onSeek?: (time: number) => void
  /** Tighter type sizes/padding for small surfaces like the mini player. */
  compact?: boolean
  /** Show these lyrics instead of the current track's (e.g. 999 FM's matched
   *  song, which never populates currentTrackFull). */
  override?: { lyrics: string | null; syncedLyrics: string | null } | null
}

export default function LyricsDisplay({ getTime, onSeek, compact, override }: LyricsDisplayProps = {}): JSX.Element {
  const { currentTrackFull, account, lyricsOffset, lyricsScale, lyricsAlign, lyricsBlur, lyricsBlurAmount, lyricsColorActive, lyricsColorInactive } = useStore(useShallow(s => ({
    currentTrackFull: s.currentTrackFull,
    account: s.account,
    lyricsOffset: s.lyricsOffset,
    lyricsScale: s.lyricsScale,
    lyricsAlign: s.lyricsAlign,
    lyricsBlur: s.lyricsBlur,
    lyricsBlurAmount: s.lyricsBlurAmount,
    lyricsColorActive: s.lyricsColorActive,
    lyricsColorInactive: s.lyricsColorInactive,
  })))

  // null = auto, i.e. the theme's own text colors.
  const activeColor = lyricsColorActive ?? 'var(--text-primary)'
  const inactiveColor = lyricsColorInactive ?? 'var(--text-muted)'

  const containerRef = useRef<HTMLDivElement>(null)
  const activeRef = useRef<HTMLDivElement>(null)

  const lyrics = override ? override.lyrics : currentTrackFull?.lyrics
  const syncedLyrics = override ? override.syncedLyrics : currentTrackFull?.syncedLyrics

  const rawLyrics = syncedLyrics || lyrics
  const isSynced = rawLyrics ? isLrcFormat(rawLyrics) : false

  const syncedLines = useMemo(() => {
    if (rawLyrics && isSynced) return parseLrc(rawLyrics)
    return []
  }, [rawLyrics, isSynced])

  // Driven by requestAnimationFrame against the LIVE audio.currentTime rather
  // than the Zustand-stored value (which only updates on the native
  // 'timeupdate' event, ~4x/sec) - that throttling is what made the active
  // line snap every ~250ms instead of transitioning smoothly.
  const [currentLineIdx, setCurrentLineIdx] = useState(-1)
  const lineIdxRef = useRef(-1)

  useEffect(() => {
    if (!isSynced || syncedLines.length === 0) {
      setCurrentLineIdx(-1)
      lineIdxRef.current = -1
      return
    }
    let raf = 0
    const timeSource = getTime ?? getAudioCurrentTime
    const tick = (): void => {
      const idx = getCurrentLineIndex(syncedLines, timeSource() - lyricsOffset)
      if (idx !== lineIdxRef.current) {
        lineIdxRef.current = idx
        setCurrentLineIdx(idx)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [isSynced, syncedLines, lyricsOffset, getTime])

  useEffect(() => {
    if (activeRef.current && containerRef.current) {
      activeRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [currentLineIdx])

  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null)
  useEffect(() => {
    if (!menuPos) return
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') setMenuPos(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [menuPos])

  const isEditor = account?.is_editor || account?.is_administrator

  // Right-click → "Download synced lyrics" - only offered for LRC-format
  // lyrics (the .lrc file needs the timestamps; plain unsynced text has
  // nothing worth exporting in that format).
  const handleContextMenu = (e: React.MouseEvent): void => {
    if (!isSynced || !rawLyrics) return
    e.preventDefault()
    setMenuPos({ x: e.clientX, y: e.clientY })
  }
  const downloadMenu = menuPos && rawLyrics && createPortal(
    <>
      <div className="fixed inset-0 z-40" onClick={() => setMenuPos(null)} onContextMenu={(e) => { e.preventDefault(); setMenuPos(null) }} />
      <div
        className="fixed z-50 bg-surface border border-[var(--border)] rounded-xl shadow-2xl py-1 min-w-[200px]"
        style={{ top: menuPos.y, left: menuPos.x }}
      >
        <button
          onClick={() => {
            downloadSyncedLyrics(currentTrackFull?.title ?? 'lyrics', currentTrackFull?.artist ?? '', rawLyrics)
            setMenuPos(null)
          }}
          className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-left text-text-primary hover:bg-surface-overlay transition-colors"
        >
          <Download size={14} className="text-text-muted" /> Download synced lyrics
        </button>
      </div>
    </>,
    document.body
  )

  if (!rawLyrics) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-8">
        <div className="text-5xl opacity-20">♪</div>
        <p className="text-text-muted text-sm">No lyrics available</p>
        {isEditor && (
          <p className="text-text-muted text-xs">
            Right-click a track → "Edit info & lyrics" to add lyrics
          </p>
        )}
      </div>
    )
  }

  if (isSynced && syncedLines.length > 0) {
    return (
      <div
        ref={containerRef}
        onContextMenu={handleContextMenu}
        className={`h-full overflow-y-auto ${compact ? 'py-10 px-5 space-y-3' : 'py-16 px-8 space-y-4'}`}
        style={{ scrollbarWidth: 'none', WebkitTapHighlightColor: 'transparent' } as React.CSSProperties}
      >
        <style>{`::-webkit-scrollbar { display: none; }`}</style>
        {syncedLines.map((line, i) => {
          const isActive = i === currentLineIdx
          const isPast = i < currentLineIdx

          if (!line.text) {
            return <div key={i} className="h-4" />
          }

          // Every line except the one playing - played and upcoming alike.
          const isBlurred = !isActive && lyricsBlur
          const lineStyle: React.CSSProperties = {
            opacity: isActive ? 1 : isPast ? 0.35 : 0.2,
            color: isActive ? activeColor : inactiveColor,
            filter: isBlurred ? `blur(${lyricsBlurAmount.toFixed(2)}px)` : 'none',
            transition: 'opacity 0.35s ease, color 0.35s ease, filter 0.35s ease',
            fontSize: `${(compact ? 1.125 : 1.5) * lyricsScale}rem`,
            textAlign: lyricsAlign,
            fontFamily: 'var(--font-lyrics)',
            // iOS Safari's tap-highlight overlay on this clickable line can get
            // stuck showing (a known WebKit quirk when a touch is interrupted by
            // the container's own scrolling) and, since the highlight repaints
            // independently of React, it only clears once something else forces
            // this element to repaint - which is exactly what happens when a
            // line's own opacity/color/filter changes as it goes active → past.
            // Lines that never go active never repaint, so a stuck highlight on
            // one of them lingers indefinitely. Disabling the highlight outright
            // is the standard fix.
            WebkitTapHighlightColor: 'transparent',
          }

          return (
            <div
              key={i}
              ref={isActive ? activeRef : undefined}
              onClick={() => (onSeek ?? seekAudio)(line.time)}
              className="lyric-line leading-snug cursor-pointer font-bold"
              style={lineStyle}
            >
              {splitAdLibs(line.text).map((seg, si) => (
                <span key={si} style={seg.adLib ? { opacity: ADLIB_OPACITY } : undefined}>
                  {splitColorWords(seg.text).map((cseg, ci) => (
                    cseg.color
                      ? <span key={ci} style={{ color: cseg.color }}>{cseg.text}</span>
                      : cseg.text
                  ))}
                </span>
              ))}
            </div>
          )
        })}
        <div className="h-32" />
        {downloadMenu}
      </div>
    )
  }

  return (
    <div className={`h-full overflow-y-auto ${compact ? 'py-6 px-5' : 'py-8 px-8'}`}>
      <pre
        className="whitespace-pre-wrap"
        style={{
          // Unsynced lyrics have no "sung yet" state, so they follow the
          // upcoming/played color (auto keeps the old secondary text tone).
          color: lyricsColorInactive ?? 'var(--text-secondary)',
          fontFamily: 'var(--font-lyrics)',
          fontSize: `${(compact ? 0.75 : 0.875) * lyricsScale}rem`,
          // Unitless so line spacing tracks the chosen size (the old fixed
          // leading-6/8 cramped lines once the font grew past default).
          lineHeight: compact ? 2 : 2.3,
          textAlign: lyricsAlign,
        }}
      >
        {splitAdLibs(rawLyrics).map((seg, si) => (
          <span key={si} style={seg.adLib ? { opacity: ADLIB_OPACITY } : undefined}>{seg.text}</span>
        ))}
      </pre>
    </div>
  )
}
