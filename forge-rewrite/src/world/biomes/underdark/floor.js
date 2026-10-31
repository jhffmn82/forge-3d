// An Underdark floor, 16-20, from its seed (spec/world.md W9-W13 and Underdark 104-141; 1.7 generateOnce with the
// Underdark's layout and dressing, then generateOrdinaryFloor's passes @3c8b312). The shared passes (pockets, chests,
// traps, the scatter, the key, the rare creature, trap clean-up, meals, the guaranteed gear) are the Dungeon's own; the
// Underdark brings its layout, stairs passages, room themes, furniture, specials, vegetation, dressing, curtains,
// lava, the Matron's hall and the regional roster. Attempts use seed + attempt x 7919 and never give up (answer 5).

import floors from '../../../../data/floors.json' with { type: 'json' };
import props from '../../../../data/props.json' with { type: 'json' };
import { pick, shuffle, weighted } from '../../../lib/rng.js';
import { replaceWebScenery } from './web-traps.js';
import { T, walkable, isDoor } from '../../../data/tiles.js';
import { makeCreature } from '../../../rules/monsters.js';
import { patches } from '../../ground.js';
import { placeTraps, cleanTraps } from '../../traps.js';
import { placeChests, scatterItems, placeMeals } from '../../items.js';
import { carvePockets, placeKey } from '../../pockets.js';
import { placeRare } from '../../../rules/spawns.js';
import { wallTorches } from '../../torches.js';
import { nearDoor, propStages } from '../../dress.js';
import { forgeAndShrine, openCells, populate, routesOk, commitFloor, placeTrinkets, lightRules, keepRoutesOpen, settleLayers } from '../../passes.js';
import { layoutUnderdark, roomCells, splitsRoom } from './layout.js';
import { lastPinches, fungusFloor } from './upkeep.js';
import { caveGrid, themeRoom, mapFurniture, finishRegions, dressFloor, curtains, lavaLights, vegetation, plantLights, northPassage, settle } from './dress.js';
import { buildMatronHall } from './hall.js';
import { buildUnderdarkSpecials } from './specials.js'; import { swapInPlace } from '../../swaps.js'; 
import { prepare } from '../../../rules/underdark.js';
import '../../../rules/matron.js'; import { openPinches, reachFrom, propMask } from '../../floor-checks.js';
import { D4 } from '../../../lib/geometry.js';
import { propCurtain, propBlocks } from '../../../data/props.js';
import { rosterRows } from '../../../data/roster.js';
import { biomeFloor, isBossFloor } from '../../../data/schedule.js';
import { carvePassage } from '../dead-end.js';

const F = floors.rows, P = props.rows;
const ROSTER = F['roster-underdark'];
const TRAP_CAP = 12;   // sandbox U8
/** The route mask here (1.7 generationRouteCell): a web curtain is no wall to a route. */
export const routeMask = floor => propMask(floor, p => propBlocks(p) && !propCurtain(p));


/** 114: the stairs' dead end for a room: the north passage, else (built rooms) the rectangle passage. */
const deadEnd = (rng, f, room) => northPassage(rng, f, room) ?? (room.cave ? null : carvePassage(rng, f, room, { throughProps: true }));

/** Edge cells a piece may take (cave rooms: cells beside rock), as 1.7 decorateEdges asks for them. */
function edgeCells(f, grid, rooms, r) {
  const wall = (x, y) => { const t = x < 0 || y < 0 || x >= f.w || y >= f.h ? T.WALL : f.tiles[y * f.w + x]; return t === T.WALL || t === T.SECRET; };
  return roomCells(r).filter(c => {
    const k = c.y * f.w + c.x;
    if (f.tiles[k] !== T.FLOOR || rooms[grid[k]] !== r || f.props.some(p => p.x === c.x && p.y === c.y) || nearDoor(f, grid, c.x, c.y) || (c.x === r.cx && c.y === r.cy)) return false;
    return r.cave ? D4.some(([dx, dy]) => wall(c.x + dx, c.y + dy)) : (c.x === r.x || c.y === r.y || c.x === r.x + r.w - 1 || c.y === r.y + r.h - 1);
  });
}
function decorateEdges(rng, f, grid, rooms, r, names, n, extra = {}) {
  const cells = edgeCells(f, grid, rooms, r);
  shuffle(rng, cells);
  // a solid piece never closes off a cell of the room (census 93cfcf4: kept forge and shrine pieces did)
  const area = roomCells(r);
  let placed = 0;
  for (const c of cells) {
    if (placed >= n) break;
    const id = names[placed % names.length];
    if (P[id]?.blocks && splitsRoom(f, area, [c])) continue;
    f.props.push({ id, x: c.x, y: c.y, ...extra }); placed++;
  }
}

