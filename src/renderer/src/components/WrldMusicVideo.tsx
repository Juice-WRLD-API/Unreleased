import { useEffect, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useStore } from '../store/useStore'
import { useVizStore } from '../store/vizStore'
import { buildStreamUrl } from '../lib/juicewrldApi'
import { isAbortError } from '../lib/apiClient'
import {
  chooseMusicVideo, musicVideoTargetFor, videoTargetKey, VIDEO_KIND_LABEL, type MusicVideoMatch, type MusicVideoTarget,
} from '../lib/musicVideos'
import { onMusicVideoDefaultsChange } from '../lib/musicVideoDefaultsApi'
import { followVideo } from '../lib/videoFollow'
import { playingSeconds } from '../desktop/playClock'

// The playing song's official video, in WRLD in place of the visualizer. It plays muted and follows the song: the
// sync (lib/videoSync) says where in the video each part of the song is, so an intro or a skit cut into the video is
// stepped over, and a part of the song the video leaves out shows the visualizer again for that stretch. The cleared
// desk's curtain shows the same video (desktop/deskViz.ts).

/** The visualizer stops once the video has faded in over it, and starts again as it begins to fade out. */
const FADE_MS = 600

function useVideoTarget(): MusicVideoTarget | null | undefined {
  const playing = useStore(useShallow((s) => ({
    track: s.currentTrack,
    fmActive: s.radioFmActive,
    fmSong: s.radioFmMatchedSong,
  })))
  // undefined while it's being worked out.
  const [target, setTarget] = useState<MusicVideoTarget | null | undefined>(undefined)
  const key = videoTargetKey(playing)
  useEffect(() => {
    const ac = new AbortController()
    setTarget(undefined)
    musicVideoTargetFor(playing, ac.signal)
      .then((t) => { if (!ac.signal.aborted) setTarget(t) }, () => { if (!ac.signal.aborted) setTarget(null) })
    return () => ac.abort()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return target
}

export default function WrldMusicVideo({ onShow }: { onShow?: (label: string) => void }): JSX.Element | null {
  const choice = useVizStore((s) => s.wrldVideos)
  const setShownFlag = useVizStore((s) => s.setWrldVideoShown)
  const target = useVideoTarget()
  const onShowRef = useRef(onShow)
  onShowRef.current = onShow
  const [match, setMatch] = useState<MusicVideoMatch | null>(null)
  // A video picked for this song from a picker (the player card's video button, the toolbar's, `musicvideo pick`).
  const pick = useVizStore((s) => (target ? s.wrldVideoPicks[target.path] ?? null : null))
  const setVideoNow = useVizStore((s) => s.setWrldVideoNow)
  // An administrator's default for the song (every player's), read again when one changes.
  const [defaultsTurn, setDefaultsTurn] = useState(0)
  useEffect(() => onMusicVideoDefaultsChange(() => setDefaultsTurn((n) => n + 1)), [])

  useEffect(() => {
    setMatch(null)
    // A new pick for the same song keeps the list up, so the pickers don't blink.
    if (useVizStore.getState().wrldVideoNow?.songPath !== target?.path) setVideoNow(null)
    if (!target) return
    const ac = new AbortController()
    chooseMusicVideo(target, {
      choice, pick, signal: ac.signal,
      onList: setVideoNow,
      pickedFails: () => onShowRef.current?.('That video doesn’t line up with the song'),
    }).then(({ list, match: m }) => {
      if (ac.signal.aborted) return
      setMatch(m)
      setVideoNow(list)
    }).catch((err) => { if (!isAbortError(err)) console.warn('[WrldMusicVideo]', err) })
    return () => ac.abort()
  }, [target, choice, pick, defaultsTurn, setVideoNow])
  useEffect(() => () => setVideoNow(null), [setVideoNow])

  const videoRef = useRef<HTMLVideoElement>(null)
  const [visible, setVisible] = useState(false)

  // Following the song.
  useEffect(() => {
    const v = videoRef.current
    setVisible(false)
    if (!match || !v) return
    let announced = false
    return followVideo(v, match.sync, () => {
      const st = useStore.getState()
      return { song: playingSeconds(), playing: st.radioFmActive || st.isPlaying, rate: st.radioFmActive ? 1 : (st.playbackSpeed || 1) }
    }, (next) => {
      setVisible(next)
      if (next && !announced) { announced = true; onShowRef.current?.(VIDEO_KIND_LABEL[match.video.kind]) }
    })
  }, [match])

  // The visualizer gives way once the fade is done, and comes back before the video starts to go.
  useEffect(() => {
    if (!visible) { setShownFlag(false); return }
    const timer = window.setTimeout(() => setShownFlag(true), FADE_MS)
    return () => window.clearTimeout(timer)
  }, [visible, setShownFlag])
  useEffect(() => () => setShownFlag(false), [setShownFlag])

  if (!match) return null
  return (
    <div
      className="absolute inset-0 pointer-events-none overflow-hidden transition-opacity ease-[cubic-bezier(0.4,0,0.2,1)]"
      style={{ opacity: visible ? 1 : 0, transitionDuration: `${FADE_MS}ms` }}
      aria-hidden
    >
      <video
        // A new element per video: reusing one across songs shows the last song's frame while the next one loads.
        key={match.video.path}
        ref={videoRef}
        src={buildStreamUrl(match.video.path)}
        className="absolute inset-0 w-full h-full object-cover"
        muted
        playsInline
        preload="auto"
        disablePictureInPicture
        disableRemotePlayback
      />
      {/* Keeps WRLD's text readable over a bright frame. */}
      <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-black/10 to-black/40" />
    </div>
  )
}
