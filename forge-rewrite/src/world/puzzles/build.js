// The puzzle pass (spec/world.md "Puzzles: the plan" 8-17, "Puzzles: each kind" 22-58; data/puzzles.json): on a floor
// the plan names, a sigil puzzle room, a crystal vault or an elemental treasury, carved as a pocket off a room and
// built as 1.7 builds it (js/world/puzzles.js:107-249, beta-world.js:5-10 @3c8b312). Runs after the floor rings and
// amulets, before vegetation (W13), on its own stream (floor seed ^ 0x51c1). Draws only from that stream.
//
// What the rules read (src/rules/puzzles.js): floor.puzzles (one row per sigil room), floor.crystalVault,
// floor.treasury; props, items and traps carry the flags named below.

import props from '../../../data/props.json' with { type: 'json' };
import puzzles from '../../../data/puzzles.json' with { type: 'json' };
import sigils from '../../../data/sigils.json' with { type: 'json' };
import roomRows from '../../../data/rooms.json' with { type: 'json' };
import { stream, next, roll, shuffle } from '../../lib/rng.js';
import { randomGear, giveOf, ELEMENTS } from '../../rules/loot.js';
import { makeCreature } from '../../rules/monsters.js';
import { carve } from '../pockets.js';
import { roomGrid, edgeCells, interiorCells, nearDoor, facesWall } from '../dress.js';
import { T, G } from '../../data/tiles.js';
import { planForFloor } from './plan.js';
import { forcedKind, forcedBuilt } from '../rare.js';
import { cheb, D4 } from '../../lib/geometry.js';
import { reachFrom, propMask } from '../floor-checks.js';
import { distanceField } from '../../lib/grid.js';
import { propSolid, propBlocks } from '../../data/props.js';
import { vaultGas } from '../fields.js';
import { gradeSigil } from '../sigil-grade.js';

const R = puzzles.rows, S = sigils.rows;
const man = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
const inRoom = (r, x, y) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
const same = (a, b) => a.x === b.x && a.y === b.y;

/** The generation view of one floor: tiles, things on them, and 1.7's freeCell. */
function view(floor, rooms, creatures) {
  const W = floor.w;
  const at = (x, y) => (x < 0 || y < 0 || x >= W || y >= floor.h ? T.WALL : floor.tiles[y * W + x]);
  const propAt = (x, y) => floor.props.find(p => p.x === x && p.y === y) ?? null;
  const itemAt = (x, y) => floor.items.some(i => i.x === x && i.y === y);
  const bodyAt = (x, y) => creatures.some(c => c.x === x && c.y === y);
  const trapAt = (x, y) => floor.traps.some(t => t.x === x && t.y === y);
  const freeCell = (x, y) => at(x, y) === T.FLOOR && !propAt(x, y) && !itemAt(x, y) && !bodyAt(x, y) && !trapAt(x, y);
  const roomAt = (x, y) => rooms.find(r => inRoom(r, x, y)) ?? null;
  return { W, at, propAt, itemAt, bodyAt, freeCell, roomAt };
}

/** Rule 12: interior cells, then edge cells (1.7 pzCells), both never the centre. */
function pzCells(v, floor, rooms, room) {
  const grid = roomGrid(floor, rooms);
  return [...interiorCells(floor, room), ...edgeCells(floor, grid, room)];
}
/** Rule 13: farthest from the door first (Manhattan), ties in list order. */
const farFrom = (cells, door) => cells.slice().sort((a, b) => man(b, door) - man(a, door));

/** 1.7 bfsFrom: walkable tiles without a blocking prop, plus shut doors, chests and the sealed door. */
const bfs = (floor, from) => reachFrom(floor, from, propMask(floor, p => propBlocks(p)), { exit: false, also: SEALED });
const SEALED = new Set([T.SEALED]);

