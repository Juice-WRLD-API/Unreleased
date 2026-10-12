import { useEffect } from 'react'
import { useStore, useStorePick } from '../store/useStore'
import { buildImageUrl, smallCoverUrl } from './juicewrldApi'
import { getFont } from './fonts'
import { getSkin, SKIN_OPTIONAL_VAR_KEYS, type Skin } from './skins'

function hexToRgb(hex: string): [number, number, number] {
  const num = parseInt(hex.replace('#', ''), 16)
  return [(num >> 16) & 0xff, (num >> 8) & 0xff, num & 0xff]
}

function lightenHex(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex)
  return `#${Math.min(255, r + amount).toString(16).padStart(2, '0')}${Math.min(255, g + amount).toString(16).padStart(2, '0')}${Math.min(255, b + amount).toString(16).padStart(2, '0')}`
}

// h in degrees, s/l in 0..1
function hslToHex(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l)
  const f = (n: number): string => {
    const k = (n + h / 30) % 12
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))
    return Math.round(c * 255).toString(16).padStart(2, '0')
  }
  return `#${f(0)}${f(8)}${f(4)}`
}

// Keeps the phone status bar / Safari toolbar tinted to match the app
// instead of the static dark gray baked into index.html. Reads --surface
// off <html> rather than taking a parameter so every effect that can change
// it (skin, the per-track dynamic palette) can just call this.
//
// Regular Safari tab mode only supports a single flat theme-color - no real
// gradient is possible there, since that pixel is Safari chrome, not our
// page content. With Gradient Surfaces on, --surface alone would read as a
// flat patch next to the glow the rest of the shell has, so this blends in
// a chunk of accent approximating the top-right radial's peak (9% alpha,
// same as .app-shell's in index.css) to get closer to what's actually
// painted just below it. Standalone/PWA mode (black-translucent) doesn't
// need this - there the status bar is translucent over real page content,
// which now carries its own matching gradient (see html.gradients rule in
// index.css).
//
// Note: iOS Safari only picks up a theme-color change on the next full
// navigation/reload - it does not live-retint an already-open tab, even
// though this correctly updates the DOM immediately. Nothing to fix there;
// it's a WebKit limitation, not a bug in this code.
// Exported so full-screen overlays that paint their own fixed black backdrop
// (MediaLightbox) can restore the app's real theme color when they close -
// see the meta[name="theme-color"] override there and the QueuePanel comment
// about Safari's Liquid Glass toolbar sampling a fixed inset-0 element's
// background directly.
export function syncThemeColorMeta(): void {
  const themeColor = document.querySelector('meta[name="theme-color"]')
  if (!themeColor) return
  const root = document.documentElement
  const surface = getComputedStyle(root).getPropertyValue('--surface').trim()
  if (!surface) return
  if (!root.classList.contains('gradients') || !surface.startsWith('#')) {
    themeColor.setAttribute('content', surface)
    return
  }
  const accentRgb = getComputedStyle(root).getPropertyValue('--accent-rgb').trim().split(/\s+/).map(Number)
  if (accentRgb.length !== 3 || accentRgb.some(Number.isNaN)) {
    themeColor.setAttribute('content', surface)
    return
  }
  themeColor.setAttribute('content', blendHex(surface, accentRgb, 0.09))
}

// Same Safari-samples-the-actual-pixels issue as MediaLightbox's fixed black
// backdrop, but for the translucent black scrim every mobile bottom sheet
// (mobile/Sheet.tsx) and modal backdrop paints behind it - that darkens
// whatever's currently in the meta tag by the same amount the scrim itself
// darkens the page, so the toolbar dims in step with the sheet instead of
// snapping to black. Call `syncThemeColorMeta()` on close to undo it (it
// recomputes from the real skin vars rather than trying to "undim").
export function dimThemeColorMeta(amount: number): void {
  const themeColor = document.querySelector('meta[name="theme-color"]')
  const current = themeColor?.getAttribute('content')
  if (!themeColor || !current || !current.startsWith('#')) return
  themeColor.setAttribute('content', blendHex(current, [0, 0, 0], amount))
}

function blendHex(hex: string, rgb: number[], amount: number): string {
  const [r, g, b] = hexToRgb(hex)
  const mix = (base: number, tint: number): number =>
    Math.round(base * (1 - amount) + tint * amount)
  return `#${mix(r, rgb[0]).toString(16).padStart(2, '0')}${mix(g, rgb[1]).toString(16).padStart(2, '0')}${mix(b, rgb[2]).toString(16).padStart(2, '0')}`
}

