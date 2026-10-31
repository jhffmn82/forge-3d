// The terrain's own glow for the light (light-grid.js's ambient): the floor art's hot paint spilled half a tile, and the
// wide vein glow. Its working arrays are kept and refilled, so a step allocates nothing (feel spec A16).

import data from '../../data/lighting.json' with { type: 'json' };

const S = data.rows.pipeline.samplesPerTile;
const pool = new Map();
/** A zeroed working array of this kind and length, the same one each step. */
const take = (name, Kind, n) => { let a = pool.get(name); if (!a || a.length !== n) { a = new Kind(n); pool.set(name, a); } else a.fill(0); return a; };

/**
 * The terrain's own glow (1.7 environment-terrain.js accentFrame): bins of the floor art's hot paint (view.terrainAccent:
 * {bins RGB, level [ceiling, gain] a tile, w, h, perTile}), averaged per sample, spilled half a tile over admitted
 * samples (in sight, not wall), levelled by the tile's gain and ceiling; plus the rewrite's wide vein glow (Justin
 * 2026-10-16, lighting.json veinGlow). Off in a dark room and while Blind (level-lighting.js:135-136). Adds into amb.
 */
export function addAccent(A, state, amb, admittedOf) {
  const f = state.floor, W = f.w * S, H = f.h * S, Pt = A.perTile, N = W * H;
  const admitted = take('admitted', Uint8Array, N), raw = take('raw', Float32Array, N * 3), all = take('all', Float32Array, N * 3);
  const ceil = take('ceil', Float32Array, N).fill(0.24), gain = take('gain', Float32Array, N).fill(18);
  for (let sy = 0; sy < H; sy++) for (let sx = 0; sx < W; sx++) {
    const x = Math.floor(sx / S), y = Math.floor(sy / S), i = sy * W + sx;
    if (!state.vis?.[y * f.w + x]) continue;
    const open = admittedOf(x, y);
    admitted[i] = open ? 1 : 0;
    const t = y * f.w + x;
    if (A.level[t * 2] > 0) { ceil[i] = A.level[t * 2]; gain[i] = A.level[t * 2 + 1]; }
    const lx = sx % S, ly = sy % S, gx0 = Math.floor(lx * Pt / S), gx1 = Math.ceil((lx + 1) * Pt / S), gy0 = Math.floor(ly * Pt / S), gy1 = Math.ceil((ly + 1) * Pt / S), n = (gx1 - gx0) * (gy1 - gy0);
    for (let gy = gy0; gy < gy1; gy++) for (let gx = gx0; gx < gx1; gx++) { const b = ((y * Pt + gy) * A.w + x * Pt + gx) * 3; for (let c = 0; c < 3; c++) all[i * 3 + c] += A.bins[b + c] / n; }
    if (open) for (let c = 0; c < 3; c++) raw[i * 3 + c] = all[i * 3 + c];
  }
  const across = take('across', Float32Array, N * 3), lit = take('lit', Float32Array, N * 3);
  for (let sy = 0; sy < H; sy++) for (let sx = 0; sx < W; sx++) {
    const i = sy * W + sx; if (!admitted[i]) continue;
    for (let d = -1; d <= 1; d++) { const nx = sx + d, j = sy * W + nx; if (nx < 0 || nx >= W || !admitted[j]) continue; for (let c = 0; c < 3; c++) across[i * 3 + c] += raw[j * 3 + c] * (d ? 0.2 : 0.6); }
  }
  for (let sy = 0; sy < H; sy++) for (let sx = 0; sx < W; sx++) {
    const i = sy * W + sx; if (!admitted[i]) continue;
    for (let d = -1; d <= 1; d++) { const ny = sy + d, j = ny * W + sx; if (ny < 0 || ny >= H || !admitted[j]) continue; for (let c = 0; c < 3; c++) lit[i * 3 + c] += across[j * 3 + c] * (d ? 0.2 : 0.6); }
    const peak = Math.max(lit[i * 3], lit[i * 3 + 1], lit[i * 3 + 2]), k = peak > 0 ? Math.min(gain[i], ceil[i] / peak) : 0;
    for (let c = 0; c < 3; c++) amb[i * 3 + c] += lit[i * 3 + c] * k;
  }
  const VG = data.rows.veinGlow, vg = VG?.[f.biome] ?? VG?.default;
  if (!(vg?.strength > 0)) return;
  const r = Math.max(1, Math.round(vg.spread * S)), tmp = take('tmp', Float32Array, N * 3), wide = take('wide', Float32Array, N * 3);
  const blur = (src, dst, along) => {
    const n = along ? W : H, lines = along ? H : W, step = along ? 1 : W;
    for (let l = 0; l < lines; l++) {
      const base = along ? l * W : l;
      for (let c = 0; c < 3; c++) {
        let sum = 0;
        for (let j = -r; j <= r; j++) if (j >= 0 && j < n) sum += src[(base + j * step) * 3 + c];
        for (let j = 0; j < n; j++) {
          dst[(base + j * step) * 3 + c] = sum / (2 * r + 1);
          const add = j + r + 1, drop = j - r;
          if (add < n) sum += src[(base + add * step) * 3 + c];
          if (drop >= 0) sum -= src[(base + drop * step) * 3 + c];
        }
      }
    }
  };
  blur(all, tmp, true); blur(tmp, wide, false);
  for (let i = 0; i < N; i++) {
    const x = Math.floor((i % W) / S), y = Math.floor(i / W / S);
    if (!state.vis?.[y * f.w + x]) continue;
    const pk = Math.max(wide[i * 3], wide[i * 3 + 1], wide[i * 3 + 2]) * vg.strength, k = pk > vg.cap ? vg.cap / pk : 1;
    for (let c = 0; c < 3; c++) amb[i * 3 + c] += wide[i * 3 + c] * vg.strength * k;
  }
}
