// Free cells near a spot (consolidation C5, engine-rules-14).

import { walkable } from '../data/tiles.js';
import { realmAllows } from './crucible.js';

// C17: moved from sigils.js (Nature's Bounty, Recall, the summons).
/** Free walkable tiles within r of a body (Nature's Bounty, Recall's fallback). */
export function nearFree(state, a, r) {
  const out = [], f = state.floor;
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    const x = a.x + dx, y = a.y + dy;
    if ((dx || dy) && free(state, x, y)) out.push({ x, y });
  }
  return out.sort((p, q) => Math.max(Math.abs(p.x - a.x), Math.abs(p.y - a.y)) - Math.max(Math.abs(q.x - a.x), Math.abs(q.y - a.y)));
}

export function free(state, x, y) {
  const f = state.floor;
  if (!walkable(f, x, y) || !realmAllows(state, null, x, y)) return false;   // CH28: no blink or summons past the Crucible's gates
  return !state.order.some(id => { const a = state.actors[id]; return a.hp > 0 && a.x === x && a.y === y; }) && !f.props?.some(p => p.x === x && p.y === y);
}
