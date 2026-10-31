// A Caverns floor from its seed (biome 3, floors 11-15; spec/world.md W9-W43, Caverns 60-103), built in 1.7's order
// (js/world/world.js generateOnce with caveLayout, js/engine/generation-adapter.js generateOrdinaryFloor @3c8b312):
//   the cave layout and its scenery (layout.js, scenery.js: same rock and scenery as 1.7 seed for seed), roles, the
//   stairs at the goal chamber's centre or the Maw's arena, forge and shrine, pockets, the cave specials, chamber
//   dressing (pockets get the shared plain dressing in cave furniture), ground patches, chests, traps, the scatter,
//   creatures (with the cave swaps), the key holder, the rare creature, the route check; then the shared passes,
//   finishing the Caverns (moss for grass, glowing water), eels, the scenery trims, the light rules, props off the
//   routes, the arrival stairs under the start chamber's centre, trap repair, meals (generateFloor lays the guaranteed gear).

import floors from '../../../../data/floors.json' with { type: 'json' };
import props from '../../../../data/props.json' with { type: 'json' };
import { next, pick } from '../../../lib/rng.js';
import { lineClear } from '../../../rules/sight.js';
import { T, G } from '../../../data/tiles.js';
import { patches, vegetation } from '../../ground.js';
import { makeCreature } from '../../../rules/monsters.js';
import { placeTraps, cleanTraps } from '../../traps.js';
import { placeChests, scatterItems, placeMeals } from '../../items.js';
import { carvePockets, placeKey, carve } from '../../pockets.js';
import { decoratePlain } from '../../dress.js';
import { placeRare } from '../../../rules/spawns.js';
import { flood } from '../../layout.js';
import { forgeAndShrine, openCells, populate, routesOk, commitFloor, placeTrinkets, lightRules, keepRoutesOpen, settleLayers } from '../../passes.js';
import { layoutCaves, MW, MH } from './layout.js';
import { decorate, dressChamber, buildArena, decorateEdges, caveFurniture, nearDoor, finishCaverns, trimScenery } from './scenery.js';
import { buildCaveSpecials } from './specials.js';
import { swapBody } from '../../swaps.js'; import { openPinches, propMask, creatureOpen, pinchSites } from '../../floor-checks.js';
import { D8, cheb } from '../../../lib/geometry.js';
import { propBlocks } from '../../../data/props.js';
import { nearest, components } from '../../../lib/grid.js';
import { biomeFloor, isBossFloor } from '../../../data/schedule.js';
import biomes from '../../../../data/biomes.json' with { type: 'json' };

const F = floors.rows;

/** The cave's room grid with the pockets (rectangles) laid over it, as 1.7's roomAt answers (findCaveRoom). */
function gridOf(cave, rooms) {
  const g = Int16Array.from(cave);
  const index = new Map(rooms.map((r, k) => [r, k]));
  for (let k = 0; k < g.length; k++) if (g[k] >= 0) g[k] = rooms.findIndex(r => r.cave && r.id === cave[k]);
  rooms.forEach(r => { if (r.cave) return; const k = index.get(r); for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) if (g[y * MW + x] < 0) g[y * MW + x] = k; });
  return g;
}

/** Creatures the shared rooms asked for by Dungeon name become the Caverns' (world.md Caverns 101; world/swaps.js). */
const swapped = c => swapBody('caverns', c);

/** The rooms as the game keeps them; a chamber carries its own tile indices (`cells`), which landing and teleports read. */
const roomsOut = (rooms, cave) => rooms.map(r => ({ x: r.x, y: r.y, w: r.w, h: r.h, cx: r.cx, cy: r.cy, role: r.role ?? null, pocket: !!r.pocket, special: r.special ?? null, dark: !!r.dark, rareEvent: !!r.rareEvent, cave: !!r.cave, ...(r.cave ? { id: r.id, cells: cellsOf(cave, r) } : {}), arena: !!r.arena }));
const cellsOf = (cave, r) => { const out = []; for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) if (cave[y * MW + x] === r.id) out.push(y * MW + x); return out; };

