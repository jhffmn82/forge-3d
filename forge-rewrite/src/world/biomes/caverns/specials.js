// The Caverns' special rooms (spec/world.md W32-W35, Caverns 103; rooms.json flooded-cache, survey-camp,
// myconid-nursery, beetle-nest, crystal-resonance, merchant): 1.7's specials roll with the cave pool
// (js/world/world.js:361-399 @3c8b312), the cave rooms built on a chamber's own cells (buildCavernCacheRoom,
// buildSurveyCamp), and the shared rooms built by src/world/specials.js's builders. The merchant's floor is drawn
// from the run seed as 1.7 does (cavernMerchantFloor).

import rooms from '../../../../data/rooms.json' with { type: 'json' };
import props from '../../../../data/props.json' with { type: 'json' };
import { stream, next, pick, weighted } from '../../../lib/rng.js';
import { T, G } from '../../../data/tiles.js';
import { BUILD_ROOMS, BUILT_SPECIALS, specialsPool } from '../../specials.js';
import { roomCells, MW } from './layout.js';
import { nearDoor } from './scenery.js';
import { makeCreature } from '../../../rules/monsters.js';
import { uniqueRareKind, forcedKind, forcedBuilt } from '../../rare.js';
import { D4 } from '../../../lib/geometry.js';
import { distanceField } from '../../../lib/grid.js';
import { propBlocks } from '../../../data/props.js';
import floors from '../../../../data/floors.json' with { type: 'json' };

const R = rooms.rows;
const ZOO_FAMILY = new Set(floors.rows['specials-count'].onceFamilies.zoo);
const CAVE_BUILT = new Set(['flooded-cache', 'survey-camp', 'myconid-nursery', 'beetle-nest', 'crystal-resonance']);

/** 1.7 cavernMerchantFloor: 30% of runs, one floor of 11-14, from the run seed's own stream. */
export function merchantFloor(runSeed) {
  if (runSeed == null) return -1;
  const ev = stream((runSeed ^ 0x4D455243) >>> 0);
  return next(ev) < R.merchant.chancePctPerRun / 100 ? 11 + Math.floor(next(ev) * 4) : -1;
}

/** A chamber's plan: its free floor cells, the mouths (cells beside open ground of another place), and depth. */
function plan(floor, grid, r) {
  const at = (x, y) => floor.tiles[y * MW + x];
  const blocked = (x, y) => floor.props.some(p => p.x === x && p.y === y && propBlocks(p));
  const own = (x, y) => r.cave ? grid[y * MW + x] === r.id : x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
  const cells = (r.cave ? roomCells(grid, r) : [...Array(r.w * r.h)].map((_, i) => ({ x: r.x + (i % r.w), y: r.y + Math.floor(i / r.w) })))
    .filter(c => at(c.x, c.y) === T.FLOOR && !blocked(c.x, c.y));
  const opened = t => t !== T.WALL && t !== T.SECRET;
  const mouths = cells.filter(c => D4.some(([dx, dy]) => !own(c.x + dx, c.y + dy) && opened(at(c.x + dx, c.y + dy))));
  const depth = c => mouths.length ? Math.min(...mouths.map(m => Math.abs(m.x - c.x) + Math.abs(m.y - c.y))) : 0;
  return { cells, mouths, depth };
}
const freeAt = (floor, c) => floor.tiles[c.y * MW + c.x] === T.FLOOR && !floor.props.some(p => p.x === c.x && p.y === c.y) && !floor.items.some(i => i.x === c.x && i.y === c.y);

