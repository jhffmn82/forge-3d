// The Underdark caves' per-pixel bake with nothing of the page in it (no pixi, no sheets, no document), so it runs the
// same on the main thread (underdark-raster.js, where workers cannot start) and in underdark-worker.js (sandbox item
// 73: a chunk is 30-60 ms of work, which no frame can carry). See underdark-raster.js for what 1.7 draws here.

import { T, isWallTile } from '../data/tiles.js';
import { hash2, noise as ptVal, grainHash, grainNoise, surfaceSalt } from '../lib/noise.js';
import { DEEP_ROCK } from '../data/rock.js';
import { GRADE, rockCol, fireFloor } from './underdark-rock.js';

export const STYLE = ['rect', 'smooth', 'jag'];   // deep.js DEEP_STYLE
// Samples a tile: every chunk is baked first at 64 (S_MAIN); the workers then bake the chunks near the camera again at as
// many samples a tile as the screen shows a tile, up to 1.7's 128 (S, environment-terrain.js; audit WT10), so the
// rock's grain, read from the 128-a-tile masters, keeps every pixel on a phone or a high-density screen.
export const S = 128;
export const S_MAIN = 64;
const BAND = 4;         // rows of samples baked between yields (the distance pass yields every column)

export const wrap = (v, n) => ((v % n) + n) % n;
const mirror = (v, n) => { v = wrap(v, n * 2); return v < n ? v : n * 2 - 1 - v; };

// The 5 x 5 field weights of a sample depend only on where it sits in its cell (planeterrain.js ptFieldTables).
const tableCache = new Map();
function fieldTables(S) {
  if (tableCache.has(S)) return tableCache.get(S);
  const WT = new Float64Array(S * S * 25), WSUM = new Float64Array(S * S);
  for (let i = 0; i < S * S; i++) {
    const wx = (i % S + 0.5) / S, wy = (Math.floor(i / S) + 0.5) / S;
    let k = 0, sum = 0;
    for (let oy = -2; oy <= 2; oy++) for (let ox = -2; ox <= 2; ox++, k++) { const dx = wx - (ox + 0.5), dy = wy - (oy + 0.5); let w = Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy) / 1.35); w *= w; WT[i * 25 + k] = w; sum += w; }
    WSUM[i] = sum;
  }
  const t = { WT, WSUM };
  tableCache.set(S, t);
  return t;
}

function cellAt(P, cx, cy) {
  const k = P.k, id = `${P.key}/${wrap(cx, k.columns)}-${wrap(cy, k.rows)}`, f = P.frames[id]?.frame;
  return f ? [f.x, f.y, f.w, f.h] : [wrap(cx, k.columns) * k.cellW, wrap(cy, k.rows) * k.cellH, k.cellW, k.cellH];
}
/** A terrain sheet's pixel ({w, h, d, k, key, frames}) for local sample (lu, lv) of cell (cx, cy), as an [r, g, b]. */
export function texel(P, cx, cy, lu, lv, S = 128) {
  if (!P) return [40, 36, 44];
  const [fx, fy, fw, fh] = cellAt(P, cx, cy), q = ((fy + Math.min(fh - 1, Math.floor((lv + 0.5) * fh / S))) * P.w + fx + Math.min(fw - 1, Math.floor((lu + 0.5) * fw / S))) * 4;
  return [P.d[q], P.d[q + 1], P.d[q + 2]];
}
const texelAt = texel;

/**
 * Which cells the raster draws (deepNeedsRaster, widened as 1.7 draws the rest): 1 near a change of region or the edge
 * of cave rock, 2 inner spider or volcanic rock and open volcanic ground, 3 a built wall with no open ground beside it,
 * 0 left to terrain.js. rmix: within two cells
 * of another region.
 * @returns {{need: Uint8Array, rmix: Uint8Array}}
 */
