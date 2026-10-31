// The cave layout machinery the Caverns and the Underdark share (consolidation W5, world-25): the wandering tunnel,
// the chambers' spanning tree and its loops, the reach over cave ground and each chamber's depth field. Each biome
// passes its own numbers (biomes.json) and margins; the draws are 1.7's (caveLayout, deepLayout), unchanged.

import { next } from '../../lib/rng.js';
import { T } from '../../data/tiles.js';
import { D8 } from '../../lib/geometry.js';
import { distanceField } from '../../lib/grid.js';

/**
 * A tunnel from a to b on the w x h dig grid g, one tile wide (or two), stepping sideways now and then so it never runs
 * straight; it digs and walks no nearer than `margin` to the map's edge. steps: {maxSteps, sidestepPct}.
 */
export function tunnel(rng, g, w, h, a, b, wide, steps, margin) {
  let x = a.x, y = a.y, guard = 0;
  const dig = (cx, cy) => { for (let oy = 0; oy < (wide ? 2 : 1); oy++) for (let ox = 0; ox < (wide ? 2 : 1); ox++) { const xx = cx + ox, yy = cy + oy; if (xx >= margin && yy >= margin && xx < w - margin && yy < h - margin) g[yy * w + xx] = 1; } };
  dig(x, y);
  while ((x !== b.x || y !== b.y) && guard++ < steps.maxSteps) {
    const dx = b.x - x, dy = b.y - y;
    if (next(rng) < steps.sidestepPct / 100) { if (Math.abs(dx) >= Math.abs(dy)) y += next(rng) < 0.5 ? -1 : 1; else x += next(rng) < 0.5 ? -1 : 1; }
    else if (dx && (!dy || next(rng) < Math.abs(dx) / (Math.abs(dx) + Math.abs(dy)))) x += dx > 0 ? 1 : -1;
    else y += dy > 0 ? 1 : -1;
    x = Math.max(margin, Math.min(w - 1 - margin, x)); y = Math.max(margin, Math.min(h - 1 - margin, y));
    dig(x, y);
  }
}

/** The chambers' spanning tree from chamber 0: each step joins the outside chamber b nearest an inside one by
 *  cost(a, b, joined) (joined: how many are in already). Returns the edges [a, b]. */
export function spanningEdges(n, cost) {
  const inTree = [0], edges = [];
  while (inTree.length < n) {
    let bA = -1, bB = -1, bD = Infinity;
    for (const ia of inTree) for (let b = 0; b < n; b++) {
      if (inTree.includes(b)) continue;
      const d2 = cost(ia, b, inTree.length);
      if (d2 < bD) { bD = d2; bA = ia; bB = b; }
    }
    edges.push([bA, bB]); inTree.push(bB);
  }
  return edges;
}

/** Up to `loops` extra tunnels between two chambers drawn at random (two draws a try), new pairs that ok(p, q) takes. */
export function addLoops(rng, n, edges, loops, tries, ok) {
  for (let l = 0; l < loops * tries && loops > 0; l++) {
    const p = Math.floor(next(rng) * n), q = Math.floor(next(rng) * n);
    if (p === q || edges.some(e => (e[0] === p && e[1] === q) || (e[0] === q && e[1] === p))) continue;
    if (!ok(p, q)) continue;
    edges.push([p, q]); loops--;
  }
}

/** Every cell of cave ground (floor, water, bridge) reached from `from`, four ways: 1 reached, 0 not (1.7 caveReach). */
export const caveReach = (tiles, w, h, from) => distanceField(w, h, from, i => tiles[i] === T.FLOOR || tiles[i] === T.BRIDGE || tiles[i] === T.WATER).map(d => (d >= 0 ? 1 : 0));

/**
 * Each chamber floor cell's steps (eight ways) from its chamber's edge: a floor cell with rock, another chamber or the
 * map's edge among its eight neighbours is an edge (0). owner[i]: the chamber of cell i (-1 none).
 */
export function chamberDepth(tiles, owner, w, h) {
  const edge = [];
  for (let i = 0; i < w * h; i++) {
    if (owner[i] < 0 || tiles[i] !== T.FLOOR) continue;
    const x = i % w, y = (i / w) | 0;
    let open = true;
    for (let oy = -1; oy <= 1 && open; oy++) for (let ox = -1; ox <= 1; ox++) {
      const xx = x + ox, yy = y + oy, j = yy * w + xx;
      if (xx < 0 || yy < 0 || xx >= w || yy >= h || owner[j] !== owner[i] || tiles[j] !== T.FLOOR) { open = false; break; }
    }
    if (!open) edge.push(i);
  }
  // A floor cell beside another chamber is an edge, so the walk stays in its own chamber.
  return distanceField(w, h, edge, n => owner[n] >= 0 && tiles[n] === T.FLOOR, { dirs: D8 });
}
