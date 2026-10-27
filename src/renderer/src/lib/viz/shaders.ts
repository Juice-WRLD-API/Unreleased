/**
 * GLSL ES 1.0 fragment shaders (WebGL1, universally supported).
 *
 * Every mode shares PRELUDE: palette sampling, value-noise fbm with a
 * quality-controlled octave count, a spectrum texture, and `finish()`, which
 * backs the effect off around protected text regions and outputs premultiplied
 * alpha so dark areas turn transparent and the ambient artwork shows through.
 */

export const VERTEX = `
attribute vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

const PRELUDE = `
precision highp float;
uniform vec2 u_res;
uniform float u_time;
uniform float u_flow;      // a clock that runs faster when the music is louder
uniform float u_bass;
uniform float u_mid;
uniform float u_treble;
uniform float u_energy;
uniform float u_beat;
uniform vec3 u_p0;
uniform vec3 u_p1;
uniform vec3 u_p2;
uniform vec3 u_p3;
uniform vec3 u_focus;      // xy in canvas px (GL origin bottom-left), z = radius px
uniform vec4 u_prot[4];    // x0, y0, x1, y1 in canvas px
uniform float u_protS[4];  // strength per rect (0 = unused)
uniform float u_feather;
uniform float u_intensity;
uniform int u_oct;
uniform sampler2D u_spec;

const float PI = 3.14159265;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 7; i++) {
    if (i >= u_oct) break;
    v += a * noise(p);
    p = m * p;
    a *= 0.5;
  }
  return v;
}

// Smooth loop through the four palette colours.
vec3 pal(float t) {
  t = fract(t) * 4.0;
  if (t < 1.0) return mix(u_p0, u_p1, smoothstep(0.0, 1.0, t));
  if (t < 2.0) return mix(u_p1, u_p2, smoothstep(1.0, 2.0, t));
  if (t < 3.0) return mix(u_p2, u_p3, smoothstep(2.0, 3.0, t));
  return mix(u_p3, u_p0, smoothstep(3.0, 4.0, t));
}

float spec(float x) {
  return texture2D(u_spec, vec2(clamp(x, 0.0, 1.0), 0.5)).r;
}

// 0..1..0 triangle wave. Use this (not fract) for any repeating lookup: fract
// jumps from 1 back to 0, which shows up on screen as a hard seam.
float tri(float x) {
  return abs(fract(x) * 2.0 - 1.0);
}

float sdBox(vec2 p, vec4 r) {
  vec2 c = (r.xy + r.zw) * 0.5;
  vec2 h = (r.zw - r.xy) * 0.5;
  vec2 d = abs(p - c) - h;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}

float protect(vec2 p) {
  float m = 1.0;
  for (int i = 0; i < 4; i++) {
    if (u_protS[i] <= 0.0) continue;
    float d = sdBox(p, u_prot[i]);
    m *= 1.0 - u_protS[i] * (1.0 - smoothstep(0.0, u_feather, d));
  }
  return m;
}

vec4 finish(vec3 col) {
  col = max(col, 0.0) * u_intensity * protect(gl_FragCoord.xy);
  col = col / (1.0 + col * 0.35);               // soft shoulder, no harsh clipping
  float a = clamp(max(max(col.r, col.g), col.b) * 1.15, 0.0, 1.0);
  return vec4(col, a);                            // premultiplied
}

// finish() for modes with solid parts (silhouettes, a black hole's shadow):
// where solid is 1 the result is opaque, so the backdrop doesn't show
// through. Premultiplied colour over black keeps its rgb and gains alpha.
vec4 finishOver(vec3 col, float solid) {
  vec4 o = finish(col);
  return vec4(o.rgb, max(o.a, solid * protect(gl_FragCoord.xy) * u_intensity));
}
`;

/** Domain-warped fractal noise: a slow, cinematic colour field. */
const NEBULA = `
void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * u_res) / min(u_res.x, u_res.y);
  float t = u_time * 0.04;
  vec2 p = uv * 1.5;
  vec2 q = vec2(fbm(p + vec2(0.0, t)), fbm(p + vec2(5.2, 1.3) - t));
  float w = 1.8 + u_bass * 2.2 + u_beat * 0.6;
  vec2 r = vec2(fbm(p + w * q + vec2(1.7, 9.2) + 0.15 * t),
                fbm(p + w * q + vec2(8.3, 2.8) - 0.12 * t));
  float f = fbm(p + w * r);

  // Layer colours additively rather than mix(): mixing two palette colours in
  // RGB averages them toward grey-brown, which is what made this look muddy.
  vec3 body = pal(f * 0.9 + t * 0.5) * f * f * 2.8;
  vec3 veil = pal(r.x * 0.8 + 0.5 + t * 0.3) * smoothstep(0.35, 0.95, length(r)) * 0.7;
  vec3 glint = pal(q.y + 0.25) * pow(max(f - 0.5, 0.0), 2.0) * (3.0 + 4.0 * u_treble);
  vec3 col = (body + veil * f + glint) * (0.6 + 0.6 * u_energy + 0.45 * u_beat);
  col *= smoothstep(1.4, 0.2, length(uv));
  gl_FragColor = finish(col);
}
`;

/** Flowing ribbons of light with gaussian cores and soft halos. */
const SILK = `
void main() {
  vec2 uv = gl_FragCoord.xy / u_res.y;
  float asp = u_res.x / u_res.y;
  vec3 col = vec3(0.0);
  for (int i = 0; i < 6; i++) {
    float fi = float(i);
    float x = uv.x;
    float sp = spec(tri(x / asp * 0.85 + fi * 0.11));
    float y = 0.5 + (fi - 2.5) * 0.045
      + 0.16 * sin(x * (1.1 + 0.23 * fi) + u_time * (0.22 + 0.05 * fi) + fi * 1.9)
      + 0.07 * sin(x * (2.7 - 0.2 * fi) - u_time * (0.31 + 0.03 * fi))
      + (fbm(vec2(x * 0.9 + fi * 3.1, u_time * 0.07)) - 0.5) * 0.18
      + (sp - 0.2) * 0.12 * (0.5 + u_energy);
    float d = abs(uv.y - y);
    float thick = 0.0025 + 0.004 * sp + 0.003 * u_beat;
    float core = exp(-(d * d) / (thick * thick));
    float halo = exp(-d / (0.03 + 0.05 * u_energy)) * 0.35;
    col += pal(fi / 6.0 + x / asp * 0.35 + u_time * 0.02) * (core * 0.9 + halo) * (0.45 + 0.6 * sp);
  }
  float ex = uv.x / asp;
  col *= smoothstep(0.0, 0.12, ex) * smoothstep(1.0, 0.88, ex);
  gl_FragColor = finish(col);
}
`;

/** Spectrum-displaced ring orbiting the artwork, with rays and rotating arcs. */
const HALO = `
void main() {
  vec2 p = gl_FragCoord.xy - u_focus.xy;
  float R = max(u_focus.z, 20.0);
  float r = length(p);
  float a = atan(p.y, p.x);
  float an = abs(a) / PI;                         // mirrored 0..1 around the ring
  float s = spec(an * 0.9);
  float breathe = 1.0 + u_bass * 0.12 + u_beat * 0.07;
  float ring = R * 1.06 * breathe + s * R * 0.32;
  float d = r - ring;

  float k = d / (R * 0.012 + 1.5);
  float core = exp(-k * k);
  float glow = exp(-abs(d) / (R * 0.10)) * (0.35 + s * 0.9);

  float ring2 = R * 1.06 * breathe + R * 0.45 + spec(tri(an * 0.9 + 0.5)) * R * 0.25;
  float k2 = (r - ring2) / (R * 0.008 + 1.2);
  float core2 = exp(-k2 * k2) * 0.5;

  float arcs = pow(0.5 + 0.5 * sin(a * 3.0 + u_time * 0.5), 12.0);
  float streak = arcs * exp(-abs(d) / (R * 0.35)) * 0.8;

  float outside = smoothstep(ring, ring + R * 0.05, r);
  float rays = pow(0.5 + 0.5 * cos(a * 48.0 + u_time * 0.2), 30.0)
             * outside * exp(-(r - ring) / (R * (0.25 + s * 0.6))) * s * 1.4;

  vec3 c1 = pal(an * 0.8 + u_time * 0.03);
  vec3 c2 = pal(an * 0.8 + 0.5 + u_time * 0.03);
  vec3 col = c1 * (core * 1.3 + glow * 0.7) + c2 * (core2 + streak * 0.5) + c1 * rays;
  col *= 0.7 + 0.5 * u_energy;
  col += pal(u_time * 0.02) * exp(-max(r - R, 0.0) / (R * 0.9)) * 0.12 * (0.6 + u_bass);
  gl_FragColor = finish(col);
}
`;

/**
 * Solar corona: flame tongues licking out from the artwork's edge. Each
 * direction follows a slice of the spectrum, bass pushes the whole corona
 * outward and beats throw off flares. Everything is sized off the cover's
 * clearance radius, so it scales with the layout.
 */
const CORONA = `
void main() {
  vec2 p = gl_FragCoord.xy - u_focus.xy;
  float R = max(u_focus.z, 20.0);
  float r = length(p);
  float a = atan(p.y, p.x);
  float an = abs(a) / PI;                         // mirrored, so the spectrum wraps without a seam
  vec2 dir = p / max(r, 1.0);                     // the angle as a point on the circle, for seamless noise
  float x = r / R - 1.0;                          // 0 at the cover's clearance radius, growing outward
  float t = u_time * 0.3;

  float s = spec(an * 0.85);
  // Turbulence sampled on the circle and scrolled along the radius, so the
  // tongues keep drifting away from the cover.
  float n = fbm(dir * 2.2 + vec2(0.0, x * 2.0 - t));
  float n2 = fbm(dir * 4.8 + vec2(3.7, x * 3.2 - t * 1.7));

  float reach = 0.22 + s * 0.8 + u_bass * 0.25 + u_beat * 0.3;
  float edge = max(reach * (0.45 + 1.1 * n), 0.02);  // ragged outer boundary
  float inner = smoothstep(-0.04, 0.01, x);
  float past = smoothstep(0.0, edge, x);
  float tongues = clamp(n2 * 1.6 - 0.35, 0.0, 1.0);
  float flame = inner * (1.0 - past) * (0.55 + 1.5 * tongues);
  float wisps = inner * tongues * exp(-max(x, 0.0) / (edge * 1.6 + 0.05)) * 0.9;

  float k = x / 0.035;
  float rim = inner * exp(-k * k) * (0.8 + s);

  // Integer multiples of the angle, so these wrap cleanly at +-PI.
  float spokes = pow(0.5 + 0.5 * cos(a * 6.0 + t * 1.3), 24.0);
  float flare = spokes * u_beat * inner * exp(-max(x, 0.0) / (0.4 + s * 0.8)) * 1.6;
  float glow = inner * exp(-max(x, 0.0) / (0.5 + 0.4 * u_bass)) * 0.18;

  // Layered additively rather than mix()ed between two palette colours, which
  // averages toward grey (see NEBULA).
  vec3 c1 = pal(an * 0.7 + t * 0.04);
  vec3 c2 = pal(an * 0.7 + 0.5 + t * 0.04);
  vec3 col = c1 * flame + c2 * wisps + mix(c1, vec3(1.0), 0.4) * rim
           + mix(c1, vec3(1.0), 0.25) * flare + c2 * glow;
  col *= 0.75 + 0.5 * u_energy;
  gl_FragColor = finish(col);
}
`;

/**
 * Drops on a pond: every beat starts a ring at a random spot around the
 * artwork, and rings from different drops cross and interfere. A shader only
 * sees one frame, so the engine keeps the recent beats in u_rip.
 */
const RIPPLES = `
uniform vec4 u_rip[8];   // angle, distance (focus radii), age (s), strength (0 = unused)

