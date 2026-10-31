// The ground pass's program (lighting-design.md F4); the shared irradiance and admission are light-glsl.js's.

import { SHARED } from './light-glsl.js';

/**
 * F4, the ground: each screen pixel of the ground layers lit by its own normal and position, then 1.7's knee. Faces
 * stand up from their foot line; tops take the field; ground under a shadow or the wall band darkens.
 */
export const TERRAIN_FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
in vec2 vTextureCoord;
in vec2 vGlobal;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform vec4 uMap;        // map root x, y (screen px), 1 / (scale x tile), hang (1: the Caverns' hanging stone)
uniform sampler2D uField; // F3 over the window
uniform vec4 uFieldWin;   // the field's window: origin and size, tiles
uniform sampler2D uShadow;// F2 over its window
uniform vec4 uShadowWin;  // the shadow mask's window: origin and size, tiles
uniform vec4 uShadowK;    // shadow strength, 0, 0, 0
uniform sampler2D uN0; uniform sampler2D uF0;   // normal sets: floor and face sheets
uniform sampler2D uN1; uniform sampler2D uF1;
uniform sampler2D uN2; uniform sampler2D uF2;
uniform sampler2D uN3; uniform sampler2D uF3;   // the natural rock pair (stone-detail ground, cave-rock faces)
uniform vec4 uGrid[4];    // per set: floor cells across, down; face cells across, down
uniform vec4 uSetK[4];    // per set: loaded (1), ground gain, the face cell's share that is its coping (lip), the face's gain (0: no face map, lit flat)
uniform vec4 uAreaSet[2]; // area index -> normal set (8 areas)
uniform vec4 uGain;       // ground normal gain, the trim's share of it (item 234), the flat pieces' (item 237), classic (1: flat, the field)
uniform vec4 uTrimKey;    // the light the trim art is painted in (x right, y up, z out) and the share of its relief a top takes
uniform vec4 uLip;        // a face's coping: its rows (share of the cell), the share of the floor's light north of it it takes at least
uniform sampler2D uFine;  // raster terrain's per-pixel kinds (R kind 1 floor 2 face 3 top, G rock's height over its outline: fine-kinds.js)
uniform sampler2D uCover; // over its window: the walls' trim (its own normal RGB, where it lies A; item 201) in its top rows, the ground cover (A) in its bottom
uniform vec4 uCoverWin;   // its window: origin and size, tiles
uniform vec4 uCoverK;     // the share of the relief cover takes away; the trim's share of the picture's height (0: none); the cover's of its width and height
uniform vec4 uFineK;      // samples a tile, width, height, 1 when there is a field
uniform vec4 uWater;      // water shimmer: strength, sharpness, the two patterns' cross-fade, their drift (tiles)
${SHARED}
vec4 sheet(int s, bool face, vec2 uv) {
  if (s == 0) return face ? textureLod(uF0, uv, 0.0) : textureLod(uN0, uv, 0.0);
  if (s == 1) return face ? textureLod(uF1, uv, 0.0) : textureLod(uN1, uv, 0.0);
  if (s == 2) return face ? textureLod(uF2, uv, 0.0) : textureLod(uN2, uv, 0.0);
  return face ? textureLod(uF3, uv, 0.0) : textureLod(uN3, uv, 0.0);
}
// A tile's normal from its set's sheet (x right, y up, z out; normal-lighting.js:58): the sheet is laid like the colour
// sheet, a cell a tile. No edge taper: 1.7 tapers only a mirrored repeat, and its one (the Dungeon floor) is re-laid.
vec3 sheetNormal(int s, bool face, vec2 p, float gain) {
  vec4 G = uGrid[s];
  ivec2 ti = ivec2(floor(p));
  vec2 cells = face ? vec2(G.z, 1.0) : G.xy, f = p - floor(p);
  ivec2 ci = ivec2(cells + 0.5);
  vec2 cell = face ? vec2(float(ti.x % ci.x), 0.0) : vec2(ti % ci);
  vec2 uv = (cell + f) / (face ? G.zw : G.xy);
  vec3 c = sheet(s, face, uv).rgb;
  vec3 n = vec3((c.rg * 255.0 - 128.0) / 127.0, c.b * 2.0 - 1.0);
  n.xy *= gain;
  return normalize(n);
}
int setOf(int area) { vec4 v = uAreaSet[area / 4]; int j = area - (area / 4) * 4; return int((j == 0 ? v.x : j == 1 ? v.y : j == 2 ? v.z : v.w) + 0.5); }
// Ground cover over the stone (the paint and ground layers' alpha): its relief hides under it as 1.7's flat-lit decals.
float coverAlpha(vec2 p) { vec2 uv = (p - uCoverWin.xy) / uCoverWin.zw; return all(greaterThanEqual(uv, vec2(0.0))) && all(lessThan(uv, vec2(1.0))) ? texture(uCover, vec2(uv.x * uCoverK.z, 1.0 - uCoverK.w + uv.y * uCoverK.w)).a : 0.0; }
float coverAt(vec2 p) { return coverAlpha(p) * uCoverK.x; }
vec4 trimAt(vec2 p) { vec2 uv = (p - uCoverWin.xy) / uCoverWin.zw; return uCoverK.y > 0.0 && all(greaterThanEqual(uv, vec2(0.0))) && all(lessThan(uv, vec2(1.0))) ? texture(uCover, vec2(uv.x, uv.y * uCoverK.y)) : vec4(0.0); }
// A normal n under the trim t: the trim's own where it lies (its art's convention, as the sheets'), tilted by gain g,
// blended at its edge.
vec3 underTrim(vec3 n, vec4 t, float g) {
  if (t.a <= 0.0) return n;
  vec3 c = t.rgb / t.a, m = normalize(vec3((c.rg * 255.0 - 128.0) / 127.0 * g, c.b * 2.0 - 1.0));
  return normalize(mix(n, m, t.a));
}
vec3 fieldAt(vec2 p) { return texture(uField, (p - uFieldWin.xy) / uFieldWin.zw).rgb * 2.0; }
// Item 211 (Justin 2026-10-19: "need to smooth out the jagged edges here"): rock's height over its outline (fine-kinds.js
// rockKind: 0.5 at a face's lip) read between the kinds texels, rock texels only, so the lip, where a lit face meets
// its dark top, is as smooth a line as the drawn outline, not the kinds grid's steps.
float fineUp(vec2 fs) {
  vec2 b = fs - 0.5, f = b - floor(b);
  ivec2 i = ivec2(floor(b)), top = ivec2(uFineK.yz) - 1;
  float sum = 0.0, wt = 0.0;
  for (int dy = 0; dy < 2; dy++) for (int dx = 0; dx < 2; dx++) {
    vec4 t = texelFetch(uFine, clamp(i + ivec2(dx, dy), ivec2(0), top), 0);
    float w = (dx == 0 ? 1.0 - f.x : f.x) * (dy == 0 ? 1.0 - f.y : f.y);
    if (t.a > 0.5 && t.r * 255.0 > 1.5) { sum += t.g * w; wt += w; }
  }
  return wt > 0.0 ? sum / wt : 1.0;
}
float shadowAt(vec2 p) { vec2 uv = (p - uShadowWin.xy) / uShadowWin.zw; return all(greaterThanEqual(uv, vec2(0.0))) && all(lessThan(uv, vec2(1.0))) ? texture(uShadow, uv).a : 0.0; }

