import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store/useStore'
import { useShallow } from 'zustand/react/shallow'
import { LyricStage, type LyricTune, type StageSong } from '../desktop/lyrics/stage'
import { lyricFontFor } from '../desktop/lyrics/looks'
import { timedFromLines, pacedFromText } from '../desktop/lyrics/timing'
import { useAlbumColors } from '../desktop/artColors'
import { usePlayClock } from '../desktop/playClock'
import { seekAudio } from './Player'
import type { SyncedLyricLine } from '../types'

// WRLD's lyrics in one of the iJWA styles (Settings > Desktop > Lyric style): the app's own lyrics, offset and play
// clock, sung by the style picked. Line-timed lyrics get their words paced over each line; untimed ones over the song.

/** The styles were laid out for a box about this big; a bigger one sets everything larger. */
const DESIGN_WIDTH = 440
const DESIGN_HEIGHT = 380

interface Props {
  look: string
  trackId: string
  title: string
  artist: string
  duration: number
  rawLyrics: string
  isSynced: boolean
  syncedLines: SyncedLyricLine[]
  artUrl: string | null | undefined
}

export default function LyricStageView({ look, trackId, title, artist, duration, rawLyrics, isSynced, syncedLines, artUrl }: Props): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<LyricStage | null>(null)
  const lyricsOffset = useStore((s) => s.lyricsOffset)
  const fonts = useStore((s) => s.desktop.lyrics.fonts)
  // The app's lyric size and colors, for the styles that follow them.
  const tune = useStore(useShallow((s): LyricTune => ({ size: s.lyricsScale, active: s.lyricsColorActive, inactive: s.lyricsColorInactive })))
  // A line clicked plays the song from it - not on 999 FM, which can't be moved.
  const radioFmActive = useStore((s) => s.radioFmActive)
  const seek = useMemo(() => (radioFmActive ? undefined : (seconds: number) => seekAudio(Math.max(seconds, 0))), [radioFmActive])
  const colors = useAlbumColors(artUrl)
  const clock = usePlayClock()
  const [scale, setScale] = useState(1)
  const [seen, setSeen] = useState(() => document.visibilityState === 'visible')

  const lyrics = useMemo(
    () => (isSynced && syncedLines.length ? timedFromLines(syncedLines, lyricsOffset) : pacedFromText(rawLyrics, duration)),
    [isSynced, syncedLines, lyricsOffset, rawLyrics, duration],
  )
  const song = useMemo<StageSong>(() => ({ id: trackId, title, artist, lyrics }), [trackId, title, artist, lyrics])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const stage = new LyricStage(host)
    stageRef.current = stage
    const measure = (): void => {
      const s = Math.min(host.clientWidth / DESIGN_WIDTH, host.clientHeight / DESIGN_HEIGHT)
      setScale(Math.round(Math.min(Math.max(s, 0.7), 2.4) * 20) / 20)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(host)
    const onVisibility = (): void => setSeen(document.visibilityState === 'visible')
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      ro.disconnect()
      document.removeEventListener('visibilitychange', onVisibility)
      stage.destroy()
      stageRef.current = null
    }
  }, [])

  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    stage.use(look)
    if (!song.lyrics.lines.length || !clock) { stage.stop(); return }
    stage.show(song, { clock, isSeen: seen, colors, face: lyricFontFor(fonts, stage.look), scale, tune, seek })
  }, [look, song, clock, seen, colors, fonts, scale, tune, seek])

  return (
    <div className="relative flex-1 min-h-0" onWheel={(e) => stageRef.current?.scrollBy(e.deltaY)}>
      <div ref={hostRef} />
    </div>
  )
}
