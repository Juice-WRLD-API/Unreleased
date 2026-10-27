// Shared Web Audio post-processing chain for every playable <audio> element
// (both Player slots + the 999FM element). Elements are routed through:
//
//   MediaElementSource → chainInput ─→ preamp → 10-band EQ → cut filter → saturation
//                                   │    → compressor → mono → width → balance → 8D pan
//                                   │    → (dry + reverb + echo) → boost → limiter → destination
//                                   └→ analyser (silence detection tap)
//
// Element-level volume/playbackRate/crossfade logic is untouched - the
// MediaElementSource picks up the element's volume-scaled output, so all the
// existing fade ramps keep working exactly as before.
//
// CORS note: createMediaElementSource outputs pure silence for media fetched
// without CORS clearance. Every playable origin is covered - the API sends
// `access-control-allow-origin: *`, the local-media:// protocol handler adds
// the same header, and FM's MSE path plays a same-origin blob: URL - but the
// <audio> elements must carry crossOrigin="anonymous" for any of that to
// apply.

import { IS_IOS, IS_MOBILE } from './platform'

export const EQ_BANDS = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]
export const EQ_GAIN_LIMIT = 12
// Volume boost range - 1 = 100% (unity, no boost), 2 = 200%.
export const EQ_BOOST_MAX = 2

export interface EqPreset {
  id: string
  name: string
  gains: number[]
}

export const FLAT_GAINS: number[] = EQ_BANDS.map(() => 0)

export const EQ_PRESETS: EqPreset[] = [
  { id: 'flat',           name: 'Flat',           gains: FLAT_GAINS },
  { id: 'bass-boost',     name: 'Bass Boost',     gains: [6, 5, 4, 2.5, 1, 0, 0, 0, 0, 0] },
  { id: 'bass-reducer',   name: 'Bass Reducer',   gains: [-6, -5, -4, -2.5, -1, 0, 0, 0, 0, 0] },
  { id: 'treble-boost',   name: 'Treble Boost',   gains: [0, 0, 0, 0, 0, 1, 2.5, 4, 5, 6] },
  { id: 'treble-reducer', name: 'Treble Reducer', gains: [0, 0, 0, 0, 0, -1, -2.5, -4, -5, -6] },
  { id: 'vocal',          name: 'Vocal Boost',    gains: [-2, -3, -3, 1, 4, 4, 3, 1.5, 0, -1.5] },
  { id: 'rock',           name: 'Rock',           gains: [5, 4, 3, 1.5, -0.5, -1, 0.5, 2.5, 3.5, 4.5] },
  { id: 'pop',            name: 'Pop',            gains: [-1.5, -1, 0, 2, 4, 4, 2, 0, -1, -1.5] },
  { id: 'hip-hop',        name: 'Hip-Hop',        gains: [5, 4, 1.5, 3, -1, -1, 1.5, -0.5, 2, 3] },
  { id: 'electronic',     name: 'Electronic',     gains: [4.5, 4, 1.5, 0, -2, 2, 1, 1.5, 4, 5] },
  { id: 'jazz',           name: 'Jazz',           gains: [4, 3, 1.5, 2, -1.5, -1.5, 0, 1.5, 3, 4] },
  { id: 'classical',      name: 'Classical',      gains: [4.5, 3.5, 3, 2.5, -1.5, -1.5, 0, 2, 3, 4] },
  { id: 'acoustic',       name: 'Acoustic',       gains: [5, 5, 4, 1, 2, 1.5, 3.5, 4, 3.5, 2] },
  { id: 'small-speakers', name: 'Small Speakers', gains: [5.5, 4.5, 4, 2.5, 1.5, 0, -1.5, -3, -4, -4.5] },
]