export function rasterCells(floor) {
  const W = floor.w, H = floor.h, R = floor.region, wallT = isWallTile;
  const wall = i => wallT(floor.tiles[i]);
  const wallCell = (x, y) => x < 0 || y < 0 || x >= W || y >= H || wall(y * W + x);
  const rmix = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const own = R[y * W + x];
    let m = 0;
    for (let oy = -2; oy <= 2 && !m; oy++) for (let ox = -2; ox <= 2; ox++) { const nx = x + ox, ny = y + oy; if (nx >= 0 && ny >= 0 && nx < W && ny < H && R[ny * W + nx] !== own) { m = 1; break; } }
    rmix[y * W + x] = m;
  }
  const need = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (rmix[i]) { need[i] = 1; continue; }
    if (STYLE[R[i]] === 'rect') {
      // a built wall no open ground touches: 1.7 still draws its top there, darkened (environment-terrain.js deepTop)
      let shut = wall(i);
      for (let oy = -1; oy <= 1 && shut; oy++) for (let ox = -1; ox <= 1; ox++) if (!wallCell(x + ox, y + oy)) { shut = false; break; }
      need[i] = shut ? 3 : 0;
      continue;
    }
    let walls = 0;
    for (let oy = -2; oy <= 2; oy++) for (let ox = -2; ox <= 2; ox++) if (wallCell(x + ox, y + oy)) walls++;
    need[i] = walls !== 0 && walls !== 25 ? 1 : wall(i) || R[i] === 2 ? 2 : 0;
  }
  return { need, rmix };
}

/** What of a floor the bake reads, small enough to post to a worker (no props, no actors). */
export function bakeFloor(floor) {
  return { w: floor.w, h: floor.h, tiles: floor.tiles, region: floor.region, rooms: (floor.rooms ?? []).map(r => ({ x: r.x, y: r.y, w: r.w, h: r.h, cells: r.cells ?? null })) };
}

/**
 * The caves' outline, as 1.7 works it out per pixel (deeprender.js deepPixReg, deepSolid): rockAt(wx, wy) says
 * whether world point (wx, wy), in tiles, is rock. Pure: no drawing, so tests can read it. S: the samples a tile the
 * field's chunks are baked at.
 */
