// Creatures that turn up after a floor is built (spec/world.md W44, W57): the rare creature placed with the floor, and
// wandering spawns on a countdown. Numbers: floors.json rare-creature, roster-rare, wandering-spawns; the floor's roster
// and biome are data/roster.js's and data/schedule.js's (C10h).

import floors from '../../data/floors.json' with { type: 'json' };
import planes from '../../data/planes.json' with { type: 'json' };
import { amount } from './amount.js';
import { makeCreature } from './monsters.js';
import { next, roll, weighted } from '../lib/rng.js';
import { rosterRows } from '../data/roster.js';
import { isWall } from './moves.js';

const F = floors.rows, RC = F['rare-creature'], RR = F['roster-rare'], WS = F['wandering-spawns'];
const QUIET = new Set(['hidden-sigil', 'rare-event']);
/** 1.7 world.js:477: the rare creature never lands in a chest-ambush, ritual, rare-event or hidden sigil room. */
const QUIET_SPECIALS = new Set(['bone-vault', 'goblin-mine', 'flooded-cache', 'myconid-nursery', 'beetle-nest', 'ritual']);
const quietRoom = r => r.rareEvent || r.hiddenSigil || r.role === 'merchant' || QUIET_SPECIALS.has(r.special);

/** A random walkable, empty room cell at least `far` from the hero (and unseen, when `unseen`); null after `tries`. */
function farCell(rng, floor, bodies, hero, far, tries, vis, skip = null) {
  const rooms = (floor.rooms ?? []).filter(r => !r.pocket && !QUIET.has(r.role) && r.role !== 'boss' && !skip?.(r));
  for (let t = 0; t < tries && rooms.length; t++) {
    const r = rooms[Math.floor(next(rng) * rooms.length)];
    const x = r.x + roll(rng, 0, r.w - 1), y = r.y + roll(rng, 0, r.h - 1);
    if (isWall(floor, x, y) || bodies.some(b => b.x === x && b.y === y)) continue;
    if (Math.abs(x - hero.x) + Math.abs(y - hero.y) < far) continue;
    if (vis && vis[y * floor.w + x]) continue;
    return { x, y };
  }
  return null;
}

/**
 * A creature kind from the floor's own roster, for a summon that names `floor-roster` (Wobbles' hostile prank; 1.7
 * gods.js wobblesSummonPlan): on a plane, one of its regulars (planes rule 107); elsewhere the biome roster's rows for
 * this floor, by weight. Never a boss, an elite or a rare kind. null when there is none.
 */
export function floorRosterKind(state) {
  const pl = state.floor?.plane && planes.rows['plane-' + state.floor.plane]?.roster;
  if (pl) return pl.regulars[Math.floor(next(state.rng) * pl.regulars.length)] ?? null;
  const rows = rosterRows(state.floorNo);
  return rows.length ? weighted(state.rng, rows).creature : null;
}

const rareKinds = floorNo => RR.rows.filter(r => floorNo >= r.floors[0] && floorNo <= r.floors[1]).map(r => r.creature);

/** W44: on a draw of 30% + 5% x floor (never a boss floor), one rare kind 14+ from the hero, wandering. */
export function placeRare(rng, floor, floorNo, creatures, start) {
  if (floorNo % 5 === 0) return null;
  const kinds = rareKinds(floorNo);
  if (!kinds.length || !(next(rng) < amount(RC.chance, { state: { floorNo } }) / 100)) return null;
  const c = farCell(rng, floor, creatures, start, RC.minDistanceFromHero, RC.tries, null, quietRoom);
  if (!c) return null;
  const m = makeCreature(kinds[Math.floor(next(rng) * kinds.length)], c.x, c.y);
  m.asleep = false;
  creatures.push(m);
  return m;
}

/** W57: every 45-75 game turns a creature may arrive out of sight, unless the floor is full or has had its share. */
export function wanderingPulse(state, events) {
  const f = state.floor, p = state.actors[state.playerId];
  if (state.where !== 'dungeon' || f.boss || f.noSpawns) return;   // item 286: the Realm's treasure room (1.7 chaos-entry-preview.js:58)
  if (f.spawnIn === undefined) f.spawnIn = roll(state.rng, WS.interval[0], WS.interval[1]);
  if (--f.spawnIn > 0) return;
  f.spawnIn = roll(state.rng, WS.interval[0], WS.interval[1]);
  const living = state.order.filter(id => state.actors[id].side === 'foe' && state.actors[id].hp > 0).length;
  const cap = WS.maxLivingFoes;
  if ((f.spawned ?? 0) >= amount(WS.maxExtraPerFloor, { state }) || living >= Math.round((cap.base + cap.perFloor * state.floorNo) * cap.share)) return;
  const bodies = state.order.map(id => state.actors[id]);
  const c = farCell(state.rng, f, bodies, p, WS.minDistanceFromHero, WS.tries, state.vis);
  if (!c) return;
  const rare = next(state.rng) < WS.rareChancePct / 100 && rareKinds(state.floorNo).length;
  let kind;
  if (rare) { const k = rareKinds(state.floorNo); kind = k[Math.floor(next(state.rng) * k.length)]; }
  else {
    const rows = rosterRows(state.floorNo);
    if (!rows.length) return;
    kind = weighted(state.rng, rows).creature;
  }
  const m = makeCreature(kind, c.x, c.y);
  m.asleep = false; m.t = p.t;
  state.actors[m.id] = m; state.order.push(m.id);
  f.spawned = (f.spawned ?? 0) + 1;
  events.push({ type: 'spawned', id: m.id, at: c }, { type: 'log', words: rare ? WS.logRare : WS.log });
}
