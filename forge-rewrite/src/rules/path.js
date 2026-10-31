// Creature routing (consolidation C5, engine-rules-11): the 8-way walking field a creature follows and the step away
// from a threat, one copy for every creature module. Built on lib/grid's search.

import props from '../../data/props.json' with { type: 'json' };
import { D8, cheb } from '../lib/geometry.js';
import { distanceField } from '../lib/grid.js';
import { walkable, T } from '../data/tiles.js';

/**
 * M27, item 141 (Justin 2026-10-17: "enemies are getting hung up on having to move diagonal again"): a creature's
 * diagonal is open when either side cell is open ground; the side cell is judged by its ground alone, so a creature
 * rounds furniture as the hero does, while walls and shut doors still seal a diagonal.
 */
export const sideOpen = (f, x, y) => x >= 0 && y >= 0 && x < f.w && y < f.h && walkable(f, x, y);
export const creatureCorner = f => (cx, cy, dx, dy) => sideOpen(f, cx + dx, cy) || sideOpen(f, cx, cy + dy);

/** The cells a creature routes through: open ground without a blocking prop (the first prop on a tile, as isWall), or a shut door. */
export function openGrid(f) {
  const W = f.w, g = new Uint8Array(W * f.h), seen = new Set();
  for (let y = 0; y < f.h; y++) for (let x = 0; x < W; x++) g[y * W + x] = walkable(f, x, y) ? 1 : 0;
  for (const p of f.props ?? []) {
    const i = p.y * W + p.x;
    if (seen.has(i)) continue;
    seen.add(i);
    if (p.blocks || props.rows[p.id]?.blocks) g[i] = 0;
  }
  for (let i = 0; i < g.length; i++) if (f.tiles[i] === T.DOOR) g[i] = 1;
  return g;
}

/** 8-way walking distances to goal over openGrid (closed(i): cells also shut, as burning ground); -1 unreached. */
export function walkField(f, goal, { grid = openGrid(f), closed = null } = {}) {
  return distanceField(f.w, f.h, goal.y * f.w + goal.x, i => grid[i] === 1 && !(closed && closed(i)), { dirs: D8, corner: creatureCorner(f) });
}

/**
 * 1.7 fleeStep: a step that takes a further from `from`, the biggest gain first (ties in D8 order). allowed(x, y):
 * the caller's extra rule (an island, a free cell); step(dx, dy): how it moves (tryStep, or the caller's own), true
 * when it moved. False when no step does.
 */
export function stepAway(a, from, step, { allowed = null } = {}) {
  const opts = D8.map(([dx, dy]) => ({ dx, dy, gain: cheb({ x: a.x + dx, y: a.y + dy }, from) - cheb(a, from) }))
    .filter(o => o.gain > 0 && (!allowed || allowed(a.x + o.dx, a.y + o.dy)))
    .sort((p, q) => q.gain - p.gain);
  for (const o of opts) if (step(o.dx, o.dy)) return true;
  return false;
}
