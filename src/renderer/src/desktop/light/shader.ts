// The edge light, ported from the Mac's EdgeLight.metal to WebGL2 (GLSL ES 3.00), field for field, by iJWA. The
// lights to choose from come word for word from the Mac's shader (looks-glsl.ts); each gets its own program, built
// the first time it's drawn. What changed on the way: no camera notch (PCs have none); smoothstep is our own, because
// GLSL leaves a reversed pair of edges undefined and the light uses them; the sparks are added with additive blending
// instead of reading back the frame buffer.
import { LOOKS_GLSL } from './looks-glsl'

const COMMON = `#version 300 es
precision highp float;
precision highp int;

uniform vec2 uSize;        // screen size in CSS points
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform float uScale;      // device pixels per point
uniform float uWiggle;     // phase of the body's slow ripple, radians
uniform float uHeadA;      // where each snake's head is along the rim, 0...1
uniform float uHeadB;
uniform float uSpan;       // body length as a share of the whole rim
uniform float uThickness;  // how far the light reaches inward, in points
uniform float uGlow;       // strength of the soft halo beside the bright core
uniform float uCorner;     // rounding of the screen's corners, in points
uniform float uBand;       // how deep the softest light reaches
uniform float uStill;      // 1 when the whole rim glows and holds still
uniform float uPresence;   // 0 dark ... 1 fully lit
uniform float uPulse;      // brightness from the music
uniform float uSwell;      // reach from the music
uniform float uTime;       // seconds, wrapping every hour, for the sparks
uniform float uSparkle;    // how many sparks the light sheds
uniform float uTaper;      // how quickly a tail thins
uniform vec4 uDrops;       // ripple, lightning, fireworks: each drop's age in seconds, below 0 for none
uniform vec4 uDropAt;      // where along the rim each fell, 0...1
uniform vec4 uStrip;       // ticker: the words' strip width and height in points, how far it has scrolled
uniform float uLook;       // the light's number (looks.js)
uniform float uDrift;      // how far the flowing lights have flowed
uniform float uBeat;       // the music's kick now, 0...1
uniform float uPlace;      // where the light shows: 0 all round, 1 the bottom, 2 the top, 3 the corners

const float PI = 3.14159265358979;

float sstep(float e0, float e1, float x) {
    float t = clamp((x - e0) / (e1 - e0), 0.0, 1.0);
    return t * t * (3.0 - 2.0 * t);
}

// How far inside the screen's rounded edge a point is, in points.
float depthInside(vec2 p, vec2 size, float r) {
    vec2 q = abs(p - size * 0.5) - (size * 0.5 - r);
    float outside = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
    return max(-outside, 0.0);
}

// Where along the rim a point sits, in points, walking clockwise from the top-left.
float rimDistance(vec2 p, vec2 size, float bend, out float total) {
    float sw = size.x - 2.0 * bend;
    float sh = size.y - 2.0 * bend;
    float arc = bend * PI * 0.5;
    total = 2.0 * (sw + sh) + 4.0 * arc;

    float top = p.x - bend;
    float right = sw + arc + (p.y - bend);
    float bottom = sw + 2.0 * arc + sh + (size.x - bend - p.x);
    float left = 2.0 * sw + 3.0 * arc + sh + (size.y - bend - p.y);

    vec2 d = p - clamp(p, vec2(bend), size - bend);

    if (d.x != 0.0 && d.y != 0.0) {
        float turns = atan(d.y, d.x) / (PI * 0.5);
        if (d.x > 0.0 && d.y < 0.0) return sw + (turns + 1.0) * arc;
        if (d.x > 0.0) return sw + arc + sh + turns * arc;
        if (d.y > 0.0) return 2.0 * sw + 2.0 * arc + sh + (turns - 1.0) * arc;
        return 2.0 * sw + 3.0 * arc + 2.0 * sh + (turns + 2.0) * arc;
    }
    if (d.y < 0.0) return top;
    if (d.x > 0.0) return right;
    if (d.y > 0.0) return bottom;
    if (d.x < 0.0) return left;

    float nearest = min(min(p.y, size.x - p.x), min(size.y - p.y, p.x));
    if (nearest == p.y) return top;
    if (nearest == size.x - p.x) return right;
    if (nearest == size.y - p.y) return bottom;
    return left;
}

// Depth and place along the rim.
vec2 rimPlace(vec2 p, out float total) {
    float bend = min(uSize.x, uSize.y) * 0.2;
    float depth = depthInside(p, uSize, uCorner);
    float s = rimDistance(p, uSize, bend, total);
    return vec2(depth, s);
}

// Brightness along one snake: a soft nose, a full body, and a tail that thins away.
float body(float along, float head, float span, float taper) {
    float t = fract(head - along) / span;
    if (t >= 1.0) return 0.0;
    return sstep(0.0, 0.12, t) * pow(1.0 - t, taper) * 1.2;
}

// Pixel position in points from the top-left (GL's origin is bottom-left).
vec2 pointOf(vec4 fragCoord) {
    return vec2(fragCoord.x, uSize.y * uScale - fragCoord.y) / uScale;
}
`;

