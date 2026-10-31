// Traps on an ordinary floor (spec/world.md W39-W40, traps 92-96): placement and the clean-up after generation.
// Numbers and kinds: data/traps.json. Draws only from the generation stream it is given.

import traps from '../../data/traps.json' with { type: 'json' };
import { next, pick } from '../lib/rng.js';
import { T } from '../data/tiles.js';
import { distances } from './layout.js';
import { ownResidents } from './room-policy.js';
import { D4 } from '../lib/geometry.js';
import { distanceField } from '../lib/grid.js';
import { isBossFloor } from '../data/schedule.js';

// Spikes have no minFloor: they belong only to the gauntlet rooms (traps 76).
const KINDS = Object.entries(traps.rows).filter(([, r]) => typeof r.minFloor === 'number' && !r.kind).map(([id, r]) => ({ id, ...r }));
const noPits = (floorNo, boss) => boss || isBossFloor(floorNo);

/** Rooms that never take ordinary traps (traps 93): the start room and rooms with a special role. */
const SKIP_ROLES = new Set(['start', 'boss', 'chest-ambush', 'ritual', 'resident', 'merchant', 'consecrated', 'hidden-sigil', 'rare-event', 'flooded-cache']);

/**
 * W39, traps 92-93: round((2 + 2 x floor) x 0.8) traps, placed until the target or until no legal cell is left
 * (ruling 24, 2026-10-15; 1.7 stopped after 3 x the target in tries). Never in a pocket room: vault, toll or hidden
 * (ruling 23); rooms that set their own traps keep them.
 */
export function placeTraps(rng, floor, rooms, floorNo, { boss = false } = {}) {
  const W = floor.w, at = (x, y) => floor.tiles[y * W + x];
  const target = Math.round((2 + 2 * floorNo) * 0.8);
  const kinds = KINDS.filter(k => k.minFloor <= floorNo && !(k.id === 'pit' && noPits(floorNo, boss)));
  floor.traps = floor.traps ?? [];
  if (!kinds.length) return;
  const props = new Set(floor.props.map(p => p.y * W + p.x));
  const inside = (r, x, y) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
  const nearEntrance = (r, x, y) => D4.some(([dx, dy]) => { const nx = x + dx, ny = y + dy, t = at(nx, ny); return t === T.DOOR || t === T.OPEN_DOOR || (!inside(r, nx, ny) && t !== T.WALL); });
  // 1.7 world.js:417: chest-ambush rooms (bone vault, goblin mine, the Caverns' caches) and the elemental sanctuaries too.
  const skip = r => r.pocket || SKIP_ROLES.has(r.role) || r.rareEvent || r.chestAmbush || ownResidents(r.special);
  // A cave chamber owns only its own cells (floor.cave), not its whole box: boxes overlap underground.
  const owns = (r, k) => (r.cave && floor.cave ? floor.cave[k] === r.id : true);
  const barred = new Set();
  for (const r of rooms) if (skip(r)) for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) if (owns(r, y * W + x)) barred.add(y * W + x);
  const legal = [], seen = new Set();
  for (const r of rooms) {
    if (skip(r)) continue;
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) {
      const k = y * W + x;
      if (seen.has(k) || barred.has(k) || !owns(r, k) || at(x, y) !== T.FLOOR || props.has(k) || nearEntrance(r, x, y) || r.bypass?.has?.(k)) continue;
      seen.add(k); legal.push({ x, y });
    }
  }
  while (floor.traps.filter(t => !t.room).length < target && legal.length) {
    const { x, y } = legal.splice(Math.floor(next(rng) * legal.length), 1)[0];
    if (floor.traps.some(t => Math.abs(t.x - x) + Math.abs(t.y - y) < 3)) continue;
    floor.traps.push({ x, y, kind: pick(rng, kinds).id, found: false });
  }
}

/** Traps 96: the clean-up once the floor is built. */
export function cleanTraps(floor, floorNo, start, { boss = false } = {}) {
  const W = floor.w, at = (x, y) => floor.tiles[y * W + x];
  const underProp = new Set(floor.props.map(p => p.y * W + p.x));
  floor.traps = (floor.traps ?? []).filter(t => at(t.x, t.y) === T.FLOOR && !underProp.has(t.y * W + t.x) && !(t.kind === 'pit' && noPits(floorNo, boss)));
  // Pits and teleports on the narrow approach to a travel tile go (walk out while a cell has at most 2 open sides).
  const open = (x, y) => at(x, y) !== T.WALL;
  const goals = [floor.stairs, floor.arrival].filter(Boolean);
  const approach = new Set();
  const narrow = k => { const x = k % W, y = (k / W) | 0; return open(x, y) && D4.filter(([ex, ey]) => open(x + ex, y + ey)).length <= 2; };
  for (const g of goals) distanceField(W, floor.h, g.y * W + g.x, narrow).forEach((d, k) => { if (d > 0) approach.add(k); });
  const moving = t => t.kind === 'pit' || t.kind === 'teleport';
  floor.traps = floor.traps.filter(t => !(moving(t) && approach.has(t.y * W + t.x)));
  // If pits and teleports still cut every way to the stairs, the ones on the shortest way go.
  const cut = () => {
    const solid = new Set(floor.traps.filter(moving).map(t => t.y * W + t.x));
    return distances({ ...floor, tiles: floor.tiles.map((v, k) => (solid.has(k) ? T.WALL : v)) }, start)[floor.stairs.y * W + floor.stairs.x] < 0;
  };
  if (cut()) {
    const d = distances(floor, start), path = new Set();
    let c = { x: floor.stairs.x, y: floor.stairs.y };
    while (d[c.y * W + c.x] > 0) {
      path.add(c.y * W + c.x);
      const n = D4.map(([dx, dy]) => ({ x: c.x + dx, y: c.y + dy })).find(p => d[p.y * W + p.x] === d[c.y * W + c.x] - 1);
      if (!n) break;
      c = n;
    }
    floor.traps = floor.traps.filter(t => !(moving(t) && path.has(t.y * W + t.x)));
  }
}
