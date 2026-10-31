// Room dressing on an ordinary Dungeon floor, as 1.7 does it (spec/world.md W36, W60; props.json
// placement-dungeon-plain-room): the edge and interior cells a piece may take, the plain-room dressing, and the prop
// stages 1.7 runs on every prop it places (js/engine/content-adapter.js:22-114 @3c8b312): in the Dungeon mushrooms
// become a grass or moss patch instead of a prop, crates, barrels and pots become one stack group, chains hang on a
// wall. Draws only from the generation stream.

import props from '../../data/props.json' with { type: 'json' };
import { next, roll, pick, shuffled } from '../lib/rng.js';
import { T, G, isDoor, wallLike } from '../data/tiles.js';
import { blob, distanceField } from '../lib/grid.js';
import { propBlocks } from '../data/props.js';

const P = props.rows;


/** Which room each tile belongs to (index into rooms, -1 for none). Pockets count as rooms. */
export function roomGrid(floor, rooms) {
  const g = new Int16Array(floor.w * floor.h).fill(-1);
  rooms.forEach((r, k) => { for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) g[y * floor.w + x] = k; });
  return g;
}

const tileAt = (floor, x, y) => (x < 0 || y < 0 || x >= floor.w || y >= floor.h ? T.WALL : floor.tiles[y * floor.w + x]);
export const propAt = (floor, x, y) => floor.props.find(p => p.x === x && p.y === y) ?? null;

/** Answer 28: a piece a biome's furniture map leaves as it is: a kept piece, a puzzle's tablet or lever, a prisoner,
 *  a piece already the biome's own (deep), part of a wide piece, a portcullis lever. */
/** A big set piece small plants and pieces keep a tile clear of (1.7 cryptpack.js packPlaneClear; the Crypt's BIG). */
export const BIG_PIECE = /^(sarc|tomb-|dais-sarcophagus|grave-monument|stairs-wide|rune-stone-|sun-dais|pt-outcrop)/;

export const remapExempt = p => !!(p.keep || p.tablet || p.lever || p.prisoner || p.deep || p.part || p.portcullis);

/** 1.7 nearDoor: any kind of door in the 3 x 3, or (for a room cell) a corridor mouth beside it. */
const DOOR_CODE = new Uint8Array(32);
for (let t = 0; t < DOOR_CODE.length; t++) DOOR_CODE[t] = isDoor(t) ? 1 : 0;
export function nearDoor(floor, grid, x, y) {
  const W = floor.w, H = floor.h, t = floor.tiles;
  for (let yy = Math.max(0, y - 1); yy <= Math.min(H - 1, y + 1); yy++) for (let xx = Math.max(0, x - 1); xx <= Math.min(W - 1, x + 1); xx++) if (DOOR_CODE[t[yy * W + xx]]) return true;
  const k = y * W + x;
  if (grid[k] < 0) return false;
  return (x + 1 < W && t[k + 1] === T.FLOOR && grid[k + 1] < 0) || (x > 0 && t[k - 1] === T.FLOOR && grid[k - 1] < 0) ||
    (y + 1 < H && t[k + W] === T.FLOOR && grid[k + W] < 0) || (y > 0 && t[k - W] === T.FLOOR && grid[k - W] < 0);
}

/** Whether a piece drawn face-on (props.json front: a bookshelf, a desk, a weapon rack, a banner stand) would stand at
 *  x, y with a wall directly south of it, its face to that wall (item 285, Justin 2026-10-20: "library shelves shouldn't
 *  be against the bottom wall facing the bottom wall"). It backs onto a north wall or stands by a side wall, never the
 *  south: every builder's placing step (a template's, a special's, the edge dressing, the puzzle library) passes it by.
 *  Each is one tile. */
export const facesWall = (floor, id, x, y) => !!P[id]?.front && wallLike(floor, x, y + 1);

/** Edge cells of a room a piece may take: plain floor, free, not by a door, not the centre. */
export function edgeCells(floor, grid, r) {
  const out = [];
  for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) {
    if (!(x === r.x || x === r.x + r.w - 1 || y === r.y || y === r.y + r.h - 1)) continue;
    if (tileAt(floor, x, y) !== T.FLOOR || propAt(floor, x, y) || nearDoor(floor, grid, x, y)) continue;
    if (x === r.cx && y === r.cy) continue;
    out.push({ x, y });
  }
  return out;
}

export function interiorCells(floor, r) {
  const out = [];
  for (let y = r.y + 1; y < r.y + r.h - 1; y++) for (let x = r.x + 1; x < r.x + r.w - 1; x++) if (tileAt(floor, x, y) === T.FLOOR && !propAt(floor, x, y) && !(x === r.cx && y === r.cy)) out.push({ x, y });
  return out;
}

/** 1.7 decorateEdges: n pieces on shuffled edge cells, names cycled; a face-on piece passes by a cell on the south wall. */
export function decorateEdges(rng, floor, grid, r, names, n, extra = {}) {
  let placed = 0;
  for (const c of shuffled(rng, edgeCells(floor, grid, r))) {
    if (placed >= n) break;
    const id = names[placed % names.length];
    if (!facesWall(floor, id, c.x, c.y)) { floor.props.push({ id, x: c.x, y: c.y, ...extra }); placed++; }
  }
}

