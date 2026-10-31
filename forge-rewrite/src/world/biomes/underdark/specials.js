// The Underdark's special rooms (spec/world.md W33-W35, 119, 141, "The specials roll" 1-16, answers 10-11; rooms.json
// watchpost, ritual, harvester-camp; 1.7 world.js buildWatchpostRoom, buildRitualRoom, buildHarvesterCamp and
// content-adapter.js buildSpecial @3c8b312). The pool drops the sacrifice room, turns barracks into a drow watchpost
// and adds the ritual room, the harvester camp and the silk survivor; gardens anywhere, and statue or storage rooms
// outside the temple, become themed rooms. Rooms the shared builder makes come from src/world/specials.js; the
// Underdark's own three are built here. Residents asked for by Dungeon name are swapped (floors.json swap-underdark).

import floors from '../../../../data/floors.json' with { type: 'json' };
import rooms from '../../../../data/rooms.json' with { type: 'json' };
import props from '../../../../data/props.json' with { type: 'json' };
import { next, roll, pick, weighted } from '../../../lib/rng.js';
import { makeCreature } from '../../../rules/monsters.js';
import { T, G } from '../../../data/tiles.js';
import { nearDoor, facesWall } from '../../dress.js';
import * as shared from '../../specials.js';
import { carve } from '../../pockets.js';
import { roomCells, splitsRoom } from './layout.js';
import { place } from './dress.js';
import { uniqueRareKind, forcedKind, forcedBuilt } from '../../rare.js';
import { swapInPlace } from '../../swaps.js';
import { cheb as dist, D4 } from '../../../lib/geometry.js';
import { propBlocks } from '../../../data/props.js';

const R = rooms.rows, P = props.rows;
const OWN = new Set(['watchpost', 'ritual', 'harvester-camp', 'silk-survivor']);

/** M60: a Dungeon kind asked for by a room, as the Underdark has it. */

/** P1-P5 in a room of any shape: its open cells, mouths and depths. */
function planOf(floor, r) {
  const W = floor.w, cells = roomCells(r).filter(c => floor.tiles[c.y * W + c.x] === T.FLOOR && !floor.props.some(p => p.x === c.x && p.y === c.y && propBlocks(p)));
  const set = new Set(cells.map(c => c.y * W + c.x));
  const passage = t => [T.FLOOR, T.DOOR, T.OPEN_DOOR, T.LOCKED, T.TOLL, T.SECRET, T.WATER].includes(t);
  const mouths = cells.filter(c => D4.some(([dx, dy]) => !set.has((c.y + dy) * W + c.x + dx) && passage(floor.tiles[(c.y + dy) * W + c.x + dx])));
  const hub = mouths[0] ?? cells[0];
  const depth = c => (mouths.length ? Math.min(...mouths.map(m => Math.abs(m.x - c.x) + Math.abs(m.y - c.y))) : dist(hub, c));
  return { cells, mouths, hub, depth, reserved: new Set() };
}
const occupied = (floor, c) => floor.props.some(p => p.x === c.x && p.y === c.y) || floor.items.some(i => i.x === c.x && i.y === c.y) || floor.chests.some(h => h.x === c.x && h.y === c.y) || floor.tiles[c.y * floor.w + c.x] !== T.FLOOR;
const splits = (floor, pl, add) => splitsRoom(floor, pl.cells, add);
const chest = (floor, c, kind, extra = {}) => { floor.tiles[c.y * floor.w + c.x] = T.CHEST; floor.chests.push({ x: c.x, y: c.y, kind, ...extra }); };
const population = (r, lo, hi) => Math.max(lo, Math.min(hi, Math.floor((r.n ?? r.w * r.h) / 6)));

