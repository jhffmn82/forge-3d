// The Dungeon's room layout (spec/world.md W14-W19; floors.json layout-bsp). Same seed, same tiles as 1.7
// (js/world/world.js generateOnce, the BSP block, with js/runtime/game.js carveCorridor and doorSpot): every die is
// drawn in 1.7's order, so a floor seed lays out the very rooms, corridors and doors 1.7 lays out.
// Works on one flat Uint8Array; nothing here allocates per tile beyond the flood fills.

import floors from '../../data/floors.json' with { type: 'json' };
import { next, roll, pick } from '../lib/rng.js';
import { T } from '../data/tiles.js';
import { trimDoubled, spaceDoors } from './layout-trim.js';
import { distanceField } from '../lib/grid.js';

const L = floors.rows['layout-bsp'];
const [MW, MH] = floors.rows.schedule.size;

/** W15: split every leaf up to splitRounds times; a leaf narrower than ratio x its height is cut across. */
function leavesOf(rng, area) {
  let leaves = [area];
  for (let round = 0; round < L.splitRounds; round++) {
    const out = [];
    for (const lf of leaves) {
      const across = lf.w < lf.h * L.splitAcrossLongSideRatio, side = across ? lf.h : lf.w;
      if (side <= L.splitOnlyIfSideOver) { out.push(lf); continue; }
      const cut = roll(rng, L.minLeafSide, side - L.minLeafSide);
      out.push(across ? { x: lf.x, y: lf.y, w: lf.w, h: cut } : { x: lf.x, y: lf.y, w: cut, h: lf.h },
        across ? { x: lf.x, y: lf.y + cut, w: lf.w, h: lf.h - cut } : { x: lf.x + cut, y: lf.y, w: lf.w - cut, h: lf.h });
    }
    if (out.length === leaves.length) break;
    leaves = out;
  }
  return leaves;
}

/** W16: one room per leaf. The big-hall die is drawn for every leaf, before its size test (1.7 order). */
function roomIn(rng, lf, id, max = L.roomSide.max) {
  const R = L.roomSide, B = L.bigHall, O = L.roomOffset;
  let w = roll(rng, R.min, Math.max(R.min, lf.w - R.maxInset)), h = roll(rng, R.min, Math.max(R.min, lf.h - R.maxInset));
  if (next(rng) < B.chancePct / 100 && lf.w >= B.minLeaf[0] && lf.h >= B.minLeaf[1]) { w = Math.max(w, lf.w - B.inset); h = Math.max(h, lf.h - B.inset); }
  w = Math.min(w, max); h = Math.min(h, max);   // Justin 2026-10-18: no room past 8 x 8 (floors.json layout-bsp roomSide.max)
  const x = lf.x + roll(rng, O.min, Math.max(O.min, lf.w - w - O.maxInset)), y = lf.y + roll(rng, O.min, Math.max(O.min, lf.h - h - O.maxInset));
  w = Math.min(w, MW - 2 - x); h = Math.min(h, MH - 2 - y);   // a room keeps two tiles off the right and bottom edges
  return { x, y, w, h, cx: x + (w >> 1), cy: y + (h >> 1), id };
}

/** W17: an L from a to b, either leg first; stops at the first open tile after its first step unless forced. */
function corridor(rng, tiles, ax, ay, bx, by, force) {
  const horizFirst = next(rng) < 0.5;
  let x = ax, y = ay, i = 0;
  const step = () => {
    const k = y * MW + x;
    if (tiles[k] !== T.WALL) return force || i++ === 0;
    tiles[k] = T.FLOOR; i++;
    return true;
  };
  if (horizFirst) {
    while (x !== bx) { x += x < bx ? 1 : -1; if (!step()) return; }
    while (y !== by) { y += y < by ? 1 : -1; if (!step()) return; }
  } else {
    while (y !== by) { y += y < by ? 1 : -1; if (!step()) return; }
    while (x !== bx) { x += x < bx ? 1 : -1; if (!step()) return; }
  }
}

/** Walk distances over everything but wall, from one tile (-1: unreached). */
export function flood(tiles, w, h, from, blocked = null) {
  return distanceField(w, h, from, n => tiles[n] !== T.WALL && !blocked?.[n]);
}