/** 1.7 roomFurnitureKeepsOpen: a piece on c leaves every reachable room cell reachable, and levers and altars usable. */
function furnitureKeepsOpen(v, floor, room, c) {
  if (!inRoom(room, c.x, c.y) || !v.freeCell(c.x, c.y)) return false;
  const doorish = t => [T.DOOR, T.OPEN_DOOR, T.LOCKED, T.SEALED, T.TOLL, T.SECRET].includes(t);
  const walk = t => [T.FLOOR, T.OPEN_DOOR, T.STAIRS, T.STAIRS_UP, T.RUBBLE, T.WATER, T.BRIDGE].includes(t);
  const pass = (x, y) => { if (!inRoom(room, x, y)) return false; const p = v.propAt(x, y), t = v.at(x, y); return !(p && propSolid(p)) && (walk(t) || doorish(t) || t === T.CHEST); };
  const cells = [];
  for (let y = room.y; y < room.y + room.h; y++) for (let x = room.x; x < room.x + room.w; x++) if (pass(x, y)) cells.push({ x, y });
  const start = cells.find(p => !same(p, c));
  if (!start) return false;
  const reach = avoid => distanceField(v.W, floor.h, start.y * v.W + start.x, k => pass(k % v.W, (k / v.W) | 0) && !(avoid && k === c.y * v.W + c.x));
  const before = reach(false), after = reach(true);
  if (cells.some(p => !same(p, c) && before[p.y * v.W + p.x] >= 0 && !(after[p.y * v.W + p.x] >= 0))) return false;
  return floor.props.filter(p => inRoom(room, p.x, p.y) && (p.lever || p.altar)).every(p => D4.some(([dx, dy]) => after[(p.y + dy) * v.W + p.x + dx] >= 0));
}

/** 1.7 puzzlePropKeepsRewardsOpen: furniture rule, and from the door every reward and the lever stay reachable. */
function keepsRewardsOpen(v, floor, room, c) {
  if (!furnitureKeepsOpen(v, floor, room, c)) return false;
  const door = room.puzzle.door, before = bfs(floor, door), k = c.y * floor.w + c.x, old = floor.tiles[k];
  floor.tiles[k] = T.WALL;
  const after = bfs(floor, door);
  floor.tiles[k] = old;
  const lever = room.puzzle.switch;
  if (lever && !D4.some(([dx, dy]) => after[(lever.y + dy) * floor.w + lever.x + dx] >= 0)) return false;
  return floor.items.filter(i => inRoom(room, i.x, i.y)).every(i => { const j = i.y * floor.w + i.x; return before[j] < 0 || after[j] >= 0; });
}

/** Rule 14: on each cell, 45% a gear piece +1, 30% essence 20-35 + 4 x floor, 25% one random mote. */
function pzLoot(pg, floor, cells, n) {
  for (let i = 0; i < n && i < cells.length; i++) {
    const c = cells[i], r = next(pg.rng);
    let item;
    if (r < 0.45) { item = randomGear(pg, pg.floorNo); if (!item.cursed) item.plus = Math.min(3, (item.plus ?? 0) + 1); }
    else if (r < 0.75) item = { kind: 'essence', n: roll(pg.rng, 20, 35) + pg.floorNo * 4 };
    else item = { kind: 'mote', el: ELEMENTS[Math.floor(next(pg.rng) * ELEMENTS.length)] };
    floor.items.push({ x: c.x, y: c.y, item, puzzle: true });
  }
}

/** 1.7 mainRoomCell: a random free floor cell of a room that is not a pocket and not the start. */
function mainRoomCell(pg, v, floor, rooms) {
  const out = [];
  for (let y = 0; y < floor.h; y++) for (let x = 0; x < floor.w; x++) {
    if (!v.freeCell(x, y)) continue;
    const r = v.roomAt(x, y);
    if (r && !r.pocket && r.role !== 'start') out.push({ x, y });
  }
  return out.length ? out[Math.floor(next(pg.rng) * out.length)] : null;
}

const addProp = (floor, x, y, id, extra = {}) => { const p = { id, x, y, ...extra }; floor.props.push(p); return p; };

/** Rule 45 (beta-world.js addPuzzleSwitch): the guardian shutoff lever on the farthest walkable free cell that keeps rewards open. */
function addSwitch(v, floor, rooms, room) {
  if (room.puzzle.switch) return;
  const cells = farFrom(pzCells(v, floor, rooms, room).filter(c => [T.FLOOR, T.WATER].includes(v.at(c.x, c.y)) && !v.propAt(c.x, c.y) && !v.itemAt(c.x, c.y)), room.puzzle.door)
    .filter(c => keepsRewardsOpen(v, floor, room, c));
  if (!cells.length) return;
  const c = cells[0];
  addProp(floor, c.x, c.y, 'lever-up', { keep: true, lever: true, puzzleSwitch: true, roomDoor: { ...room.puzzle.door } });
  room.puzzle.switch = { x: c.x, y: c.y };
}