/**
 * M59 (1.7 deepRegionalize): each foe standing in a region not its own is swapped for one of that region's roster,
 * a pack for a pack (sized within the pack range and at least the old group). Key holders, guards, bosses, residents
 * and summons stay.
 */
export function regionalize(rng, f, creatures, floorNo) {
  const rows = rosterRows(floorNo, { roster: 'roster-underdark' });
  const regionOf = Object.fromEntries(ROSTER.rows.map(r => [r.creature, r.region]));
  const caps = ROSTER.caps ?? {}, done = new Set();
  let swapped = 0;
  const list = () => creatures.filter(c => regionOf[c.kind] !== undefined && !c.keyholder && !c.guard && !c.boss && !c.owner && !c.resident && !c.set);
  for (const e of list()) {
    if (done.has(e) || !creatures.includes(e)) continue;
    const R = f.region[e.y * f.w + e.x];
    if (regionOf[e.kind] === R) { done.add(e); continue; }
    const pack = rows.find(r => r.creature === e.kind)?.pack;
    const group = [e, ...(pack ? list().filter(o => o !== e && !done.has(o) && o.kind === e.kind && Math.max(Math.abs(o.x - e.x), Math.abs(o.y - e.y)) <= 2) : [])];
    for (const o of group) done.add(o);
    const pool = rows.filter(r => r.region === R && !(caps[r.creature] && creatures.filter(c => c.kind === r.creature && !group.includes(c)).length >= caps[r.creature]));
    if (!pool.length) continue;
    const row = weighted(rng, pool);
    const n = row.pack ? Math.min(row.pack[1], Math.max(group.length, row.pack[0])) : 1, asleep = e.asleep, x = e.x, y = e.y;
    for (const o of group) creatures.splice(creatures.indexOf(o), 1);
    const taken = new Set(creatures.map(c => c.y * f.w + c.x));
    for (let q = 0; q < n; q++) {
      let s = { x, y };
      if (q > 0) {
        const near = [];
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if ((dx || dy) && walkable(f, x + dx, y + dy) && f.region[(y + dy) * f.w + x + dx] === R && !taken.has((y + dy) * f.w + x + dx) && !f.props.some(p => p.x === x + dx && p.y === y + dy && propBlocks(p))) near.push({ x: x + dx, y: y + dy });
        if (!near.length) break;
        s = pick(rng, near);
      }
      taken.add(s.y * f.w + s.x);
      const m = makeCreature(row.creature, s.x, s.y, { asleep });
      creatures.push(m); done.add(m);
    }
    swapped++;
  }
  return swapped;
}

const roomsOut = rooms => rooms.map(r => ({ x: r.x, y: r.y, w: r.w, h: r.h, cx: r.cx, cy: r.cy, role: r.role ?? null, pocket: !!r.pocket, special: r.special ?? null, dark: !!r.dark, rareEvent: !!r.rareEvent, region: r.region ?? 0, cave: !!r.cave, theme: r.deepTheme ?? null, ...(r.cells ? { cells: r.cells.slice() } : {}), ...(r.ritual ? { ritual: r.ritual } : {}) }));   // WC13: the ritual's state lives on the room

/** RB19, 1.7 deepTempleTorchCandidate: may this wall hold a temple sconce? */
export function templeTorchOk(f) {
  const W = f.w, H = f.h, R = f.region, propAt = new Set(f.props.map(p => p.y * W + p.x));
  // deepIsRaster on a temple cell: within two cells of another region (deeprender.js deepCache rmix).
  const rmix = k => { const x = k % W, y = (k / W) | 0; for (let oy = -2; oy <= 2; oy++) for (let ox = -2; ox <= 2; ox++) { const nx = x + ox, ny = y + oy; if (nx >= 0 && ny >= 0 && nx < W && ny < H && R[ny * W + nx] !== R[k]) return true; } return false; };
  const tile = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? T.WALL : f.tiles[y * W + x]);
  return (x, y) => {
    const k = y * W + x;
    if (x < 0 || y < 0 || x >= W || y >= H || f.tiles[k] !== T.WALL || f.region[k] !== 0 || propAt.has(k) || rmix(k)) return false;
    const below = f.rooms.find(r => r.cells ? r.cells.includes(k + W) : x >= r.x && x < r.x + r.w && y + 1 >= r.y && y + 1 < r.y + r.h);
    if (below?.dark) return false;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (isDoor(tile(x + dx, y + dy))) return false;
    return true;
  };
}

