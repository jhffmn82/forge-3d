// Floor 10, Morty's burial hall (spec/world.md Crypt 13-20, 25, 56; floors.json crypt-boss-hall, crypt-hall-terrain;
// bosses.json morty): the BSP approach in a 25 x 22 corner, the 28 x 24 hall stamped against the east edge, its
// hallway tunnelled down, west and up into the approach room furthest east; then the hall's set pieces, ooze,
// the exit gate in the east chapel, Morty on his throne, his phylactery and two sleeping skeleton guards.
// (1.7 stampCryptHall / stampCryptBossHall / populateCryptGuardian, js/world/biomes/crypt/cryptset.js:262-331,
// crypt.js:417-425 @3c8b312.)

import floors from '../../../../data/floors.json' with { type: 'json' };
import bosses from '../../../../data/bosses.json' with { type: 'json' };
import { next } from '../../../lib/rng.js';
import { layoutDungeon } from '../../layout.js';
import { makeCreature } from '../../../rules/monsters.js';
import { T } from '../../../data/tiles.js';
import { hash2 } from '../../../lib/noise.js';
import { propBlocks } from '../../../data/props.js';
import { bossBody, guardBody, phylacteryFields } from '../../boss.js';
import { placePiece as piece } from '../../pieces.js';

const HALL = floors.rows['crypt-boss-hall'];
const [HW, HH] = HALL.size;

/** The approach (BSP in the Crypt's boss corner), the stamped hall and its tunnel. The hall is the last room. */
export function cryptBossLayout(rng, cap = true) {
  const lay = layoutDungeon(rng, { boss: true, biome: 'crypt', cap });
  const W = lay.w, H = lay.h, ox = W - HW - 1, oy = (H - HH) >> 1, t = lay.tiles;
  const nearest = lay.rooms.slice().sort((a, b) => (b.x + b.w) - (a.x + a.w))[0];
  for (let y = 0; y < HH; y++) for (let x = 0; x < HW; x++) {
    const ch = HALL.grid[y][x];
    t[(oy + y) * W + ox + x] = ch === '#' ? T.WALL : ch === 'D' ? T.DOOR : T.FLOOR;
  }
  // Crypt 16: a 2-wide shaft down from the hallway's foot, 1 wide west along that row, then north into the room.
  const dig = (x, y) => { if (t[y * W + x] === T.WALL) t[y * W + x] = T.FLOOR; };
  const fx = ox + 13, fy = oy + HH - 1, low = Math.min(H - 2, fy + 2);
  for (let y = fy; y <= low; y++) { dig(fx, y); dig(fx + 1, y); }
  const tx = nearest.x + (nearest.w >> 1);
  for (let x = fx; x !== tx; x += x > tx ? -1 : 1) dig(x, low);
  for (let y = low; y >= nearest.y + nearest.h - 1; y--) dig(tx, y);
  const r = floors.rows['crypt-hall-terrain'].hallRoom;   // the hall's room record, relative to the stamp
  lay.rooms.push({ x: ox + r.x, y: oy + r.y, w: r.w, h: r.h, cx: ox + r.cx, cy: oy + r.cy, id: lay.rooms.length, hall: true, origin: { x: ox, y: oy } });
  return lay;
}

/** A piece and, for a multi-cell piece, its other cells (same id, `part` pointing at the head; they block as it does). */
export const placePiece = (floor, id, x, y, w = 1, h = 1, extra = {}) => piece(floor, id, x, y, { w, h, head: extra });

const NAMES = { 'urn-cluster': 'urn-group' };

/**
 * B1: the hall as the boss room. Returns { room, bodies } (Morty first, then the phylactery and the guards).
 * Everything the stamp places is kept (no later pass moves or thins it).
 */
