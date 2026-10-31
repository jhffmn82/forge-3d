// The Caverns' shape field: where rock, cliff face, floor, pool and shore are, at sub-tile resolution, worked out once
// a floor from its tiles. The GPU surface (cave-surface.js) paints from it and relief lights from it, so the light
// and the picture share one outline. Matches the look of 1.7's cave rock (js/world/planes/planeterrain.js ptSolid,
// ptKind, the cliff faces and pool fields @3c8b312), written new: one pass over a grid of samples, no per-pixel raster.
//
// Per sample (S a tile), packed for two RGBA textures:
//   shape  R the rock field, 0.5 at the outline (linear across it, so the shader draws a clean edge at any zoom)
//          G distance from the sample to open ground, in tiles x 0.5 (rock past its band is the dark beyond)
//          B unused (the cliff faces are in kinds, worked out on the drawn outline)
//          A the pool field (water's weight, its shallows and shore), x 0.5
//   ground R scree: rock this close above the sample (1 right at the cliff foot)
//          G occlusion: the floor darkens where it runs under rock
//          B moss (the ground's moss patches, as a soft field)
//          A 255 on a chasm or bridge tile (drawn over by cave-terrain.js), else 0
// And, at KS a tile, kinds (for relief, and for the shader's cliff faces): R 1 floor, 2 face, 3 top; G the rock's height
// above its outline (fine-kinds.js rockKind); B how far straight down open ground is (to 1.6 tiles); A 255. Worked out on the outline the shader draws
// (its jagged edge mirrored here on the same noise lattice), so the light and the paint meet at the same line.
// Pure: no DOM, no Pixi.

import { T, G, isWallTile } from '../data/tiles.js';
import { noise } from '../lib/noise.js';
import { rockKind } from './fine-kinds.js';

export const S = 8;   // samples a tile
const FACE = 0.8;     // a cliff face is 0.8 of a tile tall (PT_MAT.cavern faceH)
// The 5 x 5 vote's weights depend only on where a sample sits in its cell: worked out once for the S x S positions.
const WEIGHTS = (() => {
  const out = new Float32Array(S * S * 26);
  for (let j = 0; j < S * S; j++) {
    const fx = (j % S + 0.5) / S, fy = (((j / S) | 0) + 0.5) / S;
    let sum = 0, k = 0;
    for (let oy = -2; oy <= 2; oy++) for (let ox = -2; ox <= 2; ox++, k++) { const d = Math.hypot(fx - ox - 0.5, fy - oy - 0.5), wt = Math.max(0, 1 - d / 1.35) ** 2; out[j * 26 + k] = wt; sum += wt; }
    out[j * 26 + 25] = sum;
  }
  return out;
})();
/** A sample's distance from its cell's middle, by its position in the cell. */
const CORE = Float32Array.from({ length: S * S }, (_, j) => Math.hypot((j % S + 0.5) / S - 0.5, (((j / S) | 0) + 0.5) / S - 0.5));

// The lattice the shader's value noise reads (cave-surface.js uNoise, lattice, vnoise): NOISE x NOISE random bytes
// from an integer hash, each noise offset across it by its own salt. A table, not a hash in the shader: the hash
// inlined at every one of the shader's noise calls took the graphics driver seconds to compile.
export const NOISE = 512;
export const NOISE_TABLE = (() => {
  const t = new Uint8Array(NOISE * NOISE);
  for (let y = 0; y < NOISE; y++) for (let x = 0; x < NOISE; x++) {
    let h = (Math.imul(x + 4096, 374761393) + Math.imul(y + 4096, 668265263)) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
    t[y * NOISE + x] = (h ^ (h >>> 16)) & 255;
  }
  return t;
})();
const M = NOISE - 1;
const lattice = (ix, iy, ox, oy) => NOISE_TABLE[((iy + oy) & M) * NOISE + ((ix + ox) & M)] / 255;
// The shader's broken rock edge (cave-surface.js vnoise, ridged, jagAt), on the same lattice.
export function vnoise(x, y, s) {
  const ox = (s * 73) & M, oy = (s * 151) & M, ix = Math.floor(x), iy = Math.floor(y);
  let fx = x - ix, fy = y - iy;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
  const a = lattice(ix, iy, ox, oy), b = lattice(ix + 1, iy, ox, oy), c = lattice(ix, iy + 1, ox, oy), d = lattice(ix + 1, iy + 1, ox, oy);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}