// A community-made edit of a song - an actual audio FILE (sped-up, remix,
// mashup, …) served by the API, not an effects preset. The endpoints don't
// exist yet; this models what the panel will list and play once they do,
// using the same /files/download/ path convention as regular songs.
export interface CommunityEdit {
  id: string
  name: string
  author?: string
  // API file path, streamable via buildStreamUrl().
  path: string
  // The tracker song this is an edit of, when it's tied to one.
  songId?: number
  duration?: number
  imageUrl?: string
  // The player's artist line while it plays, in place of "Community edit".
  artist?: string
}

export interface AudioEffectSettings {
  eqEnabled: boolean
  gains: number[]
  balance: number  // -1 (full left) .. 1 (full right)
  mono: boolean
  // Reverb wet amount, 0 (bypass) .. 1 (fully wet). Callers pass 0 while the
  // slowed+reverb feature is off. The slowed half of the feature is
  // element-level playbackRate/preservesPitch, handled by the Player.
  reverbMix: number
  // Impulse-response tail length in seconds.
  reverbDecay: number
  // Post-EQ makeup gain, 1 (100%, unity) .. EQ_BOOST_MAX (200%). Lets tracks
  // that are just quiet get louder than the element's own 0..1 volume range
  // allows. Runs through the same safety limiter as everything else in the
  // chain, so it clamps rather than clips.
  boost: number
  fx: AudioFx
}

// The effects beyond the band EQ, kept as one flat object so the store,
// profile sync, the pop-out mirror and the terminal each carry a single key
// for all of them instead of one per knob. Every effect has a neutral value
// (or an off toggle) at which its node is transparent, so the chain never
// needs rewiring - only parameter changes.
export interface AudioFx {
  // dB ahead of the bands - headroom for boost-heavy curves, or a lift for
  // cut-heavy ones. Only applies while the EQ is on, like the bands.
  preamp: number
  // 0 = mono, 1 = as mixed, 2 = extra wide (mid/side matrix).
  width: number
  // Saturation drive, 0 (off) .. 1.
  drive: number
  compressor: boolean
  compThreshold: number  // dB
  compRatio: number
  compAttack: number     // seconds
  compRelease: number    // seconds
  // High-pass + low-pass pair (lo-fi, "next room", telephone).
  filter: boolean
  lowCut: number         // Hz
  highCut: number        // Hz
  filterResonance: number  // dB peak at both corners
  echo: boolean
  echoTime: number       // seconds between repeats
  echoFeedback: number   // 0..0.9 - how much of each repeat feeds the next
  echoMix: number        // 0..1 wet level (the dry signal stays at full)
  // "8D audio": an LFO sweeping the pan around the listener.
  autoPan: boolean
  autoPanPeriod: number  // seconds per full left-right-left sweep
  autoPanDepth: number   // 0..1
}

export const DEFAULT_FX: AudioFx = {
  preamp: 0,
  width: 1,
  drive: 0,
  compressor: false,
  compThreshold: -24,
  compRatio: 4,
  compAttack: 0.01,
  compRelease: 0.25,
  filter: false,
  lowCut: 120,
  highCut: 5000,
  filterResonance: 1,
  echo: false,
  echoTime: 0.35,
  echoFeedback: 0.35,
  echoMix: 0.3,
  autoPan: false,
  autoPanPeriod: 8,
  autoPanDepth: 0.8,
}

type NumericFxKey = { [K in keyof AudioFx]: AudioFx[K] extends number ? K : never }[keyof AudioFx]

