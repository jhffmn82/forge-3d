// Three more Crypt rooms (Justin 2026-10-16, sandbox pick C8: "c8, yes"). Not in 1.7; built here in the Crypt's
// own pieces and creatures, through the registry's `specials` hook from the shared roll (src/world/specials.js pool).
//   ossuary        bone walls: skeleton niches set in its top wall, bone piles along its sides, bones over the floor,
//                  two sleeping skeletons (and a sleeping Bone Archer from floor 7), an essence cache at the far end.
//   flooded-crypt  grave ooze over the room but for a dry path from the way in to an open sarcophagus and a chest;
//                  a Grave Bloat dozes in the ooze.
//   choir-loft     a grave monument at the head of the room, candles along the walls, three Necro-Acolytes asleep
//                  in a row before it, a sigil on the monument's step.
// Draws only from the generation stream.

import { next, roll, pick } from '../../../lib/rng.js';
import { makeCreature } from '../../../rules/monsters.js';
import { giveOf } from '../../../rules/loot.js';
import { T, G } from '../../../data/tiles.js';
import { placePiece } from './hall.js';
import { D4 } from '../../../lib/geometry.js';
import { distanceField } from '../../../lib/grid.js';

const DOORS = new Set([T.DOOR, T.OPEN_DOOR, T.LOCKED, T.TOLL, T.SEALED, T.SECRET]);
const at = (f, x, y) => (x < 0 || y < 0 || x >= f.w || y >= f.h ? T.WALL : f.tiles[y * f.w + x]);
const free = (f, x, y) => at(f, x, y) === T.FLOOR && !f.props.some(p => p.x === x && p.y === y) && !f.items.some(i => i.x === x && i.y === y) && !(f.chests ?? []).some(c => c.x === x && c.y === y);
const byDoor = (f, x, y) => { for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (DOORS.has(at(f, x + dx, y + dy))) return true; return false; };
const inside = (r, x, y) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
const cellsOf = r => { const o = []; for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) o.push({ x, y }); return o; };
const resident = (kind, c) => Object.assign(makeCreature(kind, c.x, c.y, { asleep: true }), { resident: true });
/** The room's ways in: its cells with an open neighbour or a door outside the room. */
const mouths = (f, r) => cellsOf(r).filter(c => at(f, c.x, c.y) === T.FLOOR && D4.some(([dx, dy]) => !inside(r, c.x + dx, c.y + dy) && (at(f, c.x + dx, c.y + dy) === T.FLOOR || DOORS.has(at(f, c.x + dx, c.y + dy)))));
/** Walking distance inside the room from a set of cells, read as dep({x, y}) (-1: not reached). */
function depth(f, r, from, blocked = null) {
  const W = f.w, d = distanceField(W, f.h, from.map(c => c.y * W + c.x), k => { const x = k % W, y = (k / W) | 0; return inside(r, x, y) && at(f, x, y) === T.FLOOR && !blocked?.has(k); });
  return c => d[c.y * W + c.x];
}

function ossuary(gen, f, rooms, host, out) {
  const rng = gen.rng, W = f.w;
  host.special = 'ossuary';
  // Bone walls: niches with their dead set into the top wall, bone piles against the side walls.
  for (let x = host.x; x < host.x + host.w; x++) if (at(f, x, host.y - 1) === T.WALL && at(f, x, host.y) === T.FLOOR && !byDoor(f, x, host.y) && !f.props.some(p => p.x === x && p.y === host.y - 1) && next(rng) < 0.7)
    f.props.push({ id: 'skeleton-niche', x, y: host.y - 1, wall: true, keep: true, set: true });
  for (let y = host.y + 1; y < host.y + host.h - 1; y++) for (const x of [host.x, host.x + host.w - 1])
    if (free(f, x, y) && !byDoor(f, x, y) && next(rng) < 0.45) f.props.push({ id: 'bone-pile', x, y, keep: true, set: true });
  // An ossuary always shows its bones (the 8 x 8 cap leaves small rooms where the draws can miss): the first niche cell,
  // else the first side cell, without a draw.
  const bones = p => (p.id === 'skeleton-niche' && p.y === host.y - 1 && p.x >= host.x && p.x < host.x + host.w) || (p.id === 'bone-pile' && p.x >= host.x && p.x < host.x + host.w && p.y >= host.y && p.y < host.y + host.h);
  if (!f.props.some(bones)) {
    let x = host.x;
    while (x < host.x + host.w && !(at(f, x, host.y - 1) === T.WALL && at(f, x, host.y) === T.FLOOR && !byDoor(f, x, host.y) && !f.props.some(p => p.x === x && p.y === host.y - 1))) x++;
    if (x < host.x + host.w) f.props.push({ id: 'skeleton-niche', x, y: host.y - 1, wall: true, keep: true, set: true });
    else for (let y = host.y + 1; y < host.y + host.h - 1 && !f.props.some(bones); y++) for (const sx of [host.x, host.x + host.w - 1]) if (free(f, sx, y) && !byDoor(f, sx, y)) { f.props.push({ id: 'bone-pile', x: sx, y, keep: true, set: true }); break; }
  }
  for (const c of cellsOf(host)) if (at(f, c.x, c.y) === T.FLOOR && next(rng) < 0.55) f.ground[c.y * W + c.x] = G.BONES;
  const d = depth(f, host, mouths(f, host)), far = cellsOf(host).filter(c => free(f, c.x, c.y) && d(c) >= 0).sort((a, b) => d(b) - d(a));
  if (far[0]) f.items.push({ x: far[0].x, y: far[0].y, item: { kind: 'essence', n: roll(rng, 15, 30) + gen.floorNo } });
  const spots = far.slice(1).filter(c => !byDoor(f, c.x, c.y));
  for (const kind of ['skeleton', 'skeleton', ...(gen.floorNo >= 7 ? ['bonearcher'] : [])]) { const c = spots.splice(Math.floor(next(rng) * Math.min(spots.length, 6)), 1)[0]; if (c) out.push(resident(kind, c)); }
  (f.notes ??= []).push('ossuary');
  return true;
}

