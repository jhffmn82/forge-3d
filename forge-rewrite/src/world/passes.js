// The floor passes every biome's builder runs (consolidation W5, world-01, 02, 18): the forge and shrine, the open-cell
// scan, creatures, the route check, the commit filters, the trinkets, the light rules, props kept off the routes, the
// plane portal and the last words on a finished floor. Imports no biome, so generate.js and the biome floors share it
// without a cycle.

import floors from '../../data/floors.json' with { type: 'json' };
import props from '../../data/props.json' with { type: 'json' };
import loot from '../../data/loot.json' with { type: 'json' };
import roomsData from '../../data/rooms.json' with { type: 'json' };
import { stream, next, roll, shuffled, pick, weighted } from '../lib/rng.js';
import { T, G, walkable, isObjectTile } from '../data/tiles.js';
import { makeCreature } from '../rules/monsters.js';
import { giveOf } from '../rules/loot.js';
import { nearDoor } from './dress.js';
import { planPortals, placePortal } from './planes/portal.js';
import { ownResidents } from './room-policy.js';
import { reachFrom, propMask } from './floor-checks.js';
import { piecesOf } from './pieces.js';
import { D4 } from '../lib/geometry.js';
import { nearest } from '../lib/grid.js';
import { propSolid, propBlocks } from '../data/props.js';
import { biomeIndex, biomeFloor, isBossFloor } from '../data/schedule.js';
import { rosterRows } from '../data/roster.js';

const F = floors.rows;
export const QUIET_ROLES = new Set(['boss', 'forge', 'shrine']);
const FORGE = roomsData.rows['forge-room'], SHRINE = roomsData.rows['shrine-room'];

/** The tiles a prop, item or trap stands on, plus the reserved ones (built once per pass). */
export const occupied = (floor, taken) => { const s = new Set(taken); for (const o of [...floor.props, ...floor.items, ...floor.traps]) s.add(o.y * floor.w + o.x); return s; };

/** A free room cell for loot and bodies (1.7 freeCell): plain floor with nothing on it. */
function freeCell(floor, occ, x, y) {
  const k = y * floor.w + x;
  return floor.tiles[k] === T.FLOOR && !occ.has(k);
}

/**
 * W22: the forge room (area 16+, else 9+) and the shrine room (12+, else 9+; rooms.json forge-room, shrine-room), free rooms picked uniformly. Every biome is
 * guaranteed both (Justin, 2026-10-16): past 1.7's sizes, any free room, then the largest room with no role yet (pockets
 * aside). edges(r, names) dresses the room in the biome's way.
 */
export function forgeAndShrine(rng, floor, rooms, today, edges) {
  const W = floor.w;
  const freeRoom = min => { const c = rooms.filter(r => !r.pocket && !r.role && r.w * r.h >= min); return c.length ? pick(rng, c) : null; };
  const anyRoom = () => freeRoom(1) ?? rooms.filter(r => !r.pocket && !r.role).sort((p, q) => q.w * q.h - p.w * p.h)[0] ?? null;
  if (today.forge) {
    const r = freeRoom(FORGE.minArea) ?? freeRoom(FORGE.fallbackMinArea) ?? anyRoom();
    if (r) { r.role = 'forge'; floor.tiles[r.cy * W + r.cx] = T.FORGE; floor.forge = { x: r.cx, y: r.cy }; edges(r, ['brazier-lit', 'torch-stand']); }
  }
  if (today.shrine) {
    const r = freeRoom(SHRINE.minArea) ?? freeRoom(SHRINE.fallbackMinArea) ?? anyRoom();
    if (r) { r.role = 'shrine'; floor.tiles[r.cy * W + r.cx] = T.SHRINE; floor.shrine = { x: r.cx, y: r.cy, god: today.shrine }; edges(r, ['statue', 'banner-stand']); }
  }
}

/** W41: the open cells (free room cells away from doors), or null when too few for the floor (the attempt fails). */
export function openCells(floor, rooms, grid, startC, boss, doorNear = nearDoor) {
  const W = floor.w, open = [], occ = occupied(floor, [startC.y * W + startC.x]);   // the arrival stays clear
  for (let y = 0; y < floor.h; y++) for (let x = 0; x < W; x++) {
    const k = y * W + x, r = rooms[grid[k]];
    if (!r || floor.tiles[k] !== T.FLOOR || occ.has(k) || r.rareEvent || r.role === 'merchant' || r.hiddenSigil || doorNear(floor, grid, x, y)) continue;
    open.push({ x, y });
  }
  return open.length < (boss ? F.generation.minFreeRoomCells.boss : F.generation.minFreeRoomCells.ordinary) ? null : open;
}

