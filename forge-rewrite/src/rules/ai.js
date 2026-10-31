// Creatures' turns (spec/monsters.md M10-M39, Behaviours: hunter, kiter, support-caster). Noticing follows
// spec/character.md A42. Behaviours not built yet (caster, ambusher, aquatic, burrower ...) are recorded in
// state.unbuilt and act as hunters.

import { blocks } from './statuses.js';
import { weaponAttack } from './attack.js';
import { tryStep, bodyAt } from './moves.js';
import { lineClear } from './sight.js';
import { next, roll } from '../lib/rng.js';
import { cheb, D8 } from '../lib/geometry.js';
import { T } from '../data/tiles.js';
import tuning from '../../data/tuning.json' with { type: 'json' };
import { amount } from './amount.js';
import { SET_PIECES, CREATURE_HOOKS } from './set-pieces.js';
import { noticeChance, seesPlayer, remember, forget, seesBody, investigate } from './ai-sense.js';
import { clearShot, tryMoves, callForHelp, supportCaster } from './ai-moves.js';
import { stepToward, stepAway, libraryDormant } from './ai-step.js';

const MEMORY = tuning.rows.ai.memoryUnits;   // M14 (tuning ai)
const HUNT_SLEEP = tuning.rows.ai.huntSleepUnits;   // item 149 (tuning ai)

const BUILT = new Set(['hunter', 'kiter', 'support-caster', 'boss']);


/** M10: a wanderer walks to a random floor tile, picking again 4% of its actions (tuning ai) or on arrival. */
function wander(state, a, events) {
  const f = state.floor;
  if (!a.wanderTo || next(state.rng) < tuning.rows.ai.wanderRepickPct / 100 || (a.x === a.wanderTo.x && a.y === a.wanderTo.y)) {
    const r = f.rooms?.length ? f.rooms[Math.floor(next(state.rng) * f.rooms.length)] : null;
    a.wanderTo = r ? { x: r.x + roll(state.rng, 0, r.w - 1), y: r.y + roll(state.rng, 0, r.h - 1) } : null;
  }
  if (a.wanderTo) stepToward(state, a, a.wanderTo, events);
}


/** EP15, M18 (1.7 petTarget): an ally of the hero this creature sees, the one that hurt it first, else the nearest. */
function petTarget(state, a) {
  const pets = state.order.map(id => state.actors[id]).filter(b => b?.side === 'ally' && !b.statuses?.tomb && seesBody(state, a, b));
  pets.sort((x, y) => (y.id === a.petAggressor) - (x.id === a.petAggressor) || cheb(a, x) - cheb(a, y));
  return pets[0] ?? null;
}

/** EP15, M18 (1.7 combat.js petRetaliationBehavior): out of the hero's sight it fights the ally with its own moves. */
function fightPet(state, a, pet, events) {
  if (tryMoves(state, a, pet, events)) return;
  const d = cheb(a, pet);
  if ((a.range ?? 1) > 1 && d >= 2 && d <= a.range && clearShot(state, a, pet) && !blocks(a, 'melee')) { weaponAttack(state, a, pet, events, { ranged: true }); return; }
  if (d <= 1) { if (!blocks(a, 'melee')) weaponAttack(state, a, pet, events); return; }
  if (!blocks(a, 'move')) stepToward(state, a, pet, events);
}


/** The player's allies (monsters.md M69-M70, magic.md D26-D27): strike or shoot the nearest foe in sight, else stay near the hero. */
function allyAct(state, a, events) {
  const p = state.actors[state.playerId], W = state.floor.w;
  if (a.echo) echoUpkeep(state, a, events);
  // CB49 (1.7 shadow-clone.js act): the echo joins a fight it can see within 8 and finishes it without a leash.
  const reach = a.echo ? ECHO_REACH : 7;
  const foes = state.order.map(id => state.actors[id]).filter(f => f.hp > 0 && f.side === 'foe' && !f.statuses.tomb
    && cheb(f, a) <= reach && (state.vis?.[f.y * W + f.x] || lineClear(state.floor, a, f))).sort((x, y) => cheb(x, a) - cheb(y, a));
  const held = a.echo ? state.actors[a.echoTarget] : null;
  const foe = held && held.hp > 0 && foes.includes(held) ? held : foes[0];
  if (a.echo) { a.echoTarget = foe?.id ?? (held?.hp > 0 ? held.id : null); if (foe) a.echoSaw = { x: foe.x, y: foe.y }; }
  if (foe) {
    if (a.moves && tryMoves(state, a, foe, events)) return;
    if (cheb(foe, a) === 1 && !a.params?.noMelee) {
      if (!blocks(a, 'melee')) {
        weaponAttack(state, a, foe, events);
        // The echo's off-hand weapon swings again at x0.6 (1.7 shadow-clone.js strike).
        if (a.offDmg && a.hp > 0 && foe.hp > 0) weaponAttack(state, a, foe, events, { mult: tuning.rows['weapon-damage'].offhandMult, dmg: a.offDmg, weapon: 'off', label: 'Off-hand' });
      }
      return;
    }
    if (!a.params?.noMelee && !a.params?.stay && !blocks(a, 'move')) { stepToward(state, a, foe, events); return; }
  }
  // Out of sight, the echo goes to where it last saw its foe before it gives up the chase.
  if (a.echo && a.echoTarget && a.echoSaw && cheb(a, a.echoSaw) > 1 && !blocks(a, 'move')) { stepToward(state, a, a.echoSaw, events); return; }
  if (a.echo) { a.echoTarget = null; a.echoSaw = null; }
  if (!a.params?.stay && cheb(a, p) > 2 && !blocks(a, 'move')) stepToward(state, a, p, events);
}

