// Special rooms (spec/world.md W32-W36, "The specials roll" 1-16, P1-P7, S1-S23, S31-S33). Every Dungeon kind is built;
// a kind no builder knows is named in floor.specialsSkipped. Draws only from the generation stream (the sword in the
// stone's floor from its own run stream, src/world/rare.js). Freeing a prisoner and breaking the stone are play rules.

import rooms from '../../data/rooms.json' with { type: 'json' };
import floors from '../../data/floors.json' with { type: 'json' };
import traps from '../../data/traps.json' with { type: 'json' };
import props from '../../data/props.json' with { type: 'json' };
import { next, roll, shuffle, pick, weighted } from '../lib/rng.js';
import { makeCreature } from '../rules/monsters.js';
import { rollTable, randomGear } from '../rules/loot.js';
import { T, G } from '../data/tiles.js';
import { flood } from './layout.js';
import sigils from '../../data/sigils.json' with { type: 'json' };
import { blob, distanceField, components } from '../lib/grid.js';
import { hooksFor } from './biomes/registry.js';
import { makeItem } from '../rules/items.js';
import { swordStoneFloor, uniqueRareKind, forcedKind, forcedBuilt } from './rare.js';
import { consecrated } from './fields.js';
import { cheb as dist, D4 } from '../lib/geometry.js';
import { propSolid, propBlocks } from '../data/props.js';
import { BIOMES, biomeIndex, isBossFloor } from '../data/schedule.js';
import { rosterRows } from '../data/roster.js';
import { gradeSigil } from './sigil-grade.js';
import { facesWall } from './dress.js';

const R = rooms.rows, F = floors.rows, P = props.rows;
/** 1.7 ELEMENTAL_ROOM_KINDS key order (cavernmobs.js:77), which is the order the roll lists them. */
const ELEMENTAL = ['fire', 'water', 'air', 'earth', 'shadow', 'light'];
const BUILT = new Set(['library', 'garden', 'storage', 'nest', 'armory', 'statues', 'treasury', 'barracks', 'dark', 'traps', 'zoo', 'sacrifice', 'adventurer-camp', 'ruined-treasury', 'bone-vault', 'goblin-mine', 'greedy-vault', 'portcullis-cache', 'prison', 'sword-in-stone', 'volatile-hoard', 'drider-lair', 'dark-wizard-library', ...ELEMENTAL.map(e => 'elemental-' + e)]);
const key = (x, y) => `${x},${y}`;
/** 1.7 dist (geometry.js bodyDistance for one-tile bodies): the larger of the two axis steps. */

/** W34, rules 1-10, one pool for every biome (consolidation W2) from rooms.json: rows with a weight naming the biome, from
 *  minFloor (or minFloorInBiome) to maxFloor; bossOk only on a boss floor (ruling 10); the gentle cut (exclude.floors);
 *  `replaces` (ruling 12); classic: false off 1.7's floor. Entries [kind, minFloor, minArea, weight], rooms.json order. */
export function specialsPool(floorNo, boss, classic = false) {
  const bi = Math.min(3, biomeIndex(floorNo)), biome = BIOMES[bi], out = [];   // floors past the Underdark take its pool
  for (const [kind, r] of Object.entries(R)) {
    if (!r.weight || !r.biomes?.includes(biome) || (classic && r.classic === false)) continue;
    const min = r.minFloor ?? bi * 5 + (r.minFloorInBiome ?? 1);
    if (floorNo < min || floorNo > (r.maxFloor ?? 25) || (boss && r.bossOk !== true) || r.exclude?.floors?.includes(floorNo)) continue;
    out.push([kind, min, r.minArea, r.weight]);
  }
  const replaced = new Set(out.map(([k]) => R[k].replaces).filter(Boolean));
  return out.filter(([k]) => !replaced.has(k));
}

/** P1-P5: a room's plan cells, mouths, hub and cell depths. */
function plan(floor, r) {
  const W = floor.w, inside = (x, y) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
  const blocked = (x, y) => floor.props.some(p => p.x === x && p.y === y && propBlocks(p));
  const all = [];
  for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) if (floor.tiles[y * W + x] === T.FLOOR && !blocked(x, y)) all.push({ x, y });
  // P1: the largest 4-connected group.
  const set = new Set(all.map(c => c.y * W + c.x)), { sizes, lists } = components(W, floor.h, k => set.has(k), { lists: true, stack: true });
  const cells = (lists[sizes.indexOf(Math.max(0, ...sizes))] ?? []).map(k => ({ x: k % W, y: (k / W) | 0 }));
  const walkOrDoor = t => [T.FLOOR, T.DOOR, T.OPEN_DOOR, T.LOCKED, T.TOLL, T.SECRET, T.WATER].includes(t);
  const mouths = cells.filter(c => D4.some(([dx, dy]) => !inside(c.x + dx, c.y + dy) && walkOrDoor(floor.tiles[(c.y + dy) * W + c.x + dx])));
  const hub = mouths[0] ?? cells[0];
  const depth = c => mouths.length ? Math.min(...mouths.map(m => Math.abs(m.x - c.x) + Math.abs(m.y - c.y))) : Math.max(Math.abs(hub.x - c.x), Math.abs(hub.y - c.y));
  return { cells, mouths, hub, depth, inside, cellSet: new Set(cells.map(c => key(c.x, c.y))), reserved: new Set(), w: W, h: floor.h };
}

/** P3: reserve the cheapest path between two cells (perimeter: 6 a step off the edge, so it hugs the walls). */
function reservePath(pl, r, from, to, perimeter = false) {
  if (!from || !to) return;
  const edge = c => c.x === r.x || c.y === r.y || c.x === r.x + r.w - 1 || c.y === r.y + r.h - 1;
  const dist = new Map([[key(from.x, from.y), 0]]), prev = new Map(), open = [from];
  while (open.length) {
    open.sort((a, b) => dist.get(key(a.x, a.y)) - dist.get(key(b.x, b.y)));
    const c = open.shift();
    if (c.x === to.x && c.y === to.y) break;
    for (const [dx, dy] of D4) {
      const n = { x: c.x + dx, y: c.y + dy }, k = key(n.x, n.y);
      if (!pl.cellSet.has(k)) continue;
      const cost = dist.get(key(c.x, c.y)) + (perimeter && !edge(n) ? 6 : 1);
      if (cost < (dist.get(k) ?? Infinity)) { dist.set(k, cost); prev.set(k, c); open.push(n); }
    }
  }
  let c = to;
  while (c) { pl.reserved.add(key(c.x, c.y)); c = prev.get(key(c.x, c.y)); }
}

const besideDoor = (floor, c) => D4.some(([dx, dy]) => [T.DOOR, T.OPEN_DOOR].includes(floor.tiles[(c.y + dy) * floor.w + c.x + dx]));
const occupied = (floor, c) => floor.props.some(p => p.x === c.x && p.y === c.y) || floor.items.some(i => i.x === c.x && i.y === c.y) || floor.chests.some(h => h.x === c.x && h.y === c.y);
const freeCells = (floor, pl) => pl.cells.filter(c => !pl.reserved.has(key(c.x, c.y)) && !occupied(floor, c) && floor.tiles[c.y * floor.w + c.x] === T.FLOOR);
const deepest = (pl, cells) => cells.slice().sort((a, b) => pl.depth(b) - pl.depth(a));

