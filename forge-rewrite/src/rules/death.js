// Deaths (spec/combat.md C76-C82) and the XP a kill gives (spec/character.md A29). Drops and globes arrive with packet C.

import { heroEvent } from './passives.js';
import { awardXp } from './progression.js';
import { killDrops } from './pickup.js';
import { bossDied } from './boss.js';
import { rollTable } from './loot.js';
import { killAward } from './faith.js';
import { amuletKill } from './gear-use.js';
import { CREATURE_HOOKS, UP, provide } from './set-pieces.js';
import { noteKill, noteDeath, killedBy } from './run-record.js';
import tuning from '../../data/tuning.json' with { type: 'json' };
import { statusRow } from './statuses.js';
const runEffect = (...a) => UP.runEffect(...a);   // C17: the one verb path (set-pieces.js UP, from effects.js)
import { holds } from './effects/conditions.js';
import gods from '../../data/gods.json' with { type: 'json' };
import { registerPhase } from './phases.js';
import { bodyAt } from './moves.js';
import { freeNear } from './crypt.js';

const REMAINS_UNITS = tuning.rows['rewards-on-kill'].deathRemainsUnits;

/** Marks a body dead and says so, once (item 174: a second kill does nothing). The player's death ends the run at the action boundary (C82). `how`: the blow's cause and damage type. */
export function kill(state, actor, by, events, tags = [], how = {}) {
  if (actor.diedAt !== undefined) return;
  actor.hp = 0;
  if (actor.side === 'player') {
    state.over = true;
    noteDeath(state, by, tags, how.cause, how.type);   // the Journal's Previous runs say what did it (1.7 damageCause)
    // Item 90 (Justin 2026-10-17): the log names the killer first, then the full death plays.
    events.push({ type: 'log', words: `You have been killed by ${killedBy(by, tags, how.cause, how.type)}.`, warning: true });
    events.push({ type: 'died', id: actor.id, player: true });
    return;
  }
  // `after`: events a hook wants played once the death has (CR13: a Shambler's corpse lies down after its death clip).
  const after = [];
  for (const h of CREATURE_HOOKS.death) if (h(state, actor, by, events, tags, after) === 'spared') { events.push(...after); return; }   // corpses, bursts, Morty's return (crypt.js)
  actor.diedAt = state.now ?? 0;   // dead from here (a spared body, Morty's, is not)
  // W26: the key holder drops the iron key whoever kills it.
  if (actor.key && state.floor?.items) { state.floor.items.push({ x: actor.x, y: actor.y, item: { kind: 'key' } }); events.push({ type: 'drops', at: { x: actor.x, y: actor.y } }); }
  // Kill credit from the lethal cause (combat.md question 2 as revised 10-15): only the player's own blow counts.
  const playerSide = by?.side === 'player';
  noteKill(state, actor, playerSide);   // the end screen's kills and bosses, the bestiary (1.7 RUN.kills)
  // C80 (1.7 death-adapter.js:58-71): the body stays on the floor for 2000 time units, floor state the map draws under
  // the living. Summoned flames and Shades dissipate and leave none; a body with no picture (a limb) leaves none.
  // CR13 (1.7 death-adapter.js:45 deathAnimation(e, false)): a Shambler that will rise lies as its corpse, not as remains.
  if (state.floor && actor.look?.sheet && actor.kind !== 'living-flame' && actor.kind !== 'shade' && !actor.shade && !state.floor.corpses?.some(c => c.id === actor.id)) {
    const f = state.floor;
    f.deathRemains = (f.deathRemains ?? []).filter(r => state.now < r.expiresAt);
    f.deathRemains.push({ id: actor.id, x: actor.x, y: actor.y, sheet: actor.look.sheet, art: actor.look.art, ...(actor.look.bigScale ? { bigScale: actor.look.bigScale } : {}), size: actor.size ?? 1, bornAt: state.now, expiresAt: state.now + REMAINS_UNITS });
  }
  events.push({ type: 'died', id: actor.id, creditPlayer: playerSide, by: by?.id ?? null });   // E49: the log names an ally's kill
  events.push(...after);
  lichFalls(state, actor);
  if (playerSide) heroEvent(state, 'on-kill', { victim: actor, target: actor, packet: { tags } }, events);
  // A29: the creature's XP (10 if it has none), unless it is marked no-XP.
  if (playerSide && !actor.noXp && state.hero) awardXp(state, actor.xp ?? 10, events);
  // F8: the sworn god's kill award.
  if (state.hero) killAward(state, actor, by, events, tags ?? []);
  if (playerSide && state.hero) amuletKill(state, actor, by, events);   // I45
  // A set piece leaves its hoard (and the floor's core) whoever lands the blow; others drop by their table.
  if (actor.set && state.floor?.items) bossDied(state, actor, events, rollTable);
  else if (playerSide && state.floor?.items) killDrops(state, actor, events);
  // CB14 (1.7 death-adapter.js:95): the dead body's statuses' own on-death rows (Corrupted raises a Shade for the hero).
  const hero = state.actors?.[state.playerId];
  // E8: a timed immunity (imm-fear) has no row (statuses.js tickBearer skips it the same way); any other id must have one.
  const rowOf = id => (id.startsWith('imm-') ? null : statusRow(id));
  for (const id of Object.keys(actor.statuses ?? {})) for (const w of rowOf(id)?.while ?? []) {
    if (w.verb !== 'on-event' || w.trigger !== 'on-death' || !hero) continue;
    const c = { state, owner: hero, source: hero, victim: actor, target: actor, by, playerKill: playerSide, events };
    if (w.if && !holds(w.if, c)) continue;
    for (const e of w.effects ?? []) runEffect(e, c);
  }
}