function floodedCrypt(gen, f, rooms, host, out) {
  const rng = gen.rng, W = f.w;
  if (host.w < 4 || host.h < 4) return false;
  const ways = mouths(f, host);
  if (!ways.length) return false;
  const cx = host.x + (host.w >> 1), cy = host.y + (host.h >> 1);
  if (!free(f, cx, cy) || !free(f, cx, cy + 1)) return false;
  host.special = 'flooded-crypt';
  placePiece(f, 'sarc', cx, cy - 1, 1, 2, { kind: 'open', horiz: false, seed: Math.floor(next(rng) * 97), keep: true });
  // The chest beside the sarcophagus.
  const chestAt = [{ x: cx + 1, y: cy }, { x: cx - 1, y: cy }].find(c => free(f, c.x, c.y)) ?? null;
  if (chestAt) { f.tiles[chestAt.y * W + chestAt.x] = T.CHEST; (f.chests ??= []).push({ x: chestAt.x, y: chestAt.y, kind: 'ornate', mimic: false }); }
  // The dry path: the shortest walk round the pieces from each way in to the sarcophagus's foot, and the cell below
  // the chest.
  const foot = { x: cx, y: cy + 1 }, path = new Set([`${foot.x},${foot.y}`]);
  if (chestAt) path.add(`${chestAt.x},${chestAt.y + 1}`);
  const d = depth(f, host, [foot], new Set(f.props.map(p => p.y * f.w + p.x)));
  for (const m of ways) {
    let c = m;
    if (!(d(c) >= 0)) continue;
    for (let g = 0; g < 200 && d(c) > 0; g++) {
      path.add(`${c.x},${c.y}`);
      c = D4.map(([dx, dy]) => ({ x: c.x + dx, y: c.y + dy })).find(n => d(n) === d(c) - 1);
    }
  }
  for (const c of cellsOf(host)) {
    const k = c.y * W + c.x;
    if (at(f, c.x, c.y) !== T.FLOOR || path.has(`${c.x},${c.y}`) || f.props.some(p => p.x === c.x && p.y === c.y)) continue;
    (f.ooze ??= []).push(k); f.ground[k] = 0;
  }
  const wet = cellsOf(host).filter(c => (f.ooze ?? []).includes(c.y * W + c.x) && free(f, c.x, c.y) && !byDoor(f, c.x, c.y));
  if (wet.length) out.push(resident('gravebloat', pick(rng, wet)));
  (f.notes ??= []).push('flooded-crypt');
  return true;
}

function choirLoft(gen, f, rooms, host, out) {
  const rng = gen.rng;
  if (host.w < 6 || host.h < 5) return false;
  const mx = host.x + (host.w >> 1) - 1, my = host.y;
  for (const c of [[0, 0], [1, 0], [0, 1], [1, 1]]) if (!free(f, mx + c[0], my + c[1]) || byDoor(f, mx + c[0], my + c[1])) return false;
  host.special = 'choir-loft';
  placePiece(f, 'grave-monument', mx, my, 2, 2, { keep: true, set: true });
  // Candles along both side walls.
  for (let y = host.y + 1; y < host.y + host.h - 1; y++) for (const x of [host.x, host.x + host.w - 1])
    if (free(f, x, y) && !byDoor(f, x, y) && next(rng) < 0.55) f.props.push({ id: 'candles-' + (1 + Math.floor(next(rng) * 4)), x, y, keep: true, set: true });
  // The sigil on the step; the choir in a row below it.
  const step = { x: mx + (next(rng) < 0.5 ? 0 : 1), y: my + 2 };
  if (free(f, step.x, step.y)) for (const it of giveOf(gen, { sigil: 'random' }, gen.floorNo)) f.items.push({ x: step.x, y: step.y, item: it });
  const row = [];
  for (let x = host.x + 1; x < host.x + host.w - 1; x++) if (free(f, x, my + 3) && !byDoor(f, x, my + 3)) row.push({ x, y: my + 3 });
  const mid = mx + 0.5;
  row.sort((a, b) => Math.abs(a.x - mid) - Math.abs(b.x - mid));
  for (const c of row.slice(0, 3)) out.push(resident('acolyte', c));
  (f.notes ??= []).push('choir-loft');
  return true;
}

export const CRYPT_ROOMS = { ossuary, 'flooded-crypt': floodedCrypt, 'choir-loft': choirLoft };