/** P4: a blocking prop goes down only if every open cell reachable before stays reachable (and a face-on one never on
 *  the south wall, facesWall). */
function placeBlocking(floor, pl, c, id) {
  if (facesWall(floor, id, c.x, c.y)) return false;
  const before = reachCount(floor, pl);
  floor.props.push({ id, x: c.x, y: c.y });
  if (reachCount(floor, pl) < before - 1) { floor.props.pop(); return false; }
  pl.cellSet.delete(key(c.x, c.y));
  return true;
}
function reachCount(floor, pl) {
  const ok = c => pl.cellSet.has(key(c.x, c.y)) && !floor.props.some(p => p.x === c.x && p.y === c.y && propBlocks(p));
  return pl.hub && ok(pl.hub) ? walkField(pl, pl.hub, ok).filter(d => d >= 0).length : 0;
}

const chest = (floor, c, kind, extra = {}) => { floor.tiles[c.y * floor.w + c.x] = T.CHEST; floor.chests.push({ x: c.x, y: c.y, kind, ...extra }); };
const item = (floor, c, it) => floor.items.push({ x: c.x, y: c.y, item: it });
const essence = (rng, lo, hi, floorNo = 0) => ({ kind: 'essence', n: roll(rng, lo, hi) + floorNo });
/** Ground paint that never covers a hidden door's tell (W29). */
const paint = (floor, c, g) => { if (floor.ground[c.y * floor.w + c.x] !== G.TELL) floor.ground[c.y * floor.w + c.x] = g; };

/** P6: a named room's population, clamp(floor(w*h/6), min, max). */
const population = (r, lo, hi) => Math.max(lo, Math.min(hi, Math.floor(r.w * r.h / 6)));

/** Residents asleep on posts nearest a focus (P6). */
function residents(floor, pl, kinds, focus, out, { guard = false } = {}) {
  const posts = pl.cells.filter(c => !besideDoor(floor, c) && !occupied(floor, c) && floor.tiles[c.y * floor.w + c.x] === T.FLOOR && !out.some(m => m.x === c.x && m.y === c.y))
    .sort((a, b) => dist(a, focus) - dist(b, focus));
  kinds.forEach((k, i) => { const c = posts[i]; if (!c) return; const m = makeCreature(k, c.x, c.y, { asleep: true }); m.resident = true; if (guard) m.guard = true; out.push(m); });
}

/** A roster draw for the floor, no packs (rollMonster). */
function rollMonster(rng, floorNo) {
  const rows = rosterRows(floorNo);
  return rows.length ? weighted(rng, rows).creature : 'goblin';   // goblin: a biome whose roster is not written yet
}

