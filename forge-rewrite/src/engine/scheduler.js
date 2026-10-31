// One player action and everything the world does in the time it costs (spec/turns.md T12-T30).

import { runPulseHooks } from '../rules/pulse-hooks.js';
import { fieldPulse } from '../rules/fields.js';
import tuning from '../../data/tuning.json' with { type: 'json' };
import { actionCost, moveCost, summonCost } from '../rules/costs.js';
import { creatureAct } from '../rules/ai.js';
import { pulsePassives } from '../rules/ai-moves.js';
import { CREATURE_HOOKS } from '../rules/set-pieces.js';
import { tickBearer } from '../rules/statuses.js';
import { runEffect } from '../rules/effects.js';
import { crumbleRocks } from '../rules/effects/select.js';
import { BEFORE, AFTER, runPhases } from '../rules/phases.js';
import { faithPulse } from '../rules/faith.js';
import { wanderingPulse } from '../rules/spawns.js';
import '../rules/boss.js';
import { tickCooldowns } from '../rules/abilities.js';
import { heroEvent } from '../rules/passives.js';
import { heroRoll } from '../rules/hit.js';

const TURN = tuning.rows.clock.unitsPerGameTurn;
const LIMIT = tuning.rows.clock.schedulerStepLimit;

/** T26: one world pulse. Statuses tick for the player first, then every creature in list order. */
function pulse(state, at, events) {
  state.now = at;
  state.pulseAt = at;
  for (const id of state.order) {
    const a = state.actors[id];
    if (!a || a.hp <= 0) continue;   // A death hook can remove later actors (the Maw's limbs) during this pulse.
    tickBearer(state, a, at, events, runEffect);
    // D26-D27: a summon's life counts game turns; at 0 it fades.
    if (a.life !== undefined && a.hp > 0 && --a.life <= 0) { a.hp = 0; events.push({ type: 'died', id: a.id, expired: true }); continue; }
    if (a.passives && a.hp > 0) pulsePassives(state, a, events);
    if (state.actors[state.playerId].hp <= 0) return;
  }
  // F60: wrath and the shrine blessing count down on the world pulse.
  if (state.floor) { crumbleRocks(state, events); fieldPulse(state, events); }   // D30; fields and burning ground
  runPulseHooks(state, events);    // biome pulse hooks (src/rules/pulse-hooks.js): marked blows land on the world clock
  if (state.hero) { faithPulse(state, events); tickCooldowns(state); }   // D4: cooldowns count game turns
  const hp = state.actors[state.playerId];
  if (hp.maxIceArmor > (hp.iceArmor ?? 0) && state.now - (hp.lastHurtAt ?? -1e9) >= 500) hp.iceArmor = (hp.iceArmor ?? 0) + 1;   // C61
  if (state.hero && state.floor?.rooms?.length) wanderingPulse(state, events);   // W57
  events.push({ type: 'pulse', at });
}

/** T21-T24: creatures act in clock order, pulses run at each multiple of 100 first. */
function schedule(state, to, events) {
  for (let steps = 0; steps < LIMIT; steps++) {
    if (state.actors[state.playerId].hp <= 0) return;
    let next = null;
    for (const id of state.order) {
      const a = state.actors[id];
      if (a.side === 'player' || a.hp <= 0 || a.t >= to) continue;
      if (!next || a.t < next.t) next = a;
    }
    const nextPulse = state.pulseAt + TURN;
    if (nextPulse <= to && (!next || nextPulse <= next.t)) { pulse(state, nextPulse, events); continue; }
    if (!next) return;
    state.now = next.t;
    const wasX = next.x, wasY = next.y;
    creatureAct(state, next, events);
    if (next.hp > 0 && (next.x !== wasX || next.y !== wasY)) for (const h of CREATURE_HOOKS.moved) h(state, next, events, { x: wasX, y: wasY });   // 1.7 actorFinish: what a creature does on arriving (mushrooms)
    next.t += Math.max(1, summonCost(state, next, actionCost(next)));   // G23: the hero's summons by his god's speed-up
  }
  throw new Error('scheduler step limit reached');
}

/**
 * T12-T20. `resolve` runs the command and says what kind of action it was:
 * 'move', 'act', 'free' (done, no time passes) or 'refused' (not done, no time passes).
 * @param {(events:any[]) => 'move'|'act'|'free'|'refused'|{kind:string, attack?:object, loud?:boolean}} resolve
 */
export function playerAction(state, resolve, events) {
  const p = state.actors[state.playerId];
  const from = p.t;
  state.now = from;
  const at = { x: p.x, y: p.y };
  // C13 (one result shape): a kind, or { kind, attack, loud }. CD2: a weapon attack or a cast has its own time (bare
  // hands, a dagger, Rampage, Wizard Hunter); loud: an attack, a shot or an aimed cast (E31 Lightning Reflexes).
  const res = resolve(events), kind = res?.kind ?? res, attack = res?.attack ?? null, loud = !!res?.loud;
  if (kind === 'refused' || kind === 'free') return;
  if (p.hp <= 0) return;
  // E37 Cinder Stride (1.7 sigils.js:236-241 turnPrepareCinder): the tile the hero left burns for 3 turns.
  if (p.statuses.cinder && (p.x !== at.x || p.y !== at.y)) heroEvent(state, 'on-move', { target: at }, events);
  // E31, G18 Lightning Reflexes (1.7 turns.js:14): an attack, a shot or an aimed cast that stood still may take no time;
  // the roll is the hero's own (1.7 pRoll: Lady Luck adds, Lucky Streak rerolls).
  if (kind === 'act' && (attack?.melee || loud) && (p.fx?.freeActionPct ?? 0) > 0 && heroRoll(state, p, (p.fx.freeActionPct + (p.luck ?? 0)) / 100, events)) return;
  const cost = kind === 'move' ? moveCost(p, state.floor) : actionCost(p, attack);
  if (cost === 0) return;
  const to = from + cost;
  p.t = to;
  state.actions += 1;
  const ctx = { from, to, cost, kind };
  runPhases(BEFORE, state, ctx, events);
  if (p.hp > 0) schedule(state, to, events);
  if (p.hp > 0) runPhases(AFTER, state, ctx, events);
  state.now = to;
}
