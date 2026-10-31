// Pockets carved off a room (spec/world.md W24-W30): the locked vault, the toll room and the hidden room, and the
// iron key's holder (W26). Draws only from the generation stream it is given.

import props from '../../data/props.json' with { type: 'json' };
import { next, roll, shuffle, pick } from '../lib/rng.js';
import roomData from '../../data/rooms.json' with { type: 'json' };
import foods from '../../data/foods.json' with { type: 'json' };
import { rollTable, giveOf, ELEMENTS } from '../rules/loot.js';
import { makeItem } from '../rules/items.js';
import { makeCreature } from '../rules/monsters.js';
import { T, G } from '../data/tiles.js';
import { nearDoor, roomGrid } from './dress.js';
import { hiddenTheme, forcedKind, forcedBuilt } from './rare.js';
import { oozeField } from './fields.js';
import { cheb, D4 } from '../lib/geometry.js';
import { distanceField } from '../lib/grid.js';
import { propBlocks } from '../data/props.js';

const rooms_ = roomData.rows, foodRows = foods.rows;


/** W24: a w x h pocket behind one wall tile on a host room's edge, in solid rock; null after 260 tries. */
export function carve(rng, floor, rooms, minW, minH, maxW, maxH, avoid, { exhaustive = false } = {}) {
  const W = floor.w, H = floor.h, at = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? T.WALL : floor.tiles[y * W + x]);
  const explosiveNear = (x, y) => floor.props.some(p => Math.max(Math.abs(p.x - x), Math.abs(p.y - y)) <= 1 && props.rows[p.id]?.explodes);
  const hostOK = host => !(host.role === 'start' || host.role === 'boss' || host.pocket || avoid?.(host));
  /** A w x h pocket on `side` of host, its door at the side's step `d`, shifted by `o`: carved, or null if it does not fit. */
  const tryAt = (host, w, h, side, d, o) => {
    let rx, ry, dx, dy;
    if (side === 0) { dx = host.x + d; dy = host.y - 1; rx = dx - o; ry = dy - h; }
    else if (side === 1) { dx = host.x + d; dy = host.y + host.h; rx = dx - o; ry = dy + 1; }
    else if (side === 2) { dx = host.x - 1; dy = host.y + d; rx = dx - w; ry = dy - o; }
    else { dx = host.x + host.w; dy = host.y + d; rx = dx + 1; ry = dy - o; }
    if (rx < 2 || ry < 2 || rx + w > W - 2 || ry + h > H - 2 || at(dx, dy) !== T.WALL) return null;
    for (let y = ry - 1; y <= ry + h; y++) for (let x = rx - 1; x <= rx + w; x++) if (!(x === dx && y === dy) && at(x, y) !== T.WALL) return null;
    const inside = side === 0 ? { x: dx, y: dy + 1 } : side === 1 ? { x: dx, y: dy - 1 } : side === 2 ? { x: dx + 1, y: dy } : { x: dx - 1, y: dy };
    if (at(inside.x, inside.y) !== T.FLOOR || floor.props.some(p => p.x === inside.x && p.y === inside.y) || explosiveNear(inside.x, inside.y)) return null;
    for (let y = ry; y < ry + h; y++) for (let x = rx; x < rx + w; x++) floor.tiles[y * W + x] = T.FLOOR;
    const room = { x: rx, y: ry, w, h, cx: rx + (w >> 1), cy: ry + (h >> 1), pocket: true, role: null, inside };
    rooms.push(room);
    return { room, door: { x: dx, y: dy }, host, inside };
  };
  for (let t = 0; t < 260; t++) {
    const host = pick(rng, rooms);
    if (!hostOK(host)) continue;
    const w = roll(rng, minW, maxW), h = roll(rng, minH, maxH), side = Math.floor(next(rng) * 4);
    const d = side < 2 ? roll(rng, 0, host.w - 1) : roll(rng, 0, host.h - 1), o = side < 2 ? roll(rng, 0, w - 1) : roll(rng, 0, h - 1);
    const pk = tryAt(host, w, h, side, d, o);
    if (pk) return pk;
  }
  // A planned room that must not be lost (the puzzle pass): every host, side, step, offset and size, largest first.
  if (exhaustive) for (const host of rooms.filter(hostOK)) for (let w = maxW; w >= minW; w--) for (let h = maxH; h >= minH; h--) for (let side = 0; side < 4; side++) {
    for (let d = 0; d < (side < 2 ? host.w : host.h); d++) for (let o = 0; o < (side < 2 ? w : h); o++) { const pk = tryAt(host, w, h, side, d, o); if (pk) return pk; }
  }
  return null;
}

const cellsOf = r => { const out = []; for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) out.push({ x, y }); return out; };

