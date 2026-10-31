// The Caverns' rock and ground, painted on the graphics card from the shape field (cave-field.js) and the two masters
// 1.7 draws its caves from (stone-detail, cave-rock). The look is 1.7's cave material (PT_MAT.cavern, planeterrain.js
// and environment-terrain.js's natural rock @3c8b312): rock graded from the cave-rock master between the cave's dark
// and lit stone, cliff faces deepening toward their foot with a pale lip, the dark beyond the rock band, mineral
// ribbons, floor stone with cool mineral patches, pearl sheen and bands, scree at the cliff foot, moss, the floor's
// shade under rock, and pools with shelves, shallows, waterlines and wet shores. Made new: one shader, no per-pixel
// work on the CPU. Each 8 x 8 tile chunk is drawn once into a texture when it comes near the camera (cacheAsTexture).

import { Container, Graphics, Mesh, Geometry, Shader, GlProgram, Texture, BufferImageSource, ImageSource } from '../../../forge-godot/runtime/pixi.js';
import { sheet, hasSheet } from './art-store.js';
import { buildCaveField, S, NOISE, NOISE_TABLE, vnoise } from './cave-field.js';
import { T } from '../data/tiles.js';
import { CAVE_ROCK } from '../data/rock.js';
import { surfaceSalt } from '../lib/noise.js';
import { chunkCache } from './chunks.js';

const TC = 8;   // tiles a chunk
// 1.7's cave material (cavernrender.js PT_MAT.cavern; data/rock.js CAVE_ROCK), 0-255.
const ORDER = Object.keys(CAVE_ROCK);
const PAL = ORDER.map(k => `const vec3 ${k.toUpperCase()} = vec3(${CAVE_ROCK[k].map(v => (v / 255).toFixed(5)).join(', ')});`).join('\n');

const VERTEX = `#version 300 es
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

const FRAGMENT = `#version 300 es
precision highp float;
in vec2 vUV;
out vec4 finalColor;
uniform sampler2D uShape;   // R rock field (0.5 the outline), G distance to open ground / 2 tiles, A pool / 2
uniform sampler2D uGround;  // R scree, G shade under rock, B moss, A chasm or bridge
uniform sampler2D uDetail;  // the stone-detail master (repeat, 8 tiles)
uniform sampler2D uFluid;   // the fluid-detail master (repeat, 8 tiles)
uniform float uFluidK;
uniform sampler2D uRock;    // the cave-rock master (mirrored, 8 tiles)
uniform sampler2D uKinds;   // cave-field.js kinds, KS a tile: B how far straight down open ground is, to 1.6 tiles
uniform vec4 uKindSize;     // kinds width, height in samples, samples a tile
uniform vec4 uChunk;        // origin x, y in tiles, size x, y in tiles
uniform vec4 uField;        // field width, height in samples, samples a tile, salt
${PAL}

uint hash3(uint x, uint y, uint s) {
  uint h = x * 374761393u + y * 668265263u + s * 2246822519u;
  h = (h ^ (h >> 13u)) * 1274126177u;
  return h ^ (h >> 16u);
}
float hashf(vec2 p, float s) { ivec2 i = ivec2(floor(p)); return float(hash3(uint(i.x + 4096), uint(i.y + 4096), uint(s)) & 0xFFFFFFu) / 16777215.0; }
uniform sampler2D uNoise;   // the noise lattice (cave-field.js NOISE_TABLE), random bytes in R
// smooth value noise, one lattice unit = one unit of p, its lattice offset across the table by its salt
float vnoise(vec2 p, float s) {
  int si = int(s);
  ivec2 o = ivec2((si * 73) & 511, (si * 151) & 511), i = ivec2(floor(p));
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = texelFetch(uNoise, (i + o) & 511, 0).r, b = texelFetch(uNoise, (i + o + ivec2(1, 0)) & 511, 0).r;
  float c = texelFetch(uNoise, (i + o + ivec2(0, 1)) & 511, 0).r, d = texelFetch(uNoise, (i + o + ivec2(1, 1)) & 511, 0).r;
  return a + (b - a) * f.x + (c - a) * f.y + (a - b - c + d) * f.x * f.y;
}
float ridged(vec2 p, float s) { return 1.0 - abs(vnoise(p, s) * 2.0 - 1.0); }
// The rock's broken edge: ridged noise at two fine scales chips the outline (1.7's cave jag, 0.4).
float jagAt(vec2 w, float salt) { return (ridged(w * 3.6, salt + 41.0) - 0.5) * 0.4 * 0.55 + (ridged(w * 8.2, salt + 43.0) - 0.5) * 0.4 * 0.3; }
// The rock field at a point: above 0 is rock.
float rockAt(vec2 w, float salt) { return (texture(uShape, w * uField.z / uField.xy).r - 128.0 / 255.0) - jagAt(w, salt) * 0.35; }