export function buildMortyHall(rng, floor, rooms) {
  const room = rooms.find(r => r.hall), { x: ox, y: oy } = room.origin, W = floor.w;
  room.role = 'boss';
  for (const p of HALL.props) {
    const id = NAMES[p.name] ?? p.name, x = ox + p.x, y = oy + p.y;
    const extra = { keep: true, set: true };
    if (p.wall) extra.wall = true;
    if (p.name === 'urn-cluster') { const hh = hash2(x, y, 71); Object.assign(extra, { variant: Math.floor(hash2(x, y, 72) * 4), flip: hh >= 0.35 && hh < 0.7, lootPct: p.lootPct }); }
    if (p.soulSmoke) extra.soulSmoke = true;
    if (p.wisps) extra.wisps = true;
    if (p.webLeft !== undefined) extra.webLeft = p.webLeft;
    if (p.name === 'wall-plaque') extra.light = { col: '#7CFFA0', r: 1.8, s: 0.22, at: { x, y: y + 0.9 } };
    // CR12 (1.7 cryptset.js:25, :281-295): the wisp grave posts and the side chapels' soul urns burn dim (1.7's 2.8
    // tiles at 0.55), the top chapel's and the hall's urns at full; the rune tomb a small green glow at its foot.
    else if (typeof p.light === 'string') extra.light = { col: p.light, ...(p.dim ? { dim: true } : {}) };
    else if (p.name === 'tomb-rune' && p.light?.col) extra.light = { col: p.light.col, r: p.light.r, s: p.light.s, at: { x, y: y + (p.h ?? 1) - 0.2 } };
    placePiece(floor, id, x, y, p.w ?? 1, p.h ?? 1, extra);
  }
  (floor.ooze ??= []).push(...HALL.ooze.map(([x, y]) => (oy + y) * W + ox + x));
  const gate = { x: HALL.exitAt[0], y: HALL.exitAt[1] };
  floor.tiles[(oy + gate.y) * W + ox + gate.x] = T.EXIT;
  floor.exit = { x: ox + gate.x, y: oy + gate.y };
  floor.hallRect = { x: ox, y: oy, w: HW, h: HH };
  floor.bossRoom = { x: room.x, y: room.y, w: room.w, h: room.h };
  const B = bosses.rows.morty, at = { x: HALL.bossAt[0], y: HALL.bossAt[1] }, ph = { x: HALL.phylAt[0], y: HALL.phylAt[1] };
  const morty = bossBody('morty', 'morty', ox + at.x, oy + at.y, { rot: 0, phase: 0, turnN: 0 });
  const phyl = makeCreature('phylactery', ox + ph.x, oy + ph.y);
  Object.assign(phyl, phylacteryFields(morty));
  morty.phylactery = phyl.id;
  const bodies = [morty, phyl], taken = new Set([`${morty.x},${morty.y}`, `${phyl.x},${phyl.y}`]);
  const free = [];
  for (let y = room.y + 1; y < room.y + room.h - 1; y++) for (let x = room.x + 1; x < room.x + room.w - 1; x++) {
    if (floor.tiles[y * W + x] !== T.FLOOR || floor.props.some(p => p.x === x && p.y === y && propBlocks(p)) || taken.has(`${x},${y}`)) continue;
    free.push({ x, y });
  }
  for (const g of B.guards ?? []) for (let i = 0; i < g.count && free.length; i++) {
    const c = free.splice(Math.floor(next(rng) * free.length), 1)[0];
    bodies.push(guardBody(g, morty, c));
  }
  return { room, bodies };
}

/** Crypt 18: nothing the general passes scatter stays inside the hall's rectangle (traps, items, chests, ground). */
export function clearHall(floor) {
  const R = floor.hallRect;
  if (!R) return;
  const inR = o => o.x >= R.x && o.x < R.x + R.w && o.y >= R.y && o.y < R.y + R.h;
  floor.traps = floor.traps.filter(t => !inR(t));
  floor.items = floor.items.filter(i => !inR(i));
  floor.chests = (floor.chests ?? []).filter(c => !inR(c));
  for (let y = R.y; y < R.y + R.h; y++) for (let x = R.x; x < R.x + R.w; x++) {
    const k = y * floor.w + x;
    if (floor.tiles[k] === T.CHEST) floor.tiles[k] = T.FLOOR;
    floor.ground[k] = 0;
  }
}