/** buildCavernCacheRoom: a gold chest on the deepest free cell, its ambush, and the room's water, crates, mushrooms or rubble. */
function cacheRoom(gen, floor, grid, r, kind, floorNo) {
  const pl = plan(floor, grid, r), cells = pl.cells.filter(c => freeAt(floor, c)).sort((a, b) => pl.depth(b) - pl.depth(a)), chest = cells[0];
  if (!chest) return false;
  const reserved = new Set([chest.y * MW + chest.x]);
  floor.tiles[chest.y * MW + chest.x] = T.CHEST;
  const count = Math.min(9, 3 + floorNo + Math.floor(r.w * r.h / 16), pl.cells.length);
  const kinds = kind === 'flooded-cache' ? R['flooded-cache'].ambush.roster.slice()
    : kind === 'beetle-nest' ? Array(count).fill('stormbeetle') : Array.from({ length: count }, (_, i) => (i % 3 === 2 ? 'shroomling' : 'myconid'));
  floor.chests.push({ x: chest.x, y: chest.y, kind: 'gold', art: 'chest-gold', ambush: { kinds, log: R[kind].ambush.log, planeBehaviour: !!R[kind].ambush.planeBehaviour } });
  r.chestAmbush = true;
  if (kind === 'flooded-cache') {
    for (const c of pl.cells) if (freeAt(floor, c) && !reserved.has(c.y * MW + c.x) && !nearDoor(floor, grid, c.x, c.y)) { floor.tiles[c.y * MW + c.x] = T.WATER; floor.ground[c.y * MW + c.x] = 0; }
    for (const c of cells) if (floor.tiles[c.y * MW + c.x] === T.FLOOR && pl.depth(c) > 2 && freeAt(floor, c) && !nearDoor(floor, grid, c.x, c.y)) floor.props.push({ id: 'kobold-crate', x: c.x, y: c.y });
  } else {
    let placed = 0;
    for (const c of cells) {
      if (placed < 3 && c !== chest && freeAt(floor, c) && !nearDoor(floor, grid, c.x, c.y)) { floor.props.push({ id: kind === 'myconid-nursery' ? 'cl-small-mushrooms-' + (1 + Math.floor(next(gen.rng) * 4)) : 'cl-rubble-' + (1 + Math.floor(next(gen.rng) * 4)), x: c.x, y: c.y }); placed++; }
      if (floor.tiles[c.y * MW + c.x] === T.FLOOR && !floor.props.some(p => p.x === c.x && p.y === c.y)) floor.ground[c.y * MW + c.x] = kind === 'myconid-nursery' ? G.GRASS : G.BONES;
    }
  }
  return true;
}

/** buildSurveyCamp: a supply crate on the deepest cell and the camp's kept pieces. */
function surveyCamp(floor, grid, r) {
  const pl = plan(floor, grid, r), cells = pl.cells.filter(c => freeAt(floor, c)).sort((a, b) => pl.depth(b) - pl.depth(a));
  if (!cells.length) return false;
  const chest = cells.shift();
  floor.tiles[chest.y * MW + chest.x] = T.CHEST;
  floor.chests.push({ x: chest.x, y: chest.y, kind: 'crate-supply', table: 'camp-survey' });
  r.rareEvent = true;
  for (const id of R['survey-camp'].layout.props) {
    const c = cells.find(q => freeAt(floor, q) && !nearDoor(floor, grid, q.x, q.y));
    if (c) floor.props.push({ id, x: c.x, y: c.y, keep: true });
  }
  return true;
}

/** Crystal resonance: the resonance crystal at the chamber's centre (its touch: rooms.json crystal-resonance). */
function resonance(floor, grid, r) {
  const pl = plan(floor, grid, r), c = pl.cells.filter(q => freeAt(floor, q) && !nearDoor(floor, grid, q.x, q.y)).sort((a, b) => pl.depth(b) - pl.depth(a))[0];
  if (!c) return false;
  floor.props.push({ id: 'resonance-crystal', x: c.x, y: c.y, keep: true, resonance: true });
  return true;
}

/**
 * S41, rule 73 (1.7 buildUniqueRareRoom 'sealed-lamp'): the Sealed Magic Lamp on the chamber's deepest free cell. The
 * lamp keeps the chamber's cells clear of its doors and mouths, where picking it up may free its Prism Seer
 * (rules/caverns-rare.js).
 */
function sealedLamp(floor, grid, r) {
  const pl = plan(floor, grid, r), c = pl.cells.filter(q => freeAt(floor, q)).sort((a, b) => pl.depth(b) - pl.depth(a))[0];
  if (!c) return false;
  r.rareEvent = true;
  const cells = pl.cells.filter(q => !nearDoor(floor, grid, q.x, q.y)).map(q => ({ x: q.x, y: q.y }));
  floor.items.push({ x: c.x, y: c.y, item: { kind: 'relic', id: 'sealed-lamp', name: R['sealed-lamp'].layout.relic.name }, lamp: { cells } });
  return true;
}