export const RIM_VERTEX = `#version 300 es
precision highp float;
precision highp int;
uniform vec2 uSize;
uniform float uBand;
void main() {
    vec2 inset = min(vec2(uBand), uSize * 0.5) / uSize * 2.0;
    float top = min(uBand, uSize.y * 0.5) / uSize.y * 2.0;
    vec2 outerC[4] = vec2[4](vec2(-1.0, 1.0), vec2(1.0, 1.0), vec2(1.0, -1.0), vec2(-1.0, -1.0));
    vec2 innerC[4] = vec2[4](vec2(-1.0 + inset.x, 1.0 - top), vec2(1.0 - inset.x, 1.0 - top),
                             vec2(1.0 - inset.x, -1.0 + inset.y), vec2(-1.0 + inset.x, -1.0 + inset.y));
    int id = gl_VertexID;
    int a = id / 6;
    int b = (a + 1) % 4;
    int k = id % 6;
    vec2 corner[6] = vec2[6](outerC[a], outerC[b], innerC[a], innerC[a], outerC[b], innerC[b]);
    gl_Position = vec4(corner[k], 0.0, 1.0);
}`;

/** The program drawing one light: everything the Mac's shader has, its main() calling `fn`. */
export function lookFragment(fn: string): string {
  return COMMON + `
uniform sampler2D uWords;
out vec4 outColor;
float saturate(float x) { return clamp(x, 0.0, 1.0); }
vec3 saturate(vec3 x) { return clamp(x, 0.0, 1.0); }
vec4 finish(vec3 rgb, vec2 p);
` + LOOKS_GLSL + `
// The last touch every light shares (finish in EdgeLight.metal): brightness as the light rises and the music pulses,
// where the user wants it, a whisper of noise against banding, and alpha as the brightest channel.
vec4 finish(vec3 rgb, vec2 p) {
    rgb *= pow(uPresence, 1.6) * uPulse * placeMask(p);
    float noise = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
    rgb = max(rgb + (noise - 0.5) / 255.0, 0.0);
    return vec4(min(rgb, vec3(1.0)), clamp(max(rgb.r, max(rgb.g, rgb.b)), 0.0, 1.0));
}
void main() { outColor = ${fn}(); }`;
}

const SPARK_COMMON = COMMON + `
// Where the light is, for the sparks (litBy in EdgeLight.metal).
vec2 litBy(float along) {
    int look = int(uLook + 0.5);
    if (look == 0) return vec2(body(along, uHeadA, uSpan, uTaper), body(along, uHeadB, uSpan, uTaper));
    if (look == 1) return vec2(body(along, uHeadA, uSpan, uTaper), body(-along, -uHeadB, uSpan, uTaper));
    float b = 0.5 - 0.5 * cos(along * 2.0 * PI);
    return vec2(1.0 - b, b);
}
float placeMask(vec2 p) {
    int place = int(uPlace + 0.5);
    if (place == 1) return sstep(uSize.y * 0.35, uSize.y * 0.75, p.y);
    if (place == 2) return 1.0 - sstep(uSize.y * 0.25, uSize.y * 0.65, p.y);
    if (place == 3) {
        float corner = length(vec2(min(p.x, uSize.x - p.x), min(p.y, uSize.y - p.y)));
        return 1.0 - sstep(170.0, 420.0, corner);
    }
    return 1.0;
}
float hash(vec2 id, uint stream) {
    uvec3 v = uvec3(uint(int(id.x)), uint(int(id.y)), stream) * 1664525u + 1013904223u;
    v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
    v ^= v >> 16u;
    v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
    return float(v.x) * (1.0 / 4294967296.0);
}

// The point \`depth\` points in from the rim at \`along\`.
vec2 rimPoint(float along, float depth, vec2 size, float bend) {
    float sw = size.x - 2.0 * bend;
    float sh = size.y - 2.0 * bend;
    float arc = bend * PI * 0.5;
    float s = fract(along) * (2.0 * (sw + sh) + 4.0 * arc);
    vec2 centre;
    float turns;
    if (s < sw) return vec2(bend + s, depth);
    s -= sw;
    if (s < arc) { centre = vec2(size.x - bend, bend); turns = s / arc - 1.0; }
    else if ((s -= arc) < sh) return vec2(size.x - depth, bend + s);
    else if ((s -= sh) < arc) { centre = size - bend; turns = s / arc; }
    else if ((s -= arc) < sw) return vec2(size.x - bend - s, size.y - depth);
    else if ((s -= sw) < arc) { centre = vec2(bend, size.y - bend); turns = 1.0 + s / arc; }
    else if ((s -= arc) < sh) return vec2(depth, size.y - bend - s);
    else { s -= sh; centre = vec2(bend); turns = s / arc - 2.0; }
    vec2 dir = vec2(cos(turns * PI * 0.5), sin(turns * PI * 0.5));
    return centre + dir * (bend - depth) / max(abs(dir.x), abs(dir.y));
}
`;