// Long broken mineral ribbons across rock and floor alike: a warped directional field, never closed cells.
// Worked out once a pixel (vec4: the colour, how much), laid on the rock and the ground alike.
vec4 mineral(vec2 w, float salt) {
  float ribbon = w.x * 0.57 + w.y * 0.34 + (vnoise(w * 0.31, salt + 40.0) - 0.5) * 3.1 + (vnoise(w * vec2(1.2, 0.8), salt + 41.0) - 0.5) * 0.48;
  float dist = abs(sin(ribbon * 2.8)), width = 0.025 + 0.16 * vnoise(w * vec2(0.7, 0.9), salt + 42.0), deposit = vnoise(w * vec2(0.45, 0.64), salt + 43.0);
  if (deposit > 0.5 && dist < width) return vec4(dist < width * 0.17 ? VEINHOT : VEIN, min(1.0, (deposit - 0.5) * 5.0) * pow(1.0 - dist / width, 0.7) * 0.7);
  return vec4(0.0);
}

vec3 floorStone(vec2 w, float salt, vec4 min_) {
  float tone = vnoise(w * 1.8, salt + 32.0);
  vec3 col = mix(FLOOR, FLOORLAV, 0.3 * vnoise(w * 0.16, salt + 33.0) + 0.12 * tone);
  col *= 1.0 + (tone - 0.5) * 0.035;
  float cool = vnoise(w * 0.11, salt + 36.0), coolT = (cool - 0.52) * 2.4;
  if (coolT > 0.0) col = mix(col, MINERALCOOL, min(0.45, coolT));
  float pearl = vnoise(w * 0.19 + vec2(7.0, 0.0), salt + 37.0);
  if (pearl > 0.66) col = mix(col, PEARL, min(0.5, (pearl - 0.66) * 3.0));
  float bandR = vnoise(w * 0.07, salt + 38.0);
  if (bandR > 0.64) { float bs = sin((w.x * 0.8 + w.y * 0.45) * 4.2 + vnoise(w * 0.5, salt + 39.0) * 2.5); if (bs > 0.82) col = mix(col, BAND, min(0.55, (bandR - 0.64) * 4.0)); }
  return mix(col, min_.rgb, min_.a);
}

