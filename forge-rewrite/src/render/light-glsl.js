// The lighting passes' programs (lighting-design.md F3, F6 here; F4 in ground-glsl.js, F5 in card-glsl.js). One irradiance function, shared: 1.7's
// normal-lighting.js:73-85 output (ambient + each admitted light's colour x falloff x (0.22 + Lambert), then a soft limit
// above 1), with 1.7's field read as 1.7 read it: per light a reach bit per tile, ramped across the half tile round
// each tile edge (two samples a tile, straight between them), nothing blurred. Numbering: tiles, a corner on whole
// numbers. Every number comes from data/lighting.json through uniforms.

export const MAX_LIGHTS = 32;

/** The shared part: the per-step pictures, the light arrays, admission, grain, daylight and the light sum. */
export const SHARED = `
uniform sampler2D uAdmit;   // a texel a tile: light bits 0-31 in RGBA
uniform sampler2D uSurf;    // a texel a tile: kind, area, fluid, in sight (255) / remembered (128) / never seen (0)
uniform sampler2D uAmb;     // samples a tile: ambient RGB, rock reach A (linear)
uniform vec4 uFloor;        // floor width, height (tiles), samples a tile, 0
uniform vec4 uShade;        // diffuse floor, limit knee, wall height, face share
uniform vec4 uGrain;        // base, span, scale, 0
uniform int uCount;
uniform vec4 uLPos[${MAX_LIGHTS}];   // x, y (tiles), height, radius
uniform vec4 uLCol[${MAX_LIGHTS}];   // colour x strength x flicker, falloff
uniform vec4 uLDay[${MAX_LIGHTS}];   // daylight beam radius (0: an ordinary light), lean, spill, 0

const int K_NONE = 0, K_FLOOR = 1, K_FACE = 2, K_TOP = 3, K_FLAT = 4, K_DOOR = 5;

uint bitsAt(ivec2 t) {
  if (t.x < 0 || t.y < 0 || t.x >= int(uFloor.x) || t.y >= int(uFloor.y)) return 0u;
  uvec4 b = uvec4(texelFetch(uAdmit, t, 0) * 255.0 + 0.5);
  return b.r | (b.g << 8) | (b.b << 16) | (b.a << 24);
}
// The four tiles round a point and where in the cross-edge ramp it stands (1.7: 2 samples a tile, linear between).
struct Adm { uint b00; uint b10; uint b01; uint b11; uint any; vec2 f; };
Adm admitAt(vec2 p) {
  vec2 q = p - 0.5, fl = floor(q);
  ivec2 t = ivec2(fl);
  Adm a;
  a.b00 = bitsAt(t); a.b10 = bitsAt(t + ivec2(1, 0)); a.b01 = bitsAt(t + ivec2(0, 1)); a.b11 = bitsAt(t + ivec2(1, 1));
  a.any = a.b00 | a.b10 | a.b01 | a.b11;
  a.f = clamp((q - fl - 0.25) * 2.0, 0.0, 1.0);
  return a;
}
float admitted(Adm a, int k) {
  uint m = 1u << uint(k);
  float v00 = (a.b00 & m) != 0u ? 1.0 : 0.0, v10 = (a.b10 & m) != 0u ? 1.0 : 0.0;
  float v01 = (a.b01 & m) != 0u ? 1.0 : 0.0, v11 = (a.b11 & m) != 0u ? 1.0 : 0.0;
  return mix(mix(v00, v10, a.f.x), mix(v01, v11, a.f.x), a.f.y);
}
vec4 surfAt(vec2 p) {
  ivec2 t = ivec2(floor(p));
  if (t.x < 0 || t.y < 0 || t.x >= int(uFloor.x) || t.y >= int(uFloor.y)) return vec4(0.0);
  return texelFetch(uSurf, t, 0);
}
vec4 ambAt(vec2 p) { return texture(uAmb, p / uFloor.xy); }

float hashv(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = p - i, u = f * f * (3.0 - 2.0 * f);
  float a = hashv(i), b = hashv(i + vec2(1.0, 0.0)), c = hashv(i + vec2(0.0, 1.0)), d = hashv(i + vec2(1.0, 1.0));
  return a + (b - a) * u.x + (c - a) * u.y + (a - b - c + d) * u.x * u.y;
}
// The floor's mottling on ambient (1.7 level-lighting.js:293: 0.93 + 0.09 x value noise at 0.7 scale).
float grainAt(vec2 p) { return uGrain.x + uGrain.y * noise(p * uGrain.z); }

// A daylight patch at a point (1.7 levelDaylightParts, level-lighting.js:65-75): the slanted beam and its faint spill.
vec2 dayParts(int k, vec2 p) {
  vec4 L = uLPos[k], D = uLDay[k];
  float g = noise(vec2(p.x * 1.1, p.y * 0.9) + 53.0);
  vec2 d = L.xy - p;
  float across = (d.x - d.y * D.y + 0.15 * (g - 0.5)) / (0.48 * (0.91 + 0.18 * g));
  float e = clamp((length(vec2(across, d.y)) / D.x - 0.22) / 0.78, 0.0, 1.0);
  float core = (1.0 - e * e * (3.0 - 2.0 * e)) * (0.94 + 0.06 * g);
  float spill = D.z * pow(max(0.0, 1.0 - length(d) / L.w), uLCol[k].w);
  return vec2(core, spill);
}

// The light the admitted lights lay on a receiver: pt the receiver (x, y, height), n its normal (x right, y up, z out),
// fp where each light's reach is measured, cut: a face takes only lights at or south of its foot line (1.7
// level-lighting.js:264), self: the hero's own lamp (light 0) is scaled by it on his own body (render.js:1151).
// Item 271: the placed lights on a pixel add as they are up to the knee, then ease toward the cap by their brightest
// channel, so a hue keeps and a cluster of candles reads as one warm area (pipeline.stack).
uniform vec4 uStack;  // knee, cap
vec3 stacked(vec3 v) {
  float peak = max(v.r, max(v.g, v.b)), span = uStack.y - uStack.x;
  return peak <= uStack.x ? v : v * (uStack.x + span * (1.0 - exp(-(peak - uStack.x) / span))) / peak;
}
vec3 lightSum(Adm a, vec3 pt, vec3 n, vec3 plain, bool formed, vec2 fp, float cut, float self) {
  vec3 lit = vec3(0.0), own = vec3(0.0);   // the placed lights; the hero's lamp (light 0) and daylight
  // Overlapping daylight spill shares one soft ceiling; beams keep their own strength (level-lighting.js:76-82).
  float spill = 0.0;
  for (int k = 0; k < ${MAX_LIGHTS}; k++) {
    if (k >= uCount) break;
    if (uLDay[k].x <= 0.0 || ((a.any >> uint(k)) & 1u) == 0u) continue;
    spill += dayParts(k, fp).y * admitted(a, k);
  }
  float ex = max(0.0, spill - 0.14), spillScale = spill > 0.14 ? (0.14 + 0.04 * ex / (0.04 + ex)) / spill : 1.0;
  for (int k = 0; k < ${MAX_LIGHTS}; k++) {
    if (k >= uCount) break;
    if (((a.any >> uint(k)) & 1u) == 0u) continue;
    vec4 L = uLPos[k];
    if (L.y < cut) continue;
    float adm = admitted(a, k);
    if (adm <= 0.0) continue;
    float w;
    if (uLDay[k].x > 0.0) { vec2 dp = dayParts(k, fp); w = dp.x + dp.y * spillScale; }
    else { float d = length(L.xy - fp); if (d >= L.w) continue; w = pow(1.0 - d / L.w, uLCol[k].w); }
    vec3 dl = vec3(L.x - pt.x, pt.y - L.y, L.z - pt.z);
    float len = length(dl);
    vec3 dir = len > 0.0001 ? dl / len : vec3(0.0, 0.0, 1.0);
    float diffuse = max(0.0, dot(n, dir));
    if (formed) diffuse = max(diffuse, 0.6 * max(0.0, dot(plain, dir)));
    vec3 add = uLCol[k].rgb * (w * adm * (uShade.x + diffuse) * (k == 0 ? self : 1.0));
    if (k == 0 || uLDay[k].x > 0.0) own += add; else lit += add;
  }
  return own + stacked(lit);
}
// Above 1 the light rolls off with one scale for all three channels, so its hue survives (normal-lighting.js:30).
vec3 limitLight(vec3 v) {
  float peak = max(v.r, max(v.g, v.b));
  if (peak <= 1.0) return v;
  float ex = peak - 1.0;
  return v * ((1.0 + uShade.y * ex / (uShade.y + ex)) / peak);
}
// The final knee (normal-lighting.js:93-94): lit highlights bend toward 0.97 above the paint's own brightest channel.
uniform vec2 uKnee;   // floor of the knee, its top
vec3 kneeOf(vec3 paint, vec3 light) {
  vec3 rgb = paint * light;
  float peak = max(rgb.r, max(rgb.g, rgb.b)), knee = max(uKnee.x, max(paint.r, max(paint.g, paint.b)));
  if (peak > knee) { float span = max(0.0, uKnee.y - knee), ex = peak - knee; rgb *= (knee + span * ex / (span + ex)) / peak; }
  return rgb;
}
// The world's colour grade (item 254, Justin 2026-10-20: "make the visuals pop more"), the lit passes' last step:
// vibrance lifts a dull colour more than a strong one (the Crypt's green, Shadow's violet keep theirs), then a gentle
// S-curve about the pivot takes the darks down and the lights up, black and white held.
uniform vec4 uGrade;  // vibrance, contrast, pivot, 0
vec3 graded(vec3 c) {
  float hi = max(c.r, max(c.g, c.b)), sat = hi > 0.0 ? (hi - min(c.r, min(c.g, c.b))) / hi : 0.0;
  c = clamp(mix(vec3(dot(c, vec3(0.299, 0.587, 0.114))), c, 1.0 + uGrade.x * (1.0 - sat)), 0.0, 1.0);
  return clamp(c + uGrade.y * (c - uGrade.z) * c * (1.0 - c) * 4.0, 0.0, 1.0);
}
`;

