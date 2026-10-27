import { FRAGMENTS, VERTEX } from "./shaders";
import { BINS } from "./audio";
import type { AudioFrame, RGB } from "./types";

const UNIFORMS = [
  "u_res", "u_time", "u_flow", "u_bass", "u_mid", "u_treble", "u_energy", "u_beat",
  "u_p0", "u_p1", "u_p2", "u_p3", "u_focus", "u_prot", "u_protS",
  "u_feather", "u_intensity", "u_oct", "u_spec", "u_rip",
] as const;

interface Program {
  prog: WebGLProgram;
  aPos: number;
  loc: Record<(typeof UNIFORMS)[number], WebGLUniformLocation | null>;
}

export interface GLInput {
  mode: string;
  frame: AudioFrame;
  pal: RGB[];
  time: number;
  /** Like time, but runs faster when the music is louder (see Visualizer.flow). */
  flow: number;
  /** Canvas-pixel focus, already flipped to GL's bottom-left origin. */
  focus: { x: number; y: number; r: number };
  /** Canvas-pixel rects [x0, y0, x1, y1], GL origin, plus strength. */
  protect: { rect: [number, number, number, number]; strength: number }[];
  feather: number;
  intensity: number;
  octaves: number;
  /** Recent beats, 4 floats each: angle, distance from the focus (in focus radii), age in seconds, strength. */
  ripples: Float32Array;
}

/** A program on its way: compiled and linked, not yet asked how that went. */
interface Build {
  prog: WebGLProgram;
  fs: WebGLShader;
  /** When it was started (ms). */
  at: number;
}

/**
 * Without KHR_parallel_shader_compile, how long a build is left before it's asked
 * how it went. The compile still runs in the browser's GPU process meanwhile, so
 * asking later waits for less of it.
 */
const BUILD_GRACE_MS = 50;

/** Where a mode's program is: ready to draw, still building, or failed (or the context is lost). */
export type ProgramStatus = "ready" | "building" | "failed";

/**
 * Shader-based renderer. `ok` is false if WebGL is unavailable. Draws into a
 * canvas on the page, or an offscreen one (the picker's, whose frames are
 * handed to its tiles).
 */
export class GLRenderer<C extends HTMLCanvasElement | OffscreenCanvas = HTMLCanvasElement> {
  readonly ok: boolean;
  private gl: WebGLRenderingContext | null = null;
  private buffer: WebGLBuffer | null = null;
  private tex: WebGLTexture | null = null;
  private specBytes = new Uint8Array(BINS);
  private programs = new Map<string, Program | null>();
  private builds = new Map<string, Build>();
  /** The vertex shader every mode shares, compiled once. */
  private vertex: WebGLShader | null = null;
  private parallel: KHR_parallel_shader_compile | null = null;

  /** When the context was lost (ms timestamp), or 0 while healthy. */
  lostAt = 0;

  constructor(readonly canvas: C) {
    let ok = false;
    try {
      this.gl = canvas.getContext("webgl", {
        alpha: true,
        premultipliedAlpha: true,
        antialias: false,
        depth: false,
        stencil: false,
        preserveDrawingBuffer: false,
      }) as WebGLRenderingContext | null;
      ok = !!this.gl && this.initResources();
    } catch (e) {
      console.warn("[viz] WebGL unavailable", e);
    }
    this.ok = ok;

    // A GPU driver reset kills every WebGL context. The context only comes back
    // if we preventDefault() here; without it the visualizer stays dead (and the
    // compositor can present a stale or white frame) for the rest of the session.
    const target = canvas as EventTarget;
    target.addEventListener("webglcontextlost", (e) => {
      e.preventDefault();
      this.lostAt = performance.now();
      this.forget();
    });
    target.addEventListener("webglcontextrestored", () => {
      this.lostAt = 0;
      this.forget();
      this.initResources();
    });
  }

  /** Every GL object died with the context. */
  private forget() {
    this.programs.clear();
    this.builds.clear();
    this.vertex = null;
  }

  private initResources(): boolean {
    const gl = this.gl;
    if (!gl) return false;
    this.buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    // One oversized triangle covers the viewport with no seam down the middle.
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);