void main() {
  vec2 frag = gl_FragCoord.xy;
  float R = max(u_focus.z, 20.0);
  float h = 0.0;                                   // summed wave height, where rings interfere
  vec3 col = vec3(0.0);
  for (int i = 0; i < 8; i++) {
    vec4 d = u_rip[i];
    if (d.w <= 0.0) continue;
    vec2 o = u_focus.xy + vec2(cos(d.x), sin(d.x)) * d.y * R;
    float age = d.z;
    float rr = age * R * 0.85;                     // travels ~0.85 radii per second
    float w = R * (0.028 + 0.04 * age);            // and spreads as it goes
    float k = (length(frag - o) - rr) / w;
    float wave = exp(-k * k) * cos(k * 2.6);       // a crest with a trough either side
    float amp = d.w * exp(-age * 0.7) * smoothstep(0.0, 0.08, age);
    h += wave * amp;
    col += pal(d.x / (2.0 * PI) + u_time * 0.02) * max(wave, 0.0) * amp;
  }
  // Where crests from different drops stack, the surface catches the light.
  float glint = pow(max(h - 0.4, 0.0), 1.5) * 2.2;
  col = col * 1.7 + pal(u_time * 0.03 + 0.5) * glint;
  // A faint still surface around the cover, so quiet passages aren't empty.
  float rc = length(frag - u_focus.xy) / R;
  col += pal(u_time * 0.02) * exp(-abs(rc - 1.05) * 6.0) * 0.08 * (0.6 + u_energy);
  col *= 0.8 + 0.4 * u_energy;
  gl_FragColor = finish(col);
}
`;

/**
 * A storm on each beat: bolts crack in from the edges of the screen - mostly
 * the top, sometimes a side - heading down and inward, forking more on bigger
 * hits, with a sheet flash behind them. Reuses
 * the beat memory Ripples reads (u_rip): each recent beat is a bolt for about
 * a second, and big hits throw a second one somewhere else.
 */
const LIGHTNING = `
uniform vec4 u_rip[8];   // recent beats: angle, distance (unused here), age (s), strength (0 = unused)

// A line through random heights at whole-number x, straight in between: sharp
// corners at uneven heights, which reads as lightning where a regular zig-zag
// reads as a sawtooth. (fract is safe here - it interpolates between vertices
// rather than repeating a lookup, so there's no seam.)
float jag(float x, float seed) {
  float i = floor(x);
  return mix(hash(vec2(i, seed)), hash(vec2(i + 1.0, seed)), fract(x)) - 0.5;
}

// Sideways offset of a bolt at distance u along it, in focus radii. Vertices
// are unevenly spaced (noise-warped x) and layered at three scales, and the
// whole path wanders further off course the longer it runs.
float pathOff(float u, float seed) {
  float x = u * 4.0 + noise(vec2(u * 1.7, seed)) * 1.6;
  float off = jag(x, seed) * 0.32 + jag(x * 2.6 + 3.1, seed + 7.0) * 0.12 + jag(x * 6.9, seed + 13.0) * 0.045;
  off += (noise(vec2(u * 0.7, seed + 2.0)) - 0.5) * 0.6 * u;
  return off * smoothstep(0.0, 0.2, u);
}

// Distance from q (bolt space: x along the bolt, y across) to a bolt of length len.
float bolt(vec2 q, float len, float seed) {
  float u = clamp(q.x, 0.0, len);
  return length(vec2(q.x - u, q.y - pathOff(u, seed)));
}

void main() {
  float R = max(u_focus.z, 20.0);
  vec2 p = (gl_FragCoord.xy - u_focus.xy) / R;   // in focus radii, relative to the cover
  vec3 col = vec3(0.0);
  float flash = 0.0;
  for (int i = 0; i < 8; i++) {
    vec4 d = u_rip[i];
    if (d.w <= 0.0 || d.z > 1.1) continue;
    float amp = d.w * exp(-d.z * 3.2) * (0.75 + 0.25 * sin(d.z * 60.0 + d.x * 5.0));
    flash += d.w * exp(-d.z * 7.0);

    for (int k = 0; k < 2; k++) {
      if (k == 1 && d.w < 0.75) break;             // big hits throw a second bolt
      float seed = fract(d.x * 7.13) * 10.0 + float(k) * 4.7;
      // Every bolt enters from just past an edge - mostly the top, sometimes a
      // side - so it cracks in from outside rather than appearing mid-screen.
      float edge = hash(vec2(seed, 9.0));
      float along = hash(vec2(seed, 3.0));
      float spread = hash(vec2(seed, 5.0)) - 0.5;
      vec2 sp;
      float ang;
      if (edge < 0.6) {
        sp = vec2(along * u_res.x, u_res.y + 10.0);
        ang = -PI * 0.5 + spread * 1.0;           // down
      } else if (edge < 0.8) {
        sp = vec2(-10.0, mix(0.4, 1.0, along) * u_res.y);
        ang = -PI * 0.2 + spread * 0.8;           // in from the left, falling
      } else {
        sp = vec2(u_res.x + 10.0, mix(0.4, 1.0, along) * u_res.y);
        ang = -PI * 0.8 + spread * 0.8;           // in from the right, falling
      }
      vec2 start = (sp - u_focus.xy) / R;
      float len = 2.2 + d.w * 3.0;
      vec2 dir = vec2(cos(ang), sin(ang));
      vec2 rel = p - start;
      vec2 q = vec2(dot(rel, dir), dot(rel, vec2(-dir.y, dir.x)));
      // Most of the screen is nowhere near a given bolt; skip it cheaply.
      if (abs(q.y) > len * 0.7 + 0.5 || q.x < -0.5 || q.x > len + 0.5) continue;

      float w = 0.02 + 0.016 * d.w;
      float taper = smoothstep(len, len * 0.45, q.x);
      float db = bolt(q, len, seed);
      float core = exp(-db / w) * taper;
      float glow = exp(-db / (w * 7.0)) * taper;

      // Forks: more of them, and longer, on bigger hits.
      for (int b = 0; b < 3; b++) {
        float fb = float(b);
        if (fb >= 1.0 + d.w * 2.0) break;
        float at = len * (0.22 + 0.2 * fb + 0.1 * hash(vec2(seed, fb + 20.0)));
        float fang = (mod(fb, 2.0) * 2.0 - 1.0) * (0.35 + 0.35 * hash(vec2(seed, fb)));
        vec2 r = q - vec2(at, pathOff(at, seed));
        float c = cos(fang);
        float s = sin(fang);
        vec2 qf = vec2(c * r.x + s * r.y, -s * r.x + c * r.y);
        float flen = len * (0.3 + 0.12 * d.w);
        float df = bolt(qf, flen, seed + fb * 3.3);
        float ft = smoothstep(flen, flen * 0.35, qf.x);
        core += exp(-df / (w * 0.7)) * 0.75 * ft;
        glow += exp(-df / (w * 5.0)) * 0.5 * ft;
      }

      vec3 tint = pal(seed * 0.1 + u_time * 0.02);
      col += (mix(tint, vec3(1.0), 0.75) * core * 1.6 + tint * glow * 0.55) * amp;
    }
  }
  float rc = length(p);
  col += pal(u_time * 0.02) * flash * 0.06;                                  // sheet flash across the sky
  col += pal(u_time * 0.02) * flash * exp(-max(rc - 1.0, 0.0) * 2.5) * 0.15;
  col += pal(u_time * 0.02 + 0.5) * exp(-abs(rc - 1.03) * 20.0) * 0.06;      // faint charge on the rim
  col *= 0.9 + 0.35 * u_energy;
  gl_FragColor = finish(col);
}
`;

/** Polar swirl spiralling out from the artwork. */
const VORTEX = `
void main() {
  float m = min(u_res.x, u_res.y);
  vec2 p = (gl_FragCoord.xy - u_focus.xy) / m;
  float rn = u_focus.z / m;
  float r = length(p);
  float a = atan(p.y, p.x);
  float t = u_time * 0.12;
  float sw = a + (0.55 + 0.35 * u_bass) / (r + 0.12) + t * 2.0;
  // Sample noise on a circle (cos/sin of the angle) so it wraps seamlessly;
  // feeding the raw angle in leaves a cut along the negative x-axis.
  float n = fbm(vec2(r * 4.0 - t * 3.0, 0.0) + vec2(cos(sw), sin(sw)) * 1.3);
  float arms = 0.5 + 0.5 * sin(sw * 5.0 + n * 4.0);
  float s = spec(tri(r * 1.4 - t * 0.5));
  float band = smoothstep(0.55, 1.0, arms) * (0.35 + s * 1.3);
  float fade = smoothstep(rn * 1.02, rn * 1.35, r) * smoothstep(1.4, 0.35, r);
  vec3 col = pal(r * 0.9 - t + n * 0.3) * band * fade;
  col += pal(t + 0.3) * pow(arms, 20.0) * fade * 0.6 * u_treble;
  col *= 0.8 + 0.5 * u_energy + 0.5 * u_beat;
  gl_FragColor = finish(col);
}
`;

/**
 * Metaballs orbiting the artwork. Each blob's size follows a slice of the
 * spectrum, and a central body hugging the cover lets them bridge and merge
 * into it. Colour is a weighted blend dominated by the nearest blob, so the
 * palette stays clean instead of averaging toward grey.
 */
const GOOEY = `
void main() {
  float m = min(u_res.x, u_res.y);
  vec2 p = (gl_FragCoord.xy - u_focus.xy) / m;
  float R = u_focus.z / m;
  int n = 4 + u_oct;
  float fn = float(n);
  float field = 0.0;
  vec3 acc = vec3(0.0);
  float wsum = 0.0;
  for (int i = 0; i < 12; i++) {
    if (i >= n) break;
    float fi = float(i);
    float h1 = hash(vec2(fi, 1.7));
    float h2 = hash(vec2(fi, 8.3));
    float s = spec(fi / fn * 0.85 + 0.03);
    float dir = mod(fi, 2.0) * 2.0 - 1.0;
    float ang = fi / fn * 2.0 * PI + u_time * (0.08 + 0.14 * h1) * dir;
    float orbit = R * (1.4 + 0.3 * sin(u_time * (0.25 + 0.35 * h2) + fi * 2.0))
                + R * (0.3 * s + 0.2 * u_beat);
    vec2 c = vec2(cos(ang), sin(ang)) * orbit;
    float rad = R * (0.14 + 0.24 * s + 0.05 * u_bass);
    vec2 d = p - c;
    float v = rad * rad / (dot(d, d) + 1e-5);
    field += v;
    float w = v * v * v;
    acc += pal(fi / fn + u_time * 0.02) * w;
    wsum += w;
  }
  // The body behind the cover, which the blobs melt into.
  float cr = R * (1.02 + 0.06 * u_bass + 0.04 * u_beat);
  float cv = cr * cr / (dot(p, p) + 1e-5);
  field += cv * 0.85;
  acc += pal(u_time * 0.03 + 0.5) * cv * cv * cv * 0.2;
  wsum += cv * cv * cv * 0.2;

  vec3 base = acc / max(wsum, 1e-6);
  float body = smoothstep(0.92, 1.04, field);
  float e = (field - 1.0) * 5.0;
  float rim = exp(-e * e);
  float depth = smoothstep(1.0, 3.5, field);
  float sheen = noise(p * 6.0 + u_time * 0.2);
  vec3 col = base * body * (0.5 + 0.35 * depth + 0.15 * sheen)
           + mix(base, vec3(1.0), 0.2) * rim * 0.8
           + base * smoothstep(0.6, 1.0, field) * (1.0 - body) * 0.25;
  col *= 0.8 + 0.4 * u_energy + 0.3 * u_beat;
  gl_FragColor = finish(col);
}
`;

/**
 * A downpour: three depths of slanted streaks that fall faster and heavier as
 * the track gets louder, brightening over their slice of the spectrum. Heavy
 * bass hits light the clouds up like thunder behind the rain.
 */
const RAIN = `
// One depth of rain at p (screen-height units). Space is cut into tall cells,
// columns staggered so the rows don't line up, each holding at most one
// streak. Returns its brightness; tint gets a per-drop random for colour.
float rainLayer(vec2 p, float cols, float rows, float speed, float len, float w, float seed, out float tint) {
  float cx = floor(p.x * cols);
  float v = (p.y + u_flow * speed) * rows + hash(vec2(cx, seed)) * 17.0;
  vec2 id = vec2(cx, floor(v)) + seed * 13.0;
  tint = hash(id + 5.3);
  // Louder passages wet more cells; the soft edge fades drops in rather than popping them.
  float h = hash(id);
  float wet = smoothstep(h - 0.08, h + 0.08, 0.15 + 0.65 * u_energy);
  float l = len * rows;                              // streak length in cell units, < 1
  float fy = fract(v) - hash(id + 7.7) * (1.0 - l);  // 0 at the head, l at the tail
  if (wet <= 0.0 || fy < 0.0 || fy > l) return 0.0;
  float dx = (fract(p.x * cols) - 0.2 - 0.6 * hash(id + 3.1)) / cols * u_res.y;  // canvas px
  float across = exp(-dx * dx / (w * w));
  float along = smoothstep(0.0, 0.05 * l, fy) * pow(1.0 - fy / l, 1.5);
  return across * along * wet;
}

