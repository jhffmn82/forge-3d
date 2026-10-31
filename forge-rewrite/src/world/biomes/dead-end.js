// Stairs at the end of a dead-end passage (spec/world.md Crypt 21-22, floors.json dead-end-hall): from floor 6 on,
// in every biome, the down stairs sit at the far end of a hallway 3-5 tiles long cut straight out of the goal room,
// solid rock on both sides and past its end; the hero arrives at the end of one cut from the start room
// (1.7 carveRectangularPassage, js/world/world.js:621-649; placeArrivalStairs, js/world/floors.js:107-118 @3c8b312).
// Shared by the biome builders (registry.js hooks `stairs` and `arrival`). Draws only from the stream it is given.

import floors from '../../../data/floors.json' with { type: 'json' };
import { roll, shuffled } from '../../lib/rng.js';
import { T } from '../../data/tiles.js';

const D = floors.rows['dead-end-hall'];

/** Cuts one passage out of a room; returns its far end, or null after the tries run out. throughProps: the passage may
 *  cut through a cell with a prop on it (the Underdark's 1.7 carveRectangularPassage does not look). */
export function carvePassage(rng, floor, room, { throughProps = false } = {}) {
  const W = floor.w, H = floor.h, at = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? T.WALL : floor.tiles[y * W + x]);
  const propOn = (x, y) => floor.props.some(p => p.x === x && p.y === y);
  const sides = shuffled(rng, [0, 1, 2, 3]);
  for (let t = 0; t < D.tries; t++) {
    const side = sides[t % 4], len = roll(rng, D.length[0], D.length[1]);
    let sx, sy, dx = 0, dy = 0;
    if (side === 0) { sx = room.x + roll(rng, 1, Math.max(1, room.w - 2)); sy = room.y - 1; dy = -1; }
    else if (side === 1) { sx = room.x + roll(rng, 1, Math.max(1, room.w - 2)); sy = room.y + room.h; dy = 1; }
    else if (side === 2) { sx = room.x - 1; sy = room.y + roll(rng, 1, Math.max(1, room.h - 2)); dx = -1; }
    else { sx = room.x + room.w; sy = room.y + roll(rng, 1, Math.max(1, room.h - 2)); dx = 1; }
    const ix = sx - dx, iy = sy - dy;
    if (at(ix, iy) !== T.FLOOR || propOn(ix, iy)) continue;
    const px = dy !== 0 ? 1 : 0, py = dx !== 0 ? 1 : 0, cells = [];
    let ok = true;
    for (let i = 0; i < len && ok; i++) {
      const cx = sx + dx * i, cy = sy + dy * i;
      if (cx < 2 || cy < 2 || cx > W - 3 || cy > H - 3 || at(cx, cy) !== T.WALL || (!throughProps && propOn(cx, cy))) { ok = false; break; }   // never through a plaque or niche
      if (at(cx + px, cy + py) !== T.WALL || at(cx - px, cy - py) !== T.WALL) { ok = false; break; }
      cells.push({ x: cx, y: cy });
    }
    if (!ok) continue;
    const end = cells[cells.length - 1], bx = end.x + dx, by = end.y + dy;
    if (at(bx, by) !== T.WALL || at(bx + px, by + py) !== T.WALL || at(bx - px, by - py) !== T.WALL) continue;
    for (const c of cells) floor.tiles[c.y * W + c.x] = T.FLOOR;
    return end;
  }
  return null;
}

const near = (rooms, from, skip) => rooms.filter(r => r !== from && !r.pocket && !skip(r))
  .sort((a, b) => Math.abs(a.cx - from.cx) + Math.abs(a.cy - from.cy) - (Math.abs(b.cx - from.cx) + Math.abs(b.cy - from.cy)));

/** Crypt 21: the down stairs at a passage's end: the goal room, then the other ordinary rooms nearest first. */
export function deadEndStairs(rng, floor, goal, rooms) {
  let end = carvePassage(rng, floor, goal);
  for (const r of end ? [] : near(rooms, goal, r => r.role === 'start' || r.role === 'boss' || !!r.special)) { end = carvePassage(rng, floor, r); if (end) break; }
  if (!end) return null;
  floor.tiles[end.y * floor.w + end.x] = T.STAIRS;
  return end;
}

/** Crypt 22: the arrival at a passage's end from the start room, then its 4 nearest rooms; null keeps the start. */
export function deadEndArrival(rng, floor, start, rooms) {
  const room = rooms.find(r => r.role === 'start') ?? rooms.find(r => start.x >= r.x && start.x < r.x + r.w && start.y >= r.y && start.y < r.y + r.h);
  if (!room) return null;
  let end = carvePassage(rng, floor, room);
  for (const r of end ? [] : near(rooms, room, r => r.role === 'boss').slice(0, 4)) { end = carvePassage(rng, floor, r); if (end) break; }
  return end;
}
