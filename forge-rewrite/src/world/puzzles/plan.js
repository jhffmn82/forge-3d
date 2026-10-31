// The per-run puzzle plan (spec/world.md "Puzzles: the plan" 1-7, data/puzzles.json rule-plan): each biome plans its
// floors 5b+2..5b+4 from its own run stream; two get a sigil puzzle room, the third a crystal vault or an elemental
// treasury. A pure function of the run seed, so it needs no cache (1.7 keeps RUN.puzzlePlan(s) for the same result).

import puzzles from '../../../data/puzzles.json' with { type: 'json' };
import { stream, next, pick, shuffle } from '../../lib/rng.js';

const R = puzzles.rows;
/** Rule 4: the kinds 1.7 knows, in PUZZLE_KINDS order (the draw order matters). */
export const KINDS = ['poisonvault', 'offering', 'chasm', 'drowned', 'barricade', 'hoard', 'everburn', 'baths', 'spikes', 'sentinels', 'darktraps', 'sentries', 'library'];
export const elementOf = kind => R[kind]?.element;

/**
 * Rules 1-3, 6: {floorNo: {sigilRoom: kind} | {crystal: true} | {elementalTreasure: true}} for biome b.
 * The Dungeon's floor-2 swap (rule 6) always applies: floors are built in order, so none of 2-4 exists when 2 is made.
 */
export function puzzlePlan(runSeed, b) {
  const r = stream(((runSeed >>> 0) ^ (0x9a221e + b * 977)) >>> 0), base = b * 5, floors = [base + 2, base + 3, base + 4];
  shuffle(r, floors);
  const kinds = KINDS.filter(k => k !== 'everburn' && (k !== 'library' || b < 2));
  const k1 = pick(r, kinds);
  let k2;
  do k2 = pick(r, kinds); while (elementOf(k2) === elementOf(k1));
  const plan = { [floors[0]]: { sigilRoom: k1 }, [floors[1]]: { sigilRoom: k2 }, [floors[2]]: next(r) < 0.5 ? { crystal: true } : { elementalTreasure: true } };
  if (b === 0 && ['sentinels', 'library'].includes(plan[2].sigilRoom)) {
    const later = [3, 4].find(f => !['sentinels', 'library'].includes(plan[f].sigilRoom));
    if (later) [plan[2], plan[later]] = [plan[later], plan[2]];
  }
  return plan;
}

/** Rule 7: what this floor builds, or null (boss floors and floors the plan does not name). */
export function planForFloor(runSeed, floorNo, boss) {
  if (runSeed == null || boss) return null;
  return puzzlePlan(runSeed, Math.floor((floorNo - 1) / 5))[floorNo] ?? null;
}