void main() {
  vec2 p = gl_FragCoord.xy / u_res.y;
  float asp = u_res.x / u_res.y;
  float wind = 0.16 + 0.1 * sin(u_time * 0.11) + (noise(vec2(u_time * 0.35, 3.0)) - 0.5) * 0.16;
  // Thunder only on the heavier hits, so a busy hi-hat doesn't strobe the sky.
  float flash = u_beat * u_beat * smoothstep(0.3, 0.75, u_bass);
  float sp = spec(tri(p.x / asp) * 0.9);            // bass in the middle, highs at the sides
  vec3 col = vec3(0.0);
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float depth = 1.0 - fi * 0.33;                   // 1 near .. ~0.34 far
    vec2 q = vec2(p.x + (p.y - 0.5) * wind * (0.6 + 0.4 * depth) + fi * 0.37, p.y);
    float tint;
    float r = rainLayer(q, 12.0 + fi * 16.0, 3.0 + fi * 2.5, 0.75 + 0.85 * depth,
                        0.05 + 0.08 * depth, max(u_res.y * (0.0008 + 0.0014 * depth), 0.9), fi * 5.0, tint);
    vec3 c = mix(pal(tint * 0.5 + p.x / asp * 0.3 + u_time * 0.02), vec3(1.0), 0.35);
    col += c * r * depth * (0.45 + 0.9 * sp + 1.5 * flash);
  }
  float sky = smoothstep(0.1, 1.0, p.y);
  float cloud = fbm(vec2(p.x * 1.3 + u_time * 0.015, p.y * 2.2 - u_time * 0.01));
  col += pal(u_time * 0.02 + 0.5) * (0.15 + cloud * cloud * 1.6) * sky * flash * 0.5;  // the flash in the clouds
  col += pal(u_time * 0.02) * cloud * sky * 0.05 * (0.5 + u_energy);                      // and the clouds themselves
  col += pal(u_time * 0.03 + 0.25) * exp(-p.y * 7.0) * 0.08 * (0.5 + u_bass);            // spray where it lands
  col *= 0.85 + 0.3 * u_energy;
  gl_FragColor = finish(col);
}
`;

/**
 * A firework for every beat: each recent beat (the u_rip memory Ripples reads)
 * is a shell bursting somewhere in the sky, bigger on bigger hits. Sparks fly
 * out, slow, sag under gravity and twinkle out. They're found by angle rather
 * than looped over: a pixel only checks the spark in its own slice of the
 * burst and the two beside it.
 */
const FIREWORKS = `
uniform vec4 u_rip[8];   // recent beats: angle (seeds the shell), distance (unused), age (s), strength (0 = unused)

void main() {
  float m = min(u_res.x, u_res.y);
  vec2 frag = gl_FragCoord.xy;
  float w = max(m * 0.0022, 1.0);                   // spark width, px
  vec3 col = vec3(0.0);
  for (int i = 0; i < 8; i++) {
    vec4 d = u_rip[i];
    if (d.w <= 0.0 || d.z > 3.0) continue;
    float age = d.z;
    float seed = fract(d.x * 7.13) * 10.0;          // the angle is random per beat
    vec2 o = vec2(0.12 + 0.76 * hash(vec2(seed, 1.0)), 0.4 + 0.48 * hash(vec2(seed, 2.0))) * u_res;
    float size = m * (0.16 + 0.14 * min(d.w, 1.3)); // how far the fastest sparks get
    float g = size * 0.25;                          // gravity, px/s^2
    // Gravity pulls every spark down alike, so it just moves the burst's centre.
    vec2 q = frag - o + vec2(0.0, g * age * age);
    float r = length(q);
    if (r > size * 1.6) continue;
    float fade = d.w * exp(-age * 1.5) * smoothstep(0.0, 0.03, age);
    float n = floor(18.0 + 14.0 * hash(vec2(seed, 4.0)));  // sparks in this shell
    float k0 = floor(atan(q.y, q.x) / (2.0 * PI) * n + 0.5);
    float cool = smoothstep(0.05, 0.6, age);        // white-hot, cooling to colour
    vec3 tint = pal(seed * 0.17 + u_time * 0.01);
    vec3 hotA = mix(vec3(1.0), tint, cool);
    vec3 hotB = mix(vec3(1.0), pal(seed * 0.17 + 0.45), cool);
    for (int j = -1; j <= 1; j++) {
      float k = k0 + float(j);
      float kk = mod(k, n);                         // so the slices either side of the -PI/PI seam agree
      float hk = hash(vec2(kk, seed));
      float ang = (k + (hk - 0.5) * 0.6) / n * 2.0 * PI;
      vec2 dir = vec2(cos(ang), sin(ang));
      float v = size * (0.7 + 0.45 * hash(vec2(kk, seed + 3.0)));
      // Air drag: fast at first, coasting to a stop. The trail runs back to
      // where the spark was a moment ago, which had sagged less.
      float t0 = max(age - 0.18, 0.0);
      vec2 B = dir * v * (1.0 - exp(-age * 2.4));
      vec2 A = dir * v * (1.0 - exp(-t0 * 2.4)) + vec2(0.0, g * (age * age - t0 * t0));
      vec2 ba = B - A;
      float h = clamp(dot(q - A, ba) / max(dot(ba, ba), 1e-3), 0.0, 1.0);
      float dd = length(q - A - ba * h);
      float twinkle = mix(1.0, 0.5 + 0.5 * sin(age * 30.0 + hk * 40.0), smoothstep(0.7, 1.2, age));
      vec3 c = hk > 0.5 ? hotA : hotB;              // two-tone shells
      col += c * (exp(-dd * dd / (w * w)) * (0.3 + 0.7 * h) * 1.8 + exp(-dd / (w * 5.0)) * 0.3) * twinkle * fade;
    }
    col += mix(tint, vec3(1.0), 0.6) * exp(-r / (size * 0.1)) * exp(-age * 9.0) * d.w;  // the burst itself
    col += tint * exp(-r / (size * 0.6)) * 0.05 * fade;                                  // smoke it lights up
  }
  col *= 0.85 + 0.3 * u_energy;
  gl_FragColor = finish(col);
}
`;

/**
 * Sonar around the artwork: an arm sweeps round like a radar, faster when the
 * track is louder, leaving a wake; range rings drift outward and the scope's
 * rim follows the spectrum. Each beat (the u_rip memory Ripples reads) drops a
 * contact that pings out a ring and flares as the arm passes over it.
 */
const SONAR = `
uniform vec4 u_rip[8];   // recent beats: angle, distance (focus radii), age (s), strength (0 = unused)

