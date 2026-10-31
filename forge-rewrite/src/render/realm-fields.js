// What the planes' and the Chaos islands' raster reads and gives (M10, render-28: moved out of realm-raster.js): the
// cave-rock master's grain, the floor's fields as plain data a worker can be sent, and the relief light's kinds and the
// accent light the raster's ground gives (relief.js, lightmap.js).

import { ROCK } from '../data/rock.js';
import { floorColor, kinder, poolAt, mossy, chasmCell } from './realm-ground.js';
import { chasmDepth } from './ground-marks.js';
import { outlineBelow, rockKind } from './fine-kinds.js';

// The cave-rock master's red channel (environment-terrain.js red()), read once from the loaded sheet's picture.
const pixelCache = new WeakMap();
export function rockPixels(source) {
  if (!source || typeof document === 'undefined') return null;
  if (pixelCache.has(source)) return pixelCache.get(source);
  const img = source.resource, w = source.pixelWidth, h = source.pixelHeight;
  try {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, w, h).data, red = new Uint8Array(w * h);
    for (let i = 0; i < red.length; i++) red[i] = d[i * 4];
    pixelCache.set(source, { source, red, w, h });
  } catch { pixelCache.set(source, { source, red: null, w, h }); }
  return pixelCache.get(source);
}

/**
 * The fields rasterChunk reads, as plain data a worker can be sent (realm-worker.js): per cell wall (1 wall or secret
 * door), mat (0 none, else 1 + an index into mats, ROCK keys), moss, dist (wallDistance), pool weights; the centre and
 * sun inlays, the salt, and the cave-rock master's red channel ({red, w, h} or null).
 * @returns {object} F for rasterChunk, kindsField and accentField
 */
export function rasterFields(d) {
  const { W, H } = d, inb = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
  const mats = d.mats.map(k => ROCK[k]);
  return {
    W, H, salt: d.salt, pool: d.pool, center: d.center, suns: d.suns, rock: d.rock, fluid: d.fluid,
    wall: (x, y) => !inb(x, y) || d.wall[y * W + x] === 1,
    matAt: (x, y) => (inb(x, y) && d.mat[y * W + x] ? mats[d.mat[y * W + x] - 1] : null),
    dist: (x, y) => (inb(x, y) ? d.dist[y * W + x] : 255),
    mossAt: (x, y) => inb(x, y) && d.moss[y * W + x] === 1,
  };
}

/**
 * What the raster's rock outline takes as rock: a rock cell, or a void cell (no material) beside an island's rock, so
 * rock that meets the void runs on to the chasm's edge (item 185, Justin 2026-10-19: "you shouldn't have surface in a
 * thin strip after the cliff edge").
 */
export const rockOutline = (matAt, rock) => (x, y) => rock(x, y) || (!matAt(x, y) && [-1, 0, 1].some(oy => [-1, 0, 1].some(ox => matAt(x + ox, y + oy) && rock(x + ox, y + oy))));

/** Chebyshev distance (0-6, 255 beyond) from each cell to open ground (planeterrain.js ptDist). */
export function wallDistance(W, H, wall) {
  const d = new Uint8Array(W * H).fill(255), q = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (!wall(x, y)) { d[y * W + x] = 0; q.push(x, y); }
  for (let h = 0; h < q.length; h += 2) {
    const qx = q[h], qy = q[h + 1], nd = d[qy * W + qx] + 1; if (nd > 6) continue;
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      const nx = qx + ox, ny = qy + oy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const k = ny * W + nx; if (d[k] > nd) { d[k] = nd; q.push(nx, ny); }
    }
  }
  return d;
}

/**
 * The relief light's per-pixel kinds over the raster cells (relief.js setFineKinds, L21), KS samples a tile:
 * R 1 floor, 2 face, 3 top; G the rock's height above its outline (fine-kinds.js rockKind); B the tile's region; A 255 inside.
 */
