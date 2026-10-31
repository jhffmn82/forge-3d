// Lava as terrain you can use (sandbox picks U4 and U5, Justin, 2026-10-16; beyond 1.7, which has no lava in play).
// U4: a creature that lava would burn prefers a step that does not leave it beside lava. U5: a body knocked toward a
// lava tile goes in: an ordinary creature dies (the kill is the pusher's), the hero or a boss takes a heavy burn
// (5 x the lava's own burn, then Burning 3) and stays where it stood.

import { dealDamage } from './damage.js';
import { applyStatus } from './statuses.js';
import { amountScaled } from './amount.js';
import { lavaProof } from './perception.js';   // C17: the risk is perception's; the burning is here
import { T, tileAt } from '../data/tiles.js';
import { D4 } from '../lib/geometry.js';

/** Lava does not hurt it: it flies or levitates, or it is a fire creature. */

/** The lava's burn on this floor (B4: 3 + floor/5, scaled). */
const burnOf = state => amountScaled(state, 3 + Math.floor(state.floorNo / 5));

/**
 * U5: a push that would carry `t` onto (x, y). True when the tile is lava and the shove was resolved here (the
 * caller then stops pushing); false otherwise.
 */
export function shoveIntoLava(state, t, by, x, y, events) {
  if (tileAt(state.floor, x, y) !== T.LAVA || t.hp <= 0 || lavaProof(t)) return false;
  events.push({ type: 'shoved-into-lava', id: t.id, at: { x, y }, by: by?.id ?? null, sfx: 'fire-ignite' });
  if (t.side === 'foe' && !t.boss && !t.flags?.includes('object')) {
    events.push({ type: 'log', words: `${t.name} is knocked into the lava.` });
    dealDamage(state, { target: t, source: by ?? null, amount: t.hp + (t.guard ?? 0) + 9999, type: 'fire', premitigated: true, bypassShields: true, tags: ['environment', 'lava'] }, events);
    return true;
  }
  const dealt = dealDamage(state, { target: t, source: by ?? null, amount: burnOf(state) * 5, type: 'fire', tags: ['environment', 'lava'] }, events);
  if (t.hp > 0) applyStatus(state, t, 'burn', { turns: 3, source: by?.id ?? null }, events);
  if (t.side === 'player') events.push({ type: 'log', words: `Shoved against the lava: ${dealt}.` });
  return true;
}