const BUILD = {
  garden(gen, floor, r, pl) {   // S1
    const rng = gen.rng, free = freeCells(floor, pl), pond = deepest(pl, free)[0];
    if (pond) { floor.tiles[pond.y * floor.w + pond.x] = T.WATER; paint(floor, pond, 0); }
    if (next(rng) < 0.5) {
      const near = free.filter(c => c !== pond).sort((a, b) => (pond ? dist(a, pond) : -pl.depth(a)) - (pond ? dist(b, pond) : -pl.depth(b)))[0];
      if (near) { for (const d of rollTable(gen, 'food-drop', gen.floorNo)) item(floor, near, d); pl.reserved.add(key(near.x, near.y)); }
    }
    for (const c of pl.cells) if (!pl.reserved.has(key(c.x, c.y)) && floor.tiles[c.y * floor.w + c.x] === T.FLOOR && (!pond || dist(c, pond) <= 3) && next(rng) < 0.65) paint(floor, c, G.GRASS);
    // 2-4 pieces from mushrooms, vines, ... nearest the pond. In the Dungeon a mushroom becomes a patch of grass (60%)
    // or moss and is never counted as placed, so 1.7 tries every cell in turn and the garden fills with growth and no
    // props (world.js:1201 with content-adapter.js:59-62 @3c8b312). That is the garden 1.7 shows; kept.
    roll(rng, 2, 4);
    const doorish = new Set([T.DOOR, T.OPEN_DOOR, T.LOCKED, T.TOLL, T.SECRET, T.SEALED]);
    const nearDoor = c => { for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (doorish.has(floor.tiles[(c.y + dy) * floor.w + c.x + dx])) return true; return D4.some(([dx, dy]) => !pl.inside(c.x + dx, c.y + dy) && floor.tiles[(c.y + dy) * floor.w + c.x + dx] === T.FLOOR); };
    const W = floor.w, propAt = (x, y) => floor.props.some(q => q.x === x && q.y === y);
    for (const c of pl.cells.slice().sort((a, b) => pond ? dist(a, pond) - dist(b, pond) : pl.depth(b) - pl.depth(a))) {
      if (pl.reserved.has(key(c.x, c.y)) || occupied(floor, c) || floor.tiles[c.y * W + c.x] !== T.FLOOR || nearDoor(c)) continue;
      const kind = next(rng) < 0.6 ? G.GRASS : G.MOSS;
      blob(() => next(rng), floor.w, floor.h, c.x, c.y, roll(rng, 3, 8), (x, y) => { if (floor.tiles[y * W + x] === T.FLOOR && !floor.ground[y * W + x] && !propAt(x, y)) floor.ground[y * W + x] = kind; });
    }
    r.garden = true;
  },
  library(gen, floor, r, pl) {   // S3-S4
    const rng = gen.rng, L = R.library, S = sigils.rows, G7 = S.groups;
    const theme = ['elemental', 'holy', 'explorer', 'forbidden'][Math.floor(next(rng) * 4)], T7 = L.themes[theme];
    const element = theme === 'elemental' ? ['fire', 'water', 'air', 'earth', 'light', 'shadow'][Math.floor(next(rng) * 6)] : null;
    const cells = freeCells(floor, pl);
    if (!cells.length) return false;
    const mid = { x: r.x + (r.w - 1) / 2, y: r.y + (r.h - 1) / 2 };
    const hub = cells.slice().sort((a, b) => Math.hypot(a.x - mid.x, a.y - mid.y) - Math.hypot(b.x - mid.x, b.y - mid.y))[0];
    pl.hub = hub;
    for (const c of pl.cells) if (dist(c, hub) <= 1) pl.reserved.add(key(c.x, c.y));
    for (const m of pl.mouths) reservePath(pl, r, m, hub);
    // S4: the first sigil by grade from the theme's pool (with the element when there is one).
    const exists = id => S[id]?.kind === 'sigil';
    const pool = T7.sigils.filter(id => exists(id) && (!element || S[id].motes?.includes(element)));
    const pool2 = pool.length ? pool : T7.sigils.filter(exists);
    const first = gradeSigil(rng, pool2);
    // the second: a different sigil of two or more motes from the theme list with the element, else any such sigil
    const twoPlus = id => exists(id) && (S[id].motes?.length ?? 0) >= 2 && id !== first;
    let second = T7.sigils.filter(id => twoPlus(id) && (!element || S[id].motes.includes(element)));
    if (!second.length) second = Object.keys(S).filter(twoPlus);
    const rewards = [{ kind: 'sigil', id: first, count: 1 }];
    if (second.length) rewards.push({ kind: 'sigil', id: pick(rng, second), count: 1 });
    rewards.push(randomGear(gen, gen.floorNo, { item: 'tome' }));
    if (next(rng) < 0.4) rewards.push({ kind: 'mote', el: element ?? pick(rng, T7.motes) });
    const far = freeCells(floor, pl).sort((a, b) => dist(b, hub) - dist(a, hub));
    rewards.forEach((it, i) => { const c = far[i]; if (c) { item(floor, c, it); pl.reserved.add(key(c.x, c.y)); } });
    // shelves on every third row, top-left order; a candle table near the hub
    const most = Math.min(10, Math.max(4, Math.floor((r.w + r.h) / 2)));
    let shelves = 0;
    for (const c of freeCells(floor, pl).filter(c => (c.y - r.y) % 3 === 0 && !besideDoor(floor, c)).sort((a, b) => a.y - b.y || a.x - b.x)) {
      if (shelves >= most) break;
      if (placeBlocking(floor, pl, c, 'bookshelf')) shelves++;
    }
    // The desk is solid too: it goes through the same reach check as the shelves (a desk beside the shelf row once left
    // a cell reachable only across a corner, with a Sporecaller in it: caverns seed 87110, floor 14).
    for (const c of freeCells(floor, pl).filter(c => dist(c, hub) <= 3)) if (placeBlocking(floor, pl, c, 'table-candle')) break;
    r.libraryTheme = theme;
  },
  storage(gen, floor, r, pl) {   // S2
    const rng = gen.rng, edge = shuffle(rng, freeCells(floor, pl).filter(c => c.x === r.x || c.y === r.y || c.x === r.x + r.w - 1 || c.y === r.y + r.h - 1));
    const at = (edge.length ? edge : freeCells(floor, pl)).sort((a, b) => pl.depth(b) - pl.depth(a))[0];
    if (!at) return;
    chest(floor, at, 'supply', { table: 'crate-supply', art: 'crate-supply' });
    for (const m of pl.mouths) reservePath(pl, r, m, pl.hub);
    reservePath(pl, r, at, pl.hub);
    const n = next(rng) < 0.6 ? 1 : 2;
    const safe = c => !besideDoor(floor, c) && Math.max(Math.abs(c.x - at.x), Math.abs(c.y - at.y)) > 1 && !pl.mouths.concat([pl.hub]).some(m => Math.max(Math.abs(m.x - c.x), Math.abs(m.y - c.y)) <= 1);
    const placed = [];
    for (const c of freeCells(floor, pl).filter(safe)) {
      if (placed.length >= n) break;
      if (placed.some(b => Math.max(Math.abs(b.x - c.x), Math.abs(b.y - c.y)) <= 2)) continue;
      const id = ['barrel-explosive', 'barrel-poison', 'barrel-water'][Math.floor(next(rng) * 3)];
      if (placeBlocking(floor, pl, c, id)) placed.push(c);
    }
    const stock = ['barrel', 'crate', 'pot', 'crate', 'barrel', 'pot'], edges = freeCells(floor, pl).filter(c => (c.x === r.x || c.y === r.y || c.x === r.x + r.w - 1 || c.y === r.y + r.h - 1) && !besideDoor(floor, c));
    edges.slice(0, Math.min(7, Math.floor(edges.length * 0.6))).forEach((c, i) => placeBlocking(floor, pl, c, stock[i % stock.length]));
  },
  nest(gen, floor, r, pl, out) {   // S5
    const rng = gen.rng, focus = deepest(pl, freeCells(floor, pl))[0];
    if (!focus) return;
    item(floor, focus, essence(rng, 10, 20)); pl.reserved.add(key(focus.x, focus.y));
    const adj = freeCells(floor, pl).find(c => dist(c, focus) === 1);
    if (adj) { item(floor, adj, { id: 'ration', kind: 'food', tier: 0, plus: 0, count: 1 }); pl.reserved.add(key(adj.x, adj.y)); }
    let bones = 0;
    for (const c of pl.cells) if (Math.max(Math.abs(c.x - focus.x), Math.abs(c.y - focus.y)) <= 3) { paint(floor, c, G.BONES); if (bones < 4 && !occupied(floor, c) && !pl.reserved.has(key(c.x, c.y)) && next(rng) < 0.3) { floor.props.push({ id: 'bones', x: c.x, y: c.y }); bones++; } }
    residents(floor, pl, Array(gen.floorNo <= 2 ? 4 : population(r, 6, 10)).fill('rat'), focus, out);
  },
  armory(gen, floor, r, pl, out) {   // S6
    const free = freeCells(floor, pl);
    const far = free.slice().sort((a, b) => pl.depth(b) - pl.depth(a))[0];
    if (!far) return;
    const far2 = free.filter(c => c !== far).sort((a, b) => dist(b, far) - dist(a, far) || pl.depth(b) - pl.depth(a))[0];
    for (const c of [far, far2].filter(Boolean)) { item(floor, c, randomGear(gen, gen.floorNo)); reservePath(pl, r, c, pl.hub); }
    for (const m of pl.mouths) reservePath(pl, r, m, pl.hub);
    const horiz = r.w >= r.h, axis = c => horiz ? Math.abs(c.y - (r.y + r.h / 2)) : Math.abs(c.x - (r.x + r.w / 2));
    const cand = freeCells(floor, pl).filter(c => !besideDoor(floor, c)).sort((a, b) => axis(a) - axis(b) || pl.depth(b) - pl.depth(a));
    const racks = [], max = Math.min(6, Math.max(3, Math.floor(pl.cells.length / 12)));
    for (const c of cand) { if (racks.length >= max) break; if (racks.some(q => Math.max(Math.abs(q.x - c.x), Math.abs(q.y - c.y)) < 2)) continue; if (placeBlocking(floor, pl, c, 'weapon-rack')) racks.push(c); }
    const last = freeCells(floor, pl).filter(c => !besideDoor(floor, c)).at(-1);
    if (last) placeBlocking(floor, pl, last, 'banner-stand');
    if (gen.floorNo >= 3) residents(floor, pl, Array(population(r, 4, 7)).fill(0).map(() => (next(gen.rng) < 0.5 ? 'goblin' : 'archer')), far, out, { guard: true });
  },
  statues(gen, floor, r, pl) {   // S11
    const horiz = r.w >= r.h, mid = horiz ? r.y + Math.floor(r.h / 2) : r.x + Math.floor(r.w / 2);
    for (const c of pl.cells) if ((horiz ? c.y : c.x) === mid) pl.reserved.add(key(c.x, c.y));
    const d = deepest(pl, freeCells(floor, pl))[0];
    if (d) { item(floor, d, essence(gen.rng, 15, 25)); pl.reserved.add(key(d.x, d.y)); }
    const interior = pl.cells.filter(c => c.x > r.x && c.y > r.y && c.x < r.x + r.w - 1 && c.y < r.y + r.h - 1).length;
    const axis = c => Math.abs((horiz ? c.y : c.x) - mid);
    const cand = freeCells(floor, pl).sort((a, b) => axis(a) - axis(b) || pl.depth(b) - pl.depth(a)), placed = [];
    for (const c of cand) { if (placed.length >= Math.min(4, Math.floor(interior / 3))) break; if (placed.some(q => Math.max(Math.abs(q.x - c.x), Math.abs(q.y - c.y)) < 2)) continue; if (placeBlocking(floor, pl, c, placed.length === 1 ? 'statue-broken' : 'statue')) placed.push(c); }
  },
  treasury(gen, floor, r, pl, out) {   // S12
    const d = deepest(pl, freeCells(floor, pl)), c = d[0];
    if (!c) return;
    chest(floor, c, 'ornate');
    const post = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => ({ x: c.x + dx, y: c.y + dy })).find(q => pl.cellSet.has(key(q.x, q.y)) && !occupied(floor, q));
    const rest = d.slice(1).filter(q => !post || q.x !== post.x || q.y !== post.y);
    if (rest[0]) item(floor, rest[0], randomGear(gen, gen.floorNo));
    if (rest[1]) item(floor, rest[1], essence(gen.rng, 20, 35));
    const torches = freeCells(floor, pl).filter(q => (q.x === r.x || q.x === r.x + r.w - 1) && !besideDoor(floor, q));
    torches.slice(0, 2).forEach(q => placeBlocking(floor, pl, q, 'torch-stand'));
    if (post) { const g = makeCreature('brute', post.x, post.y, { asleep: true }); Object.assign(g, { name: 'Vault Guardian', elite: true, maxhp: Math.round(g.maxhp * 1.4), guard: true, resident: true }); g.hp = g.maxhp; out.push(g); }
    if (gen.floorNo >= 3) residents(floor, pl, Array(population(r, 3, 6)).fill(0).map(() => (next(gen.rng) < 0.5 ? 'goblin' : 'archer')), c, out, { guard: true });
  },
  barracks(gen, floor, r, pl, out) {   // S13
    const horiz = r.w >= r.h, mid = horiz ? r.y + Math.floor(r.h / 2) : r.x + Math.floor(r.w / 2);
    for (const c of pl.cells) if ((horiz ? c.y : c.x) === mid) pl.reserved.add(key(c.x, c.y));
    const longEdge = c => horiz ? (c.y === r.y || c.y === r.y + r.h - 1) : (c.x === r.x || c.x === r.x + r.w - 1);
    const spots = freeCells(floor, pl).filter(c => !besideDoor(floor, c)).sort((a, b) => (longEdge(b) - longEdge(a)) || pl.depth(b) - pl.depth(a));
    ['weapon-rack', 'table-candle', 'crate', 'barrel'].forEach((id, i) => spots[i] && placeBlocking(floor, pl, spots[i], id));
    const n = population(r, 6, 10), kinds = Array(n).fill(0).map(() => ['goblin', 'goblin', 'archer'][Math.floor(next(gen.rng) * 3)]);
    residents(floor, pl, kinds, deepest(pl, freeCells(floor, pl))[0] ?? pl.hub, out);
  },
  dark(gen, floor, r, pl, out) {   // S14
    r.dark = true;
    const inner = pl.cells.filter(c => c.x > r.x && c.y > r.y && c.x < r.x + r.w - 1 && c.y < r.y + r.h - 1 && !occupied(floor, c));
    for (let t = 0; t < 3; t++) { const c = inner[Math.floor(next(gen.rng) * inner.length)]; if (c && !besideDoor(floor, c)) { chest(floor, c, 'crystal'); break; } }
    const e = freeCells(floor, pl).filter(c => c.x > r.x && c.y > r.y && c.x < r.x + r.w - 1 && c.y < r.y + r.h - 1)[0] ?? freeCells(floor, pl)[0];
    if (e) item(floor, e, essence(gen.rng, 15, 25));
    residents(floor, pl, [0, 0].map(() => (next(gen.rng) < 0.5 ? 'goblin' : 'bat')), { x: r.x + r.w / 2, y: r.y + r.h / 2 }, out);
    (floor.notes ??= []).push('dark');
  },
  traps(gen, floor, r, pl) {   // S15
    const rng = gen.rng, d = deepest(pl, freeCells(floor, pl)), c = d[0];
    if (!c) return;
    chest(floor, c, gen.floorNo >= 3 ? 'ornate' : 'iron');
    reservePath(pl, r, pl.hub, c, true);
    const e = d.find(q => q !== c && !pl.reserved.has(key(q.x, q.y)));
    if (e) { item(floor, e, essence(rng, 15, 30)); reservePath(pl, r, pl.hub, e, true); }
    r.bypass = new Set([...pl.reserved].map(k => { const [x, y] = k.split(',').map(Number); return y * floor.w + x; }));
    const kinds = Object.entries(traps.rows).filter(([id, t]) => typeof t.minFloor === 'number' && !t.kind && t.minFloor <= gen.floorNo && id !== 'teleport' && !(id === 'pit' && gen.floorNo % 5 === 0)).map(([id]) => id);
    const cells = shuffle(rng, pl.cells.filter(q => !pl.reserved.has(key(q.x, q.y)) && floor.tiles[q.y * floor.w + q.x] === T.FLOOR && !occupied(floor, q) && !besideDoor(floor, q)));
    const n = Math.min(cells.length, Math.max(6, Math.ceil(cells.length * 0.6)));
    floor.traps ??= [];
    cells.slice(0, n).forEach((q, i) => floor.traps.push({ x: q.x, y: q.y, kind: pick(rng, kinds), found: i % 3 !== 2, room: true }));
    for (const q of shuffle(rng, freeCells(floor, pl)).slice(0, 3)) paint(floor, q, next(rng) < 0.5 ? G.SCORCH : G.BONES);
  },
  sacrifice(gen, floor, r, pl) {   // S10
    const c = { x: r.x + Math.floor(r.w / 2), y: r.y + Math.floor(r.h / 2) };
    if (!pl.cellSet.has(key(c.x, c.y))) return;
    floor.props.push({ id: 'altar-spikes', x: c.x, y: c.y, keep: true, passes: 0 });
    const edges = shuffle(gen.rng, freeCells(floor, pl).filter(q => (q.x === r.x || q.y === r.y || q.x === r.x + r.w - 1 || q.y === r.y + r.h - 1) && !besideDoor(floor, q)));
    ['brazier-lit', 'chains', 'brazier-lit'].forEach((id, i) => edges[i] && (P[id]?.blocks ? placeBlocking(floor, pl, edges[i], id) : floor.props.push({ id, x: edges[i].x, y: edges[i].y })));
  },
  'adventurer-camp'(gen, floor, r, pl) {   // S17
    const d = deepest(pl, freeCells(floor, pl));
    if (!d[0]) return;
    chest(floor, d[0], 'supply', { table: 'camp-adventurer', art: 'crate-supply' });
    ['kobold-bedroll-1', 'kobold-bedroll-1', 'kobold-campfire', 'kobold-crate', 'cl-lost-miner-1'].forEach((id, i) => d[i + 1] && floor.props.push({ id, x: d[i + 1].x, y: d[i + 1].y, keep: true }));
    r.rareEvent = true;
  },
  'bone-vault'(gen, floor, r, pl) {   // S20: the chest wakes guardians around it, the biome's roster (1.7 world.js:1292-1305)
    const free = freeCells(floor, pl);
    if (free.length < 8) return false;
    const c = deepest(pl, free)[0];
    chest(floor, c, 'gold', { table: 'chest-enhanced', art: 'chest-ornate', ambush: { kinds: boneVaultRoster(gen.rng, gen.floorNo), log: R['bone-vault'].ambush.log, planeBehaviour: !!R['bone-vault'].ambush.planeBehaviour } });
    r.chestAmbush = true;   // no random monsters or floor traps in it (1.7 world.js:417, 445)
    for (const q of pl.cells) { paint(floor, q, G.BONES); pl.reserved.add(key(q.x, q.y)); }
  },
  'goblin-mine'(gen, floor, r, pl) {   // S21
    if (isBossFloor(gen.floorNo)) return false;
    const c = deepest(pl, freeCells(floor, pl))[0];
    if (!c) return false;
    reservePath(pl, r, pl.hub, c, true);
    const extra = freeCells(floor, pl).filter(q => Math.max(Math.abs(q.x - c.x), Math.abs(q.y - c.y)) > 1).slice(0, 3);
    for (const q of extra) pl.reserved.add(key(q.x, q.y));
    const landing = extra[0] ?? c;
    chest(floor, c, 'gold', { art: 'chest-ornate', ambush: { kinds: ['skeleton'], at: landing, log: R['goblin-mine'].ambush.log, planeBehaviour: !!R['goblin-mine'].ambush.planeBehaviour } });
    r.chestAmbush = true;
    const spots = freeCells(floor, pl).filter(q => !besideDoor(floor, q));
    ['mine-cart', 'kobold-pickaxe', 'kobold-pickaxe', 'kobold-campfire'].forEach((id, i) => spots[i] && (P[id]?.blocks ? placeBlocking(floor, pl, spots[i], id) : floor.props.push({ id, x: spots[i].x, y: spots[i].y })));
    floor.traps ??= [];
    for (const q of freeCells(floor, pl)) if (!besideDoor(floor, q)) floor.traps.push({ x: q.x, y: q.y, kind: 'pit', found: false, room: true });
    (floor.notes ??= []).push('goblin-mine');
  },
  'greedy-vault'(gen, floor, r, pl) {   // S19: two chests; reaching for the second drops the floor around them
    if (r.w !== r.h || r.w < 7 || freeCells(floor, pl).length < 8) return false;
    const cx = r.x + Math.floor(r.w / 2), cy = r.y + Math.floor(r.h / 2), a = { x: cx - 1, y: cy }, b = { x: cx + 1, y: cy };
    if (!pl.cellSet.has(key(a.x, a.y)) || !pl.cellSet.has(key(b.x, b.y))) return false;
    const group = `${r.x},${r.y}`;
    (floor.greedy ??= {})[group] = { opened: 0, room: { x: r.x, y: r.y, w: r.w, h: r.h } };
    chest(floor, a, 'gold', { art: 'chest-ornate', greedy: group }); chest(floor, b, 'gold', { art: 'chest-ornate', greedy: group });
    for (const q of pl.cells) pl.reserved.add(key(q.x, q.y));
    r.rareEvent = true;
  },
  'ruined-treasury'(gen, floor, r, pl, out) {   // S18
    const d = deepest(pl, freeCells(floor, pl).filter(c => !besideDoor(floor, c)));
    if (!d[0]) return;
    chest(floor, d[0], 'gold', { table: 'chest-enhanced', art: 'chest-ornate' });
    for (let i = 1; i <= 3 && d[i]; i++) { const m = makeCreature(rollMonster(gen.rng, gen.floorNo), d[i].x, d[i].y, { asleep: true }); m.guard = true; m.resident = true; out.push(m); }
    for (const c of pl.cells) paint(floor, c, G.BONES);
    const spots = shuffle(gen.rng, freeCells(floor, pl).filter(c => !out.some(m => m.x === c.x && m.y === c.y)));
    ['statue-broken', 'statue-broken', 'rubble', 'rubble'].forEach((id, i) => spots[i] && (P[id]?.blocks ? placeBlocking(floor, pl, spots[i], id) : floor.props.push({ id, x: spots[i].x, y: spots[i].y })));
  },
  prison(gen, floor, r, pl) {   // S7
    const edge = c => c.x === r.x || c.y === r.y || c.x === r.x + r.w - 1 || c.y === r.y + r.h - 1;
    const edges = freeCells(floor, pl).filter(c => edge(c) && !besideDoor(floor, c)).sort((a, b) => a.y - b.y || a.x - b.x);
    // A cage never shuts a floor cell off (W73's 4-way reach; sandbox lead 2026-10-17: caverns floor 12 run 25, a cage on
    // a cave room's doorless way in cut 40,9 off). Cave rooms have no doors, so besideDoor alone does not keep the ways in.
    const shuts = c => {
      const W = floor.w, m = new Uint8Array(W * floor.h);
      for (const p of floor.props) if (propSolid(p)) m[p.y * W + p.x] = 1;
      const open = d => { let n = 0; for (let k = 0; k < d.length; k++) if (floor.tiles[k] === T.FLOOR && !m[k] && d[k] >= 0) n++; return n; };
      const from = pl.hub.y * W + pl.hub.x, before = open(flood(floor.tiles, W, floor.h, from, m));
      m[c.y * W + c.x] = 1;
      return open(flood(floor.tiles, W, floor.h, from, m)) < before - 1;
    };
    const cages = [];
    for (const c of edges) {
      if (cages.length >= 2) break;
      if (cages.some(q => dist(q, c) < 3)) continue;
      const ways = D4.map(([dx, dy]) => ({ x: c.x + dx, y: c.y + dy })).filter(q => pl.cellSet.has(key(q.x, q.y)) && !occupied(floor, q) && !pl.reserved.has(key(c.x, c.y)));
      if (!ways.length || occupied(floor, c) || (c.x === pl.hub.x && c.y === pl.hub.y) || shuts(c)) continue;
      const cage = { id: 'cage', x: c.x, y: c.y, keep: true };
      floor.props.push(cage); pl.cellSet.delete(key(c.x, c.y)); cages.push(cage);
      for (const q of ways) pl.reserved.add(key(q.x, q.y));
    }
    if (cages.length && next(gen.rng) < 0.85) cages[0].prisoner = next(gen.rng) < 0.5 ? 'goblin' : 'archer';
    // Release space kept, plus walks from the centre to the two centre columns and every cell at the room's mouths.
    const centre = pl.cellSet.has(key(r.cx, r.cy)) ? { x: r.cx, y: r.cy } : pl.hub, back = walkBack(pl, centre);
    const targets = [...pl.reserved].map(k => { const [x, y] = k.split(',').map(Number); return { x, y }; })
      .concat(pl.cells.filter(c => pl.cellSet.has(key(c.x, c.y)) && (c.x === r.cx || c.x === r.cx + 1)), pl.mouths);
    for (const t of targets) back(t);
    const list = ['table-candle', 'chains', 'bones'];
    let n = 0;
    for (const c of edges) if (n < 3 && !occupied(floor, c) && pl.cellSet.has(key(c.x, c.y)) && !pl.reserved.has(key(c.x, c.y))) { const id = list[n++]; if (P[id]?.blocks) placeBlocking(floor, pl, c, id); else floor.props.push({ id, x: c.x, y: c.y }); }
    r.prison = true;
  },
  'sword-in-stone'(gen, floor, r, pl, out) {   // S23
    for (const m of pl.mouths) reservePath(pl, r, m, pl.hub);
    const centre = { x: r.cx, y: r.cy };
    const cuts = c => { const left = new Set(pl.cellSet); left.delete(key(c.x, c.y)); return !left.has(key(pl.hub.x, pl.hub.y)) || walkField(pl, pl.hub, c => left.has(key(c.x, c.y))).filter(d => d >= 0).length < left.size; };
    const stone = freeCells(floor, pl).filter(c => !besideDoor(floor, c) && !(c.x === pl.hub.x && c.y === pl.hub.y) && !cuts(c)).sort((a, b) => dist(a, centre) - dist(b, centre))[0];
    if (!stone) { r.special = 'garden'; return BUILD.garden(gen, floor, r, plan(floor, r), out); }
    const blade = { ...makeItem('sword', 3, 3), enchant: 'light', known: true };
    floor.props.push({ id: 'sword-in-stone', x: stone.x, y: stone.y, keep: true, breakReward: blade });
    pl.cellSet.delete(key(stone.x, stone.y));
    const ring = pl.cells.filter(c => dist(c, stone) <= 2);
    for (const c of ring) if (c !== stone && !(c.x === stone.x && c.y === stone.y)) { pl.reserved.add(key(c.x, c.y)); paint(floor, c, G.MOSS); }
    (floor.fields ??= []).push(consecrated(ring.map(c => c.y * floor.w + c.x)));
    r.consecratedStone = { x: stone.x, y: stone.y, radius: 2 }; r.rareEvent = true;
    for (const c of pl.cells.filter(c => dist(c, stone) > 2).slice(0, 4)) if (!pl.reserved.has(key(c.x, c.y)) && !occupied(floor, c) && !besideDoor(floor, c) && pl.cellSet.has(key(c.x, c.y))) { if (placeBlocking(floor, pl, c, 'torch-stand')) floor.props.at(-1).keep = true; }
  },
};
// R6, rules 68-71: the Caverns' and Underdark's unique rare rooms (1.7 rare-rooms.js buildUniqueRareRoom, :70-96).
BUILD['volatile-hoard'] = (gen, floor, r, pl, out) => rareHoard(gen, floor, r, pl, out, 'volatile-hoard');
BUILD['drider-lair'] = (gen, floor, r, pl, out) => rareHoard(gen, floor, r, pl, out, 'drider-lair');
BUILD['dark-wizard-library'] = (gen, floor, r, pl, out) => wizardLibrary(gen, floor, r, pl, out);
for (const el of ELEMENTAL) BUILD['elemental-' + el] = (gen, floor, r, pl, out) => elementalRoom(gen, floor, r, pl, out, el);

