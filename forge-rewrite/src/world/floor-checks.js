// Floor checks run on a finished floor (consolidation W2/W3 follow-ups): W74 opens wall pinches, W73 clears props that
// shut a tile off, and the last reach check fails an attempt whose stairs a solid piece cuts off. Kept apart from
// generate.js so the biomes that build their own floors call the same passes.

import props from '../../data/props.json' with { type: 'json' };
import { T, walkable, walkTile } from '../data/tiles.js';
import { flood } from './layout.js';
import { D4, D8 } from '../lib/geometry.js';
import { distanceField, components } from '../lib/grid.js';
import { propSolid, propBlocks } from '../data/props.js';
import { piecesOf } from './pieces.js';


/** The props `test` picks as a tile mask (1.7's walkable treats a blocking prop as wall). */
export function propMask(floor, test) {
  const m = new Uint8Array(floor.w * floor.h);
  for (const p of floor.props) if (test(p)) m[p.y * floor.w + p.x] = 1;
  return m;
}

/**
 * 1.7 bfsFrom: route distances from `from` over walkable tiles off the `solid` mask, shut doors and chests (and `also`
 * tiles); the exit while it is open (`exit`). -1: unreached.
 */
export function reachFrom(floor, from, solid = propMask(floor, p => propBlocks(p)), { exit = !!floor.exitOpen, also = null } = {}) {
  const t = floor.tiles, W = floor.w;
  return distanceField(W, floor.h, from.y * W + from.x, k => t[k] === T.DOOR || t[k] === T.CHEST || also?.has(t[k]) || ((t[k] === T.EXIT ? exit : walkTile(t[k])) && !solid?.[k]));
}

/** Areas a creature walks (open(x, y)): 8 ways, but never between two closed sides. Area labels, -1 closed. */
export const creatureAreas = (W, H, open) => components(W, H, i => open(i % W, (i / W) | 0), { dirs: D8, corner: (cx, cy, dx, dy) => open(cx + dx, cy) || open(cx, cy + dy) }).label;

/** Can a creature stand here (W74's open test, the map's edge closed). */
export const creatureOpen = floor => (x, y) => x >= 0 && y >= 0 && x < floor.w && y < floor.h && walkable(floor, x, y);

/**
 * W74's pinches, in scan order: two open tiles that touch only at a corner, both sides closed, in different creature
 * areas. Yields [x, y, dx, dy, sides] (the two side cells); the areas are counted once, so a pass that changes the floor
 * stops and asks again.
 */
export function* pinchSites(floor) {
  const W = floor.w, H = floor.h, open = creatureOpen(floor), area = creatureAreas(W, H, open);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) for (const [dx, dy] of [[1, 1], [1, -1]]) {
    if (!open(x, y) || !open(x + dx, y + dy) || open(x + dx, y) || open(x, y + dy) || area[y * W + x] === area[(y + dy) * W + x + dx]) continue;
    yield [x, y, dx, dy, [[x + dx, y], [x, y + dy]]];
  }
}

/**
 * W74 (sandbox lead 2026-10-18): no area reachable only through a wall pinch. The hero may step diagonally between
 * two walls (as in 1.7); creatures may not, so they were left at the gap. Where two walkable tiles touch only at a
 * corner with walls on both sides and lie in different areas for a creature, one side wall opens (the one with more
 * open tiles round it, so the new tile joins the passage), until creatures reach every area the hero does.
 */
export function openPinches(floor) {
  const W = floor.w, H = floor.h, open = creatureOpen(floor);
  for (let guard = 0; guard < 60; guard++) {
    let fixed = false;
    for (const [, , , , cells] of pinchSites(floor)) {
      const sides = cells.filter(([sx, sy]) => sx > 0 && sy > 0 && sx < W - 1 && sy < H - 1 && floor.tiles[sy * W + sx] === T.WALL);
      if (!sides.length) continue;   // a door, a chest or the map's edge: left as it is
      const around = ([sx, sy]) => D8.filter(([ex, ey]) => open(sx + ex, sy + ey)).length;
      const [sx, sy] = sides.sort((a, b) => around(b) - around(a))[0];
      floor.tiles[sy * W + sx] = T.FLOOR;
      floor.props = floor.props.filter(p => !(p.chainDir && p.x + p.chainDir[0] === sx && p.y + p.chainDir[1] === sy));   // a chain loses its wall
      fixed = true;
      break;
    }
    if (!fixed) return;
  }
}

/**
 * No floor tile shut off by props (W73, sandbox lead 2026-10-17: a brute spawned in a corner two stands closed off,
 * and nobody could reach it). 1.7's edge dressing can close a corner or a doorway; while any plain floor tile is out of
 * reach of the arrival, a solid piece of decoration beside it goes (never a kept piece: a puzzle's barrier, a set piece).
 * Breakable props (crates, barrels) are not walls here: they can be broken through.
 */
export function noSealedCells(floor, from) {
  const W = floor.w, solid = p => propSolid(p), loose = p => solid(p) && !p.keep;
  for (let guard = 0; guard < 40; guard++) {
    const m = propMask(floor, solid);
    const d = flood(floor.tiles, W, floor.h, from.y * W + from.x, m);
    let shut = -1;
    for (let k = 0; k < d.length; k++) if (floor.tiles[k] === T.FLOOR && !m[k] && d[k] < 0) { shut = k; break; }
    if (shut < 0) return;
    // The shut-off region, then the solid props on its edge.
    const region = flood(floor.tiles, W, floor.h, shut, m);
    const touches = (p, dist) => D4.some(([dx, dy]) => dist[(p.y + dy) * W + p.x + dx] >= 0);
    const edge = floor.props.filter(p => loose(p) && touches(p, region));
    // Best: a prop between the shut-off tiles and the reached ones (taking it away joins them).
    const pick = edge.find(p => touches(p, d)) ?? edge[0];
    if (!pick) return;   // shut by walls or by a room's own kept pieces (a puzzle's barrier): left as it is
    const gone = new Set(piecesOf(floor, pick));   // a wide piece goes whole (item 168: a sarcophagus's foot was left, unseen)
    floor.props = floor.props.filter(q => !gone.has(q));
  }
}

/** W10 on the finished floor: the goal (or a tile beside it) reached from the arrival past every solid piece, kept ones too. */
export function goalCut(floor, from, goal) {
  if (!goal) return false;
  const W = floor.w, d = reachFrom(floor, from, propMask(floor, p => propSolid(p)));
  return ![[0, 0], ...D4].some(([dx, dy]) => d[(goal.y + dy) * W + goal.x + dx] >= 0);
}