/** Rule 45: cover pillars at the centre plus and minus 1 across the shorter axis, when they keep paths open. */
function guardianCover(v, floor, room) {
  const horizontal = room.w >= room.h;
  for (const n of [-1, 1]) {
    const c = horizontal ? { x: room.cx, y: room.cy + n } : { x: room.cx + n, y: room.cy };
    if (v.freeCell(c.x, c.y) && keepsRewardsOpen(v, floor, room, c)) addProp(floor, c.x, c.y, 'pillar', { keep: true, pillar: true });
  }
}

/** Rule 45: three reward cells, no two adjacent where possible. */
function guardianRewardCells(cells) {
  const chosen = [];
  for (const c of cells) if (chosen.length < 3 && !chosen.some(p => cheb(p, c) < 2)) chosen.push(c);
  for (const c of cells) if (chosen.length < 3 && !chosen.includes(c)) chosen.push(c);
  return chosen;
}

/** Rule 52 (1.7 libraryRewards('forbidden')): two sigils of 2+ motes from the forbidden list, distinct when possible, and a tome. */
function libraryRewards(pg) {
  const L = roomRows.rows.library.themes.forbidden;
  const exists = id => S[id]?.kind === 'sigil';
  const list = (L?.sigils ?? []).filter(exists);
  const first = gradeSigil(pg.rng, list);   // 1.7 librarySigil (sigil-grade.js)
  let pool = list.filter(id => (S[id].motes?.length ?? 0) >= 2);
  if (!pool.length) pool = Object.keys(S).filter(id => exists(id) && (S[id].motes?.length ?? 0) >= 2);
  const distinct = pool.filter(id => id !== first), from2 = distinct.length ? distinct : pool;
  const second = from2[Math.floor(next(pg.rng) * from2.length)];
  const out = [];
  if (first) out.push({ kind: 'sigil', id: first, count: 1 });
  if (second) out.push({ kind: 'sigil', id: second, count: 1 });
  out.push(randomGear(pg, pg.floorNo, { item: 'tome', uncursed: true }));
  return out;
}