/** The plan's open cells, kept walks included (1.7 freeCell over plan.cells). */
const openCells = (floor, pl) => pl.cells.filter(c => !occupied(floor, c) && floor.tiles[c.y * floor.w + c.x] === T.FLOOR);
/** 1.7 plan.reserve: the walk from the hub to a cell is kept open (every mouth's walk is kept when the plan is made). */
const keepWalk = (pl, r, c) => reservePath(pl, r, pl.hub, c);
/** Sleeping guards on the posts, then on any other free cell of the room (1.7 rare-rooms.js sp()). */
function guards(floor, pl, kinds, posts, out) {
  const spare = freeCells(floor, pl).filter(c => !posts.includes(c));
  for (const k of kinds) {
    const c = [...posts, ...spare].find(q => !out.some(m => m.x === q.x && m.y === q.y) && !occupied(floor, q));
    if (!c) return;
    const m = makeCreature(k, c.x, c.y, { asleep: true });
    Object.assign(m, { guard: true, resident: true });
    out.push(m);
  }
}
/** A kept prop on the first cell of `cells` that takes it (1.7 plan.furniture: free, not kept for a walk, not beside a door, never cutting the room). */
function furnish(floor, pl, cells, id, extra = {}, out = []) {
  for (const c of cells) {
    if (pl.reserved.has(key(c.x, c.y)) || occupied(floor, c) || besideDoor(floor, c) || out.some(m => m.x === c.x && m.y === c.y) || floor.tiles[c.y * floor.w + c.x] !== T.FLOOR) continue;
    if (P[id]?.blocks) { if (!placeBlocking(floor, pl, c, id)) continue; } else floor.props.push({ id, x: c.x, y: c.y });
    Object.assign(floor.props.at(-1), { keep: true }, extra);
    return c;
  }
  return null;
}