/** W25, W28: a rich loot pile: an ornate chest and one roll on loot-room-pile. */
function lootPile(gen, floor, room, floorNo) {
  const cells = shuffle(gen.rng, cellsOf(room));
  const c = cells.pop();
  floor.tiles[c.y * floor.w + c.x] = T.CHEST;
  floor.chests.push({ x: c.x, y: c.y, kind: 'ornate', mimic: false });
  for (const drop of rollTable(gen, 'loot-room-pile', floorNo)) { const p = cells.pop(); if (p) floor.items.push({ x: p.x, y: p.y, item: drop }); }
  return cells;
}

/** W25-W29: the vault (floor 2+), the toll room (floor 3+, 55%), the hidden room (45%). Returns the bodies placed. */
export function carvePockets(gen, floor, rooms, floorNo) {
  const rng = gen.rng;
  if (floorNo >= 2) {
    const pk = carve(rng, floor, rooms, 3, 3, 5, 4);
    if (pk) {
      floor.tiles[pk.door.y * floor.w + pk.door.x] = T.LOCKED; pk.room.special = 'vault'; floor.vault = true;
      const left = lootPile(gen, floor, pk.room, floorNo);
      // Never beside a door (1.7 decorateEdges' edge cells skip those): a torch inside the doorway shut the whole vault.
      const grid = roomGrid(floor, rooms);
      const edge = left.filter(c => (c.x === pk.room.x || c.y === pk.room.y || c.x === pk.room.x + pk.room.w - 1 || c.y === pk.room.y + pk.room.h - 1) && !nearDoor(floor, grid, c.x, c.y));
      if (edge.length) floor.props.push({ id: 'torch-stand', x: edge[0].x, y: edge[0].y, keep: true });
    }
  }
  if (floorNo >= 3 && next(rng) < 0.55) {
    const pk = carve(rng, floor, rooms, 3, 3, 5, 4);
    if (pk) {
      floor.tiles[pk.door.y * floor.w + pk.door.x] = T.TOLL; pk.room.special = 'toll';
      const left = lootPile(gen, floor, pk.room, floorNo);
      if (left.length) floor.items.push({ x: left[0].x, y: left[0].y, item: { kind: 'mote', el: pick(rng, ELEMENTS) } });
    }
  }
  // R7, rules 60-67: the 45% roll is drawn every floor; a hidden sigil theme due here forces the room and dresses it.
  const plain = next(rng) < rooms_['hidden-room'].chancePctPerFloor / 100, theme = forcedKind(gen, 'hidden') ?? hiddenTheme(gen.runSeed, floorNo);   // the sandbox's preview first (1.7 rare-rooms.js:20)
  if (theme) return hiddenSigilRoom(gen, floor, rooms, theme);
  if (plain) {
    const pk = carve(rng, floor, rooms, 2, 2, 4, 3);
    if (pk) {
      floor.tiles[pk.door.y * floor.w + pk.door.x] = T.SECRET; pk.room.special = 'hidden';
      floor.ground[pk.inside.y * floor.w + pk.inside.x] = G.TELL;   // never blind searching: a tell before the wall
      const c = shuffle(rng, cellsOf(pk.room));
      if (c[0]) { floor.tiles[c[0].y * floor.w + c[0].x] = T.CHEST; floor.chests.push({ x: c[0].x, y: c[0].y, kind: 'wood', mimic: false }); }
      if (c[1]) floor.items.push({ x: c[1].x, y: c[1].y, item: { kind: 'essence', n: roll(rng, 15, 30) } });
    }
  }
  return [];
}

const GROUND = { moss: G.MOSS, bones: G.BONES, grass: G.GRASS };

/**
 * S45-S46, rules 63-66: a themed hidden sigil room (rooms.json hidden-<theme>) behind a secret wall with a tell. The
 * sigil on the cell farthest from the door; the theme's extras on the next farthest; ground on every cell; the props
 * on the farthest cells left that are not beside the door, a blocking one only where every open cell stays reachable.
 * Returns the bodies it places (the Slime Chamber's slimes).
 */
