// The light's ears: the meter worklet on the app's own playback graph, at the point WRLD's visualizers tap
// (audioEffects' analysis tap), so it hears exactly what Unreleased plays and nothing else on the PC. It runs only
// while something listens.
import { getAnalysisTap } from '../lib/audioEffects'
import type { Meter } from './light/engine'

const SILENT: Meter = { decibels: -120, punch: 0 }
// A file of its own (public/desktop/): the CSP's script-src 'self' turns away a worklet inlined as a data: URL.
const workletUrl = (): string => new URL('desktop/meter-worklet.js', document.baseURI).href

type Listener = (meter: Meter) => void

/** Something listening to the graph, until stopped. */
interface Hearing { stop(): void }

const listeners = new Set<Listener>()
const loaded = new WeakMap<BaseAudioContext, Promise<void>>()
let hearing: Hearing | null = null
let starting = false
let latest: Meter = SILENT
let retry = 0

function loadWorklet(ctx: BaseAudioContext): Promise<void> {
  let ready = loaded.get(ctx)
  if (!ready) {
    ready = ctx.audioWorklet.addModule(workletUrl())
    loaded.set(ctx, ready)
  }
  return ready
}

/** A meter node with no outputs: the graph pulls it by itself, and nothing it hears can reach the speakers twice. */
async function meterNode(ctx: BaseAudioContext, onValue: Listener): Promise<AudioWorkletNode> {
  await loadWorklet(ctx)
  const meter = new AudioWorkletNode(ctx, 'desktop-meter', { numberOfInputs: 1, numberOfOutputs: 0 })
  meter.port.onmessage = (event: MessageEvent<Meter>) => onValue(event.data)
  return meter
}

/** The worklet's sums, for when the worklet can't be loaded: the same filters run on the page over what an
 *  analyser has heard since the last look. */
export class MeterMath {
  lp1 = 0
  lp2 = 0
  envelope = 0
  bassNow = 0
  bassUsual = 0
  decibels = -120
  punch = 0

  feed(samples: Float32Array, from: number, frames: number, sampleRate: number): Meter {
    if (frames <= 0) return { decibels: this.decibels, punch: this.punch }
    const c = 1 - Math.exp((-2 * Math.PI * 150) / sampleRate)
    let squares = 0, bassSquares = 0
    for (let i = from; i < from + frames; i++) {
      const v = samples[i]
      squares += v * v
      this.lp1 += c * (v - this.lp1)
      this.lp2 += c * (this.lp1 - this.lp2)
      bassSquares += this.lp2 * this.lp2
    }
    const rms = Math.sqrt(squares / frames)
    const bass = Math.sqrt(bassSquares / frames)
    const seconds = frames / sampleRate
    const step = (t: number): number => 1 - Math.exp(-seconds / t)
    this.envelope += (rms - this.envelope) * (rms > this.envelope ? step(0.005) : step(0.05))
    this.bassNow += (bass - this.bassNow) * (bass > this.bassNow ? step(0.004) : step(0.06))
    this.bassUsual += (bass - this.bassUsual) * step(1.2)
    this.decibels = Math.max(20 * Math.log10(Math.max(this.envelope, 1e-6)), -120)
    this.punch = this.bassUsual > 0.0005 ? this.bassNow / this.bassUsual : 0
    return { decibels: this.decibels, punch: this.punch }
  }
}

async function workletHearing(ctx: AudioContext, source: AudioNode, onValue: Listener): Promise<Hearing> {
  const meter = await meterNode(ctx, onValue)
  source.connect(meter)
  return {
    stop: () => {
      // Borrowed graph: only our own edge goes. A bare disconnect() would cut the playback chain.
      try { source.disconnect(meter) } catch { /* already gone */ }
      meter.port.close()
    },
  }
}

function analyserHearing(ctx: AudioContext, source: AudioNode, onValue: Listener): Hearing {
  const analyser = ctx.createAnalyser()
  analyser.fftSize = 2048
  source.connect(analyser)
  const buffer = new Float32Array(analyser.fftSize)
  const math = new MeterMath()
  let last = performance.now()
  const timer = window.setInterval(() => {
    const now = performance.now()
    const frames = Math.min(buffer.length, Math.round(((now - last) / 1000) * ctx.sampleRate))
    last = now
    analyser.getFloatTimeDomainData(buffer)
    onValue(math.feed(buffer, buffer.length - frames, frames, ctx.sampleRate))
  }, 16)
  return {
    stop: () => {
      window.clearInterval(timer)
      try { source.disconnect(analyser) } catch { /* already gone */ }
    },
  }
}

function publish(value: Meter): void {
  latest = value
  for (const fn of listeners) fn(value)
}

async function attach(): Promise<void> {
  window.clearTimeout(retry)
  if (hearing || starting || !listeners.size) return
  const tap = getAnalysisTap()
  // The graph is built on the first play: look again shortly.
  if (!tap) { retry = window.setTimeout(attach, 1500); return }
  starting = true
  try {
    hearing = await workletHearing(tap.ctx, tap.node, publish)
  } catch (e) {
    console.warn('[desktop] meter worklet unavailable, measuring on the page', e)
    hearing = analyserHearing(tap.ctx, tap.node, publish)
  } finally {
    starting = false
  }
  if (!listeners.size) detach()
}

function detach(): void {
  window.clearTimeout(retry)
  hearing?.stop()
  hearing = null
  publish(SILENT)
}

/** Hears what the app plays until the returned function is called. */
export function listenToMeter(fn: Listener): () => void {
  listeners.add(fn)
  void attach()
  return () => {
    listeners.delete(fn)
    if (!listeners.size) detach()
  }
}

export function latestMeter(): Meter {
  return latest
}
