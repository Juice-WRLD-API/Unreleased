// Draws the edge light into a canvas with WebGL2: the light's own program for the look, then its sparks, added on
// top. Shared by the desktop's light windows, WRLD's Edge light and the light picker's previews.
import { RIM_VERTEX, SPARK_VERTEX, SPARK_FRAGMENT, lookFragment } from './shader'
import { LightEngine, type LightFrame, type LightStyle, type Meter } from './engine'
import { lookOf, tickerHeight } from './looks'

interface Program { p: WebGLProgram; uniforms: Record<string, WebGLUniformLocation | null> }

export class EdgeRenderer {
  gl: WebGL2RenderingContext
  looks = new Map<string, Program>()
  sparks: Program
  vao: WebGLVertexArrayObject | null
  words: WebGLTexture | null = null
  wordsFor: string | null = null
  /** The ticker strip's width in points, once drawn. */
  wordsWidth = 0

  /** Throws when WebGL2 isn't there or the light's programs don't build. */
  constructor(canvas: HTMLCanvasElement | OffscreenCanvas, options: WebGLContextAttributes = {}) {
    const gl = canvas.getContext('webgl2', {
      alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, powerPreference: 'low-power', ...options,
    }) as WebGL2RenderingContext | null
    if (!gl) throw new Error('WebGL2 is unavailable')
    this.gl = gl
    this.sparks = this.program(SPARK_VERTEX, SPARK_FRAGMENT, 'sparks')
    // No attributes: the vertices come from gl_VertexID.
    this.vao = gl.createVertexArray()
  }

  compile(type: number, source: string, name: string): WebGLShader {
    const gl = this.gl
    const shader = gl.createShader(type)!
    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(shader)
      console.error(`[light] shader ${name} failed:\n${log}`)
      throw new Error(`Shader ${name} failed`)
    }
    return shader
  }

  program(vertex: string, fragment: string, name: string): Program {
    const gl = this.gl
    const p = gl.createProgram()!
    gl.attachShader(p, this.compile(gl.VERTEX_SHADER, vertex, `${name} vertex`))
    gl.attachShader(p, this.compile(gl.FRAGMENT_SHADER, fragment, `${name} fragment`))
    gl.linkProgram(p)
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      console.error(`[light] program ${name} failed to link:\n${gl.getProgramInfoLog(p)}`)
      throw new Error(`Program ${name} failed`)
    }
    const uniforms: Program['uniforms'] = {}
    const count = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS) as number
    for (let i = 0; i < count; i++) {
      const info = gl.getActiveUniform(p, i)
      if (info) uniforms[info.name] = gl.getUniformLocation(p, info.name)
    }
    return { p, uniforms }
  }

  /** Each light's program, made the first time it's drawn: lights nobody picks cost nothing. */
  lookProgram(fn: string): Program {
    let found = this.looks.get(fn)
    if (!found) {
      found = this.program(RIM_VERTEX, lookFragment(fn), fn)
      this.looks.set(fn, found)
    }
    return found
  }

  /** The ticker's line, in white on black, two pixels a point; its strip's width in points, with a gap so a
   *  repeated line doesn't run into the next. Returns that width. */
  setWords(text: string, thickness: number): number {
    const height = tickerHeight(thickness)
    const key = `${text}|${height}`
    if (key === this.wordsFor) return this.wordsWidth
    this.wordsFor = key
    const gl = this.gl
    const scale = 2, paper = document.createElement('canvas')
    const g = paper.getContext('2d')!
    const font = `700 ${Math.round(height * 0.72 * scale)}px "Segoe UI", system-ui, sans-serif`
    g.font = font
    const gap = height * 2.4
    const width = Math.min(Math.ceil(g.measureText(text).width / scale + gap), 4000)
    paper.width = Math.max(Math.round(width * scale), 1)
    paper.height = Math.round(height * scale)
    g.font = font
    g.fillStyle = '#000'
    g.fillRect(0, 0, paper.width, paper.height)
    g.fillStyle = '#fff'
    g.textBaseline = 'middle'
    g.fillText(text, (gap / 2) * scale, paper.height / 2 + scale)
    this.words ??= gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, this.words)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, gl.RED, gl.UNSIGNED_BYTE, paper)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    this.wordsWidth = width
    return width
  }

  setUniforms(prog: Program, u: LightFrame): void {
    const gl = this.gl
    const l = prog.uniforms
    const set = (name: string, fn: (x: WebGLUniformLocation) => void): void => {
      const at = l[name]
      if (at !== undefined && at !== null) fn(at)
    }
    set('uSize', (x) => gl.uniform2f(x, u.size[0], u.size[1]))
    set('uColorA', (x) => gl.uniform3f(x, u.colorA[0], u.colorA[1], u.colorA[2]))
    set('uColorB', (x) => gl.uniform3f(x, u.colorB[0], u.colorB[1], u.colorB[2]))
    const singles: [string, keyof LightFrame][] = [['uScale', 'scale'], ['uWiggle', 'wiggle'], ['uHeadA', 'headA'], ['uHeadB', 'headB'],
      ['uSpan', 'span'], ['uThickness', 'thickness'], ['uGlow', 'glow'], ['uCorner', 'corner'], ['uBand', 'band'],
      ['uStill', 'still'], ['uPresence', 'presence'], ['uPulse', 'pulse'], ['uSwell', 'swell'], ['uTime', 'time'],
      ['uSparkle', 'sparkle'], ['uTaper', 'taper'], ['uLook', 'look'], ['uDrift', 'drift'], ['uBeat', 'beat'], ['uPlace', 'place']]
    for (const [name, key] of singles) set(name, (x) => gl.uniform1f(x, u[key] as number))
    const fours: [string, number[]][] = [['uDrops', u.drops], ['uDropAt', u.dropAt], ['uStrip', u.strip]]
    for (const [name, v] of fours) set(name, (x) => gl.uniform4f(x, v[0], v[1], v[2], v[3]))
    set('uWords', (x) => gl.uniform1i(x, 0))
  }

  static sparkInstances(size: [number, number]): number {
    const bend = Math.min(size[0], size[1]) * 0.2
    const total = 2 * (size[0] + size[1] - 4 * bend) + 2 * Math.PI * bend
    return 2 * Math.max(Math.floor(total / 48), 3) + 2
  }

  /** One frame into a viewport `width` × `height` device pixels (the whole canvas unless told). */
  draw(u: LightFrame, width: number, height: number, words: boolean): void {
    const gl = this.gl
    gl.viewport(0, 0, width, height)
    gl.disable(gl.BLEND)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.bindVertexArray(this.vao)
    const rim = this.lookProgram(u.fn)
    gl.useProgram(rim.p)
    if (this.words && words) { gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.words) }
    this.setUniforms(rim, u)
    gl.drawArrays(gl.TRIANGLES, 0, 24)
    if (u.sparkle > 0 && u.still < 0.5) {
      gl.enable(gl.BLEND)
      gl.blendFunc(gl.ONE, gl.ONE)
      gl.useProgram(this.sparks.p)
      this.setUniforms(this.sparks, u)
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, EdgeRenderer.sparkInstances(u.size))
    }
  }

  dispose(): void {
    const gl = this.gl
    for (const { p } of this.looks.values()) gl.deleteProgram(p)
    gl.deleteProgram(this.sparks.p)
    if (this.words) gl.deleteTexture(this.words)
    if (this.vao) gl.deleteVertexArray(this.vao)
    this.looks.clear()
  }
}

