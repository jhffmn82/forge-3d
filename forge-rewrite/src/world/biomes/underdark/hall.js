// Floor 20, the Matron of the Web's hall (spec/world.md 132-137; floors.json underdark-matron-hall; bosses.json matron;
// bosses.md MA1; 1.7 deep.js buildDeepHall, deepmobs.js spawnMatron @3c8b312): the 21 x 15 temple hall in the east of
// the map, its fixed pieces from the row (idol, candelabras, bloody altars, blood fonts, four walkable ritual circles,
// two rows of pillars), the exit gate in the south wall, six blood stains; the Matron on her throne with two Drow
// Blades and a Drow Priestess asleep within 3.

import floors from '../../../../data/floors.json' with { type: 'json' };
import bosses from '../../../../data/bosses.json' with { type: 'json' };
import props from '../../../../data/props.json' with { type: 'json' };
import { next, pick } from '../../../lib/rng.js';

import { T, walkable, G } from '../../../data/tiles.js';
import { place } from './dress.js';
import { propBlocks } from '../../../data/props.js';
import { bossBody, guardBody } from '../../boss.js';

const HALL = floors.rows['underdark-matron-hall'], BOSS = bosses.rows.matron;

/** A free walkable cell within `r` (Chebyshev) of (x, y), picked at random; null if none. */
function nearFree(rng, floor, x, y, r, taken) {
  const out = [];
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    const nx = x + dx, ny = y + dy;
    if ((dx || dy) && walkable(floor, nx, ny) && !taken.has(`${nx},${ny}`) && !floor.props.some(p => p.x === nx && p.y === ny && propBlocks(p))) out.push({ x: nx, y: ny });
  }
  return out.length ? pick(rng, out) : null;
}

/** B1: builds the hall in `room` and returns its bodies (the Matron first, then her guards). */
export function buildMatronHall(rng, floor, room) {
  room.role = 'boss';
  const x0 = room.x, y0 = room.y, W = floor.w;
  for (const p of HALL.props) place(floor, p.name, x0 + p.x, y0 + p.y, { keep: true });
  const circles = HALL.circles.map(([x, y]) => ({ x: x0 + x, y: y0 + y }));
  const throne = { x: x0 + HALL.throne[0], y: y0 + HALL.throne[1] };
  const exit = { x: x0 + HALL.exit[0], y: y0 + HALL.exit[1] };
  floor.tiles[exit.y * W + exit.x] = T.EXIT;
  floor.exit = exit;
  floor.bossArena = { x: x0, y: y0, w: room.w, h: room.h, throne, circles };
  floor.bossRoom = { x: x0, y: y0, w: room.w, h: room.h };
  // Six blood stains on interior cells (repeats allowed), where no prop stands.
  const inner = [];
  for (let y = y0 + 1; y < y0 + room.h - 1; y++) for (let x = x0 + 1; x < x0 + room.w - 1; x++) inner.push({ x, y });
  for (let i = 0; i < 6; i++) { const c = pick(rng, inner); if (!floor.props.some(p => p.x === c.x && p.y === c.y)) floor.ground[c.y * W + c.x] = G.BLOOD; }
  const matron = bossBody(BOSS.monsters[0], 'matron', throne.x, throne.y, { phase: 0 });
  const bodies = [matron], taken = new Set([`${throne.x},${throne.y}`]);
  for (const g of BOSS.guards) for (let i = 0; i < g.count; i++) {
    const c = nearFree(rng, floor, throne.x, throne.y, 3, taken);
    if (!c || floor.tiles[c.y * W + c.x] === T.LAVA) continue;
    taken.add(`${c.x},${c.y}`);
    bodies.push(guardBody(g, matron, c, { guard: true }));
  }
  return bodies;
}