export const SPARK_VERTEX = SPARK_COMMON + `
out float vHome;
out float vDrift;
out float vRadius;
out vec3 vColor;

void main() {
    int vid = gl_VertexID;
    int iid = gl_InstanceID;
    vHome = 0.0; vDrift = 0.0; vRadius = 1.0; vColor = vec3(0.0);
    gl_Position = vec4(-2.0, -2.0, 0.0, 1.0);
    const float period = 1.6;
    float bend = min(uSize.x, uSize.y) * 0.2;
    float total = 2.0 * (uSize.x + uSize.y - 4.0 * bend) + 2.0 * PI * bend;
    float rim = total;
    float cells = max(floor(total / 48.0), 3.0);
    float c = float(iid >> 1);
    if (c >= cells) return;
    float k = floor(uTime / period) - float(iid & 1);
    vec2 id = vec2(c, k);

    float appear = clamp((uSparkle - hash(id, 0u)) / 0.12, 0.0, 1.0);
    if (appear <= 0.0) return;
    float born = (k + hash(id, 1u) * 0.5) * period;
    float life = 1.3 + hash(id, 2u) * 0.9;
    float age = uTime - born;
    if (age < 0.0 || age > life) return;
    float home = (c + hash(id, 3u)) / cells;
    vec2 lit = litBy(home);
    float a = lit.x, b = lit.y;
    if (a + b <= 0.0) return;

    float speed = 14.0 + hash(id, 4u) * 26.0;
    float sway = sin(age * (1.5 + hash(id, 5u) * 2.0) + hash(id, 6u) * 6.283) * (3.0 + hash(id, 7u) * 5.0);
    float fade = sstep(0.0, 0.15, age) * (1.0 - sstep(life * 0.45, life, age));
    float twinkle = 0.75 + 0.25 * sin(age * 9.0 + hash(id, 10u) * 6.283);
    vec3 tint = (uColorA * a + uColorB * b) / (a + b);

    vHome = fract(home + sway / total);
    vDrift = 2.0 + hash(id, 8u) * 6.0 + speed * age * (1.0 - 0.35 * age / life);
    vRadius = 1.1 + hash(id, 9u) * 1.1;
    vColor = mix(tint, vec3(1.0), 0.35) * fade * twinkle * appear * clamp((a + b) * 1.5, 0.0, 1.0)
           * pow(uPresence, 1.6) * uPulse;

    vec2 centre = rimPoint(vHome, vDrift, uSize, bend);
    vColor *= placeMask(centre);
    vec2 side = vec2((vid == 1 || vid == 2 || vid == 4) ? 1.0 : -1.0,
                     (vid == 2 || vid == 4 || vid == 5) ? 1.0 : -1.0);
    vec2 p = (centre + side * 15.0 * vRadius) / uSize;
    gl_Position = vec4(p.x * 2.0 - 1.0, 1.0 - p.y * 2.0, 0.0, 1.0);
}`;

export const SPARK_FRAGMENT = SPARK_COMMON + `
in float vHome;
in float vDrift;
in float vRadius;
in vec3 vColor;
out vec4 outColor;

void main() {
    vec2 p = pointOf(gl_FragCoord);
    float total;
    vec2 place = rimPlace(p, total);
    float depth = place.x;
    if (depth >= uBand) discard;
    float along = place.y / total;
    vec2 gap = vec2((fract(along - vHome + 0.5) - 0.5) * total, depth - vDrift);
    float r2 = vRadius * vRadius;
    float d2 = dot(gap, gap);
    if (d2 > 100.0 * r2) discard;
    vec2 lit = litBy(along);
    if (max(lit.x, lit.y) <= 0.0) discard;
    float glint = exp(-d2 / r2) + 0.22 * exp(-d2 / (9.0 * r2));
    vec3 add = vColor * glint * sstep(uBand, uBand * 0.75, depth);
    outColor = vec4(add, max(add.r, max(add.g, add.b)));
}`;