/**
 * W43: creatures from the floor's roster, at least minDistanceFromStart from the arrival; packs spread around the first.
 * posted: creatures already placed (D9's guards; the Underdark's set pieces), kept clear of; counted towards the floor's
 * number unless counted: false. caps: the roster's per-creature caps (the Underdark's Driders). sigils: hidden sigil rooms
 * stay quiet too.
 */
export function populate(rng, floor, rooms, grid, floorNo, startC, open, posted = [], { caps = null, counted = true, sigils = false } = {}) {
  const pop = F['monster-population'];
  const target = isBossFloor(floorNo) ? pop.target.bossFloor : 12 + 3 * biomeFloor(floorNo) + 2 * biomeIndex(floorNo);
  const rows = rosterRows(floorNo);
  if (!rows.length) return [];
  const out = [], taken = new Set([startC.y * floor.w + startC.x, ...posted.map(c => c.y * floor.w + c.x)]);
  const count = k => [...posted, ...out].filter(c => c.kind === k).length;
  const pickRow = () => weighted(rng, caps ? rows.filter(r => !(caps[r.creature] && count(r.creature) >= caps[r.creature])) : rows);
  const goal = counted ? target - posted.length : target;
  const quiet = k => { const r = rooms[grid[k]]; return !!r && (QUIET_ROLES.has(r.role) || ownResidents(r.special) || r.rareEvent || (sigils && r.hiddenSigil) || r.chestAmbush); };   // 1.7 world.js:445
  const freeAt = (x, y) => walkable(floor, x, y) && !taken.has(y * floor.w + x) && !floor.props.some(p => p.x === x && p.y === y && propBlocks(p));
  for (let tries = 0; tries < target * 4 && out.length < goal; tries++) {
    const s = pick(rng, open);
    if (!freeAt(s.x, s.y) || Math.abs(s.x - startC.x) + Math.abs(s.y - startC.y) < pop.minDistanceFromStart || quiet(s.y * floor.w + s.x)) continue;
    const row = pickRow(), n = row.pack ? roll(rng, row.pack[0], row.pack[1]) : 1;
    for (let i = 0; i < n && out.length < goal; i++) {
      let c = s;
      if (i > 0) {
        const near = [];
        for (let dy = -pop.packSpread; dy <= pop.packSpread; dy++) for (let dx = -pop.packSpread; dx <= pop.packSpread; dx++) if ((dx || dy) && freeAt(s.x + dx, s.y + dy)) near.push({ x: s.x + dx, y: s.y + dy });
        if (!near.length) break;
        c = pick(rng, near);
        if (quiet(c.y * floor.w + c.x)) continue;
      }
      taken.add(c.y * floor.w + c.x);
      const asleepPct = floorNo <= pop.state.earlyFloors.lastFloor ? pop.state.earlyFloors.asleepPct : grid[c.y * floor.w + c.x] >= 0 ? pop.state.inRoom.asleepPct : 0;
      out.push(makeCreature(row.creature, c.x, c.y, { asleep: asleepPct > 0 && next(rng) < asleepPct / 100 }));
    }
  }
  return out;
}

/**
 * W10: everything that matters is reachable from the start over `mask(floor)` (the stairs or the boss, the vault and toll
 * ways in, a step beside the forge and the shrine); else the blocking decoration goes (kept pieces stay), else false.
 */
export function routesOk(floor, startC, goal, entrances, mask, opts) {
  const W = floor.w, need = [goal, ...entrances];
  const near = c => c && D4.map(([dx, dy]) => ({ x: c.x + dx, y: c.y + dy })).find(p => walkable(floor, p.x, p.y));
  if (floor.forge) need.push(near(floor.forge));
  if (floor.shrine) need.push(near(floor.shrine));
  const ok = () => { const d = reachFrom(floor, startC, mask(floor), opts); return need.every(c => !c || d[c.y * W + c.x] >= 0); };
  if (ok()) return true;
  floor.props = floor.props.filter(p => !propBlocks(p) || p.keep);
  return ok();
}

/** commitGeneratedFloor: traps only on bare floor, items on walkable tiles or stairs, no props on object tiles (parts:
 *  a wide piece's parts may stand on one). */
export function commitFloor(floor, parts = false) {
  const W = floor.w, propAtK = new Set(floor.props.map(p => p.y * W + p.x));
  floor.traps = floor.traps.filter(t => floor.tiles[t.y * W + t.x] === T.FLOOR && !propAtK.has(t.y * W + t.x));
  floor.items = floor.items.filter(i => walkable(floor, i.x, i.y) || floor.tiles[i.y * W + i.x] === T.STAIRS);
  floor.props = floor.props.filter(p => !isObjectTile(floor.tiles[p.y * W + p.x]) || (parts && p.part));
}