/** What a light needs from where it's shown, each frame. */
export interface LightFeed {
  style: () => LightStyle
  meter: () => Meter
  playing: () => boolean
  /** The line being sung, for the ticker. */
  ticker?: () => string
  /** How much bigger than the canvas the rim should read as (a small screen keeps its share of it). */
  fit?: () => number
  /** Pixels per point; the device's by default. */
  pixelRatio?: () => number
}

/** A canvas filled with the light, drawn only while it moves: at the light's own frame rate, and not at all once it
 *  rests. `wake` it when anything it shows changes. */
export class EdgeLight {
  canvas: HTMLCanvasElement
  renderer: EdgeRenderer
  engine = new LightEngine()
  feed: LightFeed
  timer = 0
  lastDraw = 0
  t0 = performance.now()
  disposed = false

  constructor(canvas: HTMLCanvasElement, feed: LightFeed) {
    this.canvas = canvas
    this.feed = feed
    this.renderer = new EdgeRenderer(canvas)
    canvas.addEventListener('webglcontextlost', this.onLost)
  }

  onLost = (event: Event): void => {
    event.preventDefault()
    this.stopLoop()
  }

  get now(): number { return (performance.now() - this.t0) / 1000 }

  /** Fade the light in (1) or out (0). */
  fadeTo(value: number): void {
    this.engine.fadeTo(value, this.now)
    this.wake()
  }

  resize(): number {
    const ratio = this.feed.pixelRatio?.() ?? (window.devicePixelRatio || 1)
    const w = Math.max(1, Math.round(this.canvas.clientWidth * ratio)), h = Math.max(1, Math.round(this.canvas.clientHeight * ratio))
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h }
    return ratio
  }

  draw(now: number): void {
    const ratio = this.resize()
    const style = this.feed.style()
    const fit = this.feed.fit?.() ?? 1
    const size: [number, number] = [this.canvas.clientWidth / fit, this.canvas.clientHeight / fit]
    const words = !!lookOf(style.look).words
    if (words) this.engine.tickerWidth = this.renderer.setWords(this.feed.ticker?.() || 'Unreleased', style.thickness)
    const u = this.engine.step(now, this.feed.meter(), this.feed.playing(), style, size, ratio * fit)
    this.renderer.draw(u, this.canvas.width, this.canvas.height, words)
    this.lastDraw = now
  }

  loop = (): void => {
    this.timer = 0
    if (this.disposed) return
    const now = this.now
    const style = this.feed.style()
    const playing = this.feed.playing()
    const rate = this.engine.frameRate(style, playing, now)
    if (now - this.lastDraw >= 1 / (rate || 60) - 0.004 || rate === 0) this.draw(now)
    if (this.engine.frameRate(style, playing, now) > 0) this.timer = requestAnimationFrame(this.loop)
  }

  /** Something changed: draw again, and keep going while the light moves. */
  wake(): void {
    if (!this.timer && !this.disposed && !this.renderer.gl.isContextLost()) this.timer = requestAnimationFrame(this.loop)
  }

  stopLoop(): void {
    cancelAnimationFrame(this.timer)
    this.timer = 0
  }

  dispose(): void {
    this.disposed = true
    this.stopLoop()
    this.canvas.removeEventListener('webglcontextlost', this.onLost)
    this.renderer.dispose()
  }
}
