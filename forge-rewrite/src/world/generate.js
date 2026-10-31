// An ordinary Dungeon floor from its seed (spec/world.md W9-W43, W60), built in 1.7's order
// (js/world/world.js generateOnce, js/engine/generation-adapter.js generateOrdinaryFloor @3c8b312):
//   layout (src/world/layout.js: 1.7's rooms, corridors and doors, seed for seed), roles, the stairs or the boss room,
//   forge and shrine, pockets, specials, plain dressing and prop stages, ground patches, chests, traps, the scatter
//   (too few open cells fails the attempt), creatures, the key holder, the rare creature, the route check;
//   then floor rings and amulets, vegetation, the light rules, props kept off the routes, trap repair, meals; every biome's
//   floor last lays its guaranteed gear (items.js placeGuaranteed, item 313).
// Attempts use seed + attempt x 7919 as 1.7 does; where 1.7 gives up after 8 (it then refuses the stairs) this keeps
// trying (Justin, 2026-10-16).

import floors from '../../data/floors.json' with { type: 'json' };
import { stream } from '../lib/rng.js';
import { layoutDungeon, flood } from './layout.js';
import { T, isObjectTile } from '../data/tiles.js';
import { patches, vegetation, wear } from './ground.js';
import { placeTraps, cleanTraps } from './traps.js';
import { placeChests, scatterItems, placeMeals, placeGuaranteed } from './items.js';
import { carvePockets, placeKey, carve } from './pockets.js';
import { buildSpecials } from './specials.js';
import { planFor } from './runplan.js';
import { buildBossRoom } from './boss.js';
import { placeRare } from '../rules/spawns.js';
import { wallTorches, daylightPatches, beacons } from './torches.js';
import gods from '../../data/gods.json' with { type: 'json' };
import { roomGrid, decorateEdges, decorateEdgesOpen, decoratePlain, propStages } from './dress.js';
import { assignTemplates, dressTemplate } from './templates.js';
import { hooksFor } from './biomes/registry.js';
import './biomes/index.js';   // every biome registers its hooks (registry.js)
import { buildPuzzles } from './puzzles/build.js';
import * as better from './improve.js'; import { trimDoubled } from './layout-trim.js'; import { swapBody } from './swaps.js'; import { ownResidents } from './room-policy.js'; import { portalLight } from './floor-lights.js'; import { openPinches, noSealedCells, goalCut, reachFrom, propMask } from './floor-checks.js';
import { forgeAndShrine, openCells, populate, routesOk, commitFloor, lightRules, keepRoutesOpen, placeTrinkets, planePortal, settleLayers, offWalls, itemsOffProps, QUIET_ROLES } from './passes.js';
import { D4 } from '../lib/geometry.js';
import { propBlocks } from '../data/props.js';
import { biomeOf, biomeFloor, isBossFloor } from '../data/schedule.js';


const F = floors.rows;
const ATTEMPTS = F.generation.attempts, STEP = F.generation.retrySeedStep, MORE = 64;



const roomsOut = rooms => rooms.map(r => ({ x: r.x, y: r.y, w: r.w, h: r.h, role: r.role ?? null, pocket: !!r.pocket, special: r.special ?? null, dark: !!r.dark, rareEvent: !!r.rareEvent, ...(r.hiddenSigil ? { hiddenSigil: r.hiddenSigil.id } : {}), ...(r.puzzle ? { puzzle: r.puzzle.kind } : {}), ...(r.template ? { template: r.template } : {}), ...(r.shape ? { shape: r.shape } : {}) }));

/** One attempt (1.7 generateOnce). Null when the attempt fails, as 1.7's does.
 *  on: the improvements Dungeon floors 1-5 take (improve.js, Justin's D1-D12), a Set of 'D1'..'D12'; null for 1.7's floor. */