const OWN_BUILD = {
  /** 1.7 buildHarvesterCamp: a supply crate at the deepest cell; a cocoon (no hatch) against a wall, a table, barrels, mushrooms. */
  'harvester-camp'(gen, floor, grid, r) {
    const pl = planOf(floor, r), cells = pl.cells.filter(c => !occupied(floor, c)).sort((a, b) => pl.depth(b) - pl.depth(a));
    if (!cells.length) return false;
    const c0 = cells.shift();
    chest(floor, c0, 'supply', { table: 'camp-harvester', art: 'crate-supply' });
    r.rareEvent = true;
    for (const id of ['cocoon-large-1', 'alchemy-table', 'barrel', 'barrel', 'mushrooms', 'mushrooms']) {
      const c = cells.find(q => !occupied(floor, q) && !nearDoor(floor, grid, q.x, q.y) && (id !== 'cocoon-large-1' || D4.some(([dx, dy]) => floor.tiles[(q.y + dy) * floor.w + q.x + dx] === T.WALL)) && !(P[id]?.blocks && splits(floor, pl, [q])));
      if (c) floor.props.push({ id, x: c.x, y: c.y, keep: true, ...(id === 'cocoon-large-1' ? { deep: true, hatch: false } : {}) });
    }
  },
  /** 1.7 buildWatchpostRoom: a supply crate deep in the room, two pillars of cover, blades posted round them (6-10). */
  watchpost(gen, floor, grid, r, out) {
    const pl = planOf(floor, r), cells = pl.cells.filter(c => !occupied(floor, c)).sort((a, b) => pl.depth(b) - pl.depth(a));
    const c0 = cells.find(c => pl.depth(c) >= 3);
    if (!c0) return false;
    chest(floor, c0, 'supply', { table: 'crate-supply', art: 'crate-supply' });
    const centre = { x: r.cx, y: r.cy }, cover = [];
    for (const c of cells.slice().sort((a, b) => dist(a, centre) - dist(b, centre))) {
      if (cover.length >= 2 || cover.some(p => dist(p, c) < 2) || occupied(floor, c) || nearDoor(floor, grid, c.x, c.y) || pl.mouths.some(m => dist(m, c) <= 1) || splits(floor, pl, [c])) continue;
      place(floor, 'drow-pillar', c.x, c.y, { keep: true });
      cover.push(c);
    }
    const posts = [];
    const near = c => (cover.length ? Math.min(...cover.map(p => dist(c, p))) : pl.depth(c));
    for (const c of cells.filter(q => !occupied(floor, q) && !nearDoor(floor, grid, q.x, q.y) && dist(q, c0) > 1).sort((a, b) => near(a) - near(b))) {
      if (posts.length < population(r, 6, 10) && !posts.some(p => dist(p, c) < 2)) posts.push(c);
    }
    let placed = 0;
    for (const c of cells) if (placed < 2 && !occupied(floor, c) && !posts.some(p => p.x === c.x && p.y === c.y) && !nearDoor(floor, grid, c.x, c.y) && !facesWall(floor, placed ? 'weapon-rack' : 'crate', c.x, c.y) && !splits(floor, pl, [c])) { floor.props.push({ id: placed ? 'weapon-rack' : 'crate', x: c.x, y: c.y, keep: true }); placed++; }
    // Answer 11: the residents equal the posts; they wander as guards.
    for (const c of posts) { const m = makeCreature('drowblade', c.x, c.y); Object.assign(m, { guard: true, resident: true }); out.push(m); }
  },
  /** 1.7 buildRitualRoom: a caged captive, a bloody altar 2-4 from it, the priestess's post, a gold chest, scorched ground, 2 braziers. */
  ritual(gen, floor, grid, r, out) {
    const pl = planOf(floor, r), cells = pl.cells.filter(c => !occupied(floor, c) && !nearDoor(floor, grid, c.x, c.y)).sort((a, b) => pl.depth(b) - pl.depth(a));
    const captive = cells.find(c => cells.some(a => Math.abs(a.x - c.x) + Math.abs(a.y - c.y) === 1) && !splits(floor, pl, [c]));
    if (!captive) return false;
    const approach = cells.find(c => Math.abs(c.x - captive.x) + Math.abs(c.y - captive.y) === 1);
    const isFree = c => !occupied(floor, c) && !(c.x === approach.x && c.y === approach.y);
    floor.props.push({ id: 'cage', x: captive.x, y: captive.y, keep: true, prisoner: 'goblin', prisonerOutcome: 'escapee', ritual: true, captiveHp: 24, captiveMaxhp: 24 });
    const altar = cells.find(c => dist(c, captive) >= 2 && dist(c, captive) <= 4 && isFree(c) && isFree({ x: c.x + 1, y: c.y }) && pl.cells.some(q => q.x === c.x + 1 && q.y === c.y) && !splits(floor, pl, [c, { x: c.x + 1, y: c.y }]));
    if (altar) place(floor, 'drow-altar-blood', altar.x, altar.y, { keep: true, ritualAltar: true });
    const post = cells.filter(c => isFree(c) && dist(c, approach) > 1).sort((a, b) => dist(a, altar ?? captive) - dist(b, altar ?? captive))[0];
    const c1 = cells.find(c => isFree(c) && dist(c, captive) > 1 && !(post && post.x === c.x && post.y === c.y) && !splits(floor, pl, [c]));
    if (c1) chest(floor, c1, 'gold', { table: 'chest-enhanced', art: 'chest-ornate', enhanced: true });
    for (const c of pl.cells) if (floor.tiles[c.y * floor.w + c.x] === T.FLOOR && dist(c, captive) <= 3) floor.ground[c.y * floor.w + c.x] = G.SCORCH;
    let placed = 0;
    for (const c of cells) if (placed < 2 && isFree(c) && !(post && post.x === c.x && post.y === c.y) && !splits(floor, pl, [c])) { floor.props.push({ id: 'brazier-lit', x: c.x, y: c.y, keep: true }); placed++; }
    // WC13: the room's open cells and mouths ride along for the summons when the captive dies (1.7 r.ritual.cells, mouths).
    r.ritual = { cage: { x: captive.x, y: captive.y }, hp: 24, maxhp: 24, active: false, finished: false, post: post ?? null, cells: pl.cells.map(c => ({ x: c.x, y: c.y })), mouths: pl.mouths.map(c => ({ x: c.x, y: c.y })) };
    const taken = new Set();
    const spot = () => { const c = cells.find(q => isFree(q) && !taken.has(`${q.x},${q.y}`)); if (c) taken.add(`${c.x},${c.y}`); return c; };
    const priestAt = post ?? spot();
    if (priestAt) { taken.add(`${priestAt.x},${priestAt.y}`); const m = makeCreature('drowpriestess', priestAt.x, priestAt.y, { asleep: true }); Object.assign(m, { guard: true, resident: true, ritualPriest: true }); r.ritual.priestId = m.id; r.ritual.post = { x: priestAt.x, y: priestAt.y }; out.push(m); }
    for (let i = 0; i < 2; i++) { const c = spot(); if (!c) break; const m = makeCreature('drowblade', c.x, c.y, { asleep: true }); Object.assign(m, { guard: true, resident: true }); out.push(m); }
  },
  /**
   * WC12, G45 (1.7 world.js buildUncommonEvent silk-survivor): the silk-wrapped traveler on the deepest free cell clear
   * of the mouths and doors, in a room of 8+ free cells; the room's cells, mouths and footprint ride on the prop for
   * the spiderlings and the drider when he is cut free (rules/underdark.js).
   */
  'silk-survivor'(gen, floor, grid, r) {
    const pl = planOf(floor, r), cells = pl.cells.filter(c => !occupied(floor, c)).sort((a, b) => pl.depth(b) - pl.depth(a));
    if (cells.length < 8) return false;
    const c = cells.find(q => !nearDoor(floor, grid, q.x, q.y) && !pl.mouths.some(m => dist(m, q) <= 1) && D4.filter(([dx, dy]) => cells.some(o => o.x === q.x + dx && o.y === q.y + dy)).length >= 2);
    if (!c) return false;
    floor.props.push({ id: 'silk-wrapped-traveler', x: c.x, y: c.y, keep: true, silk: { cells: cells.map(q => ({ x: q.x, y: q.y })), mouths: pl.mouths.map(q => ({ x: q.x, y: q.y })), area: roomCells(r).map(q => q.y * floor.w + q.x) } });
    r.rareEvent = true;
  },
};