    this.tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, BINS, 1, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, this.specBytes);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.parallel = gl.getExtension("KHR_parallel_shader_compile");
    return true;
  }

  get lost(): boolean {
    return this.lostAt !== 0 || !!this.gl?.isContextLost();
  }

  /**
   * Where a mode's program is; asking starts building it. Nothing waits on the
   * build: the shader compiles on the GPU's side while frames go on, and is only
   * asked how it went once it's done. Asking straight away, as this used to,
   * held the page still for the whole compile - a long one for a big shader.
   */
  status(mode: string): ProgramStatus {
    if (!this.ok || this.lost) return "failed";
    const built = this.programs.get(mode);
    if (built !== undefined) return built ? "ready" : "failed";
    const build = this.builds.get(mode) ?? this.startBuild(mode);
    if (!build) {
      this.programs.set(mode, null);
      return "failed";
    }
    const done = this.parallel
      ? this.gl!.getProgramParameter(build.prog, this.parallel.COMPLETION_STATUS_KHR)
      : performance.now() - build.at >= BUILD_GRACE_MS;
    if (!done) return "building";
    this.builds.delete(mode);
    const program = this.finish(build);
    this.programs.set(mode, program);
    return program ? "ready" : "failed";
  }

  /** Sizes the canvas to `width` x `height` CSS pixels at `scale`. */
  resize(width: number, height: number, scale: number): boolean {
    if (width === 0 || height === 0) return false;
    const w = Math.max(1, Math.floor(width * scale));
    const h = Math.max(1, Math.floor(height * scale));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    return true;
  }

  clear() {
    const gl = this.gl;
    if (!gl) return;
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  /**
   * Releases the context. Browsers cap live WebGL contexts (~16) and only evict
   * the oldest once a new one is requested, so a host that builds a renderer per
   * mount has to let go explicitly or repeated mounts start killing contexts.
   */
  dispose() {
    const gl = this.gl;
    if (!gl) return;
    this.gl = null;
    this.forget();
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  }

  private shader(type: number, src: string): WebGLShader | null {
    const gl = this.gl!;
    const sh = gl.createShader(type);
    if (!sh) return null;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    return sh;
  }

  /** Compiles and links a mode's program without asking how it went (see status). */
  private startBuild(mode: string): Build | null {
    const gl = this.gl;
    const frag = FRAGMENTS[mode];
    if (!gl || !frag) return null;
    this.vertex ??= this.shader(gl.VERTEX_SHADER, VERTEX);
    const fs = this.shader(gl.FRAGMENT_SHADER, frag);
    const prog = gl.createProgram();
    if (!this.vertex || !fs || !prog) return null;
    gl.attachShader(prog, this.vertex);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    const build = { prog, fs, at: performance.now() };
    this.builds.set(mode, build);
    return build;
  }

  /** A finished build's program and where its inputs are, or null with the reason logged. */
  private finish({ prog, fs }: Build): Program | null {
    const gl = this.gl!;
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      const broken = [this.vertex!, fs].find((sh) => !gl.getShaderParameter(sh, gl.COMPILE_STATUS));
      if (broken) console.warn("[viz] shader compile error:", gl.getShaderInfoLog(broken));
      else console.warn("[viz] program link error:", gl.getProgramInfoLog(prog));
      gl.deleteProgram(prog);
      gl.deleteShader(fs);
      return null;
    }
    // Kept by the program for as long as it lives.
    gl.deleteShader(fs);
    const loc = {} as Program["loc"];
    for (const u of UNIFORMS) {
      // Arrays resolve via their first element.
      loc[u] = gl.getUniformLocation(prog, u === "u_prot" || u === "u_protS" || u === "u_rip" ? `${u}[0]` : u);
    }
    return { prog, aPos: gl.getAttribLocation(prog, "a_pos"), loc };
  }

  /** Draws a frame of a mode whose program is ready (see status). False when it isn't, the canvas left as it was. */
  render(input: GLInput): boolean {
    const gl = this.gl;
    const p = this.programs.get(input.mode);
    if (!gl || !p) return false;

    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(p.prog);

    const f = input.frame;
    for (let i = 0; i < BINS; i++) this.specBytes[i] = Math.min(255, f.spec[i] * 255) | 0;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, BINS, 1, gl.LUMINANCE, gl.UNSIGNED_BYTE, this.specBytes);

    const L = p.loc;
    gl.uniform2f(L.u_res, this.canvas.width, this.canvas.height);
    gl.uniform1f(L.u_time, input.time);
    gl.uniform1f(L.u_flow, input.flow);
    gl.uniform1f(L.u_bass, f.bass);
    gl.uniform1f(L.u_mid, f.mid);
    gl.uniform1f(L.u_treble, f.treble);
    gl.uniform1f(L.u_energy, f.energy);
    gl.uniform1f(L.u_beat, f.beat);
    const pl = input.pal;
    const col = (c: RGB) => [c.r / 255, c.g / 255, c.b / 255] as const;
    gl.uniform3f(L.u_p0, ...col(pl[0]));
    gl.uniform3f(L.u_p1, ...col(pl[1 % pl.length]));
    gl.uniform3f(L.u_p2, ...col(pl[2 % pl.length]));
    gl.uniform3f(L.u_p3, ...col(pl[3 % pl.length]));
    gl.uniform3f(L.u_focus, input.focus.x, input.focus.y, input.focus.r);

    const rects = new Float32Array(16);
    const strengths = new Float32Array(4);
    input.protect.slice(0, 4).forEach((pr, i) => {
      rects.set(pr.rect, i * 4);
      strengths[i] = pr.strength;
    });
    gl.uniform4fv(L.u_prot, rects);
    gl.uniform1fv(L.u_protS, strengths);
    gl.uniform1f(L.u_feather, input.feather);
    gl.uniform1f(L.u_intensity, input.intensity);
    gl.uniform1i(L.u_oct, input.octaves);
    gl.uniform1i(L.u_spec, 0);
    if (L.u_rip) gl.uniform4fv(L.u_rip, input.ripples); // only the modes that declare it

    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.enableVertexAttribArray(p.aPos);
    gl.vertexAttribPointer(p.aPos, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    return true;
  }
}