/**
 * Volatile Hoard (Caverns) and Drider Lair (Underdark): an enhanced gold chest on the deepest cell, three sleeping
 * guards on the next deepest cells off the doors (three fire imps; two driders and a drow priestess). The hoard is
 * stacked with four powder barrels; the lair is webbed, with a Vanish sigil, a cocoon that never hatches and bones.
 */
function rareHoard(gen, floor, r, pl, out, kind) {
  for (const m of pl.mouths) keepWalk(pl, r, m);
  const cells = deepest(pl, openCells(floor, pl));
  if (!cells.length) return false;
  r.rareEvent = true;
  const c0 = cells.shift();
  keepWalk(pl, r, c0);
  chest(floor, c0, 'gold', { table: 'chest-enhanced', art: 'chest-ornate' });
  const posts = cells.filter(c => !besideDoor(floor, c)).slice(0, 3);
  for (const c of posts) keepWalk(pl, r, c);
  guards(floor, pl, kind === 'volatile-hoard' ? ['fireimp', 'fireimp', 'fireimp'] : ['drider', 'drider', 'drowpriestess'], posts, out);
  if (kind === 'drider-lair') {
    for (const c of pl.cells) paint(floor, c, G.WEB);
    const reward = cells.find(c => !pl.reserved.has(key(c.x, c.y)) && !occupied(floor, c) && !out.some(m => m.x === c.x && m.y === c.y));
    if (reward) { item(floor, reward, { kind: 'sigil', id: 'vanish2', count: 1 }); keepWalk(pl, r, reward); }
  }
  const decor = kind === 'volatile-hoard' ? ['barrel-explosive', 'barrel-explosive', 'barrel-explosive', 'barrel-explosive'] : ['cocoon-large-1', 'bones', 'bones'];
  for (const id of decor) furnish(floor, pl, cells, id, id === 'cocoon-large-1' ? { hatch: false } : {}, out);
}