void main() {
  vec2 p = gl_FragCoord.xy - u_focus.xy;
  float R = max(u_focus.z, 20.0);
  float r = length(p);
  float x = r / R;                                  // in focus radii
  float a = atan(p.y, p.x);
  float an = abs(a) / PI;
  float w = max(R * 0.006, 1.0);                    // line width, px
  float outside = smoothstep(1.0, 1.06, x);
  float reach = exp(-max(x - 1.0, 0.0) * 0.45);     // the scope dims toward its edge

  float sweep = u_flow * 1.2;
  float behind = mod(sweep - a, 2.0 * PI);          // how far the arm has gone past this angle
  float armD = min(behind, 2.0 * PI - behind) * r;  // px from the arm
  float arm = exp(-armD * armD / (w * w * 4.0));
  float wake = exp(-behind * 2.4) * (0.35 + 0.65 * spec(an * 0.9));

  // Range rings drifting outward, and spokes every 30 degrees (whole
  // multiples of the angle, so they wrap cleanly at +-PI).
  float rx = (x - 1.0) * 1.6 - u_flow * 0.12;
  float ringD = abs(fract(rx + 0.5) - 0.5) / 1.6 * R;
  float rings = exp(-ringD * ringD / (w * w)) * 0.35;
  float spokeD = abs(fract(a / (PI / 6.0) + 0.5) - 0.5) * (PI / 6.0) * r;
  float spokes = exp(-spokeD * spokeD / (w * w)) * 0.12;

  // The scope's rim, pushed out by the spectrum.
  float rk = (x - 1.08 - spec(an * 0.9) * 0.3 - u_bass * 0.05) * R / (w * 1.5);
  float rim = exp(-rk * rk);

  vec3 c1 = pal(u_time * 0.02);
  vec3 c2 = pal(u_time * 0.02 + 0.5);
  vec3 col = c1 * (arm * 1.2 + wake * 0.45) * reach * outside
           + c2 * (rings + spokes) * reach * outside * (0.6 + 0.6 * u_energy)
           + mix(c1, vec3(1.0), 0.3) * rim * (0.7 + 0.6 * u_beat);

  for (int i = 0; i < 8; i++) {
    vec4 d = u_rip[i];
    if (d.w <= 0.0) continue;
    float age = d.z;
    vec2 o = vec2(cos(d.x), sin(d.x)) * R * (1.35 + (d.y - 0.9) * 3.0);
    float dist = length(p - o);
    float lit = exp(-mod(sweep - d.x, 2.0 * PI) * 1.2);  // brightest just after the arm crosses it
    float life = d.w * exp(-age * 0.8) * smoothstep(0.0, 0.05, age);
    float br = R * 0.05;
    float blip = exp(-dist * dist / (br * br)) * life * (0.5 + 1.2 * lit);
    float pk = (dist - age * R * 0.7) / (w * 2.0);
    float ping = exp(-pk * pk) * d.w * exp(-age * 1.8);
    vec3 tint = pal(d.x / (2.0 * PI) + u_time * 0.02);
    col += mix(tint, vec3(1.0), 0.5) * blip + tint * ping * 0.8 + tint * exp(-dist / (R * 0.18)) * life * 0.25;
  }
  col *= 0.8 + 0.4 * u_energy;
  gl_FragColor = finish(col);
}
`;

/**
 * Embers off a fire below the frame: sparks ride a turbulent draught upward,
 * flickering and burning out as they climb, rising faster and thicker when the
 * track is louder. The fire's glow along the bottom follows the spectrum and
 * flares on bass hits.
 */
const EMBERS = `
void main() {
  vec2 p = gl_FragCoord.xy / u_res.y;
  float asp = u_res.x / u_res.y;
  vec3 col = vec3(0.0);
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float depth = 1.0 - fi * 0.3;
    float scale = 7.0 + fi * 6.0;                   // cells per screen height
    // Warp the whole field rather than moving each spark, so they weave
    // about without ever leaving their cells.
    vec2 q = p;
    q.x += (noise(vec2(p.y * 2.2 - u_flow * 0.25, fi * 7.0)) - 0.5) * 0.3
         + sin(p.y * 5.0 - u_time * 0.7 + fi * 2.0) * 0.02;
    q.y -= u_flow * (0.08 + 0.1 * depth);
    vec2 g = q * scale + fi * 19.3;
    vec2 id = floor(g);
    float h = hash(id);
    float live = smoothstep(h - 0.05, h + 0.05, 0.2 + 0.45 * u_energy);
    if (live <= 0.0) continue;
    vec2 c = 0.3 + 0.4 * vec2(hash(id + 1.3), hash(id + 4.7));
    vec2 off = (fract(g) - c) / scale;              // screen-height units
    float dist = length(off);
    float size = max((0.002 + 0.004 * hash(id + 9.1)) * depth, 1.0 / u_res.y);
    float flick = 0.6 + 0.4 * sin(u_time * (5.0 + 9.0 * h) + h * 60.0) * (0.3 + 0.7 * u_treble);
    float top = 0.4 + 0.65 * hash(id + 2.2);        // each burns out at its own height
    float burn = 1.0 - smoothstep(top * 0.4, top, p.y);
    // The core is drawn out upward by the climb; the glow stays round, as a
    // stretched one would reach the cell's edge and be clipped.
    float core = exp(-dot(off, off * vec2(1.0, 0.3)) / (size * size));
    float glow = exp(-dist / (size * 2.5)) * 0.35;
    vec3 tint = pal(h * 0.6 + u_time * 0.015);
    col += (mix(tint, vec3(1.0), 0.45) * core + tint * glow) * live * burn * flick * depth * (1.2 + 0.6 * u_beat);
  }
  // The fire's glow along the bottom, taller over the louder parts of the
  // spectrum (blurred, so neighbouring bins don't stripe it).
  float sx = tri(p.x / asp) * 0.9;
  float sp = (spec(sx - 0.03) + spec(sx) + spec(sx + 0.03)) / 3.0;
  float lick = fbm(vec2(p.x * 4.0, p.y * 3.0 - u_time * 0.8));
  float base = exp(-p.y / (0.06 + 0.16 * sp + 0.05 * u_bass)) * (0.5 + 0.7 * lick);
  col += pal(u_time * 0.02 + 0.1) * base * (0.25 + 0.4 * u_bass + 0.3 * u_beat);
  col *= 0.85 + 0.3 * u_energy;
  gl_FragColor = finish(col);
}
`;

/**
 * Hyperspace: stars stream out of the artwork as though flying into it,
 * faster and in longer streaks the louder the track is, with a lurch on each
 * beat. Stars live in log-polar cells around the cover (angle one way, log of
 * the distance the other), so they spread out and lengthen as they fly past.
 */
const WARP = `
void main() {
  vec2 p = gl_FragCoord.xy - u_focus.xy;
  float R = max(u_focus.z, 20.0);
  float r = max(length(p), 1.0);
  float a = atan(p.y, p.x);
  float lr = log(r / R);                            // 0 at the cover's edge
  float sp = spec(abs(a) / PI * 0.9);
  float px = max(min(u_res.x, u_res.y) * 0.0016, 1.0);
  float len = 0.05 + 0.3 * u_energy + 0.45 * u_beat;  // streak length, in log-distance
  vec3 col = vec3(0.0);
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float depth = 1.0 - fi * 0.3;
    float n = 70.0 + fi * 60.0;                     // cells around the circle (whole, so +-PI lines up)
    float rows = 1.3 + fi * 0.4;                    // cells per unit of log-distance
    float u = a / (2.0 * PI) * n;
    float cu = mod(floor(u), n);
    float v = (lr - u_flow * (0.6 - fi * 0.12)) * rows + hash(vec2(cu, fi)) * 9.0;
    vec2 id = vec2(cu, floor(v)) + fi * 31.0;
    float h = hash(id);
    if (h > 0.45) continue;
    float l = min(len * rows, 0.7);                 // in cells; the head sits high enough for it to fit
    float head = 0.75 + 0.2 * hash(id + 2.9);
    float fv = fract(v);
    float at = clamp(fv, head - l, head);
    float dRad = (fv - at) / rows * r;              // px, along the streak
    float cell = 2.0 * PI * r / n;                  // cell width, px
    float dTan = (fract(u) - 0.2 - 0.6 * hash(id + 6.1)) * cell;  // px, across it
    // Wider the further out (nearer the viewer), but never so wide its cell clips it.
    float wid = min(px * (0.7 + 1.3 * depth * clamp(lr * 0.5, 0.0, 1.0)), cell * 0.12);
    float star = exp(-(dRad * dRad + dTan * dTan) / (wid * wid)) * (0.25 + 0.75 * (1.0 - (head - at) / l));
    vec3 c = mix(pal(h * 2.0 + u_time * 0.02), vec3(1.0), 0.55);
    col += c * star * depth * (0.6 + 0.8 * sp) * smoothstep(0.0, 0.4, lr) * (0.8 + 0.6 * u_energy);
  }
  // Light pouring out from behind the cover.
  col += pal(u_time * 0.03) * exp(-max(lr, 0.0) * 2.5) * smoothstep(-0.05, 0.05, lr) * 0.18 * (0.5 + u_bass + 0.5 * u_beat);
  gl_FragColor = finish(col);
}
`;

/**
 * Concert lasers in haze: two banks below the frame fan beams up across the
 * screen, sweeping back and forth (faster when the track is louder), each
 * beam burning brighter with its slice of the spectrum. Beats kick the fans
 * wider, and the drifting haze is what the beams light up.
 */
const LASERS = `
void main() {
  vec2 frag = gl_FragCoord.xy;
  float m = min(u_res.x, u_res.y);
  float haze = 0.3 + fbm(frag / m * 2.0 + vec2(u_time * 0.05, -u_time * 0.03));
  float w = max(m * 0.0014, 1.0);
  vec3 col = vec3(0.0);
  for (int e = 0; e < 2; e++) {
    float fe = float(e);
    float side = fe * 2.0 - 1.0;                    // -1 left bank, +1 right
    vec2 rel = frag - vec2(u_res.x * (0.5 + side * 0.4), -m * 0.04);
    float sweep = sin(u_flow * 0.5 + fe * 2.1) * 0.25;  // the whole fan moves together
    for (int i = 0; i < 6; i++) {
      float fi = float(i);
      float s = spec(fi / 6.0 * 0.85 + fe * 0.04);
      // Tilted in toward the middle, more for each beam along the fan.
      float ang = PI * 0.5 + side * (0.12 + fi * 0.1 * (1.0 + 0.35 * u_beat))
                + sweep + sin(u_flow * (0.9 + 0.13 * fi) + fi * 1.3) * 0.06;
      vec2 dir = vec2(cos(ang), sin(ang));
      float along = dot(rel, dir);
      if (along <= 0.0) continue;
      float across = abs(rel.x * dir.y - rel.y * dir.x);
      float bw = w * (1.0 + along / m * 0.8);       // a little wider far from the bank
      float core = exp(-across * across / (bw * bw));
      float glow = exp(-across / (bw * 12.0));
      float bright = (0.15 + 0.5 * s + 1.4 * s * s) * (0.75 + 0.7 * u_beat) * exp(-along / (m * 1.8));
      vec3 c = pal(fi / 12.0 + fe * 0.5 + u_time * 0.02);
      col += (mix(c, vec3(1.0), 0.55) * core + c * glow * 0.45 * haze) * bright;
    }
  }
  col += pal(u_time * 0.02 + 0.25) * haze * 0.03 * (0.4 + u_bass);  // haze catching stray light
  col *= 0.85 + 0.3 * u_energy;
  gl_FragColor = finish(col);
}
`;

/**
 * Shared by the retro scenes (Synthwave and the ones after it): the striped
 * sun, stars, a horizon ridge, the perspective grid floor, palms and a
 * skyline, so they all look like parts of one world. Goes between PRELUDE and
 * the mode.
 */
const RETRO = `
// The horizon, drop focus radii below the cover so the sun sets behind it.
float horizonAt(float R, float drop) {
  return clamp(u_focus.y - R * drop, u_res.y * 0.15, u_res.y * 0.7);
}

// The sun centred behind the cover, its lower half cut by bands that widen
// as they slide down, plus its glow.
vec3 retroSun(vec2 frag, float R, float px, vec3 c1, vec3 c2) {
  float Rs = R * (1.3 + 0.05 * u_beat);
  float sd = length(frag - u_focus.xy);
  float sv = (u_focus.y - frag.y) / Rs;             // -1 at the top, 1 at the bottom
  float gapW = clamp((sv + 0.25) * 0.7, 0.0, 0.5);
  float g = fract(sv * 9.0 - u_flow * 0.5);
  float aa = 9.0 * px / Rs;
  float bands = mix(1.0, smoothstep(gapW - aa, gapW + aa, g) * (1.0 - smoothstep(1.0 - aa, 1.0, g)), smoothstep(0.0, aa * 2.0, gapW));
  float disc = 1.0 - smoothstep(Rs - px, Rs + px, sd);
  vec3 sunCol = mix(c1, c2, clamp(sv * 0.5 + 0.5, 0.0, 1.0));
  return mix(sunCol, vec3(1.0), 0.15) * disc * bands * (1.1 + 0.5 * u_beat)
       + sunCol * exp(-max(sd - Rs, 0.0) / (R * 0.5)) * 0.3 * (0.6 + 0.5 * u_bass + 0.5 * u_beat);
}

// Twinkling stars, fading out toward the horizon (up = px above it).
float retroStars(vec2 frag, float R, float px, float up) {
  vec2 sg = frag / (R * 0.3);
  vec2 sid = floor(sg);
  float st = length(fract(sg) - 0.25 - 0.5 * vec2(hash(sid + 1.7), hash(sid + 5.1))) * R * 0.3;
  return 0.9 * step(0.9, hash(sid)) * exp(-st * st / (px * px)) * smoothstep(R * 0.3, R * 1.5, up)
       * (0.4 + 0.4 * sin(u_time * (1.0 + 3.0 * hash(sid + 3.3)) + hash(sid) * 40.0));
}

// The spectrum at screen x (bass in the middle), blurred so neighbouring bins
// don't stripe whatever it shapes.
float retroSpec(float x) {
  float sx = tri(x / u_res.x) * 0.9;
  return (spec(sx - 0.02) + spec(sx) + spec(sx + 0.02)) / 3.0;
}

// Ridge height (px) at screen x: ridged noise for peaks, raised by the
// spectrum s, and kept low around the sun so it still shows.
float retroRidge(float x, float R, float s) {
  float h1 = 1.0 - abs(noise(vec2(x / R * 0.9, 2.0)) * 2.0 - 1.0);
  float h2 = 1.0 - abs(noise(vec2(x / R * 2.3, 7.0)) * 2.0 - 1.0);
  float side = smoothstep(R * 0.5, R * 2.2, abs(x - u_focus.x));
  return R * (0.06 + 0.34 * h1 * h1 + 0.1 * h2) * (0.6 + 0.8 * s) * (0.25 + 0.75 * side);
}

// Mountains along the horizon for a pixel up px above it: x = inside them,
// y = their neon edge, z = height up the slope (0..1) for shading.
vec3 retroMountains(vec2 frag, float up, float R, float px) {
  float s = retroSpec(frag.x);
  float ridge = retroRidge(frag.x, R, s);
  float slope = retroRidge(frag.x + 1.0, R, s) - ridge;
  float rimD = (up - ridge) / sqrt(1.0 + slope * slope);  // across the edge, so steep slopes don't thin it
  return vec3(1.0 - smoothstep(ridge - px, ridge + px, up), exp(-rimD * rimD / (px * px * 2.0)), up / max(ridge, 1.0));
}

// The floor in perspective for a pixel dx right of the vanishing point and dy
// below the horizon (px). Depth goes as 1/dy. Returns grid x across, depth z,
// and how much of each one pixel spans.
vec4 retroFloor(float dx, float dy, float px) {
  float F = u_res.y * 0.9;
  return vec4(dx / dy * 3.0, F / dy, px * 3.0 / dy * sqrt(1.0 + dx * dx / (dy * dy)), px * F / (dy * dy));
}

// One family of grid lines at coordinate c, where a pixel spans w of it.
// Lines closer than a few pixels fade to a dim average instead of moire.
float gridLines(float c, float w) {
  float l = abs(fract(c + 0.5) - 0.5);
  return mix(exp(-l * l / (w * w)) + exp(-l / (w * 3.0)) * 0.25, min(w * 3.3, 1.0) * 0.35, smoothstep(0.06, 0.25, w));
}

// Distance from p to segment a-b, and how far along it (0..1) the nearest point lies.
vec2 segT(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float t = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return vec2(length(pa - ba * t), t);
}

