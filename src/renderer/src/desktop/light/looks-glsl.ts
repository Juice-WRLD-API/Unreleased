// Every light, as GLSL functions: each returns the pixel's color; shader.ts gives each its own program. Carried over
// word for word from iJWA's looks-glsl.js (generated there from the Mac's EdgeLight.metal) - change it there and copy.
export const LOOKS_GLSL = `// LightStyle.Look's order; the shader's number for each light.
const int LOOK_SNAKE = 0, LOOK_TWIN = 1;

// How much of each color lights the rim at along, for the sparks: the snakes' bodies, or
// with the pulse the whole rim, its two colors meeting halfway round as when held still.
vec2 litBy(float along) {
    int look = int(uLook + 0.5);
    if (look == LOOK_SNAKE) {
        return vec2(body(along, uHeadA, uSpan, uTaper), body(along, uHeadB, uSpan, uTaper));
    }
    if (look == LOOK_TWIN) {
        // The second snake runs the other way round, its tail behind it on that side.
        return vec2(body(along, uHeadA, uSpan, uTaper), body(-along, -uHeadB, uSpan, uTaper));
    }
    // The rest light the whole rim, the two colors meeting halfway round.
    float b = 0.5 - 0.5 * cos(along * 2.0 * PI);
    return vec2(1.0 - b, b);
}

// A random number in 0..<1 for one spark (cell, slot) and one of its traits (stream).
// Integer mixing rather than the usual sin() trick, which turns patterned on the GPU once
// cell and slot numbers grow large.
float hash(vec2 id, uint stream) {
    uvec3 v = uvec3(uint(int(id.x)), uint(int(id.y)), stream) * 1664525u + 1013904223u;
    v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
    v ^= v >> 16u;
    v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
    return float(v.x) * (1.0 / 4294967296.0);
}

// How much of the light shows at p for where the user wants it: all round, along the
// bottom or the top (fading up or down the sides), or only in the corners.
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

vec4 rimFragment() {
    vec2 p = pointOf(gl_FragCoord);
    float total;
    vec2 place = rimPlace(p, total);
    float depth = place.x;
    if (depth >= uBand) return vec4(0.0);
    float along = place.y / total;

    float a, b, strength;
    if (uStill > 0.5) {
        // Held still: the whole rim glows, the two colors meeting halfway round.
        b = 0.5 - 0.5 * cos(along * 2.0 * PI);
        a = 1.0 - b;
        strength = 1.0;
    } else {
        vec2 lit = litBy(along);
        a = lit.x;
        b = lit.y;
        strength = max(a, b);
        if (strength <= 0.0) return vec4(0.0);
    }

    // The body ripples slower than it travels, which is what makes it read as a snake.
    // A whole number of ripples (each about 440 points long) fits around the rim, so the
    // ripple meets itself exactly where the rim position wraps at the top-left corner.
    float waves = max(round(total / 440.0), 1.0);
    float ripple = 1.0 + 0.28 * (1.0 - uStill) * sin(along * waves * 2.0 * PI - uWiggle);
    // Turning on, the light starts as a thin line in the bezel and spreads inward.
    float reach = uThickness * ripple * mix(0.55, 1.0, saturate(strength))
                * mix(0.15, 1.0, uPresence) * uSwell;

    // A sharp core hugging the edge, and a soft bloom that falls away quickly enough
    // to be gone by band, so the early exit above never cuts it visibly.
    float core = exp(-depth / (reach * 0.16));
    float halo = exp(-(depth / reach) * (depth / reach));
    float fade = sstep(uBand, uBand * 0.75, depth);

    vec3 rgb = (uColorA * a + uColorB * b) * (core + halo * uGlow) * fade;
    rgb += (a + b) * core * 0.3;   // a white-hot line right at the edge
    // Twin: where the two cross, they flare.
    if (int(uLook + 0.5) == LOOK_TWIN) {
        rgb += (uColorA + uColorB + 1.0) * min(a, b) * (core + halo) * 0.6 * fade;
    }
    rgb *= pow(uPresence, 1.6) * uPulse;   // brightness arrives gently, after the line appears

    // A whisper of noise so the long dark falloff doesn't band.
    float noise = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
    rgb = max(rgb + (noise - 0.5) / 255.0, 0.0);

    rgb *= placeMask(p);
    float alpha = saturate(max(rgb.r, max(rgb.g, rgb.b)));
    return vec4(min(rgb, 1.0), alpha);
}

// ---- Lava ----
// Six soft blobs of light creep round the rim at their own pace, some each way. Where they
// meet they melt into one and swell inward, then pull apart again — a lava lamp in the
// screen's edge. Beats push them all a little further in.

vec4 lavaFragment() {
    vec2 p = pointOf(gl_FragCoord);
    float total;
    vec2 place = rimPlace(p, total);
    float depth = place.x;
    if (depth >= uBand) return vec4(0.0);
    float along = place.y / total;
    float t = uDrift;

    float field = 0.0, warm = 0.0;
    for (int i = 0; i < 6; i++) {
        float k = float(i);
        float seed = hash(vec2(k, 3.0), 30u);
        float speed = (0.012 + 0.02 * hash(vec2(k, 5.0), 30u)) * (i % 2 == 0 ? 1.0 : -1.0);
        float centre = fract(seed + t * speed);
        // Each blob breathes: longer and shorter as it goes, its length in points.
        float reachAlong = (160.0 + 220.0 * hash(vec2(k, 7.0), 30u)) * (0.8 + 0.25 * sin(t * 0.6 + k * 2.1));
        float gap = (fract(along - centre + 0.5) - 0.5) * total / reachAlong;
        float w = exp(-gap * gap * 2.0);
        field += w;
        warm += w * (i % 2 == 0 ? 0.0 : 1.0);
    }
    float b = field > 0.0001 ? warm / field : 0.0;
    vec3 tint = mix(uColorA, uColorB, b);

    // Melted: a firm body where the field is strong, a soft rim at its edge, nothing between.
    float melt = sstep(0.25, 0.7, field);
    float reach = uThickness * (0.35 + 1.15 * min(field, 1.6)) * mix(0.15, 1.0, uPresence) * uSwell;
    float core = exp(-depth / (reach * 0.16));
    float halo = exp(-(depth / reach) * (depth / reach));
    float fade = sstep(uBand, uBand * 0.75, depth);
    vec3 rgb = tint * (core + halo * uGlow) * fade * (0.12 + melt);
    rgb += core * 0.25 * melt;
    rgb *= pow(uPresence, 1.6) * uPulse;

    float noise = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
    rgb = max(rgb + (noise - 0.5) / 255.0, 0.0);
    rgb *= placeMask(p);
    float alpha = saturate(max(rgb.r, max(rgb.g, rgb.b)));
    return vec4(min(rgb, 1.0), alpha);
}
// The low rim every whole-rim light starts from: the two colors meeting halfway round.
vec3 rimTint(float along) {
    float b = 0.5 - 0.5 * cos(along * 2.0 * PI);
    return uColorA * (1.0 - b) + uColorB * b;
}

// ---- Fireflies ----
// Hundreds of tiny lights drifting near the edge, each wandering, rising and twinkling on
// its own; a beat lights them all at once. Under them, the faintest line of the rim.

vec4 firefliesFragment() {
    vec2 p = pointOf(gl_FragCoord);
    float total;
    vec2 place = rimPlace(p, total);
    float depth = place.x;
    if (depth >= uBand) return vec4(0.0);
    float s = place.y;
    float along = s / total;

    const float cell = 34.0;
    float cells = max(floor(total / cell), 3.0);
    float here = floor(along * cells);
    float glow = 0.0;
    vec3 color = vec3(0.0);
    for (int n = -1; n <= 1; n++) {
        for (int layer = 0; layer < 2; layer++) {
            float c = mod(here + float(n) + cells, cells);
            vec2 id = vec2(c, float(layer));
            float wander = sin(uDrift * (0.6 + hash(id, 50u)) + hash(id, 51u) * 6.283) * cell * 0.7;
            float home = (c + hash(id, 52u)) * total / cells + wander;
            float rise = 6.0 + hash(id, 53u) * (uBand * 0.7)
                       + sin(uDrift * (0.5 + hash(id, 54u)) + hash(id, 55u) * 6.283) * 10.0;
            float gap = fract((s - home) / total + 0.5) - 0.5;
            vec2 off = vec2(gap * total, depth - rise);
            float twinkle = pow(0.5 + 0.5 * sin(uTime * (0.8 + 1.6 * hash(id, 56u)) + hash(id, 57u) * 6.283), 3.0);
            float lit = mix(twinkle, 1.0, uBeat * 0.85);
            float r = 1.4 + hash(id, 58u) * 1.6;
            float d2 = dot(off, off);
            float spark = (exp(-d2 / (r * r)) * 1.6 + 0.35 * exp(-d2 / (16.0 * r * r))) * lit;
            glow += spark;
            color += spark * (hash(id, 59u) < 0.5 ? uColorA : uColorB);
        }
    }
    float line = exp(-depth / (uThickness * 0.1)) * 0.35;
    float fade = sstep(uBand, uBand * 0.8, depth);
    vec3 rgb = (color * (0.8 + 0.6 * uGlow) + glow * 0.25 + rimTint(along) * line) * fade;
    return finish(rgb, p);
}

// ---- Ripple ----
// The rim as still water: each beat drops light at a random place, and rings run out from
// it both ways along the edge, widening and fading, passing through one another.

vec4 rippleFragment() {
    vec2 p = pointOf(gl_FragCoord);
    float total;
    vec2 place = rimPlace(p, total);
    float depth = place.x;
    if (depth >= uBand) return vec4(0.0);
    float along = place.y / total;

    float rings = 0.0;
    for (int i = 0; i < 4; i++) {
        float age = uDrops[i];
        if (age < 0.0) continue;
        float d = abs(fract(along - uDropAt[i] + 0.5) - 0.5) * total;
        float front = age * 560.0;
        float width = 22.0 + 34.0 * age;
        float ring = (d - front) / width;
        float splash = exp(-(d / 40.0) * (d / 40.0)) * exp(-age * 7.0);
        rings += (exp(-ring * ring) + 0.45 * exp(-((d - front * 0.6) / width) * ((d - front * 0.6) / width))) * exp(-age * 0.9) * 1.5
               + splash * 1.6;
    }
    rings = min(rings, 1.6);
    float lift = saturate(rings);
    float reach = uThickness * mix(0.45, 1.3, lift) * mix(0.15, 1.0, uPresence);
    float core = exp(-depth / (reach * 0.16));
    float halo = exp(-(depth / reach) * (depth / reach));
    float fade = sstep(uBand, uBand * 0.75, depth);
    vec3 rgb = rimTint(along) * (core + halo * uGlow) * fade * (0.28 + rings) + core * 0.3 * lift * fade;
    return finish(rgb, p);
}

// ---- Breath ----
// The whole rim breathing, slow and deep: in, the light reaches in and brightens; out, it
// sinks to a thin line. Music deepens each breath; its colors turn slowly round.

vec4 breathFragment() {
    vec2 p = pointOf(gl_FragCoord);
    float total;
    vec2 place = rimPlace(p, total);
    float depth = place.x;
    if (depth >= uBand) return vec4(0.0);
    float along = place.y / total;

    float breath = 0.5 - 0.5 * cos(uDrift * 0.9);
    breath = breath * breath * (3.0 - 2.0 * breath);
    float lift = 0.25 + 0.75 * breath;
    float reach = uThickness * mix(0.4, 1.35, lift) * mix(0.15, 1.0, uPresence) * uSwell;
    float core = exp(-depth / (reach * 0.18));
    float halo = exp(-(depth / reach) * (depth / reach));
    float fade = sstep(uBand, uBand * 0.75, depth);
    float turn = fract(along + uDrift * 0.02);
    vec3 rgb = rimTint(turn) * (core + halo * uGlow) * fade * (0.3 + 0.8 * lift);
    return finish(rgb, p);
}

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

// ---- Helpers for the lights below ----

// Smooth value noise, 0...1, and four octaves of it.
float softNoise(vec2 x) {
    vec2 cell = floor(x), f = fract(x);
    vec2 w = f * f * (3.0 - 2.0 * f);
    float a = hash(cell, 20u), b = hash(cell + vec2(1, 0), 20u);
    float c = hash(cell + vec2(0, 1), 20u), d = hash(cell + vec2(1, 1), 20u);
    return mix(mix(a, b, w.x), mix(c, d, w.x), w.y);
}

float fbm(vec2 x) {
    float sum = 0.0, weight = 0.5;
    for (int i = 0; i < 4; i++) { sum += weight * softNoise(x); x = x * 2.03 + 17.0; weight *= 0.5; }
    return sum / 0.9375;
}


// ---- LED Strip ----
// The rim as a strip of real LEDs, one every 20 points: round dots that light up as a chase
// runs round (the snakes' heads, cut into lamps), in blocks of the two colors that shift
// along; a beat lights the whole strip. Each lamp throws a little light on the screen.

vec4 ledFragment() {
    vec2 p = pointOf(gl_FragCoord);
    float total;
    vec2 place = rimPlace(p, total);
    float depth = place.x;
    if (depth >= uBand) return vec4(0.0);
    float s = place.y;

    const float spacing = 20.0;
    float inset = 5.0 + uThickness * 0.08;
    float radius = 2.2 + uThickness * 0.025;
    float lamp = floor(s / spacing);
    vec2 off = vec2(s - (lamp + 0.5) * spacing, depth - inset);
    float dist = length(off);
    float at = (lamp + 0.5) * spacing / total;
    float chase = max(body(at, uHeadA, uSpan, uTaper), body(at, uHeadB, uSpan, uTaper));
    float level = 0.14 + 0.95 * saturate(chase) + 0.7 * uBeat;
    float block = floor(lamp / 5.0 + uDrift * 0.6);
    vec3 color = mod(block, 2.0) < 1.0 ? uColorA : uColorB;

    float bulb = exp(-(dist * dist) / (radius * radius));
    float halo = exp(-dist / (5.0 + uThickness * 0.12)) * 0.55 * (0.5 + uGlow);
    float wash = exp(-depth / (uThickness * 0.5)) * 0.12;
    float fade = sstep(uBand, uBand * 0.75, depth);
    vec3 rgb = (color * (bulb * 1.3 + halo) + bulb * 0.45) * level * fade + color * wash * level * fade;
    return finish(rgb, p);
}

// ---- Light Leaks ----
// Warm, soft light leaking in at the edges like on old film: a few broad patches that slide
// slowly round, swell and fade, tinted by the song's colors toward amber. A beat warms them.

vec4 leaksFragment() {
    vec2 p = pointOf(gl_FragCoord);
    float total;
    vec2 place = rimPlace(p, total);
    float depth = place.x;
    if (depth >= uBand) return vec4(0.0);

    float bend = min(uSize.x, uSize.y) * 0.2;
    vec3 rgb = vec3(0.0);
    for (int i = 0; i < 4; i++) {
        float k = float(i);
        float speed = (0.006 + 0.01 * hash(vec2(k, 1.0), 70u)) * (i % 2 == 0 ? 1.0 : -1.0);
        float centre = fract(hash(vec2(k, 2.0), 70u) + uDrift * speed);
        vec2 c = rimPoint(centre, 0.0, uSize, bend);
        float radius = (240.0 + 200.0 * hash(vec2(k, 3.0), 70u)) * (0.6 + 0.4 * uThickness / 34.0);
        float swell = 0.45 + 0.55 * (0.5 + 0.5 * sin(uDrift * (0.35 + 0.2 * k) + k * 2.1));
        float d = length(p - c) / radius;
        float blob = exp(-d * d * 1.8) * swell;
        vec3 warm = mix(i % 2 == 0 ? uColorA : uColorB, vec3(1.0, 0.55, 0.22), 0.35);
        rgb += warm * blob;
    }
    rgb *= (0.55 + 0.5 * uGlow) * (1.0 + 0.5 * uBeat);
    rgb += rgb * (hash(floor(gl_FragCoord.xy * 0.5) + floor(uTime * 12.0), 71u) - 0.5) * 0.12;   // a little grain
    rgb *= sstep(uBand, uBand * 0.6, depth);
    return finish(rgb, p);
}

// ---- Smoke ----
// Thin smoke in the song's colors curling up from the bottom of the screen, drifting and
// thinning as it rises; a faint line glows where it starts.

vec4 smokeFragment() {
    vec2 p = pointOf(gl_FragCoord);
    float total;
    vec2 place = rimPlace(p, total);
    float depth = place.x;
    if (depth >= uBand) return vec4(0.0);

    float rise = uSize.y - p.y;
    float reach = uThickness * 3.4 * uSwell;
    vec2 q = vec2(p.x / 230.0 + uDrift * 0.04, rise / 150.0 - uDrift * 0.45);
    float curl = fbm(q + vec2(fbm(q * 1.7 + uDrift * 0.1), 0.0) * 0.8);
    float density = sstep(0.42, 0.85, curl) * exp(-rise / reach);
    vec3 tint = mix(uColorA, uColorB, softNoise(vec2(p.x / 600.0 + uDrift * 0.08, 5.0)));
    float base = exp(-rise / (uThickness * 0.14)) * 0.45;
    float fade = sstep(uBand, uBand * 0.7, depth);
    vec3 rgb = tint * (density * (0.7 + 0.6 * uGlow) + base) * fade;
    return finish(rgb, p);
}

// ---- Lyrics Ticker ----
// The line being sung, in lights, running along the top and the bottom of the screen like a
// stadium's ticker, both the right way up; a thin line of the song's colors goes all round.

vec4 tickerFragment() {
    vec2 p = pointOf(gl_FragCoord);
    float total;
    vec2 place = rimPlace(p, total);
    float depth = place.x;
    if (depth >= uBand) return vec4(0.0);
    float along = place.y / total;
    vec3 tint = rimTint(along);

    float line = exp(-depth / (uThickness * 0.14)) * 0.4;
    vec3 rgb = tint * line;

    bool top = p.y < uSize.y * 0.5;
    float fromEdge = top ? p.y : uSize.y - p.y;
    float inset = 6.0;
    float height = uStrip.y;
    float v = (fromEdge - inset) / height;
    if (v > -0.4 && v < 1.4 && uStrip.x > 1.0) {
        float textV = top ? v : 1.0 - v;
        float x = (p.x + uStrip.z) / uStrip.x;
        float letters = (v >= 0.0 && v <= 1.0) ? texture(uWords, vec2(fract(x), textV)).r : 0.0;
        vec2 nudge = vec2(3.0 / uStrip.x, 3.0 / height);
        float aura = 0.0;
        for (int i = 0; i < 4; i++) {
            vec2 o = vec2(i < 2 ? (i == 0 ? -1.0 : 1.0) : 0.0, i >= 2 ? (i == 2 ? -1.0 : 1.0) : 0.0) * nudge;
            float vv = clamp(textV + o.y, 0.0, 1.0);
            aura += texture(uWords, vec2(fract(x + o.x), vv)).r;
        }
        aura *= 0.25;
        rgb += (tint * 0.45 + 0.55) * letters * 1.1 + tint * aura * (0.5 + 0.5 * uGlow) * (1.0 + 0.6 * uBeat);
    }
    rgb *= sstep(uBand, uBand * 0.75, depth);
    return finish(rgb, p);
}

// ---- Floating shapes: hearts, bubbles, stars, confetti ----
// Little shapes let go at the rim that float in toward the middle, sway, and fade before they
// get far; a beat makes them bigger and lets more of them go. The rim is cut into cells, each
// letting go two shapes a cycle, staggered, so the flow never stops or pulses in step.

const int SHAPE_HEART = 0, SHAPE_BUBBLE = 1, SHAPE_STAR = 2, SHAPE_CONFETTI = 3, SHAPE_NOTE = 4, SHAPE_PETAL = 5,
             SHAPE_BUTTERFLY = 6, SHAPE_SNOW = 7;

// q turned by angle.
vec2 turned(vec2 q, float angle) {
    return vec2(cos(angle) * q.x - sin(angle) * q.y, sin(angle) * q.x + cos(angle) * q.y);
}

// An ellipse's distance, near enough for small shapes: radii r.
float ovalShape(vec2 q, vec2 r) {
    return (length(q / r) - 1.0) * min(r.x, r.y);
}

// A music note, one size tall: a tilted round head with a stem and a flag (♪), or two heads
// joined by a beam (♫).
float noteShape(vec2 q, float size, bool pair) {
    vec2 head = turned(q - vec2(-0.25, 0.55) * size, 0.45);
    float d = ovalShape(head, vec2(0.36, 0.26) * size);
    vec2 stem = abs(q - vec2(0.07, -0.05) * size) - vec2(0.045, 0.6) * size;
    d = min(d, length(max(stem, 0.0)) + min(max(stem.x, stem.y), 0.0));
    if (pair) {
        vec2 head2 = turned(q - vec2(0.75, 0.4) * size, 0.45);
        d = min(d, ovalShape(head2, vec2(0.36, 0.26) * size));
        vec2 stem2 = abs(q - vec2(1.07, -0.2) * size) - vec2(0.045, 0.6) * size;
        d = min(d, length(max(stem2, 0.0)) + min(max(stem2.x, stem2.y), 0.0));
        vec2 beam = turned(q - vec2(0.57, -0.72) * size, 0.15);
        vec2 b = abs(beam) - vec2(0.55, 0.09) * size;
        d = min(d, length(max(b, 0.0)) + min(max(b.x, b.y), 0.0));
    } else {
        vec2 flag = turned(q - vec2(0.3, -0.38) * size, -0.9);
        d = min(d, ovalShape(flag, vec2(0.28, 0.08) * size));
    }
    return d;
}

// A butterfly's two pairs of wings, beating: beat 0 shut, 1 spread.
float butterflyShape(vec2 q, float size, float open) {
    vec2 w = vec2(abs(q.x) / max(open, 0.15), q.y);
    float d = ovalShape(turned(w - vec2(0.5, -0.3) * size, -0.5), vec2(0.5, 0.38) * size);
    d = min(d, ovalShape(turned(w - vec2(0.38, 0.32) * size, 0.4), vec2(0.34, 0.25) * size));
    d *= max(open, 0.15);
    d = min(d, ovalShape(q, vec2(0.07, 0.45) * size));
    return d;
}

float dot2(vec2 v) { return dot(v, v); }

// A heart one unit tall, its tip at the origin and pointing down the screen (Inigo Quilez's).
float heartShape(vec2 p) {
    p.x = abs(p.x);
    if (p.y + p.x > 1.0) return sqrt(dot2(p - vec2(0.25, 0.75))) - sqrt(2.0) / 4.0;
    return sqrt(min(dot2(p - vec2(0.0, 1.0)), dot2(p - 0.5 * max(p.x + p.y, 0.0)))) * sign(p.x - p.y);
}

// A five-pointed star of radius r, its inner points rf of the way in (Inigo Quilez's).
float starShape(vec2 p, float r, float rf) {
    const vec2 k1 = vec2(0.809016994375, -0.587785252292);
    const vec2 k2 = vec2(-k1.x, k1.y);
    p.x = abs(p.x);
    p -= 2.0 * max(dot(k1, p), 0.0) * k1;
    p -= 2.0 * max(dot(k2, p), 0.0) * k2;
    p.x = abs(p.x);
    p.y -= r;
    vec2 ba = rf * vec2(-k1.y, k1.x) - vec2(0.0, 1.0);
    float h = clamp(dot(p, ba) / dot(ba, ba), 0.0, r);
    return length(p - ba * h) * sign(p.y * ba.x - p.x * ba.y);
}

vec4 floaters(int shape) {
    vec2 p = pointOf(gl_FragCoord);
    float total;
    vec2 place = rimPlace(p, total);
    float depth = place.x;
    if (depth >= uBand) return vec4(0.0);
    float along = place.y / total;

    float bend = min(uSize.x, uSize.y) * 0.2;
    const float cellLength = 90.0;
    float cells = max(floor(total / cellLength), 4.0);
    float here = floor(along * cells);
    float lifetime = shape == SHAPE_CONFETTI ? 2.2 : 3.6;
    float scaleBy = 0.6 + 0.4 * uThickness / 34.0;
    vec3 rgb = vec3(0.0);

    for (int n = -1; n <= 1; n++) {
        for (int j = 0; j < 2; j++) {
            float c = mod(here + float(n) + cells, cells);
            float cycle = uDrift * 1.6 / lifetime + hash(vec2(c, float(j)), 81u) + 0.5 * float(j);
            float age = fract(cycle);
            vec2 id = vec2(c * 2.0 + float(j), floor(cycle));
            // About half the cells let a shape go each cycle; the beat makes them bigger and brighter, never pops
            // them in or out halfway.
            if (hash(id, 82u) > 0.55) continue;
            float sway = sin(age * 5.0 + hash(id, 86u) * 6.283) * 14.0;
            float at = fract((c + hash(id, 83u)) / cells + sway / total);
            float travel = uBand * (shape == SHAPE_CONFETTI ? 0.8 : 0.7);
            vec2 centre = shape == SHAPE_SNOW
                ? rimPoint(at, 8.0, uSize, bend) + vec2(sway * 0.6, age * travel)
                : rimPoint(at, 8.0 + age * travel, uSize, bend);
            vec2 q = p - centre;
            float size = (7.0 + hash(id, 84u) * 8.0) * scaleBy * (1.0 + 0.35 * uBeat);
            float fade = sstep(0.0, 0.12, age) * (1.0 - sstep(0.55, 1.0, age));
            float far = dot(q, q) / (size * size);
            if (far > 20.0) continue;
            // Far from its shape, a glow fades out smoothly rather than stopping at an edge.
            float within = 1.0 - sstep(8.0, 20.0, far);

            float d;
            vec3 color = hash(id, 85u) < 0.5 ? uColorA : uColorB;
            float shine = 0.0;
            if (shape == SHAPE_HEART) {
                d = heartShape(vec2(q.x, -q.y) / size + vec2(0.0, 0.5)) * size;
            } else if (shape == SHAPE_STAR) {
                float spin = (hash(id, 87u) - 0.5) * 1.2 + age * (hash(id, 88u) - 0.5) * 2.0;
                vec2 r = vec2(cos(spin) * q.x - sin(spin) * q.y, sin(spin) * q.x + cos(spin) * q.y);
                d = starShape(vec2(r.x, -r.y), size, 0.45);
                color = mix(color, vec3(1.0), 0.25);
            } else if (shape == SHAPE_BUBBLE) {
                float ring = length(q) - size * 1.2;
                d = abs(ring) - 0.9;
                // A bright glint up and to the left, and the faintest film inside.
                shine = exp(-dot2(q - vec2(-0.45, -0.45) * size * 1.2) / (size * size * 0.04)) * 1.2
                      + sstep(0.0, -size, ring) * 0.08;
                color = mix(color, vec3(1.0), 0.3);
            } else if (shape == SHAPE_NOTE) {
                float tilt = (hash(id, 87u) - 0.5) * 0.6 + sin(age * 4.0 + hash(id, 88u) * 6.0) * 0.15;
                d = noteShape(turned(q, tilt), size * 1.4, hash(id, 89u) < 0.4);
            } else if (shape == SHAPE_PETAL) {
                float spin = hash(id, 87u) * 6.283 + age * (1.5 + 2.0 * hash(id, 88u));
                vec2 r = turned(q, spin);
                // A petal: long and narrow, pointed at one end, the turn showing it edge-on now and then.
                float flip = 0.35 + 0.65 * abs(cos(age * 3.0 + hash(id, 89u) * 6.0));
                // A lens: where two circles overlap, pointed at both ends, narrowed as it turns edge-on.
                vec2 w = vec2(r.x / flip, r.y);
                d = max(length(w - vec2(size * 0.62, 0.0)), length(w + vec2(size * 0.62, 0.0))) - size;
                d *= flip;
                color = mix(color, vec3(1.0, 0.85, 0.9), 0.35);
            } else if (shape == SHAPE_BUTTERFLY) {
                float open = 0.2 + 0.8 * abs(sin(uTime * (9.0 + 4.0 * hash(id, 87u)) + hash(id, 88u) * 6.0));
                d = butterflyShape(turned(q, sway * 0.02), size * 2.3, open);
            } else if (shape == SHAPE_SNOW) {
                d = length(q) - size * 0.35;
                // The faintest six-pointed glint across the flake.
                float a = atan(q.y, q.x);
                shine = pow(abs(cos(3.0 * a)), 24.0) * exp(-length(q) / (size * 0.9)) * 0.6;
                color = mix(color, vec3(1.0), 0.6);
            } else {
                float spin = hash(id, 87u) * 6.283 + age * (4.0 + 6.0 * hash(id, 88u));
                vec2 r = vec2(cos(spin) * q.x - sin(spin) * q.y, sin(spin) * q.x + cos(spin) * q.y);
                vec2 half_ = vec2(size * 0.9, size * 0.38 * abs(cos(age * 9.0 + hash(id, 89u) * 6.0)) + 0.6);
                vec2 e = abs(r) - half_;
                d = length(max(e, 0.0)) + min(max(e.x, e.y), 0.0);
                float pick = hash(id, 90u);
                color = pick < 0.4 ? uColorA : pick < 0.8 ? uColorB : vec3(1.0);
            }
            float fill = sstep(1.0, -0.7, d);
            float glow = exp(-max(d, 0.0) / (3.0 + size * 0.3)) * 0.5 * uGlow * within;
            rgb += (color * (fill * 1.15 + glow) + shine) * fade;
        }
    }
    float line = exp(-depth / (uThickness * 0.12)) * 0.3;
    rgb += rimTint(along) * line;
    rgb *= sstep(uBand, uBand * 0.8, depth);
    return finish(rgb, p);
}

vec4 heartsFragment() {
    return floaters(SHAPE_HEART);
}
vec4 bubblesFragment() {
    return floaters(SHAPE_BUBBLE);
}
vec4 starsFragment() {
    return floaters(SHAPE_STAR);
}
vec4 confettiFragment() {
    return floaters(SHAPE_CONFETTI);
}
vec4 notesFragment() {
    return floaters(SHAPE_NOTE);
}
vec4 petalsFragment() {
    return floaters(SHAPE_PETAL);
}
vec4 butterfliesFragment() {
    return floaters(SHAPE_BUTTERFLY);
}
vec4 snowFragment() {
    return floaters(SHAPE_SNOW);
}

// ---- Fire ----
// Flames rising from the bottom of the screen in the song's colors, hot white-gold at their
// roots; the music feeds them, a beat throws them higher.

vec4 fireFragment() {
    vec2 p = pointOf(gl_FragCoord);
    float total;
    vec2 place = rimPlace(p, total);
    float depth = place.x;
    if (depth >= uBand) return vec4(0.0);

    float rise = uSize.y - p.y;
    float tall = uThickness * 2.6 * uSwell;
    float t = uDrift * 2.2;
    vec2 q = vec2(p.x / 70.0, rise / 90.0 - t);
    float flame = fbm(q + vec2(0.0, fbm(q * 0.5 + t * 0.3) * 0.6));
    float heat = saturate(flame * 1.25 - rise / tall);
    heat = sstep(0.05, 0.85, heat);
    vec3 ember = mix(uColorB, uColorA, sstep(0.1, 0.6, heat));
    vec3 rgb = mix(ember, vec3(1.0, 0.92, 0.7), sstep(0.65, 1.0, heat)) * heat * (0.8 + 0.5 * uGlow);
    rgb += mix(uColorA, vec3(1.0), 0.4) * exp(-rise / (uThickness * 0.15)) * 0.5;
    rgb *= sstep(uBand, uBand * 0.7, depth);
    return finish(rgb, p);
}

// ---- Lightning ----
// On each hard beat, electricity crackles along the rim where it strikes: a jagged white-hot
// bolt that forks inward and flickers out. Between strikes, a faint charged line.

vec4 lightningFragment() {
    vec2 p = pointOf(gl_FragCoord);
    float total;
    vec2 place = rimPlace(p, total);
    float depth = place.x;
    if (depth >= uBand) return vec4(0.0);
    float s = place.y;
    float along = s / total;
    vec3 tint = rimTint(along);
    vec3 rgb = tint * exp(-depth / (uThickness * 0.1)) * 0.3;

    for (int i = 0; i < 4; i++) {
        float age = uDrops[i];
        if (age < 0.0 || age > 0.6) continue;
        float gap = (fract(along - uDropAt[i] + 0.5) - 0.5) * total;
        float reach = 260.0 + 200.0 * hash(vec2(float(i), floor(uDropAt[i] * 997.0)), 91u);
        if (abs(gap) > reach) continue;
        float seed = uDropAt[i] * 131.0;
        // The bolt: a line a little in from the edge, jagged at two scales; a fork inward from where it struck.
        float jag = (softNoise(vec2(s / 26.0, seed)) - 0.5) * 18.0 + (softNoise(vec2(s / 7.0, seed + 3.0)) - 0.5) * 6.0;
        float line = 10.0 + uThickness * 0.15 + jag;
        float d = abs(depth - line);
        float fork = abs(gap - (depth - 10.0) * 0.45 * (hash(vec2(seed, 1.0), 92u) - 0.5) * 2.0
                         - (softNoise(vec2(depth / 14.0, seed + 7.0)) - 0.5) * 16.0);
        float forkReach = 60.0 + 80.0 * hash(vec2(seed, 2.0), 92u);
        float forked = depth < forkReach ? fork : 1e4;
        float dd = min(d, forked);
        float flicker = step(0.3, hash(vec2(floor(uTime * 30.0), seed), 93u)) * 0.6 + 0.4;
        float life = exp(-age * 7.0) * flicker * (1.0 - sstep(reach * 0.6, reach, abs(gap)));
        float core = exp(-(dd * dd) / 1.6);
        float glow = exp(-dd / (6.0 + uThickness * 0.2)) * (0.5 + 0.6 * uGlow);
        rgb += (vec3(1.0) * core + mix(uColorA, vec3(0.85, 0.9, 1.0), 0.5) * glow) * life;
    }
    rgb *= sstep(uBand, uBand * 0.75, depth);
    return finish(rgb, p);
}

// ---- Fireworks ----
// Each beat sends up a small firework from the rim: it bursts into a ring of sparks that fly
// out, slow, droop and fade, in one of the song's colors or white.

vec4 fireworksFragment() {
    vec2 p = pointOf(gl_FragCoord);
    float total;
    vec2 place = rimPlace(p, total);
    float depth = place.x;
    if (depth >= uBand) return vec4(0.0);
    float along = place.y / total;
    float bend = min(uSize.x, uSize.y) * 0.2;
    vec3 rgb = rimTint(along) * exp(-depth / (uThickness * 0.1)) * 0.25;

    for (int i = 0; i < 4; i++) {
        float age = uDrops[i];
        if (age < 0.0 || age > 2.0) continue;
        float seed = uDropAt[i] * 977.0;
        vec2 centre = rimPoint(uDropAt[i], 70.0 + 90.0 * hash(vec2(seed, 1.0), 94u), uSize, bend);
        float radius = (120.0 + 80.0 * hash(vec2(seed, 2.0), 94u)) * (1.0 - exp(-age * 3.2));
        vec2 v = p - centre - vec2(0.0, 26.0 * age * age);
        float r = length(v);
        if (r > radius + 30.0) continue;
        const float rays = 22.0;
        float a = atan(v.y, v.x);
        float k = round(a / (2.0 * PI / rays));
        float ka = k * 2.0 * PI / rays;
        vec2 spark = vec2(cos(ka), sin(ka)) * radius;
        float d = length(v - spark);
        // A short streak behind each spark, toward the centre.
        vec2 dir = vec2(cos(ka), sin(ka));
        float back = dot(v, dir);
        float side = abs(dot(v, vec2(-dir.y, dir.x)));
        float streak = (back < radius && back > radius - 34.0 * exp(-age)) ? exp(-side * side / 2.0) * 0.8 : 0.0;
        float life = exp(-age * 1.6) * (0.75 + 0.25 * sin(uTime * 40.0 + k));
        float pick = hash(vec2(seed, 3.0), 94u);
        vec3 color = pick < 0.4 ? uColorA : pick < 0.8 ? uColorB : vec3(1.0);
        rgb += (mix(color, vec3(1.0), 0.35) * (exp(-d * d / 9.0) * 1.5 + streak) + color * exp(-d / 12.0) * 0.6 * uGlow) * life;
    }
    rgb *= sstep(uBand, uBand * 0.8, depth);
    return finish(rgb, p);
}

// ---- Rain ----
// Light running down the sides of the screen like rain down a window: drops in a few lanes
// near each side edge, each with a bright head and a fading trail.

vec4 rainFragment() {
    vec2 p = pointOf(gl_FragCoord);
    float total;
    vec2 place = rimPlace(p, total);
    float depth = place.x;
    if (depth >= uBand) return vec4(0.0);
    float along = place.y / total;
    vec3 tint = rimTint(along);
    vec3 rgb = tint * exp(-depth / (uThickness * 0.1)) * 0.3;

    float fromSide = min(p.x, uSize.x - p.x);
    bool left = p.x < uSize.x * 0.5;
    const float laneWidth = 16.0;
    float lane = floor(fromSide / laneWidth);
    if (lane < 4.0) {
        float laneX = (lane + 0.5) * laneWidth;
        for (int j = 0; j < 4; j++) {
            vec2 id = vec2(lane + (left ? 0.0 : 10.0), float(j));
            float speed = 140.0 + 160.0 * hash(id, 95u);
            float span = uSize.y + 300.0;
            float head = fract(uDrift * speed / span * 0.9 + hash(id, 96u)) * span - 150.0;
            float length_ = 30.0 + 50.0 * hash(id, 97u);
            float wobble = sin(head / 40.0 + hash(id, 98u) * 6.0) * 2.0;
            float dx = abs(fromSide - laneX - wobble);
            float dy = head - p.y;   // above the head is the trail
            float trail = (dy > 0.0 && dy < length_) ? (1.0 - dy / length_) : 0.0;
            float drop = exp(-(dx * dx + dy * dy) / 5.0) * 1.3;
            float line = exp(-dx * dx / 0.8) * trail * trail * 0.5;
            float glow = exp(-dx / 5.0) * (trail * 0.4 + exp(-abs(dy) / 8.0) * 0.6) * uGlow;
            vec3 color = hash(id, 99u) < 0.5 ? uColorA : uColorB;
            rgb += (mix(color, vec3(1.0), 0.35) * (drop + line) + color * glow) * (1.0 + 0.5 * uBeat);
        }
    }
    rgb *= sstep(uBand, uBand * 0.8, depth);
    return finish(rgb, p);
}
`;
