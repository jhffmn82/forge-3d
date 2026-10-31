// Two layout passes past 1.7 (Justin's D1 and D4, sandbox thread 2026-10-16), run by layoutDungeon when asked for the
// better floor: doubled corridors trimmed to one lane, and no two doors back to back. No dice: the same layout always
// trims the same way. Kept apart from improve.js so the layout needs nothing but the tiles.

import { T } from '../data/tiles.js';
import { D4 } from '../lib/geometry.js';
import { nearest } from '../lib/grid.js';

const RING = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]];   // the 8 around a cell, in turn
const roomMask = (w, h, rooms) => { const m = new Uint8Array(w * h); for (const r of rooms) for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) m[y * w + x] = 1; return m; };

/**
 * Whether walling cell k keeps the map's shape: its open neighbours stay joined round it (no cut) and the walls round
 * it are one run (no new pillar, no closed loop). Off the map counts as wall.
 */
function simple(tiles, w, h, k) {
  const x = k % w, y = (k / w) | 0;
  const open = RING.map(([dx, dy]) => { const nx = x + dx, ny = y + dy; return nx >= 0 && ny >= 0 && nx < w && ny < h && tiles[ny * w + nx] !== T.WALL; });
  if (!open.some(Boolean) || open.every(Boolean)) return false;
  // Wall runs round the ring, 8-connected: a corner wall joins its two sides.
  let runs = 0;
  for (let i = 0; i < 8; i++) if (!open[i] && open[(i + 7) % 8]) runs++;
  if (runs !== 1) return false;
  // The open orthogonal neighbours joined through open ring cells, stepping 4-wise (corner cells bridge two sides).
  const orth = [0, 2, 4, 6].filter(i => open[i]);
  const seen = new Set([orth[0]]), q = [orth[0]];
  while (q.length) {
    const i = q.pop();
    for (const j of [(i + 1) % 8, (i + 7) % 8]) {
      if (!open[j] || seen.has(j)) continue;
      // Two ring cells touch 4-wise only when one is a side and the other a corner beside it.
      seen.add(j); q.push(j);
    }
  }
  return orth.every(i => seen.has(i));
}

/**
 * D1: 1.7's L corridors often run side by side into two-wide strips. Where four corridor tiles make a 2 x 2 block, one
 * lane is walled tile by tile, never cutting a way or closing a loop; the stubs this leaves (a lane's one-tile ends that
 * now lead nowhere) go too. Corridors only: room tiles are never touched.
 */
export function trimDoubled(tiles, w, h, rooms, keep = null) {   // keep: tiles never walled (something stands there)
  const inRoom = roomMask(w, h, rooms);
  const corr = k => tiles[k] !== T.WALL && !inRoom[k];
  const block = (x, y) => x >= 0 && y >= 0 && x < w - 1 && y < h - 1 && corr(y * w + x) && corr(y * w + x + 1) && corr((y + 1) * w + x) && corr((y + 1) * w + x + 1);
  const trimmed = new Uint8Array(w * h);
  const hugs = k => D4.some(([dx, dy]) => inRoom[k + dy * w + dx]);
  let n = 0;
  // The lane against a room goes first, so a corridor does not run along a room's wall as one long mouth.
  for (const pass of [true, false]) for (let changed = true; changed;) {
    changed = false;
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const k = y * w + x;
      if (!corr(k) || tiles[k] !== T.FLOOR || keep?.has(k) || (pass && !hugs(k)) || !(block(x - 1, y - 1) || block(x, y - 1) || block(x - 1, y) || block(x, y))) continue;
      if (!simple(tiles, w, h, k)) continue;
      tiles[k] = T.WALL; trimmed[k] = 1; n++; changed = true;
    }
  }
  // Stubs: a corridor tile beside a trimmed one with one open neighbour or none was half of the strip, not a dead end.
  for (let changed = true; changed;) {
    changed = false;
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const k = y * w + x;
      if (!corr(k) || tiles[k] !== T.FLOOR || keep?.has(k) || !D4.some(([dx, dy]) => trimmed[k + dy * w + dx])) continue;
      if (D4.filter(([dx, dy]) => tiles[k + dy * w + dx] !== T.WALL).length > 1) continue;
      tiles[k] = T.WALL; trimmed[k] = 1; n++; changed = true;
    }
  }
  return n;
}

/**
 * D4: no doors back to back. A door with an earlier door within 3 steps along the passage (room tiles not counted)
 * opens up into plain floor, so a short passage between two rooms keeps one door.
 */
export function spaceDoors(tiles, w, h, rooms) {
  const inRoom = roomMask(w, h, rooms), kept = new Set();
  let n = 0;
  for (let k = 0; k < tiles.length; k++) {
    if (tiles[k] !== T.DOOR) continue;
    const near = nearest(w, h, k, nk => tiles[nk] !== T.WALL && !inRoom[nk], nk => kept.has(nk), { maxDepth: 3 }) >= 0;
    if (near) { tiles[k] = T.FLOOR; n++; } else kept.add(k);
  }
  return n;
}
