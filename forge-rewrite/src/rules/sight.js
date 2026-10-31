// What the hero sees and the map remembers (spec/sight.md V1-V8). Headless; the result lives in the state.

import { sightRadiusHook } from './pulse-hooks.js';
import tuning from '../../data/tuning.json' with { type: 'json' };
import { opaque, T } from '../data/tiles.js';
import { traceRay } from '../lib/geometry.js';

const S = tuning.rows.sight;


/** V3: an integer cell-centre ray from a to b; true when nothing before b blocks it (lib/geometry traceRay, C5). */
export const lineClear = (floor, a, b) => traceRay(a, b, (x, y) => !(x === b.x && y === b.y) && opaque(floor, x, y)).clear;

/** V1: the hero's sight radius here. */
export function sightRadius(state) {
  const p = state.actors[state.playerId];
  let r = sightRadiusHook(state) ?? S.radius;   // planes: Shadow darkness, Snuffed (spec/planes.md 121, src/rules/pulse-hooks.js)
  if (p.statuses.snuffed) r = Math.min(r, S.snuffedRadius);
  // V1: in a dark room (S14) sight is 2 unless the hero has Light or Fire affinity.
  const inside = rm => p.x >= rm.x && p.x < rm.x + rm.w && p.y >= rm.y && p.y < rm.y + rm.h;
  const dark = state.floor?.rooms?.some(rm => rm.dark && inside(rm));
  const aff = state.hero?.affinity ?? {};
  if (dark && !(aff.light > 0) && !(aff.fire > 0)) r = Math.min(r, S.darkRoomRadius ?? 2);
  // G40 (1.7 geometry.js:32): the dark-trap puzzle room, still dark, shows only the tiles beside the hero, Light or Fire
  // affinity or not, until light solves it.
  if (state.floor?.puzzles?.some(q => q.kind === 'darktraps' && q.dark && !q.solved && inside(q))) r = Math.min(r, S.darkTrapRoomRadius ?? 1);
  return r;
}

/** V2, V5, V6: recompute what is in sight and add it to what is remembered. Emits one 'sight' event. */
export function refreshSight(state, events) {
  const f = state.floor, p = state.actors[state.playerId], n = f.w * f.h;
  if (!state.seen || state.seen.length !== n) state.seen = new Array(n).fill(0);
  const vis = new Array(n).fill(0);
  const blind = !!p.statuses.blind;
  const r = blind ? 1 : sightRadius(state);
  // V8: smoke and darkness hide everything beyond the adjacent tiles inside and behind them.
  const veil = new Set((f.fields ?? []).filter(q => q.kind === 'darkness' || q.kind === 'smoke').flatMap(q => q.cells));
  const fv = veil.size ? { ...f, rocks: { ...(f.rocks ?? {}), ...Object.fromEntries([...veil].map(k => [k, 1])) } } : f;
  const shrouded = veil.has(p.y * f.w + p.x);   // G42 (1.7 geometry.js:111-118 mask inside): standing in it, only the adjacent tiles
  for (let y = Math.max(0, p.y - r); y <= Math.min(f.h - 1, p.y + r); y++) {
    for (let x = Math.max(0, p.x - r); x <= Math.min(f.w - 1, p.x + r); x++) {
      const dx = x - p.x, dy = y - p.y;
      if (blind ? Math.max(Math.abs(dx), Math.abs(dy)) > 1 : dx * dx + dy * dy > r * r) continue;
      const near = Math.max(Math.abs(dx), Math.abs(dy)) <= 1;
      if (shrouded && !near) continue;
      // Item 297 (Justin 2026-10-21: "i should be able to see adjacent diagonal rows"): the eight tiles beside the hero are
      // always in sight, a diagonal between two tall-grass tiles too (1.7 sealed it, as two walls seal it for a step).
      if (near || (!veil.has(y * f.w + x) && lineClear(fv, p, { x, y }))) { vis[y * f.w + x] = 1; state.seen[y * f.w + x] = 1; }
    }
  }
  vis[p.y * f.w + p.x] = 1; state.seen[p.y * f.w + p.x] = 1;
  // V7, item 287 (1.7 geometry.js:119-127 revealRock): in natural rock every wall within reach of a floor tile in sight is
  // shown and remembered, so a cave reads as a shape; never inside smoke or darkness (1.7 masks them after: V8).
  if (!shrouded && (f.biome === 'caverns' || f.biome === 'underdark' || f.plane || f.chaos)) {
    const reach = S.rockRevealReach, add = [];
    for (let i = 0; i < n; i++) {
      if (!vis[i] || f.tiles[i] === T.WALL) continue;
      const x = i % f.w, y = (i / f.w) | 0;
      for (let oy = -reach; oy <= reach; oy++) for (let ox = -reach; ox <= reach; ox++) {
        const nx = x + ox, ny = y + oy;
        if (nx >= 0 && ny >= 0 && nx < f.w && ny < f.h && f.tiles[ny * f.w + nx] === T.WALL && !veil.has(ny * f.w + nx)) add.push(ny * f.w + nx);
      }
    }
    for (const k of add) { vis[k] = 1; state.seen[k] = 1; }
  }
  state.vis = vis;
  // 1.7 sporecaller.js observe: a spore field's mushroom once in sight is known (2), and stays drawn when remembered.
  if (f.mushrooms) for (const k in f.mushrooms) if (vis[k]) f.mushrooms[k] = 2;
  state.sightAt = p.x + ',' + p.y;   // RB52: game.js step refreshes when the hero ends an action somewhere else
  events?.push({ type: 'sight' });
}

const onFloor = (state, x, y) => x >= 0 && y >= 0 && x < state.floor.w && y < state.floor.h;
/** Whether the hero sees (x, y) now (C4, ui-38: one point query for the map, the HUD, travel and the log). */
export const litAt = (state, x, y) => onFloor(state, x, y) && !!state.vis?.[y * state.floor.w + x];
/** Whether (x, y) has ever been seen on this floor (the map's memory). */
export const seenAt = (state, x, y) => onFloor(state, x, y) && !!state.seen?.[y * state.floor.w + x];