const ECHO_REACH = 8, ECHO_CALM = 500;

/**
 * CB49 (1.7 shadow-clone.js pulse): the echo's own regeneration since it last acted: HP while the hero is fed, not
 * poisoned or rotting and no hunter is on it within its reach; mana always; Ice Armor and Guard a point a game turn
 * after 500 units unhurt.
 */
function echoUpkeep(state, a, events) {
  const dt = Math.max(0, state.now - (a.regenAt ?? state.now)) / 100, r = a.regen;
  a.regenAt = state.now;
  if (!dt || !r) return;
  const fighting = state.order.some(id => { const f = state.actors[id]; return f.hp > 0 && f.side === 'foe' && f.hunting && cheb(f, a) <= ECHO_REACH && lineClear(state.floor, a, f); });
  if ((state.hero?.hunger ?? 1) > 0 && !a.statuses.poison && !a.statuses.rot && !fighting && a.hp < a.maxhp) {
    a.regenHp = (a.regenHp ?? 0) + a.maxhp * r.hp * (a.hp < a.maxhp / 2 ? r.resilient : 1) * dt;
    if (a.regenHp >= 1) { const n = Math.min(Math.floor(a.regenHp), a.maxhp - a.hp); a.hp += n; a.regenHp -= Math.floor(a.regenHp); events.push({ type: 'healed', id: a.id, amount: n, regen: true }); }
  }
  if (a.maxmana) a.mana = Math.min(a.maxmana, (a.mana ?? 0) + a.maxmana * r.mp * (a.mana < a.maxmana / 2 ? r.tidal : 1) * dt);
  if (a.lastHurtAt === undefined || state.now - a.lastHurtAt >= ECHO_CALM) {
    if (a.maxIceArmor) a.iceArmor = Math.min(a.maxIceArmor, (a.iceArmor ?? 0) + dt);
    if (a.maxguard) a.guard = Math.min(a.maxguard, (a.guard ?? 0) + dt);
  }
}

/**
 * C22, M13 (1.7 actor-ai.js:217-236 actorFinish): after a foe's action, one hunting that sees the hero now, and either
 * did not see him as the action began or had lost him for 2 of its own actions, gives a new surprise opening:
 * "The Name spots you!" with its alert sound. A creature that only now noticed already has its opening.
 */
const LOST = tuning.rows.surprise.lostActionsForNewOpening;

export function creatureAct(state, a, events) {
  const p = state.actors[state.playerId];
  if (state.sandbox?.mapMode && a.side === 'foe') return;   // H33: in the sandbox's Map mode creatures stand still (1.7 actor-ai.js:245)
  if (a.limbOf || a.flags?.includes('object')) return;   // C10c (engine-rules-30): limbs and objects never act
  const watch = a.side === 'foe' && a.hp > 0 && !a.flags?.includes('boss') && !a.flags?.includes('object') && !a.limbOf;
  const before = watch ? { hunting: !!a.hunting, saw: seesPlayer(state, a, p) } : null;
  const from = events.length;
  act(state, a, events);
  if (a.unseen && events.slice(from).some(v => v.id === a.id && (v.type === 'attacked' || v.type === 'move-used'))) reveal(a, events);
  if (!before || a.hp <= 0 || !state.actors[a.id] || p.hp <= 0) return;
  const see = seesPlayer(state, a, p);
  if (see && a.hunting && before.hunting && !blocks(a, 'act') && (!before.saw || (a.lostFor ?? 0) >= LOST)) {
    a.caughtOff = state.actions;
    events.push({ type: 'log', words: `${/^The | the /.test(a.name ?? '') ? '' : 'The '}<b>${a.name}</b> spots you!` }, { type: 'alert', id: a.id, sfx: a.sfx ? a.sfx + '-alert' : null });
  }
  a.lostFor = see ? 0 : a.hunting ? (a.lostFor ?? 0) + 1 : 0;
}

// X10, item 287 (1.7 geometry-adapter.js actorConcealed, revealActor): a body whose row spawns it unseen (monsters.json
// conceal until-revealed: the Lash and Razor Dancers, the Drow Blade) is not drawn until it attacks or casts, or takes HP.
function reveal(a, events) {
  a.unseen = false; a.hidden = false;
  events.push({ type: 'revealed', id: a.id });
}
CREATURE_HOOKS.damaged.push((state, t, packet, dealt, events) => { if (t.unseen && dealt > 0) reveal(t, events); });

/** The counters that count a creature's own actions (an on-hit passive's every-Nth, the Brute's push); moves are on the world clock. */
function tickActionCounters(a) { for (const k in a.cd ?? {}) if (a.cd[k] > 0) a.cd[k]--; }