function applyVars(vars: Skin['vars']): void {
  const root = document.documentElement
  for (const [key, value] of Object.entries(vars)) root.style.setProperty(key, value)
  // Optional vars must be actively cleared when a skin omits them - unlike the
  // core keys (which every skin sets), a leftover value from a previously
  // active skin would otherwise persist and override the CSS var() fallback.
  for (const key of SKIN_OPTIONAL_VAR_KEYS) {
    if (vars[key] == null) root.style.removeProperty(key)
  }
  syncThemeColorMeta()
}

function applyAccentVars(accent: string): void {
  const [r, g, b] = hexToRgb(accent)
  const hover = lightenHex(accent, 20)
  const [hr, hg, hb] = hexToRgb(hover)
  const root = document.documentElement
  root.style.setProperty('--accent', accent)
  root.style.setProperty('--accent-rgb', `${r} ${g} ${b}`)
  root.style.setProperty('--accent-hover', hover)
  root.style.setProperty('--accent-hover-rgb', `${hr} ${hg} ${hb}`)
  syncThemeColorMeta()
}

// ── "Now Playing" dynamic skin ───────────────────────────────────────────────
// Samples the current song's cover art on a small canvas, finds the dominant
// colorful hue, and builds a dark palette (surfaces tinted toward that hue,
// accent at full strength) in the same shape every static skin declares.

function loadArtPixels(url: string): Promise<Uint8ClampedArray | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      try {
        const size = 40
        const canvas = document.createElement('canvas')
        canvas.width = size
        canvas.height = size
        const ctx = canvas.getContext('2d')
        if (!ctx) { resolve(null); return }
        ctx.drawImage(img, 0, 0, size, size)
        resolve(ctx.getImageData(0, 0, size, size).data)
      } catch {
        // Tainted canvas (CORS) or decode failure - caller falls back.
        resolve(null)
      }
    }
    img.onerror = () => resolve(null)
    img.src = url
  })
}

// Dominant colorful hue via hue-bucket voting. Each pixel votes for its 30°
// bucket weighted by colorfulness (saturation × distance from black/white),
// so near-grayscale pixels barely count; returns null for effectively
// monochrome art so the fallback palette is used instead.
function dominantHue(data: Uint8ClampedArray): { h: number; s: number } | null {
  const BUCKETS = 12
  const score = new Float64Array(BUCKETS)
  const sumSin = new Float64Array(BUCKETS)
  const sumCos = new Float64Array(BUCKETS)
  const sumSat = new Float64Array(BUCKETS)
  let pixels = 0
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 125) continue
    pixels++
    const r = data[i] / 255, g = data[i + 1] / 255, b = data[i + 2] / 255
    const max = Math.max(r, g, b), min = Math.min(r, g, b)
    const d = max - min
    if (d === 0) continue
    const l = (max + min) / 2
    const s = d / (1 - Math.abs(2 * l - 1))
    let h: number
    if (max === r) h = ((g - b) / d + 6) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60
    const weight = s * (1 - Math.abs(2 * l - 1))
    const bucket = Math.min(BUCKETS - 1, Math.floor(h / (360 / BUCKETS)))
    score[bucket] += weight
    const rad = (h * Math.PI) / 180
    sumSin[bucket] += Math.sin(rad) * weight
    sumCos[bucket] += Math.cos(rad) * weight
    sumSat[bucket] += s * weight
  }
  if (pixels === 0) return null
  let best = 0
  for (let i = 1; i < BUCKETS; i++) if (score[i] > score[best]) best = i
  // Under ~2% aggregate colorfulness the art is effectively grayscale.
  if (score[best] < pixels * 0.02) return null
  const h = ((Math.atan2(sumSin[best], sumCos[best]) * 180) / Math.PI + 360) % 360
  return { h, s: sumSat[best] / score[best] }
}

async function extractSongPalette(
  url: string,
): Promise<{ vars: Skin['vars']; accent: string } | null> {
  const data = await loadArtPixels(url)
  if (!data) return null
  const dom = dominantHue(data)
  if (!dom) return null
  const { h, s } = dom
  // Surfaces stay dark; how strongly they lean toward the art's hue scales
  // with how saturated the art itself is (muted art → subtle tint).
  const surfSat = 0.15 + Math.min(s, 1) * 0.22
  const accent = hslToHex(h, Math.min(0.92, Math.max(0.55, s)), 0.6)
  return {
    accent,
    vars: {
      '--surface': hslToHex(h, surfSat, 0.075),
      '--surface-raised': hslToHex(h, surfSat, 0.105),
      '--surface-overlay': hslToHex(h, surfSat, 0.145),
      '--surface-highest': hslToHex(h, surfSat, 0.185),
      '--sidebar': hslToHex(h, surfSat, 0.045),
      '--titlebar': hslToHex(h, surfSat, 0.045),
      '--text-primary': hslToHex(h, 0.25, 0.96),
      '--text-secondary': hslToHex(h, 0.16, 0.72),
      '--text-muted': hslToHex(h, 0.08, 0.47),
      '--border': `hsl(${Math.round(h)} 70% 75% / 0.13)`,
      '--scrollbar': hslToHex(h, 0.18, 0.27),
    },
  }
}