// A palm's silhouette as a signed distance in camera heights: foot at the
// origin, crown at y = 2.4 leaning right by lean. Fronds leave the crown
// fanned from nearly upright to level and sag under their own weight (droop
// adds to it, reach scales them); notched edges read as leaflets.
float palm(vec2 p, float lean, float droop, float reach) {
  vec2 top = vec2(lean, 2.4);
  vec2 mid = vec2(lean * 0.3, 1.25);
  vec2 t1 = segT(p, vec2(0.0), mid);
  vec2 t2 = segT(p, mid, top);
  float d = min(t1.x - mix(0.075, 0.06, t1.y), t2.x - mix(0.06, 0.045, t2.y));
  if (length(p - top) > 1.9 * reach) return d;     // nowhere near the crown
  for (int i = 0; i < 5; i++) {
    float fi = float(i);
    float th = 1.35 - fi * 0.33;                    // leaving angle, upright to level
    float L = (0.75 + 0.12 * fi) * reach;
    float sag = (0.25 + 0.18 * fi + droop) * L;     // lower fronds hang further
    for (int j = 0; j < 2; j++) {
      vec2 v = vec2((float(j) * 2.0 - 1.0) * cos(th), sin(th)) * L;
      // The curve top + v t - (0, sag t^2), in three straight pieces.
      vec2 a = top;
      for (int k = 1; k <= 3; k++) {
        float t = float(k) / 3.0;
        vec2 b = top + v * t - vec2(0.0, sag * t * t);
        vec2 st = segT(p, a, b);
        float u = (float(k) - 1.0 + st.y) / 3.0;    // 0 at the crown, 1 at the tip
        float w = (0.02 * (1.0 - u) + 0.075 * sin(PI * pow(u, 0.6))) * (0.78 + 0.22 * abs(sin(u * L * 110.0)));
        d = min(d, st.x - w);
        a = b;
      }
    }
  }
  return d;
}

// One row of buildings at screen x, up px above the waterline, sliding left
// by drift px. Returns x = inside a building, y = a lit window, z = the neon
// roofline, w = the building's random (for colour).
vec4 skyline(float x, float up, float R, float px, float wB, float tall, float lit, float seed, float drift) {
  float xx = x + drift;
  float b = floor(xx / wB);
  float fx = fract(xx / wB);
  float h = hash(vec2(b, seed));
  // Each building is one bar of the spectrum, lower around the sun.
  float cx = (b + 0.5) * wB - drift;
  float around = 0.3 + 0.7 * smoothstep(R * 0.4, R * 2.2, abs(cx - u_focus.x));
  float H = R * tall * (0.35 + 0.65 * h * h) * (0.55 + 0.9 * retroSpec(cx)) * around;
  float inset = 0.05 + 0.1 * hash(vec2(b, seed + 1.0));  // the gap either side
  float e = px / wB;
  float inX = smoothstep(inset - e, inset + e, fx) * (1.0 - smoothstep(1.0 - inset - e, 1.0 - inset + e, fx));
  float body = inX * (1.0 - smoothstep(H - px, H + px, up));
  float roof = (up - H) / px;
  // Windows in a grid on the facade: some lit, a few blinking.
  float cols = 3.0 + floor(h * 3.0);
  float floorH = R * 0.075;
  vec2 w = vec2((fx - inset) / (1.0 - 2.0 * inset) * cols, up / floorH);
  vec2 wid = floor(w) + vec2(b * 7.0, seed * 3.0);
  vec2 wf = abs(fract(w) - 0.5);
  float wh = hash(wid);
  float on = step(wh, lit) * mix(1.0, step(0.0, sin(u_time * (3.0 + wh * 8.0) + wh * 40.0)), step(0.93, hash(wid + 3.3)));
  float ex = px * cols / (wB * (1.0 - 2.0 * inset));
  float ey = px / floorH;
  float win = (1.0 - smoothstep(0.28 - ex, 0.28 + ex, wf.x)) * (1.0 - smoothstep(0.3 - ey, 0.3 + ey, wf.y))
            * on * body * step(floorH * 1.5, H - up);
  return vec4(body, win, exp(-roof * roof) * inX, h);
}

// The whole Synthwave scene at frag, its lines px wide (8-Bit draws it
// in blocks, so passes the block size).
vec3 synthwaveScene(vec2 frag, float px) {
  float R = max(u_focus.z, 20.0);
  float hz = horizonAt(R, 0.75);
  float dx = frag.x - u_focus.x;
  float dy = hz - frag.y;                           // px below the horizon
  vec3 cGrid = pal(0.75 + u_time * 0.01);
  vec3 cSun1 = pal(u_time * 0.01);
  vec3 cSun2 = pal(0.4 + u_time * 0.01);
  vec3 col = vec3(0.0);

  if (dy > 0.0) {
    vec4 f = retroFloor(dx, dy, px);                // x, z, and a pixel in each
    float grid = max(gridLines(f.y + u_flow * 1.6, f.w), gridLines(f.x, f.z));  // lines rush toward the viewer
    col += cGrid * grid * exp(-f.y * 0.09) * (0.9 + 0.7 * u_beat) * 1.2;          // the far floor fades into haze
    col += cGrid * exp(-dy / (R * 0.25)) * 0.25 * (0.6 + u_bass);                 // glow along the horizon
    col += cSun2 * exp(-abs(dx) / (R * 0.8)) * exp(-dy / (R * 0.6)) * 0.15 * (0.7 + u_beat);  // the sun on the floor
  } else {
    float up = -dy;                                 // px above the horizon
    vec3 m = retroMountains(frag, up, R, px);
    col += retroSun(frag, R, px, cSun1, cSun2);
    col += cSun2 * exp(-up / (R * 0.7)) * 0.18;     // the sky glowing above the horizon
    col += retroStars(frag, R, px, up);
    // Mountains stand in front of all of it: a dark body and a neon edge.
    col *= 1.0 - m.x;
    col += cGrid * (m.y * (1.0 + 0.4 * u_beat) + m.x * (0.04 + 0.08 * m.z));
  }
  return col;
}
`;

/**
 * Synthwave: a neon grid floor racing toward a striped sun that sets behind
 * the artwork, with a mountain ridge on the horizon that the spectrum pushes
 * up and down. The grid runs faster as the track gets louder; beats pulse the
 * sun and the grid.
 */
const SYNTHWAVE = `
void main() {
  vec3 col = synthwaveScene(gl_FragCoord.xy, max(u_res.y * 0.0016, 1.0));
  gl_FragColor = finish(col * (0.85 + 0.3 * u_energy));
}
`;

/**
 * Outrun: driving down a neon-edged road toward the setting sun, palm trees
 * sweeping past on both sides as solid black silhouettes. The road bends
 * gently left and right, the drive speeds up as the track gets louder, and
 * beats pulse the road and bounce the fronds.
 */
const OUTRUN = `
void main() {
  vec2 frag = gl_FragCoord.xy;
  float R = max(u_focus.z, 20.0);
  float px = max(u_res.y * 0.0016, 1.0);
  float F = u_res.y * 0.9;                          // focal length: depth z sits F/z px below the horizon
  float hz = horizonAt(R, 0.75);
  float dy = hz - frag.y;
  float bend = 0.02 * sin(u_time * 0.13);           // the road ahead curves by bend * z^2
  vec3 cGrid = pal(0.75 + u_time * 0.01);
  vec3 cSun1 = pal(u_time * 0.01);
  vec3 cSun2 = pal(0.4 + u_time * 0.01);
  vec3 col = vec3(0.0);

  if (dy > 0.0) {
    float z = F / dy;
    float fog = exp(-z * 0.09);
    float xc = (frag.x - u_focus.x) / dy - bend * z * z;  // camera heights across, from the road's centre
    float wxc = px / dy;                            // a pixel across, in camera heights
    float wz = px * F / (dy * dy);                  // and down the road
    float ax = abs(xc);
    float ew = max(0.035, wxc);
    float edge = exp(-(ax - 0.7) * (ax - 0.7) / (ew * ew)) * min(0.035 / wxc, 1.0);
    float dz = fract((z + u_flow * 2.2) * 0.4);
    float aa = wz * 0.4;
    float dash = exp(-xc * xc / (max(0.02, wxc) * max(0.02, wxc))) * min(0.02 / wxc, 1.0)
               * mix(1.0 - smoothstep(0.25 - aa, 0.25 + aa, abs(dz - 0.5)), 0.5, smoothstep(0.1, 0.4, aa));
    // Off the road, the grid floor (with the road's bend, so it runs alongside).
    float grid = max(gridLines(z + u_flow * 2.2, wz), gridLines(xc * 3.0, wxc * 3.0 * sqrt(1.0 + xc * xc)))
               * smoothstep(0.72, 0.85, ax);
    col += cGrid * (edge * (1.2 + 0.6 * u_bass + 0.6 * u_beat) + grid * 0.7 * (0.9 + 0.5 * u_beat)) * fog;
    col += mix(cSun1, vec3(1.0), 0.5) * dash * 0.8 * fog;
    col += cGrid * 0.03 * (1.0 - smoothstep(0.65, 0.7, ax)) * fog;                      // the tarmac
    col += cGrid * exp(-dy / (R * 0.25)) * 0.25 * (0.6 + u_bass);
    col += cSun2 * exp(-abs(frag.x - u_focus.x) / (R * 0.8)) * exp(-dy / (R * 0.6)) * 0.15 * (0.7 + u_beat);
  } else {
    float up = -dy;
    vec3 m = retroMountains(frag, up, R, px);
    col += retroSun(frag, R, px, cSun1, cSun2);
    col += cSun2 * exp(-up / (R * 0.7)) * 0.18;
    col += retroStars(frag, R, px, up);
    col *= 1.0 - m.x;
    col += cGrid * (m.y * (1.0 + 0.4 * u_beat) + m.x * (0.04 + 0.08 * m.z));
  }

  // Palms in two rows down the roadside, nearest first; only the nearest
  // edge matters, since they're all the same black.
  float travel = u_flow * 2.2;                      // camera heights driven
  float gap = 4.0;                                  // between palms
  float best = 1e6;
  float bestFog = 0.0;
  for (int k = 0; k < 8; k++) {
    float n = floor(travel / gap) + 1.0 + float(k);
    float z = n * gap - travel;
    if (z < 0.9) continue;
    float s = F / z;                                // px per camera height at that depth
    for (int j = 0; j < 2; j++) {
      float side = float(j) * 2.0 - 1.0;
      vec2 lp = (frag - vec2(u_focus.x + (side * 1.7 + bend * z * z) * s, hz - s)) / s;
      lp.x *= side;                                 // both rows lean away from the road
      float h = hash(vec2(n, side));
      float lean = 0.2 + 0.35 * h + 0.04 * sin(u_time * 0.8 + n);
      if (abs(lp.x - lean) > 1.7 || lp.y < -0.15 || lp.y > 3.25) continue;
      float d = palm(lp, lean, 0.12 * u_beat, 0.9 + 0.2 * h) * s;  // px
      if (d < best) {
        best = d;
        bestFog = exp(-z * 0.07);
      }
    }
  }
  float sil = clamp(0.5 - best / px, 0.0, 1.0);
  col *= 1.0 - sil;
  col += mix(cSun1, cGrid, 0.5) * exp(-best * best / (px * px * 1.5)) * bestFog * 0.5;  // a neon edge
  col *= 0.85 + 0.3 * u_energy;
  gl_FragColor = finishOver(col, sil * (0.55 + 0.45 * bestFog));
}
`;

/**
 * Neon City: a skyline against the setting sun, every building a bar of the
 * spectrum, with lit windows, neon rooftops and the whole scene rippling in
 * the water below. Two rows drift past at different speeds; the near row is
 * solid black, and beats light its windows up.
 */
const CITY = `
// The sun, sky and both rows of buildings at a point up px above the
// waterline. a = how solidly the near row covers it.
vec4 cityScene(vec2 frag, float up, float R, float px, vec3 cSun1, vec3 cSun2, vec3 cNeon) {
  vec3 col = retroSun(frag, R, px, cSun1, cSun2) + cSun2 * exp(-up / (R * 0.7)) * 0.18 + retroStars(frag, R, px, up);
  vec4 far = skyline(frag.x, up, R, px, R * 0.22, 1.9, 0.25 + 0.3 * u_mid, 11.0, u_flow * R * 0.03);
  col *= 1.0 - far.x;
  col += pal(far.w * 0.5 + 0.6) * far.x * 0.07 + mix(cSun1, vec3(1.0), 0.3) * far.y * 0.45 + cNeon * far.z * 0.6;
  vec4 near = skyline(frag.x, up, R, px, R * 0.42, 1.1, 0.2 + 0.35 * u_mid, 23.0, u_flow * R * 0.08);
  col *= 1.0 - near.x;
  col += mix(pal(near.w + 0.1), vec3(1.0), 0.4) * near.y * 0.9 * (1.0 + 0.4 * u_beat) + cNeon * near.z * (1.0 + 0.5 * u_beat);
  return vec4(col, near.x);
}

