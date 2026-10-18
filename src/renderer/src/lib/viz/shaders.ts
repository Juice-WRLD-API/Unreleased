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
 * Synthwave: a neon grid floor racing toward a striped sun that sets behind
 * the artwork, with a mountain ridge on the horizon that the spectrum pushes
 * up and down. The grid runs faster as the track gets louder; beats pulse the
 * sun and the grid.
 */
const SYNTHWAVE = `
// Ridge height (px) at screen x: ridged noise for peaks, raised by the
// spectrum s, and kept low around the sun so it still shows.
float ridgeAt(float x, float R, float s) {
  float h1 = 1.0 - abs(noise(vec2(x / R * 0.9, 2.0)) * 2.0 - 1.0);
  float h2 = 1.0 - abs(noise(vec2(x / R * 2.3, 7.0)) * 2.0 - 1.0);
  float side = smoothstep(R * 0.5, R * 2.2, abs(x - u_focus.x));
  return R * (0.06 + 0.34 * h1 * h1 + 0.1 * h2) * (0.6 + 0.8 * s) * (0.25 + 0.75 * side);
}

void main() {
  vec2 frag = gl_FragCoord.xy;
  float R = max(u_focus.z, 20.0);
  float px = max(u_res.y * 0.0016, 1.0);            // line width
  float hz = clamp(u_focus.y - R * 0.75, u_res.y * 0.15, u_res.y * 0.7);  // the horizon
  float dx = frag.x - u_focus.x;
  float dy = hz - frag.y;                           // px below the horizon
  vec3 cGrid = pal(0.75 + u_time * 0.01);
  vec3 cSun1 = pal(u_time * 0.01);
  vec3 cSun2 = pal(0.4 + u_time * 0.01);
  vec3 col = vec3(0.0);

  if (dy > 0.0) {
    // The floor in perspective: depth goes as 1/(distance below the horizon).
    float F = u_res.y * 0.9;
    float z = F / dy;
    float gx = dx / dy * 3.0;
    float gz = z + u_flow * 1.6;                    // lines rush toward the viewer
    // A pixel's size in grid units. Where lines crowd closer than a few
    // pixels they fade to a dim average instead of moire.
    float wz = px * F / (dy * dy);
    float wx = px * 3.0 / dy * sqrt(1.0 + dx * dx / (dy * dy));
    float lz = abs(fract(gz + 0.5) - 0.5);
    float lx = abs(fract(gx + 0.5) - 0.5);
    float lineZ = mix(exp(-lz * lz / (wz * wz)) + exp(-lz / (wz * 3.0)) * 0.25, min(wz * 3.3, 1.0) * 0.35, smoothstep(0.06, 0.25, wz));
    float lineX = mix(exp(-lx * lx / (wx * wx)) + exp(-lx / (wx * 3.0)) * 0.25, min(wx * 3.3, 1.0) * 0.35, smoothstep(0.06, 0.25, wx));
    float fog = exp(-z * 0.09);                     // the far floor fades into haze
    col += cGrid * max(lineZ, lineX) * fog * (0.9 + 0.7 * u_beat) * 1.2;
    col += cGrid * exp(-dy / (R * 0.25)) * 0.25 * (0.6 + u_bass);                         // glow along the horizon
    col += cSun2 * exp(-abs(dx) / (R * 0.8)) * exp(-dy / (R * 0.6)) * 0.15 * (0.7 + u_beat);  // the sun on the floor
  } else {
    float up = -dy;                                 // px above the horizon
    float sx = tri(frag.x / u_res.x) * 0.9;         // bass in the middle
    float s = (spec(sx - 0.02) + spec(sx) + spec(sx + 0.02)) / 3.0;
    float ridge = ridgeAt(frag.x, R, s);
    float slope = ridgeAt(frag.x + 1.0, R, s) - ridge;
    float inMtn = 1.0 - smoothstep(ridge - px, ridge + px, up);
    float rimD = (up - ridge) / sqrt(1.0 + slope * slope);  // across the edge, so steep slopes don't thin it
    float rim = exp(-rimD * rimD / (px * px * 2.0));

    // The sun, centred behind the cover, its lower half cut by bands that
    // widen as they slide down.
    float Rs = R * (1.3 + 0.05 * u_beat);
    float sd = length(frag - u_focus.xy);
    float sv = (u_focus.y - frag.y) / Rs;           // -1 at the top, 1 at the bottom
    float gapW = clamp((sv + 0.25) * 0.7, 0.0, 0.5);
    float g = fract(sv * 9.0 - u_flow * 0.5);
    float aa = 9.0 * px / Rs;
    float bands = mix(1.0, smoothstep(gapW - aa, gapW + aa, g) * (1.0 - smoothstep(1.0 - aa, 1.0, g)), smoothstep(0.0, aa * 2.0, gapW));
    float disc = 1.0 - smoothstep(Rs - px, Rs + px, sd);
    vec3 sunCol = mix(cSun1, cSun2, clamp(sv * 0.5 + 0.5, 0.0, 1.0));
    col += mix(sunCol, vec3(1.0), 0.15) * disc * bands * (1.1 + 0.5 * u_beat);
    col += sunCol * exp(-max(sd - Rs, 0.0) / (R * 0.5)) * 0.3 * (0.6 + 0.5 * u_bass + 0.5 * u_beat);
    col += cSun2 * exp(-up / (R * 0.7)) * 0.18;     // the sky glowing above the horizon

    vec2 sg = frag / (R * 0.3);
    vec2 sid = floor(sg);
    float st = length(fract(sg) - 0.25 - 0.5 * vec2(hash(sid + 1.7), hash(sid + 5.1))) * R * 0.3;
    col += vec3(0.9) * step(0.9, hash(sid)) * exp(-st * st / (px * px)) * smoothstep(R * 0.3, R * 1.5, up)
         * (0.4 + 0.4 * sin(u_time * (1.0 + 3.0 * hash(sid + 3.3)) + hash(sid) * 40.0));

    // Mountains stand in front of all of it: a dark body and a neon edge.
    col *= 1.0 - inMtn;
    col += cGrid * (rim * (1.0 + 0.4 * u_beat) + inMtn * (0.04 + 0.08 * up / max(ridge, 1.0)));
  }
  col *= 0.85 + 0.3 * u_energy;
  gl_FragColor = finish(col);
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
  vec4 o = finish(col);
  // An opaque shadow: premultiplied colour over black keeps its rgb and takes alpha 1.
  gl_FragColor = vec4(o.rgb, max(o.a, shadow * protect(gl_FragCoord.xy) * u_intensity));
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
  synthwave: PRELUDE + SYNTHWAVE,
  blackhole: PRELUDE + BLACKHOLE,
  vortex: PRELUDE + VORTEX,
  gooey: PRELUDE + GOOEY,
};
