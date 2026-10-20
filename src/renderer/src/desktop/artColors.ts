// The playing cover's two colors, as the light and the lyric styles take them: the most vivid hue covering most of
// the picture, then the strongest clearly different one. The API site's era images can't be read in the browser (no
// CORS), so their colors come from the palettes baked for the visualizers.
import { useEffect, useState } from 'react'
import { ERA_PALETTES } from '../lib/eraPalettes'
import { JWAPI_HOST, smallCoverUrl } from '../lib/juicewrldApi'
import { paletteFromPixels, rgbToHsb, type AlbumColors, type HSB } from './light/engine'

const SIDE = 32
const cache = new Map<string, Promise<AlbumColors | null>>()

export function eraAssetPath(url: string): string | null {
  try {
    const { hostname, pathname } = new URL(url)
    const apiHost = hostname === JWAPI_HOST || hostname.endsWith(`.${JWAPI_HOST}`)
    return apiHost && pathname.startsWith('/assets/') ? pathname : null
  } catch {
    return null
  }
}

/** A baked era palette as the light's two colors; null for a grey one. */
function fromBaked(path: string): AlbumColors | null {
  const baked = ERA_PALETTES[path]
  if (!baked?.length) return null
  const vivid = (c: { r: number; g: number; b: number }): HSB | null => {
    const hsb = rgbToHsb([c.r / 255, c.g / 255, c.b / 255])
    return hsb.saturation > 0.2 ? { hue: hsb.hue, saturation: Math.min(Math.max(hsb.saturation, 0.55), 1), brightness: Math.max(hsb.brightness, 0.92) } : null
  }
  const colors = baked.map(vivid).filter((c): c is HSB => c !== null)
  if (!colors.length) return null
  return { primary: colors[0], secondary: colors[1] ?? colors[0] }
}

function sample(url: string): Promise<AlbumColors | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = SIDE
      canvas.height = SIDE
      const g = canvas.getContext('2d', { willReadFrequently: true })
      if (!g) return resolve(null)
      g.drawImage(img, 0, 0, SIDE, SIDE)
      try {
        resolve(paletteFromPixels(g.getImageData(0, 0, SIDE, SIDE).data, SIDE))
      } catch {
        resolve(null) // tainted canvas
      }
    }
    img.onerror = () => resolve(null)
    img.src = url
  })
}

export function albumColorsFor(url: string | null | undefined): Promise<AlbumColors | null> {
  if (!url) return Promise.resolve(null)
  let found = cache.get(url)
  if (!found) {
    const era = eraAssetPath(url)
    // Sampled at 32px, so the degraded cover is all it needs.
    found = era ? Promise.resolve(fromBaked(era)) : sample(smallCoverUrl(url) ?? url)
    cache.set(url, found)
    if (cache.size > 200) cache.delete(cache.keys().next().value as string)
  }
  return found
}

/** The cover's colors, once read; null for grey artwork. The last cover's stay while a new one is read, so what
 *  follows them changes once, not twice. */
export function useAlbumColors(url: string | null | undefined): AlbumColors | null {
  const [colors, setColors] = useState<AlbumColors | null>(null)
  useEffect(() => {
    let live = true
    void albumColorsFor(url).then((value) => { if (live) setColors(value) })
    return () => { live = false }
  }, [url])
  return colors
}
