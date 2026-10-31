// Creature rosters (consolidation C5, world-11): the roster rows that may appear on a floor, from floors.json
// roster-<biome>. The draw itself is lib/rng.js weighted (its edge option keeps each caller's rule).

import floors from '../../data/floors.json' with { type: 'json' };
import { biomeOf } from './schedule.js';

const F = floors.rows;

/** The rows of a roster ('roster-<biome>' for the floor's biome unless named) whose floors hold floorNo. */
export function rosterRows(floorNo, { roster = 'roster-' + biomeOf(floorNo) } = {}) {
  return (F[roster]?.rows ?? []).filter(r => !r.floors || (floorNo >= r.floors[0] && floorNo <= r.floors[1]));
}
