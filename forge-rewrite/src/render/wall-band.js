// The wall band (ruled: Justin 2026-10-17, item 107; 1.7 drew none): the floor darkens softly where it meets a wall,
// deepest under a face, lighter beside a wall, eased round corners, feathered: f721b64's look, which he approved.
// lighting.js draws it into the shadow mask. Pure.

import data from '../../data/lighting.json' with { type: 'json' };
import { bandTiles } from './light-grid.js';

const B = data.rows.pipeline.wallBand;
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const veils = new Float32Array(9);   // a texel's deepest veil from each wall run round its tile (by direction)

/** A box blur along one axis of a W x H picture, in place (radius B.blur). */
function box(a, len, lines, step, line) {
  const tmp = new Float32Array(len), r = B.blur, n = 2 * r + 1;
  for (let l = 0; l < lines; l++) {
    const o0 = l * line; let sum = 0;
    for (let j = -r; j <= r; j++) sum += a[o0 + Math.min(len - 1, Math.max(0, j)) * step];
    for (let j = 0; j < len; j++) { tmp[j] = sum / n; sum += a[o0 + Math.min(len - 1, j + r + 1) * step] - a[o0 + Math.max(0, j - r) * step]; }
    for (let j = 0; j < len; j++) a[o0 + j * step] = tmp[j];
  }
}

/**
 * The shade 0-1 at wallBand.steps texels a tile over the whole floor, or over region [x0, y0, x1, y1] (tiles) only
 * (a door opening: the same numbers as the whole floor's at least two texels in from the region's edge), or null when
 * no wall touches ground there. Dungeon and Crypt laid floors only (the caller decides). dither: a faint ordered
 * dither against banding, laid by the texel's place on the floor.
 */
export function wallBand(floor, o = {}) {
  const STEPS = B.steps, { w, h } = floor, dither = o.dither ?? false, kind = o.kind ?? bandTiles(floor);
  const [x0, y0, x1, y1] = o.region ?? [0, 0, w - 1, h - 1], W = (x1 - x0 + 1) * STEPS, H = (y1 - y0 + 1) * STEPS;
  const wall = (x, y) => x < 0 || y < 0 || x >= w || y >= h || kind[y * w + x] === 2, ground = (x, y) => x >= 0 && y >= 0 && x < w && y < h && kind[y * w + x] === 1;
  const at = (tx, ty, u, v) => ((ty - y0) * STEPS + v) * W + (tx - x0) * STEPS + u;
  let out = null;
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
    if (!ground(tx, ty)) continue;
    const near = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && wall(tx + dx, ty + dy)) near.push([tx + dx, ty + dy]);
    if (!near.length) continue;
    out ??= new Float32Array(W * H);
    // Item 192 (Justin: "noticing a seam in the floor"): one wall run never veils a texel twice. A corner wall tile is
    // part of the run beside it (the one across the tile's row or column), else a run of its own; a texel takes its
    // deepest veil from each run and the runs' veils stack (an inner corner is darker). Stacking every wall tile darkened
    // each tile edge along a straight wall, a line at every tile.
    const runOf = near.map(([wx, wy]) => { const dx = wx - tx, dy = wy - ty; return !dx || !dy ? (dy + 1) * 3 + dx + 1 : wall(tx, wy) ? (dy + 1) * 3 + 1 : wall(wx, ty) ? 3 + dx + 1 : (dy + 1) * 3 + dx + 1; });
    for (let v = 0; v < STEPS; v++) for (let u = 0; u < STEPS; u++) {
      const px = tx + (u + 0.5) / STEPS, py = ty + (v + 0.5) / STEPS;
      veils.fill(0);
      near.forEach(([wx, wy], j) => {
        const ex = px < wx ? wx - px : px > wx + 1 ? px - wx - 1 : 0, ey = py > wy + 1 ? py - wy - 1 : py < wy ? wy - py : 0;
        const d = Math.hypot(ex, ey), below = py > wy + 1 ? ey / Math.max(d, 1e-6) : 0, k = below * below;
        const round = ex > 0 && ey > 0 ? Math.min(ex, ey) / Math.max(ex, ey) : 0;
        const run = B.side.run + (B.face.run - B.side.run) * k, depth = (B.side.depth + (B.face.depth - B.side.depth) * k) * (1 - (1 - B.diag) * round);
        if (d >= run) return;
        const q = 1 - d / run;
        veils[runOf[j]] = Math.max(veils[runOf[j]], depth * q * Math.sqrt(q));
      });
      let keep = 1;   // the light left after every run's veil
      for (const v of veils) keep *= 1 - v;
      const s = Math.min(B.cap, 1 - keep);
      if (s > 0) out[at(tx, ty, u, v)] = s;
    }
  }
  if (!out) return null;
  // A wall's own texels take their ground neighbours' shade mirrored across the shared edge, so the feather keeps the
  // band's full depth at the wall's foot.
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
    if (!wall(tx, ty)) continue;
    const sides = [[0, 1], [0, -1], [1, 0], [-1, 0]].filter(([dx, dy]) => tx + dx >= x0 && tx + dx <= x1 && ty + dy >= y0 && ty + dy <= y1 && ground(tx + dx, ty + dy));
    if (!sides.length) continue;
    for (let v = 0; v < STEPS; v++) for (let u = 0; u < STEPS; u++) {
      let m = 0;
      for (const [dx, dy] of sides) m = Math.max(m, out[at(tx + dx, ty + dy, dx ? STEPS - 1 - u : u, dy ? STEPS - 1 - v : v)]);
      out[at(tx, ty, u, v)] = m;
    }
  }
  for (let pass = 0; pass < 2; pass++) { box(out, W, H, 1, W); box(out, H, W, W, 1); }
  for (let i = 0; i < out.length; i++) {
    if (out[i] < 0.002) out[i] = 0;
    else if (dither) out[i] = Math.max(0, out[i] + B.dither * (BAYER[(((i / W) | 0) + y0 * STEPS & 3) * 4 + ((i % W) + x0 * STEPS & 3)] / 15 - 0.5) * 2);
  }
  return out;
}
