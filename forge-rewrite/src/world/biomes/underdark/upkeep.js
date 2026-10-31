// Two Underdark passes that run once a floor is built (floor.js): no area joined only through a corner creatures
// cannot step through where there is no wall to open (W74), and the spider caves' fungus minimum after the dressing
// (sandbox U14). Split from floor.js (C1 size guard).

import { T, walkable, wallLike } from '../../../data/tiles.js';
import { hash2 } from '../../../lib/noise.js';
import { nearDoor } from '../../dress.js';
import { roomCells } from './layout.js';
import { D8 } from '../../../lib/geometry.js';
import { creatureOpen, pinchSites } from '../../floor-checks.js';

/**
 * W74 where no wall stands at the pinch (shared.openPinches opens only walls): beside lava, the lava side cools to floor
 * (the side with more open ground round it); between chests (floor 20, seed 444084), one chest moves to the nearest
 * cell of its room with open ground all round, where it can never close a corner.
 */
export function lastPinches(floor, grid) {
  const W = floor.w, H = floor.h, open = creatureOpen(floor);
  for (let guard = 0; guard < 30; guard++) {
    let side = null;
    for (const [, , , , cells] of pinchSites(floor)) {
      const sides = cells.filter(([sx, sy]) => [T.LAVA, T.CHEST].includes(floor.tiles[sy * W + sx]));
      if (sides.length) { side = sides.sort((a, b) => D8.filter(([ex, ey]) => open(b[0] + ex, b[1] + ey)).length - D8.filter(([ex, ey]) => open(a[0] + ex, a[1] + ey)).length)[0]; break; }
    }
    if (!side) return;
    const [sx, sy] = side, k = sy * W + sx;
    if (floor.tiles[k] === T.LAVA) { floor.tiles[k] = T.FLOOR; continue; }
    const c = floor.chests.find(h => h.x === sx && h.y === sy), room = grid[k];
    const roomy = (x, y) => floor.tiles[y * W + x] === T.FLOOR && grid[y * W + x] === room && D8.every(([ex, ey]) => open(x + ex, y + ey))
      && !floor.props.some(p => p.x === x && p.y === y) && !floor.items.some(i => i.x === x && i.y === y) && !nearDoor(floor, grid, x, y);
    let to = null;
    for (let r = 1; r < Math.max(W, H) && !to; r++) for (let y = sy - r; y <= sy + r && !to; y++) for (let x = sx - r; x <= sx + r; x++) if (x > 0 && y > 0 && x < W - 1 && y < H - 1 && Math.max(Math.abs(x - sx), Math.abs(y - sy)) === r && roomy(x, y)) { to = { x, y }; break; }
    if (!c || !to) { floor.tiles[k] = T.FLOOR; if (c) floor.chests.splice(floor.chests.indexOf(c), 1); continue; }   // nowhere to go: the chest goes
    floor.tiles[k] = T.FLOOR; floor.tiles[to.y * W + to.x] = T.CHEST; c.x = to.x; c.y = to.y;
  }
}

/**
 * Sandbox U14 (Justin, 2026-10-16), held to the end: a floor with 60+ cells of spider cave keeps at least 8 fungus
 * clumps once the dressing has taken its cells (vegetation's own top-up runs before props, curtains and settle, which
 * can cover clumps; W2 found floors with 2). Cells along the cave walls first and spread out, then nearer together,
 * then any open cave cell.
 */
const FUNGUS_MIN = 8;
export function fungusFloor(floor, rooms, arrival, salt) {
  const W = floor.w, caves = rooms.filter(r => r.region === 1 && r.role !== 'boss' && !r.pocket);
  const cells = caves.flatMap(r => roomCells(r)).filter(c => floor.tiles[c.y * W + c.x] === T.FLOOR);
  const count = () => floor.spots.filter(sp => sp.kind === 'fungus').length;
  if (cells.length < 60 || count() >= FUNGUS_MIN) return;
  const wallN = (x, y) => { let n = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && wallLike(floor, x + dx, y + dy)) n++; return n; };
  const lava = (x, y) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => floor.tiles[(y + dy) * W + x + dx] === T.LAVA);
  const busy = new Set([...floor.props, ...floor.items, ...floor.traps, ...floor.spots].map(o => o.y * W + o.x));
  const free = c => !busy.has(c.y * W + c.x) && !lava(c.x, c.y) && Math.max(Math.abs(c.x - arrival.x), Math.abs(c.y - arrival.y)) > 1;
  const order = cells.slice().sort((a, b) => hash2(a.x, a.y, salt + 21) - hash2(b.x, b.y, salt + 21));
  for (const [walls, gap] of [[2, 3], [1, 2], [0, 1]]) {
    for (const c of order) {
      if (count() >= FUNGUS_MIN) return;
      if (!free(c) || wallN(c.x, c.y) < walls) continue;
      if (floor.spots.some(sp => sp.kind === 'fungus' && Math.max(Math.abs(sp.x - c.x), Math.abs(sp.y - c.y)) < gap)) continue;
      floor.spots.push({ x: c.x, y: c.y, kind: 'fungus', topUp: true }); busy.add(c.y * W + c.x);
      const k = c.y * W + c.x; if (floor.ground[k] === 1 || floor.ground[k] === 2) floor.ground[k] = 0;   // a clump stands clear of grass, as vegetation's
    }
  }
}
