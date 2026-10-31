// What an action costs in time units (spec/turns.md T2-T6). Class, god and ring terms arrive with A, C and E.

import tuning from '../../data/tuning.json' with { type: 'json' };

const CLOCK = tuning.rows.clock;
const PA = tuning.rows['player-action-cost'];
const CHILL = tuning.rows.chill;
const MOVE = tuning.rows['player-move-cost'];
import { whileOf } from './statuses.js';
import gods from '../../data/gods.json' with { type: 'json' };
import { amount } from './amount.js';
import { effectsOf } from './items.js';
import { T } from '../data/tiles.js';

/** A status's `while` cost-mod on this cost (Storm Form: half action and move time, action time at least 20). */
function statusMod(a, cost, c) {
  for (const id in a.statuses ?? {}) for (const w of whileOf(id, 'cost-mod')) {
    if (w.cost === cost && typeof w.mult === 'number') c = Math.max(w.min ?? 1, c * w.mult);
  }
  return c;
}

/**
 * CD2 (1.7 costs.js action, movement): a status's speed-up on attacks or moves (Rampage on melee attacks, Wizard Hunter
 * on attacks and moves), read at the bearer's rank and divine: the time is divided by (1 + percent).
 */
function statusSpeedUp(a, cost, attack, c) {
  for (const [id, st] of Object.entries(a.statuses ?? {})) for (const w of whileOf(id, 'cost-mod')) {
    if (w.cost !== cost || w.speedUpPct === undefined) continue;
    if (cost === 'action-time' && (!attack || (w.for === 'melee' && !attack.melee) || (w.for === 'unarmed' && !attack.unarmed))) continue;
    c /= 1 + amount(w.speedUpPct, { state: null, owner: a, status: st, rank: a.faithRank ?? 0 }) / 100;
  }
  return c;
}

/**
 * CD2 (1.7 costs.js:9-14): an attack's own time: bare hands x0.8, a dagger x0.9 (its cost-mod), Chad's Staggering
 * Blows on unarmed attacks, then the statuses' speed-ups.
 */
function attackTime(a, c, attack) {
  if (!attack || attack.cast) return c;
  if (attack.unarmed) c *= PA.unarmedAttackMult;
  else if (attack.melee && attack.weapon) for (const e of effectsOf(attack.weapon) ?? []) if (e.verb === 'cost-mod' && e.cost === 'action-time' && e.for === 'melee' && typeof e.mult === 'number') c *= e.mult;
  for (const u of a.fx?.attackSpeedUp ?? []) if (u.for === 'all' || (u.for === 'unarmed' && attack.unarmed) || (u.for === 'melee' && attack.melee)) c /= 1 + u.pct / 100;
  return statusSpeedUp(a, 'action-time', attack, c);
}

/**
 * E32 Deep Chill (1.7 balance-rulings.js:3 chillSlow): 33%, and from the chiller's Water 3, + 3% a Water point, at most
 * 50%. The rank rides on the Chill (effects.js add-stack); the hero's own Chill is never from a Water rank.
 */
function chillSlow(a) {
  const s = a.statuses.chill;
  if (!s) return 0;
  const r = s.waterRank ?? 0;
  return Math.min(CHILL.slowCapPct, CHILL.slowBasePct + (r >= CHILL.slowWaterRankFrom ? CHILL.slowPerWaterRankPct * r : 0)) / 100;
}

function slowDiv(a, cost) {
  const s = a.statuses.slow;
  return s ? Math.round(cost / (s.magnitude ?? tuning.rows['speed-buffs'].slowDefaultMult)) : cost;
}

/**
 * G23 (1.7 costs-adapter.js:4 actorTiming): a creature's speed with its statuses' speed percents (Goblin Rage x1.3).
 * The hero's own (Haste, Cinder Stride) are in his derived speed (derive.js); Chill's slow is chillSlow's.
 */
function speedOf(a) {
  let s = a.speed;
  if (a.side !== 'player') for (const id in a.statuses ?? {}) for (const w of whileOf(id, 'modify-stat')) if (w.stat === 'speed' && typeof w.pct === 'number') s *= 1 + w.pct / 100;
  return s;
}

/** T2: the base cost for this actor's speed. */
export function baseCost(a) {
  return CLOCK.speedNumerator / (speedOf(a) * (1 - chillSlow(a)));
}

/**
 * G23 (1.7 costs-adapter.js:20-21 actCost, gods.js:625 murkSummonBonus): the hero's own summons act faster by his god's
 * own-summons speed-up (Murk's Grave Strength, 5% a rank from rank 3): the cost / (1 + percent), at least 1.
 */
export function summonCost(state, a, cost) {
  const o = a.summon ? state.actors?.[a.owner] : null, h = state.hero;
  if (!o || o.side !== 'player' || !h?.faith?.god) return cost;
  const rank = h.faith.rank ?? 0;
  let pct = 0;
  for (const b of gods.rows[h.faith.god]?.boons ?? []) {
    if (b.rank > rank) continue;
    for (const e of b.effects ?? []) if (e.verb === 'cost-mod' && e.cost === 'action-time' && e.target?.selector === 'own-summons' && e.speedUpPct !== undefined) pct += amount(e.speedUpPct, { state: null, owner: o, rank });
  }
  return pct ? Math.max(1, Math.round(cost / (1 + pct / 100))) : cost;
}

/** T3-T4 for the player, T6 for creatures. `attack` ({melee, unarmed, weapon}): the hero's action was a weapon attack. */
export function actionCost(a, attack = null) {
  if (a.side !== 'player') return Math.max(1, slowDiv(a, Math.round(baseCost(a))));
  const agi = (a.attr?.agi ?? PA.agilityBase) - PA.agilityBase;
  let c = baseCost(a) * (1 - (PA.agilityPerPointPct / 100) * agi);
  c = attackTime(a, c, attack);
  // G4 (1.7 costs.js:16): a spell's cast time x the air tome's thrift; a technique is not a cast (abilities.js says which).
  if (attack?.cast) c *= a.fx?.castTimeMult ?? 1;
  c = Math.max(PA.minimumCost, c);
  // The air holy symbol's action-time cut, never below 40 (1.7 costs.js:21 holyAir).
  const holy = a.fx?.actionTimeMult ?? 1;
  if (holy !== 1) c = Math.max(PA.holyAirMinimumCost, c * holy);
  return slowDiv(a, Math.round(statusMod(a, 'action-time', c)));
}

/**
 * T5 for the player; creatures pay their action cost for moves too. `floor`: the floor the hero stands on after the
 * step (G5, 1.7 costs.js:26-27: wading through water x1.25 unless levitating or flying).
 */
export function moveCost(a, floor = null) {
  if (a.side !== 'player') return actionCost(a);
  // D35 Air: move time / (1 + 10% per point); Fleet (Agility 18) x0.85 (derive.js moveMult).
  // Iron Flesh's 10% a rank (fx.moveTimeDiv) and Wizard Hunter divide on their own (1.7 costs.js movement).
  const wading = floor && floor.tiles?.[a.y * floor.w + a.x] === T.WATER && !a.statuses?.levitate && !a.flags?.includes('flying');
  const base = baseCost(a) * (a.moveMult ?? 1) / (1 + (a.fx?.moveSpeedPct ?? 0) / 100) * (wading ? MOVE.waterMult : 1);
  const c = statusSpeedUp(a, 'move-time', null, base / (a.fx?.moveTimeDiv ?? 1));
  return slowDiv(a, Math.round(statusMod(a, 'move-time', c)));
}
