// One species swap pass (consolidation W2; spec/world.md Crypt 57, Caverns 101, Underdark 139; floors.json swap-*):
// a body a shared room or roster asked for by its Dungeon name becomes the biome's own kind, keeping its standing.
// The Dungeon has no table, so nothing changes there.

import floors from '../../data/floors.json' with { type: 'json' };
import { makeCreature } from '../rules/monsters.js';

/** What a swapped body keeps from the one it replaces. */
const KEEP = ['resident', 'guard', 'guardOf', 'hunting', 'summoned', 'keyholder', 'post', 'libraryRoom'];

/** The biome's own kind for a Dungeon kind (the same kind where the biome has no swap for it). */
export const swapKind = (biome, kind) => floors.rows['swap-' + biome]?.map?.[kind] ?? kind;

/** The body as the biome has it: a new body of the swapped kind with the old one's standing, or the same body. */
export function swapBody(biome, c) {
  const kind = swapKind(biome, c.kind);
  if (kind === c.kind) return c;
  const m = makeCreature(kind, c.x, c.y, { asleep: !!c.asleep });
  for (const k of KEEP) if (c[k] !== undefined) m[k] = c[k];
  return m;
}

/** Swaps a body where it stands (for lists other code already holds). */
export function swapInPlace(biome, c) {
  const m = swapBody(biome, c);
  if (m !== c) Object.assign(c, m);
  return c;
}