/** W18: a room-edge floor tile in a one-wide gap with passage on both sides becomes a door on a draw. */
function doors(rng, tiles, rooms) {
  const at = (x, y) => (x < 0 || y < 0 || x >= MW || y >= MH ? T.WALL : tiles[y * MW + x]);
  const passage = t => t === T.FLOOR || t === T.DOOR || t === T.OPEN_DOOR;
  const spot = (x, y, across) => at(x, y) === T.FLOOR && (across
    ? at(x - 1, y) === T.WALL && at(x + 1, y) === T.WALL && passage(at(x, y - 1)) && passage(at(x, y + 1))
    : at(x, y - 1) === T.WALL && at(x, y + 1) === T.WALL && passage(at(x - 1, y)) && passage(at(x + 1, y)));
  const p = L.doors.chancePct / 100;
  const tryDoor = (x, y, across) => { if (spot(x, y, across) && next(rng) < p) tiles[y * MW + x] = T.DOOR; };
  for (const r of rooms) {
    for (let x = r.x; x < r.x + r.w; x++) { tryDoor(x, r.y - 1, true); tryDoor(x, r.y + r.h, true); }
    for (let y = r.y; y < r.y + r.h; y++) { tryDoor(r.x - 1, y, false); tryDoor(r.x + r.w, y, false); }
  }
}

/**
 * Lays out one BSP floor from the generation stream (1.7 draw for draw).
 * trim, spaceDoors (Justin's D1, D4): doubled corridors trimmed before the doors; no two doors back to back. The dice are
 * the same; only the doors' spots differ where the trim changed a passage. cap: Justin's 8 x 8 room cap (2026-10-18), off
 * for 1.7's own layout (parity, the classic floors).
 * @returns {{w:number, h:number, tiles:Uint8Array, rooms:{x,y,w,h,cx,cy,id}[]}} rooms sorted by centre x, rooms[0] the start.
 */
export function layoutDungeon(rng, { boss = false, biome = 'dungeon', trim = false, spaceDoors: space = false, cap = true } = {}) {
  const tiles = new Uint8Array(MW * MH);   // T.WALL is 0
  const area = boss ? L.bossArea[biome] : L.area;
  const leaves = leavesOf(rng, area);
  // Grukk's room keeps its size (sandbox lead 2026-10-18: an arena is no empty room): the rolls on a copy of the stream
  // find it as generate.js will (the largest room but the leftmost); the sizes draw the same either way. The Crypt's
  // boss fights in its stamped hall (crypt/hall.js), so every BSP room of floor 10 is capped.
  let arena = -1;
  if (cap && boss && biome === 'dungeon') { const probe = { s: rng.s }, raw = leaves.map((lf, i) => roomIn(probe, lf, i, Infinity)).sort((a, b) => a.cx - b.cx); arena = raw.slice(1).sort((a, b) => b.w * b.h - a.w * a.h)[0]?.id ?? -1; }
  const rooms = leaves.map((lf, i) => roomIn(rng, lf, i, !cap || i === arena ? Infinity : L.roomSide.max));
  for (const r of rooms) for (let y = r.y; y < r.y + r.h; y++) tiles.fill(T.FLOOR, y * MW + r.x, y * MW + r.x + Math.max(0, r.w));
  rooms.sort((a, b) => a.cx - b.cx);
  for (let i = 1; i < rooms.length; i++) {
    const t = rooms[i];
    let best = rooms[0], bd = Infinity;
    for (let j = 0; j < i; j++) { const d = Math.abs(rooms[j].cx - t.cx) + Math.abs(rooms[j].cy - t.cy); if (d < bd) { bd = d; best = rooms[j]; } }
    corridor(rng, tiles, t.cx, t.cy, best.cx, best.cy, false);
  }
  for (let i = 0; i < L.corridors.extraLoops; i++) {
    const a = pick(rng, rooms), b = pick(rng, rooms);
    if (a !== b) corridor(rng, tiles, a.cx, a.cy, b.cx, b.cy, false);
  }
  // W17: reachability from the first room is checked again before each forced corridor.
  const home = rooms[0].cy * MW + rooms[0].cx;
  let reach = flood(tiles, MW, MH, home);
  for (let i = 1; i < rooms.length; i++) {
    const r = rooms[i];
    if (reach[r.cy * MW + r.cx] < 0) { corridor(rng, tiles, r.cx, r.cy, rooms[0].cx, rooms[0].cy, true); reach = flood(tiles, MW, MH, home); }
  }
  if (trim) trimDoubled(tiles, MW, MH, rooms);
  doors(rng, tiles, rooms);
  if (space) spaceDoors(tiles, MW, MH, rooms);
  return { w: MW, h: MH, tiles, rooms };
}

/** Walking distances from a tile over everything but wall (shut doors count as passable for layout); -1 unreached. */
export function distances(floor, from) {
  return flood(floor.tiles, floor.w, floor.h, from.y * floor.w + from.x);
}
