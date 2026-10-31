// Chests and loose items on an ordinary floor (spec/world.md W38, W41; spec/items.md I66, I68).
// Draws only from the generation stream: tables are rolled on a small generation state that carries it.

import loot from '../../data/loot.json' with { type: 'json' };
import props from '../../data/props.json' with { type: 'json' };
import { next, roll, pick, stream } from '../lib/rng.js';
import { rollTable } from '../rules/loot.js';
import { T } from '../data/tiles.js';
import { flood } from './layout.js';
import { reachFrom, propMask } from './floor-checks.js';
import { D4 } from '../lib/geometry.js';
import { propBlocks, propCurtain } from '../data/props.js';

const L = loot.rows;
const NO_LOOT_ROLES = new Set(['start', 'merchant', 'consecrated', 'hidden-sigil', 'rare-event']);

/** The tiles a prop, item or trap stands on (built once per pass, not scanned per cell). */
const takenTiles = floor => new Set([...floor.props, ...floor.items, ...(floor.traps ?? [])].map(o => o.y * floor.w + o.x));

/** A free room cell: plain floor, nothing on it, not beside a door. */
function freeCell(floor, x, y, taken = takenTiles(floor)) {
  const W = floor.w;
  if (floor.tiles[y * W + x] !== T.FLOOR || taken.has(y * W + x)) return false;
  return !D4.some(([dx, dy]) => [T.DOOR, T.OPEN_DOOR].includes(floor.tiles[(y + dy) * W + x + dx]));
}
const nearExplosive = (floor, x, y) => floor.props.some(p => Math.max(Math.abs(p.x - x), Math.abs(p.y - y)) <= 1 && (props.rows[p.id]?.explodes || p.id === 'barrel-poison'));

/** W38: two tries at an ordinary chest; from floor 2 a 12% draw makes it a mimic. */
export function placeChests(rng, floor, rooms, floorNo) {
  floor.chests = floor.chests ?? [];
  const M = L['mimic-chance'], pool = rooms.filter(r => !NO_LOOT_ROLES.has(r.role) && !r.rareEvent && !r.pocket);
  for (let i = 0; i < 2 && pool.length; i++) {
    const r = pick(rng, pool);
    const x = r.x + roll(rng, 0, r.w - 1), y = r.y + roll(rng, 0, r.h - 1);
    const mimic = floorNo >= M.fromFloor && next(rng) < M.pct / 100;
    if (!freeCell(floor, x, y) || nearExplosive(floor, x, y)) continue;
    floor.tiles[y * floor.w + x] = T.CHEST;
    floor.chests.push({ x, y, kind: 'wood', mimic });
  }
}

/**
 * W41, I68: the floor scatter (essence piles, gear, a loose sigil) on the floor's open cells (free room cells away from
 * doors, listed by the generator as 1.7 lists them). W4: the run plan's motes for this floor join the scatter.
 * 1.7 world.js:424-433: a pick that an earlier drop took drops nothing.
 */
export function scatterItems(gen, floor, open, floorNo, motes = []) {
  if (!open.length) return;
  for (const drop of [...rollTable(gen, 'floor-scatter', floorNo), ...motes.map(el => ({ kind: 'mote', el }))]) {
    // A planned mote (W4) is the run's, so it picks again until it lands (up to 20 tries); other drops keep 1.7's rule.
    for (let t = 0; t < (drop.kind === 'mote' ? 20 : 1); t++) {
      const c = open[Math.floor(next(gen.rng) * open.length)];
      if (freeCell(floor, c.x, c.y)) { floor.items.push({ x: c.x, y: c.y, item: drop }); break; }
    }
  }
}

/** I68: one meal and a 15% second, each on a room cell the arrival can reach. */
export function placeMeals(gen, floor, rooms, floorNo, start) {
  // 1.7 bfsFrom walks round blocking props, so food never lands behind a bush row (routeGuard, audit WT16).
  const solid = new Uint8Array(floor.w * floor.h);
  for (const p of floor.props) if (propBlocks(p)) solid[p.y * floor.w + p.x] = 1;
  const d = flood(floor.tiles, floor.w, floor.h, start.y * floor.w + start.x, solid);
  for (const drop of rollTable(gen, 'floor-food', floorNo)) {
    const cells = [], taken = takenTiles(floor);
    // Never inside a boss's hall (the Crypt's Morty hall; Justin 2026-10-16, C18), nor anywhere in its stamped rectangle.
    const R = floor.hallRect, inHall = (x, y) => R && x >= R.x && x < R.x + R.w && y >= R.y && y < R.y + R.h;
    for (const r of rooms) if (!r.hall) for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) if (d[y * floor.w + x] >= 0 && !inHall(x, y) && freeCell(floor, x, y, taken)) cells.push({ x, y });
    if (!cells.length) continue;
    const c = cells[Math.floor(next(gen.rng) * cells.length)];
    floor.items.push({ x: c.x, y: c.y, item: drop });
  }
}

/**
 * Item 313 (Justin 2026-10-22): the floor's guaranteed pieces (loot.json floor-guaranteed), on their own stream from the
 * floor seed, each on a free cell of an ordinary room the arrival walks to (floor-checks.js reachFrom: no locked, toll,
 * secret, sealed or puzzle door between; a web curtain is no wall, as the Underdark's route mask has it), never a pocket,
 * special, rare, start or boss room (a cave room by its own cells). The Realm's islands have no ordinary room: any
 * free cell the arrival reaches.
 */
export function placeGuaranteed(floor, floorNo, floorSeed, arrival, masterworks = {}) {
  const gen = { rng: stream((floorSeed ^ 0x6a17) >>> 0), floorNo, unbuilt: {}, masterworks }, drops = rollTable(gen, 'floor-guaranteed', floorNo);
  if (!drops.length) return;
  const W = floor.w, d = reachFrom(floor, arrival, propMask(floor, p => propBlocks(p) && !propCurtain(p))), rooms = (floor.rooms ?? []).filter(r => !r.pocket && !r.puzzle && !r.rareEvent && !r.hiddenSigil
    && (!r.special || /-host$/.test(r.special)) && !NO_LOOT_ROLES.has(r.role) && r.role !== 'boss');
  const each = r => r.cells?.map(k => ({ x: k % W, y: (k / W) | 0 })) ?? Array.from({ length: r.w * r.h }, (_, i) => ({ x: r.x + (i % r.w), y: r.y + ((i / r.w) | 0) }));
  const open = (list, taken) => list.flatMap(each).filter(c => d[c.y * W + c.x] >= 0 && freeCell(floor, c.x, c.y, taken));
  for (const item of drops) {
    const taken = takenTiles(floor), inRooms = open(rooms, taken), cells = inRooms.length ? inRooms : open([{ x: 0, y: 0, w: W, h: floor.h }], taken);
    if (!cells.length) continue;   // no free cell the arrival reaches at all (never seen): the floor goes without
    const c = cells[Math.floor(next(gen.rng) * cells.length)];
    floor.items.push({ x: c.x, y: c.y, item, guaranteed: true });
  }
}
