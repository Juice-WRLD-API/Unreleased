import { FRAGMENTS, VERTEX } from "./shaders";
import { BINS } from "./audio";
import type { AudioFrame, RGB } from "./types";

const UNIFORMS = [
  "u_res", "u_time", "u_bass", "u_mid", "u_treble", "u_energy", "u_beat",
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

/** Shader-based renderer. `ok` is false if WebGL is unavailable. */
export class GLRenderer {
  readonly ok: boolean;
  private gl: WebGLRenderingContext | null = null;
  private buffer: WebGLBuffer | null = null;
  private tex: WebGLTexture | null = null;
  private specBytes = new Uint8Array(BINS);
  private programs = new Map<string, Program | null>();

  /** When the context was lost (ms timestamp), or 0 while healthy. */
  lostAt = 0;

  constructor(readonly canvas: HTMLCanvasElement) {
    let ok = false;
    try {
      this.gl = canvas.getContext("webgl", {
        alpha: true,
        premultipliedAlpha: true,
        antialias: false,
        depth: false,
        stencil: false,
        preserveDrawingBuffer: false,
      });
      ok = !!this.gl && this.initResources();
    } catch (e) {
      console.warn("[viz] WebGL unavailable", e);
    }
    this.ok = ok;

    // A GPU driver reset kills every WebGL context. The context only comes back
    // if we preventDefault() here; without it the visualizer stays dead (and the
    // compositor can present a stale or white frame) for the rest of the session.
    canvas.addEventListener("webglcontextlost", (e) => {
      e.preventDefault();
      this.lostAt = performance.now();
      this.programs.clear(); // every GL object died with the context
    });
    canvas.addEventListener("webglcontextrestored", () => {
      this.lostAt = 0;
      this.programs.clear();
      this.initResources();
    });
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
    return true;
  }

  get lost(): boolean {
    return this.lostAt !== 0 || !!this.gl?.isContextLost();
  }

  /** True once a mode's shader has compiled; false if it failed or the context is lost. */
  supports(mode: string): boolean {
    return this.ok && !this.lost && this.program(mode) !== null;
  }

  resize(scale: number): boolean {
    const w = Math.max(1, Math.floor(this.canvas.clientWidth * scale));
    const h = Math.max(1, Math.floor(this.canvas.clientHeight * scale));
    if (this.canvas.clientWidth === 0 || this.canvas.clientHeight === 0) return false;
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
    this.programs.clear();
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  }

  private compile(type: number, src: string): WebGLShader | null {
    const gl = this.gl!;
    const sh = gl.createShader(type);
    if (!sh) return null;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      console.warn("[viz] shader compile error:", gl.getShaderInfoLog(sh));
      gl.deleteShader(sh);
      return null;
    }
    return sh;
  }

  private program(mode: string): Program | null {
    if (this.programs.has(mode)) return this.programs.get(mode)!;
    const gl = this.gl;
    const frag = FRAGMENTS[mode];
    let result: Program | null = null;
    if (gl && frag) {
      const vs = this.compile(gl.VERTEX_SHADER, VERTEX);
      const fs = this.compile(gl.FRAGMENT_SHADER, frag);
      if (vs && fs) {
        const prog = gl.createProgram()!;
        gl.attachShader(prog, vs);
        gl.attachShader(prog, fs);
        gl.linkProgram(prog);
        if (gl.getProgramParameter(prog, gl.LINK_STATUS)) {
          const loc = {} as Program["loc"];
          for (const u of UNIFORMS) {
            // Arrays resolve via their first element.
            loc[u] = gl.getUniformLocation(prog, u === "u_prot" || u === "u_protS" || u === "u_rip" ? `${u}[0]` : u);
          }
          result = { prog, aPos: gl.getAttribLocation(prog, "a_pos"), loc };
        } else {
          console.warn("[viz] program link error:", gl.getProgramInfoLog(prog));
        }
      }
    }
    this.programs.set(mode, result);
    return result;
  }

  render(input: GLInput) {
    const gl = this.gl;
    if (!gl) return;
    const p = this.program(input.mode);
    if (!p) return;

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
  }
}