const ridged = (x, y, s) => 1 - Math.abs(vnoise(x, y, s) * 2 - 1);
const jagAt = (x, y, salt) => (ridged(x * 3.6, y * 3.6, salt + 41) - 0.5) * 0.4 * 0.55 + (ridged(x * 8.2, y * 8.2, salt + 43) - 0.5) * 0.4 * 0.3;

/** Euclidean distance (in samples) from each sample to the nearest sample where mask is 0 (Felzenszwalb and Huttenlocher). */
function edt(mask, w, h) {
  const INF = 1e12, f = new Float64Array(Math.max(w, h)), d = new Float64Array(Math.max(w, h)), v = new Int32Array(Math.max(w, h)), z = new Float64Array(Math.max(w, h) + 1);
  const grid = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) grid[i] = mask[i] ? INF : 0;
  const pass = (n, get, set) => {
    for (let q = 0; q < n; q++) f[q] = get(q);
    let k = 0; v[0] = 0; z[0] = -INF; z[1] = INF;
    for (let q = 1; q < n; q++) {
      let s2 = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s2 <= z[k]) { k--; s2 = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
      k++; v[k] = q; z[k] = s2; z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; d[q] = (q - v[k]) * (q - v[k]) + f[v[k]]; }
    for (let q = 0; q < n; q++) set(q, d[q]);
  };
  for (let x = 0; x < w; x++) pass(h, y => grid[y * w + x], (y, val) => { grid[y * w + x] = val; });
  for (let y = 0; y < h; y++) pass(w, x => grid[y * w + x], (x, val) => { grid[y * w + x] = val; });
  const out = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) out[i] = Math.sqrt(grid[i]);
  return out;
}