function hiddenSigilRoom(gen, floor, rooms, theme) {
  const rng = gen.rng, row = rooms_[`hidden-${theme}`], W = floor.w, out = [];
  const [w0, w1] = [row.pocket.w].flat(), [h0, h1] = [row.pocket.h].flat();
  const pk = carve(rng, floor, rooms, w0, h0, w1 ?? w0, h1 ?? h0, h => !!h.role);
  if (!pk) return out;
  if (forcedKind(gen, 'hidden') === theme) forcedBuilt(gen);
  const r = pk.room;
  floor.tiles[pk.door.y * W + pk.door.x] = T.SECRET; r.special = 'hidden';
  floor.ground[pk.inside.y * W + pk.inside.x] = G.TELL;
  const cells = cellsOf(r).sort((a, b) => cheb(b, pk.door) - cheb(a, pk.door)), prize = cells[0];
  r.hiddenSigil = { id: theme, name: row.name, sigil: row.sigil, door: pk.door, tell: pk.inside, reward: { x: prize.x, y: prize.y } };
  const reserved = new Set([`${prize.x},${prize.y}`]);
  const put = (n, it) => { const c = cells[n] ?? prize; floor.items.push({ x: c.x, y: c.y, item: it }); reserved.add(`${c.x},${c.y}`); };
  put(0, { kind: 'sigil', id: row.sigil, count: 1 });
  if (theme === 'last-expedition') {
    // Two different buff foods of the Dungeon (1.7 FOODS with a buff, biome 0 or none) and the expedition ring.
    const foods = shuffle(rng, Object.keys(foodRows).filter(k => foodRows[k].special && (foodRows[k].biome == null || foodRows[k].biome === 1)));
    const ring = giveOf(gen, { ring: 'random', cursedPct: 0, plusAtLeast: 2 }, gen.floorNo);   // rings unbuilt: recorded
    [{ ...makeItem(foods[0]), count: 1 }, { ...makeItem(foods[1] ?? foods[0]), count: 1 }, ...ring].forEach((it, n) => put(n + 1, it));
  }
  if (theme === 'petrified-shrine') for (let n = 0; n < 3; n++) put(n + 1, { kind: 'mote', el: 'earth' });
  if (theme === 'fungal-pantry') ['skewer', 'skewer', 'glowstew'].forEach((id, n) => put(n + 1, { ...makeItem(id), count: 1 }));
  const nearDoor = c => cheb(c, pk.door) <= 1;
  if (theme === 'slime-chamber') {
    r.slimeChamber = true;
    for (const c of cells) (floor.ooze ??= []).push(c.y * W + c.x);
    (floor.fields ??= []).push(oozeField(cells.map(c => c.y * W + c.x)));
    for (const c of cells) { const m = makeCreature('greenslime', c.x, c.y, { asleep: true }); m.guard = true; m.resident = true; out.push(m); }
  } else {
    for (const c of cells) floor.ground[c.y * W + c.x] = GROUND[row.ground];
    const corners = cells.filter(c => !reserved.has(`${c.x},${c.y}`) && !nearDoor(c));
    for (const id of row.props ?? []) {
      const c = corners.shift();
      if (!c) break;
      const p = { id, x: c.x, y: c.y, keep: true, ...(theme === 'cleansing-shrine' && id === 'fountain' ? { cleansingShrine: true } : {}) };
      floor.props.push(p);
      if (props.rows[id]?.blocks && !pocketOpen(floor, r, pk)) floor.props.pop();
    }
  }
  if (theme === 'fungal-pantry') {
    const left = shuffle(rng, cells.filter(c => !reserved.has(`${c.x},${c.y}`) && !nearDoor(c) && !floor.props.some(p => p.x === c.x && p.y === c.y)));
    left.slice(0, Math.ceil(left.length * 0.75)).forEach((c, n) => floor.props.push({ id: n % 3 === 0 ? 'glow-mushrooms' : 'mushrooms', x: c.x, y: c.y, keep: true, flat: true }));
  }
  return out;
}

/** P4 for a pocket: every open cell reachable from the door before the props stays reachable. */
function pocketOpen(floor, r, pk) {
  const W = floor.w, block = new Set(floor.props.filter(p => propBlocks(p)).map(p => p.y * W + p.x));
  const inR = (x, y) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
  const start = D4.map(([dx, dy]) => ({ x: pk.door.x + dx, y: pk.door.y + dy })).find(c => inR(c.x, c.y));
  if (!start || block.has(start.y * W + start.x)) return false;
  const seen = distanceField(W, floor.h, start.y * W + start.x, k => inR(k % W, (k / W) | 0) && !block.has(k)).filter(d => d >= 0).length;
  return seen === r.w * r.h - [...block].filter(k => inR(k % W, (k / W) | 0)).length;
}

/** W26: a foe on the hero's side of every iron door carries the key (goblins, archers, brutes first); else it lies about. */
export function placeKey(rng, floor, creatures, start) {
  if (!floor.vault) return;
  const W = floor.w, shut = [T.LOCKED, T.WALL, T.SECRET, T.TOLL], ok = distanceField(W, floor.h, start.y * W + start.x, i => !shut.includes(floor.tiles[i]));
  const near = creatures.filter(c => ok[c.y * W + c.x] >= 0 && !c.boss && c.side !== 'neutral');
  const pref = near.filter(c => ['goblin', 'archer', 'brute'].includes(c.kind));
  const pool = pref.length ? pref : near;
  if (pool.length) { const c = pick(rng, pool); c.key = true; c.name += ' (key holder)'; return; }
  for (let t = 0; t < 80; t++) {
    const r = pick(rng, floor.rooms);
    const x = r.x + roll(rng, 0, r.w - 1), y = r.y + roll(rng, 0, r.h - 1);
    if (ok[y * W + x] >= 0 && floor.tiles[y * W + x] === T.FLOOR && !floor.items.some(i => i.x === x && i.y === y)) { floor.items.push({ x, y, item: { kind: 'key' } }); return; }
  }
}
