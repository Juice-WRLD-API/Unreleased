// Draws the edge light into a canvas with WebGL2: the light's own program for the look, then its sparks, added on
// top. Shared by the desktop's light windows, WRLD's Edge light and the light picker's previews.
import { RIM_VERTEX, SPARK_VERTEX, SPARK_FRAGMENT, lookFragment } from './shader'
import { LightEngine, type LightFrame, type LightStyle, type Meter } from './engine'
import { lookOf, tickerHeight } from './looks'

interface Program { p: WebGLProgram; uniforms: Record<string, WebGLUniformLocation | null> }
/** A look's program on its way: compiled and linked, not yet asked how that went. */
interface Build { p: WebGLProgram; fragment: WebGLShader; at: number }

/** Without KHR_parallel_shader_compile, how long a look's build is left before it's asked how it went: the compile runs
 *  in the browser's GPU process meanwhile, so asking later waits for less of it. */
const BUILD_GRACE_MS = 50

export class EdgeRenderer {
  gl: WebGL2RenderingContext
  /** Each look's program once built; null for one that failed. */
  looks = new Map<string, Program | null>()
  builds = new Map<string, Build>()
  /** The vertex shader every look shares, compiled once. */
  rimVertex: WebGLShader | null = null
  parallel: KHR_parallel_shader_compile | null
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
    this.parallel = gl.getExtension('KHR_parallel_shader_compile')
    this.sparks = this.program(SPARK_VERTEX, SPARK_FRAGMENT, 'sparks')
    // No attributes: the vertices come from gl_VertexID.
    this.vao = gl.createVertexArray()
  }

  shader(type: number, source: string): WebGLShader {
    const gl = this.gl
    const shader = gl.createShader(type)!
    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    return shader
  }

  compile(type: number, source: string, name: string): WebGLShader {
    const gl = this.gl
    const shader = this.shader(type, source)
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(shader)
      console.error(`[light] shader ${name} failed:\n${log}`)
      throw new Error(`Shader ${name} failed`)
    }
    return shader
  }

  /** A linked program's uniforms, or null with the reason logged when it didn't link. */
  finish(p: WebGLProgram, shaders: WebGLShader[], name: string): Program | null {
    const gl = this.gl
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      const broken = shaders.find((shader) => !gl.getShaderParameter(shader, gl.COMPILE_STATUS))
      if (broken) console.error(`[light] shader ${name} failed:\n${gl.getShaderInfoLog(broken)}`)
      else console.error(`[light] program ${name} failed to link:\n${gl.getProgramInfoLog(p)}`)
      gl.deleteProgram(p)
      return null
    }
    const uniforms: Program['uniforms'] = {}
    const count = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS) as number
    for (let i = 0; i < count; i++) {
      const info = gl.getActiveUniform(p, i)
      if (info) uniforms[info.name] = gl.getUniformLocation(p, info.name)
    }
    return { p, uniforms }
  }

  /** Built at once, throwing if it doesn't: the sparks, small, and the test of whether the light can show at all. */
  program(vertex: string, fragment: string, name: string): Program {
    const gl = this.gl
    const p = gl.createProgram()!
    const shaders = [this.compile(gl.VERTEX_SHADER, vertex, `${name} vertex`), this.compile(gl.FRAGMENT_SHADER, fragment, `${name} fragment`)]
    for (const shader of shaders) gl.attachShader(p, shader)
    gl.linkProgram(p)
    const found = this.finish(p, shaders, name)
    if (!found) throw new Error(`Program ${name} failed`)
    return found
  }

  /** Each light's program, built the first time it's asked for (lights nobody picks cost nothing), null until it's
   *  ready. Nothing waits on the build: every light's program holds every light's code, a long compile, so it runs on
   *  the GPU's side while frames go on and is only asked how it went once it's done. */
  lookProgram(fn: string): Program | null {
    const found = this.looks.get(fn)
    if (found !== undefined) return found
    const gl = this.gl
    let build = this.builds.get(fn)
    if (!build) {
      this.rimVertex ??= this.shader(gl.VERTEX_SHADER, RIM_VERTEX)
      const fragment = this.shader(gl.FRAGMENT_SHADER, lookFragment(fn))
      const p = gl.createProgram()!
      gl.attachShader(p, this.rimVertex)
      gl.attachShader(p, fragment)
      gl.linkProgram(p)
      build = { p, fragment, at: performance.now() }
      this.builds.set(fn, build)
    }
    const done = this.parallel
      ? gl.getProgramParameter(build.p, this.parallel.COMPLETION_STATUS_KHR) as boolean
      : performance.now() - build.at >= BUILD_GRACE_MS
    if (!done) return null
    this.builds.delete(fn)
    const program = this.finish(build.p, [this.rimVertex!, build.fragment], fn)
    gl.deleteShader(build.fragment)
    this.looks.set(fn, program)
    return program
  }

  /** A look's program still building. */
  get building(): boolean { return this.builds.size > 0 }

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

  /** One frame into a viewport `width` × `height` device pixels (the whole canvas unless told). False, the canvas left
   *  as it was, while the look's program is still building. */
  draw(u: LightFrame, width: number, height: number, words: boolean): boolean {
    const gl = this.gl
    const rim = this.lookProgram(u.fn)
    if (!rim) return false
    gl.viewport(0, 0, width, height)
    gl.disable(gl.BLEND)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.bindVertexArray(this.vao)
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
    return true
  }

  /** Lets go of the context too: a browser keeps only so many (~16), and once another is asked for it drops the oldest -
   *  which can be WRLD's visualizer's. */
  dispose(): void {
    const gl = this.gl
    for (const found of this.looks.values()) if (found) gl.deleteProgram(found.p)
    for (const { p, fragment } of this.builds.values()) { gl.deleteProgram(p); gl.deleteShader(fragment) }
    gl.deleteProgram(this.sparks.p)
    if (this.rimVertex) gl.deleteShader(this.rimVertex)
    if (this.words) gl.deleteTexture(this.words)
    if (this.vao) gl.deleteVertexArray(this.vao)
    this.looks.clear()
    this.builds.clear()
    gl.getExtension('WEBGL_lose_context')?.loseContext()
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
  /** Covered (a picker open over WRLD): nothing drawn, the last frame left up. */
  held = false

  constructor(canvas: HTMLCanvasElement, feed: LightFeed) {
    this.canvas = canvas
    this.feed = feed
    this.renderer = new EdgeRenderer(canvas)
    canvas.addEventListener('webglcontextlost', this.onLost)
    canvas.addEventListener('webglcontextrestored', this.onRestored)
  }

  onLost = (event: Event): void => {
    event.preventDefault()
    this.stopLoop()
  }

  /** The context back (a GPU reset, the PC waking): every program and texture went with the old one, so build them again. */
  onRestored = (): void => {
    if (this.disposed) return
    try {
      this.renderer = new EdgeRenderer(this.canvas)
    } catch (e) {
      console.warn('[light] could not rebuild after the context came back', e)
      return
    }
    this.wake()
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
    if (this.renderer.draw(u, this.canvas.width, this.canvas.height, words)) this.lastDraw = now
  }

  loop = (): void => {
    this.timer = 0
    if (this.disposed || this.held) return
    const now = this.now
    const style = this.feed.style()
    const playing = this.feed.playing()
    const rate = this.engine.frameRate(style, playing, now)
    if (now - this.lastDraw >= 1 / (rate || 60) - 0.004 || rate === 0) this.draw(now)
    // On while it moves, and while a look's program builds, to draw it once it's ready.
    if (this.engine.frameRate(style, playing, now) > 0 || this.renderer.building) this.timer = requestAnimationFrame(this.loop)
  }

  /** Something changed: draw again, and keep going while the light moves. */
  wake(): void {
    if (!this.timer && !this.disposed && !this.held && !this.renderer.gl.isContextLost()) this.timer = requestAnimationFrame(this.loop)
  }

  /** Holds the light still while something covers it, and lets it go on again. */
  setHeld(held: boolean): void {
    this.held = held
    if (held) this.stopLoop()
    else this.wake()
  }

  stopLoop(): void {
    cancelAnimationFrame(this.timer)
    this.timer = 0
  }

  dispose(): void {
    this.disposed = true
    this.stopLoop()
    this.canvas.removeEventListener('webglcontextlost', this.onLost)
    this.canvas.removeEventListener('webglcontextrestored', this.onRestored)
    this.renderer.dispose()
  }
}