/** W60: one light family per room (the one it has most of), then no two fixtures touching. */
export function lightRules(floor, rooms) {
  const family = id => props.rows[id]?.lightFamily ?? null;   // props.json lightFamily: brazier, torch, candle, campfire
  const drop = new Set();
  for (const r of rooms) {
    const inR = floor.props.filter(p => !p.keep && family(p.id) && p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h);
    if (inR.length < 2) continue;
    const n = {};
    for (const p of inR) n[family(p.id)] = (n[family(p.id)] ?? 0) + 1;
    const keep = Object.keys(n).reduce((a, f) => (n[f] > n[a] ? f : a));
    for (const p of inR) if (family(p.id) !== keep) drop.add(p);
  }
  const lights = floor.props.filter(p => family(p.id) && !drop.has(p));
  for (const p of lights) for (const q of lights) if (p !== q && !q.keep && !drop.has(p) && !drop.has(q) && Math.max(Math.abs(p.x - q.x), Math.abs(p.y - q.y)) <= 1) drop.add(q);
  floor.props = floor.props.filter(p => !drop.has(p));
}

function edgeOf(r) {
  const out = [];
  for (let x = r.x; x < r.x + r.w; x++) out.push({ x, y: r.y }, { x, y: r.y + r.h - 1 });
  for (let y = r.y + 1; y < r.y + r.h - 1; y++) out.push({ x: r.x, y }, { x: r.x + r.w - 1, y });
  return out;
}

/**
 * Props 49 (1.7 propsKeepOpen): a decorative blocking prop that cuts a target (stairs or gate, Forge, shrine, a
 * pocket's way in) off from the arrival moves to a free edge cell of its room that restores the way, else goes.
 */
export function keepRoutesOpen(rng, floor, rooms, grid, start, targets) {
  const deco = p => propSolid(p) && !p.keep && p.id !== 'bush';
  const solid = () => propMask(floor, p => propSolid(p));
  const reach = () => { const d = reachFrom(floor, start, solid()); return targets.every(t => d[t.y * floor.w + t.x] >= 0 || D4.some(([dx, dy]) => d[(t.y + dy) * floor.w + t.x + dx] >= 0)); };
  for (let n = 0; n <= floor.props.length && !reach(); n++) {
    const culprits = floor.props.filter(deco);
    if (!culprits.length) return;
    culprits.sort((a, b) => Math.abs(a.x - start.x) + Math.abs(a.y - start.y) - (Math.abs(b.x - start.x) + Math.abs(b.y - start.y)));
    const p = culprits.find(c => { floor.props.splice(floor.props.indexOf(c), 1); const ok = reach(); floor.props.push(c); return ok; }) ?? culprits[0];
    // A set piece (a tall cave piece, 1.7 cavePlace keep:false) goes whole: moving one tile of it would tear its art.
    if (p.part || p.w > 1 || p.h > 1) { const gone = new Set(piecesOf(floor, p)); floor.props = floor.props.filter(q => !gone.has(q)); continue; }
    floor.props.splice(floor.props.indexOf(p), 1);
    const room = rooms[grid[p.y * floor.w + p.x]];
    if (!room) continue;
    const cells = shuffled(rng, edgeOf(room).filter(c => floor.tiles[c.y * floor.w + c.x] === T.FLOOR && !floor.ground[c.y * floor.w + c.x] && !nearDoor(floor, grid, c.x, c.y) && !floor.props.some(q => q.x === c.x && q.y === c.y)));
    for (const c of cells) { floor.props.push({ ...p, x: c.x, y: c.y }); if (reach()) break; floor.props.pop(); }
  }
}

/**
 * Floor rings and amulets (loot.json floor-trinkets, 1.7 placeGeneratedTrinkets): each biome hides 2 rings and
 * 1 amulet on its first four floors, the floors picked from the run seed; spots on the floor's own side stream.
 */
