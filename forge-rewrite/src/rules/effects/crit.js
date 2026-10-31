// The hero's forced and conditional crits (consolidation C17, moved from effects.js: attack.js and the verbs read them
// without importing the verb path).

import { conditionHolds } from './conditions.js';

/**
 * E29 (1.7 combos.js:17-18 Friction, Storm Ambush; actions.js:9-13): the hero's primary weapon and spell hits on a foe
 * the crit-rule names (Burning, Stunned) are critical; accuracy still applies, since this is read only once a hit lands.
 */
export function forcedCrit(o, t, c, primary) {
  if (o?.side !== 'player' || !o.fx?.critForce?.length) return false;
  return o.fx.critForce.some(r => (primary || !r.primaryOnly) && conditionHolds(r.force, { ...c, state: c.state, owner: o, target: t }));
}

/** E36 (1.7 actions-adapter.js:46 actionRootCrit): the hero's crit points that hold only on this target (the Earth orb on Rooted). */
export function critBonus(o, t, c = {}) {
  if ((o?.side !== 'player' && !o?.echo) || !o.fx?.critIf?.length || !t) return 0;   // the echo keeps it (1.7 shadow-clone.js:49 rootCrit)
  return o.fx.critIf.reduce((n, r) => n + (conditionHolds(r.if, { ...c, state: c.state, owner: o, target: t }) ? r.add : 0), 0);
}