// Allowed range per knob - the panel's sliders, the terminal's validation and
// sanitizeFx's clamping all read from here.
export const FX_RANGES: Record<NumericFxKey, { min: number; max: number; step: number }> = {
  preamp: { min: -EQ_GAIN_LIMIT, max: EQ_GAIN_LIMIT, step: 0.5 },
  width: { min: 0, max: 2, step: 0.05 },
  drive: { min: 0, max: 1, step: 0.01 },
  compThreshold: { min: -60, max: 0, step: 1 },
  compRatio: { min: 1, max: 20, step: 0.5 },
  compAttack: { min: 0.001, max: 0.2, step: 0.001 },
  compRelease: { min: 0.05, max: 1, step: 0.01 },
  lowCut: { min: 20, max: 2000, step: 5 },
  highCut: { min: 1000, max: 20000, step: 100 },
  filterResonance: { min: 0, max: 15, step: 0.5 },
  echoTime: { min: 0.05, max: 1.5, step: 0.01 },
  echoFeedback: { min: 0, max: 0.9, step: 0.01 },
  echoMix: { min: 0, max: 1, step: 0.01 },
  autoPanPeriod: { min: 1, max: 20, step: 0.5 },
  autoPanDepth: { min: 0, max: 1, step: 0.01 },
}

// Fills gaps from DEFAULT_FX and clamps every number into range, so a stored
// or synced blob from an older/newer build can never feed the graph garbage.
export function sanitizeFx(raw: unknown): AudioFx {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const out = { ...DEFAULT_FX } as Record<keyof AudioFx, number | boolean>
  for (const key of Object.keys(DEFAULT_FX) as (keyof AudioFx)[]) {
    const v = src[key]
    if (typeof DEFAULT_FX[key] === 'boolean') {
      if (typeof v === 'boolean') out[key] = v
    } else if (typeof v === 'number' && Number.isFinite(v)) {
      const r = FX_RANGES[key as NumericFxKey]
      out[key] = Math.max(r.min, Math.min(r.max, v))
    }
  }
  return out as unknown as AudioFx
}

// Whether any of these effects is doing something - drives the EQ button's
// accent and, on mobile, whether the Web Audio chain is worth building.
export function fxInUse(fx: AudioFx, eqEnabled: boolean): boolean {
  return (eqEnabled && fx.preamp !== 0) || fx.width !== 1 || fx.drive > 0
    || fx.compressor || fx.filter || fx.echo || fx.autoPan
}

// User-saved band curves, listed under the built-in presets.
export const USER_PRESET_PREFIX = 'user:'
export const USER_PRESET_NAME_MAX = 40

export function sanitizeUserPresets(raw: unknown): EqPreset[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((p): p is EqPreset =>
    !!p && typeof p.id === 'string' && p.id.startsWith(USER_PRESET_PREFIX)
    && typeof p.name === 'string' && p.name.trim() !== ''
    && Array.isArray(p.gains) && p.gains.length === EQ_BANDS.length
    && p.gains.every((g: unknown) => typeof g === 'number' && Number.isFinite(g)))
}

// ── iOS background-audio guard ──────────────────────────────────────────────
// On iOS/iPadOS (every browser there is WebKit), a bare <audio> element keeps
// playing when the tab is backgrounded / the screen locks - that's what drives
// lock-screen playback. But the moment its output is routed through a Web Audio
// AudioContext (createMediaElementSource → … → ctx.destination), iOS ties the
// sound to the context's lifetime and *suspends the context* on background,
// then tears it down after a couple of minutes of inactivity. Result: music
// dies ~minutes after the user leaves the app, with no event we can catch - and
// no gesture available in the background to resume() it. This is architectural,
// not a bug we can patch with watchdogs (we tried; see Player's interval +
// visibilitychange handlers), so the only reliable fix is to *not* route
// through Web Audio on iOS: play the bare element and forfeit EQ/balance/mono/
// reverb/skip-silence there. Uninterrupted background playback >> effects.

// Whether the Web Audio effects chain can run at all. False on iOS (see above),
// where attaching would sacrifice background playback - the UI reads this to
// explain why EQ/balance/reverb are unavailable instead of silently doing
// nothing.
export const EFFECTS_SUPPORTED = !IS_IOS

// Android is a milder version of the same story: routing through the graph
// works, but the context gets suspended by doze/screen-off and the page loses
// the "playing audio" exemption that keeps a backgrounded tab from being
// frozen - at which point nothing is left running to resume it. A bare element
// survives all of that. So on mobile the graph is built lazily: elements stay
// unrouted until the user actually switches an effect on, which is the only
// point where the trade is worth making. Desktop builds it on the first play
// (resumeEffectsContext): creating the context and its nodes at mount cost
// 115-150 ms of every launch, before anything had played.
let effectsWanted = false