/** One attempt (1.7 generateOnce on a cave floor; registry.js attempt). Null when it fails. */
export function cavernAttempt(rng, floorNo, today, runSeed, force = null, masterworks = {}, run = {}) {
  const bf = biomeFloor(floorNo), boss = isBossFloor(floorNo);
  const lay = layoutCaves(rng, { boss });
  if (!lay) return null;   // ruling 5: the attempt fails and retries with a new seed; never BSP rooms (1.7's fallback)
  const floor = { w: MW, h: MH, tiles: lay.tiles, ground: new Uint8Array(MW * MH), props: [], items: [], chests: [], traps: [], biome: 'caverns', cave: lay.cave, notes: lay.notes.slice() };
  const rooms = lay.rooms;
  decorate(rng, floor, lay.cave, rooms);   // 1.7 caveDecorate, inside the layout
  // A chamber's index in `rooms` is its id until pockets join; the grid holds room indices.
  let grid = gridOf(lay.cave, rooms);
  const caveGrid = lay.cave;   // chamber ids (scenery.js reads chamber cells by id)
  // Roles: the start is rooms[0]; the goal the farthest walk from it; on the boss floor the largest box.
  const start = rooms[0], dist = flood(floor.tiles, MW, MH, start.cy * MW + start.cx);
  const far = rooms.slice().sort((a, b) => (Math.max(0, dist[b.cy * MW + b.cx])) - (Math.max(0, dist[a.cy * MW + a.cx])));
  let goal = far[0] === start ? far[1] : far[0];
  if (boss) goal = rooms.find(r => r.arena && r !== start) ?? rooms.filter(r => r !== start).sort((a, b) => b.w * b.h - a.w * a.h)[0];   // ruling 26: the arena chamber by rule
  start.role = 'start';
  const startC = { x: start.cx, y: start.cy };
  if (boss) { buildArena(rng, floor, caveGrid, goal); floor.stairs = { ...floor.bossAt }; }   // the way on opens here when the Maw dies
  else {
    goal.role = 'goal';
    // Caverns 77: the stairs at the goal chamber's centre (no dead-end passage in rock), two cave lights at its edge.
    floor.tiles[goal.cy * MW + goal.cx] = T.STAIRS; floor.stairs = { x: goal.cx, y: goal.cy };
    decorateEdges(rng, floor, caveGrid, goal, ['torch-stand'], F['dead-end-hall'].goalRoomLights.count);
  }
  forgeAndShrine(rng, floor, rooms, today, (r, names) => decorateEdges(rng, floor, caveGrid, r, names, 2));   // W22, W64
  // W24-W30: pockets (rectangles cut into the rock off a chamber's box edge, as 1.7's carvePocket).
  const gen = { rng, floorNo, seed: runSeed, run, unbuilt: {}, masterworks, force };
  const before = rooms.length;
  carvePockets(gen, floor, rooms, floorNo);
  const entrances = rooms.slice(before).filter(r => r.special === 'vault' || r.special === 'toll').map(r => r.inside).filter(Boolean);
  grid = gridOf(lay.cave, rooms);
  // W32-W35: the cave specials.
  const specialBodies = buildCaveSpecials(gen, floor, rooms, caveGrid, floorNo, { boss, runSeed, carvePocket: carve }).map(swapped);
  grid = gridOf(lay.cave, rooms);
  floor.rooms = roomsOut(rooms, floor.cave);
  // W36: every chamber no role or special took gets the cave dressing; pockets the shared plain dressing, in cave furniture.
  for (const r of rooms) {
    if (r.role || r.special || r.rareEvent) continue;
    if (r.cave) dressChamber(rng, floor, caveGrid, r);
    else {
      const n = floor.props.length;
      decoratePlain(rng, floor, grid, r);
      for (let i = n; i < floor.props.length; i++) floor.props[i] = { ...floor.props[i], id: caveFurniture(rng, floor.props[i].id) };
    }
  }
  for (const r of rooms.slice(before)) if (r.pocket && (r.special === 'vault' || r.special === 'toll' || r.special === 'hidden')) {
    const n = floor.props.length;
    decoratePlain(rng, floor, grid, r);
    for (let i = n; i < floor.props.length; i++) floor.props[i] = { ...floor.props[i], id: caveFurniture(rng, floor.props[i].id) };
  }
  patches(rng, floor, rooms);
  placeChests(rng, floor, rooms, floorNo);
  placeTraps(rng, floor, rooms, floorNo, { boss });
  const open = openCells(floor, rooms, grid, startC, boss, nearDoor);   // W41: chamber cells away from doors and tunnel mouths
  if (!open) return null;
  scatterItems(gen, floor, open, floorNo, today.motes);
  // The boss floor's Maw sleeps under its first burrow (bosses.json deep-maw; set piece in rules/caverns-maw.js).
  if (boss) deepMaw(floor);
  const bossBodies = [];
  const roomsForPop = rooms.map(r => (r.chestAmbush || r.special === 'flooded-cache' ? { ...r, rareEvent: true } : r));   // 1.7: no foes in ambush rooms or the flooded cache
  const creatures = [...bossBodies, ...specialBodies, ...populate(rng, floor, roomsForPop, grid, floorNo, startC, open)].map(swapped);
  placeKey(rng, floor, creatures, startC);
  if (!boss) placeRare(rng, floor, floorNo, creatures, startC);
  if (!routesOk(floor, startC, boss ? floor.bossAt : floor.stairs, entrances, f => propMask(f, propBlocks))) return null;   // W10
  return { floor, rooms, grid, creatures, startC, gen, boss };
}

