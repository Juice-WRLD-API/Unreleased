// Shared Web Audio post-processing chain for every playable <audio> element
// (both Player slots + the 999FM element). Elements are routed through:
//
//   MediaElementSource → chainInput ─→ 10-band EQ → mono → balance → limiter → destination
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
// point where the trade is worth making. Desktop attaches eagerly as before.
let effectsWanted = !IS_MOBILE

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
let lastSettings: AudioEffectSettings = { eqEnabled: false, gains: FLAT_GAINS, balance: 0, mono: false, reverbMix: 0, reverbDecay: 3, boost: 1 }
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

  let node: AudioNode = chainInput
  for (const f of bandFilters) { node.connect(f); node = f }
  node.connect(monoNode)
  monoNode.connect(panner)
  panner.connect(dryGain)
  panner.connect(convolver)
  convolver.connect(wetGain)
  dryGain.connect(boostGain)
  wetGain.connect(boostGain)
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
  if (!wanted || effectsWanted) return
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

// Autoplay policies can leave a fresh context suspended - call on every
// play so audio never sits routed into a dead graph.
export function resumeEffectsContext(): void {
  if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {})
}

// The output-device picker sets sinkId per <audio> element, but attached
// elements emit through the AudioContext now - mirror the choice here.
export function setEffectsOutputDevice(deviceId: string): void {
  lastSinkId = deviceId
  const c = ctx as (AudioContext & { setSinkId?: (id: string) => Promise<void> }) | null
  if (c?.setSinkId) c.setSinkId(deviceId || '').catch((e) => console.warn('AudioContext.setSinkId failed:', e))
}
