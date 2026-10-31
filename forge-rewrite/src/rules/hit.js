// To-hit, accuracy and evasion (spec/combat.md C5-C9, C18-C19).

import tuning from '../../data/tuning.json' with { type: 'json' };
import { blocks } from './statuses.js';
import { next } from '../lib/rng.js';
import { holds } from './effects/conditions.js';

const T = tuning.rows['to-hit'];
const CHAOS = tuning.rows['chaos-combat'];

/** C5: chance 0..1 that accuracy lands against evasion. */
export function hitChance(acc, eva) {
  const p = T.basePct / 100 + (T.perPointPct / 100) * (acc - T.accuracyPivot) - (T.perPointPct / 100) * (eva - T.evasionPivot);
  return Math.min(T.maxPct / 100, Math.max(T.minPct / 100, p));
}

/** C8: authored creature accuracy, independent of depth. Chaos retains its existing combat bonus. */
export const accuracyOf = (state, a) => (a.acc ?? 0) +
  (a.side === 'foe' && !a.object && (state.floor?.chaos || a.kind?.startsWith('chaos-')) ? CHAOS.accuracyBonus : 0);

/** C9: evasion counts as 0 while the defender cannot dodge. */
export function evasionOf(a) {
  if (a.hp <= 0 || a.asleep || blocks(a, 'evasion')) return 0;
  return a.eva;
}

/** C18-C19: a creature caught off guard by the player. */
export function isSurprise(state, attacker, defender) {
  if (attacker.side !== 'player') return false;
  if (attacker.statuses.hidden) return true;
  if (defender.side === 'player' || defender.throne) return false;
  // E29 Numbing Dark (1.7 combos.js:541 numbingDark): the hero's attacks and spells on a Chilled foe are surprise attacks.
  if (attacker.fx?.surpriseIf?.length && defender.side === 'foe' && attacker.fx.surpriseIf.some(cond => holds(cond, { state, owner: attacker, target: defender }))) return true;
  if (!defender.hunting || defender.caughtOff === state.actions) return true;
  return blocks(defender, 'act') || !!defender.statuses.blind;
}

/**
 * CD1, RB47 Lucky Streak (1.7 balance-rulings.js combatRoll): the hero's rolls (hit, crit, dodge, parry, block, deflect,
 * Spell Ward, proc chances) roll again once a turn when they fail while the buff lasts. ch is 0..1.
 */
export function heroRoll(state, p, ch, events) {
  if (next(state.rng) < ch) return true;
  if (!(ch > 0) || p?.side !== 'player' || !p.statuses?.luckystreak || p.luckyTurn === state.actions) return false;
  p.luckyTurn = state.actions;
  const ok = next(state.rng) < ch;
  if (ok) events?.push({ type: 'log', words: 'Lucky Streak: reroll succeeded.' });
  return ok;
}

/**
 * CB11 (1.7 combat.js:547-552 deflectProjectile): an arrow or a bolt from a foe at the hero is turned away at his
 * deflect chance (a buckler, air armour) plus Lady Luck. Pushes the 'deflected' miss and returns true.
 */
export function deflects(state, attacker, def, events, o = {}) {
  const pct = def.side === 'player' && attacker?.side === 'foe' ? def.defence?.deflectPct ?? 0 : 0;
  if (!(pct > 0) || !heroRoll(state, def, (pct + (def.luck ?? 0)) / 100, events)) return false;
  events.push({ type: 'attacked', id: attacker.id, target: def.id, hit: false, deflected: true, ranged: true, ...o });
  return true;
}

/**
 * CB05, CB07 (1.7 actions-adapter.js:260, :274; combat.js:152): a foe's chance to hit the hero: Lady Luck takes her
 * points off a weapon blow, then Blur (x0.8, never below 15%).
 */
export function hostileChance(attacker, def, ch, { weapon = false } = {}) {
  if (def.side !== 'player' || attacker?.side !== 'foe') return ch;
  if (weapon) ch -= (def.luck ?? 0) / 100;
  const blur = def.defence?.blur;
  if (blur) ch = Math.max(blur.min / 100, ch * blur.mult);
  return ch;
}

/**
 * C5, C8 (1.7 actions-adapter.js:256-274 rollWeaponHit): the chance a weapon blow lands, the one number the roll (attack.js
 * strike) and the map card's odds read: authored accuracy (plus Chaos's fixed bonus) against evasion (Keen Aim takes a share of it
 * for the hero), x0.6 blind, always on a surprise or a sure hit, then Lady Luck and Blur on a foe's blow at the hero.
 */
export function blowChance(state, attacker, defender, { acc, surprise = false, sureHit = false } = {}) {
  const keen = attacker.side === 'player' ? 1 - (attacker.defence?.ignoreEvaPct ?? 0) / 100 : 1;
  let ch = hitChance(acc ?? accuracyOf(state, attacker), evasionOf(defender) * keen);
  if (attacker.statuses?.blind) ch *= T.blindAttackerMult;
  if (surprise || sureHit) ch = 1;
  return hostileChance(attacker, defender, ch, { weapon: true });
}

/**
 * CH29 (1.7 chaos-enemies.js spellLands, unmaker-encounter.js spell; combat.js:152 hostileHitChance): a creature's own
 * spell roll at the hero is a projectile: his deflect turns it first, then Blur lowers it, and his dodge is his own roll
 * (Lucky Streak). At anyone else it is the plain chance. ch is 0..1.
 */
export function hostileSpellLands(state, attacker, def, ch, events, o = {}) {
  if (def.side !== 'player' || attacker?.side !== 'foe') return next(state.rng) < ch;
  if (deflects(state, attacker, def, events, { spell: true, bolt: true, ...o })) return false;
  return !heroRoll(state, def, 1 - hostileChance(attacker, def, ch), events);
}

/**
 * C5 (engine-rules-07; spec/monsters.md M6): whether a creature's own move lands on t. The plain chance (its accuracy
 * plus accBonus against t's evasion, times tuning's blind multiplier when it is blind); at the hero it is a projectile
 * the hero's deflect, Blur and Lucky Streak answer (hostileSpellLands). o rides along to the deflect (label, bolt).
 */
export function creatureMoveLands(state, a, t, events, { accBonus = 0, ...o } = {}) {
  const ch = hitChance(accuracyOf(state, a) + accBonus, evasionOf(t)) * (a.statuses?.blind ? tuning.rows['to-hit'].blindAttackerMult : 1);
  return hostileSpellLands(state, a, t, ch, events, o);
}