/** The Deep Maw, dormant under the first burrow (or the arena centre): off the map, kept in floor.maw until it surfaces (Caverns 99; rules/maw.js). */
function deepMaw(floor) {
  const A = floor.bossArena, at = A?.mounds[0] ?? floor.bossAt;
  const body = makeCreature('deepmaw', at.x, at.y);
  Object.assign(body, { set: 'deep-maw', burrowed: true, asleep: false, hunting: false, heavy: true, boss: true });
  floor.maw = { phase: 'dormant', at: 0, n: 0, cells: [], rubble: [], site: null, tenders: [], limbs: [], body, arena: A, shownIn: -1 };
}

/** Shock eels (world.md Caverns 102, A23; biomes.json caverns.eels): each body of 8+ water cells, largest first, 75%
 *  an eel (3 a floor), out of the hero's sight. */
export function placeEels(rng, floor, creatures, from, floorNo) {
  const E = biomes.rows.caverns.eels;
  if (floorNo < E.floors[0] || floorNo > E.floors[1]) return [];
  const bodies = components(MW, MH, k => floor.tiles[k] === T.WATER, { lists: true }).lists.filter(q => q.length >= E.minBody);
  bodies.sort((a, b) => b.length - a.length);
  const out = [];
  const ambush = new Set((floor.rooms ?? []).filter(r => r.role === 'merchant' || r.special === 'flooded-cache').flatMap(r => { const c = []; for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) c.push(y * MW + x); return c; }));
  for (const body of bodies) {
    if (out.length >= E.maxPerFloor) break;
    if (!(next(rng) < E.bodyPct / 100)) continue;
    const cells = body.filter(k => !ambush.has(k) && !creatures.some(c => c.y * MW + c.x === k) && !floor.props.some(p => p.y * MW + p.x === k));
    for (let t = 0; t < 30 && cells.length; t++) {
      const k = pick(rng, cells), x = k % MW, y = (k / MW) | 0;
      if (Math.max(Math.abs(x - from.x), Math.abs(y - from.y)) < E.minDistance) continue;
      if (Math.max(Math.abs(x - from.x), Math.abs(y - from.y)) <= 9 && lineClear(floor, from, { x, y })) continue;   // out of sight
      const m = makeCreature(E.creature, x, y, { asleep: next(rng) < E.asleepPct / 100 });
      out.push(m); creatures.push(m);
      break;
    }
  }
  return out;
}

