// The planes' and the Chaos islands' ground and rock per sample point (M10, render-28: moved out of realm-raster.js,
// which bakes them): the minerals that survive the rock master, the open floor's colour and ribbons, the rock's outline
// (kinder) and, for the accent light, the pools and the moss. Pure: it runs on the page and in the 'realm' worker lane.

import { hash2, noiseSwept as ptVal, voronoiSwept as ptVor } from '../lib/noise.js';
import { mixRgb as mix } from '../lib/colour.js';
import { ROCK } from '../data/rock.js';
import { chasmDepth, chasmColour } from './ground-marks.js';

// environment-terrain.js planeMinerals: how much of a rock pixel's own colour survives the painted rock master on an
// elemental plane. Its chroma is projected toward the plane's vein colour, less the strongest projection any of the
// plane's rock colours reaches (so Shadow's violet stone is not taken for a vein); bright hot cores survive too, except
// on Light and Air, whose stone is already near white (there the gold tint alone marks a mineral). Per palette, once.
const ELEMENTAL = ['light', 'shadow', 'earth', 'fire', 'water', 'air'];
const MINERALS = new Map();
function mineralsOf(M) {
  if (MINERALS.has(M)) return MINERALS.get(M);
  let m = null;
  if (ELEMENTAL.some(k => ROCK[k] === M)) {
    const mean = (M.vein[0] + M.vein[1] + M.vein[2]) / 3, axis = M.vein.map(c => c - mean), proj = c => c[0] * axis[0] + c[1] * axis[1] + c[2] * axis[2];
    const rocks = ['topLo', 'topHi', 'topLav', 'face', 'faceLo', 'lip', 'edge'].map(k => M[k]);
    const edge = Math.max(...rocks.map(proj)), peak = Math.max(...rocks.map(c => Math.max(...c))), hotRange = Math.max(...M.veinHot) - peak;
    let span = Math.max(1, proj(M.vein) - edge);
    if (hotRange < 12) span = Math.max(1, Math.min(span, proj(M.veinHot) - edge));
    m = { axis, edge, span, peak, hotRange };
  }
  MINERALS.set(M, m);
  return m;
}
/**
 * The share of a rock pixel's colour `c` kept over the rock master's tone (enhanceKernel ENERGY): planeMinerals on an
 * elemental plane; elsewhere (the Rot and Violet islands) 1.7's green test.
 * @param {any} M a rock palette (data/rock.js) @param {number[]} c [r, g, b]
 */
export function mineralEnergy(M, c) {
  const m = mineralsOf(M);
  if (!m) return c[1] > 110 && c[1] > c[0] * 1.35 ? 0.72 : 0;
  const r = Math.max(0, Math.min(255, Math.round(c[0]))), g = Math.max(0, Math.min(255, Math.round(c[1]))), b = Math.max(0, Math.min(255, Math.round(c[2])));
  const colour = (r * m.axis[0] + g * m.axis[1] + b * m.axis[2] - m.edge) / m.span, hot = m.hotRange >= 12 ? (Math.max(r, g, b) - m.peak) / m.hotRange : 0;
  return Math.max(0, Math.min(1, Math.max(colour, hot)));
}
export const rgbOf = hex => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };

export function streak(col, wx, wy, M, salt) {
  const ribbon = wx * 0.57 + wy * 0.34 + (ptVal(wx * 0.31, wy * 0.31, salt + 40) - 0.5) * 3.1 + (ptVal(wx * 1.2, wy * 0.8, salt + 41) - 0.5) * 0.48;
  const distance = Math.abs(Math.sin(ribbon * 2.8)), width = 0.025 + 0.16 * ptVal(wx * 0.7, wy * 0.9, salt + 42), deposit = ptVal(wx * 0.45, wy * 0.64, salt + 43);
  if (deposit > 0.5 && distance < width) col = mix(col, distance < width * 0.17 ? M.veinHot : M.vein, Math.min(1, (deposit - 0.5) * 5) * Math.pow(1 - distance / width, 0.7) * 0.7);
  return col;
}
export function floorColor(wx, wy, M, salt, R, center) {
  const tone = ptVal(wx * 1.8, wy * 1.8, salt + 32);
  let col = mix(M.floor, M.floorLav, 0.3 * ptVal(wx * 0.16, wy * 0.16, salt + 33) + 0.12 * tone);
  const lum = 1 + (tone - 0.5) * 0.035 + (hash2(Math.floor(wx * R), Math.floor(wy * R), salt + 34) - 0.5) * M.grain * 2;
  col = [col[0] * lum, col[1] * lum, col[2] * lum];
  const cool = ptVal(wx * 0.11, wy * 0.11, salt + 36), ringNear = center ? Math.max(0, 1 - Math.abs(Math.hypot(wx - (center.x + 1), wy - (center.y + 1.5)) - 4.2) / 2.6) : 0;
  const coolT = Math.max((cool - 0.52) * 2.4, ringNear * (ptVal(wx * 0.3, wy * 0.3, salt + 46) - 0.35) * 1.2);
  if (coolT > 0) col = mix(col, M.mineralCool, Math.min(0.45, coolT));
  const pearl = ptVal(wx * 0.19 + 7, wy * 0.19, salt + 37); if (pearl > 0.66) col = mix(col, M.pearl, Math.min(0.5, (pearl - 0.66) * 3));
  const bandR = ptVal(wx * 0.07, wy * 0.07, salt + 38);
  if (bandR > 0.64) { const bs = Math.sin((wx * 0.8 + wy * 0.45) * 4.2 + ptVal(wx * 0.5, wy * 0.5, salt + 39) * 2.5); if (bs > 0.82) col = mix(col, M.band, Math.min(0.55, (bandR - 0.64) * 4)); }
  return streak(col, wx, wy, M, salt);
}

/** planeterrain.js ptSolid / ptKind, on the sample's own cell's material: (wx, wy) -> 0 open, 1 rock band, 2 the dark beyond. */
export function kinder(F) {
  const salt = F.salt;
  function solid(wx, wy) {
    const cx = Math.floor(wx), cy = Math.floor(wy), own = F.wall(cx, cy);
    let same = true;
    for (let oy = -1; oy <= 1 && same; oy++) for (let ox = -1; ox <= 1; ox++) if (F.wall(cx + ox, cy + oy) !== own) { same = false; break; }
    if (same) return own;
    let sum = 0, wsum = 0;
    for (let oy = -2; oy <= 2; oy++) for (let ox = -2; ox <= 2; ox++) {
      const nx = cx + ox, ny = cy + oy, dx = wx - (nx + 0.5), dy = wy - (ny + 0.5);
      let w = Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy) / 1.35);
      if (!w) continue; w *= w; wsum += w; if (F.wall(nx, ny)) sum += w;
    }
    const M = F.matAt(cx, cy) ?? F.matAt(Math.min(F.W - 1, Math.max(0, cx)), Math.min(F.H - 1, Math.max(0, cy)));
    const J = M?.jag ?? 0;
    const jag = J ? (1 - Math.abs(ptVal(wx * 3.6, wy * 3.6, salt + 41) * 2 - 1) - 0.5) * J * 0.55 + (1 - Math.abs(ptVal(wx * 8.2, wy * 8.2, salt + 43) * 2 - 1) - 0.5) * J * 0.3 : 0;
    const f = wsum ? sum / wsum : (own ? 1 : 0);
    const sld = f > 0.5 + (ptVal(wx * 0.85, wy * 0.85, salt + 3) - 0.5) * 0.34 + (ptVal(wx * 2.3, wy * 2.3, salt + 4) - 0.5) * 0.1 + jag;
    const rc = Math.sqrt((wx - cx - 0.5) ** 2 + (wy - cy - 0.5) ** 2);
    if (!own && sld && rc < 0.3) return false;
    if (own && !sld && rc < 0.26) return true;
    return sld;
  }
  function kind(wx, wy) {
    if (!solid(wx, wy)) return 0;
    const cx = Math.floor(wx), cy = Math.floor(wy);
    let best = 9;
    for (let oy = -2; oy <= 2; oy++) for (let ox = -2; ox <= 2; ox++) {
      const nx = cx + ox, ny = cy + oy; if (F.dist(nx, ny) !== 0) continue;
      const dx = Math.max(nx - wx, 0, wx - (nx + 1)), dy = Math.max(ny - wy, 0, wy - (ny + 1)), dd = Math.sqrt(dx * dx + dy * dy);
      if (dd < best) best = dd;
    }
    return best < 1.45 + (ptVal(wx * 0.6, wy * 0.6, salt + 5) - 0.5) * 0.4 ? 1 : 2;
  }
  return kind;
}

