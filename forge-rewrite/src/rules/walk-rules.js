// What every walk remembers from its start, and the shared stop rules (consolidation C12, C17: their own file, so the
// walker (auto.js) and Explore's search (explore.js) both read them without importing each other).

import { inEarshot } from './perception.js';

const foundTraps = s => (s.floor.traps ?? []).filter(t => t.found).length;
const alarmsNear = (s, p) => (s.floor.traps ?? []).filter(t => t.kind === 'alarm' && inEarshot(t, p));
const hunters = s => s.order.filter(id => { const a = s.actors[id]; return a && a.side === 'foe' && a.hp > 0 && a.hunting; });

/** What every walk remembers from its start: its floor, the hero's HP, the traps found, the alarms and hunters in earshot. */
export function beginWalk(s, kind) {
  const p = s.actors[s.playerId];
  return { kind, floor: s.floor, hp: p.hp, traps: foundTraps(s), alarms: alarmsNear(s, p), hunters: hunters(s) };
}

/**
 * The shared stop rules, by name; true when the walk should stop. gone: the run is over, the hero down or the floor
 * left; hurt: HP below the lowest it has been on the walk; trap: a trap found since; alarm: an alarm bell in earshot
 * at the start has rung (it leaves the floor); hunter: a creature in earshot has started hunting since.
 */
const RULES = {
  gone: (s, w, p) => s.over || !p || p.hp <= 0 || s.floor !== w.floor,
  hurt: (s, w, p) => p.hp < w.hp,
  trap: (s, w) => foundTraps(s) > w.traps,
  alarm: (s, w) => !!w.alarms?.some(t => !(s.floor.traps ?? []).includes(t)),
  hunter: (s, w, p) => { const now = hunters(s), fresh = now.some(id => !w.hunters.includes(id) && inEarshot(s.actors[id], p)); w.hunters = now; return fresh; },
};
export const stopFor = (s, w, rule) => RULES[rule](s, w, s.actors[s.playerId]);