/** The passes after the attempt (1.7 generateOrdinaryFloor's, those that act on a cave floor; registry.js complete). */
export function cavernComplete(b, floorNo, floorSeed, runSeed) {
  const { floor, rooms, grid, creatures, startC, boss, gen } = b;
  commitFloor(floor);
  floor.rooms = roomsOut(rooms, floor.cave);
  placeTrinkets(floor, rooms, floorNo, floorSeed, runSeed, new Set(creatures.map(c => c.y * MW + c.x)), gen.run);
  finishCaverns(floor, G);
  trimScenery(floor);
  // 1.7 vegGrow on a cave floor: teal cave grass takes over the moss, mushroom groups on the spots (vegetation.js).
  floor.spots = vegetation(gen.rng, floor, rooms, startC, new Set(creatures.map(c => c.y * MW + c.x)), floor.cave);
  lightRules(floor, rooms);
  keepRoutesOpen(gen.rng, floor, rooms, grid, startC, [floor.stairs, floor.forge, floor.shrine].filter(Boolean));
  lightRules(floor, rooms);
  floor.arrival = startC;
  if (floorNo > 1) floor.tiles[startC.y * MW + startC.x] = T.STAIRS_UP;   // Caverns 78: the up stairs under the hero
  cleanTraps(floor, floorNo, startC, { boss });
  placeMeals(gen, floor, rooms, floorNo, startC);
  noPinches(floor, creatures);   // W74 on a cave floor
  // Ruling 6 (2026-10-15): eels are placed while the floor is built, never on the hero's first step (phase A23 dropped).
  placeEels(gen.rng, floor, creatures, startC, floorNo);
  if (boss) floor.boss = true;
  floor.lights ??= [];   // no derived wall torches underground; the scenery lights (kind scene) are already here
  settleLayers(floor);
  floor.cave = Array.from(floor.cave);
  return { floor, creatures, start: startC };
}

/**
 * W74 on a cave floor (sandbox lead 2026-10-18, item 141): no area reachable only through a corner pinch, where the hero
 * may step diagonally and creatures may not. floor-checks.js openPinches opens a wall side. A cave pinch can also have a
 * chest on one side and a chasm on the other (no wall to open): there the chest moves to the nearest free floor cell
 * and its own cell becomes floor, and the walls are tried again, until creatures reach every area the hero does.
 */
function noPinches(floor, creatures) {
  const W = floor.w, H = floor.h, open = creatureOpen(floor);
  for (let guard = 0; guard < 20; guard++) {
    openPinches(floor);
    let chest = null;
    for (const [, , , , cells] of pinchSites(floor)) if ((chest = cells.find(([sx, sy]) => floor.tiles[sy * W + sx] === T.CHEST) ?? null)) break;
    if (!chest) return;
    const [cx, cy] = chest, taken = new Set([...floor.props, ...floor.items, ...floor.traps, ...creatures].map(o => o.y * W + o.x));
    if (floor.arrival) taken.add(floor.arrival.y * W + floor.arrival.x);
    // the nearest plain floor cell, not beside the pinch, by walking out from the chest
    const at = nearest(W, H, cy * W + cx, k => { const x = k % W, y = (k / W) | 0; return x >= 1 && y >= 1 && x < W - 1 && y < H - 1 && open(x, y); },
      k => floor.tiles[k] === T.FLOOR && !taken.has(k) && cheb({ x: k % W, y: (k / W) | 0 }, { x: cx, y: cy }) > 1, { dirs: D8 });
    const to = at < 0 ? null : [at % W, (at / W) | 0];
    floor.tiles[cy * W + cx] = T.FLOOR;
    const c = floor.chests.find(q2 => q2.x === cx && q2.y === cy);
    if (to && c) { floor.tiles[to[1] * W + to[0]] = T.CHEST; c.x = to[0]; c.y = to[1]; }
    else if (c) floor.chests.splice(floor.chests.indexOf(c), 1);
  }
}

