import { useEffect, useRef, useState } from 'react'
import { useStorePick } from '../store/useStore'
import { smallCoverUrl, fullCoverUrl } from '../lib/juicewrldApi'
import { FallbackImg } from './ProgressiveCover'

const FADE_MS = 900

type Layer = { id: number; src: string; shown: boolean }

// What the glass chrome frosts: the playing song's cover, blurred far past
// recognition and washed with the skin's surface color so text keeps its
// contrast, or an accent glow while nothing with art is playing. It sits
// behind the whole window (position: fixed, z-index -1; index.css keeps the
// boxes between it and the page background clear), so the views, the sidebar
// and the side panels all show it through their translucent fills.
//
// A new cover fades in over the old one once it has loaded, and the old ones
// are dropped when that fade ends. Blurred this far, the small cover is all
// it needs.
export default function AmbientBackdrop(): JSX.Element {
  const { currentTrack, currentTrackFull, radioFmActive, radioFmMatchedSong } =
    useStorePick('currentTrack', 'currentTrackFull', 'radioFmActive', 'radioFmMatchedSong')
  const art = (radioFmActive
    ? radioFmMatchedSong?.imageUrl
    : (currentTrackFull?.albumArt ?? currentTrack?.imageUrl)) || null

  const [layers, setLayers] = useState<Layer[]>([])
  const nextId = useRef(0)
  const artRef = useRef(art)
  artRef.current = art

  useEffect(() => {
    if (!art) {
      // Fade every cover out to the glow, then let them go.
      setLayers((ls) => ls.map((l) => ({ ...l, shown: false })))
      const t = setTimeout(() => setLayers([]), FADE_MS)
      return () => clearTimeout(t)
    }
    setLayers((ls) => {
      const top = ls[ls.length - 1]
      // Same cover again (it came back before its fade-out finished): it's
      // already loaded, so show it straight away.
      if (top?.src === art) return top.shown ? ls : ls.map((l) => (l === top ? { ...l, shown: true } : l))
      return [...ls, { id: nextId.current++, src: art, shown: false }]
    })
    return undefined
  }, [art])

  // A layer that has loaded fades in; once it covers everything under it,
  // those go.
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>())
  useEffect(() => () => timers.current.forEach(clearTimeout), [])
  const show = (id: number, src: string): void => {
    // Loaded after the song moved on (or stopped): nothing to show.
    if (artRef.current !== src) return
    setLayers((ls) => ls.map((l) => (l.id === id ? { ...l, shown: true } : l)))
    const t = setTimeout(() => {
      timers.current.delete(t)
      setLayers((ls) => {
        const i = ls.findIndex((l) => l.id === id)
        return i > 0 && ls[i].shown ? ls.slice(i) : ls
      })
    }, FADE_MS)
    timers.current.add(t)
  }
  const drop = (id: number): void => setLayers((ls) => ls.filter((l) => l.id !== id))

  return (
    <div className="app-ambient" aria-hidden>
      <div className="app-ambient-glow" />
      {layers.map((l) => (
        <FallbackImg
          key={l.id}
          sources={[smallCoverUrl(l.src), fullCoverUrl(l.src), l.src]}
          className={`app-ambient-art${l.shown ? ' is-shown' : ''}`}
          onLoad={() => show(l.id, l.src)}
          onError={() => drop(l.id)}
        />
      ))}
      <div className="app-ambient-tint" />
    </div>
  )
}