function buildOnce(rng, floorNo, today, floorSeed, runSeed, on = null, force = null, masterworks = {}, run = {}) {
  const bf = biomeFloor(floorNo), boss = isBossFloor(floorNo);
  const H_ = hooksFor(floorNo), ctx = { floorNo, bf, boss, runSeed, floorSeed, cap: !!on };   // biome hooks (biomes/registry.js)
  const plus = !!on && biomeOf(floorNo) === 'dungeon' && !H_.layout, has = d => plus && on.has(d);
  // Each improvement its own stream (floor seed ^ 0xd1d1 ^ its number), so turning one off leaves the others' draws.
  const ir = n => stream((floorSeed ^ 0xd1d1 ^ Math.imul(n, 0x9e3779b1)) >>> 0);
  const lay = H_.layout?.(rng, ctx) ?? layoutDungeon(rng, { boss, trim: has('D1'), spaceDoors: has('D4'), cap: !!on });
  if (has('D2')) better.orient(lay, ir(2));
  const mood = has('D7') ? better.floorMood(ir(7), floorNo, boss) : null;
  const W = lay.w, H = lay.h;
  const floor = { w: W, h: H, tiles: lay.tiles, ground: new Uint8Array(W * H), props: [], items: [], chests: [], traps: [] };
  const rooms = lay.rooms;
  // Roles (W19): the start is the leftmost room; the goal the farthest walk from it; on a boss floor the largest.
  const start = rooms[0], dist = flood(floor.tiles, W, H, start.cy * W + start.cx);
  const far = rooms.slice().sort((a, b) => dist[b.cy * W + b.cx] - dist[a.cy * W + a.cx]);
  let goal = far[0] === start ? far[1] : far[0];
  if (boss) goal = rooms.find(r => r.hall) ?? rooms.filter(r => r !== start).sort((a, b) => b.w * b.h - a.w * a.h)[0];   // the Crypt's stamped hall
  start.role = 'start'; goal.role = boss ? 'boss' : 'goal';
  const startC = { x: start.cx, y: start.cy };
  if (mood) floor.mood = mood;
  const approach = has('D10') && boss && !H_.bossRoom ? better.bossApproach(ir(10), floor, rooms, goal, startC) : null;
  let grid = roomGrid(floor, rooms);
  // W20, W23: the stairs and two torch stands in the goal room, or the boss room.
  const bossBodies = !boss ? [] : H_.bossRoom ? H_.bossRoom(rng, floor, rooms, grid, ctx).bodies : buildBossRoom(rng, floor, goal, 'grukk', grid);
  if (boss) floor.stairs = floor.exit;
  else {
    const s = H_.stairs?.(rng, floor, goal, rooms, grid, ctx);   // floors 6+: at the end of a dead-end passage
    if (s) floor.stairs = s; else { floor.tiles[goal.cy * W + goal.cx] = T.STAIRS; floor.stairs = { x: goal.cx, y: goal.cy }; }
    decorateEdges(rng, floor, grid, goal, ['torch-stand'], F['dead-end-hall'].goalRoomLights.count); }
  forgeAndShrine(rng, floor, rooms, today, (r, names) => decorateEdgesOpen(rng, floor, grid, r, names, 2, { keep: true }));   // W22, W64
  // W24-W30: pockets; W32-W35: specials (both may add rooms).
  const gen = { rng, floorNo, runSeed, seed: runSeed, run, unbuilt: {}, masterworks, classic: !on, force };   // classic: 1.7's floor, no improvements; force: the sandbox's preview; masterworks: the hero's (I65)
  const before = rooms.length;
  const pocketBodies = carvePockets(gen, floor, rooms, floorNo);   // the Slime Chamber's slimes
  const entrances = rooms.slice(before).filter(r => r.special === 'vault' || r.special === 'toll').map(r => r.inside).filter(Boolean);
  const specialBodies = buildSpecials(gen, floor, rooms, floorNo, { boss, carvePocket: carve });
  grid = roomGrid(floor, rooms);
  floor.rooms = roomsOut(rooms);
  // W36: every room no role or special took (pockets too, as in 1.7) is dressed plainly; then the prop stages. Item 233:
  // on an improved Dungeon floor every room takes a template (world/templates.js), which dresses it instead.
  if (has('D5')) {
    const r5 = ir(5);
    assignTemplates(r5, rooms, floorNo, mood);
    for (const r of rooms) dressTemplate(r5, floor, grid, r);
  } else {
    for (const r of rooms) if (!r.role && (!r.special || /-host$/.test(r.special)) && !r.rareEvent) {   // ruling 29: a pocket's host is dressed plainly
      decoratePlain(rng, floor, grid, r);
      H_.dressRoom?.(rng, floor, grid, r, ctx);
    }
    for (const r of rooms.slice(before)) if (r.pocket && !r.hiddenSigil && (r.special === 'vault' || r.special === 'toll' || r.special === 'hidden')) decoratePlain(rng, floor, grid, r);
  }
  H_.beforeStages?.(rng, floor, rooms, grid, ctx);
  propStages(rng, floor, grid);
  patches(rng, floor, rooms);
  const r7 = mood ? ir(70) : null;
  if (mood === 'flooded') better.floodFloor(r7, floor, rooms);
  if (mood === 'collapsed') better.collapse(r7, floor, rooms, grid);
  placeChests(rng, floor, rooms, floorNo);
  placeTraps(rng, floor, rooms, floorNo, { boss });
  const open = openCells(floor, rooms, grid, startC, boss);   // W41: too few fails the attempt
  if (!open) return null;
  scatterItems(gen, floor, has('D8') ? better.lootWeights(floor, rooms, grid, open, startC, floor.stairs) : open, floorNo, today.motes);
  // D9: a watch of 2-3 at the vault's way in, else the boss's door, else the stairs.
  const quietK = k => { const r = rooms[grid[k]]; return !!r && (r.pocket || QUIET_ROLES.has(r.role) || ownResidents(r.special) || r.rareEvent || r.chestAmbush); };
  const posted = has('D9') ? better.postGuards(ir(9), floor, rooms, grid, floorNo, startC, entrances[0] ?? approach?.door ?? (boss ? null : floor.stairs), quietK) : [];
  const creatures = [...bossBodies, ...pocketBodies, ...specialBodies, ...posted, ...populate(rng, floor, rooms, grid, floorNo, startC, open, posted)];
  for (let i = 0; i < creatures.length; i++) creatures[i] = swapBody(biomeOf(floorNo), creatures[i]);   // Crypt 57: before the key holder
  placeKey(rng, floor, creatures, startC);
  if (!boss) placeRare(rng, floor, floorNo, creatures, startC);   // W44
  // W10 (the boss floor's gate counts shut until its boss dies).
  const sealed = boss ? new Uint8Array(W * H).map((_, k) => (floor.tiles[k] === T.EXIT ? 1 : 0)) : null;
  const mask = f => { const m = propMask(f, propBlocks); if (sealed) for (let k = 0; k < m.length; k++) m[k] |= sealed[k]; return m; };
  if (!routesOk(floor, startC, boss ? { x: bossBodies[0].x, y: bossBodies[0].y } : floor.stairs, entrances, mask)) return null;
  return { floor, rooms, grid, creatures, startC, bossBodies, gen, boss, H: H_, ctx, has, ir, mood, r7 };
}