/**
 * Dark Wizard Library (Underdark, a room of no region): a tome (its tier rolled, ruling 13) on the shallowest cell, Transmutation, Wisdom
 * and Ascension sigils on the three deepest, an enhanced gold chest after them, three sleeping drow priestesses on the
 * shallowest cells off the doors, and up to six shelves (two bookshelves, then a pillar) on every third row.
 */
function wizardLibrary(gen, floor, r, pl, out) {
  for (const m of pl.mouths) keepWalk(pl, r, m);
  const cells = deepest(pl, openCells(floor, pl));
  if (!cells.length) return false;
  r.rareEvent = true;
  const tome = cells.pop();
  if (tome) { item(floor, tome, randomGear(gen, gen.floorNo, { item: 'tome' })); keepWalk(pl, r, tome); }   // ruling 13: a tier like the library's
  for (const id of ['transmutation', 'wisdom', 'ascension']) { const c = cells.shift(); if (c) { item(floor, c, { kind: 'sigil', id, count: 1 }); keepWalk(pl, r, c); } }
  const prize = cells.shift();
  if (prize) { chest(floor, prize, 'gold', { table: 'chest-enhanced', art: 'chest-ornate' }); keepWalk(pl, r, prize); }
  const posts = cells.slice().reverse().filter(c => !besideDoor(floor, c)).slice(0, 3);
  for (const c of posts) keepWalk(pl, r, c);
  guards(floor, pl, ['drowpriestess', 'drowpriestess', 'drowpriestess'], posts, out);
  const shelves = cells.filter(c => (c.y - r.y) % 3 === 0 && !pl.reserved.has(key(c.x, c.y))).sort((a, b) => a.y - b.y || a.x - b.x);
  for (let n = 0; n < Math.min(6, shelves.length); n++) furnish(floor, pl, [shelves[n]], n % 3 === 2 ? 'pillar' : 'bookshelf', {}, out);
}

