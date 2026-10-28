// Audio the Synced lyrics tool can seek exactly. Chromium seeks a variable
// bitrate MP3 by estimate, lands somewhere near, and then reports the time it
// was asked for, so after a jump (a picked line, R, J/L, the scrubber) the
// clock is off by however far it missed, and every stamp with it. Measured on
// 2026-10-26 with a VBR test file shaped like the catalogue's (Xing header,
// 1 MB cover tag): 11 of 12 jumps landed 0.1 to 1.7 s off, a different amount
// each time. Playing straight from the start stays right, and so do
// constant-bitrate files. A VBR MP3 is decoded once and played as 16-bit WAV
// instead, which seeks to the sample (all 12 within 0.01 s of each other).

/** Past this, a long file is decoded at half the sample rate to keep it small. */
const LONG_SEC = 8 * 60
/** Past this, it isn't decoded at all (a long session would take too much memory). */
const MAX_SEC = 20 * 60

const V1_KBPS = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]
const V2_KBPS = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160]
/** By the header's version bits: MPEG 2.5, reserved, MPEG 2, MPEG 1. */
const RATES = [[11025, 12000, 8000], [], [22050, 24000, 16000], [44100, 48000, 32000]]

interface Mp3Frame { len: number; samples: number; rate: number; kbps: number; v1: boolean; mono: boolean }

/** The MPEG layer III frame starting at `i`, if one does. */
function mp3FrameAt(b: Uint8Array, i: number): Mp3Frame | null {
  if (i + 4 > b.length || b[i] !== 0xff || (b[i + 1] & 0xe0) !== 0xe0) return null
  const version = (b[i + 1] >> 3) & 3
  const layer = (b[i + 1] >> 1) & 3
  const kbpsAt = b[i + 2] >> 4
  const rateAt = (b[i + 2] >> 2) & 3
  if (version === 1 || layer !== 1 || kbpsAt === 0 || kbpsAt === 15 || rateAt === 3) return null
  const v1 = version === 3
  const kbps = (v1 ? V1_KBPS : V2_KBPS)[kbpsAt]
  const rate = RATES[version][rateAt]
  const pad = (b[i + 2] >> 1) & 1
  return { len: Math.floor(((v1 ? 144000 : 72000) * kbps) / rate) + pad, samples: v1 ? 1152 : 576, rate, kbps, v1, mono: b[i + 3] >> 6 === 3 }
}

const ascii = (b: Uint8Array, from: number, to: number): string => String.fromCharCode(...b.subarray(from, to))

/** Walks an MP3's frames: whether its bitrate changes, and how long it is.
 *  Null when it isn't an MP3. */
export function scanMp3(b: Uint8Array): { variable: boolean; seconds: number } | null {
  let at = 0
  if (ascii(b, 0, 3) === 'ID3') at = 10 + (((b[6] & 127) << 21) | ((b[7] & 127) << 14) | ((b[8] & 127) << 7) | (b[9] & 127)) + (b[5] & 0x10 ? 10 : 0)
  // Padding can sit between the tag and the first frame; two frames in a row
  // tell a real one from a stray 0xFF.
  const look = Math.min(b.length, at + 64 * 1024)
  let first: Mp3Frame | null = null
  for (; at < look; at++) {
    first = mp3FrameAt(b, at)
    if (first && mp3FrameAt(b, at + first.len)) break
    first = null
  }
  if (!first) return null
  const start = at
  // The first frame can be a Xing, Info or VBRI header instead of audio.
  // LAME writes Xing for a variable bitrate and Info for a constant one.
  const side = first.v1 ? (first.mono ? 17 : 32) : first.mono ? 9 : 17
  const tag = ascii(b, at + 4 + side, at + 8 + side)
  const vbri = ascii(b, at + 36, at + 40) === 'VBRI'
  let variable = tag === 'Xing' || vbri
  if (tag === 'Xing' || tag === 'Info' || vbri) at += first.len
  let kbps = 0
  let samples = 0
  for (let f = mp3FrameAt(b, at); f; at += f.len, f = mp3FrameAt(b, at)) {
    if (kbps && f.kbps !== kbps) variable = true
    kbps = f.kbps
    samples += f.samples
  }
  // A walk stopped short by junk mid-file: the rest at the same bitrate.
  const walked = at - start
  return { variable, seconds: walked > 0 ? ((samples / first.rate) * (b.length - start)) / walked : 0 }
}

/** 16-bit PCM WAV of up to two channels. */
function wavOf(buf: AudioBuffer): Blob {
  const ch = Math.min(buf.numberOfChannels, 2)
  const n = buf.length
  const bytes = n * ch * 2
  const out = new ArrayBuffer(44 + bytes)
  const v = new DataView(out)
  const text = (at: number, s: string): void => { for (let i = 0; i < s.length; i++) v.setUint8(at + i, s.charCodeAt(i)) }
  text(0, 'RIFF'); v.setUint32(4, 36 + bytes, true); text(8, 'WAVE')
  text(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, ch, true)
  v.setUint32(24, buf.sampleRate, true); v.setUint32(28, buf.sampleRate * ch * 2, true); v.setUint16(32, ch * 2, true); v.setUint16(34, 16, true)
  text(36, 'data'); v.setUint32(40, bytes, true)
  const pcm = new Int16Array(out, 44)
  const chans = Array.from({ length: ch }, (_, c) => buf.getChannelData(c))
  for (let i = 0, k = 0; i < n; i++) {
    for (let c = 0; c < ch; c++) {
      const s = Math.max(-1, Math.min(1, chans[c][i]))
      pcm[k++] = s < 0 ? s * 0x8000 : s * 0x7fff
    }
  }
  return new Blob([out], { type: 'audio/wav' })
}

/** A WAV of `src` when seeking the original would put the clock off; null
 *  when it seeks fine as it is, is too long to hold decoded, or can't be read. */
export async function exactSeekAudio(src: string, signal?: AbortSignal): Promise<Blob | null> {
  const res = await fetch(src, { signal })
  if (!res.ok) return null
  const data = await res.arrayBuffer()
  const scan = scanMp3(new Uint8Array(data))
  if (!scan?.variable || scan.seconds > MAX_SEC) return null
  const decoded = await new OfflineAudioContext(2, 1, scan.seconds > LONG_SEC ? 22050 : 44100).decodeAudioData(data)
  return signal?.aborted ? null : wavOf(decoded)
}
