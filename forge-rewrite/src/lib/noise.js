// Hash and value noise for painting and generation (consolidation C5, decision 1: moved from world/ground.js so every
// layer reads one copy). Pure: imports nothing.

/** A hash of a whole cell and a salt, 0 to 1: 1.7's hash2 exactly (render.js:135). Its second multiply is a float
 *  multiply truncated by |0, not Math.imul; the two give different numbers, so every hash-picked choice moved. */
export function hash2(x, y, s) {
  let h = (x * 374761393 + y * 668265263 + (s || 0) * 2147483647) | 0;
  h = ((h ^ (h >>> 13)) * 1274126177) | 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

/** Smooth value noise, one lattice unit a tile (1.7's ptVal). */
export function noise(wx, wy, s) {
  const x0 = Math.floor(wx), y0 = Math.floor(wy);
  let fx = wx - x0, fy = wy - y0;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
  const a = hash2(x0, y0, s), b = hash2(x0 + 1, y0, s), c = hash2(x0, y0 + 1, s), d = hash2(x0 + 1, y0 + 1, s);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

/** 1.7's ptVor: the nearest and second-nearest jittered cell seed at `scale` tiles a cell; ix, iy the nearest cell, sx, sy its seed. */
export function voronoi(wx, wy, scale, s) {
  const gx = wx / scale, gy = wy / scale, cx = Math.floor(gx), cy = Math.floor(gy);
  let d1 = 9, d2 = 9, ix = 0, iy = 0, sx = 0, sy = 0;
  for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
    const lx = cx + ox, ly = cy + oy, px = lx + 0.15 + 0.7 * hash2(lx, ly, s), py = ly + 0.15 + 0.7 * hash2(lx, ly, s + 1);
    const dx = gx - px, dy = gy - py, d = dx * dx + dy * dy;
    if (d < d1) { d2 = d1; d1 = d; ix = lx; iy = ly; sx = px * scale; sy = py * scale; } else if (d < d2) d2 = d;
  }
  return { d1: Math.sqrt(d1) * scale, d2: Math.sqrt(d2) * scale, ix, iy, sx, sy };
}

// planeterrain.js PT_VAL_MEMO / PT_VOR_MEMO (2026-09-28): the same numbers as noise and voronoi, for a painter that sweeps
// sample by sample (the plane raster), where neighbours read the same lattice corners and Voronoi seeds over and over:
// the last of each salt is kept, so a repeat costs loads, not hashes. Scattered callers (the Underdark's bake, the world)
// use the plain ones: there the keeping costs more than it saves (M4, measured 2026-10-18: 12% slower).
const VAL_MEMO = new Float64Array(256 * 7).fill(NaN), VOR_MEMO = new Float64Array(256 * 21).fill(NaN);
/** noise, keeping each salt's last lattice corners. */
export function noiseSwept(wx, wy, s) {
  const x0 = Math.floor(wx), y0 = Math.floor(wy);
  let fx = wx - x0, fy = wy - y0;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
  const m = VAL_MEMO, k = (s & 255) * 7;
  let a, b, c, d;
  if (m[k] === s && m[k + 1] === x0 && m[k + 2] === y0) { a = m[k + 3]; b = m[k + 4]; c = m[k + 5]; d = m[k + 6]; }
  else { a = hash2(x0, y0, s); b = hash2(x0 + 1, y0, s); c = hash2(x0, y0 + 1, s); d = hash2(x0 + 1, y0 + 1, s); m[k] = s; m[k + 1] = x0; m[k + 2] = y0; m[k + 3] = a; m[k + 4] = b; m[k + 5] = c; m[k + 6] = d; }
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}
/** voronoi, keeping each salt's last nine cell seeds. */
export function voronoiSwept(wx, wy, scale, s) {
  const gx = wx / scale, gy = wy / scale, cx = Math.floor(gx), cy = Math.floor(gy);
  let d1 = 9, d2 = 9, ix = 0, iy = 0, sx = 0, sy = 0;
  const m = VOR_MEMO, k = (s & 255) * 21, hit = m[k] === s && m[k + 1] === cx && m[k + 2] === cy;
  if (!hit) { m[k] = s; m[k + 1] = cx; m[k + 2] = cy; }
  let j = k + 3;
  for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++, j += 2) {
    const lx = cx + ox, ly = cy + oy;
    let px, py;
    if (hit) { px = m[j]; py = m[j + 1]; } else { px = lx + 0.15 + 0.7 * hash2(lx, ly, s); py = ly + 0.15 + 0.7 * hash2(lx, ly, s + 1); m[j] = px; m[j + 1] = py; }
    const dx = gx - px, dy = gy - py, d = dx * dx + dy * dy;
    if (d < d1) { d2 = d1; d1 = d; ix = lx; iy = ly; sx = px * scale; sy = py * scale; } else if (d < d2) d2 = d;
  }
  return { d1: Math.sqrt(d1) * scale, d2: Math.sqrt(d2) * scale, ix, iy, sx, sy };
}

/** environment-terrain.js grainHash: a cell hash on Math.imul (not hash2's float multiply; the two differ), 0 to 1. */
export function grainHash(x, y, s) { let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + s) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967295; }
/** environment-terrain.js grainNoise: value noise on grainHash, -0.5 to 0.5. */
export function grainNoise(x, y, s) {
  const ix = Math.floor(x), iy = Math.floor(y); let fx = x - ix, fy = y - iy;
  fx *= fx * (3 - 2 * fx); fy *= fy * (3 - 2 * fy);
  const a = grainHash(ix, iy, s), b = grainHash(ix + 1, iy, s), c = grainHash(ix, iy + 1, s), e = grainHash(ix + 1, iy + 1, s);
  return (a + (b - a) * fx) * (1 - fy) + (c + (e - c) * fx) * fy - 0.5;
}

/** A floor's surface salt for the painters (1.7: the run seed mod 9973, plus 31 a floor). */
export const surfaceSalt = (seed, floorNo) => (((seed ?? 0) >>> 0) % 9973) + floorNo * 31;
