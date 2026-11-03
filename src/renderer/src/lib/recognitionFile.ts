import { RECOGNITION_SECONDS, RECOGNITION_MAX_BYTES } from './recognitionContract'

/** Largest file decoded locally. Decoding at a low sample rate keeps a long
 * song within memory; anything bigger is almost always a long video. */
export const RECOGNITION_FILE_MAX_BYTES = 80 * 1024 * 1024
const DECODE_RATE = 22_050
export const WAVEFORM_BARS = 96

export interface DecodedRecognitionFile {
  name: string
  duration: number
  /** Mono samples at `sampleRate`. */
  samples: Float32Array
  sampleRate: number
  /** Normalised 0–1 peak per waveform bar. */
  peaks: number[]
  /** Start of the loudest RECOGNITION_SECONDS window, in seconds. */
  suggestedStart: number
}

export function mixToMono(channels: Float32Array[]): Float32Array {
  if (channels.length === 1) return channels[0]
  const mono = new Float32Array(channels[0].length)
  for (const channel of channels) for (let i = 0; i < mono.length; i++) mono[i] += channel[i] / channels.length
  return mono
}

export function computePeaks(samples: Float32Array, bars = WAVEFORM_BARS): number[] {
  const size = Math.max(1, Math.floor(samples.length / bars))
  const peaks: number[] = []
  for (let bar = 0; bar < bars; bar++) {
    let peak = 0
    const end = Math.min(samples.length, (bar + 1) * size)
    for (let i = bar * size; i < end; i++) { const value = Math.abs(samples[i]); if (value > peak) peak = value }
    peaks.push(peak)
  }
  const max = Math.max(...peaks, 1e-6)
  return peaks.map(peak => peak / max)
}

/** Vocals and full mixes fingerprint best, so pick the loudest window. Intros
 * and fades rarely win, which is the point. */
export function loudestStart(samples: Float32Array, sampleRate: number, seconds = RECOGNITION_SECONDS): number {
  const duration = samples.length / sampleRate
  if (duration <= seconds) return 0
  const energy: number[] = []
  for (let start = 0; start < samples.length; start += sampleRate) {
    let sum = 0
    const end = Math.min(samples.length, start + sampleRate)
    for (let i = start; i < end; i++) sum += samples[i] * samples[i]
    energy.push(sum)
  }
  const span = Math.min(energy.length, Math.ceil(seconds))
  let best = 0, bestSum = -1, sum = 0
  for (let i = 0; i < energy.length; i++) {
    sum += energy[i]
    if (i >= span) sum -= energy[i - span]
    const start = i - span + 1
    if (start >= 0 && start + seconds <= duration && sum > bestSum) { bestSum = sum; best = start }
  }
  return best
}

export function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buffer)
  const text = (offset: number, value: string) => { for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i)) }
  text(0, 'RIFF'); view.setUint32(4, 36 + samples.length * 2, true); text(8, 'WAVE')
  text(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true)
  text(36, 'data'); view.setUint32(40, samples.length * 2, true)
  for (let i = 0; i < samples.length; i++) {
    const value = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(44 + i * 2, value < 0 ? value * 0x8000 : value * 0x7fff, true)
  }
  return new Blob([buffer], { type: 'audio/wav' })
}

/** The selected window of a decoded file as an upload-ready WAV clip. */
export function sliceRecognitionClip(file: DecodedRecognitionFile, start: number, seconds = RECOGNITION_SECONDS): Blob {
  const from = Math.max(0, Math.floor(start * file.sampleRate))
  const to = Math.min(file.samples.length, from + Math.floor(seconds * file.sampleRate))
  return encodeWav(file.samples.subarray(from, to), file.sampleRate)
}

/** Decodes an audio or video file locally. Returns null when this runtime
 * cannot decode it but the raw file is small enough for the server to try. */
export async function decodeRecognitionFile(file: File, signal: AbortSignal): Promise<DecodedRecognitionFile | null> {
  if (!file.size) throw new Error('That file is empty. Choose another one.')
  if (file.size > RECOGNITION_FILE_MAX_BYTES) throw new Error('That file is too large. Choose one under 80 MB, or trim it first.')
  const data = await file.arrayBuffer()
  if (signal.aborted) throw new DOMException('Cancelled', 'AbortError')
  let audio: AudioBuffer
  try {
    // Offline contexts decode without an output device and resample as they go.
    audio = await new OfflineAudioContext(1, 1, DECODE_RATE).decodeAudioData(data)
  } catch {
    if (signal.aborted) throw new DOMException('Cancelled', 'AbortError')
    if (file.size <= RECOGNITION_MAX_BYTES) return null
    throw new Error('Could not read any audio from that file. Try an MP3, M4A, WAV, FLAC, Ogg, WebM or MP4.')
  }
  if (signal.aborted) throw new DOMException('Cancelled', 'AbortError')
  if (audio.duration < 3) throw new Error('That file is too short. Choose one that is at least 3 seconds long.')
  const samples = mixToMono(Array.from({ length: audio.numberOfChannels }, (_, i) => audio.getChannelData(i)))
  if (!samples.some(value => Math.abs(value) > 0.001)) throw new Error('That file is silent. Choose another one.')
  return {
    name: file.name, duration: audio.duration, samples, sampleRate: audio.sampleRate,
    peaks: computePeaks(samples), suggestedStart: loudestStart(samples, audio.sampleRate),
  }
}