export function placeTrinkets(floor, rooms, floorNo, floorSeed, runSeed, taken, run = {}) {
  const R = loot.rows['floor-trinkets'], biome = biomeIndex(floorNo);
  if (isBossFloor(floorNo) || runSeed == null) return;
  const pr = stream((runSeed ^ (0x51ed + biome * 977)) >>> 0), floorsOf = () => biome * 5 + 1 + Math.floor(next(pr) * 4);
  const plan = { ring: Array.from({ length: R.perBiome.rings }, floorsOf), amulet: Array.from({ length: R.perBiome.amulets }, floorsOf) };
  const r = stream((floorSeed ^ 0x7a11) >>> 0), gen = { rng: r, floorNo, seed: runSeed, run, unbuilt: {} };   // rings and amulets: no Masterwork reroll
  const spot = () => {
    for (let t = 0; t < 200; t++) {
      const rm = pick(r, rooms);
      if (!rm || rm.role === 'start') continue;
      const x = rm.x + Math.floor(next(r) * rm.w), y = rm.y + Math.floor(next(r) * rm.h);
      if (freeCell(floor, occupied(floor, taken), x, y)) return { x, y };
    }
    return null;
  };
  for (const kind of ['ring', 'amulet']) for (const f of plan[kind]) {
    if (f !== floorNo) continue;
    const s = spot(); if (!s) continue;
    // Rings and amulets are made by the items rules (rings.json, amulets.json make); until they are, giveOf records them.
    for (const it of giveOf(gen, { [kind]: 'random', cursedPct: R.cursedPct }, floorNo)) floor.items.push({ x: s.x, y: s.y, item: it });
  }
}

/** Planes 7-19 (Justin 10-15, ruling 7): a portal biome's portal floor gets its plane's portal, one rule for both biomes. */
export function planePortal(floor, floorNo, runSeed, creatures) {
  const pp = runSeed != null && planPortals(runSeed)[biomeIndex(floorNo)];
  if (pp && pp.floor === floorNo && !floor.boss && !floor.portal) placePortal(floor, floor.rooms ?? [], floor.arrival, pp.plane, creatures);
}

/** Grass kept in a garden may sit under a later chest or the up stairs: it grows on plain floor only. Then the floor's
 *  layers as plain arrays, as the game keeps them. */
export function settleLayers(floor) {
  for (let k = 0; k < floor.ground.length; k++) if ((floor.ground[k] === G.GRASS || floor.ground[k] === G.SHORT) && floor.tiles[k] !== T.FLOOR) floor.ground[k] = 0;
  floor.tiles = Array.from(floor.tiles);
  floor.ground = Array.from(floor.ground);
}

/**
 * Sandbox 94 (Justin 2026-10-17: "weird stuff is placed in walls"): the last word on a finished floor. A freestanding
 * prop left on a wall cell (a later pass walled its cell in, as a garden or a puzzle room closes) is taken away;
 * wall-mounted pieces (props.json wallMounted, or a prop marked wall: the Crypt's plaques, niches, cobwebs, roots)
 * and the parts of a wide piece stay.
 */
export function offWalls(floor) {
  if (!floor?.props) return;
  const wallAt = (x, y) => { const t = floor.tiles[y * floor.w + x]; return t === T.WALL || t === T.SECRET; };
  floor.props = floor.props.filter(p => !wallAt(p.x, p.y) || p.wall || p.part || props.rows[p.id]?.wallMounted);
}

/**
 * Justin 2026-10-17 ("items to be picked up drawn under a map object?"): no loot lies on a prop's tile, where it hides
 * under scenery or behind a blocker the hero cannot step past. It moves to the nearest free floor tile reached on foot
 * (a hoard frozen in ice is meant to lie under its block). Runs last, after every placer and dresser.
 */
export function itemsOffProps(floor) {
  if (!floor?.items?.length || !floor.props?.length) return;
  const W = floor.w, H = floor.h, key = (x, y) => y * W + x;
  const prop = new Set(floor.props.map(p => key(p.x, p.y))), hoard = new Set(floor.props.filter(p => p.hoard || p.crystalVault).map(p => key(p.x, p.y)));   // a vault crystal stands over its treasure (rule 55)
  const taken = new Set(floor.items.map(i => key(i.x, i.y)));
  const open = (x, y) => x >= 0 && y >= 0 && x < W && y < H && floor.tiles[key(x, y)] !== T.WALL && floor.tiles[key(x, y)] !== T.SECRET;
  const free = (x, y) => open(x, y) && floor.tiles[key(x, y)] === T.FLOOR && !prop.has(key(x, y)) && !taken.has(key(x, y));
  for (const i of floor.items) {
    const k = key(i.x, i.y);
    if (!prop.has(k) || hoard.has(k)) continue;
    const spot = nearest(W, H, k, n => open(n % W, (n / W) | 0), n => free(n % W, (n / W) | 0), { maxDepth: 8 });
    if (spot >= 0) { i.x = spot % W; i.y = (spot / W) | 0; taken.add(spot); }
  }
}
