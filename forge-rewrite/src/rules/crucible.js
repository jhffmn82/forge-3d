// The Crucible's rows (chaos 71; consolidation C17, moved from rules/realm.js when the Realm's travel went to the engine):
// whether a body may stand on a tile of a floor whose walls walkable() alone does not describe.

import { walkable } from '../data/tiles.js';

/** Is this a floor whose tiles walkable() alone does not describe for a body (the Crucible's rows, chaos 71)? */
export function realmAllows(state, a, x, y) {
  const c = state.floor?.crucible;
  if (!c || c.walkthrough) return walkable(state.floor, x, y);
  if (c.phase === 'ready' && y < c.entryGate.y) return false;
  if (c.phase !== 'defeated' && y < c.rearSeal.y) return false;
  if (c.phase === 'active' && y >= c.entryGate.y) return false;
  return walkable(state.floor, x, y);
}