export function kindsField(F, KS = 16, region = null) {
  const kind = kinder(F), w = F.W * KS, h = F.H * KS, data = new Uint8Array(w * h * 4);
  // Each sample's rock worked out once (the face scan below reads down the same samples).
  const solid = new Uint8Array(w * h).fill(255);
  const solidAt = (gu, gv) => {
    if (gu < 0 || gv < 0 || gu >= w || gv >= h) return kind((gu + 0.5) / KS, (gv + 0.5) / KS) !== 0;
    const q = gv * w + gu;
    if (solid[q] === 255) solid[q] = kind((gu + 0.5) / KS, (gv + 0.5) / KS) !== 0 ? 1 : 0;
    return solid[q] === 1;
  };
  const below = outlineBelow(KS, solidAt, (x, y) => kind(x, y) !== 0, 1.25);   // item 211: a face is a tile tall
  for (let y = 0; y < F.H; y++) for (let x = 0; x < F.W; x++) {
    const M = F.matAt(x, y);
    if (!M) continue;
    // Item 185: Rot's and Violet's rock is painted, lit flat (the Chaos session's ruling, 2026-10-16: no sheets for it),
    // so the light takes it as the ground it is painted on, and the raster's rounded outline shows, not face and top
    // kinds cutting it into columns and blocks.
    const flat = !!M.organicRock, E = chasmCell(F, x, y);   // item 185: the land the chasm's edge takes is not lit as land (realm-raster.js)
    for (let v = 0; v < KS; v++) for (let u = 0; u < KS; u++) {
      const gu = x * KS + u, gv = y * KS + v, q = (gv * w + gu) * 4;
      if (E && chasmDepth(E.near, E.own, x, y, (gu + 0.5) / KS, (gv + 0.5) / KS, F.salt + 600) > 0) continue;
      let k = 1, up = 0;
      if (!flat && solidAt(gu, gv)) ({ k, up } = rockKind(below(gu, gv), 1));
      data[q] = k; data[q + 1] = up; data[q + 2] = region?.[y * F.W + x] ?? 0; data[q + 3] = 255;
    }
  }
  return { S: KS, w, h, data };
}

// 1.7's accent light (environment-terrain.js accentProfile, accentPixels, accentFrame @3c8b312): open ground whose
// paint carries the material's mineral colour gives a little light of its own (the Rot's green and the Violet's lilac
// ribbons). A profile per material: the vein's chroma axis, the strongest stone colour along it as the edge, the vein
// as full strength; levelled to 0.24 at gain 18 (accentFrame's defaults).
const profiles = new Map();
function accentProfile(M) {
  if (profiles.has(M)) return profiles.get(M);
  const mean = (M.vein[0] + M.vein[1] + M.vein[2]) / 3;
  let axis = M.vein.map(c => c - mean); const len = Math.hypot(...axis);
  let out = null;
  if (len >= 1) {
    axis = axis.map(c => c / len);
    const proj = c => c[0] * axis[0] + c[1] * axis[1] + c[2] * axis[2];
    const edge = Math.max(...['floor', 'floorLav', 'mineralCool', 'pearl', 'band', 'top', 'topHi', 'topLo', 'face', 'lip'].map(k => M[k]).filter(Boolean).map(proj)), peak = Math.max(...M.vein);
    out = { axis, edge, span: Math.max(12, proj(M.vein) - edge), color: M.vein.map(c => c / peak) };
  }
  profiles.set(M, out);
  return out;
}
/**
 * The terrain's own glow for the light map (lightmap.js accentField, L24): {bins RGB 4 x 4 a tile, level [ceiling,
 * gain] a tile, w, h, perTile}, or null. Only the raster's open ground (not rock, not pools) gives light.
 */
export function accentField(F, AS = 16) {
  const kind = kinder(F), W = F.W, H = F.H, bins = new Float32Array(W * 4 * H * 4 * 3), level = new Float32Array(W * H * 2);
  let any = false;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const M = F.matAt(x, y); if (!M || F.wall(x, y)) continue;
    const prof = accentProfile(M); if (!prof) continue;
    for (let v = 0; v < AS; v++) for (let u = 0; u < AS; u++) {
      const wx = x + (u + 0.5) / AS, wy = y + (v + 0.5) / AS;
      if (kind(wx, wy) !== 0 || poolAt(F, wx, wy) > 0.3) continue;
      const col = mossy(F, wx, wy, M, floorColor(wx, wy, M, F.salt, 128, F.center));
      let str = (col[0] * prof.axis[0] + col[1] * prof.axis[1] + col[2] * prof.axis[2] - prof.edge) / prof.span;
      if (str <= 0.08) continue;
      str = Math.min(1, str) / (AS * AS / 16);
      const b = ((y * 4 + Math.floor(v * 4 / AS)) * W * 4 + x * 4 + Math.floor(u * 4 / AS)) * 3;
      for (let k = 0; k < 3; k++) bins[b + k] += prof.color[k] * str;
      level[(y * W + x) * 2] = 0.24; level[(y * W + x) * 2 + 1] = 18;
      any = true;
    }
  }
  return any ? { bins, level, w: W * 4, h: H * 4, perTile: 4 } : null;
}