/** The passes after the attempt (1.7 generateOrdinaryFloor), then the floor as the game keeps it. */
function finish(b, floorNo, floorSeed, runSeed, cls, last = true) {
  const { floor, rooms, grid, creatures, startC, boss, gen } = b, W = floor.w;
  commitFloor(floor);
  placeTrinkets(floor, rooms, floorNo, floorSeed, runSeed, new Set(creatures.map(c => c.y * W + c.x)), gen.run);
  // W13: the puzzle pass (src/world/puzzles), then no prop on an object tile. Dungeon and Crypt floors (1.7 plans each
  // biome's 5b+2..5b+4: two sigil rooms and a crystal vault or elemental treasury); the other biomes' sessions own theirs.
  if (biomeOf(floorNo) === 'dungeon' || biomeOf(floorNo) === 'crypt') {
    if (buildPuzzles(floor, rooms, creatures, { floorNo, floorSeed, runSeed, boss, cls, gen }) === false && !last) return null;   // planned, no room for it: the next attempt
    floor.props = floor.props.filter(p => !isObjectTile(floor.tiles[p.y * W + p.x]));
  }
  // D1 again: pockets and puzzle rooms carve their own passages after the layout; a strip they doubled is trimmed too.
  if (b.has('D1')) trimDoubled(floor.tiles, W, floor.h, rooms, new Set([...floor.props, ...floor.items, ...floor.traps, ...floor.chests, ...creatures, startC].map(o => o.y * W + o.x)));
  if (b.has('D3')) better.shapeRooms(b.ir(3), floor, rooms, creatures, startC);
  if (b.mood === 'overgrown') better.leanGreen(b.r7, rooms);
  if (b.has('D5')) assignTemplates(b.ir(5), rooms, floorNo, b.mood);   // item 233: the rooms the puzzles carved are set pieces
  floor.rooms = roomsOut(rooms);
  floor.biome = biomeOf(floorNo);
  if (b.H.vegetation !== false) floor.spots = vegetation(gen.rng, floor, rooms, startC, new Set(creatures.map(c => c.y * W + c.x)));
  lightRules(floor, rooms);
  keepRoutesOpen(gen.rng, floor, rooms, grid, startC, [floor.stairs, floor.forge, floor.shrine].filter(Boolean));
  lightRules(floor, rooms);   // a moved light may now touch another (W60)
  noSealedCells(floor, startC);
  b.H.finish?.(b, b.ctx);
  // Floors 6+: the arrival at the end of a dead-end passage (biome hook), else the start room's centre.
  floor.arrival = (floorNo > 1 && b.H.arrival?.(gen.rng, floor, startC, rooms, b.ctx)) || startC;
  if (floorNo > 1) floor.tiles[floor.arrival.y * W + floor.arrival.x] = T.STAIRS_UP;
  planePortal(floor, floorNo, runSeed, creatures);
  cleanTraps(floor, floorNo, floor.arrival, { boss });
  placeMeals(gen, floor, rooms, floorNo, floor.arrival);
  if (boss) floor.boss = true;
  openPinches(floor);   // W74
  // The lights 1.7 derives from the finished map: wall torches (a sconce each), daylight on growth, beacons.
  const lightSalt = (((runSeed ?? floorSeed) >>> 0) % 9973) + floorNo * 131 + 1733;
  floor.lights = [...(biomeOf(floorNo) === 'dungeon' || b.H.wallTorches ? wallTorches(floor, rooms, lightSalt) : []), ...(biomeOf(floorNo) === 'dungeon' ? daylightPatches(floor, rooms, lightSalt) : []),
    ...beacons(floor, floor.shrine?.god ? gods.rows[floor.shrine.god]?.color : null)];
  if (b.has('D12')) floor.lights.push(...better.sideTorches(floor, rooms, floor.lights.filter(l => l.kind === 'wall-torch')));
  if (b.mood === 'dark') better.darken(b.r7, floor, rooms);
  portalLight(floor);   // W3: a plane portal placed above glows (the lights were rebuilt here)
  if (biomeOf(floorNo) === 'dungeon') floor.wear = wear(floor, rooms, lightSalt + 401);   // item 207: worn paths, old rooms' cracks, damp by water
  settleLayers(floor);
  if (!last && goalCut(floor, floor.arrival, boss ? b.bossBodies[0] : floor.stairs)) return null;   // W10: a kept piece cut the stairs off
  return { floor, creatures, start: floor.arrival };
}