/**
 * The bone vault's guardians by biome (rooms.json bone-vault ambush.rosterByBiome, 1.7 BONE_VAULT_GROUPS): the Dungeon
 * draws one tier-2 elementaling, the Crypt, Caverns and Underdark one whole pair of their own.
 */
export function boneVaultRoster(rng, floorNo) {
  const by = R['bone-vault'].ambush.rosterByBiome, b = by[String(Math.min(4, Math.floor((floorNo - 1) / 5) + 1))] ?? by['1'];
  if (b.uniform) return Array.from({ length: b.picks }, () => pick(rng, b.uniform));
  return pick(rng, b.group).slice();
}

/** S31: an elemental sanctuary: three sleeping guard elementalings of the biome's tier, a wooden chest, the rune and decor. */
function elementalRoom(gen, floor, r, pl, out, el) {
  const row = R['elemental-' + el], L = row.layout, bi = Math.min(3, Math.floor((gen.floorNo - 1) / 5)), tier = row.tierByBiome[bi + 1];
  const kind = row.residents[0].creatureByTier[tier - 1];
  for (const m of pl.mouths) reservePath(pl, r, m, pl.hub);
  const byDepth = pl.cells.slice().sort((a, b) => pl.depth(b) - pl.depth(a));
  const free = c => floor.tiles[c.y * floor.w + c.x] === T.FLOOR && !occupied(floor, c) && pl.cellSet.has(key(c.x, c.y));
  // A room whose whole side is a corridor mouth has every cell on a kept walk; a chest blocks no walk, so it takes one.
  const box = byDepth.find(c => free(c) && !besideDoor(floor, c) && !pl.reserved.has(key(c.x, c.y))) ?? byDepth.find(c => free(c) && !besideDoor(floor, c));
  if (box) { reservePath(pl, r, pl.hub, box); chest(floor, box, 'wood'); }
  const posts = byDepth.filter(c => free(c) && !besideDoor(floor, c)).slice(0, 3);
  for (const c of posts) {
    pl.reserved.add(key(c.x, c.y));
    const m = makeCreature(kind, c.x, c.y, { asleep: true }); m.guard = true; m.resident = true; out.push(m);
  }
  const decor = byDepth.filter(c => free(c) && !pl.reserved.has(key(c.x, c.y)));
  const furnish = (c, id) => { if (!c || besideDoor(floor, c) || pl.reserved.has(key(c.x, c.y)) || !free(c)) return; if (P[id]?.blocks) { if (placeBlocking(floor, pl, c, id)) floor.props.at(-1).keep = true; } else floor.props.push({ id, x: c.x, y: c.y, keep: true }); };
  furnish(decor.shift(), L.rune);
  decor.slice(0, Math.min(8, Math.max(3, Math.floor(byDepth.length / 5)))).forEach((c, i) => furnish(c, i === 0 ? L.light : L.decor[i % L.decor.length]));
  if (el === 'earth') for (const c of pl.cells) if (floor.tiles[c.y * floor.w + c.x] === T.FLOOR && !floor.ground[c.y * floor.w + c.x]) floor.ground[c.y * floor.w + c.x] = G.MOSS;
  r.elementalRoom = { element: el, tier };
  (floor.notes ??= []).push({ id: 'sanctuary', element: el, tier });
}

/** Walking distances over the plan's map from `from`, four ways, through the cells ok({x, y}) admits (-1: unreached). */
const walkField = (pl, from, ok) => distanceField(pl.w, pl.h, from.y * pl.w + from.x, k => ok({ x: k % pl.w, y: (k / pl.w) | 0 }));

/** One walk field from `from` over the plan; the returned function reserves the walk back from a target (1.7 bfsFrom). */
function walkBack(pl, from) {
  const field = walkField(pl, from, c => pl.cellSet.has(key(c.x, c.y))), d = c => field[c.y * pl.w + c.x];
  return t => {
    let c = t;
    while (c && d(c) > 0) { pl.reserved.add(key(c.x, c.y)); const dd = d(c); c = D4.map(([dx, dy]) => ({ x: c.x + dx, y: c.y + dy })).find(n => d(n) === dd - 1); }
    if (c) pl.reserved.add(key(c.x, c.y));
  };
}

/**
 * W32-W35: 2 specials on floor 1, 2 or 3 later, 1 on a boss floor; each one weighted draw and a free room of its
 * minArea. Returns the bodies the rooms place (residents, guards). The zoo is built by `zoo` (a pocket).
 */
