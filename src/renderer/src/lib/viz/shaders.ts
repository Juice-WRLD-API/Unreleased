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

export const FRAGMENTS: Record<string, string> = {
  nebula: PRELUDE + NEBULA,
  silk: PRELUDE + SILK,
  halo: PRELUDE + HALO,
  corona: PRELUDE + CORONA,
  ripples: PRELUDE + RIPPLES,
  lightning: PRELUDE + LIGHTNING,
  vortex: PRELUDE + VORTEX,
  gooey: PRELUDE + GOOEY,
};