let ctx: AudioContext | null = null
let chainInput: GainNode | null = null
let analyser: AnalyserNode | null = null
let bandFilters: BiquadFilterNode[] = []
let monoNode: GainNode | null = null
let panner: StereoPannerNode | null = null
let analyserBuf: Float32Array<ArrayBuffer> | null = null
let dryGain: GainNode | null = null
let wetGain: GainNode | null = null
let convolver: ConvolverNode | null = null
let boostGain: GainNode | null = null
let builtDecay = 0
let decayRebuildTimer: number | null = null
let preampGain: GainNode | null = null
let lowCutFilter: BiquadFilterNode | null = null
let highCutFilter: BiquadFilterNode | null = null
let shaper: WaveShaperNode | null = null
let builtDrive = 0
let compressor: DynamicsCompressorNode | null = null
// Width matrix: L' = direct·L + cross·R, R' = cross·L + direct·R.
let widthDirect: GainNode[] = []
let widthCross: GainNode[] = []
let autoPanner: StereoPannerNode | null = null
let autoPanLfo: OscillatorNode | null = null
let autoPanDepthGain: GainNode | null = null
let echoSend: GainNode | null = null
let echoDelay: DelayNode | null = null
let echoFeedbackGain: GainNode | null = null
let echoWet: GainNode | null = null

// Elements already wired in - createMediaElementSource throws if called twice
// on the same element, and there is no way to un-create a source node.
const attachedEls = new WeakSet<HTMLAudioElement>()
// Elements that asked to be routed while the graph didn't exist yet (mobile,
// before any effect is switched on). Held so enabling an effect later can wire
// up everything that already registered - the player slots and the FM element
// all attach once at mount and never come back to ask again. Bounded by that:
// three elements that live as long as the app does.
const pendingEls = new Set<HTMLAudioElement>()

// Settings/sink can arrive from the store before the first element attaches
// (i.e. before the graph exists) - hold them and apply on creation.
let lastSettings: AudioEffectSettings = { eqEnabled: false, gains: FLAT_GAINS, balance: 0, mono: false, reverbMix: 0, reverbDecay: 3, boost: 1, fx: DEFAULT_FX }
let lastSinkId = ''

// Synthetic impulse response: stereo noise burst with an exponential-ish
// decay curve - the standard trick for a convolution reverb without shipping
// an IR file. ConvolverNode.normalize (default on) keeps loudness comparable
// across tail lengths.
function buildImpulseResponse(context: AudioContext, seconds: number): AudioBuffer {
  const rate = context.sampleRate
  const length = Math.max(1, Math.floor(rate * seconds))
  const buf = context.createBuffer(2, length, rate)
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch)
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 2.5)
    }
  }
  return buf
}

// Soft-clip (tanh) curve for the saturation stage. Normalized so a signal at
// SAT_REF keeps its level - typical program material stays about as loud
// while its peaks get rounded off - instead of the usual peak-normalized
// curve, which turns "more drive" into "much louder". Small signals pick up at
// most ~+6 dB at full drive. Odd length so x = 0 lands exactly on the centre
// sample (no DC offset).
const SAT_REF = 0.25
function buildSaturationCurve(drive: number): Float32Array<ArrayBuffer> {
  const k = 1 + 7 * drive
  const norm = SAT_REF / Math.tanh(k * SAT_REF)
  const n = 2049
  const curve = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1
    curve[i] = norm * Math.tanh(k * x)
  }
  return curve
}