/** One attempt (registry.js attempt). Null when it fails. */
export function underdarkAttempt(rng, floorNo, today, runSeed, force = null, masterworks = {}, run = {}) {
  const bf = biomeFloor(floorNo), boss = isBossFloor(floorNo);
  const lay = layoutUnderdark(rng, { bf, boss });
  const W = lay.w, H = lay.h;
  const floor = { w: W, h: H, tiles: lay.tiles, ground: new Uint8Array(W * H), props: [], items: [], chests: [], traps: [], biome: 'underdark', region: lay.region, regionField: lay.field, lava: lay.lava };
  const rooms = lay.rooms, start = rooms[0];
  // Roles (W19): the start is the first room; the goal the farthest walk; floor 20 the hall.
  const dist = reachFrom(floor, { x: start.cx, y: start.cy }, routeMask(floor));
  const far = rooms.slice().sort((a, b) => dist[b.cy * W + b.cx] - dist[a.cy * W + a.cx]);
  let goal = far[0] === start ? far[1] : far[0];
  if (boss) goal = rooms.find(r => r.hall);
  start.role = 'start'; goal.role = boss ? 'boss' : 'goal';
  const startC = { x: start.cx, y: start.cy };
  let grid = caveGrid(floor, rooms);
  const bodies = boss ? buildMatronHall(rng, floor, goal) : [];
  if (boss) floor.stairs = floor.exit;
  else {
    // 114: the stairs at the end of a passage off the goal room, else the nearest room that has one, else its heart.
    let end = deadEnd(rng, floor, goal);
    if (!end) for (const r of rooms.filter(o => o !== goal && o !== start && !o.pocket).sort((a, b) => (Math.abs(a.cx - goal.cx) + Math.abs(a.cy - goal.cy)) - (Math.abs(b.cx - goal.cx) + Math.abs(b.cy - goal.cy)))) if ((end = deadEnd(rng, floor, r))) break;
    const s = end ?? { x: goal.cx, y: goal.cy };
    floor.tiles[s.y * W + s.x] = T.STAIRS; floor.stairs = s; floor.stairsHall = !!end;
    decorateEdges(rng, floor, grid, rooms, goal, ['torch-stand'], F['dead-end-hall'].goalRoomLights.count);
  }
  // W22: forge and shrine (rooms sized by the bounding box as 1.7 freeRoom does, caves too).
  forgeAndShrine(rng, floor, rooms, today, (r, names) => decorateEdges(rng, floor, grid, rooms, r, names, 2, { keep: true }));
  // W24-W30: pockets; W32-W35 and 141: specials, themed rooms where the Underdark takes them.
  const gen = { rng, floorNo, seed: runSeed, run, runSeed, unbuilt: {}, masterworks, force };
  const before = rooms.length;
  carvePockets(gen, floor, rooms, floorNo);
  const entrances = rooms.slice(before).filter(r => r.special === 'vault' || r.special === 'toll').map(r => r.inside).filter(Boolean);
  grid = caveGrid(floor, rooms);
  finishRegions(floor, rooms);   // pockets take the planned field
  const specialBodies = buildUnderdarkSpecials(gen, floor, rooms, grid, floorNo, { boss, themeRoom: (r, special) => themeRoom(rng, floor, grid, rooms, r, special) });
  grid = caveGrid(floor, rooms);
  // W36: every room nothing took is themed by its region (pockets are left plain, as 1.7 leaves them).
  for (const r of rooms) if (!r.role && !r.special && !r.rareEvent) themeRoom(rng, floor, grid, rooms, r, false);
  mapFurniture(rng, floor);
  propStages(rng, floor, grid);
  patches(rng, floor, rooms);
  placeChests(rng, floor, rooms, floorNo);
  const roomTraps = floor.traps.length;
  placeTraps(rng, floor, rooms, floorNo, { boss });
  // Sandbox U8 (Justin, 2026-10-16): at most 12 random floor traps (1.7's count reaches about 30 by floor 19); a fair draw
  // keeps 12. Traps a special room laid (the trap room) are its own and stay.
  const loose = floor.traps.splice(roomTraps);
  shuffle(rng, loose);
  floor.traps.push(...loose.slice(0, TRAP_CAP));
  // W74 (item 141): no area reachable only through a corner between two walls, which creatures cannot step through; a
  // side wall opens (before the open cells and the reach checks, and before the raster draws the caves).
  openPinches(floor);
  lastPinches(floor, grid);
  const open = openCells(floor, rooms, grid, startC, boss);   // W41: too few fails the attempt
  if (!open) return null;
  scatterItems(gen, floor, open, floorNo, today.motes);
  for (const b of specialBodies) swapInPlace('underdark', b);
  const creatures = [...bodies, ...specialBodies];
  creatures.push(...populate(rng, floor, rooms, grid, floorNo, startC, open, creatures, { caps: ROSTER.caps ?? {}, counted: false, sigils: true }));   // M56: Driders 2 a floor at most
  placeKey(rng, floor, creatures, startC);
  if (!boss) placeRare(rng, floor, floorNo, creatures, startC);
  if (!routesOk(floor, startC, boss ? { x: bodies[0].x, y: bodies[0].y } : floor.stairs, entrances, routeMask, { exit: false })) return null;   // W10
  return { floor, rooms, grid, creatures, startC, gen, boss, start };
}