export function poolAt(F, wx, wy) {
  if (!F.pool) return 0;
  const cx = Math.floor(wx), cy = Math.floor(wy); let f = 0;
  for (let oy = -2; oy <= 2; oy++) for (let ox = -2; ox <= 2; ox++) {
    const nx = cx + ox, ny = cy + oy; if (nx < 0 || ny < 0 || nx >= F.W || ny >= F.H) continue;
    const pw = F.pool[ny * F.W + nx]; if (!pw) continue;
    const dx = wx - (nx + 0.5), dy = (wy - (ny + 0.5)) * 1.1, d = Math.sqrt(dx * dx + dy * dy) / 1.5;
    if (d < 1) f += (1 - d) * (1 - d) * pw;
  }
  return f ? f + (ptVal(wx * 1.6, wy * 1.6, 977) - 0.5) * 0.22 : 0;
}

/** The raster's moss over a ground colour (rasterChunk's moss pass), for the accent: Rot's moss is its green glow. */
export function mossy(F, wx, wy, M, col) {
  if (!M.moss || !F.mossAt) return col;
  const cx = Math.floor(wx), cy = Math.floor(wy), salt = F.salt; let f = 0, tot = 0;
  for (let oy = -2; oy <= 2; oy++) for (let ox = -2; ox <= 2; ox++) {
    const nx = cx + ox, ny = cy + oy; if (nx < 0 || ny < 0 || nx >= F.W || ny >= F.H) continue;
    const dx = wx - (nx + 0.5), dy = wy - (ny + 0.5), d = Math.sqrt(dx * dx + dy * dy) / 1.9; if (d >= 1) continue;
    const w = (1 - d) * (1 - d); tot += w; if (F.mossAt(nx, ny)) f += w;
  }
  const mf = tot ? f / tot : 0;
  if (mf <= 0.08 || poolAt(F, wx, wy) >= 0.18) return col;
  const mv = ptVor(wx + 0.3 * ptVal(wx * 1.4, wy * 1.4, salt + 67), wy, 1.5, salt + 61), along = Math.max(0, 1 - (mv.d2 - mv.d1) / 0.16);
  const drift = ptVal(wx * 1.1, wy * 1.1, salt + 64) * 0.6 + ptVal(wx * 2.8, wy * 2.8, salt + 65) * 0.4;
  const damp = mf * (M.organicRock ? Math.max(along * 0.6, Math.max(0, (drift - 0.2) * 2)) : along) * (0.55 + drift * 0.7);
  if (damp > 0.1) {
    col = mix(col, M.moss[2], Math.min(0.6, damp * 0.75));
    if (damp > 0.26) col = mix(col, M.moss[0], Math.min(M.organicRock ? 0.88 : 0.7, (damp - 0.26) * (M.organicRock ? 2.4 : 1.5)));
  }
  return col;
}

/**
 * Item 185 (Justin 2026-10-19: the islands' chasms "a way to make the edges look not square"): a cell within two of where
 * the land meets the void, for the Caverns' chasm edge (ground-marks.js chasmDepth): {near: the 5 x 5 cells round it, 1
 * where void; own: it is void; M: its material, or for a void cell its nearest land's}. Null with only land or only void
 * round it. Kept on F.
 */
export function chasmCell(F, x, y) {
  const memo = F.chasmMemo ??= new Map(), key = y * F.W + x;
  if (memo.has(key)) return memo.get(key);
  const near = new Uint8Array(25);
  let land = null, d = 9;
  for (let oy = -2; oy <= 2; oy++) for (let ox = -2; ox <= 2; ox++) {
    const M = F.matAt(x + ox, y + oy), dd = Math.abs(ox) + Math.abs(oy);
    if (!M) near[(oy + 2) * 5 + ox + 2] = 1; else if (dd < d) { land = M; d = dd; }
  }
  const out = land && near.includes(1) ? { near, own: near[12] === 1, M: land } : null;
  memo.set(key, out);
  return out;
}

/**
 * An island's drop at (wx, wy) of a cell by the void (chasmCell E): the Caverns' cliff falling into the dark past the
 * chasm's edge, in the rock's shadowed face colour so it starts no lighter than the land, as [r, g, b, a]; null on the
 * land, which keeps no lip or shadow (item 205, Justin 2026-10-19: "still getting out surface lip in chaos"). The
 * Caverns' own chasms keep theirs (ground-marks.js chasmRaster).
 */
export function islandDrop(E, x, y, wx, wy, salt) {
  const e = chasmDepth(E.near, E.own, x, y, wx, wy, salt);
  return e > 0 ? chasmColour(e, E.M.faceLo, wx, wy, salt) : null;
}
