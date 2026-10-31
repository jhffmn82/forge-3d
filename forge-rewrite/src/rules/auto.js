// One walker controller (consolidation C12; engine-rules-08, 11, 28): every walk of more than one command is a kind
// here, judged between its steps by one set of stop rules read from perception.js (earshot, foes in sight). Kinds:
// explore (rules/explore.js's search) and rest (1.7's R, below); the map's route walk (engine/travel.js) asks the same
// rules. Headless: main.js asks for each step (walkNext) and plays it as an ordinary command.

import progression from '../../data/progression.json' with { type: 'json' };
import { foesInSight } from './perception.js';
import { startExplore, exploreNext } from './explore.js';

import { beginWalk, stopFor } from './walk-rules.js';
export { beginWalk, stopFor };

// ---------------------------------------------------------------- rest (moved from rest.js)
// Rest, as 1.7's (js/presentation/ui/ui.js rest, the R key): searches at half chance, a turn at a time, until HP and
// mana are full. Never with a foe in sight; it stops when one comes into view, an alarm bell within earshot rings, a
// creature that close starts hunting, the hero grows hungry, or after 150 turns.
const MAX_TURNS = 150, HUNGRY = progression.rows.hunger.hungryWarningAt;
const seenFoe = s => foesInSight(s, { hidden: false }).length > 0;

/** R: a rest to run, or the line that refuses it. */
export function startRest(s) {
  const p = s?.actors?.[s.playerId];
  if (!p || p.hp <= 0) return {};
  if (seenFoe(s)) return { say: 'You cannot rest with enemies in sight.' };
  return { rest: { ...beginWalk(s, 'rest'), n: 0 }, say: 'You rest...' };
}

/** The next rest turn: { command } to play, or { stop, say? } when the rest ends. */
export function restNext(s, r) {
  const p = s?.actors?.[s.playerId];
  if (stopFor(s, r, 'gone') || r.n++ >= MAX_TURNS) return { stop: true };
  if (p.hp >= p.maxhp && (p.mana ?? 0) >= (p.maxmana ?? 0)) return { stop: true, say: 'Rested.', good: true };
  if (seenFoe(s)) return { stop: true, say: 'Something approaches! You stop resting.' };
  if (stopFor(s, r, 'alarm')) return { stop: true, say: 'The alarm bell rouses you. You stop resting.' };
  if (stopFor(s, r, 'hunter')) return { stop: true, say: 'Something nearby is on the hunt. You stop resting.' };
  if ((s.hero?.hunger ?? HUNGRY) < HUNGRY && r.n > 1) return { stop: true, say: 'You are too hungry to rest well.' };
  if (p.statuses?.fear) return { stop: true };   // statuses.md: fear stops travel and rest
  return { command: { type: 'search', rest: true } };
}

// ---------------------------------------------------------------- the kinds
const KINDS = { explore: { start: s => startExplore(s), next: exploreNext }, rest: { start: s => { const r = startRest(s); return { walk: r.rest, say: r.say }; }, next: restNext } };
/** Starts a walk of `kind`: { walk } to step with walkNext (and say, a line to show), or { say } when it cannot start. */
export const startWalk = (kind, s) => KINDS[kind].start(s);
/** The walk's next command: { command }, or { stop, say?, good?, command? } when it ends. */
export const walkNext = (s, walk) => KINDS[walk.kind].next(s, walk);
