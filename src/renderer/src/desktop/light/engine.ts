// The light's behaviour, ported from iJWA's light engine (itself from the Mac's EdgeRenderer, LightStyle,
// BeatFollower, OKLab and ArtworkPalette): what the snakes do, how the music moves them, how colors blend.
// Pure logic: no DOM, no GL, so it can be checked on its own.
import { lookOf, placeNumber, tickerHeight, type Look } from './looks'

export interface HSB { hue: number; saturation: number; brightness: number }
export type RGB = [number, number, number]
export type Motion = 'flow' | 'still' | 'music'

/** What the light reads of the settings. */
export interface LightStyle {
  twoColors: boolean
  motion: Motion
  look: string
  place: string
  thickness: number
  glow: number
  particles: number
  tailLength: number
  primary: HSB
  secondary: HSB
  useArtworkColors: boolean
  sensitivity: number
  reaction: number
  smoothness: number
}

/** The two colors an artwork gives the light. */
export interface AlbumColors { primary: HSB; secondary: HSB }

/** What the meter hears: loudness, and the bass's jump over its own recent level. */
export interface Meter { decibels: number; punch: number }

export const DEFAULT_LIGHT: LightStyle = {
  twoColors: true,
  motion: 'music',
  look: 'snake',
  place: 'all',
  thickness: 0.1,
  glow: 0.7,
  particles: 0.4,
  tailLength: 1.0,
  primary: { hue: 0.74, saturation: 0.68, brightness: 1 },
  secondary: { hue: 0.54, saturation: 0.9, brightness: 1 },
  useArtworkColors: true,
  sensitivity: 0.5,
  reaction: 0.6,
  smoothness: 0.5,
}

const clamp = (x: number, lo: number, hi: number): number => Math.min(Math.max(x, lo), hi)
const mix = (a: number, b: number, t: number): number => a + (b - a) * t

// ---- color -------------------------------------------------------------------------------

export function hsbToRgb({ hue, saturation, brightness }: HSB): RGB {
  const h = (hue % 1) * 6
  const chroma = brightness * saturation
  const x = chroma * (1 - Math.abs((h % 2) - 1))
  const m = brightness - chroma
  let r: number, g: number, b: number
  switch (Math.floor(h)) {
    case 0: [r, g, b] = [chroma, x, 0]; break
    case 1: [r, g, b] = [x, chroma, 0]; break
    case 2: [r, g, b] = [0, chroma, x]; break
    case 3: [r, g, b] = [0, x, chroma]; break
    case 4: [r, g, b] = [x, 0, chroma]; break
    default: [r, g, b] = [chroma, 0, x]
  }
  return [r + m, g + m, b + m]
}

/** The inverse of hsbToRgb, for colors that arrive as RGB (an accent, a baked era palette). */
export function rgbToHsb([r, g, b]: RGB): HSB {
  const high = Math.max(r, g, b), low = Math.min(r, g, b), chroma = high - low
  let hue = 0
  if (chroma > 0) {
    hue = high === r ? (g - b) / chroma : high === g ? (b - r) / chroma + 2 : (r - g) / chroma + 4
    hue /= 6
    if (hue < 0) hue += 1
  }
  return { hue, saturation: high > 0 ? chroma / high : 0, brightness: high }
}

const toLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))
const toGamma = (c: number): number => {
  c = clamp(c, 0, 1)
  return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055
}

export function rgbToOklab([R, G, B]: RGB): RGB {
  const r = toLinear(R), g = toLinear(G), b = toLinear(B)
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}

