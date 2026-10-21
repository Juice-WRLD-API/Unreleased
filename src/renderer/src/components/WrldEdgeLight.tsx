import { useEffect, useRef } from 'react'
import { useStore } from '../store/useStore'
import { EdgeLight } from '../desktop/light/renderer'
import { listenToMeter, latestMeter } from '../desktop/meter'
import { useAlbumColors } from '../desktop/artColors'
import { tickerLine } from '../desktop/ticker'
import { nowCover } from '../lib/desktopBridge'
import type { LightStyle } from '../desktop/light/engine'

// WRLD's Edge light: iJWA's light round the tab's edges, over its visualizer or on its own - the screen light's own
// look, tuning and colors (Settings > Desktop > Light and Colors), sized like it, moving with what the app plays.

/** How big the rim may be on this screen: the screen light's fit (electron/desktop/fit.js) - designed for a
 *  1440 × 900 work area, shrinking with a smaller or scaled one, never growing - so it's the same rim in both. */
function screenFit(): number {
  return Math.min(1, Math.max(0.55, Math.min(window.screen.availWidth / 1440, window.screen.availHeight / 900)))
}

export default function WrldEdgeLight({ look, held, onUnsupported }: {
  look: string
  /** Covered by a picker: the light holds still. */
  held: boolean
  /** WebGL2 isn't there: the tab leaves the light out. */
  onUnsupported: () => void
}): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const lightRef = useRef<EdgeLight | null>(null)
  const light = useStore((s) => s.desktop.light)
  const styleRef = useRef<LightStyle>({ ...light, look })
  styleRef.current = { ...light, look }
  // The same cover, read the same way, as the screen light's colors.
  const cover = useStore(nowCover)
  const colors = useAlbumColors(light.useArtworkColors ? cover : null)
  const unsupported = useRef(onUnsupported)
  unsupported.current = onUnsupported

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let edge: EdgeLight
    try {
      edge = new EdgeLight(canvas, {
        style: () => styleRef.current,
        meter: latestMeter,
        playing: () => useStore.getState().isPlaying,
        ticker: tickerLine,
        fit: screenFit,
      })
    } catch (e) {
      console.warn('[wrld] edge light unavailable', e)
      unsupported.current()
      return
    }
    lightRef.current = edge
    edge.fadeTo(1)
    const offMeter = listenToMeter(() => { if (styleRef.current.motion === 'music') edge.wake() })
    const offPlaying = useStore.subscribe((s, p) => { if (s.isPlaying !== p.isPlaying) edge.wake() })
    const ro = new ResizeObserver(() => edge.wake())
    ro.observe(canvas)
    // The ticker's words move on with the song even while nothing else does.
    const tick = window.setInterval(() => { if (styleRef.current.look === 'ticker') edge.wake() }, 250)
    return () => {
      offMeter()
      offPlaying()
      ro.disconnect()
      window.clearInterval(tick)
      edge.dispose()
      lightRef.current = null
    }
  }, [])

  useEffect(() => { lightRef.current?.wake() }, [light, look])
  useEffect(() => { lightRef.current?.setHeld(held) }, [held])
  useEffect(() => {
    const edge = lightRef.current
    if (!edge) return
    edge.engine.setAlbum(colors)
    edge.wake()
  }, [colors])

  return <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none" />
}
