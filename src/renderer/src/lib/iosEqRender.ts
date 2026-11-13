// Equalizer for iOS, without Web Audio in the playback path.
//
// Routing an <audio> element through an AudioContext is what stops music on
// iOS when the phone locks (see EFFECTS_SUPPORTED). So the EQ is baked in
// ahead of time instead: the song's file is decoded, run through the same band
// filters in an OfflineAudioContext - which renders to memory and never opens
// an audio output - and handed back as a WAV the element plays natively.
//
// The cost is that a change is heard after a re-render rather than at once,
// and that only settings that can be rendered up front are covered: the bands
// and the preamp for now.

import { EQ_GAIN_LIMIT, createEqBandFilters, createSafetyLimiter, type AudioFx } from './audioEffects'

export interface IosEqSettings {
  gains: number[]
  preamp: number
}

// A decoded song and its render both sit in memory as 32-bit float while the
// render runs (~20 MB a minute, each), so long files play unprocessed.
const MAX_RENDER_SECONDS = 8 * 60

// What there is to render, or null when the EQ would change nothing.
export function iosEqSettings(s: { eqEnabled: boolean; eqGains: number[]; audioFx: AudioFx }): IosEqSettings | null {
  if (!s.eqEnabled) return null
  const preamp = s.audioFx?.preamp ?? 0
  if (preamp === 0 && !s.eqGains.some((g) => g !== 0)) return null
  return { gains: s.eqGains, preamp }
}

// Identifies a render: two songs rendered under the same key sound the same.
// '' means unprocessed.
export function iosEqKey(settings: IosEqSettings | null): string {
  return settings ? `${settings.preamp}|${settings.gains.join(',')}` : ''
}

function encodeWav(buffer: AudioBuffer): Blob {
  const channels = buffer.numberOfChannels
  const frames = buffer.length
  const dataBytes = frames * channels * 2
  const out = new ArrayBuffer(44 + dataBytes)
  const view = new DataView(out)
  const text = (offset: number, s: string): void => { for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i)) }
  text(0, 'RIFF'); view.setUint32(4, 36 + dataBytes, true); text(8, 'WAVE')
  text(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true)
  view.setUint16(22, channels, true); view.setUint32(24, buffer.sampleRate, true)
  view.setUint32(28, buffer.sampleRate * channels * 2, true)
  view.setUint16(32, channels * 2, true); view.setUint16(34, 16, true)
  text(36, 'data'); view.setUint32(40, dataBytes, true)
  // Every iOS device is little-endian, which is what WAV wants.
  const pcm = new Int16Array(out, 44)
  for (let ch = 0; ch < channels; ch++) {
    const data = buffer.getChannelData(ch)
    for (let i = 0, o = ch; i < frames; i++, o += channels) {
      const v = data[i]
      pcm[o] = v >= 1 ? 32767 : v <= -1 ? -32768 : Math.round(v * 32767)
    }
  }
  return new Blob([out], { type: 'audio/wav' })
}

// Renders `source` (a whole audio file) with the EQ applied. Rejects when the
// file can't be decoded, runs too long, or `signal` aborts along the way.
export async function renderIosEq(source: Blob, settings: IosEqSettings, signal?: AbortSignal): Promise<Blob> {
  const aborted = (): void => { if (signal?.aborted) throw new DOMException('Aborted', 'AbortError') }
  const bytes = await source.arrayBuffer()
  aborted()
  // decodeAudioData lives on a context; a one-frame offline one does.
  const decoded = await new OfflineAudioContext(2, 1, 44100).decodeAudioData(bytes)
  aborted()
  if (decoded.duration > MAX_RENDER_SECONDS) throw new Error('Too long to render')

  const ctx = new OfflineAudioContext(Math.min(2, decoded.numberOfChannels), decoded.length, decoded.sampleRate)
  const src = ctx.createBufferSource()
  src.buffer = decoded
  const preamp = ctx.createGain()
  preamp.gain.value = Math.pow(10, settings.preamp / 20)
  const bands = createEqBandFilters(ctx)
  bands.forEach((f, i) => {
    f.gain.value = Math.max(-EQ_GAIN_LIMIT, Math.min(EQ_GAIN_LIMIT, settings.gains[i] ?? 0))
  })
  let node: AudioNode = src
  for (const next of [preamp, ...bands, createSafetyLimiter(ctx)]) { node.connect(next); node = next }
  node.connect(ctx.destination)
  src.start()
  const rendered = await ctx.startRendering()
  aborted()
  return encodeWav(rendered)
}
