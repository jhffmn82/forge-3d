// What creatures and the hero notice (consolidation C5, engine-rules-08, engine-rules-33): earshot, foes in sight, a
// creature seeing someone, being airborne, and the tiles a walk keeps off (C12). One rule each; travel, explore, rest,
// traps and the AI read them here.

import tuning from '../../data/tuning.json' with { type: 'json' };
import { cheb, D4 } from '../lib/geometry.js';
import { lineClear } from './sight.js';
import { T, tileAt, G } from '../data/tiles.js';
import { blocks } from './statuses.js';

const SAFE_FIELDS = new Set(['holy']);
const TRIAL_ROOMS = new Set(['sentries', 'sentinels', 'baths']);
/** A tile the hero has seen. */
export const known = (s, x, y) => x >= 0 && y >= 0 && x < s.floor.w && y < s.floor.h && !!s.seen?.[y * s.floor.w + x];

/** Sound carries this far in tiles (rule-common: 12 tiles of falloff), Chebyshev. */
export const EARSHOT = tuning.rows.hearing.earshot;
export const inEarshot = (a, b) => cheb(a, b) <= EARSHOT;

/**
 * Living foes in the hero's sight, nearest first. awake: not asleep; hidden: include a hidden one (a Shade in a wall);
 * range and line: within range of `from` (the hero by default) with an open line to it.
 */
export function foesInSight(state, { from = state.actors[state.playerId], awake = false, hidden = true, range = Infinity, line = false } = {}) {
  return state.order.map(id => state.actors[id])
    .filter(a => a && a.hp > 0 && a.side === 'foe' && (hidden || !a.hidden) && (!awake || !a.asleep) && state.vis?.[a.y * state.floor.w + a.x]
      && cheb(a, from) <= range && (!line || lineClear(state.floor, from, a)))
    .sort((a, b) => cheb(a, from) - cheb(b, from));
}

/**
 * Whether creature a sees t: never while blind or while t hides; the hero whenever a stands in his sight (sight is
 * mutual); and anyone within `near` tiles with an open line (darksight 9, a witness 7).
 */
export function creatureSees(state, a, t, { near = 0 } = {}) {
  if (a.statuses?.blind || t.statuses?.hidden) return false;
  if (t.side === 'player' && state.vis?.[a.y * state.floor.w + a.x]) return true;
  return near > 0 && cheb(a, t) <= near && lineClear(state.floor, a, t);
}

/** Flying or levitating; the hero's Air-mastery wind carry counts unless windCarry is false (traps: flying and levitating only). */
export const airborne = (b, { windCarry = true } = {}) => !!(b.flags?.includes('flying') || b.statuses?.levitate || (windCarry && b.side === 'player' && b.windCarry));

/**
 * A known tile that would hurt to stand on (C12: one rule for the walkers). Explore's (1.7 exploreSafe): fire, a harmful
 * field, webbed ground, a marked blow, an unsolved trial room, mushrooms, lava or its edge (found traps: explorePath).
 * who 'travel' (1.7 travelHazard, the map walk): fire, any field but holy ground, a marked blow, lava beside.
 */
export function hazardAt(s, x, y, { who = 'explore' } = {}) {
  if (!known(s, x, y)) return false;
  const f = s.floor, k = y * f.w + x, p = s.actors[s.playerId];
  if (f.burning?.[k]) return true;
  if (who === 'travel') {
    if ((f.fields ?? []).some(r => r.kind !== 'holy' && r.cells?.includes(k))) return true;
    if ((f.marks ?? []).some(m => (m.tiles ?? []).some(t => t.x === x && t.y === y))) return true;
    return [[0, -1], [1, 0], [0, 1], [-1, 0]].some(([dx, dy]) => known(s, x + dx, y + dy) && tileAt(f, x + dx, y + dy) === T.LAVA);
  }
  // 1.7 FoteGreenSlime.hazardAt: a live poison trail (a field that keeps `known`) is a hazard once seen and only if it
  // would hurt the hero; every other field but the safe ones (a chaos poison patch included) while it lasts.
  const proof = p && (p.statuses?.levitate || p.flags?.includes('flying') || p.immune?.includes('poison') || blocks(p, 'poison'));
  if ((f.fields ?? []).some(r => !SAFE_FIELDS.has(r.kind) && r.cells.includes(k) && (r.known === undefined || (!proof && r.until > (s.now ?? 0) && (r.known || s.vis?.[k]))))) return true;
  // T5 (1.7 travelHazard): webbed ground, a telegraphed blow's marked tiles, and the rooms that punish walking in
  // unprepared (an unsolved sentry gallery, stone sentinels or scalding baths).
  if (f.ground?.[k] === G.WEB) return true;
  if ((f.marks ?? []).some(m => (m.tiles ?? []).some(t => t.x === x && t.y === y))) return true;
  if ((f.puzzles ?? []).some(r => !r.solved && TRIAL_ROOMS.has(r.kind) && x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h)) return true;
  // 1.7 sporeGrowth: a spore field's mushrooms (floor.mushrooms).
  if (f.mushrooms?.[k]) return true;
  return tileAt(f, x, y) === T.LAVA || lavaRisk(f, p, x, y);
}

// Sandbox U4 (C17: moved from lava.js, which burns; this only sees): a body lava cannot hurt, and a step beside lava.
export const lavaProof = b => airborne(b, { windCarry: false }) || b.element === 'fire';

/** U4: would standing on (x, y) leave this body orthogonally beside lava? */
export function lavaRisk(floor, b, x, y) {
  if (!floor?.lava || lavaProof(b)) return false;
  return D4.some(([dx, dy]) => tileAt(floor, x + dx, y + dy) === T.LAVA);
}