function ensureGraph(): AudioContext | null {
  if (ctx) return ctx
  // iOS: never build the graph - routing through Web Audio would kill
  // background playback (see IS_IOS above). Elements play bare instead.
  if (IS_IOS) return null
  // Android: not until an effect is actually in use (see effectsWanted).
  if (!effectsWanted) return null
  try {
    ctx = new AudioContext()
  } catch (e) {
    console.error('AudioContext creation failed - audio effects disabled:', e)
    return null
  }

  // Auto-resume if the context ever suspends. We never suspend it ourselves
  // (pausing pauses the <audio> element, not the graph), so a 'suspended' state
  // always means the OS did it - Android in particular suspends the context
  // when the screen turns off / the device dozes, which silences playback
  // (audio is routed *through* this graph) while the element still reports as
  // playing, so the Player's element watchdog can't see it. Nudging it back
  // here is what keeps Android background audio alive with the screen off.
  ctx.addEventListener('statechange', () => {
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {})
  })

  chainInput = ctx.createGain()

  // Silence-detection tap: parallel branch, listens to the raw (pre-EQ) mix so
  // a bass-boosted rumble floor doesn't mask actual silence.
  analyser = ctx.createAnalyser()
  analyser.fftSize = 2048
  analyserBuf = new Float32Array(analyser.fftSize)
  chainInput.connect(analyser)

  preampGain = ctx.createGain()

  // EQ bands: shelves at the extremes, peaking in between.
  bandFilters = EQ_BANDS.map((freq, i) => {
    const f = ctx!.createBiquadFilter()
    if (i === 0) f.type = 'lowshelf'
    else if (i === EQ_BANDS.length - 1) f.type = 'highshelf'
    else { f.type = 'peaking'; f.Q.value = 1.1 }
    f.frequency.value = freq
    f.gain.value = 0
    return f
  })

  // Mono: forcing the node's channel count to 1 makes Web Audio downmix at
  // its input; the destination upmixes the single channel back to both ears.
  monoNode = ctx.createGain()
  monoNode.channelInterpretation = 'speakers'

  panner = ctx.createStereoPanner()

  // Safety limiter - several presets push +5 dB and stacked boosts would
  // otherwise hard-clip. Zero knee + high threshold keeps it transparent
  // until a peak actually exceeds it.
  const limiter = ctx.createDynamicsCompressor()
  limiter.threshold.value = -1.5
  limiter.knee.value = 0
  limiter.ratio.value = 20
  limiter.attack.value = 0.001
  limiter.release.value = 0.1

  // Reverb: parallel dry/wet split after the panner. The convolver's IR is
  // built lazily on first non-zero mix (an 8s stereo buffer is not free).
  dryGain = ctx.createGain()
  wetGain = ctx.createGain()
  dryGain.gain.value = 1
  wetGain.gain.value = 0
  convolver = ctx.createConvolver()

  // Boost: makeup gain applied after the dry/wet mix, before the limiter -
  // so boosted peaks still get caught by the same safety compressor instead
  // of clipping straight through.
  boostGain = ctx.createGain()
  boostGain.gain.value = 1

  // Cut filter: a high-pass/low-pass pair. "Off" parks the corners at 0 Hz
  // and Nyquist, where Web Audio's biquads collapse to a pure pass-through.
  lowCutFilter = ctx.createBiquadFilter()
  lowCutFilter.type = 'highpass'
  lowCutFilter.frequency.value = 0
  highCutFilter = ctx.createBiquadFilter()
  highCutFilter.type = 'lowpass'
  highCutFilter.frequency.value = ctx.sampleRate / 2

  // Saturation: a null curve is a pass-through, so drive 0 costs nothing.
  shaper = ctx.createWaveShaper()

  // User compressor - separate from the safety limiter at the end. Ratio 1
  // with a 0 dB threshold is a no-op (and its auto makeup gain works out to
  // unity), which is how it sits while switched off.
  compressor = ctx.createDynamicsCompressor()
  compressor.knee.value = 6
  compressor.threshold.value = 0
  compressor.ratio.value = 1

  // Stereo width: split → 2×2 gain matrix → merge. The splitter interprets
  // its input discretely, so a mono source would land in the left channel
  // only - widthIn upmixes to stereo first (copying mono to both sides).
  const widthIn = ctx.createGain()
  widthIn.channelCount = 2
  widthIn.channelCountMode = 'explicit'
  widthIn.channelInterpretation = 'speakers'
  const splitter = ctx.createChannelSplitter(2)
  const merger = ctx.createChannelMerger(2)
  widthDirect = [ctx.createGain(), ctx.createGain()]
  widthCross = [ctx.createGain(), ctx.createGain()]
  widthCross.forEach((g) => { g.gain.value = 0 })
  widthIn.connect(splitter)
  splitter.connect(widthDirect[0], 0); widthDirect[0].connect(merger, 0, 0)  // L → L
  splitter.connect(widthCross[0], 0); widthCross[0].connect(merger, 0, 1)    // L → R
  splitter.connect(widthCross[1], 1); widthCross[1].connect(merger, 0, 0)    // R → L
  splitter.connect(widthDirect[1], 1); widthDirect[1].connect(merger, 0, 1)  // R → R

  // 8D: a second panner whose pan is driven by a sine LFO (summed onto its
  // 0 base value). The oscillator runs for the graph's lifetime - they can't
  // be restarted once stopped - and "off" just zeroes its depth.
  autoPanner = ctx.createStereoPanner()
  autoPanLfo = ctx.createOscillator()
  autoPanLfo.type = 'sine'
  autoPanLfo.frequency.value = 1 / DEFAULT_FX.autoPanPeriod
  autoPanDepthGain = ctx.createGain()
  autoPanDepthGain.gain.value = 0
  autoPanLfo.connect(autoPanDepthGain)
  autoPanDepthGain.connect(autoPanner.pan)
  autoPanLfo.start()

  // Echo: a feedback delay on a send, added on top of the dry signal. A
  // low-pass inside the loop darkens each repeat a little more, tape-style,
  // so long feedback trails soften instead of ringing.
  echoSend = ctx.createGain()
  echoSend.gain.value = 0
  echoDelay = ctx.createDelay(2)
  echoDelay.delayTime.value = DEFAULT_FX.echoTime
  const echoDamp = ctx.createBiquadFilter()
  echoDamp.type = 'lowpass'
  echoDamp.frequency.value = 4500
  echoFeedbackGain = ctx.createGain()
  echoFeedbackGain.gain.value = 0
  echoWet = ctx.createGain()
  echoWet.gain.value = 0
  echoSend.connect(echoDelay)
  echoDelay.connect(echoDamp)
  echoDamp.connect(echoFeedbackGain)
  echoFeedbackGain.connect(echoDelay)
  echoDamp.connect(echoWet)

  let node: AudioNode = chainInput
  node.connect(preampGain); node = preampGain
  for (const f of bandFilters) { node.connect(f); node = f }
  node.connect(lowCutFilter)
  lowCutFilter.connect(highCutFilter)
  highCutFilter.connect(shaper)
  shaper.connect(compressor)
  compressor.connect(monoNode)
  monoNode.connect(widthIn)
  merger.connect(panner)
  panner.connect(autoPanner)
  autoPanner.connect(dryGain)
  autoPanner.connect(convolver)
  autoPanner.connect(echoSend)
  convolver.connect(wetGain)
  dryGain.connect(boostGain)
  wetGain.connect(boostGain)
  echoWet.connect(boostGain)
  boostGain.connect(limiter)
  limiter.connect(ctx.destination)

  applyAudioEffects(lastSettings)
  if (lastSinkId) setEffectsOutputDevice(lastSinkId)
  return ctx
}