/**
 * RB45 (1.7 death-adapter.js:152, :161; recovery.js turnLichReturn): Mother Murk's sworn at rank 5 (the Lich boon) see
 * their Raise Dead servant rise once more, a paid action after it falls, at half its HP, where it fell or within 2.
 * Raise Dead waits while it is returning (abilities.js notWhile).
 */
const LICH = gods.rows.murk?.lichReturn, LICH_RANK = (gods.rows.murk?.boons ?? []).find(b => b.id === 'lich')?.rank ?? 5;
function lichFalls(state, a) {
  const f = state.hero?.faith;
  if (!LICH || !a.servant || a.revived || a.side !== 'ally' || a.owner !== state.playerId || f?.god !== 'murk' || (f.rank ?? 0) < LICH_RANK || !state.floor) return;
  state.floor.pendingLich = { id: a.id, at: state.actions + (LICH.afterActions ?? 1) };
}

registerPhase('lich-return', (state, ctx, events) => {
  const f = state.floor, R = f?.pendingLich;
  if (!R || state.actions < R.at) return;
  const dead = state.actors[R.id], p = state.actors[state.playerId];
  if (!dead) { delete f.pendingLich; return; }
  const at = !bodyAt(state, dead.x, dead.y) ? { x: dead.x, y: dead.y } : freeNear(state, dead, 2);
  if (!at) return;   // 1.7: no room yet, it tries again next action
  delete f.pendingLich;
  const m = { ...dead, id: dead.id + '-r', x: at.x, y: at.y, hp: Math.max(1, Math.round(dead.maxhp * (LICH.pctMaxHp ?? 50) / 100)), statuses: {}, t: p.t, revived: true, diedAt: undefined };
  delete m.life;
  delete state.actors[dead.id]; state.order = state.order.filter(id => id !== dead.id);
  if (f.deathRemains) f.deathRemains = f.deathRemains.filter(r => r.id !== dead.id);
  state.actors[m.id] = m; state.order.push(m.id);
  events.push({ type: 'spawned', id: m.id, at }, { type: 'log', words: LICH.log ?? 'Your Lich rises again at half health.', cls: 'c-good' });
});
provide('kill', kill);   // C17: what the rules below this module call up to it (set-pieces.js UP)
