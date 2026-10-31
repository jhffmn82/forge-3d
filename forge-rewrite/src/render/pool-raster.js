// The pooled-liquid raster (consolidation M5, render-14): 1.7's cryptset.js oozeRaster and drawGroundMaterial, one
// connected pool over a set of cells with a lip at its shore, its edges merging across neighbouring cells. The Crypt's
// ooze (crypt-look.js), the ground residues (fields-view.js) and the Realm's poison trails (realm-view.js) each paint it
// in their own colours through `colour`; the field, the threshold and the shore are 1.7's and shared.

import { noise } from '../lib/noise.js';

const R = 32, TH = 0.22, SHORE = 0.07, E = 1.5 / 128;

/**
 * Paints the pool over `cells` (floor cell indices) at R samples a tile into a fresh canvas, one cell of margin round
 * them (clamped to the floor when `clamp`). skip(x, y): a cell the pool never covers (a wall). colour(s) gives
 * [r, g, b, a] for one sample, or null for none; s: { wx, wy, cx, cy, f, deep, shore, facing() } (facing: how much the
 * field rises toward the lit upper left, for the shore's glint). Returns { canvas, x0, y0, x1, y1, filled } (filled:
 * the cells some sample covered).
 */
export function poolRaster(floor, cells, { salt = 7, clamp = false, skip = null, colour }) {
  const W = floor.w, set = new Set(cells);
  let x0 = W, y0 = floor.h, x1 = 0, y1 = 0;
  for (const k of cells) { const x = k % W, y = (k / W) | 0; x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  if (clamp) { x0 = Math.max(0, x0 - 1); y0 = Math.max(0, y0 - 1); x1 = Math.min(W - 1, x1 + 1); y1 = Math.min(floor.h - 1, y1 + 1); }
  else { x0 -= 1; y0 -= 1; x1 += 1; y1 += 1; }
  const cw = (x1 - x0 + 1) * R, ch = (y1 - y0 + 1) * R, canvas = document.createElement('canvas');
  canvas.width = cw; canvas.height = ch;
  const g = canvas.getContext('2d'), im = g.createImageData(cw, ch), D = im.data, filled = new Set();
  const near = (wx, wy) => { const out = []; for (let yy = Math.floor(wy) - 2; yy <= Math.floor(wy) + 2; yy++) for (let xx = Math.floor(wx) - 2; xx <= Math.floor(wx) + 2; xx++) if ((!clamp || (xx >= 0 && xx < W)) && set.has(yy * W + xx)) out.push([xx + 0.5, yy + 0.5]); return out; };
  const field = (wx, wy, cs) => { let f = 0; for (const [cx, cy] of cs) { const d = Math.hypot(wx - cx, wy - cy) / 1.4; if (d < 1) f += (1 - d) * (1 - d); } return f ? f + (noise(wx * 1.9, wy * 1.9, salt) - 0.5) * 0.34 + (noise(wx * 5.3, wy * 5.3, salt + 5) - 0.5) * 0.12 : 0; };
  for (let v = 0; v < ch; v++) for (let u = 0; u < cw; u++) {
    const wx = x0 + (u + 0.5) / R, wy = y0 + (v + 0.5) / R, cx = Math.floor(wx), cy = Math.floor(wy);
    if (skip?.(cx, cy)) continue;   // the pool runs up to a wall, never onto it
    const cs = near(wx, wy); if (!cs.length) continue;
    const f = field(wx, wy, cs); if (f < TH) continue;
    const c = colour({ wx, wy, cx, cy, f, deep: Math.min(1, (f - TH) * 2.2), shore: f < TH + SHORE, facing: () => f - field(wx - E, wy - E, cs) });
    if (!c) continue;
    const p = (v * cw + u) * 4;
    D[p] = c[0]; D[p + 1] = c[1]; D[p + 2] = c[2]; D[p + 3] = c[3];
    filled.add(cy * W + cx);
  }
  g.putImageData(im, 0, 0);
  return { canvas, x0, y0, x1, y1, filled };
}