// Routes an element through the shared chain. Safe to call repeatedly.
// Elements keep playing (unprocessed) if the Web Audio setup fails - and on
// mobile they deliberately stay unprocessed until setEffectsChainWanted().
export function attachAudioElement(el: HTMLAudioElement | null): void {
  if (!el || attachedEls.has(el)) return
  pendingEls.add(el)
  flushPendingAttachments()
}

function flushPendingAttachments(): void {
  if (pendingEls.size === 0) return
  const context = ensureGraph()
  if (!context || !chainInput) return
  for (const el of pendingEls) {
    try {
      context.createMediaElementSource(el).connect(chainInput)
      attachedEls.add(el)
    } catch (e) {
      console.error('attachAudioElement failed:', e)
    }
    pendingEls.delete(el)
  }
}

// Opts this session into the Web Audio chain on mobile, wiring up every element
// that registered before now. One-way by nature: a MediaElementSource can't be
// un-created, so an element routed once stays routed until the page reloads.
export function setEffectsChainWanted(wanted: boolean): void {
  if (!wanted || effectsWanted || !IS_MOBILE) return
  effectsWanted = true
  flushPendingAttachments()
}

export function applyAudioEffects(settings: AudioEffectSettings): void {
  lastSettings = settings
  if (!ctx || !panner || !monoNode) return
  const t = ctx.currentTime
  const clamp = (v: number): number => Math.max(-EQ_GAIN_LIMIT, Math.min(EQ_GAIN_LIMIT, v))
  bandFilters.forEach((f, i) => {
    const target = settings.eqEnabled ? clamp(settings.gains[i] ?? 0) : 0
    f.gain.setTargetAtTime(target, t, 0.05)
  })
  panner.pan.setTargetAtTime(Math.max(-1, Math.min(1, settings.balance)), t, 0.05)

  if (boostGain) {
    boostGain.gain.setTargetAtTime(Math.max(1, Math.min(EQ_BOOST_MAX, settings.boost || 1)), t, 0.05)
  }

  // Reverb dry/wet - equal-power crossfade so mid positions don't dip in
  // loudness and full-wet is actually reachable.
  if (dryGain && wetGain && convolver) {
    const mix = Math.max(0, Math.min(1, settings.reverbMix))
    const decay = Math.max(0.5, Math.min(10, settings.reverbDecay))
    if (mix > 0 && (!convolver.buffer || builtDecay !== decay)) {
      // Debounce IR rebuilds - a decay slider drag would otherwise allocate a
      // multi-second stereo buffer on every input event.
      if (decayRebuildTimer != null) clearTimeout(decayRebuildTimer)
      const immediate = !convolver.buffer  // first enable: build now, not in 200ms
      const rebuild = (): void => {
        decayRebuildTimer = null
        if (!ctx || !convolver) return
        convolver.buffer = buildImpulseResponse(ctx, decay)
        builtDecay = decay
      }
      if (immediate) rebuild()
      else decayRebuildTimer = window.setTimeout(rebuild, 200)
    }
    dryGain.gain.setTargetAtTime(Math.cos(mix * Math.PI / 2), t, 0.05)
    wetGain.gain.setTargetAtTime(Math.sin(mix * Math.PI / 2), t, 0.05)
  }

  if (settings.mono) {
    monoNode.channelCount = 1
    monoNode.channelCountMode = 'explicit'
  } else {
    monoNode.channelCountMode = 'max'
  }

  applyFx(sanitizeFx(settings.fx), settings.eqEnabled, t)
}