export function caveField(floor, run = {}, S = 128) {
  const W = floor.w, H = floor.h, R = floor.region, { WT, WSUM } = fieldTables(S);
  const wallT = isWallTile;
  const wall = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) wall[i] = wallT(floor.tiles[i]) ? 1 : 0;
  const wallCell = (x, y) => x < 0 || y < 0 || x >= W || y >= H || wall[y * W + x] === 1;
  const surf = surfaceSalt(run.seed, run.floorNo ?? 16), ptSalt = surf + 911, salt = ptSalt + 1301;
  const regAt = (x, y) => R[Math.max(0, Math.min(H - 1, y)) * W + Math.max(0, Math.min(W - 1, x))];
  // deepCache: cells within two of another region mix; a room's floor and the walls round it keep the room's region.
  const { rmix, need } = rasterCells(floor), lock = new Uint8Array(W * H);
  for (const r of floor.rooms ?? []) {
    const cells = r.cells ? r.cells.map(k => [k % W, (k / W) | 0]) : [];
    if (!r.cells) for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) cells.push([x, y]);
    for (const [cx, cy] of cells) for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      const nx = cx + ox, ny = cy + oy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      if ((!ox && !oy) || wall[ny * W + nx]) lock[ny * W + nx] = 1;
    }
  }
  const covers = (x, y) => x >= 0 && y >= 0 && x < W && y < H && need[y * W + x] !== 0;

  // deepPixReg: a pixel's region, from a noise-warped neighbour where regions mix.
  function pixReg(wx, wy) {
    const cx = Math.floor(wx), cy = Math.floor(wy);
    if (cx < 0 || cy < 0 || cx >= W || cy >= H) return regAt(cx, cy);
    const i = cy * W + cx; if (lock[i] || !rmix[i]) return R[i];
    const jx = (ptVal(wx * 0.75, wy * 0.75, salt + 1) - 0.5) * 2.6 + (ptVal(wx * 2.6, wy * 2.6, salt + 2) - 0.5) * 0.9 + (hash2(Math.floor(wx * 16), Math.floor(wy * 16), salt + 5) - 0.5) * 0.35;
    const jy = (ptVal(wx * 0.75 + 9, wy * 0.75, salt + 3) - 0.5) * 2.6 + (ptVal(wx * 2.6 + 4, wy * 2.6, salt + 4) - 0.5) * 0.9 + (hash2(Math.floor(wx * 16), Math.floor(wy * 16), salt + 6) - 0.5) * 0.35;
    const sx = Math.floor(wx + jx), sy = Math.floor(wy + jy);
    return sx >= 0 && sy >= 0 && sx < W && sy < H ? R[sy * W + sx] : R[i];
  }
  // deepSolid: rock or open at a point, by its region's style.
  function solid(wx, wy, style) {
    const cx = Math.floor(wx), cy = Math.floor(wy), own = wallCell(cx, cy);
    if (style === 'rect') return own;
    let same = true;
    for (let oy = -1; oy <= 1 && same; oy++) for (let ox = -1; ox <= 1; ox++) if (wallCell(cx + ox, cy + oy) !== own) { same = false; break; }
    if (same) return own;
    let sum = 0, wsum = 0;
    const sub = Math.min(S - 1, Math.floor((wy - cy) * S)) * S + Math.min(S - 1, Math.floor((wx - cx) * S));
    if (Math.abs((wx - cx) * S - Math.floor((wx - cx) * S) - 0.5) < 1e-6 && Math.abs((wy - cy) * S - Math.floor((wy - cy) * S) - 0.5) < 1e-6) {
      wsum = WSUM[sub];
      for (let oy = -2, k = sub * 25; oy <= 2; oy++) for (let ox = -2; ox <= 2; ox++, k++) if (WT[k] && wallCell(cx + ox, cy + oy)) sum += WT[k];
    } else for (let oy = -2; oy <= 2; oy++) for (let ox = -2; ox <= 2; ox++) {
      const nx = cx + ox, ny = cy + oy, dx = wx - (nx + 0.5), dy = wy - (ny + 0.5);
      let w = Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy) / 1.35);
      if (!w) continue; w *= w; wsum += w; if (wallCell(nx, ny)) sum += w;
    }
    const f = wsum ? sum / wsum : (own ? 1 : 0);
    let thr;
    if (style === 'smooth') thr = 0.5 + (ptVal(wx * 0.7, wy * 0.7, salt + 3) - 0.5) * 0.3;
    else {
      const r1 = 1 - Math.abs(ptVal(wx * 3.6, wy * 3.6, salt + 41) * 2 - 1), r2 = 1 - Math.abs(ptVal(wx * 8.2, wy * 8.2, salt + 43) * 2 - 1);
      thr = 0.5 + (ptVal(wx * 0.85, wy * 0.85, salt + 3) - 0.5) * 0.3 + (r1 - 0.5) * 0.5 + (r2 - 0.5) * 0.22;
    }
    if (f > 0.8) return true; if (f < 0.2) return false;
    const sld = f > thr, rc = Math.sqrt((wx - cx - 0.5) ** 2 + (wy - cy - 0.5) ** 2);
    if (!own && sld && rc < 0.3) return false;
    if (own && !sld && rc < 0.24) return true;
    return sld;
  }
  return { S, W, H, R, wall, wallCell, surf, ptSalt, salt, regAt, rmix, need, lock, covers, pixReg, solid, rockAt: (wx, wy) => solid(wx, wy, STYLE[pixReg(wx, wy)]) };
}

/**
 * One chunk of cells, baked: {PW, PH, ground, rock} (RGBA pixels, ground under the liquids and rock over them) with
 * only its raster cells drawn, or null when none needs it. A generator that yields between bands of work, so the main
 * thread can spread one chunk over several frames (a worker just runs it out); its return is the result.
 * @param {ReturnType<typeof caveField>} F
 * @param {{rockP: object|null, detailP: object|null, mat: {floor: object|null, face: object|null, top: object|null}[]}} px
 *   the sheets' pixels ({w, h, d, k, key, frames}), the temple floor's grout already turned to embers
 */