void main() {
  vec2 w = uChunk.xy + vUV * uChunk.zw;            // world position, in tiles
  float salt = uField.w;
  vec2 fuv = w * uField.z / uField.xy;               // the field's texel centres sit at (k + 0.5) / S
  vec4 sh = texture(uShape, fuv), gr = texture(uGround, fuv);
  // The outline: the field, chipped by ridged noise at two fine scales (the cave's broken rock edge).
  float rockV = rockAt(w, salt);
  float aa = max(fwidth(rockV), 1e-4) * 0.75;
  float rockness = smoothstep(-aa, aa, rockV);
  vec2 rg = w / 8.0;                                 // the masters repeat every 8 tiles (128 px a tile)
  float rockMaster = texture(uRock, rg).r, detail = texture(uDetail, rg).r;

  // Rock: the cave-rock master graded between the cave's dark and lit stone (1.7's natural rock).
  float tone = clamp(0.55 + (rockMaster - 0.5) * 2.2, 0.0, 1.0);
  // A cliff face: rock with open ground within 0.8 of a tile straight below; how far up it the point is (1 at the lip).
  // Worked out once a floor on the very outline drawn here (cave-field.js kinds, the field relief lights from too).
  float down = texture(uKinds, w * uKindSize.z / uKindSize.xy).b * 1.6;
  float up = down < 0.8 ? max(down / 0.8, 1e-3) : 0.0;
  float face = up > 0.0 ? 1.0 : 0.0;
  vec3 topC = TOPLO * 0.72 + (TOPHI * 0.72 - TOPLO * 0.72) * tone;
  topC = mix(topC, TOPLAV * 0.72, 0.25 * vnoise(w * 0.35, salt + 14.0));
  vec3 faceC = FACELO * 0.58 + (LIP * 0.85 * 0.58 - FACELO * 0.58) * tone * (1.0 - (1.0 - up) * 0.25);
  faceC = mix(faceC, FACELO * 0.58, (1.0 - up) * 0.35);  // deepening toward the foot
  vec3 rock = mix(topC, faceC, face);
  if (face > 0.0 && up > 0.86) rock = mix(rock, LIP * 0.8, (up - 0.86) / 0.14 * 0.55);   // the pale lip where the top breaks
  float far = sh.g * 2.0, band = 1.45 + (vnoise(w * 0.6, salt + 5.0) - 0.5) * 0.4;
  rock = mix(rock, TOPLO * 0.6, 0.45 * smoothstep(band - 0.55, band, far) * (1.0 - face));   // darker toward the dark beyond
  rock = mix(rock, EDGE, 0.4 * (1.0 - smoothstep(0.0, 0.07, rockV)) * (1.0 - face));        // the dark rim along the ground
  vec4 min_ = mineral(w, salt);
  rock = mix(rock, min_.rgb, min_.a);
  rock += (hashf(w * 128.0, salt + 114.0) - 0.5) * 10.0 / 255.0;                         // fine grain
  vec3 beyond = far > band ? VOID : rock;
  if (far > band && far < band + 0.12) beyond = VOIDEDGE;
  rock = mix(rock, beyond, step(band, far));

  // Ground: the cave's own floor stone, scree at a cliff's foot, moss, the shade under rock, pools.
  vec3 ground = floorStone(w, salt, min_);
  float scree = gr.r;
  if (scree > 0.0) {
    float sn = vnoise(w * vec2(3.4, 5.2), salt + 90.0), grit = hashf(w * 128.0, salt + 91.0);
    if (sn > 0.62 - scree * 0.3) ground = mix(ground, grit < 0.3 ? TOPHI : grit < 0.62 ? TOP : TOPLO, 0.75);
    else if (grit < 0.05 + scree * 0.1) ground = mix(ground, TOPLO, 0.5);
  }
  float mossF = gr.b;
  if (mossF > 0.05) {
    float drift = vnoise(w * 1.1, salt + 64.0) * 0.6 + vnoise(w * 2.8, salt + 65.0) * 0.4;
    float damp = mossF * (0.55 + drift * 0.7);
    if (damp > 0.1) { ground = mix(ground, MOSS2, min(0.6, damp * 0.75)); if (damp > 0.26) ground = mix(ground, MOSS0, min(0.7, (damp - 0.26) * 1.5)); }
  }
  float pf = sh.a * 2.0;
  if (pf > 0.3) {
    float deep = min(1.0, (pf - 0.34) / 0.5), shelfN = vnoise(w * 2.4, salt + 71.0);
    if (pf < 0.4 && shelfN > 0.55) ground = mix(POOLSHELF, POOLEDGE, 0.5);
    else if (pf < 0.42) ground = mix(POOLSHALLOW, POOLEDGE, (pf - 0.3) / 0.12);
    else ground = mix(POOLEDGE, POOL, max(0.0, deep));   // no caustic marks drawn on the water (item 203)
    if (pf < 0.325 && vnoise(w * 3.4, salt + 74.0) > 0.62) ground = mix(ground, POOLRIM, 0.7 * step(0.5, hashf(w * 128.0, salt + 73.0)));
  } else if (pf > 0.18) {
    float sh2 = vnoise(w * 2.4, salt + 71.0);
    ground = sh2 > 0.62 ? mix(ground, POOLSHELFDRY, 0.45) : mix(ground, POOLWET, 0.3 * (pf - 0.18) / 0.12);
  }
  ground = mix(ground, OCC, 0.32 * gr.g);
  // the masters' grain, in 1.7's measure: rough weathered stone, never a second pattern of slabs
  float g255 = pf > 0.3 ? (texture(uFluid, w / 8.0).r * 255.0 - 128.0) * uFluidK : (detail - 0.5) * 255.0 * 0.015 + (vnoise(w * 12.0, 37.0) - 0.5) * 8.0 + (vnoise(w * 38.0, 91.0) - 0.5) * 4.0
    + (rockMaster - 0.5) * 255.0 * 0.34 + (vnoise(w * 5.0, 227.0) - 0.5) * 12.0;
  ground += g255 / 255.0;

  vec3 col = mix(ground, rock, rockness);
  if (gr.a > 0.5) col = VOID;                        // chasm and bridge tiles: the dark below (lips and planks drawn over)
  finalColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

// 1.7's accent light on a cave floor (environment-terrain.js accentProfile, accentPixels @3c8b312: caves are drawn
// through the plane kernel, so PT_MAT.cavern's veins give light): open ground whose paint lies past the palette along
// the vein colour's axis glows. Here the paint is the shader's mineral ribbon (mirrored on the same noise lattice) over
// the floor stone, sampled 16 a tile, binned 4 x 4 a tile for the light map (lightmap.js accentField: half-tile
// spill, levelled to 0.24 at gain 18). Pools give none; rock tops and faces in sight of the ground go in on their own
// tiles, for the wide vein glow (lightmap.js L28; its tight accent reads open ground only, as 1.7's).
const proj = (c, ax) => c[0] * ax[0] + c[1] * ax[1] + c[2] * ax[2];
const VEIN_AXIS = (() => {
  const v = CAVE_ROCK.vein, mean = (v[0] + v[1] + v[2]) / 3, ax = v.map(c => c - mean), len = Math.hypot(...ax), axis = ax.map(c => c / len);
  const edge = Math.max(...['floor', 'floorLav', 'mineralCool', 'pearl', 'band', 'top', 'topHi', 'topLo', 'face', 'lip'].map(k => proj(CAVE_ROCK[k], axis)));
  return { axis, edge, span: Math.max(12, proj(v, axis) - edge), color: v.map(c => c / Math.max(...v)) };
})();
function mineralAt(x, y, salt) {
  const ribbon = x * 0.57 + y * 0.34 + (vnoise(x * 0.31, y * 0.31, salt + 40) - 0.5) * 3.1 + (vnoise(x * 1.2, y * 0.8, salt + 41) - 0.5) * 0.48;
  const dist = Math.abs(Math.sin(ribbon * 2.8)), width = 0.025 + 0.16 * vnoise(x * 0.7, y * 0.9, salt + 42), deposit = vnoise(x * 0.45, y * 0.64, salt + 43);
  if (!(deposit > 0.5 && dist < width)) return null;
  return { hot: dist < width * 0.17, amount: Math.min(1, (deposit - 0.5) * 5) * Math.pow(1 - dist / width, 0.7) * 0.7 };
}
export function caveAccent(floor, F, salt) {
  const W = floor.w, H = floor.h, AS = 16, K = F.kinds(), bins = new Float32Array(W * 4 * H * 4 * 3);
  const { axis, edge, span, color } = VEIN_AXIS, vein = proj(CAVE_ROCK.vein, axis), hot = proj(CAVE_ROCK.veinHot, axis);
  const ground = proj(CAVE_ROCK.floor, axis), top = proj(CAVE_ROCK.top.map(c => c * 0.72), axis);
  let any = false;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const t = floor.tiles[y * W + x];
    if (t === T.WATER || t === T.CHASM || t === T.BRIDGE) continue;
    for (let v = 0; v < AS; v++) for (let u = 0; u < AS; u++) {
      const wx = x + (u + 0.5) / AS, wy = y + (v + 0.5) / AS;
      const m = mineralAt(wx, wy, salt); if (!m) continue;
      const fi = (Math.min(F.h - 1, Math.floor(wy * S)) * F.w + Math.min(F.w - 1, Math.floor(wx * S))) * 4;
      const rock = K.data[(Math.floor(wy * K.S) * K.w + Math.floor(wx * K.S)) * 4] !== 1;
      // Rock tops and faces carry the ribbons too, out to the dark beyond (the shader's band, 1.45 tiles): the light
      // map's tight accent reads open ground only (1.7's), its wide vein glow reads these as well (L28).
      if (rock ? F.shape[fi + 1] * 2 / 255 > 1.45 : F.shape[fi + 3] * 2 / 255 > 0.3) continue;   // past the band; a pool
      let str = ((1 - m.amount) * (rock ? top : ground) + m.amount * (m.hot ? hot : vein) - edge) / span;
      if (str <= 0.08) continue;
      str = Math.min(1, str) / (AS * AS / 16);
      const b = ((y * 4 + Math.floor(v * 4 / AS)) * W * 4 + x * 4 + Math.floor(u * 4 / AS)) * 3;
      for (let c = 0; c < 3; c++) bins[b + c] += color[c] * str;
      any = true;
    }
  }
  return any ? { bins, level: new Float32Array(W * H * 2), w: W * 4, h: H * 4, perTile: 4 } : null;
}