// True while the accent vars on <html> came from cover art rather than the
// user's accentColor - tells the accent effect to keep its hands off.
let songAccentActive = false

// Applies the active skin's CSS variables and the accent-color variables to
// <html>.
export function useThemeEffects(): void {
  const { theme, customSkins, accentColor, appTextScale, appFont, lyricsFont, gradientsEnabled, surfaceGradientsEnabled } = useStorePick(
    'theme', 'customSkins', 'accentColor', 'appTextScale', 'appFont', 'lyricsFont', 'gradientsEnabled', 'surfaceGradientsEnabled',
  )
  // `customSkins` is picked so that editing the active custom skin's palette
  // (which mutates the array, not the theme id) still reruns the effect below
  // and repaints - this is what gives the skin editor its live preview.
  const skin = getSkin(theme)
  // Only the dynamic skin subscribes to the current song's art (same source
  // chain WrldView uses for the big cover); null otherwise so track changes
  // don't rerun the effect for static skins.
  // Degraded where available: the palette is averaged down to a handful of
  // colours anyway, so a 128px copy yields the same result as the 600px one and
  // repaints the skin a lot sooner after a track change.
  const songArt = useStore((s) =>
    skin.dynamic
      ? smallCoverUrl(buildImageUrl(s.currentTrackFull?.albumArt ?? s.currentTrack?.imageUrl ?? null)) ?? null
      : null,
  )

  useEffect(() => {
    const root = document.documentElement
    // `.dark` still drives Tailwind dark: variants and color-scheme; the
    // palette itself comes from the skin's vars (inline styles override the
    // :root/.dark fallback blocks in index.css). Every skin sets the same
    // set of keys, so switching skins never leaves stale values behind.
    root.classList.toggle('dark', skin.dark)
    const restoreFallback = (): void => {
      applyVars(skin.vars)
      if (songAccentActive) {
        songAccentActive = false
        applyAccentVars(useStore.getState().accentColor)
      }
    }
    if (!skin.dynamic || !songArt) {
      restoreFallback()
      return
    }
    // Keep whatever palette is showing until the new art resolves - no flash
    // of the fallback between tracks.
    let cancelled = false
    extractSongPalette(songArt).then((palette) => {
      if (cancelled) return
      if (!palette) { restoreFallback(); return }
      applyVars(palette.vars)
      applyAccentVars(palette.accent)
      songAccentActive = true
    })
    return () => { cancelled = true }
  }, [theme, songArt, customSkins])

  useEffect(() => {
    if (songAccentActive) return
    applyAccentVars(accentColor)
  }, [accentColor, theme])

  // App-wide text size. Tailwind's type scale (and rem-based spacing) keys
  // off the root font-size, so one declaration scales text everywhere -
  // cleared back to the stylesheet default at 1 so nothing is overridden.
  useEffect(() => {
    document.documentElement.style.fontSize =
      appTextScale === 1 ? '' : `${appTextScale * 100}%`
  }, [appTextScale])

  // Font stacks. --font-app backs Tailwind's font-sans (so it reaches every
  // screen through preflight's <html> rule); --font-lyrics is read by the
  // lyric panels only.
  useEffect(() => {
    const root = document.documentElement
    root.style.setProperty('--font-app', getFont(appFont).stack)
    root.style.setProperty('--font-lyrics', getFont(lyricsFont).stack)
  }, [appFont, lyricsFont])

  // Gradient surfaces - index.css keys the accent-tinted washes and the
  // accent-button sheen off this class. Purely cosmetic overlays on top of
  // the flat palette, so toggling never changes any skin's base colors.
  useEffect(() => {
    document.documentElement.classList.toggle('gradients', gradientsEnabled)
    syncThemeColorMeta()
  }, [gradientsEnabled])

  // Same idea, split into its own class so bg-surface-overlay boxes (toggle
  // groups, search bars, badges, menus) can be turned on/off independently
  // of the shell/sidebar/player/accent gradients above.
  useEffect(() => {
    document.documentElement.classList.toggle('surface-gradients', surfaceGradientsEnabled)
  }, [surfaceGradientsEnabled])

  // Palette cross-fades (index.css transitions the registered vars) switch on
  // only after the persisted skin has painted once - two rAFs so the browser
  // has committed a frame with the final startup values, otherwise launch
  // would visibly fade from the first-paint fallback palette.
  useEffect(() => {
    let inner = 0
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() =>
        document.documentElement.classList.add('theme-animate'),
      )
    })
    return () => {
      cancelAnimationFrame(outer)
      cancelAnimationFrame(inner)
    }
  }, [])
}
