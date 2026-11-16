import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useStore } from '../store/useStore'
import { useVizStore } from '../store/vizStore'
import { buildStreamUrl } from '../lib/juicewrldApi'
import { isAbortError } from '../lib/apiClient'
import {
  chooseMusicVideo, musicVideoTargetFor, videoTargetKey, VIDEO_KIND_LABEL, type MusicVideoList, type MusicVideoMatch, type MusicVideoTarget,
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

// Kept across mounts. Going fullscreen moves WRLD into a portal, which mounts this again, and leaving WRLD and coming
// back does too: starting over each time meant a new <video> loading and seeking from nothing, a couple of seconds
// with no video. So the last song's target and match, and the video element itself with what it has buffered, wait
// here to be picked up again.
let keptTarget: { key: string; target: MusicVideoTarget | null } | null = null
let keptMatch: { sig: string; match: MusicVideoMatch | null; list: MusicVideoList } | null = null
let keptVideo: { path: string; el: HTMLVideoElement; shown: boolean; announced: boolean } | null = null
/** A video nobody picks up again is let go after this. */
const RELEASE_MS = 2 * 60 * 1000
let releaseTimer = 0
let defaultsVersion = 0
onMusicVideoDefaultsChange(() => { defaultsVersion++ })

const matchSig = (target: MusicVideoTarget, choice: string, pick: string | null, defaults: number): string =>
  `${target.path}\n${choice}\n${pick ?? ''}\n${defaults}`

function releaseVideo(): void {
  window.clearTimeout(releaseTimer)
  if (!keptVideo) return
  const { el } = keptVideo
  keptVideo = null
  el.pause()
  el.removeAttribute('src')
  el.load()
  el.remove()
}

/** The element for a video: the kept one when it's the same video, else a new one (reusing one across songs shows the
 *  last song's frame while the next one loads). */
function videoElementFor(path: string): NonNullable<typeof keptVideo> {
  window.clearTimeout(releaseTimer)
  if (keptVideo?.path === path) return keptVideo
  releaseVideo()
  const el = document.createElement('video')
  el.className = 'absolute inset-0 w-full h-full object-cover'
  el.muted = true
  el.defaultMuted = true
  el.playsInline = true
  el.preload = 'auto'
  el.disablePictureInPicture = true
  el.setAttribute('disableremoteplayback', '')
  el.src = buildStreamUrl(path)
  keptVideo = { path, el, shown: false, announced: false }
  return keptVideo
}

function useVideoTarget(): MusicVideoTarget | null | undefined {
  const playing = useStore(useShallow((s) => ({
    track: s.currentTrack,
    fmActive: s.radioFmActive,
    fmSong: s.radioFmMatchedSong,
  })))
  const key = videoTargetKey(playing)
  // undefined while it's being worked out.
  const [target, setTarget] = useState<MusicVideoTarget | null | undefined>(() => (keptTarget?.key === key ? keptTarget.target : undefined))
  useEffect(() => {
    if (keptTarget?.key === key) { setTarget(keptTarget.target); return }
    const ac = new AbortController()
    setTarget(undefined)
    musicVideoTargetFor(playing, ac.signal).then((t) => {
      if (ac.signal.aborted) return
      keptTarget = { key, target: t }
      setTarget(t)
    }, () => { if (!ac.signal.aborted) setTarget(null) })
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
  // A video picked for this song from a picker (the player card's video button, the toolbar's, `musicvideo pick`).
  const pick = useVizStore((s) => (target ? s.wrldVideoPicks[target.path] ?? null : null))
  const setVideoNow = useVizStore((s) => s.setWrldVideoNow)
  // An administrator's default for the song (every player's), read again when one changes.
  const [defaultsTurn, setDefaultsTurn] = useState(defaultsVersion)
  useEffect(() => onMusicVideoDefaultsChange(() => setDefaultsTurn(defaultsVersion)), [])
  const [match, setMatch] = useState<MusicVideoMatch | null>(() =>
    (target && keptMatch?.sig === matchSig(target, choice, pick, defaultsTurn) ? keptMatch.match : null))

  useEffect(() => {
    const sig = target ? matchSig(target, choice, pick, defaultsTurn) : null
    if (sig && keptMatch?.sig === sig) {
      setMatch(keptMatch.match)
      setVideoNow(keptMatch.list)
      return
    }
    setMatch(null)
    // A new pick for the same song keeps the list up, so the pickers don't blink.
    if (useVizStore.getState().wrldVideoNow?.songPath !== target?.path) setVideoNow(null)
    if (!target || !sig) return
    const ac = new AbortController()
    chooseMusicVideo(target, {
      choice, pick, signal: ac.signal,
      onList: setVideoNow,
      pickedFails: () => onShowRef.current?.('That video doesn’t line up with the song'),
    }).then(({ list, match: m }) => {
      if (ac.signal.aborted) return
      keptMatch = { sig, match: m, list }
      setMatch(m)
      setVideoNow(list)
    }).catch((err) => { if (!isAbortError(err)) console.warn('[WrldMusicVideo]', err) })
    return () => ac.abort()
  }, [target, choice, pick, defaultsTurn, setVideoNow])
  useEffect(() => () => setVideoNow(null), [setVideoNow])

  const hostRef = useRef<HTMLDivElement>(null)
  // Picked up again with its frame already up: shown at once, with no fade.
  const resumed = useRef(!!match && keptVideo?.path === match.video.path && keptVideo.shown)
  const [visible, setVisible] = useState(resumed.current)

  // Following the song. A layout effect, so a kept video is back in place before the first paint.
  useLayoutEffect(() => {
    const host = hostRef.current
    if (!match || !host) {
      setVisible(false)
      // Held a while in case the same video comes back (a pick changed back, WRLD opened again).
      window.clearTimeout(releaseTimer)
      releaseTimer = window.setTimeout(releaseVideo, RELEASE_MS)
      return
    }
    const kept = videoElementFor(match.video.path)
    host.appendChild(kept.el)
    setVisible(kept.shown)
    const stop = followVideo(kept.el, match.sync, () => {
      const st = useStore.getState()
      return { song: playingSeconds(), playing: st.radioFmActive || st.isPlaying, rate: st.radioFmActive ? 1 : (st.playbackSpeed || 1) }
    }, (next) => {
      kept.shown = next
      setVisible(next)
      if (next && !kept.announced) { kept.announced = true; onShowRef.current?.(VIDEO_KIND_LABEL[match.video.kind]) }
    }, kept.shown)
    return () => {
      stop()
      if (keptVideo === kept) {
        window.clearTimeout(releaseTimer)
        releaseTimer = window.setTimeout(releaseVideo, RELEASE_MS)
      }
    }
  }, [match])

  // The visualizer gives way once the fade is done, and comes back before the video starts to go.
  useEffect(() => {
    if (!visible) { setShownFlag(false); return }
    if (resumed.current) { resumed.current = false; setShownFlag(true); return }
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
      {/* The <video> is put in here by hand (videoElementFor), so it outlives this component. */}
      <div ref={hostRef} className="absolute inset-0" />
      {/* Keeps WRLD's text readable over a bright frame. */}
      <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-black/10 to-black/40" />
    </div>
  )
}