/**
 * S24, 1.7 buildMerchantCamp: the stall and the vendor's post are two touching deep free cells (not by a door) whose
 * loss leaves the rest of the chamber joined, with an open cell beside the stall to buy from; a candle table on the
 * stall, the Myconid Merchant on the post (neutral, an object, no XP or loot), the way from the chamber's hub to the
 * buying cell reserved with the post (r.merchantRoutes), then a campfire, a crate and mushrooms on the deepest
 * unreserved cells that keep the chamber joined. The stock is rolled when the stall is first visited
 * (rules/caverns.js). No room for a stall: the chamber becomes storage, as in 1.7.
 */
function merchantCamp(gen, floor, grid, r, out) {
  const pl = plan(floor, grid, r), key = c => c.y * MW + c.x, cheb = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
  const hub = pl.mouths[0] ?? pl.cells[0], open = new Set(pl.cells.map(key));
  /** 1.7 specialRoomPlan route: the 4-way path over the chamber's open cells from the hub to `to`, round `avoid`. */
  const route = (to, avoid = new Set()) => {
    if (!hub || !to) return [];
    const prev = new Map([[key(hub), null]]), t = key(to);
    distanceField(MW, floor.h, key(hub), k => open.has(k) && (!avoid.has(k) || k === t), { visit: (n, c) => prev.set(n, c) });
    const path = [];
    for (let k = prev.has(t) ? t : null; k != null; k = prev.get(k)) path.push(k);
    return path;
  };
  // 1.7 specialRoomPlan: the ways from the hub to every mouth are reserved first; the stall and post keep off them.
  const reserved = new Set(pl.mouths.flatMap(m => route(m)));
  const cells = pl.cells.filter(c => freeAt(floor, c) && !nearDoor(floor, grid, c.x, c.y) && !reserved.has(key(c))).sort((a, b) => pl.depth(b) - pl.depth(a));
  /** Are all the chamber's open cells but `gone` still joined to the hub (4-way)? */
  const joined = gone => {
    const open = new Set(pl.cells.map(key).filter(k => !gone.has(k)));
    if (!hub || gone.has(key(hub))) return false;
    return distanceField(MW, floor.h, key(hub), k => open.has(k)).filter(d => d >= 0).length === open.size;
  };
  let stall = null, vendor = null, approach = null;
  for (let n = 0; n < cells.length && !stall; n++) for (let j = 0; j < cells.length && !stall; j++) {
    if (cheb(cells[n], cells[j]) !== 1 || !joined(new Set([key(cells[n]), key(cells[j])]))) continue;
    const a = pl.cells.find(c => cheb(c, cells[n]) === 1 && cheb(c, cells[j]) > 0 && freeAt(floor, c));
    if (a) { stall = cells[n]; vendor = cells[j]; approach = a; }
  }
  if (!stall) { r.special = 'storage'; return BUILD_ROOMS.storage ? BUILD_ROOMS.storage(gen, floor, r, sharedPlan(floor, grid, r), out) !== false : false; }
  floor.props.push({ id: 'table-candle', x: stall.x, y: stall.y, keep: true, merchant: true });
  r.role = 'merchant';
  floor.merchant = { stall: { x: stall.x, y: stall.y }, post: { x: vendor.x, y: vendor.y }, stock: null };
  const gone = new Set([key(stall), key(vendor)]);
  // 1.7 plan.path(hub, approach) round the stall and the post, and the post itself, are reserved and published
  // (r.merchantRoutes, r.storageAisle in 1.7): no camp furniture or trap takes the way in to buy.
  for (const k of route(approach, gone)) reserved.add(k);
  reserved.add(key(vendor));
  r.merchantRoutes = [...reserved];
  floor.merchant.routes = r.merchantRoutes;
  r.bypass = new Set(reserved);
  let placed = 0;
  for (const c of cells) {
    if (placed >= 3) break;
    if (gone.has(key(c)) || reserved.has(key(c)) || !freeAt(floor, c) || !joined(new Set([...gone, key(c)]))) continue;
    floor.props.push({ id: ['kobold-campfire', 'kobold-crate', 'mushrooms'][placed], x: c.x, y: c.y, keep: true });
    gone.add(key(c)); placed++;
  }
  const m = makeCreature('myconid', vendor.x, vendor.y);
  Object.assign(m, { name: 'Myconid Merchant', side: 'neutral', asleep: false, hunting: false, resident: true, noXp: true, drops: 'kill-none', noLoot: true, merchant: true,
    flags: [...(m.flags ?? []), 'object'], look: { ...m.look, sheet: 'mob-m-myconid-merchant' } });
  out.push(m);
  return true;
}