/** Rules 10-17, 22-53: one sigil room of this kind, or nothing when no pocket fits. */
function buildSigilRoom(pg, floor, rooms, creatures, kind) {
  if (kind === 'everburn') kind = 'barricade';   // rule 9 (answer 18: everburn is an alias)
  const b = Math.floor((pg.floorNo - 1) / 5);
  if (kind === 'library' && b >= 2) kind = 'sentries';
  const gallery = ['sentries', 'sentinels', 'library'].includes(kind), rng = pg.rng;
  const pk = (gallery && carve(rng, floor, rooms, 6, 5, 7, 6)) || carve(rng, floor, rooms, 4, 3, 6, 5) || carve(rng, floor, rooms, 3, 3, 5, 4, null, { exhaustive: true });
  if (!pk) return null;
  const room = pk.room, door = pk.door, W = floor.w;
  room.special = 'puzzle';
  room.puzzle = { kind, solved: false, door: { ...door } };
  floor.tiles[door.y * W + door.x] = T.DOOR;
  const v = view(floor, rooms, creatures);
  const pz = () => pzCells(v, floor, rooms, room);
  let cells = farFrom(pz().filter(c => v.at(c.x, c.y) === T.FLOOR), door);
  const centre = { x: room.cx, y: room.cy };
  const nearest = (list, to) => list.slice().sort((a, b) => cheb(a, to) - cheb(b, to))[0];
  // One builder per kind (W6, world-24), each on this room's cells and view.
  const BUILD = {
    offering: () => {
      const bowl = nearest(cells.filter(c => v.freeCell(c.x, c.y) && cheb(c, door) > 1 && keepsRewardsOpen(v, floor, room, c)), centre);
      if (bowl) { addProp(floor, bowl.x, bowl.y, 'brazier-unlit', { keep: true, offeringBowl: true, light: { col: '#73EE75' }, noBurn: true }); room.puzzle.bowl = { ...bowl }; }
    },
    poisonvault: () => {
      pzLoot(pg, floor, cells, 3);
      const supply = pz().filter(c => v.at(c.x, c.y) === T.FLOOR && !v.propAt(c.x, c.y) && !v.itemAt(c.x, c.y)).sort((a, b) => cheb(a, door) - cheb(b, door))[0];
      if (supply) { floor.items.push({ x: supply.x, y: supply.y, item: { kind: 'sigil', id: 'firestorm', count: 1 }, puzzle: true }); room.puzzle.gasSigil = { ...supply }; }
      const gas = pz().filter(c => v.at(c.x, c.y) === T.FLOOR).map(c => c.y * W + c.x);
      floor.fields ??= [];
      floor.fields.push(vaultGas(gas, door));
    },
    chasm: () => {
      if (door.y === room.y - 1 || door.y === room.y + room.h) {
        const by = door.y === room.y - 1 ? room.y + 1 : room.y + room.h - 2;
        for (let x = room.x; x < room.x + room.w; x++) floor.tiles[by * W + x] = T.CHASM;
      } else {
        const bx = door.x === room.x - 1 ? room.x + 1 : room.x + room.w - 2;
        for (let y = room.y; y < room.y + room.h; y++) floor.tiles[y * W + bx] = T.CHASM;
      }
      cells = farFrom(pz().filter(c => v.at(c.x, c.y) === T.FLOOR), door).slice(0, Math.max(1, Math.floor(room.w * room.h / 3)));
      pzLoot(pg, floor, cells, 3);
    },
    drowned: () => {
      const dry = cells.slice(0, 3);
      for (const c of pz()) if (!dry.some(d => same(d, c))) { floor.tiles[c.y * W + c.x] = T.WATER; floor.ground[c.y * W + c.x] = 0; }
      room.deep = true;
      pzLoot(pg, floor, dry, 3);
    },
    barricade: () => {
      room.burning = true;
      pzLoot(pg, floor, cells, 3);
    },
    hoard: () => {
      const spots = cells.slice(0, 3);
      pzLoot(pg, floor, spots, 3);
      for (const c of spots) addProp(floor, c.x, c.y, 'ice-block', { keep: true, hoard: true });
      const fuel = nearest(cells.filter(c => v.freeCell(c.x, c.y) && man(c, door) >= 3), centre);
      if (fuel) { addProp(floor, fuel.x, fuel.y, 'barrel-explosive', { keep: true, puzzleSolution: true }); room.puzzle.fireBarrel = { ...fuel }; }
    },
    baths: () => {
      for (const c of pz()) if (v.at(c.x, c.y) === T.FLOOR && !floor.ground[c.y * W + c.x]) floor.ground[c.y * W + c.x] = G.PUDDLE;
      room.hot = true;
      pzLoot(pg, floor, cells, 3);
    },
    spikes: () => {
      const lootCells = cells.slice(0, 3);
      for (const c of pz()) if (!lootCells.some(l => same(l, c)) && v.at(c.x, c.y) === T.FLOOR) floor.traps.push({ x: c.x, y: c.y, kind: 'spikes', found: false, room: true, puzzle: true });
      pzLoot(pg, floor, lootCells, 3);
    },
    sentinels: () => {
      pzLoot(pg, floor, guardianRewardCells(cells), 3);
      addSwitch(v, floor, rooms, room);
      guardianCover(v, floor, room);
      let guards = 0;
      for (const g of cells.filter(c => v.freeCell(c.x, c.y))) if (guards < 2 && v.freeCell(g.x, g.y) && keepsRewardsOpen(v, floor, room, g)) { addProp(floor, g.x, g.y, 'statue', { keep: true, guardianStatue: true, sentinel: true }); guards++; }
    },
    darktraps: () => {
      room.dark = true;
      const lootCells = cells.slice(0, 3);
      pzLoot(pg, floor, lootCells, 3);
      const pool = pz().filter(c => !lootCells.some(l => same(l, c)) && man(c, door) > 1);
      shuffle(rng, pool);
      for (const c of pool.slice(0, 5)) floor.traps.push({ x: c.x, y: c.y, kind: ['fire', 'spark', 'dart'][Math.floor(next(rng) * 3)], found: false, heavy: true, room: true, puzzle: true });
      const ins = pk.inside, bx = ins.x + (ins.x === door.x ? 1 : 0), by = ins.y + (ins.y === door.y ? 1 : 0);
      if (!v.propAt(bx, by)) addProp(floor, bx, by, 'bones', {});
    },
    sentries: () => {
      pzLoot(pg, floor, guardianRewardCells(cells), 3);
      addSwitch(v, floor, rooms, room);
      guardianCover(v, floor, room);
      const eyes = edgeCells(floor, roomGrid(floor, rooms), room).filter(c => v.freeCell(c.x, c.y) && man(c, door) > 2);
      shuffle(rng, eyes);
      let placed = 0;
      for (const c of eyes) if (placed < 2 && v.freeCell(c.x, c.y) && keepsRewardsOpen(v, floor, room, c)) { addProp(floor, c.x, c.y, 'statue', { keep: true, guardianStatue: true, sentry: true, light: { col: '#FF5A4A' } }); placed++; }
    },
    library: () => {
      room.dark = true;
      addSwitch(v, floor, rooms, room);
      let sleepers = 0;
      for (const c of farFrom(pz().filter(c => v.freeCell(c.x, c.y)), door)) {
        if (sleepers >= 2) break;
        if (!v.freeCell(c.x, c.y)) continue;
        const keeper = makeCreature(b === 0 ? 'duskling' : 'stalker', c.x, c.y, { asleep: true });
        keeper.libraryRoom = { ...door };
        creatures.push(keeper); sleepers++;
      }
      const lc = cells.filter(c => v.freeCell(c.x, c.y));
      libraryRewards(pg).forEach((item, n) => { const c = lc[Math.min(n, lc.length - 1)] ?? door; floor.items.push({ x: c.x, y: c.y, item, puzzle: true }); });
      const shelves = edgeCells(floor, roomGrid(floor, rooms), room).filter(c => (c.y - room.y) % 3 === 0 && v.freeCell(c.x, c.y) && man(c, door) > 2 && !facesWall(floor, 'bookshelf', c.x, c.y)).sort((a, b) => a.y - b.y || a.x - b.x).slice(0, 4);
      for (const c of shelves) if (keepsRewardsOpen(v, floor, room, c)) addProp(floor, c.x, c.y, 'bookshelf', { keep: true });
    },
  };
  BUILD[kind]?.();
  // Rules 34, 41: the solution barrel (water in the burning room, poison in the baths), kept, never burning.
  if (kind === 'baths' || room.burning) {
    const supply = nearest(pz().filter(c => v.freeCell(c.x, c.y) && man(c, door) >= 3), centre);
    if (supply) {
      const id = kind === 'baths' ? 'barrel-poison' : 'barrel-water';
      addProp(floor, supply.x, supply.y, id, { keep: true, noBurn: true, puzzleSolution: true });
      room.puzzle.solution = { kind: id, x: supply.x, y: supply.y };
    }
  }
  if (room.burning) {   // rule 35: the room burns from the start
    floor.burning ??= {};
    for (const c of pz()) if (v.at(c.x, c.y) === T.FLOOR && !floor.props.some(p => same(p, c) && p.noBurn)) floor.burning[c.y * W + c.x] = { n: 3, player: false };
  }
  // Rule 16: the challenge chest replaces the reward farthest from the door.
  if (R[kind]?.challengeChest) {
    const rewards = floor.items.filter(i => inRoom(room, i.x, i.y) && v.at(i.x, i.y) === T.FLOOR && !v.propAt(i.x, i.y));
    const reward = farFrom(rewards, door)[0];
    if (reward) {
      floor.items.splice(floor.items.indexOf(reward), 1);
      floor.tiles[reward.y * W + reward.x] = T.CHEST;
      floor.chests.push({ x: reward.x, y: reward.y, kind: 'gold', mimic: false });
      room.puzzle.goldChest = { x: reward.x, y: reward.y };
    }
  }
  // Rule 15: the solving sigil (puzzles.json sigil), unidentified, on a free main-room cell (the poison vault placed its own).
  const use = kind === 'poisonvault' ? null : R[kind]?.sigil;
  if (use && S[use]) { const c = mainRoomCell(pg, v, floor, rooms); if (c) floor.items.push({ x: c.x, y: c.y, item: { kind: 'sigil', id: use, count: 1 }, solution: kind }); }
  (floor.notes ??= []).push('puzzle.' + kind);   // rule 17: the words are strings.json floor-note.puzzle.<kind> (U9)
  return room;
}