export function* bakeChunk(F, px, cx0, cy0, cw, ch) {
  const { S, W, H, R, ptSalt, salt, need, covers, pixReg, solid } = F, { rockP, detailP, mat } = px;
  const texel = (P, cx, cy, lu, lv) => texelAt(P, cx, cy, lu, lv, S);
  const red = (P, X, Y, wrapF) => (P ? P.d[(wrapF(Y, P.h) * P.w + wrapF(X, P.w)) * 4] : 128);
  const PW = cw * S, PH = ch * S, MX = 3, KW = PW + MX * 2, KH = PH + S + MX * 2;
  const kc = new Uint8Array(KW * KH).fill(255), rc = new Uint8Array(KW * KH).fill(255);
  const gu0 = cx0 * S, gv0 = cy0 * S;
  const at = (u, v) => (u + MX) + (v + MX) * KW;
  const inK = (u, v) => u >= -MX && v >= -MX && u < PW + MX && v < PH + S + MX;
  const regOf = (u, v) => {
    if (!inK(u, v)) return pixReg((gu0 + u + 0.5) / S, (gv0 + v + 0.5) / S);
    const q = at(u, v); let r = rc[q]; if (r === 255) r = rc[q] = pixReg((gu0 + u + 0.5) / S, (gv0 + v + 0.5) / S); return r;
  };
  const K = (u, v) => {
    if (!inK(u, v)) return solid((gu0 + u + 0.5) / S, (gv0 + v + 0.5) / S, STYLE[regOf(u, v)]) ? 1 : 0;
    const q = at(u, v); let k = kc[q]; if (k === 255) k = kc[q] = solid((gu0 + u + 0.5) / S, (gv0 + v + 0.5) / S, STYLE[regOf(u, v)]) ? 1 : 0; return k;
  };
  let any = false;
  for (let y = cy0; y < cy0 + ch && !any; y++) for (let x = cx0; x < cx0 + cw; x++) if (covers(x, y)) { any = true; break; }
  if (!any) return null;
  // Columns of raster cells: distance down to open ground (deepCellRaster dn), up to a tile.
  const dn = new Uint8Array(PW * PH);
  for (let u = 0; u < PW; u++) {
    const cellX = cx0 + Math.floor(u / S);
    let live = false;
    for (let y = cy0; y < cy0 + ch; y++) if (covers(cellX, y)) { live = true; break; }
    if (!live) continue;
    let dist = -1;
    for (let v = PH + S - 1; v >= 0; v--) {
      if (!K(u, v)) dist = 0; else if (dist >= 0) dist++;
      if (v < PH) dn[v * PW + u] = K(u, v) && dist > 0 && dist <= S ? dist : 0;
    }
    yield;   // a column computes rock for PH + S samples, the costly part (walkperf, sandbox item 73)
  }
  const DG = new Uint8ClampedArray(PW * PH * 4), DR = new Uint8ClampedArray(PW * PH * 4);
  const shadeReach = Math.round(S * 10 / 32);
  const innerAt = (tx, ty) => (tx >= 0 && ty >= 0 && tx < W && ty < H && need[ty * W + tx] === 2 && STYLE[R[ty * W + tx]] !== 'rect' ? 1 : 0);
  const ease = t => t * t * (3 - 2 * t);
  /** How inner this sample is: the four nearest tiles' inner-ness, eased between their centres. */
  const innerWeight = (x, y, lu, lv) => {
    const ax = (lu + 0.5) / S - 0.5, ay = (lv + 0.5) / S - 0.5, ix = Math.floor(ax), iy = Math.floor(ay), tx = ease(ax - ix), ty = ease(ay - iy);
    const a = innerAt(x + ix, y + iy), b = innerAt(x + ix + 1, y + iy), c0 = innerAt(x + ix, y + iy + 1), d0 = innerAt(x + ix + 1, y + iy + 1);
    return (a + (b - a) * tx) * (1 - ty) + (c0 + (d0 - c0) * tx) * ty;
  };
  for (let v = 0; v < PH; v++) for (let u = 0; u < PW; u++) {
    if (u === 0 && v && v % BAND === 0) yield;
    const x = cx0 + Math.floor(u / S), y = cy0 + Math.floor(v / S);
    if (!covers(x, y)) continue;
    const lu = u - (x - cx0) * S, lv = v - (y - cy0) * S, wx = (gu0 + u + 0.5) / S, wy = (gv0 + v + 0.5) / S;
    const kk = K(u, v), rgn = regOf(u, v), style = STYLE[rgn], M = mat[rgn], p = (v * PW + u) * 4, D = kk ? DR : DG;
    let col, sh = 1, grain = 0;
    if (!kk) {
      // floor, darkened a little under a wall face above and beside rock
      for (let up = 1; up <= shadeReach; up++) if (K(u, v - up)) { sh = Math.min(sh, 0.5 + 0.5 * (up - 1) / shadeReach); break; }
      if (K(u - 1, v) || K(u + 1, v)) sh *= 0.86;
      if (rgn === 2) {
        col = fireFloor(wx, wy, ptSalt);
        const X = Math.floor(wx * 128), Y = Math.floor(wy * 128);
        grain = (red(detailP, X, Y, wrap) - 128) * 0.015 + grainNoise(wx * 12, wy * 12, 37) * 8 + grainNoise(wx * 38, wy * 38, 91) * 4 + (grainHash(X, Y, 173) - 0.5) * 2
          + (red(rockP, X, Y, mirror) - 128) * 0.42 + grainNoise(wx * 5, wy * 5, 227) * 14;
      } else col = texel(M.floor, x, y, lu, lv);
    } else {
      const d = dn[v * PW + u];
      if (need[y * W + x] === 3) { col = texel(M.top, x, y, lu, lv); sh = 0.72; }   // environment-terrain.js deepTop: the region's top, deepDim
      else if (style === 'rect') {
        if (d > 0) col = texel(M.face, x, 0, lu, S - Math.min(S, d));
        else {
          col = texel(M.top, x, y, lu, lv);
          if (!K(u - 1, v) || !K(u + 1, v) || !K(u, v - 1)) sh = 0.4;
          else if (!K(u - 2, v) || !K(u + 2, v) || !K(u, v - 2)) sh *= 0.85;
        }
      } else {
        // natural rock: the master's tone in the region's grade; lava seams and web strands keep their own colour
        const face = d > 0, depth = face ? (S - Math.min(S, d)) / S : 0;
        // the rock's own colour only matters where it is lava (the spider rock never reaches the kernel's 160)
        const src = rgn === 2 ? rockCol(rgn, wx, wy, salt, face, d / S, face && (v > 0 ? dn[(v - 1) * PW + u] === 0 && K(u, v - 1) === 1 : d >= S * 62 / 64)) : null;
        const tone = Math.max(0, Math.min(1, 0.55 + (red(rockP, Math.floor(wx * 128), Math.floor(wy * 128), mirror) / 255 - 0.5) * 2.2));
        const energy = src && src[0] > 130 && src[0] > src[1] * 1.45 ? 0.8 : 0;
        const P = GRADE[rgn], lip = face ? Math.max(0, 1 - depth / 0.04) * 0.08 : 0, L = DEEP_ROCK[rgn].lip;
        col = [0, 0, 0];
        for (let k = 0; k < 3; k++) {
          let o = face ? P.faceLow[k] + P.faceSpan[k] * tone * (1 - depth * 0.25) : P.topLow[k] + P.topSpan[k] * tone;
          o = o * (1 - lip) + L[k] * lip;
          col[k] = energy ? o * (1 - energy) + src[k] * energy : o;
        }
      }
    }
    // Inner rock sits darker (DEEP_TOP_DIM 0.72). Sandbox U15 (Justin, 2026-10-16): blended across tile borders, so the
    // rock beside a cave reads as one mass instead of 1.7's square light and dark steps.
    if (kk && style !== 'rect') sh *= 1 - 0.28 * innerWeight(x, y, lu, lv);
    D[p] = col[0] * sh + grain; D[p + 1] = col[1] * sh + grain; D[p + 2] = col[2] * sh + grain; D[p + 3] = 255;
  }
  return { PW, PH, ground: DG, rock: DR };
}