/** @param {{w:number,h:number,tiles:number[],ground?:number[]}} floor @param {number} salt */
export function buildCaveField(floor, salt) {
  const W = floor.w, H = floor.h, w = W * S, h = H * S;
  const wall = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) wall[i] = isWallTile(floor.tiles[i]) ? 1 : 0;
  const isWall = (x, y) => x < 0 || y < 0 || x >= W || y >= H || wall[y * W + x] === 1;
  // Cells a step from open ground (Chebyshev distance to the nearest open cell, up to 3).
  const cd = new Uint8Array(W * H).fill(9), q = [];
  for (let i = 0; i < W * H; i++) if (!wall[i]) { cd[i] = 0; q.push(i); }
  for (let k = 0; k < q.length; k++) {
    const i = q[k], x = i % W, y = (i / W) | 0, d = cd[i] + 1; if (d > 3) continue;
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) { const nx = x + ox, ny = y + oy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue; const n = ny * W + nx; if (cd[n] > d) { cd[n] = d; q.push(n); } }
  }

  // The rock field: a soft weighted vote of the 5 x 5 cells round each sample, its threshold wobbled by slow noise, so
  // rock forms large connected masses with clean inside and outside corners. Open cells keep a round core. A tile
  // whose 3 x 3 is all one kind is all that kind; only tiles along an edge are voted, a tile at a time.
  const shape = new Uint8Array(w * h * 4), ground = new Uint8Array(w * h * 4);
  const rockV = new Float32Array(w * h), bits = new Uint8Array(25);
  for (let cy = 0; cy < H; cy++) for (let cx = 0; cx < W; cx++) {
    const own = isWall(cx, cy);
    let mixed = false;
    for (let oy = -1; oy <= 1 && !mixed; oy++) for (let ox = -1; ox <= 1; ox++) if (isWall(cx + ox, cy + oy) !== own) { mixed = true; break; }
    if (!mixed) { const val = own ? 1 : -1; for (let sv = 0; sv < S; sv++) rockV.fill(val, (cy * S + sv) * w + cx * S, (cy * S + sv) * w + cx * S + S); continue; }
    let k = 0;
    for (let oy = -2; oy <= 2; oy++) for (let ox = -2; ox <= 2; ox++, k++) bits[k] = isWall(cx + ox, cy + oy) ? 1 : 0;
    for (let sv = 0; sv < S; sv++) for (let su = 0; su < S; su++) {
      const j = (sv * S + su) * 26, wx = cx + (su + 0.5) / S, wy = cy + (sv + 0.5) / S;
      let sum = 0;
      for (let k2 = 0; k2 < 25; k2++) if (bits[k2]) sum += WEIGHTS[j + k2];
      const thr = 0.5 + (noise(wx * 0.85, wy * 0.85, salt + 3) - 0.5) * 0.34 + (noise(wx * 2.3, wy * 2.3, salt + 4) - 0.5) * 0.1;
      let r = sum / WEIGHTS[j + 25] - thr;
      const rc = CORE[sv * S + su];
      if (!own && r > 0 && rc < 0.3) r = -0.02;   // an open cell is always walkable at its middle
      if (own && r < 0 && rc < 0.26) r = 0.02;
      rockV[(cy * S + sv) * w + cx * S + su] = r;
    }
  }
  // 1.7 drops one-sample slivers: rock with open ground on both sides along a row or a column is floor.
  const rockAt = (u, v) => (u < 0 || v < 0 || u >= w || v >= h ? true : rockV[v * w + u] > 0);
  const solid = new Uint8Array(w * h);
  for (let v = 0; v < h; v++) for (let u = 0; u < w; u++) {
    let r = rockAt(u, v);
    if (r && ((!rockAt(u - 1, v) && !rockAt(u + 1, v)) || (!rockAt(u, v - 1) && !rockAt(u, v + 1)))) r = false;
    solid[v * w + u] = r ? 1 : 0;
  }
  const solidAt = (u, v) => (u < 0 || v < 0 || u >= w || v >= h ? 1 : solid[v * w + u]);
  // Distance from a rock sample to open ground (the band), Euclidean, in samples (Felzenszwalb's two-pass transform).
  const far = edt(solid, w, h);
  // Pools: each water tile weighs in round its middle, a little wider than tall (1.7 ptPoolField).
  const water = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) water[i] = floor.tiles[i] === T.WATER ? 1 : 0;
  const wetNear = new Uint8Array(W * H), mossNear = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (water[y * W + x] || floor.ground?.[y * W + x] === G.MOSS) for (let oy = -2; oy <= 2; oy++) for (let ox = -2; ox <= 2; ox++) { const nx = x + ox, ny = y + oy; if (nx >= 0 && ny >= 0 && nx < W && ny < H) { if (water[y * W + x]) wetNear[ny * W + nx] = 1; else mossNear[ny * W + nx] = 1; } }
  const moss = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) moss[i] = floor.ground?.[i] === G.MOSS ? 1 : 0;
  const soft = (wx, wy, mask, sx, sy, rad) => {
    const cx = Math.floor(wx), cy = Math.floor(wy);
    let f = 0;
    for (let oy = -2; oy <= 2; oy++) for (let ox = -2; ox <= 2; ox++) {
      const nx = cx + ox, ny = cy + oy; if (nx < 0 || ny < 0 || nx >= W || ny >= H || !mask[ny * W + nx]) continue;
      const d = Math.hypot((wx - nx - 0.5) * sx, (wy - ny - 0.5) * sy) / rad; if (d < 1) f += (1 - d) * (1 - d);
    }
    return f;
  };
  const SCREE = Math.max(2, Math.round(S * 7 / 32));   // scree and the floor's shade reach 7/32 of a tile from the rock
  for (let v = 0; v < h; v++) for (let u = 0; u < w; u++) {
    const i = v * w + u, p = i * 4, wx = (u + 0.5) / S, wy = (v + 0.5) / S, tx = Math.floor(wx), ty = Math.floor(wy);
    shape[p] = Math.max(0, Math.min(255, Math.round(128 + rockV[i] * 255)));
    if (solid[i] && rockV[i] <= 0) shape[p] = 129;   // a sliver kept as rock by the clean-up keeps the rock side
    if (!solid[i] && rockV[i] > 0) shape[p] = 126;   // and one dropped becomes floor
    shape[p + 1] = Math.min(255, Math.round(far[i] / S * 0.5 * 255));   // to 2 tiles
    if (!solid[i]) {
      let pf = wetNear[ty * W + tx] ? soft(wx, wy, water, 1, 1.1, 1.5) : 0;
      if (pf) pf += (noise(wx * 1.6, wy * 1.6, 977) - 0.5) * 0.22;
      shape[p + 3] = Math.max(0, Math.min(255, Math.round(pf * 0.5 * 255)));
      // Scree and occlusion: rock just above (and beside) the sample.
      let up = 0;
      for (let d = 1; d <= SCREE; d++) if (solidAt(u, v - d)) { up = d; break; }
      ground[p] = up ? Math.round(255 * (SCREE - up + 1) / SCREE) : 0;
      let occ = 0;
      for (let d = 1; d <= SCREE; d++) {
        if (solidAt(u, v - d)) occ = Math.max(occ, 1 - d / (SCREE * 9 / 7));
        if (solidAt(u - d, v) || solidAt(u + d, v)) occ = Math.max(occ, 0.6 * (1 - d / (SCREE * 9 / 7)));
      }
      ground[p + 1] = Math.round(occ * 255);
      if (mossNear[ty * W + tx]) ground[p + 2] = Math.min(255, Math.round(soft(wx, wy, moss, 1, 1, 1.9) * 160));
    }
    const t = floor.tiles[ty * W + tx];
    ground[p + 3] = t === T.CHASM || t === T.BRIDGE ? 255 : 0;
  }
  // Relief's per-pixel kinds (relief.js setFineKinds): R 1 floor, 2 face, 3 top; G the height above the outline; A inside.
  // Read from the very outline the shader paints (cave-surface.js rockAt and its face test, mirrored here), at KS a
  // tile, so the light's faces and shadows sit on the drawn rock. Only tiles near an edge are worked out sample by sample.
  let kindsMemo = null;
  const KS = 32, B = S / 4, KB = KS / 4, kinds = (exact = false) => {   // exact: every sample worked out (tests check the shortcut against it)
    if (kindsMemo && !exact) return kindsMemo;
    const kw = W * KS, kh = H * KS, data = new Uint8Array(kw * kh * 4);
    const R = u => shape[u * 4];
    const field = (x, y) => {   // GL linear sampling of uShape's R, texel centres at (k + 0.5) / S, clamped to the edge
      const fx = Math.min(w - 1, Math.max(0, x * S - 0.5)), fy = Math.min(h - 1, Math.max(0, y * S - 0.5));
      const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1), ax = fx - x0, ay = fy - y0;
      const a = R(y0 * w + x0), b = R(y0 * w + x1), c = R(y1 * w + x0), d = R(y1 * w + x1);
      return (a + (b - a) * ax + (c - a) * ay + (a - b - c + d) * ax * ay) / 255;
    };
    const at = (x, y) => field(x, y) - 128 / 255 - jagAt(x, y, salt) * 0.35;
    // Rock or not at every sample: a quarter-tile block whose field stays clear of the outline (past the jag's reach)
    // is all one kind; only blocks the outline may cross are worked out sample by sample.
    const rock = new Uint8Array(kw * kh), bw = w / B, bh = h / B;
    for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
      let mn = 9, mx = -9;
      for (let v = by * B - 1; v <= by * B + B; v++) for (let u = bx * B - 1; u <= bx * B + B; u++) {
        const r = (R(Math.min(h - 1, Math.max(0, v)) * w + Math.min(w - 1, Math.max(0, u))) - 128) / 255; if (r < mn) mn = r; if (r > mx) mx = r;
      }
      const sure = exact ? -1 : mn > 0.075 ? 1 : mx < -0.075 ? 0 : -1;
      for (let v = 0; v < KB; v++) for (let u = 0; u < KB; u++) {
        const gu = bx * KB + u, gv = by * KB + v;
        rock[gv * kw + gu] = sure >= 0 ? sure : at((gu + 0.5) / KS, (gv + 0.5) / KS) > 0 ? 1 : 0;
      }
    }
    // Each rock sample's face: how far straight down open ground is, found a column at a time from the bottom and
    // placed on the outline itself between the last rock sample and the first open one, so it runs smoothly across
    // samples: under FACE the sample is a cliff face. B carries it to REACH (the shader's face and lip, filtered, so
    // the top of a face is as clean a line as its foot); G is relief's height above the outline (fine-kinds.js rockKind).
    const REACH = 1.6;
    for (let gu = 0; gu < kw; gu++) {
      let open = -1;   // the nearest open sample below, in this column
      for (let gv = kh - 1; gv >= 0; gv--) {
        const i = gv * kw + gu, q = i * 4;
        let k = 1, up = 0, reach = 0;
        if (!rock[i]) open = gv;
        else {
          k = 3; reach = 255; up = 255;
          const n = open - gv;
          if (open >= 0 && n <= REACH * KS + 1) {
            const x = (gu + 0.5) / KS, y = (gv + 0.5) / KS, lo2 = (n - 1) / KS, hi2 = n / KS;
            const a0 = Math.max(1e-6, at(x, y + lo2)), a1 = Math.min(0, at(x, y + hi2));
            const dist = lo2 + (hi2 - lo2) * a0 / (a0 - a1);   // where the outline crosses between the two samples
            reach = Math.round(255 * Math.min(1, dist / REACH));
            ({ k, up } = rockKind(dist, FACE));   // item 211: G for tops too, so the light draws the lip between texels
          }
        }
        data[q] = k; data[q + 1] = up; data[q + 2] = reach; data[q + 3] = 255;
      }
    }
    const out = { S: KS, w: kw, h: kh, data };
    if (!exact) kindsMemo = out;
    return out;
  };
  return { S, w, h, shape, ground, solid, kinds };
}