/** Every open tile of a room (not wall, no blocking prop) joined to the others, four ways (W73). */
export function roomJoined(floor, r) {
  const W = floor.w, solid = new Set(floor.props.filter(p => propBlocks(p)).map(p => p.y * W + p.x)), cells = [];
  for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) { const k = y * W + x; if (floor.tiles[k] !== T.WALL && !solid.has(k)) cells.push(k); }
  if (!cells.length) return true;
  const open = new Set(cells), d = distanceField(W, floor.h, cells[0], k => open.has(k));
  return cells.every(k => d[k] >= 0);
}

/**
 * decorateEdges for pieces that stay (kept lights, banners, statues): the same shuffled edge cells, but a blocking piece
 * goes only where every open tile of the room stays reachable (W73: a forge's brazier and torch stand once shut a corner).
 */
export function decorateEdgesOpen(rng, floor, grid, r, names, n, extra = {}) {
  let placed = 0;
  for (const c of shuffled(rng, edgeCells(floor, grid, r))) {
    if (placed >= n) break;
    const id = names[placed % names.length];
    if (facesWall(floor, id, c.x, c.y)) continue;
    floor.props.push({ id, x: c.x, y: c.y, ...extra });
    if (!P[id]?.blocks || roomJoined(floor, r)) placed++; else floor.props.pop();
  }
}


/** W36: a plain room: 35% one to two edge lights from one set, then 0-3 pieces (blocking ones to an edge). */
export function decoratePlain(rng, floor, grid, r) {
  const D = P['placement-dungeon-plain-room'];
  if (next(rng) < D.edgeLights.chancePct / 100) decorateEdges(rng, floor, grid, r, pick(rng, D.edgeLights.sets), roll(rng, D.edgeLights.count[0], D.edgeLights.count[1]));
  const n = roll(rng, D.inner.count[0], D.inner.count[1]), inner = shuffled(rng, interiorCells(floor, r));
  for (let i = 0; i < Math.min(n, inner.length); i++) {
    const id = pick(rng, D.inner.table), c = inner[i];
    if (P[id]?.blocks && nearDoor(floor, grid, c.x, c.y)) continue;
    if (P[id]?.blocks) { const e = shuffled(rng, edgeCells(floor, grid, r))[0]; if (e) floor.props.push({ id, x: e.x, y: e.y }); }
    else floor.props.push({ id, x: c.x, y: c.y });
  }
}

/**
 * 1.7's prop stages for the Dungeon, over every prop placed so far that is not kept: mushrooms turn into a patch of
 * grass (60%) or moss of 3-8 cells; crates, barrels and pots turn into one stack group of their family (5 pictures,
 * flipped half the time; a pot stack does not burn); chains move to the nearest free cell against a wall (N, W or E)
 * and hang from it; straw beds are not placed (Sandbox 95).
 */
export function propStages(rng, floor, grid) {
  const W = floor.w, wall = (x, y) => tileAt(floor, x, y) === T.WALL || tileAt(floor, x, y) === T.SECRET;
  const free = (x, y) => tileAt(floor, x, y) === T.FLOOR && !propAt(floor, x, y) && !floor.items.some(i => i.x === x && i.y === y);
  const out = [];
  for (const p of floor.props) {
    if (p.keep) { out.push(p); continue; }
    if (p.id === 'mushrooms') {
      const kind = next(rng) < 0.6 ? G.GRASS : G.MOSS;
      if (tileAt(floor, p.x, p.y) === T.FLOOR) blob(() => next(rng), floor.w, floor.h, p.x, p.y, roll(rng, 3, 8), (x, y) => { if (tileAt(floor, x, y) === T.FLOOR && !floor.ground[y * W + x] && !out.concat(floor.props).some(q => q !== p && q.x === x && q.y === y)) floor.ground[y * W + x] = kind; });
      continue;
    }
    if (p.id === 'crate' || p.id === 'barrel' || p.id === 'pot') {
      // 1.7 propCrateStacks: a pot stack breaks with the pot sound and does not burn (burn 0, sfx pot-break).
      out.push({ ...p, id: 'stack-group', family: p.id, variant: Math.floor(next(rng) * 5), flip: next(rng) < 0.5, ...(p.id === 'pot' ? { burnable: false, breakSfx: 'pot-break' } : {}) });
      continue;
    }
    // Sandbox 95 (Justin 2026-10-17: "the straw beds were removed from the game awhile ago"): none is placed.
    if (p.id === 'bed-straw') continue;
    if (p.id === 'chains') {
      const dirsAt = (x, y) => [[0, -1], [-1, 0], [1, 0]].filter(([dx, dy]) => wall(x + dx, y + dy));
      let at = { x: p.x, y: p.y }, dirs = dirsAt(p.x, p.y);
      for (let r = 1; r <= 3 && !dirs.length; r++) for (let oy = -r; oy <= r && !dirs.length; oy++) for (let ox = -r; ox <= r; ox++) {
        const nx = p.x + ox, ny = p.y + oy;
        if (!free(nx, ny) || nearDoor(floor, grid, nx, ny)) continue;
        const d = dirsAt(nx, ny);
        if (d.length) { at = { x: nx, y: ny }; dirs = d; break; }
      }
      if (!dirs.length) continue;
      out.push({ ...p, x: at.x, y: at.y, chainDir: pick(rng, dirs) });
      continue;
    }
    out.push(p);
  }
  floor.props = out;
}