/** Rule 58: the class weapon (a cleric may get a sigil of 2+ motes instead). */
function treasuryWeapon(pg, cls, element) {
  const W7 = ['sword', 'dagger', 'mace', 'wand', 'longsword', 'axe', 'bow', 'staff', 'spear', 'censer'];
  const choices = { fighter: ['mace', 'axe'], warrior: ['mace', 'axe'], scoundrel: ['bow', 'dagger'], mage: ['wand', 'staff'], cleric: ['censer', 'sigil'], tourist: W7 };
  const list = choices[cls] ?? choices.fighter, key = list[Math.floor(next(pg.rng) * list.length)];
  if (key === 'sigil') {
    const two = Object.keys(S).filter(id => S[id]?.kind === 'sigil' && (S[id].motes?.length ?? 0) >= 2);
    return { kind: 'sigil', id: two[Math.floor(next(pg.rng) * two.length)], count: 1 };
  }
  const b = Math.floor((pg.floorNo - 1) / 5);
  const it = randomGear(pg, pg.floorNo, { item: key, tier: Math.min(3, 2 + Math.floor(b / 2)), uncursed: true });
  it.plus = 2 + b; it.enchant = element; it.cursed = false; it.known = false;
  return it;
}

/** A ring or an amulet, 50/50 (rings.json and amulets.json make them; giveOf records them until it does). */
function trinket(pg) {
  const kind = next(pg.rng) < 0.5 ? 'ring' : 'amulet';
  return giveOf(pg, { [kind]: 'random', cursedPct: 0 }, pg.floorNo)[0] ?? null;
}

