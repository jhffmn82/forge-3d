// The Dungeon boss room (spec/world.md W23, spec/bosses.md G1): Grukk on his throne with his guards asleep around
// him, braziers, banners and torches on the walls, the exit gate in the bottom wall's row, scattered bones and blood.

import bosses from '../../data/bosses.json' with { type: 'json' };
import rooms from '../../data/rooms.json' with { type: 'json' };
import { next, roll, pick } from '../lib/rng.js';
import { makeCreature } from '../rules/monsters.js';
import { T, G } from '../data/tiles.js';
import { decorateEdges, interiorCells, roomGrid } from './dress.js';

const ROOM = rooms.rows['boss-dungeon'].layout;

/** A boss on its throne at (x, y), awake and waiting for the hero (W6, world-16: one setup for every hall); extra: the
 *  boss's own fields (Grukk's and Morty's rot and phase, the Matron's phase). */
export const bossBody = (kind, set, x, y, extra = {}) => Object.assign(makeCreature(kind, x, y), bossFields(set, extra));
/** The fields that make a body its floor's boss (the sandbox sets them on a body it spawned: off the throne, hunting). */
export const bossFields = (set, extra = {}) => ({ set, throne: true, asleep: false, hunting: false, ...extra });
/** Morty's phylactery, an object that guards him (crypt/hall.js; the sandbox). */
export const phylacteryFields = boss => ({ set: 'phylactery', still: true, object: true, asleep: false, hunting: false, guardOf: boss.id });

/** A guard of `boss` from a bosses.json guards row, at cell c; extra: fields it carries before its post. */
export function guardBody(row, boss, c, extra = {}) {
  const m = Object.assign(makeCreature(row.creature, c.x, c.y, { asleep: row.state === 'asleep' }), extra);
  m.guardOf = boss.id;
  return m;
}

/** W23: builds the room and returns its bodies (the boss first, then the guards). */
export function buildBossRoom(rng, floor, room, bossId = 'grukk', grid = roomGrid(floor, [room])) {
  const B = bosses.rows[bossId], W = floor.w, cx = room.x + Math.floor(room.w / 2);
  room.cx ??= cx; room.cy ??= room.y + (room.h >> 1);
  floor.props.push({ id: 'boss-throne', x: cx, y: room.y, keep: true });
  // The exit gate sits in the room's bottom row; it opens when the floor's core is pressed into it (W51).
  floor.tiles[(room.y + room.h - 1) * W + cx] = T.EXIT;
  floor.exit = { x: cx, y: room.y + room.h - 1 };
  // The edge pieces as any room's edge dressing (not kept: the light rules thin them as in 1.7), then the stains, each
  // on an interior cell picked afresh (1.7 world.js:1492-1500; rooms.json boss-dungeon).
  decorateEdges(rng, floor, grid, room, ROOM.edgeProps.cycle, ROOM.edgeProps.count);
  const inner = interiorCells(floor, room), stains = ROOM.ground.uniform.map(g => G[g.toUpperCase()]);
  for (let i = 0; i < ROOM.ground.count && inner.length; i++) { const c = pick(rng, inner); floor.ground[c.y * W + c.x] = stains[Math.floor(next(rng) * stains.length)]; }
  const boss = bossBody(B.monsters[0], bossId, cx, room.y + 1, { rot: 0, phase: 0 });
  const out = [boss], taken = new Set([`${cx},${room.y + 1}`]);
  for (const g of B.guards ?? []) for (let i = 0; i < g.count; i++) {
    const spots = inner.filter(c => !taken.has(`${c.x},${c.y}`)).sort((a, b) => Math.hypot(a.x - cx, a.y - room.y - 1) - Math.hypot(b.x - cx, b.y - room.y - 1));
    const c = spots[Math.min(spots.length - 1, roll(rng, 0, 3))];
    if (!c) break;
    taken.add(`${c.x},${c.y}`);
    out.push(guardBody(g, boss, c));
  }
  floor.bossRoom = { x: room.x, y: room.y, w: room.w, h: room.h };
  return out;
}