// How much of p is in sight (or, wet, open water in sight): the four tiles round it, ramped across the half tile round
// each edge as admission is. 1.7 interpolates its samples, so lamp, ambient and memory meet in that ramp, never a
// tile-edged step (item 154); the shimmer fades out the same way at a pool's edge (item 155).
float flagAt(ivec2 t, bool wet) { float a = surfAt(vec2(t) + 0.5).a * 255.0; return (wet ? abs(a - 250.0) < 0.5 : a > 191.0) ? 1.0 : 0.0; }
float shareOf(vec2 p, bool wet) {
  vec2 q = p - 0.5, fl = floor(q), f = clamp((q - fl - 0.25) * 2.0, 0.0, 1.0);
  ivec2 t = ivec2(fl);
  return mix(mix(flagAt(t, wet), flagAt(t + ivec2(1, 0), wet), f.x), mix(flagAt(t + ivec2(0, 1), wet), flagAt(t + ivec2(1, 1), wet), f.x), f.y);
}

// The light on the ground at p (tiles) through its own kind and normal.
vec3 groundLight(vec2 p) {
  vec4 s = surfAt(p), am = ambAt(p), tr = trimAt(p);
  float sv = shareOf(p, false);
  if (sv <= 0.0) return am.rgb;                          // out of sight, clear of its edge: memory (never seen 0), no lamp
  int kind = int(s.r * 255.0 + 0.5), area = int(s.g * 255.0 + 0.5);
  float faceH = 0.0;
  if (uFineK.w > 0.5) {
    vec2 fs = p * uFineK.x;
    if (fs.x >= 0.0 && fs.y >= 0.0 && fs.x < uFineK.y && fs.y < uFineK.z) {
      vec4 fk = texelFetch(uFine, ivec2(fs), 0);
      if (fk.a > 0.5) { int k2 = int(fk.r * 255.0 + 0.5); float up = k2 >= 2 ? fineUp(fs) : 0.0; kind = k2 < 2 ? K_FLOOR : up < 0.5 ? K_FACE : K_TOP; faceH = up * 2.0; }
    }
  }
  if (uGain.w > 0.5) return fieldAt(p);                  // classic: the flat field
  if (kind == K_TOP) {
    // A wall top takes the field; the trim on it (its rims and caps) takes the field shaded by its own relief against the
    // light its art is painted in (every light hangs below a wall top, so their own fall says little up there).
    if (tr.a <= 0.0) return fieldAt(p);
    vec3 n = underTrim(vec3(0.0, 0.0, 1.0), tr, uGain.x), k = normalize(uTrimKey.xyz);
    return fieldAt(p) * mix(1.0, clamp(dot(n, k) / k.z, 0.5, 1.5), uTrimKey.w * uGain.y);   // the trim's share of its shade (item 234)
  }
  int set = setOf(area);
  // Set 4 means no normal map, outside the four mapped sets.
  vec4 setK = vec4(0.0);
  if (set >= 0 && set < 4) setK = uSetK[set];
  bool mapped = setK.x > 0.5;
  vec2 f = p - floor(p);
  if (kind == K_FACE) {
    // A face stands on its foot line and rises wallHeight; its light is read at that foot (1.7 render.js:1847,
    // level-lighting.js:256-258: halfway between the face's sample and the floor tile's below), Lambert at its height.
    float foot = uFineK.w > 0.5 && faceH > 0.0 ? p.y + faceH : floor(p.y) + 1.0;
    float lip = f.y < setK.z ? uGain.y : 1.0;   // the face's coping is trim art: the trim's relief (item 234)
    vec3 n = underTrim(mapped && setK.w > 0.0 ? sheetNormal(set, true, p, uGain.x * lip * setK.w * (1.0 - coverAt(p))) : vec3(0.0, 0.0, 1.0), tr, uGain.x * uGain.y);   // paint on a face hides its relief, trim brings its own
    n = vec3(n.x, -n.z, n.y);
    vec3 pt = vec3(p.x, foot, uShade.z * (uFineK.w > 0.5 && faceH > 0.0 ? faceH : 1.0 - f.y));
    vec2 fp = vec2(p.x, foot + 0.375);
    Adm a = admitAt(fp);
    vec4 af = ambAt(vec2(p.x, foot));
    vec3 lit = limitLight(af.rgb + lightSum(a, pt, n, n, false, fp, foot, 1.0) * (0.5 + 0.5 * uShade.w) * af.a);
    // Item 281: the coping on top of a face is a wall's lip seen from above: at least a share of the light of the floor
    // north of it, so a wall one cell thick shows its lip, caps and doors to the side its face looks away from.
    if (uFineK.w < 0.5 && f.y < uLip.x) lit = max(lit, fieldAt(vec2(p.x, floor(p.y) - 0.25)) * uLip.y);
    return lit;
  }
  vec3 n = vec3(0.0, 0.0, 1.0);
  // Fluid over the stone, or ground cover lying on it, hides its relief (1.7 draws them as their own flat pictures).
  float dry = (1.0 - s.b) * (1.0 - coverAt(p));
  if (mapped && kind == K_FLOOR) n = sheetNormal(set, false, p, uGain.x * setK.y * dry);
  else if (mapped && kind == K_DOOR && setK.w > 0.0) n = sheetNormal(set, true, p, uGain.x * setK.w * dry);
  n = underTrim(n, tr, uGain.x * (kind == K_DOOR ? uGain.y : uGain.z));   // a door's frame is trim; on a floor, the flat pieces' own share
  Adm a = admitAt(p);
  // The grain and the shadow belong to the sight side of an edge (1.7 mottles and shadows only the tiles in sight).
  vec3 ill = limitLight(am.rgb * mix(1.0, grainAt(p), sv) + lightSum(a, vec3(p, 0.0), n, n, false, p, -1e9, 1.0));
  // The ground under a shadow (1.7 normal-lighting.js:86); the mask carries the ruled wall band too (shadows.js).
  ill *= 1.0 - uShadowK.x * shadowAt(p) * sv;
  return ill;
}
void main() {
  vec4 c = texture(uTexture, vTextureCoord);
  if (c.a <= 0.0) { finalColor = c; return; }
  vec2 p = (vGlobal - uMap.xy) * uMap.z;
  vec3 light;
  if (uMap.w > 0.5) {
    // The Caverns' hanging stone (1.7 cavernrender.js:189-195): 65% the rock-top light here, 35% a face at its cell's foot.
    vec2 face = vec2(p.x, floor(p.y) + 1.05);
    light = 0.65 * groundLight(p) + 0.35 * uShade.w * groundLight(face);
  } else light = groundLight(p);
  vec3 paint = c.rgb / c.a, glint = vec3(0.0);
  // SB13: light on open water shimmers: soft broken ripples across, the water's own colour lit by the light that falls
  // there less the ambient, two patterns cross-fading and drifting apart (Justin's pick, 10-16: "a soft shimmer on
  // pools"; 10-18 item 153: white glints were too heavy). Only on the painted water (the paint layer's alpha in the
  // cover picture), so a pool's dry shore stays dry; fading out across its tile edges (item 155).
  float wet = uWater.x > 0.0 && uMap.w < 0.5 ? shareOf(p, true) : 0.0;
  if (wet > 0.0) {
    wet *= uCoverK.x > 0.0 ? coverAlpha(p) : 1.0;
    float rip = 0.0;
    for (int i = 0; i < 2; i++) {
      float ph = float(i) * 3.14159265;
      vec2 q = vec2(p.x + (i == 0 ? uWater.w : -uWater.w), p.y);
      float line = 0.5 + 0.5 * sin(q.y * 13.0 + 1.4 * sin(q.x * 3.3 + ph) + ph);
      float dash = 0.5 + 0.5 * sin(q.x * 4.7 + 2.2 * sin(q.y * 2.9 - ph) + 1.7 * ph);
      rip += (i == 0 ? uWater.z : 1.0 - uWater.z) * pow(line * dash, uWater.y);
    }
    glint = max(light - ambAt(p).rgb, vec3(0.0)) * paint * rip * uWater.x * wet;
  }
  finalColor = vec4(graded(kneeOf(paint, light) + glint) * c.a, c.a);
}`;