/** Rules 57-58: the elemental treasury; false (and the pocket filled back in) when no lock fits. */
function buildTreasury(pg, floor, rooms, creatures, cls) {
  const pk = carve(pg.rng, floor, rooms, 4, 3, 5, 4, null, { exhaustive: true });
  if (!pk) return false;
  const room = pk.room, W = floor.w, b = Math.floor((pg.floorNo - 1) / 5);
  const element = ELEMENTS[Math.floor(next(pg.rng) * ELEMENTS.length)], cost = b + 1;
  const v = view(floor, rooms, creatures);
  const lockData = { keep: true, element, moteCost: cost, motesOnly: true, door: { ...pk.door } };
  const grid = roomGrid(floor, rooms);   // the lock never stands in a way in (a corridor mouth or beside a door): Dungeon robot, seed 277166
  const fits = c => { const owner = c && v.roomAt(c.x, c.y); return !!owner && v.freeCell(c.x, c.y) && !nearDoor(floor, grid, c.x, c.y) && furnitureKeepsOpen(v, floor, owner, c); };
  let lock = null;
  for (let a = 0; a < 80 && !lock; a++) { const c = mainRoomCell(pg, v, floor, rooms); if (fits(c)) lock = addProp(floor, c.x, c.y, 'elemental-lock', lockData); }
  if (!lock && fits(pk.inside)) lock = addProp(floor, pk.inside.x, pk.inside.y, 'elemental-lock', lockData);
  if (!lock) {
    for (let y = room.y; y < room.y + room.h; y++) for (let x = room.x; x < room.x + room.w; x++) floor.tiles[y * W + x] = T.WALL;
    rooms.splice(rooms.indexOf(room), 1);
    return false;
  }
  room.special = 'elemental-treasure'; room.rareEvent = true;
  floor.tiles[pk.door.y * W + pk.door.x] = T.SEALED;
  const cells = farFrom(pzCells(v, floor, rooms, room).filter(c => v.freeCell(c.x, c.y)), pk.door);
  const rewards = [treasuryWeapon(pg, cls, element), trinket(pg)];
  for (let i = 0; i < 3; i++) rewards.push({ kind: 'essence', n: roll(pg.rng, 30, 50) + pg.floorNo * 5 });
  let n = 0;
  for (const it of rewards) { if (!it) continue; const c = cells[n++]; if (c) floor.items.push({ x: c.x, y: c.y, item: it, treasury: true }); }
  floor.treasury = { room: { x: room.x, y: room.y, w: room.w, h: room.h }, door: { ...pk.door }, lock: { x: lock.x, y: lock.y }, element, moteCost: cost, opened: false };
  (floor.notes ??= []).push({ id: 'treasury', cost, element });
  return true;
}