/** Filters on screen: the input picture, where the map root is, and how screen pixels map to tiles. */
export const FILTER_VERTEX = `#version 300 es
precision highp float;
in vec2 aPosition;
out vec2 vTextureCoord;
out vec2 vGlobal;
uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;
void main() {
  vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;
  vGlobal = position;
  position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
  position.y = position.y * (2.0 * uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;
  gl_Position = vec4(position, 0.0, 1.0);
  vTextureCoord = aPosition * (uOutputFrame.zw * uInputSize.zw);
}`;

/** A mesh drawn into a picture (the light field). */
export const MESH_VERTEX = `#version 300 es
precision highp float;
in vec2 aPosition;
in vec2 aUV;
out vec2 vUV;
uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;
void main() {
  mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
  vUV = aUV;
}`;

/**
 * F3, the light field: the flat light at each sample over a window (1.7's light map values: ambient x grain + each
 * admitted light's falloff, faces from the floor tile below, x share; a wall top its mass plus bleed of the open samples
 * beside it), then 1.7's ceiling above 1. Read by wall tops, the bloom and the classic look. Stored at half.
 */
export const FIELD_FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
in vec2 vUV;
out vec4 finalColor;
uniform vec4 uWin;      // window origin and size, tiles
uniform vec4 uBleed;    // bleed for this floor (brick or rock), light ceiling, 0, 0
${SHARED}
vec3 flatAt(vec2 sp, bool face) {
  // An open or face sample's flat light: its lamps at their reach (faces from the tile below, only lights at or south
  // of the foot line, x share), no Lambert (1.7's light map is flat).
  vec2 fp = face ? vec2(sp.x, floor(sp.y) + 1.5) : sp;
  Adm a = admitAt(fp);
  vec3 lit = vec3(0.0), own = vec3(0.0);   // the placed lights; the hero's lamp and daylight (item 271)
  float spill = 0.0;
  for (int k = 0; k < ${MAX_LIGHTS}; k++) { if (k >= uCount) break; if (uLDay[k].x > 0.0 && ((a.any >> uint(k)) & 1u) != 0u) spill += dayParts(k, fp).y * admitted(a, k); }
  float ex = max(0.0, spill - 0.14), sc = spill > 0.14 ? (0.14 + 0.04 * ex / (0.04 + ex)) / spill : 1.0;
  for (int k = 0; k < ${MAX_LIGHTS}; k++) {
    if (k >= uCount) break;
    if (((a.any >> uint(k)) & 1u) == 0u) continue;
    vec4 L = uLPos[k];
    if (face && L.y < floor(sp.y) + 1.0) continue;
    float adm = admitted(a, k), w;
    if (adm <= 0.0) continue;
    if (uLDay[k].x > 0.0) { vec2 dp = dayParts(k, fp); w = dp.x + dp.y * sc; }
    else { float d = length(L.xy - fp); if (d >= L.w) continue; w = pow(1.0 - d / L.w, uLCol[k].w); }
    if (k == 0 || uLDay[k].x > 0.0) own += uLCol[k].rgb * w * adm; else lit += uLCol[k].rgb * w * adm;
  }
  return own + stacked(lit);
}
void main() {
  vec2 sp = uWin.xy + vUV * uWin.zw;   // this sample's centre, tiles
  vec4 s = surfAt(sp);
  int kind = int(s.r * 255.0 + 0.5);
  vec4 am = ambAt(sp);
  vec3 v;
  if (s.a < 0.25) v = vec3(0.0);
  else if (s.a < 0.75) v = am.rgb;   // remembered: the memory colour, no lamp
  else if (kind == K_TOP) {
    // A top: its own ambient (mass and ambient bleed, per step) plus the bleed of its open neighbours' lamps.
    vec2 st = vec2(1.0) / uFloor.z;
    vec3 sum = vec3(0.0); float n = 0.0;
    vec2 nb[4] = vec2[4](vec2(st.x, 0.0), vec2(-st.x, 0.0), vec2(0.0, st.y), vec2(0.0, -st.y));
    for (int j = 0; j < 4; j++) {
      vec2 q = sp + nb[j];
      vec4 sq = surfAt(q);
      int kq = int(sq.r * 255.0 + 0.5);
      if (kq == K_TOP || kq == K_FACE) continue;
      n += 1.0;
      if (sq.a > 0.75) sum += flatAt(q, false);
    }
    v = am.rgb + (n > 0.0 ? sum / n * uBleed.x * am.a : vec3(0.0));
  } else if (kind == K_FACE) v = am.rgb + flatAt(sp, true) * uShade.w * am.a;
  else v = (am.rgb + flatAt(sp, false)) * grainAt(sp);
  v = mix(v, vec3(1.0) + (v - 1.0) * uBleed.y, step(vec3(1.0), v));   // 1.7's soft ceiling (level-lighting.js:352-353)
  finalColor = vec4(v * 0.5, 1.0);
}`;

/** F6 bloom: the field's excess over its threshold, faint in relief (level-lighting.js:354-375), drawn added. */
export const BLOOM_FRAGMENT = `#version 300 es
precision highp float;
in vec2 vUV;
out vec4 finalColor;
uniform sampler2D uField;
uniform vec4 uBloom;   // threshold, gain, cap (relief), alpha
void main() {
  vec3 v = texture(uField, vUV).rgb * 2.0;
  float peak = max(v.r, max(v.g, v.b)), k = max(0.0, peak - uBloom.x) * uBloom.y;
  if (uBloom.z > 0.0) k = min(k, uBloom.z / max(0.001, peak));
  // 1.7 kept bloom as bytes, min(255, v x k), drawn at alpha 0.3: as a colour, min(1, v x k / 255).
  finalColor = vec4(min(v * k / 255.0, vec3(1.0)) * uBloom.w, 0.0);
}`;