void main() {
  vec2 frag = gl_FragCoord.xy;
  float R = max(u_focus.z, 20.0);
  float px = max(u_res.y * 0.0016, 1.0);
  float hz = horizonAt(R, 0.9);
  vec3 cSun1 = pal(u_time * 0.01);
  vec3 cSun2 = pal(0.4 + u_time * 0.01);
  vec3 cNeon = pal(0.75 + u_time * 0.01);
  float up = frag.y - hz;
  vec3 col;
  float solid = 0.0;
  if (up >= 0.0) {
    vec4 c = cityScene(frag, up, R, px, cSun1, cSun2, cNeon);
    col = c.rgb;
    solid = c.a;
  } else {
    // The water: the scene mirrored, rippling more the further down it is,
    // and broken into horizontal streaks.
    float dw = -up;
    float wob = sin(dw / (px * 3.0) + u_time * 1.7 + sin(frag.x * 0.01)) * (px + dw * 0.04);
    vec4 c = cityScene(vec2(frag.x + wob, hz + dw), dw, R, px, cSun1, cSun2, cNeon);
    float streak = 0.55 + 0.45 * noise(vec2(frag.x / (R * 0.15), dw / (px * 2.5) - u_time * 0.8));
    col = c.rgb * 0.4 * streak * exp(-dw / (R * 1.8));
  }
  float wl = up / px;
  col += cNeon * exp(-wl * wl * 0.5) * 0.6 * (0.8 + 0.6 * u_bass);  // the waterline
  col *= 0.85 + 0.3 * u_energy;
  gl_FragColor = finishOver(col, solid);
}
`;

/**
 * Terrain: flying low over wireframe mountains toward the setting sun. Each
 * ridge line is a slice of the landscape, nearer ones hiding those behind;
 * the peaks rise with the spectrum, a valley down the middle keeps the sun in
 * view, and the flight speeds up as the track gets louder.
 */
const TERRAIN = `
void main() {
  vec2 frag = gl_FragCoord.xy;
  float R = max(u_focus.z, 20.0);
  float px = max(u_res.y * 0.0016, 1.0);
  float F = u_res.y * 0.9;
  float hz = horizonAt(R, 0.75);
  float up = frag.y - hz;
  vec3 cGrid = pal(0.75 + u_time * 0.01);
  vec3 cSun1 = pal(u_time * 0.01);
  vec3 cSun2 = pal(0.4 + u_time * 0.01);

  vec3 col = retroSun(frag, R, px, cSun1, cSun2) * step(0.0, up)
           + cSun2 * exp(-abs(up) / (R * 0.7)) * 0.18 + retroStars(frag, R, px, up);

  float s = retroSpec(frag.x);
  float spacing = 0.7;                              // camera heights between ridge lines
  float travel = u_flow * 1.4;
  float first = floor(travel / spacing) + 1.0;
  float cover = -1e6;                               // top of the nearer ridges at this x
  float lines = 0.0;
  float tint = 0.0;
  for (int i = 0; i < 36; i++) {
    float n = first + float(i);
    float z = n * spacing - travel;                 // nearest first
    if (z < 0.35) continue;
    float sc = F / z;                               // px per camera height at that depth
    float xc = (frag.x - u_focus.x) / sc;
    // Fixed to the ground (row n, position xc), so the land streams past
    // rather than boiling in place.
    float t = noise(vec2(xc * 1.3, n * 0.37)) * 0.65 + noise(vec2(xc * 3.1, n * 0.71 + 5.0)) * 0.35;
    float h = t * t * (0.25 + 1.1 * s) * smoothstep(0.25, 1.4, abs(xc)) * 0.9;
    float y = hz - sc + h * sc;
    float d = (frag.y - y) / (px * 1.2);
    float fog = exp(-z * 0.08);
    float seen = smoothstep(cover - px, cover + px, frag.y);  // not behind a nearer ridge
    float l = exp(-d * d) * fog * seen;
    lines += l;
    tint += l * fog;
    cover = max(cover, y);
  }
  float inside = 1.0 - smoothstep(cover - px, cover + px, frag.y);
  col *= 1.0 - inside;                              // the land hides the sky behind it
  col += mix(cSun2, cGrid, clamp(tint / max(lines, 1e-3), 0.0, 1.0)) * lines * (1.0 + 0.6 * u_beat);
  col += cGrid * inside * 0.03;
  col *= 0.85 + 0.3 * u_energy;
  gl_FragColor = finish(col);
}
`;

/**
 * Grid Tunnel: racing down a square neon tunnel toward the artwork. Rings
 * rush past faster when the track is louder, each lighting up with its band
 * of the spectrum as it goes (bass nearest), and the tunnel slowly rolls.
 */
const TUNNEL = `
void main() {
  vec2 q = gl_FragCoord.xy - u_focus.xy;
  float R = max(u_focus.z, 20.0);
  float px = max(u_res.y * 0.0016, 1.0);
  float ang = u_time * 0.05;
  vec2 p = vec2(cos(ang) * q.x - sin(ang) * q.y, sin(ang) * q.x + cos(ang) * q.y);
  float m = max(max(abs(p.x), abs(p.y)), 1.0);     // a square tunnel: depth goes as 1/distance to the axis
  float W = R * 5.0;
  float z = W / m;
  float u = abs(p.x) > abs(p.y) ? p.y / abs(p.x) : p.x / abs(p.y);  // across a wall, -1..1 corner to corner
  float rings = gridLines(z * 2.0 + u_flow * 3.0, px * W / (m * m) * 2.0);
  float rails = gridLines(u * 4.0, px * 4.0 / m);
  // Each ring lights with its band as it passes: bass close up, highs deep in.
  float band = spec(clamp((z - 1.2) / 5.0, 0.0, 1.0) * 0.9);
  float fog = exp(-z * 0.12);
  vec3 c = pal(abs(atan(p.y, p.x)) / PI * 0.5 + u_time * 0.01);
  vec3 col = c * (rings * (0.4 + 1.4 * band) + rails * 0.6) * fog * (0.9 + 0.6 * u_beat) * 1.2;
  col += pal(u_time * 0.02 + 0.5) * exp(-max(m - R, 0.0) / (R * 0.8)) * 0.2 * (0.6 + u_bass);  // light at the end
  col *= 0.85 + 0.3 * u_energy;
  gl_FragColor = finish(col);
}
`;

/**
 * Retro Planet: a ringed wireframe planet rising behind the artwork over the
 * neon grid, slowly turning. Its rings are the spectrum (bass on the inside),
 * passing in front of the planet below and behind it above; beats flash the
 * wireframe.
 */
const PLANET = `
void main() {
  vec2 frag = gl_FragCoord.xy;
  float R = max(u_focus.z, 20.0);
  float px = max(u_res.y * 0.0016, 1.0);
  float hz = horizonAt(R, 0.75);
  float dy = hz - frag.y;
  vec3 c1 = pal(u_time * 0.01);
  vec3 c2 = pal(0.4 + u_time * 0.01);
  vec3 cGrid = pal(0.75 + u_time * 0.01);
  vec3 col = vec3(0.0);

  if (dy > 0.0) {
    vec4 f = retroFloor(frag.x - u_focus.x, dy, px);
    float grid = max(gridLines(f.y + u_flow * 1.6, f.w), gridLines(f.x, f.z));
    col += cGrid * grid * exp(-f.y * 0.09) * (0.9 + 0.7 * u_beat) * 1.2;
    col += cGrid * exp(-dy / (R * 0.25)) * 0.25 * (0.6 + u_bass);
    col += c1 * exp(-abs(frag.x - u_focus.x) / (R * 0.9)) * exp(-dy / (R * 0.6)) * 0.12;
  } else {
    float up = -dy;
    col += retroStars(frag, R, px, up) + c2 * exp(-up / (R * 0.7)) * 0.15;

    // The planet's frame: tilted, and seen from a little above its equator.
    float Rp = R * 1.45;
    vec2 q = (frag - u_focus.xy) / Rp;
    vec2 t = vec2(0.95 * q.x + 0.31 * q.y, 0.95 * q.y - 0.31 * q.x);
    float r = length(t);
    float se = 0.3;                                 // sine of the view's elevation over the rings
    float ce = 0.954;
    float e = px / Rp;                              // a pixel, in planet radii
    float disc = 1.0 - smoothstep(1.0 - e, 1.0 + e, r);

    vec3 body = vec3(0.0);
    if (r < 1.0 + e) {
      // The sphere point under this pixel, turned into the planet's own frame.
      float nz = sqrt(max(1.0 - r * r, 0.0));
      float py = t.y * ce + nz * se;
      float pz = nz * ce - t.y * se;
      float lat = asin(clamp(py, -1.0, 1.0));
      float lon = atan(pz, t.x) + u_time * 0.15;
      // Whole multiples of the angle, so longitude lines meet at the seam.
      float wl = e / max(nz, 0.12) * 12.0 / PI;
      float wire = max(gridLines(lat / (PI / 12.0), wl), gridLines(lon / (PI / 12.0), wl / max(sqrt(1.0 - py * py), 0.15)));
      float bands = 0.5 + 0.5 * sin(lat * 14.0 + fbm(vec2(lon * 1.5, lat * 6.0)) * 3.0);
      body = mix(c1, c2, bands) * (0.08 + 0.14 * nz)
           + cGrid * wire * (0.35 + 0.65 * nz) * (0.8 + 0.8 * u_beat)
           + c1 * exp(-nz / 0.12) * 0.5;            // the atmosphere at the limb
    }
    col = col * (1.0 - disc) + body * disc;
    col += c1 * exp(-max(r - 1.0, 0.0) * Rp / (R * 0.15)) * 0.35 * (1.0 - disc) * (0.6 + 0.6 * u_bass);

    // The rings: the equatorial plane squashed by se, each radius a band of
    // the spectrum. The near (lower) half crosses the planet; the far half is behind it.
    float rho = length(vec2(t.x, t.y / se));
    float rt = rho - 1.3;                           // 0 at the inner edge, 1 at the outer
    if (rt > 0.0 && rt < 1.0) {
      float sp = spec(rt * 0.9);
      float ring = (0.2 + 1.3 * sp) * (0.65 + 0.35 * sin(rho * 40.0))
                 * smoothstep(0.0, 0.03, rt) * (1.0 - smoothstep(0.96, 1.0, rt));
      col += mix(pal(rt * 0.5 + u_time * 0.01), vec3(1.0), 0.2) * ring * (t.y < 0.0 ? 1.0 : 1.0 - disc) * 0.8;
    }
  }
  col *= 0.85 + 0.3 * u_energy;
  gl_FragColor = finish(col);
}
`;

/**
 * Sunset Beach: the striped sun sinking into the sea, its path breaking into
 * glints on waves that roll in faster as the track gets louder, palms leaning
 * in from the shore. The waves swell with the spectrum, the glints flare on
 * beats and the fronds bounce.
 */
const BEACH = `
void main() {
  vec2 frag = gl_FragCoord.xy;
  float R = max(u_focus.z, 20.0);
  float px = max(u_res.y * 0.0016, 1.0);
  float F = u_res.y * 0.9;
  float hz = horizonAt(R, 0.75);
  float dy = hz - frag.y;
  float dx = frag.x - u_focus.x;
  vec3 cGrid = pal(0.75 + u_time * 0.01);
  vec3 cSun1 = pal(u_time * 0.01);
  vec3 cSun2 = pal(0.4 + u_time * 0.01);
  vec3 col = vec3(0.0);

  if (dy > 0.0) {
    float z = F / dy;
    float fog = exp(-z * 0.07);
    // Crests across the water, wobbling sideways and rolling in.
    float wob = (noise(vec2(dx / dy * 1.5, z * 0.7 - u_time * 0.3)) - 0.5) * (0.5 + 0.8 * retroSpec(frag.x));
    float crest = gridLines(z * 1.3 + u_flow * 1.2 + wob, px * F / (dy * dy) * 1.3);
    col += cGrid * crest * fog * (0.7 + 0.5 * u_beat) * 0.9;
    // The sun's path: glints broken up by the waves, under the sun.
    float path = exp(-abs(dx) / (R * (0.8 + dy / R * 0.25)));
    // Thin streaks: long across, a few pixels tall, sliding toward the shore.
    float glint = smoothstep(0.55, 0.85, noise(vec2(dx / (R * 0.3), dy / (px * 2.5) - u_flow * 3.0)));
    col += mix(cSun2, vec3(1.0), 0.3) * path * (0.15 + glint * (0.8 + 0.8 * u_beat)) * fog;
    col += cSun2 * exp(-dy / (R * 0.4)) * 0.15;     // the sky's light on the water
  } else {
    float up = -dy;
    vec3 m = retroMountains(frag, up, R, px);       // islands on the horizon
    col += retroSun(frag, R, px, cSun1, cSun2) + cSun2 * exp(-up / (R * 0.7)) * 0.18 + retroStars(frag, R, px, up);
    col *= 1.0 - m.x;
    col += cGrid * (m.y * 0.7 + m.x * 0.03);
  }

  // Palms leaning in from either shore, swaying. Fixed to the screen's edges.
  float best = 1e6;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float side = i == 2 ? -1.0 : 1.0;               // two on the left leaning right, one on the right leaning left
    vec2 foot = vec2(i == 2 ? 0.95 : 0.05 + 0.13 * fi, -0.06 - 0.03 * fi) * vec2(u_res.x, u_res.y);
    float sc = u_res.y * (0.34 - 0.08 * fi + (i == 2 ? 0.05 : 0.0));  // px per unit of palm
    vec2 lp = (frag - foot) / sc;
    lp.x *= side;
    float lean = 0.55 - 0.15 * fi + 0.04 * sin(u_time * 0.7 + fi * 2.0);
    if (abs(lp.x - lean) > 1.7 || lp.y < -0.15 || lp.y > 3.25) continue;
    best = min(best, palm(lp, lean, 0.12 * u_beat, 1.0 + 0.1 * fi) * sc);
  }
  float sil = clamp(0.5 - best / px, 0.0, 1.0);
  col *= 1.0 - sil;
  col += mix(cSun1, cGrid, 0.5) * exp(-best * best / (px * px * 1.5)) * 0.5;
  col *= 0.85 + 0.3 * u_energy;
  gl_FragColor = finishOver(col, sil);
}
`;

/**
 * Vaporwave: a glossy checkerboard floor stretching to the sun, wireframe
 * solids turning in the air either side of the artwork, all through a worn
 * VHS tape - scanlines, and a tracking glitch that rolls down the picture.
 * The solids swell with the bass and the floor slides faster as the track
 * gets louder.
 */
const VAPOR = `
vec3 spin(vec3 v, float ay, float ax) {
  v = vec3(cos(ay) * v.x + sin(ay) * v.z, v.y, cos(ay) * v.z - sin(ay) * v.x);
  return vec3(v.x, cos(ax) * v.y - sin(ax) * v.z, sin(ax) * v.y + cos(ax) * v.z);
}