/** Justin's Dungeon improvements (improvements-dungeon.md; D6 declined; D11 and D13 are drawing, not generation). */
export const IMPROVEMENTS = ['D1', 'D2', 'D3', 'D4', 'D5', 'D7', 'D8', 'D9', 'D10', 'D12'];

/**
 * W9-W12: a new floor from its seed, every biome through one loop (W5, world-29): 1.7's 8 attempts (seed + attempt x
 * 7919), then more rather than refusing the stairs (W10). A biome that builds its floor its own way (the Caverns, the
 * Underdark) brings its attempt and complete hooks (biomes/registry.js); the last words are the same for all.
 * opts.classic: 1.7's floor (census, parity); opts.only: just these improvements (before/after pictures); opts.force:
 * the sandbox's room preview {type, kind}, its built flag set when the forced room was made (rare.js forcedKind);
 * opts.masterworks: the Masterworks the hero has picked up, so the floor's gear rerolls against them (I65, item 313).
 * @param {number} floorSeed @param {number} floorNo @param {any} plan the run plan and seed; accepted floors update its trinket history and looks
 * @returns {{floor:any, creatures:any[], start:{x:number,y:number}}|null}
 */
export function generateFloor(floorSeed, floorNo, plan = null, { classic = false, only = null, force = null, masterworks = {} } = {}) {
  const on = classic ? null : new Set(only ?? IMPROVEMENTS), H = hooksFor(floorNo), today = planFor(plan, floorNo), own = !!H.attempt;
  for (let attempt = 0; attempt < ATTEMPTS + MORE; attempt++) {
    const seed = (floorSeed + attempt * STEP) >>> 0, last = attempt === ATTEMPTS + MORE - 1;
    // 340: rejected attempts must not consume unseen kinds; only an accepted floor joins the run.
    const run = { seenTrinkets: [...(plan?.seenTrinkets ?? [])], ringLooks: plan?.ringLooks, amuletLooks: plan?.amuletLooks };
    const b = own ? H.attempt(stream(seed), floorNo, today, plan?.seed, force, masterworks, run) : buildOnce(stream(seed), floorNo, today, seed, plan?.seed, on, force, masterworks, run);
    const done = b && (own ? H.complete(b, floorNo, seed, plan?.seed) : finish(b, floorNo, seed, plan?.seed, plan?.cls, last));
    if (!done) continue;
    if (own) planePortal(done.floor, floorNo, plan?.seed, done.creatures);
    offWalls(done.floor); itemsOffProps(done.floor);
    if (own) noSealedCells(done.floor, done.start);   // W73 on the biomes' own floors too
    placeGuaranteed(done.floor, floorNo, seed, done.start, masterworks);
    if (plan) for (const key of ['seenTrinkets', 'ringLooks', 'amuletLooks']) if (run[key]) plan[key] = run[key];
    return done;
  }
  return null;
}

export { reachFrom };   // engine/game.js reads the route check here