/**
 * W32-W35 in the Caverns: 1 special on the boss floor, else 2-3; one zoo-family room a floor; the merchant's floor
 * puts the merchant first. Returns the bodies the shared rooms place.
 */
export function buildCaveSpecials(gen, floor, roomsList, grid, floorNo, { boss, runSeed, carvePocket }) {
  const rng = gen.rng, out = [], skipped = new Set(), BUILD = BUILD_ROOMS;
  const specials = specialsPool(floorNo, boss);   // the one pool (world/specials.js, rooms.json)
  const n = boss ? 1 : 2 + (next(rng) < 0.5 ? 1 : 0);
  let zooDone = false;
  for (let i = 0; i < n; i++) {
    const pool = specials.filter(s => !(ZOO_FAMILY.has(s[0]) && zooDone));
    let chosen = weighted(rng, pool, s => s[3], { edge: 'le' });
    if (i === 0 && !boss && merchantFloor(runSeed) === floorNo) chosen = ['merchant', 11, 25, 1];
    // R6, rule 68: a unique rare room due on this floor (Volatile Hoard, Sealed Lamp) replaces the first pick (1.7 world.js:392).
    const rare = i === 0 && !boss && uniqueRareKind(runSeed, floorNo);
    if (rare) chosen = [rare, 1, 25, 1];
    const forced = i === 0 && forcedKind(gen, 'special');   // the sandbox's room preview
    if (forced) chosen = [forced, 1, 25, 1];
    const hosts = roomsList.filter(r => !r.pocket && !r.role && !r.special && r.w * r.h >= chosen[2] && !(chosen[0] === 'greedy-vault' && (r.cave || r.w !== r.h || r.w < 7)));
    if (!hosts.length) continue;
    const host = pick(rng, hosts), kind = chosen[0];
    if (ZOO_FAMILY.has(kind)) zooDone = true;
    host.special = kind;
    let ok;
    if (kind === 'flooded-cache' || kind === 'myconid-nursery' || kind === 'beetle-nest') ok = cacheRoom(gen, floor, grid, host, kind, floorNo);
    else if (kind === 'survey-camp') ok = surveyCamp(floor, grid, host);
    else if (kind === 'crystal-resonance') ok = resonance(floor, grid, host);
    else if (kind === 'merchant') ok = merchantCamp(gen, floor, grid, host, out);
    else if (kind === 'sealed-lamp') ok = sealedLamp(floor, grid, host);
    else if (BUILD[kind] && !CAVE_BUILT.has(kind) && kind !== 'zoo' && kind !== 'portcullis-cache' && BUILT_SPECIALS.has(kind)) ok = BUILD[kind](gen, floor, host, sharedPlan(floor, grid, host), out) !== false;
    else { skipped.add(kind); ok = false; }
    if (!ok) host.special = null;
    else if (forced) forcedBuilt(gen);
  }
  floor.specialsSkipped = [...skipped];
  return out;
}

/** The shared builders' plan (specials.js P1-P5) on a chamber's own cells. */
function sharedPlan(floor, grid, r) {
  const key = (x, y) => `${x},${y}`, pl = plan(floor, grid, r);
  const hub = pl.mouths[0] ?? pl.cells[0];
  const inside = r.cave ? (x, y) => grid[y * MW + x] === r.id : (x, y) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
  const depth = c => pl.mouths.length ? pl.depth(c) : Math.max(Math.abs(hub.x - c.x), Math.abs(hub.y - c.y));
  return { cells: pl.cells, mouths: pl.mouths, hub, depth, inside, cellSet: new Set(pl.cells.map(c => key(c.x, c.y))), reserved: new Set(), w: MW, h: floor.h };
}