function applyFx(fx: AudioFx, eqEnabled: boolean, t: number): void {
  if (!ctx) return
  const ramp = (p: AudioParam, v: number): void => { p.setTargetAtTime(v, t, 0.05) }

  if (preampGain) ramp(preampGain.gain, eqEnabled ? Math.pow(10, fx.preamp / 20) : 1)

  if (lowCutFilter && highCutFilter) {
    ramp(lowCutFilter.frequency, fx.filter ? fx.lowCut : 0)
    ramp(highCutFilter.frequency, fx.filter ? fx.highCut : ctx.sampleRate / 2)
    ramp(lowCutFilter.Q, fx.filter ? fx.filterResonance : 0)
    ramp(highCutFilter.Q, fx.filter ? fx.filterResonance : 0)
  }

  // A curve swap can't ramp, so only rebuild when the drive actually moved.
  if (shaper && fx.drive !== builtDrive) {
    shaper.curve = fx.drive > 0 ? buildSaturationCurve(fx.drive) : null
    shaper.oversample = fx.drive > 0 ? '4x' : 'none'
    builtDrive = fx.drive
  }

  if (compressor) {
    ramp(compressor.threshold, fx.compressor ? fx.compThreshold : 0)
    ramp(compressor.ratio, fx.compressor ? fx.compRatio : 1)
    ramp(compressor.attack, fx.compAttack)
    ramp(compressor.release, fx.compRelease)
  }

  if (widthDirect.length === 2 && widthCross.length === 2) {
    const direct = (1 + fx.width) / 2
    const cross = (1 - fx.width) / 2
    widthDirect.forEach((g) => ramp(g.gain, direct))
    widthCross.forEach((g) => ramp(g.gain, cross))
  }

  if (autoPanLfo && autoPanDepthGain) {
    ramp(autoPanLfo.frequency, 1 / fx.autoPanPeriod)
    ramp(autoPanDepthGain.gain, fx.autoPan ? fx.autoPanDepth : 0)
  }

  if (echoSend && echoDelay && echoFeedbackGain && echoWet) {
    // Only the send follows the toggle: switching off stops feeding the loop
    // but leaves the return open, so the repeats already in flight trail off
    // naturally instead of being cut mid-tail.
    ramp(echoSend.gain, fx.echo ? 1 : 0)
    ramp(echoDelay.delayTime, fx.echoTime)
    ramp(echoFeedbackGain.gain, fx.echoFeedback)
    ramp(echoWet.gain, fx.echoMix)
  }
}