export function oklabToRgb([L, a, b]: RGB): RGB {
  const l = Math.pow(L + 0.3963377774 * a + 0.2158037573 * b, 3)
  const m = Math.pow(L - 0.1055613458 * a - 0.0638541728 * b, 3)
  const s = Math.pow(L - 0.0894841775 * a - 1.291485548 * b, 3)
  return [
    toGamma(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    toGamma(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    toGamma(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ]
}

/** The two colors an artwork gives the light: the most vivid hue covering most of the picture, then the
 *  strongest clearly different one. `data` is RGBA pixels of a side×side picture. Null for grey artwork. */
export function paletteFromPixels(data: ArrayLike<number>, side = 32, bins = 24): AlbumColors | null {
  const weight = new Array<number>(bins).fill(0)
  const hueX = [...weight], hueY = [...weight], sat = [...weight], bri = [...weight]
  for (let i = 0; i < side * side * 4; i += 4) {
    const r = data[i] / 255, g = data[i + 1] / 255, b = data[i + 2] / 255
    const high = Math.max(r, g, b), low = Math.min(r, g, b), chroma = high - low
    if (chroma <= 0) continue
    let h = high === r ? (g - b) / chroma : high === g ? (b - r) / chroma + 2 : (r - g) / chroma + 4
    h /= 6; if (h < 0) h += 1
    const s = chroma / high, v = high
    if (!(s > 0.2 && v > 0.18)) continue
    const w = s * s * v
    const bin = Math.min(Math.floor(h * bins), bins - 1)
    weight[bin] += w
    hueX[bin] += Math.cos(h * 2 * Math.PI) * w
    hueY[bin] += Math.sin(h * 2 * Math.PI) * w
    sat[bin] += s * w
    bri[bin] += v * w
  }
  const score = weight.map((_, i) => weight[i] + 0.5 * (weight[(i + bins - 1) % bins] + weight[(i + 1) % bins]))
  let best = 0
  for (let i = 1; i < bins; i++) if (score[i] > score[best]) best = i
  if (!(weight[best] > 1.5)) return null
  const apart = (a: number, b: number): number => Math.min(Math.abs(a - b), bins - Math.abs(a - b))
  let second = -1
  for (let i = 0; i < bins; i++) {
    if (apart(i, best) >= 3 && weight[i] > 0 && score[i] >= score[best] * 0.12 && (second < 0 || score[i] > score[second])) second = i
  }
  const color = (bin: number): HSB => {
    let hue = Math.atan2(hueY[bin], hueX[bin]) / (2 * Math.PI)
    if (hue < 0) hue += 1
    return { hue, saturation: clamp(sat[bin] / weight[bin], 0.55, 1), brightness: Math.max(bri[bin] / weight[bin], 0.92) }
  }
  const primary = color(best)
  return { primary, secondary: second >= 0 ? color(second) : primary }
}

// ---- music -------------------------------------------------------------------------------

/** Where a sound sits between too quiet to move the light (0) and full swing (1). */
export function musicLevel(style: Pick<LightStyle, 'sensitivity'>, decibels: number): number {
  const floor = -40 - 25 * style.sensitivity
  return clamp((decibels - floor) / 38, 0, 1)
}

/** How hard this moment hits, 0...1: the bass's jump over its recent level. */
export function beatOf(style: Pick<LightStyle, 'sensitivity'>, punch: number): number {
  const threshold = 1.45 - 0.45 * style.sensitivity
  const hit = clamp((punch - threshold) / threshold, 0, 1)
  return Math.pow(hit, 0.75)
}

export class BeatFollower {
  kick = 0
  follow(punch: number, style: Pick<LightStyle, 'sensitivity' | 'smoothness'>, seconds: number): void {
    const hit = beatOf(style, punch)
    const landing = hit > this.kick ? 0.004 + 0.016 * style.smoothness : 0.06 + 0.28 * style.smoothness
    this.kick += (hit - this.kick) * (1 - Math.exp(-seconds / landing))
  }
  reset(): void { this.kick = 0 }
}

// ---- the light ---------------------------------------------------------------------------

const LAP = 22, MUSIC_LAP = 16, QUIET_DRIFT = 0.25

/** What the shader draws for one frame. */
export interface LightFrame {
  size: [number, number]
  scale: number
  colorA: RGB
  colorB: RGB
  wiggle: number
  headA: number
  headB: number
  span: number
  thickness: number
  glow: number
  corner: number
  band: number
  still: number
  presence: number
  pulse: number
  swell: number
  time: number
  sparkle: number
  taper: number
  drops: number[]
  dropAt: number[]
  strip: [number, number, number, number]
  look: number
  fn: string
  drift: number
  beat: number
  place: number
}

export class LightEngine {
  presence = 0
  target = 0
  fade: { from: number; to: number; start: number; duration: number } | null = null
  travel = 0
  musicLvl = 0
  beat = new BeatFollower()
  lastFrame: number | null = null
  wigglePhase = 0
  liveliness = 1
  quietFor = 0
  tempo = 1
  onsets: number[] = []
  beatHeld = false
  shownA: RGB | null = null
  shownB: RGB | null = null
  isBlending = false
  blendTime = 0.06
  lastBeat = 0
  album: AlbumColors | null = null
  /** The ripple's drops, the lightning's strikes, the fireworks: when each began and where along the rim. */
  drops: { born: number; at: number }[] = []
  /** How far the flowing lights have flowed, slowing to a stop as a music light rests. */
  drift = 0
  /** The ticker: how far its words have run, and their strip's width in points (the renderer sets it). */
  tickerScroll = 0
  tickerWidth = 0

  get kick(): number { return this.beat.kick }

  /** Fade the light on or off; the rise takes 1.1 s, the sink 0.8 s. */
  fadeTo(value: number, now: number): void {
    if (value === this.target) return
    this.target = value
    this.fade = { from: this.presence, to: value, start: now, duration: value > this.presence ? 1.1 : 0.8 }
  }

  /** A new song's artwork colors (or null): they blend in over most of a second. */
  setAlbum(album: AlbumColors | null): void {
    this.album = album
    this.blendTime = 0.7
  }

  targetColors(style: LightStyle): [RGB, RGB] {
    const album = style.useArtworkColors ? this.album : null
    const first = album ? album.primary : style.primary
    const second = style.twoColors ? (album ? album.secondary : style.secondary) : first
    return [hsbToRgb(first), hsbToRgb(second)]
  }

  /** Counts the beats and sets the pace from the last six seconds of them; true on the frame a beat lands. */
  followTempo(hit: number, now: number, seconds: number): boolean {
    let landed = false
    if (hit > 0.3 && !this.beatHeld) { this.beatHeld = true; landed = true; this.onsets.push(now) }
    else if (hit < 0.1) this.beatHeld = false
    this.onsets = this.onsets.filter((t) => now - t <= 6)
    let wanted = 1
    if (this.onsets.length >= 3) {
      const first = this.onsets[0], last = this.onsets[this.onsets.length - 1]
      if (last > first) wanted = clamp(((this.onsets.length - 1) / (last - first)) / 1.6, 0.6, 2.6)
    }
    this.tempo += (wanted - this.tempo) * (1 - Math.exp(-seconds / 1.6))
    return landed
  }

  // ---- the drops (the ripple) ----

  drop(now: number): void {
    const last = this.drops[this.drops.length - 1]
    if (last && now - last.born < 0.18) return
    this.drops.push({ born: now, at: Math.random() })
    if (this.drops.length > 4) this.drops.splice(0, this.drops.length - 4)
  }

  /** Without music a drop falls every couple of seconds; any light lets go of old ones. */
  followDrops(now: number, style: LightStyle, look: Look): void {
    const last = this.drops[this.drops.length - 1]
    if (look.drops && style.motion === 'flow' && (!last || now - last.born >= 1.9)) this.drop(now)
    this.drops = this.drops.filter((d) => now - d.born <= 3.2)
  }

  blendColors(seconds: number, style: LightStyle): void {
    const [first, second] = this.targetColors(style)
    const targetA = rgbToOklab(first), targetB = rgbToOklab(second)
    if (!this.shownA || !this.shownB) { this.shownA = targetA; this.shownB = targetB; return }
    const step = 1 - Math.exp(-seconds / this.blendTime)
    const shownA = this.shownA, shownB = this.shownB
    const a = shownA.map((v, i) => v + (targetA[i] - v) * step) as RGB
    const b = shownB.map((v, i) => v + (targetB[i] - v) * step) as RGB
    const dist = (x: RGB, y: RGB): number => Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2])
    this.isBlending = Math.max(dist(targetA, a), dist(targetB, b)) > 0.002
    if (!this.isBlending) { this.shownA = targetA; this.shownB = targetB; this.blendTime = 0.06 }
    else { this.shownA = a; this.shownB = b }
  }

  /**
   * Moves the light on by one frame. `now` in seconds; `audio` is what the meter hears;
   * `playing` says whether a song plays. Returns what the shader draws.
   */
  step(now: number, audio: Meter, playing: boolean, style: LightStyle, size: [number, number], scale: number): LightFrame {
    // The fade, eased in going up and in-out going down.
    if (this.fade) {
      const progress = clamp((now - this.fade.start) / this.fade.duration, 0, 1)
      const eased = this.fade.to > this.fade.from
        ? 1 - Math.pow(1 - progress, 3)
        : (progress < 0.5 ? 4 * Math.pow(progress, 3) : 1 - Math.pow(-2 * progress + 2, 3) / 2)
      this.presence = this.fade.from + (this.fade.to - this.fade.from) * eased
      if (progress >= 1) this.fade = null
    }

    const seconds = this.lastFrame === null ? 0 : clamp(now - this.lastFrame, 0, 0.1)
    const look = lookOf(style.look)
    this.lastFrame = now
    const music = style.motion === 'music'

    if (music) {
      this.beat.follow(audio.punch, style, seconds)
      if (this.kick > 0.05) this.lastBeat = now
      if (this.followTempo(beatOf(style, audio.punch), now, seconds) && look.drops) this.drop(now)
      const level = musicLevel(style, audio.decibels)
      const easing = level > this.musicLvl ? 0.05 : 0.4 + 0.6 * style.smoothness
      this.musicLvl += (level - this.musicLvl) * (1 - Math.exp(-seconds / easing))
      this.quietFor = audio.decibels < -55 ? this.quietFor + seconds : 0
    } else {
      this.beat.reset()
      this.musicLvl = 0
      this.quietFor = 0
      this.tempo = 1
      this.onsets = []
    }

    // No music: the light comes to rest. A quiet passage of a song: it slows.
    const calm = style.motion !== 'music' ? 1 : !playing ? 0 : this.quietFor > 2.5 ? QUIET_DRIFT : 1
    this.liveliness += (calm - this.liveliness) * (1 - Math.exp(-seconds / (calm < this.liveliness ? 0.9 : 0.35)))
    if (Math.abs(calm - this.liveliness) < 0.005) this.liveliness = calm

    this.blendColors(seconds, style)
    this.followDrops(now, style, look)
    // Music hurries the flowing lights, and each beat nudges them on.
    this.drift = (this.drift + seconds * (this.tempo + 1.2 * style.reaction * this.kick) * this.liveliness * 0.6) % 1000
    if (look.words) {
      // About 70 points a second, hurried a little on each beat.
      this.tickerScroll += seconds * (70 + 90 * this.kick) * Math.max(this.liveliness, 0.35)
      if (this.tickerWidth > 0) this.tickerScroll %= this.tickerWidth
    }

    // The snakes run at the music's tempo, and on a beat lunge forward.
    const pace = (this.tempo + 10 * style.reaction * this.kick) * this.liveliness
    this.travel = (this.travel + (seconds / (music ? MUSIC_LAP : LAP)) * pace) % 1
    this.wigglePhase = (this.wigglePhase + seconds * 3 * (this.tempo + 1.5 * this.kick) * this.liveliness) % (2 * Math.PI)

    const still = style.motion === 'still'
    const reaction = style.reaction
    // A beat flares the light more than it widens it: widened as much as on the Mac, it reads as too thick.
    const pulse = music ? mix(1 - 0.4 * reaction, 1, this.musicLvl) + 0.9 * reaction * this.kick : 1
    const swell = music ? 1 + 0.25 * reaction * this.kick : 1
    const beating = Math.min(0.55 + 1.6 * this.kick, 1.8)
    const sparkle = still ? 0 : style.particles * (music ? beating * this.liveliness : 1)
    const thickness = 12 + style.thickness * 52
    // The newest four drops, newest first; -1 where there's none.
    const recent = this.drops.slice(-4).reverse()
    const drops = [0, 1, 2, 3].map((i) => (i < recent.length ? now - recent[i].born : -1))
    const dropAt = [0, 1, 2, 3].map((i) => (i < recent.length ? recent[i].at : 0))

    return {
      size, scale,
      colorA: oklabToRgb(this.shownA!), colorB: oklabToRgb(this.shownB!),
      wiggle: this.wigglePhase,
      // The twins start opposite each other and run opposite ways.
      headA: this.travel, headB: look.id === 'twin' ? (1.5 - this.travel) % 1 : (this.travel + 0.5) % 1,
      span: 0.18 + 0.54 * style.tailLength,
      thickness, glow: style.glow, corner: 12,
      band: Math.max(thickness * (still ? 1.28 : look.reach) * 2.6, sparkle > 0 ? 80 : 0),
      still: still ? 1 : 0,
      presence: this.presence, pulse, swell,
      time: now % 3600,
      sparkle,
      taper: 1.6 - style.tailLength,
      drops, dropAt,
      strip: [this.tickerWidth, tickerHeight(style.thickness), this.tickerScroll, 0],
      // Held still, every light is the same glowing rim.
      look: still ? 0 : look.number,
      fn: still ? 'rimFragment' : look.fn,
      drift: this.drift,
      beat: music ? this.kick : 0,
      place: placeNumber(style.place),
    }
  }

  /** How soon the next frame is needed: fades 60, a beat 30, calm motion 20, resting 15; 0 when nothing moves. */
  frameRate(style: LightStyle, playing: boolean, now: number): number {
    if (this.fade) return 60
    if (this.presence === 0) return 0
    const music = style.motion === 'music'
    const resting = music && !playing && this.liveliness === 0 && this.kick < 0.001 && this.drops.length === 0
    if ((style.motion === 'still' || resting) && !this.isBlending) return 0
    const quiet = music && this.liveliness <= QUIET_DRIFT && this.kick < 0.001
    const lively = music && now - this.lastBeat < 1
    return quiet ? 15 : lively ? 30 : 20
  }
}
