// The ground marks baked as pixels (M10, render-28: moved out of ground-paint.js, which paints them into its chunks):
// puddles, the chasm's edge rock, the Maw's burrow skirts and scorch or ash stains, and the canvas sizes they share.

import { T, G } from '../data/tiles.js';
import { hash2, noise } from '../lib/noise.js';

export const PX = 32;   // canvas pixels per tile: the marks are soft, so a quarter of the art resolution is plenty
export const MX = 16;   // the moss bed is worked out at half that and drawn smoothed (its edge is a soft noise anyway)
export const MOSS_PX = 64;   // moss patches: pixels a tile, on their own layer (1.7 works them out at 128)
export const WATER_TONE = [0.66, 0.76, 0.78];   // the pool's tone per channel, against 1.7's lit water (see the water pass)

/** render.js grassHash (a different hash from hash2; the float multiply is 1.7's). */
export const gh = (x, y, k) => { let h = (x * 73856093) ^ (y * 19349663) ^ (k * 83492791); h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
export const mossNoise = (wx, wy, s) => {
  const x = Math.floor(wx), y = Math.floor(wy); let fx = wx - x, fy = wy - y;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
  const a = hash2(x, y, s), b = hash2(x + 1, y, s), c = hash2(x, y + 1, s), d = hash2(x + 1, y + 1, s);
  return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
};
export const edge = (v, t0, w) => { const t = Math.max(0, Math.min(1, (v - t0) / w)); return t * t * (3 - 2 * t); };

/**
 * Puddles (sandbox 67; Justin 2026-10-17: "this water looks off", the pool read as an opaque plate with a dark outline).
 * Shallow water over the stone: the pool tints and darkens what is under it (a multiply layer, so the stone, its joints
 * and the grass at its edge show through), a one pixel wet rim on the stone round it, a lighter inner rim on the side
 * facing the light (top), and one or two short soft streaks of reflected light. The shape is 1.7's three ovals per
 * cell (decals.js G.PUDDLE), its edge broken by noise so it lies in the stone like water and not like a stamp.
 * PX pixels a tile, drawn unsmoothed. Returns { mul, over } canvases, or null.
 */
const PUDDLE = { tint: [150, 186, 206], rim: 0.84, wet: [204, 204, 210], lit: [214, 236, 244, 100], streak: [236, 246, 250, 120] };   // Justin 2026-10-17 picked C
export function puddlePixels(gAt, x0, y0, x1, y1) {
  const PX = 64, P = PUDDLE;
  const N = (x1 - x0) * PX, M = (y1 - y0) * PX, pad = PX, w = N + 2 * pad, h = M + 2 * pad;
  let mask = null;
  for (let y = y0 - 1; y < y1 + 1; y++) for (let x = x0 - 1; x < x1 + 1; x++) {
    if (gAt(x, y) !== G.PUDDLE) continue;
    mask ??= new Uint8Array(w * h);
    for (let i = 0; i < 3; i++) {
      const cx = (x - x0 + 0.3 + 0.4 * gh(x, y, i)) * PX + pad, cy = (y - y0 + 0.35 + 0.3 * gh(x, y, i + 10)) * PX + pad, r = PX * (0.18 + 0.14 * gh(x, y, i + 20)), rx = r * 1.25, ry = r * 0.85;
      for (let py = Math.max(0, Math.floor(cy - ry * 1.3)); py <= Math.min(h - 1, Math.ceil(cy + ry * 1.3)); py++) for (let px = Math.max(0, Math.floor(cx - rx * 1.3)); px <= Math.min(w - 1, Math.ceil(cx + rx * 1.3)); px++) {
        const dx = (px + 0.5 - cx) / rx, dy = (py + 0.5 - cy) / ry, wx = x0 + (px - pad + 0.5) / PX, wy = y0 + (py - pad + 0.5) / PX;
        if (Math.hypot(dx, dy) + (noise(wx * 5, wy * 5, 917) - 0.5) * 0.55 + (noise(wx * 13, wy * 13, 919) - 0.5) * 0.18 <= 1) mask[py * w + px] = 1;
      }
    }
  }
  if (!mask) return null;
  const mk = () => { const c = document.createElement('canvas'); c.width = N; c.height = M; return c; };
  const mul = mk(), over = mk(), gm = mul.getContext('2d'), go = over.getContext('2d'), im = gm.createImageData(N, M), io = go.createImageData(N, M), dm = im.data, dov = io.data;
  const put = (d, o, c, a = 255) => { d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = a; };
  for (let py = 0; py < M; py++) for (let px = 0; px < N; px++) {
    const k = (py + pad) * w + px + pad, o = (py * N + px) * 4;
    if (!mask[k]) {
      // the wet stone round the pool: one pixel, a shade darker
      if (mask[k - 1] || mask[k + 1] || mask[k - w] || mask[k + w]) put(dm, o, P.wet);
      continue;
    }
    const topEdge = !mask[k - w], edge = topEdge || !mask[k - 1] || !mask[k + 1] || !mask[k + w];
    put(dm, o, edge && !topEdge ? P.tint.map(v => v * P.rim) : P.tint);
    // the inner rim on the lit side: the pixel just inside the top edge
    if (!topEdge && !mask[k - 2 * w] && !(!mask[k - 1] || !mask[k + 1])) put(dov, o, P.lit, P.lit[3]);
  }
  // one or two short streaks of reflected light, soft at their ends, inside the pool
  for (let y = y0 - 1; y < y1 + 1; y++) for (let x = x0 - 1; x < x1 + 1; x++) {
    if (gAt(x, y) !== G.PUDDLE) continue;
    const n = gh(x, y, 40) < 0.5 ? 1 : 2;
    for (let s2 = 0; s2 < n; s2++) {
      const sy = Math.round((y - y0 + 0.38 + 0.22 * gh(x, y, 41 + s2)) * PX), sx = Math.round((x - x0 + 0.3 + 0.3 * gh(x, y, 43 + s2)) * PX), len = Math.round(PX * (0.16 + 0.1 * gh(x, y, 45 + s2)));
      for (let i = 0; i < len; i++) for (let r = 0; r < 1; r++) {
        const px = sx + i + r, py = sy + r; if (px < 0 || py < 0 || px >= N || py >= M) continue;
        const k = (py + pad) * w + px + pad; if (!mask[k] || !mask[k - 1] || !mask[k + 1] || !mask[k + w] || !mask[k - w]) continue;
        const t = i / (len - 1), fall = Math.sin(Math.PI * t) * (r ? 0.45 : 1);
        put(dov, (py * N + px) * 4, P.streak, Math.round(P.streak[3] * fall));
      }
    }
  }
  gm.putImageData(im, 0, 0); go.putImageData(io, 0, 0);
  return { mul, over };
}

// CV1, CV2 (1.7 chasmsmooth.js, chasmedges.js CHASM_FLOOR_TINT): the chasm's rock in each biome's floor colour.
export const CHASM_TINT = { dungeon: [135, 119, 103], crypt: [97, 91, 107], caverns: [90, 86, 82] };
/**
 * 1.7 chasmsmooth.js chsRaster: one tile of a chasm's edge. A field over the 5x5 neighbouring chasm cells, chipped by
 * ridged noise at two scales, decides where the void is; it fills its own cells and bulges up to half a tile into the
 * floor. Inside: floor-coloured cliff in strata and chipped ledges falling into black; at the edge a broken lit lip; just
 * outside a soft shadow on the ground. Null when nothing of it falls in this tile.
 */
export function chasmRaster(isVoid, x, y, tint, salt) {
  const R = 64, c = document.createElement('canvas'); c.width = c.height = R;
  const g = c.getContext('2d'), im = g.createImageData(R, R), D = im.data, own = isVoid(x, y), near = new Uint8Array(25);
  for (let oy = -2; oy <= 2; oy++) for (let ox = -2; ox <= 2; ox++) near[(oy + 2) * 5 + ox + 2] = isVoid(x + ox, y + oy) ? 1 : 0;
  let any = false;
  for (let v = 0; v < R; v++) for (let u = 0; u < R; u++) {
    const wx = x + (u + 0.5) / R, wy = y + (v + 0.5) / R, p = (v * R + u) * 4;
    const col = chasmColour(chasmDepth(near, own, x, y, wx, wy, salt), tint, wx, wy, salt);
    if (!col) continue;
    any = true; D[p] = col[0]; D[p + 1] = col[1]; D[p + 2] = col[2]; D[p + 3] = Math.max(0, Math.min(255, col[3]));
  }
  if (!any) return null;
  g.putImageData(im, 0, 0);
  return c;
}

/**
 * The rule chasmRaster draws by, at one point (wx, wy) of tile (x, y): how far into the chasm it lies. near: the 5 x 5
 * cells round (x, y), 1 where void; own: (x, y) is void. Over 0 the drop (0.3 on, its depth); just under 0 the lip; a
 * little further the shadow on the ground. The Realm's islands meet their void by it too (realm-raster.js, item 185).
 */
export function chasmDepth(near, own, x, y, wx, wy, salt) {
  let sum = 0, wsum = 0;
  for (let oy = -2; oy <= 2; oy++) for (let ox = -2; ox <= 2; ox++) {
    const dx = wx - (x + ox + 0.5), dy = wy - (y + oy + 0.5);
    let w = Math.max(0, 1 - Math.hypot(dx, dy) / 1.35);
    if (!w) continue;
    w *= w; wsum += w; if (near[(oy + 2) * 5 + ox + 2]) sum += w;
  }
  const f = wsum ? sum / wsum : 0;
  const r1 = 1 - Math.abs(noise(wx * 2.1, wy * 2.1, salt + 4) * 2 - 1), r2 = 1 - Math.abs(noise(wx * 5.3, wy * 5.3, salt + 5) * 2 - 1);
  const thr = 0.36 + (noise(wx * 0.9, wy * 0.9, salt + 1) - 0.5) * 0.16 + (r1 - 0.5) * 0.2 + (r2 - 0.5) * 0.1;
  return own ? Math.max(0.02, f - thr) : f - thr;
}

/**
 * The chasm's colour at depth e (chasmDepth) in a floor of tint T, as [r, g, b, a], or null. Over 0: cliff in strata and
 * chipped ledges falling into black; then the broken lit lip; then a soft shadow.
 */
export function chasmColour(e, T, wx, wy, salt) {
  if (e > 0) {
    const k = Math.min(1, e / 0.3), strata = noise(wx * 2.5, wy * 11, salt + 3), chip = noise(wx * 7, wy * 7, salt + 6);
    const sh = 0.55 * (1 - k) * (strata < 0.45 ? 0.72 : 1) * (chip > 0.72 && k < 0.55 ? 1.35 : 1);
    return [T[0] * sh + 4 * k, T[1] * sh * 0.97 + 4 * k, T[2] * sh + 7 * k, 255];
  }
  if (e > -0.03 && noise(wx * 9, wy * 9, salt + 7) > 0.3) return [Math.min(255, T[0] * 1.22), Math.min(255, T[1] * 1.2), Math.min(255, T[2] * 1.18), 200];
  if (e > -0.07) return [T[0] * 0.45, T[1] * 0.43, T[2] * 0.45, Math.round(90 * (1 - (-e - 0.022) / 0.048))];
  return null;
}

/**
 * CV4 (1.7 cavefixes.js mawSkirtRaster, Justin 2026-09-19: the mounds sat on the stone like a pile set down on it): under a
 * Maw burrow mound, 4 by 4 tiles of churned dark earth fading past its footprint with a heaved, lit lip, cracks running
 * out from it and pebbles thrown up, in the cavern floor's tint. x, y: the top-left tile of the 4 by 4.
 */
export function mawSkirtRaster(x, y, salt) {
  const T = 24, R = T * 4, c = document.createElement('canvas'); c.width = c.height = R;
  const g = c.getContext('2d'), im = g.createImageData(R, R), D = im.data, M = CHASM_TINT.caverns, cx = R / 2, cy = R * 0.56;
  for (let v = 0; v < R; v++) for (let u = 0; u < R; u++) {
    const dx = (u - cx) / (T * 1.55), dy = (v - cy) / (T * 1.15), wx = x + u / T, wy = y + v / T;
    const d = Math.hypot(dx, dy) + (noise(wx * 1.6, wy * 1.6, salt) - 0.5) * 0.35, p = (v * R + u) * 4;
    let col = null, a = 0;
    if (d < 1) {
      const k = 1 - d, grit = hash2(u >> 1, v >> 1, salt + 1);
      col = [M[0] * 0.36, M[1] * 0.31, M[2] * 0.27]; a = Math.round(215 * Math.pow(k, 0.5) * (grit < 0.2 ? 0.7 : 1));
      if (d > 0.8 && noise(wx * 4, wy * 4, salt + 5) > 0.45) { col = [M[0] * 1.18, M[1] * 1.1, M[2]]; a = Math.round(170 * (1 - Math.abs(d - 0.9) / 0.1)); }
    }
    const an = Math.atan2(dy, dx), rk = ((an + Math.PI) / (Math.PI * 2)) * 7 + (noise(wx * 2.5, wy * 2.5, salt + 2) - 0.5) * 0.6;
    const rd = Math.abs(rk - Math.round(rk)), reach = 0.9 + 0.5 * hash2(Math.round(rk), 3, salt + 3);
    if (d > 0.5 && d < reach && rd < 0.05 * (1.25 - d / reach)) { col = [M[0] * 0.3, M[1] * 0.27, M[2] * 0.25]; a = Math.round(200 * (1 - (d - 0.55) / (reach - 0.55))); }
    const cell = hash2(u >> 2, v >> 2, salt + 4);
    if (d > 0.45 && d < 1.35 && cell < 0.07 * (1.4 - d) && (u & 3) < 2 && (v & 3) < 2) { const lit = (v & 3) === 0; col = lit ? [M[0] * 1.15, M[1] * 1.12, M[2] * 1.08] : [M[0] * 0.6, M[1] * 0.56, M[2] * 0.52]; a = 235; }
    if (!col) continue;
    D[p] = Math.min(255, col[0]); D[p + 1] = Math.min(255, col[1]); D[p + 2] = Math.min(255, col[2]); D[p + 3] = Math.max(0, Math.min(255, a));
  }
  g.putImageData(im, 0, 0);
  return c;
}

/** 1.7 surface.js scorchRaster: a burnt stain over 1.5 tiles, noisy at its edges, open on the sides that touch burnt cells. */
export function scorchRaster(gAt, x, y, ash, salt) {
  const R = 48, N = 32, P = 8, c = document.createElement('canvas'); c.width = c.height = R;
  const g = c.getContext('2d'), im = g.createImageData(R, R), D = im.data;
  const burned = (xx, yy) => { const v = gAt(xx, yy); return v === G.SCORCH || v === G.ASH; };
  const left = burned(x - 1, y), right = burned(x + 1, y), top = burned(x, y - 1), bottom = burned(x, y + 1);
  for (let v = 0; v < R; v++) for (let u = 0; u < R; u++) {
    const fx = (u + 0.5 - P) / N, fy = (v + 0.5 - P) / N, wx = x + fx, wy = y + fy;
    let edge = 1;
    if (!left) edge = Math.min(edge, (fx + 0.25) * 2);
    if (!right) edge = Math.min(edge, (1.25 - fx) * 2);
    if (!top) edge = Math.min(edge, (fy + 0.25) * 2);
    if (!bottom) edge = Math.min(edge, (1.25 - fy) * 2);
    const nz = noise(wx * 6, wy * 6, salt) * 0.65 + noise(wx * 19, wy * 19, salt + 1) * 0.35;
    const fringe = Math.max(0, Math.min(1, (fx + 0.25) * 4, (1.25 - fx) * 4, (fy + 0.25) * 4, (1.25 - fy) * 4));
    const density = fringe * Math.max(0, Math.min(1, edge + nz * 0.4 - 0.18)) * Math.max(0, Math.min(1, (nz - 0.19) * 1.6));
    if (!density) continue;
    const p = (v * R + u) * 4, grain = hash2(u - P + x * N, v - P + y * N, salt + 2), gray = ash ? 24 + grain * 32 : 10 + grain * 12;
    D[p] = gray; D[p + 1] = gray * 0.91; D[p + 2] = gray * 0.85; D[p + 3] = density * (ash ? 170 : 190);
    if (ash && grain > 0.986) { D[p] = 151; D[p + 1] = 141; D[p + 2] = 130; D[p + 3] = density * 170; }
  }
  g.putImageData(im, 0, 0);
  return c;
}