/**
 * W32-W35 in the Underdark: 2 specials (3 at 50%), 1 on floor 20; each one weighted draw and a free room of its area
 * (ritual and watchpost in the temple; the greedy vault a square built room of 7+). Returns the bodies the rooms place.
 */
export function buildUnderdarkSpecials(gen, floor, rooms, grid, floorNo, { boss = false, themeRoom } = {}) {
  const rng = gen.rng, out = [], skipped = new Set();
  let list = shared.specialsPool(floorNo, boss);   // the one pool (world/specials.js, rooms.json)
  const n = boss ? 1 : 2 + (next(rng) < 0.5 ? 1 : 0);
  const zooFamily = k => k === 'zoo';
  for (let i = 0; i < n && list.length; i++) {
    let [kind, , minArea] = weighted(rng, list, e => e[3]);
    // R6, rule 68: a unique rare room due on this floor (Drider Lair, Dark Wizard Library) replaces the first pick (1.7 world.js:392).
    const rare = i === 0 && !boss && uniqueRareKind(gen.runSeed, floorNo);
    if (rare) [kind, minArea] = [rare, 25];
    const forced = i === 0 && forcedKind(gen, 'special');   // the sandbox's room preview
    if (forced) [kind, minArea] = [forced, 25];
    const fits = r => !r.pocket && !r.role && !r.special && (r.n ?? r.w * r.h) >= minArea
      && (kind !== 'greedy-vault' || (!r.cave && r.w === r.h && r.w >= 7)) && (!['ritual', 'watchpost', 'dark-wizard-library'].includes(kind) || !r.region);
    const hosts = rooms.filter(fits);
    if (!hosts.length) continue;
    const host = pick(rng, hosts);
    if (zooFamily(kind) || kind === 'ritual') list = list.filter(e => e[0] !== kind);
    // 119: gardens, and statues or storage outside the temple, become the region's themed room.
    if (kind === 'garden' || ((kind === 'statues' || kind === 'storage') && host.region)) { host.special = kind; themeRoom?.(host, true); if (forced) forcedBuilt(gen); continue; }
    if (OWN.has(kind)) {
      host.special = kind;
      if (OWN_BUILD[kind](gen, floor, grid, host, out) !== false) { if (forced) forcedBuilt(gen); } else {
        host.special = null;
        if (kind === 'watchpost') { host.special = 'barracks'; shared.buildSpecial('barracks', gen, floor, rooms, host, out, { carvePocket: carve }); }
      }
      continue;
    }
    // A shared room: built by src/world/specials.js.
    const before = out.length;
    if (shared.buildSpecial(kind, gen, floor, rooms, host, out, { carvePocket: carve }) === false) { skipped.add(kind); continue; }
    if (forced) forcedBuilt(gen);
    for (const m of out.slice(before)) swapInPlace('underdark', m);
  }
  floor.specialsSkipped = [...skipped];
  return out;
}