function act(state, a, events) {
  if (blocks(a, 'act')) return;
  if (a.side === 'ally') {
    tickActionCounters(a);
    for (const h of CREATURE_HOOKS.act ?? []) if (h(state, a, events)) return;   // an ally with its own walk (prison.js: the escapee)
    return allyAct(state, a, events);
  }
  tickActionCounters(a);
  const p = state.actors[state.playerId];
  if (p.hp <= 0) return;
  if (libraryDormant(state, a)) return;   // EP16, M21: a keeper of an unentered library takes no action
  if (a.set && SET_PIECES[a.set]) return SET_PIECES[a.set](state, a, events);
  for (const h of CREATURE_HOOKS.act ?? []) if (h(state, a, events)) return;   // a creature that takes its whole action its own way (caverns.js: the Shock Eel)
  const dist = cheb(a, p), sees = seesPlayer(state, a, p);
  // Fear: a step away from the hero and nothing else.
  if (a.statuses.fear) { stepAway(state, a, p, events); return; }
  if (!a.hunting) {
    a.called = false;   // EP17 (1.7 teamwork takeTurn): not hunting, so the next hunt may call again
    if (next(state.rng) < noticeChance(state, a, p, dist)) {
      remember(state, a, p);
      events.push({ type: 'noticed', id: a.id });
      if (sees) events.push({ type: 'log', words: `${a.name} notices you.` });   // EP10, M12 (1.7 enemy-perception.js:47)
      // EP9 (1.7 enemy-perception.js takeTurn): noticing costs nothing; the same action goes on to hunt (and to call).
    } else {
      if (a.asleep) return;
      // Items 149, 347: an unaware wanderer sleeps after 30 game turns; a lost hunt counts from the last sighting.
      if (!a.boss) {
        a.coldSince ??= state.now;
        if (state.now - a.coldSince >= HUNT_SLEEP) { a.asleep = true; delete a.coldSince; return; }
      }
      // Traps 85: a creature called somewhere walks there; it stops on arrival.
      if (a.goal && !blocks(a, 'move')) {
        if (a.x === a.goal.x && a.y === a.goal.y) { a.goal = null; return; }
        stepToward(state, a, a.goal, events);
        return;
      }
      if (!blocks(a, 'move')) wander(state, a, events);
      return;
    }
  }
  if (!BUILT.has(a.behaviour ?? 'hunter')) state.unbuilt['behaviour:' + a.behaviour] = (state.unbuilt['behaviour:' + a.behaviour] ?? 0) + 1;
  // M14: a hunter remembers the hero's last seen tile for 1200 time units, then forgets and wanders.
  if (sees) remember(state, a, p);
  else if (!a.lastSeen || state.now - a.lastSeen.at > MEMORY) { forget(a); wander(state, a, events); return; }
  // M24 families, EP17: a caller on a hunt it has not called on calls for help; an answered call is the action.
  if (callForHelp(state, a, events)) return;
  // EP15, M18: out of the hero's sight, an ally of his it can see is fought instead.
  if (!sees && dist > 1) {
    const pet = petTarget(state, a);
    if (pet) { a.petAggressor = pet.id; return fightPet(state, a, pet, events); }
  }
  // M29: a hunter beside one of the hero's allies and not beside the hero strikes the ally 60% of the time.
  if (dist > 1 && !blocks(a, 'melee')) {
    const ally = state.order.map(id => state.actors[id]).find(b => b.hp > 0 && b.side === 'ally' && cheb(a, b) === 1);
    if (ally && next(state.rng) < 0.6) { weaponAttack(state, a, ally, events); return; }
  }
  for (const h of CREATURE_HOOKS.hunt) if (h(state, a, p, { sees, dist }, events)) return;   // biome behaviours (crypt.js)
  if (sees || dist <= 1) {
    if (a.behaviour === 'support-caster' && supportCaster(state, a, p, dist, events)) return;
    if (tryMoves(state, a, p, events)) return;
    if (a.behaviour === 'kiter' && dist === 1 && next(state.rng) < (a.params?.fleeAdjacentPct ?? 0) / 100 && !blocks(a, 'move') && stepAway(state, a, p, events)) return;
    // M4: a ranged blow along a clear line from 2 to its range.
    if ((a.range ?? 1) > 1 && dist >= 2 && dist <= a.range && clearShot(state, a, p) && !blocks(a, 'melee')) { weaponAttack(state, a, p, events, { ranged: true }); return; }
    if (dist === 1) { if (!blocks(a, 'melee')) weaponAttack(state, a, p, events); return; }
  }
  if (blocks(a, 'move')) return;
  // Erratic fliers (bats) take a random step on a draw instead of chasing.
  if (a.params?.erraticPct && next(state.rng) < a.params.erraticPct / 100) {
    const [dx, dy] = D8[Math.floor(next(state.rng) * 8)];
    if (tryStep(state, a, dx, dy, events)) return;
  }
  if (sees) stepToward(state, a, p, events);
  else investigate(state, a, events);   // EP12
}