/** A master as its own repeating texture (the sheet's source keeps its own settings). */
function masterTexture(name, key, mode) {
  if (!hasSheet(name)) return Texture.WHITE.source;
  const sh = sheet(name), src = sh.textures[`${key}/0-0`]?.source;
  if (!src?.resource) return Texture.WHITE.source;
  return new ImageSource({ resource: src.resource, addressMode: mode, scaleMode: 'linear' });
}

/**
 * The Caverns' painted rock and ground, chunked and culled like terrain.js; with `kindsField` for relief.
 * @returns {Container & {cull:Function, kindsField:Function, field:any}}
 */
export function buildCaveSurface(floor, tile, run = {}) {
  const root = new Container(), W = floor.w, H = floor.h;
  const salt = (surfaceSalt(run.seed, run.floorNo ?? 11) + 911) % 65536;
  const F = buildCaveField(floor, salt);
  root.field = F;
  root.kindsField = () => F.kinds();
  // Where the surface paints water: open ground on the drawn outline, past the pool's shore (the shader's pf > 0.3,
  // with a margin for its filtering).
  root.wetAt = (wx, wy) => {
    const K = F.kinds();
    if (wx < 0 || wy < 0 || wx >= W || wy >= H || K.data[(Math.floor(wy * K.S) * K.w + Math.floor(wx * K.S)) * 4] !== 1) return false;
    return F.shape[(Math.min(F.h - 1, Math.floor(wy * S)) * F.w + Math.min(F.w - 1, Math.floor(wx * S))) * 4 + 3] * 2 / 255 > 0.36;
  };
  let accent;
  root.accentField = () => (accent === undefined ? (accent = caveAccent(floor, F, salt)) : accent);   // the veins' own light (1.7's accent)
  if (typeof document === 'undefined') { root.cull = () => {}; return root; }
  const tex = data => new BufferImageSource({ resource: data, width: F.w, height: F.h, format: 'rgba8unorm', scaleMode: 'linear', addressMode: 'clamp-to-edge', alphaMode: 'no-premultiply-alpha' });   // data in every channel: never premultiplied
  const shapeSrc = tex(F.shape), groundSrc = tex(F.ground), K = F.kinds();
  const kindsSrc = new BufferImageSource({ resource: K.data, width: K.w, height: K.h, format: 'rgba8unorm', scaleMode: 'linear', addressMode: 'clamp-to-edge', alphaMode: 'no-premultiply-alpha' });
  const noise = new Uint8Array(NOISE * NOISE * 4);
  for (let i = 0; i < NOISE * NOISE; i++) { noise[i * 4] = NOISE_TABLE[i]; noise[i * 4 + 3] = 255; }
  const noiseSrc = new BufferImageSource({ resource: noise, width: NOISE, height: NOISE, format: 'rgba8unorm', scaleMode: 'nearest', addressMode: 'repeat', alphaMode: 'no-premultiply-alpha' });
  const detailSrc = masterTexture('environment-terrain-stone-detail', 'stone-detail', 'repeat');
  const fluidSrc = masterTexture('environment-terrain-fluid-detail', 'fluid-detail', 'repeat');
  const rockSrc = masterTexture('environment-terrain-cave-rock', 'cave-rock', 'mirror-repeat');
  const program = GlProgram.from({ vertex: VERTEX, fragment: FRAGMENT, name: 'cave-surface' });
  const chunks = [];
  for (let cy = 0; cy < H; cy += TC) for (let cx = 0; cx < W; cx += TC) {
    const tw = Math.min(TC, W - cx), th = Math.min(TC, H - cy);
    const geometry = new Geometry({ attributes: { aPosition: [0, 0, tw * tile, 0, tw * tile, th * tile, 0, th * tile], aUV: [0, 0, 1, 0, 1, 1, 0, 1] }, indexBuffer: [0, 1, 2, 0, 2, 3] });
    const shader = new Shader({
      glProgram: program,
      resources: {
        cave: { uChunk: { value: new Float32Array([cx, cy, tw, th]), type: 'vec4<f32>' }, uField: { value: new Float32Array([F.w, F.h, S, salt]), type: 'vec4<f32>' }, uKindSize: { value: new Float32Array([K.w, K.h, K.S, 0]), type: 'vec4<f32>' } },
        fluid: { uFluidK: { value: fluidSrc === Texture.WHITE.source ? 0 : 0.12, type: 'f32' } },
        uShape: shapeSrc, uGround: groundSrc, uDetail: detailSrc, uFluid: fluidSrc, uRock: rockSrc, uKinds: kindsSrc, uNoise: noiseSrc,
      },
    });
    const c = new Container(), mesh = new Mesh({ geometry, shader });
    c.position.set(cx * tile, cy * tile);
    c.addChild(new Graphics().rect(0, 0, TC * tile, TC * tile).fill({ color: 0, alpha: 0 }));   // bounds: the whole chunk box, every chunk the same square (sandbox 55)
    c.addChild(mesh);
    c.box = [cx * tile, cy * tile, (cx + tw) * tile, (cy + th) * tile];
    chunks.push(c); root.addChild(c);
  }
  const far = TC * tile;
  root.cull = chunkCache(chunks, TC * tile, far);   // cached at the screen's density while near (Sandbox 55; chunks.js)
  root.on('destroyed', () => { shapeSrc.destroy(); groundSrc.destroy(); kindsSrc.destroy(); noiseSrc.destroy(); if (detailSrc !== Texture.WHITE.source) detailSrc.destroy(); if (fluidSrc !== Texture.WHITE.source) fluidSrc.destroy(); if (rockSrc !== Texture.WHITE.source) rockSrc.destroy(); });
  return root;
}