vec2 proj(vec3 v, vec2 c, float size, float ay, float ax) {
  v = spin(v, ay, ax);
  return c + v.xy * size / (1.0 + v.z * 0.15);
}

float edgeD(vec2 p, vec2 a, vec2 b) {
  return segT(p, a, b).x;
}

// Distance (px) to a turning wireframe cube centred on c.
float cube(vec2 p, vec2 c, float size, float ay, float ax) {
  if (length(p - c) > size * 2.2) return 1e6;
  vec2 v0 = proj(vec3(-1.0, -1.0, -1.0), c, size, ay, ax);
  vec2 v1 = proj(vec3(1.0, -1.0, -1.0), c, size, ay, ax);
  vec2 v2 = proj(vec3(1.0, 1.0, -1.0), c, size, ay, ax);
  vec2 v3 = proj(vec3(-1.0, 1.0, -1.0), c, size, ay, ax);
  vec2 v4 = proj(vec3(-1.0, -1.0, 1.0), c, size, ay, ax);
  vec2 v5 = proj(vec3(1.0, -1.0, 1.0), c, size, ay, ax);
  vec2 v6 = proj(vec3(1.0, 1.0, 1.0), c, size, ay, ax);
  vec2 v7 = proj(vec3(-1.0, 1.0, 1.0), c, size, ay, ax);
  float d = min(min(edgeD(p, v0, v1), edgeD(p, v1, v2)), min(edgeD(p, v2, v3), edgeD(p, v3, v0)));
  d = min(d, min(min(edgeD(p, v4, v5), edgeD(p, v5, v6)), min(edgeD(p, v6, v7), edgeD(p, v7, v4))));
  return min(d, min(min(edgeD(p, v0, v4), edgeD(p, v1, v5)), min(edgeD(p, v2, v6), edgeD(p, v3, v7))));
}

// Distance (px) to a turning wireframe pyramid centred on c.
float pyramid(vec2 p, vec2 c, float size, float ay, float ax) {
  if (length(p - c) > size * 2.2) return 1e6;
  vec2 a = proj(vec3(0.0, 1.3, 0.0), c, size, ay, ax);
  vec2 b0 = proj(vec3(-1.0, -0.7, -1.0), c, size, ay, ax);
  vec2 b1 = proj(vec3(1.0, -0.7, -1.0), c, size, ay, ax);
  vec2 b2 = proj(vec3(1.0, -0.7, 1.0), c, size, ay, ax);
  vec2 b3 = proj(vec3(-1.0, -0.7, 1.0), c, size, ay, ax);
  float d = min(min(edgeD(p, b0, b1), edgeD(p, b1, b2)), min(edgeD(p, b2, b3), edgeD(p, b3, b0)));
  return min(d, min(min(edgeD(p, a, b0), edgeD(p, a, b1)), min(edgeD(p, a, b2), edgeD(p, a, b3))));
}

// iq's box-filtered checkerboard: w is the pixel's footprint, so it greys
// out smoothly in the distance instead of shimmering.
float checker(vec2 p, vec2 w) {
  vec2 i = 2.0 * (abs(fract((p - 0.5 * w) * 0.5) - 0.5) - abs(fract((p + 0.5 * w) * 0.5) - 0.5)) / w;
  return 0.5 - 0.5 * i.x * i.y;
}

void main() {
  float R = max(u_focus.z, 20.0);
  float px = max(u_res.y * 0.0016, 1.0);
  // The tracking glitch: a band rolling down the picture that tears it sideways.
  float by = (1.2 - fract(u_time * 0.06) * 1.4) * u_res.y;
  float bd = (gl_FragCoord.y - by) / (u_res.y * 0.03);
  float band = exp(-bd * bd);
  vec2 frag = gl_FragCoord.xy + vec2((noise(vec2(gl_FragCoord.y * 0.5, u_time * 20.0)) - 0.5) * 14.0 * px * band, 0.0);

  float hz = horizonAt(R, 0.75);
  float dy = hz - frag.y;
  float dx = frag.x - u_focus.x;
  vec3 c1 = pal(u_time * 0.01);
  vec3 c2 = pal(0.4 + u_time * 0.01);
  vec3 c3 = pal(0.75 + u_time * 0.01);
  vec3 col = vec3(0.0);

  if (dy > 0.0) {
    vec4 f = retroFloor(dx, dy, px);
    float fog = exp(-f.y * 0.08);
    float ch = checker(vec2(f.x, f.y + u_flow * 1.4), vec2(f.z, f.w) * 1.5);
    col += mix(c3 * 0.04, c3 * 0.4, ch) * fog * (0.9 + 0.5 * u_beat);
    // A glossy floor: the sun mirrored in it.
    col += retroSun(vec2(frag.x, hz + dy), R, px, c1, c2) * 0.3 * exp(-dy / (R * 1.2));
    col += c2 * exp(-dy / (R * 0.25)) * 0.2;
  } else {
    float up = -dy;
    col += mix(c2, c1, smoothstep(0.0, u_res.y * 0.6, up)) * 0.1;  // a pastel sky
    col += retroSun(frag, R, px, c1, c2) + retroStars(frag, R, px, up) * 0.6;
  }

  // The solids, either side of the cover, bobbing.
  float size = R * 0.42 * (1.0 + 0.15 * u_bass + 0.1 * u_beat);
  float dc = cube(frag, u_focus.xy + vec2(-2.5 * R, 0.3 * R + sin(u_time * 0.8) * 0.12 * R), size, u_time * 0.5, 0.4 + 0.2 * sin(u_time * 0.3));
  float dp = pyramid(frag, u_focus.xy + vec2(2.5 * R, 0.25 * R + sin(u_time * 0.8 + 2.0) * 0.12 * R), size, -u_time * 0.6, 0.25);
  col += c3 * (exp(-dc * dc / (px * px)) + exp(-dc / (px * 4.0)) * 0.3) * (1.0 + 0.6 * u_beat);
  col += c1 * (exp(-dp * dp / (px * px)) + exp(-dp / (px * 4.0)) * 0.3) * (1.0 + 0.6 * u_beat);

  col += vec3(hash(gl_FragCoord.xy + u_time)) * band * 0.15;      // snow in the glitch
  float scan = sin(gl_FragCoord.y * PI / (px * 3.0));
  col *= 0.82 + 0.18 * scan * scan;                 // scanlines
  col *= 0.85 + 0.3 * u_energy;
  gl_FragColor = finish(col);
}
`;

/**
 * 8-Bit: the Synthwave scene as console pixel art, drawn in chunky blocks and
 * ordered-dithered down to a few shades per channel.
 */
const PIXEL = `
// The 2x2 Bayer threshold for a cell; nested once more it gives 4x4.
float bayer2(vec2 a) {
  a = floor(a);
  return fract(a.x / 2.0 + a.y * a.y * 0.75);
}