export function buildSpecials(gen, floor, rooms, floorNo, { boss = false, carvePocket } = {}) {
  const rng = gen.rng, out = [], skipped = new Set();
  let list = specialsPool(floorNo, boss, gen.classic);
  const C = F['specials-count'], n = boss ? C.bossFloor : floorNo === 1 ? C.floor1 : C.else.base + (next(rng) < C.else.extraChancePct / 100 ? 1 : 0);
  for (let i = 0; i < n && list.length; i++) {
    let [kind, , minArea] = weighted(rng, list, e => e[3]);
    // Rule 13, R4: the sword-in-the-stone floor puts the sword in the first special (a room of area 25).
    if (i === 0 && !boss && swordStoneFloor(gen.runSeed) === floorNo) [kind, minArea] = ['sword-in-stone', 25];
    // R6, rule 68: a unique rare room due on this floor replaces it (the biome builds it: the Crypt's bone gauntlet, hungry spider).
    const rare = i === 0 && !boss && uniqueRareKind(gen.runSeed, floorNo);
    if (rare) [kind, minArea] = [rare, 25];
    const forced = i === 0 && forcedKind(gen, 'special');   // the sandbox's room preview (1.7 world.js:393)
    if (forced) [kind, minArea] = [forced, 25];
    if (!BUILT.has(kind) && !hooksFor(floorNo).specials?.[kind]) { skipped.add(kind); continue; }
    // 1.7 picks the greedy vault's host among square rooms of 7+ (world.js:394), not any room it then refuses.
    const suits = kind === 'greedy-vault' ? r => !r.cave && r.w === r.h && r.w >= 7 : () => true;
    const hosts = rooms.filter(r => !r.pocket && !r.role && !r.special && r.w * r.h >= minArea && suits(r));
    if (!hosts.length) continue;
    const host = pick(rng, hosts);
    if (buildSpecial(kind, gen, floor, rooms, host, out, { carvePocket }) && forced) forcedBuilt(gen);
    if (kind === 'zoo') list = list.filter(e => e[0] !== 'zoo');
  }
  floor.specialsSkipped = [...skipped];
  return out;
}

/**
 * Builds one special room of a shared kind in a chosen host (the body of the roll above). The biomes that roll their
 * own pool (the Caverns, the Underdark) build the shared kinds through it. False when the kind is not built here or
 * the host does not suit it. `out` collects the room's bodies.
 */
export function buildSpecial(kind, gen, floor, rooms, host, out, { carvePocket }) {
  const rng = gen.rng, floorNo = gen.floorNo;
  const own = hooksFor(floorNo).specials?.[kind];   // a biome's own room (registry.js: the Crypt's tomb and bell)
  if (own) return own(gen, floor, rooms, host, out, { carvePocket }) !== false;
  if (!BUILT.has(kind)) return false;
  if (kind === 'zoo') {
    // S16: a square pocket with an iron door, packed with sleeping monsters; no pocket, and the host becomes storage.
    const side = Math.min(7, Math.max(4, Math.min(host.w, host.h)));
    const pk = carvePocket(rng, floor, rooms, side, side, side, side, h => h !== host);
    if (!pk) { host.special = 'storage'; BUILD.storage(gen, floor, host, plan(floor, host), out); return true; }
    floor.tiles[pk.door.y * floor.w + pk.door.x] = T.LOCKED; floor.vault = true; pk.room.special = 'zoo'; pk.room.rareEvent = true;
    const pl = plan(floor, pk.room), cells = deepest(pl, pl.cells);
    if (cells.at(-1)) chest(floor, cells.at(-1), 'ornate');
    const rest = cells.slice(0, -1);
    if (rest.at(-1)) { item(floor, rest.at(-1), randomGear(gen, floorNo)); floor.items.push({ x: rest.at(-1).x, y: rest.at(-1).y, item: { kind: 'mote', el: ['fire', 'water', 'air', 'earth', 'light', 'shadow'][Math.floor(next(rng) * 6)] } }); }
    for (let k = 2; k <= 4; k++) if (rest.at(-k)) item(floor, rest.at(-k), essence(rng, 15, 30));
    for (const c of pl.cells.concat([pk.inside])) paint(floor, c, G.BONES);
    for (const c of deepest(pl, pl.cells).filter(c => !floor.chests.some(h => h.x === c.x && h.y === c.y)).slice(0, 12)) out.push(Object.assign(makeCreature(rollMonster(rng, floorNo), c.x, c.y, { asleep: true }), { resident: true }));   // ruling 11: at most 12
    (floor.notes ??= []).push('zoo');
    return true;
  }
  if (kind === 'portcullis-cache') { portcullis(gen, floor, rooms, host, carvePocket); return true; }
  host.special = kind;
  // A room whose rule needs more than this host has (a square of 7, 8 free cells) is not built (S19-S21).
  if (BUILD[kind](gen, floor, host, plan(floor, host), out) === false) { host.special = null; return false; }
  return true;
}

/**
 * The portcullis cache (S32, rooms.json portcullis-cache): a 4x4 pocket off the host behind a sealed portcullis, an
 * enhanced gold chest at its deepest cell; the lever stands in another plain room 12+ steps away, in the farthest
 * quarter. Pulling it raises the portcullis and two brutes and a shaman guard the cache.
 */
function portcullis(gen, floor, rooms, host, carvePocket) {
  const rng = gen.rng, pk = carvePocket(rng, floor, rooms, 4, 4, 4, 4, h => h !== host);
  if (!pk) return;
  const pl = plan(floor, pk.room);
  if (freeCells(floor, pl).length < 8) { for (const c of pl.cells) floor.tiles[c.y * floor.w + c.x] = T.WALL; rooms.splice(rooms.indexOf(pk.room), 1); return; }   // walled back up
  floor.tiles[pk.door.y * floor.w + pk.door.x] = T.SEALED;
  pk.room.special = 'portcullis-cache'; pk.room.rareEvent = true; host.special = host.special ?? 'cache-host';
  chest(floor, deepest(pl, freeCells(floor, pl))[0], 'gold', { table: 'chest-enhanced', art: 'chest-ornate' });
  // The lever: plain rooms only, 12+ walking steps from the door, uniform among the farthest quarter.
  const W = floor.w, d = distanceField(W, floor.h, pk.inside.y * W + pk.inside.x, n => floor.tiles[n] !== T.WALL && floor.tiles[n] !== T.SEALED);
  const cells = [];
  for (const r of rooms.filter(x => !x.pocket && !x.role && !x.special)) for (const c of plan(floor, r).cells) if (d[c.y * W + c.x] >= 12 && !occupied(floor, c) && !besideDoor(floor, c)) cells.push({ ...c, d: d[c.y * W + c.x] });
  if (!cells.length) return;
  cells.sort((a, b) => b.d - a.d);
  const far = cells.slice(0, Math.max(1, Math.ceil(cells.length / 4))), c = pick(rng, far);
  floor.props.push({ id: 'lever-up', x: c.x, y: c.y, keep: true, portcullis: { door: pk.door, room: { x: pk.room.x, y: pk.room.y, w: pk.room.w, h: pk.room.h } } });
}

export { BUILT as BUILT_SPECIALS, BUILD as BUILD_ROOMS, rollMonster };