/** The passes after the attempt (1.7 generateOrdinaryFloor with finishGeneratedDeep and regionalizeGeneratedDeep;
 *  registry.js complete). */
export function underdarkComplete(b, floorNo, floorSeed, runSeed) {
  const { floor, rooms, creatures, startC, boss, gen, start } = b, W = floor.w, rng = gen.rng;
  let { grid } = b;
  commitFloor(floor, true);
  placeTrinkets(floor, rooms, floorNo, floorSeed, runSeed, new Set(creatures.map(c => c.y * W + c.x)), gen.run);
  // The arrival: floors 2+ arrive on an up stairway at the end of its own north passage off the start room.
  let arrival = startC;
  if (floorNo > 1) { const end = northPassage(rng, floor, start); if (end) arrival = end; }
  grid = caveGrid(floor, rooms);
  finishRegions(floor, rooms);
  const veg = vegetation(rng, floor, rooms, grid, arrival);
  floor.spots = veg.spots;
  lightRules(floor, rooms);
  if (!boss) { dressFloor(rng, floor, rooms, grid); curtains(rng, floor, grid, creatures); }
  else {
    dressFloor(rng, floor, rooms, grid, r => r.road); curtains(rng, floor, grid, creatures);   // U10: floor 20's road cave is dressed as any cave
    const A = floor.bossArena;
    if (A) floor.traps = floor.traps.filter(t => !(t.x >= A.x && t.x < A.x + A.w && t.y >= A.y && t.y < A.y + A.h));
  }
  settle(floor, rooms, grid);
  floor.spots = floor.spots.filter(sp => !floor.props.some(p => p.x === sp.x && p.y === sp.y));
  fungusFloor(floor, rooms, arrival, floorSeed);
  regionalize(rng, floor, creatures, floorNo);
  for (const c of creatures) prepare(c);
  keepRoutesOpen(rng, floor, rooms, grid, arrival, [floor.stairs, floor.forge, floor.shrine].filter(Boolean));
  floor.rooms = roomsOut(rooms);
  floor.arrival = arrival;
  if (floorNo > 1) floor.tiles[arrival.y * W + arrival.x] = T.STAIRS_UP;
  cleanTraps(floor, floorNo, arrival, { boss });
  replaceWebScenery(floor);
  placeMeals(gen, floor, rooms, floorNo, arrival);
  if (boss) floor.boss = true;
  // Lights: wall torches on the temple's built walls only (RB19, 1.7 deeprender.js deepTempleTorchCandidate: region 0,
  // drawn as a tile and not a raster, no prop on it, not over a dark room, no door in the 3x3; only the temple's lit
  // rooms get a north-wall torch), lava flows, glowing fungus.
  floor.lights = wallTorches(floor, rooms, (((runSeed ?? floorSeed) >>> 0) % 9973) + floorNo * 131 + 1733, { ok: templeTorchOk(floor), lit: r => !r.region && !r.dark && !r.cave });
  floor.lights.push(...lavaLights(floor));
  floor.lights.push(...plantLights(floor, floor.spots, (((runSeed ?? floorSeed) >>> 0) % 9973) + floorNo * 31));   // 1.7's plant light (deepPlantLighting)
  floor.lava = floor.tiles.some(t => t === T.LAVA);
  settleLayers(floor);
  floor.region = Array.from(floor.region);
  delete floor.regionField;
  delete floor.udKinds; delete floor.udDone;
  return { floor, creatures, start: arrival };
}

