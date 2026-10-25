// Springs that feel like SwiftUI's and Core Animation's: given a perceptual duration and a bounce, a value springs to
// its target from wherever it is, carrying its speed when re-aimed. One shared frame loop steps every moving value
// and stops when all are at rest, so nothing runs between moves.

export interface Feel { duration: number; bounce: number }
export const feel = (duration: number, bounce: number): Feel => ({ duration, bounce })

export class Spring {
  value: number
  target: number
  velocity = 0
  k = 0
  c = 0
  moving = false

  constructor(value = 0) { this.value = value; this.target = value }

  /** Aims at `target`; `with` null jumps there. */
  to(target: number, motion: Feel | null): void {
    this.target = target
    if (!motion) { this.value = target; this.velocity = 0; this.moving = false; return }
    this.k = (2 * Math.PI / motion.duration) ** 2
    this.c = (1 - motion.bounce) * 4 * Math.PI / motion.duration
    if (Math.abs(this.value - target) > 1e-4 || Math.abs(this.velocity) > 1e-4) { this.moving = true; loop.wake() }
  }

  step(dt: number): boolean {
    if (!this.moving) return false
    const steps = Math.max(1, Math.ceil(dt / (1 / 240)))
    const h = dt / steps
    for (let i = 0; i < steps; i++) {
      const a = -this.k * (this.value - this.target) - this.c * this.velocity
      this.velocity += a * h
      this.value += this.velocity * h
    }
    const scale = Math.max(Math.abs(this.target), 1)
    if (Math.abs(this.value - this.target) < 1e-3 * scale && Math.abs(this.velocity) < 1e-2 * scale) {
      this.value = this.target
      this.velocity = 0
      this.moving = false
    }
    return true
  }
}

/** An eased glide from where a value is, re-aimed on every call: it trails a pointer without stopping. */
export class Glide {
  value: number
  from: number
  target: number
  t = 1
  duration = 0.14
  moving = false

  constructor(value = 0) { this.value = value; this.from = value; this.target = value }

  to(target: number, duration = 0.14): void {
    this.from = this.value
    this.target = target
    this.t = 0
    this.duration = duration
    this.moving = true
    loop.wake()
  }

  step(dt: number): boolean {
    if (!this.moving) return false
    this.t = Math.min(this.t + dt / this.duration, 1)
    const e = 1 - (1 - this.t) ** 3 // ease out
    this.value = this.from + (this.target - this.from) * e
    if (this.t >= 1) this.moving = false
    return true
  }
}

export interface Ticker { tick(dt: number): boolean }

/** The frame loop: owners register a `tick(dt)` that answers whether anything still moves. */
export const loop = {
  owners: new Set<Ticker>(),
  running: false,
  last: 0,
  add(owner: Ticker): void { this.owners.add(owner); this.wake() },
  remove(owner: Ticker): void { this.owners.delete(owner) },
  wake(): void {
    if (this.running) return
    this.running = true
    this.last = performance.now()
    requestAnimationFrame((t) => this.frame(t))
  },
  frame(now: number): void {
    const dt = Math.min(Math.max(now - this.last, 0) / 1000, 1 / 20)
    this.last = now
    let busy = false
    for (const owner of this.owners) if (owner.tick(dt)) busy = true
    if (busy) requestAnimationFrame((t) => this.frame(t))
    else this.running = false
  },
}