// Peak amplitude of the current mix (0..1), for skip-silence. Reads the
// element-volume-scaled signal, so callers must scale their threshold by the
// current volume. Returns 1 ("not silent") when the graph isn't running.
export function getCurrentPeak(): number {
  if (!analyser || !analyserBuf) return 1
  analyser.getFloatTimeDomainData(analyserBuf)
  let peak = 0
  for (let i = 0; i < analyserBuf.length; i++) {
    const v = Math.abs(analyserBuf[i])
    if (v > peak) peak = v
  }
  return peak
}

// The mixed player signal (pre-EQ, post element volume), for analysis taps
// like the fullscreen visualizer. Null while the graph isn't built - never on
// iOS, on Android not until an effect is switched on, on desktop not until the
// first play - so callers must
// cope without it rather than forcing the graph, which would cost background
// playback. Read-only by contract: connect analysers to it, never anything
// that reaches ctx.destination (that plays the audio twice and skips the EQ),
// and never call a bare disconnect() on it (that cuts the playback chain).
export function getAnalysisTap(): { ctx: AudioContext; node: AudioNode } | null {
  return ctx && chainInput ? { ctx, node: chainInput } : null
}

// Autoplay policies can leave a fresh context suspended - call on every
// play so audio never sits routed into a dead graph. On desktop the first
// call is also what builds the graph (see effectsWanted), so it has to come
// before the element's play().
export function resumeEffectsContext(): void {
  if (!IS_MOBILE && !effectsWanted) {
    effectsWanted = true
    flushPendingAttachments()
  }
  if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {})
}

// The output-device picker sets sinkId per <audio> element, but attached
// elements emit through the AudioContext now - mirror the choice here.
export function setEffectsOutputDevice(deviceId: string): void {
  lastSinkId = deviceId
  const c = ctx as (AudioContext & { setSinkId?: (id: string) => Promise<void> }) | null
  if (c?.setSinkId) c.setSinkId(deviceId || '').catch((e) => console.warn('AudioContext.setSinkId failed:', e))
}
