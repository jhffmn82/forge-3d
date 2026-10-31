// Shield pools in the order a blow meets them (consolidation C4; ui-37, render-26). damage.js soaks through this list,
// and the HP bar and the map's badges read the same list, so a new pool shows wherever it soaks.
// E26 (1.7 damage-adapter.js:155 absorbOrder): status pools (Ward, Mana Ward), Ice Armor (C57), Iron Hide's pool, the
// Light tome's ward (E35), then Guard.

import statusData from '../../data/statuses.json' with { type: 'json' };
import { whileOf } from './statuses.js';

const SHIELDS = new Set(Object.keys(statusData.rows).filter(id => whileOf(id, 'shield').length));
const AFTER_ICE = new Set(Object.keys(statusData.rows).filter(id => whileOf(id, 'shield').some(w => w.pool === 'hide')));

/** The pools an actor holds now, each {pool, n} with `status` (its id) or `field` (the actor's own number). */
export function shieldPools(a) {
  const st = a?.statuses ?? {};
  const status = late => Object.keys(st).filter(id => SHIELDS.has(id) && AFTER_ICE.has(id) === late && st[id]?.magnitude > 0).map(id => ({ pool: id, status: id, n: st[id].magnitude }));
  const field = (pool, key) => (a?.[key] > 0 ? [{ pool, field: key, n: a[key] }] : []);
  return [...status(false), ...field('ice-armor', 'iceArmor'), ...status(true), ...field('tome-ward', 'tomeWard'), ...field('guard', 'guard')];
}