/** Rules 55-56: the crystal vault behind a crystal door, three treasures under crystal markers, the key about the floor. */
function buildCrystalVault(pg, floor, rooms, creatures) {
  const pk = carve(pg.rng, floor, rooms, 4, 3, 6, 4) || carve(pg.rng, floor, rooms, 3, 3, 5, 4, null, { exhaustive: true });
  if (!pk) return false;
  const room = pk.room, W = floor.w;
  room.special = 'crystal';
  floor.tiles[pk.door.y * W + pk.door.x] = T.SEALED;
  const v = view(floor, rooms, creatures);
  const cells = farFrom(pzCells(v, floor, rooms, room).filter(c => v.freeCell(c.x, c.y)), pk.door).slice(0, 3);
  cells.forEach((c, i) => {
    let it;
    if (i === 0) { it = randomGear(pg, pg.floorNo, { uncursed: true }); it.cursed = false; it.plus = Math.min(3, Math.max(0, it.plus ?? 0) + 1); }
    else if (i === 1) it = trinket(pg) ?? { kind: 'essence', n: 60 };
    else it = next(pg.rng) < 0.5 ? { kind: 'mote', el: ELEMENTS[Math.floor(next(pg.rng) * ELEMENTS.length)] } : { kind: 'essence', n: roll(pg.rng, 60, 90) + pg.floorNo * 10 };
    floor.items.push({ x: c.x, y: c.y, item: it, crystal: true });
    addProp(floor, c.x, c.y, 'crystal-violet', { flat: true, light: { col: '#9FE8FF', dim: true }, dim: true, keep: true, crystalVault: true });
  });
  const k = mainRoomCell(pg, v, floor, rooms);
  if (k) floor.items.push({ x: k.x, y: k.y, item: { kind: 'key', key: 'crystal' } });
  floor.crystalVault = { room: { x: room.x, y: room.y, w: room.w, h: room.h }, door: { ...pk.door }, opened: false, claimed: false };
  (floor.notes ??= []).push('crystal-vault');
  return true;
}

/**
 * Rules 7-8: the puzzle pass of one floor. `rooms` are the generator's room objects (pockets join them); `creatures`
 * gets the library's keepers. Returns what was built, for the census.
 */
export function buildPuzzles(floor, rooms, creatures, { floorNo, floorSeed, runSeed, boss, cls = 'fighter', gen }) {
  floor.puzzles = [];
  // The sandbox's preview of one puzzle kind (1.7 puzzles.js:35) replaces the run's plan for this floor.
  const forced = forcedKind(gen, 'puzzle');
  const plan = forced ? (forced === 'crystal-vault' ? { crystal: true } : forced === 'elemental-treasury' ? { elementalTreasure: true } : { sigilRoom: forced }) : planForFloor(runSeed, floorNo, boss);
  if (!plan) return null;
  const made = kind => { if (forced && kind) forcedBuilt(gen); return kind; };
  const pg = { rng: stream(((floorSeed >>> 0) ^ 0x51c1) >>> 0), floorNo, seed: runSeed, run: gen?.run ?? {}, unbuilt: gen?.unbuilt ?? {}, masterworks: gen?.masterworks ?? {} };
  if (plan.sigilRoom) {
    const room = buildSigilRoom(pg, floor, rooms, creatures, plan.sigilRoom);
    if (room) floor.puzzles.push({ kind: room.puzzle.kind, x: room.x, y: room.y, w: room.w, h: room.h, cx: room.cx, cy: room.cy, ...room.puzzle, dark: !!room.dark, deep: !!room.deep, hot: !!room.hot, burning: !!room.burning });
    return made(room ? room.puzzle.kind : false);
  }
  if (plan.crystal) return made(buildCrystalVault(pg, floor, rooms, creatures) ? 'crystal' : false);
  if (plan.elementalTreasure) return made(buildTreasury(pg, floor, rooms, creatures, cls) ? 'elemental-treasure' : false);   // false: planned, not built (the attempt is taken again)
  return null;
}