void main() {
  float B = max(4.0, floor(u_res.y / 110.0));       // block size, px
  vec2 cell = floor(gl_FragCoord.xy / B);
  vec3 col = synthwaveScene((cell + 0.5) * B, B * 0.8) * (0.85 + 0.3 * u_energy);
  float d = bayer2(cell * 0.5) * 0.25 + bayer2(cell);
  col = floor(col * 5.0 + d) / 5.0;
  gl_FragColor = finish(col);
}
`;

/**
 * Night Drive: a highway after dark, street lamps sweeping past on both
 * sides, the taillights of the cars ahead, a pale moon behind the artwork and
 * the city along the horizon. The drive speeds up as the track gets louder,
 * brake lights flare on beats and the lamps swell with the bass.
 */
const NIGHTDRIVE = `
void main() {
  vec2 frag = gl_FragCoord.xy;
  float R = max(u_focus.z, 20.0);
  float px = max(u_res.y * 0.0016, 1.0);
  float F = u_res.y * 0.9;
  float hz = horizonAt(R, 0.75);
  float dy = hz - frag.y;
  float bend = 0.015 * sin(u_time * 0.11);
  vec3 cLamp = mix(pal(0.1 + u_time * 0.01), vec3(1.0, 0.75, 0.4), 0.35);
  vec3 cMoon = mix(pal(0.5 + u_time * 0.01), vec3(1.0), 0.6);
  vec3 cNeon = pal(0.75 + u_time * 0.01);
  vec3 cTail = mix(vec3(1.0, 0.08, 0.12), pal(u_time * 0.01), 0.25);
  float travel = u_flow * 2.6;
  vec3 col = vec3(0.0);
  float xc = 0.0;
  float z = 0.0;

  if (dy > 0.0) {
    z = F / dy;
    xc = (frag.x - u_focus.x) / dy - bend * z * z;
    float wxc = px / dy;
    float fog = exp(-z * 0.08);
    float ax = abs(xc);
    float ew = max(0.03, wxc);
    float edge = exp(-(ax - 1.1) * (ax - 1.1) / (ew * ew)) * min(0.03 / wxc, 1.0);
    float dz = fract((z + travel) * 0.35);
    float aa = px * F / (dy * dy) * 0.35;
    float lw = max(0.02, wxc);
    float lane = exp(-(ax - 0.37) * (ax - 0.37) / (lw * lw)) * min(0.02 / wxc, 1.0)
               * mix(1.0 - smoothstep(0.2 - aa, 0.2 + aa, abs(dz - 0.5)), 0.4, smoothstep(0.1, 0.4, aa));
    col += cLamp * edge * 0.7 * fog + vec3(0.9) * lane * 0.7 * fog;
    col += cNeon * 0.02 * (1.0 - smoothstep(1.05, 1.15, ax)) * fog;    // the tarmac
  } else {
    float up = -dy;
    // The moon behind the cover, mottled, and the sky lit around it.
    float md = length(frag - u_focus.xy);
    float Rm = R * 1.25;
    float moon = 1.0 - smoothstep(Rm - px, Rm + px, md);
    col += cMoon * moon * (0.45 + 0.25 * fbm((frag - u_focus.xy) / R * 2.5)) + cMoon * exp(-max(md - Rm, 0.0) / (R * 0.6)) * 0.15 * (1.0 - moon);
    col += retroStars(frag, R, px, up) * 0.7 + cNeon * exp(-up / (R * 0.5)) * 0.18;
    vec4 city = skyline(frag.x, up, R, px, R * 0.2, 1.3, 0.3 + 0.3 * u_mid, 31.0, u_flow * R * 0.02);
    col *= 1.0 - city.x;
    col += pal(city.w * 0.5 + 0.6) * city.x * 0.05 + cLamp * city.y * 0.5 + cNeon * city.z * 0.5;
  }

  // Lamps on both sides, nearest first: a pool of light on the road, the
  // lamp itself, and the pole (a black silhouette).
  float pole = 1e6;
  float gap = 5.0;
  for (int k = 0; k < 8; k++) {
    float n = floor(travel / gap) + 1.0 + float(k);
    float lz = n * gap - travel;
    if (lz < 0.8) continue;
    float s = F / lz;
    float off = bend * lz * lz;
    float fog = exp(-lz * 0.08);
    for (int j = 0; j < 2; j++) {
      float side = float(j) * 2.0 - 1.0;
      if (dy > 0.0) {
        vec2 pd = vec2(xc - side * 0.85, (z - lz) * 0.45);
        col += cLamp * exp(-dot(pd, pd) / 0.35) * 0.55 * fog * (0.8 + 0.5 * u_bass);
      }
      vec2 base = vec2(u_focus.x + (side * 1.45 + off) * s, hz - s);
      vec2 head = vec2(u_focus.x + (side * 0.85 + off) * s, hz + 1.6 * s);
      float hd = length(frag - head);
      float hr = max(0.05 * s, px);
      col += cLamp * (exp(-hd * hd / (hr * hr)) * 1.5 + exp(-hd / (hr * 4.0)) * 0.35) * fog * (0.8 + 0.5 * u_bass);
      // Its beam: a cone of light widening down to the road.
      float hh = head.y - frag.y;
      if (hh > 0.0) {
        float cw = hh * 0.45 + hr;
        float cx = (frag.x - head.x) / cw;
        col += cLamp * exp(-cx * cx) * exp(-hh / (s * 2.6)) * 0.1 * fog * (0.8 + 0.5 * u_bass);
      }
      vec2 top = base + vec2(0.0, 2.6 * s);
      float w = max(0.025 * s, px * 0.6);
      pole = min(pole, min(segT(frag, base, top).x, segT(frag, top, head + vec2(0.0, 0.03 * s)).x) - w);
    }
  }

  // Taillights of the cars ahead, drifting nearer and further in their lanes.
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    float cz = 5.0 + fi * 4.0 + 2.0 * sin(u_time * (0.15 + 0.05 * fi) + fi * 2.0);
    float cx = (mod(fi, 3.0) - 1.0) * 0.73 + bend * cz * cz;  // left, middle and right lanes
    float s = F / cz;
    float fog = exp(-cz * 0.06);
    float brake = 0.6 + 1.4 * u_beat;
    for (int j = 0; j < 2; j++) {
      vec2 lp = vec2(u_focus.x + (cx + (float(j) - 0.5) * 0.42) * s, hz - 0.62 * s);
      float d = length(frag - lp);
      float lr = max(0.04 * s, px);
      col += cTail * (exp(-d * d / (lr * lr)) * 1.3 + exp(-d / (lr * 3.5)) * 0.3) * brake * fog;
      // Their glow on the road beneath.
      if (frag.y < lp.y) col += cTail * exp(-abs(frag.x - lp.x) / (lr * 1.5)) * exp(-(lp.y - frag.y) / (s * 0.5)) * 0.08 * brake * fog;
    }
  }

  float sil = clamp(0.5 - pole / px, 0.0, 1.0);
  col *= 1.0 - sil;
  col *= 0.85 + 0.3 * u_energy;
  gl_FragColor = finishOver(col, sil);
}
`;

/**
 * A black hole with the artwork as its shadow: an accretion disk seen nearly
 * edge-on swirls round it, its far side bent up over the top by the hole's
 * gravity, and the stars behind are lensed into arcs. The side of the disk
 * turning toward us burns brighter; bass flares it and fires jets from the
 * poles. Unlike every other mode the shadow is opaque, so the cover sits in
 * real darkness rather than on the backdrop.
 */
const BLACKHOLE = `
// Turbulence in the disk, sampled on a circle so it wraps cleanly, drawn out
// into streaks (fine across the radius, long around it) and turning at rate.
float swirl(float rho, float phi, float rate) {
  float ph = phi - u_flow * rate;
  return fbm(vec2(cos(ph), sin(ph)) * 1.8 + vec2(rho * 3.5, rho * 1.3));
}

// Light from the disk at radius rho (focus radii) and angle phi in its own plane.
float diskLight(float rho, float phi) {
  if (rho > 4.0) return 0.0;
  float prof = smoothstep(1.31, 1.47, rho) * exp(-(rho - 1.35) * 1.1) * (1.0 - smoothstep(3.0, 3.9, rho));
  if (prof <= 0.0) return 0.0;
  // Two layers at different rates, cross-faded by radius: the inside orbits
  // faster, but neither layer shears, so the pattern never winds up tight.
  float n = mix(swirl(rho, phi, 0.55), swirl(rho, phi + 1.7, 0.25), smoothstep(1.5, 2.8, rho));
  float beam = 1.0 - 0.6 * cos(phi);                // Doppler: the side coming toward us is brighter
  return prof * (0.3 + 1.4 * n * n) * beam * (0.6 + 0.8 * spec(abs(phi) / PI * 0.9));
}

void main() {
  float R = max(u_focus.z, 20.0);
  vec2 q = (gl_FragCoord.xy - u_focus.xy) / R;     // in focus radii
  vec2 p = vec2(q.x * 0.98 + q.y * 0.2, q.y * 0.98 - q.x * 0.2);  // the whole system tilted a little
  float r = length(p);
  float a = atan(p.y, p.x);
  float hole = 1.04 + 0.03 * u_bass;
  float shadow = 1.0 - smoothstep(hole - max(0.02, 1.5 / R), hole, r);
  vec3 cIn = pal(u_time * 0.01);
  vec3 cOut = pal(0.5 + u_time * 0.01);
  vec3 col = vec3(0.0);

  // Stars behind, lensed: a pixel sees the sky bent round the hole (a point
  // lens maps angle t to t - tE^2 / t), which smears stars near the ring into arcs.
  vec2 sg = (p - p / max(r * r, 0.01) * 1.5 + vec2(u_time * 0.01, 0.0)) * 7.0;
  vec2 sid = floor(sg);
  float sr = max(0.06, 7.0 / R);                    // star radius in cells, at least a pixel
  float sdist = length(fract(sg) - 0.25 - 0.5 * vec2(hash(sid + 1.7), hash(sid + 5.1)));
  col += mix(vec3(1.0), cOut, 0.3) * step(0.82, hash(sid)) * exp(-sdist * sdist / (sr * sr))
       * (0.3 + 0.7 * hash(sid + 9.0)) * smoothstep(hole + 0.05, hole + 0.4, r);

  // The disk, nearly edge-on: its plane squashed by K on screen. The near
  // (lower) half crosses in front of the shadow; the far half is behind it.
  const float K = 0.22;
  vec2 dp = vec2(p.x, p.y / K);
  float rho = length(dp);
  float direct = diskLight(rho, atan(dp.y, dp.x)) * (p.y < 0.0 ? 1.0 : 1.0 - shadow);
  float hot = exp(-(rho - 1.35) * 1.6);
  col += mix(mix(cIn, cOut, smoothstep(1.3, 3.0, rho)), vec3(1.0), 0.45 * hot) * direct * (0.9 + 0.5 * u_bass + 0.4 * u_beat);

  // The far side of the disk again, bent up over the top of the hole, and
  // (fainter) its underside bent round beneath.
  float ar = r - hole;
  if (ar > 0.0 && ar < 0.9) {
    float topw = mix(0.35, 1.0, smoothstep(-0.3, 0.7, sin(a)));
    col += mix(cIn, vec3(1.0), 0.35) * diskLight(1.35 + ar * 3.2, a) * topw * exp(-ar * 2.5) * 1.2;
  }

  // The photon ring hugging the shadow.
  float pw = max(0.012, 1.0 / R);
  float pr = (r - hole - pw) / pw;
  col += mix(cIn, vec3(1.0), 0.6) * exp(-pr * pr) * (0.5 + 0.4 * (1.0 - 0.6 * cos(a)) + 0.8 * u_beat);
  col += cIn * exp(-max(ar, 0.0) / 0.8) * 0.08 * (1.0 - shadow);

  // Jets from the poles, on heavy bass.
  float ay = abs(p.y);
  float jet = exp(-abs(p.x) / (0.05 + 0.08 * ay)) * smoothstep(hole, hole + 0.5, ay) * exp(-(ay - hole) * 0.5)
            * (0.6 + 0.4 * noise(vec2(p.x * 8.0, ay * 3.0 - u_time * 4.0)));
  col += cOut * jet * (0.04 + 0.6 * u_bass * u_bass * u_bass);

  col *= 0.85 + 0.3 * u_energy;
  gl_FragColor = finishOver(col, shadow);         // the shadow is opaque
}
`;

export const FRAGMENTS: Record<string, string> = {
  nebula: PRELUDE + NEBULA,
  silk: PRELUDE + SILK,
  halo: PRELUDE + HALO,
  corona: PRELUDE + CORONA,
  ripples: PRELUDE + RIPPLES,
  lightning: PRELUDE + LIGHTNING,
  rain: PRELUDE + RAIN,
  fireworks: PRELUDE + FIREWORKS,
  sonar: PRELUDE + SONAR,
  embers: PRELUDE + EMBERS,
  warp: PRELUDE + WARP,
  lasers: PRELUDE + LASERS,
  synthwave: PRELUDE + RETRO + SYNTHWAVE,
  outrun: PRELUDE + RETRO + OUTRUN,
  city: PRELUDE + RETRO + CITY,
  terrain: PRELUDE + RETRO + TERRAIN,
  tunnel: PRELUDE + RETRO + TUNNEL,
  planet: PRELUDE + RETRO + PLANET,
  beach: PRELUDE + RETRO + BEACH,
  vapor: PRELUDE + RETRO + VAPOR,
  pixel: PRELUDE + RETRO + PIXEL,
  nightdrive: PRELUDE + RETRO + NIGHTDRIVE,
  blackhole: PRELUDE + BLACKHOLE,
  vortex: PRELUDE + VORTEX,
  gooey: PRELUDE + GOOEY,
};
