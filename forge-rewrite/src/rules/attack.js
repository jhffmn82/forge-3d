// A weapon attack, in 1.7's order of rolls (spec/combat.md "A weapon attack", steps 3-7, 12).
// Deflect, clones, enchants, Smite, Cleave and Gust come with packets C, D and E.

import { heroEvent, echoEvent } from './passives.js';
import tuning from '../../data/tuning.json' with { type: 'json' };
import { next, roll } from '../lib/rng.js';
import { blowChance, isSurprise, deflects, heroRoll } from './hit.js';
import { dealDamage, armourReduce, creatureArmourOff, physTakenMult } from './damage.js';
import { applyStatus, removeStatus, whileOf } from './statuses.js';
import { onHitPassives } from './ai-moves.js';
import { witness } from './ai-sense.js';
import { summonLifeDrain } from './god-powers.js';
import { forcedCrit, critBonus } from './effects/crit.js';
import { damageRows } from './derive.js';
import { holds } from './effects/conditions.js';
import { amount } from './amount.js';
import { effectsOf } from './items.js';
import classes from '../../data/classes.json' with { type: 'json' };
import foods from '../../data/foods.json' with { type: 'json' };
import MON from '../../data/monsters.json' with { type: 'json' };
import { itemRow, weaponDamage, value } from './items.js';
import { noteUse } from './gear-use.js';

const W = tuning.rows['weapon-damage'];
const CRIT = tuning.rows.critical;
const SUR = tuning.rows.surprise;
const ELEMENT_PROC = { fire: ['burn', 3], water: ['chill', null], earth: ['root', 2], shadow: ['fear', 2], air: ['stun', 1], light: ['blind', 2] };
const ELEMENT_TYPE = { fire: 'fire', water: 'ice', air: 'lightning', earth: 'poison', light: 'light', shadow: 'dark' };
/** The statuses a food gives (Roast Meat's Might): their damage percent multiplies the roll apart from the pool. */
const FOOD_BUFFS = new Set(Object.values(foods.rows).flatMap(r => (r.effects ?? []).filter(e => e.verb === 'apply-status').map(e => e.status)));

/**
 * @param {{mult?:number, label?:string, sureHit?:boolean, ranged?:boolean, proc?:boolean, weapon?:string}} o
 */
/**
 * Sandbox item 62 (Justin 2026-10-16: "i don't seem to double attack with on equiped in my off hand"): 1.7's
 * offHandSwing. A weapon in the off hand, with no two-handed main weapon, strikes the same foe again after every melee
 * bump, at 60% with its own damage, firing only its own enchant.
 */
export function offHandSwing(state, p, foe, events) {
  const h = state.hero, off = h?.worn?.off, main = h?.worn?.main;
  if (!off || foe.hp <= 0 || p.hp <= 0 || itemRow(off.id).kind !== 'weapon') return;
  if (main && itemRow(main.id).row.hands === 2) return;
  weaponAttack(state, p, foe, events, { mult: W.offhandMult, dmg: weaponDamage(off, h), weapon: 'off', label: 'Off-hand' });
}

/**
 * CB06, G7, G8 (1.7 weaponBaseDamage, actions-adapter.js:296-313, :334): the hero's blow multiplier. One stat pool of
 * Might (4% a point over 10) and every damage percent whose condition holds for this blow (derive.js damageRows: Heavy
 * Hands +10% and Unstoppable +20% in melee, Crushing Blows +25% below half HP, Glimmer on undead) plus the hero's
 * statuses (Rampage in melee, Rally); the swung weapon's own dealt mods (the axe's executioner, the dagger's surprise
 * x1.2); a food's Might multiplies the roll on its own (1.7 stats.js:170).
 */
export function heroBlowMult(state, p, def, hit, weapon = 'main') {
  const h = state.hero;
  let stat = Math.max(0, (p.attr?.mig ?? 10) - 10) * W.mightPerPointPct / 100, gear = 1, food = 1;
  if (!h) return Math.max(W.poolFloor, 1 + stat);
  const c = { state, owner: p, target: def, source: p, hit, rank: h.faith?.rank ?? 0 };
  for (const r of p.derived?.damageRows ?? damageRows(h)) if (!r.if || holds(r.if, c)) stat += r.pct / 100;   // C7: applyHero's, compiled once
  for (const [id, st] of Object.entries(p.statuses ?? {})) for (const w of whileOf(id, 'modify-stat')) {
    if (w.stat !== 'damage-pct' || (w.if && !holds(w.if, c))) continue;
    const v = amount(w.pct ?? 0, { ...c, status: st }) / 100;
    if (FOOD_BUFFS.has(id)) food *= 1 + v; else stat += v;
  }
  const item = h.worn?.[weapon];
  if (item) for (const e of effectsOf(item) ?? []) if (e.verb === 'damage-mod' && e.direction === 'dealt' && typeof e.mult === 'number' && (!e.if || holds(e.if, c))) gear *= e.mult;
  return Math.max(W.poolFloor, 1 + stat) * gear * food;
}

export function weaponAttack(state, attacker, defender, events, o = {}) {
  const from = events.length, beside = Math.max(Math.abs(attacker.x - defender.x), Math.abs(attacker.y - defender.y)) <= 1;
  // RB44 (1.7 actions-adapter.js:90-92, recovery.js stackLivingMountain): Grom's Living Mountain stacks before an
  // unarmed main-hand blow rolls, hit or miss, and the new stack counts for that blow (the boon's on-swing row).
  if (attacker.side === 'player' && o.weapon !== 'off' && !o.proc && defender.side !== 'player') heroEvent(state, 'on-swing', { target: defender }, events);
  strike(state, attacker, defender, events, o);
  // G16 Thorns (1.7 actions-adapter.js:95-96, :150-151): a foe's blow from beside the hero is answered with half of what
  // it took off him, HP and the Ward, Ice Armor and Mana Ward pools together (statuses.json thorns, on-melee-hit-taken).
  if (defender.side === 'player' && attacker.side === 'foe' && beside && !o.proc && attacker.hp > 0) {
    let taken = 0;
    for (const ev of events.slice(from)) if (ev.id === defender.id && (ev.type === 'damaged' || (ev.type === 'absorbed' && ev.pool !== 'guard'))) taken += ev.amount;
    if (taken > 0 && defender.hp > 0) heroEvent(state, 'on-melee-hit-taken', { target: attacker, attacker, packet: { 'taken-with-shields': taken, raw: taken, type: 'phys', tags: ['attack', 'melee'] } }, events);
  }
  // CD2 Perfect Counter (1.7 actions-adapter.js:11-26): every hostile attack on the hero, hit, miss or parried, is answered.
  if (defender.side === 'player' && attacker.side === 'foe' && !o.proc && attacker.hp > 0 && defender.hp > 0) heroEvent(state, 'on-attacked', { target: attacker, attacker }, events);
}

/** CD10 (1.7 damage-adapter.js:139 hitWeapon.pierce): the armour the swung weapon ignores (a mace's 2 to 4 by tier). */
function pierceOf(hero, slot) {
  const it = hero?.worn?.[slot];
  if (!it) return 0;
  let n = 0;
  for (const e of effectsOf(it) ?? []) if (e.verb === 'modify-stat' && e.stat === 'armour-pierce') n += typeof e.add === 'object' && 'from-source' in e.add ? value(itemRow(it.id).row.values[e.add['from-source']], it, hero) : Number(e.add) || 0;
  return n;
}

/**
 * C4 (ui-06): the hero's weapon blow on def without a roll, for the map card: {lo, hi} from each end of the damage
 * range through the real steps: heroBlowMult (Might, damage rows, statuses, the weapon's dealt mods, food), then the
 * armour rule with the creature's armour statuses and the weapon's pierce, and a frozen foe's shatter.
 */
export function previewBlow(state, p, def) {
  const mult = heroBlowMult(state, p, def, {}), armour = Math.max(0, (def.armour ?? 0) - creatureArmourOff(state, def) - pierceOf(state.hero, 'main'));
  const one = n => Math.max(1, Math.round(armourReduce(n * mult, armour, p.heavy) * physTakenMult(def)));
  return { lo: one(p.dmg?.[0] ?? 1), hi: one(p.dmg?.[1] ?? 1) };
}

function strike(state, attacker, defender, events, o) {
  const rng = state.rng;
  const playerDefends = defender.side === 'player';
  const hadStatus = Object.keys(defender.statuses ?? {}).length > 0;   // Venomtouch reads the target as it stood before the blow
  const statusesBefore = Object.keys(defender.statuses ?? {});   // E16 Clear Waters: Frozen before the blow shattered it
  // CB11 (1.7 actions-adapter.js:252): a foe's blow from further than a tile away (an arrow) may be deflected.
  if (playerDefends && Math.max(Math.abs(attacker.x - defender.x), Math.abs(attacker.y - defender.y)) > 1 && deflects(state, attacker, defender, events, { label: o.label ?? null })) return;
  // 3. Parry (player defending in melee with a parry chance).
  if (playerDefends && !o.ranged && defender.parry > 0 && heroRoll(state, defender, defender.parry / 100, events)) {
    events.push({ type: 'attacked', id: attacker.id, target: defender.id, hit: false, parried: true });
    weaponAttack(state, defender, attacker, events, { mult: W.riposteMult, label: 'Riposte' });
    return;
  }
  // I51: a weapon learns itself by the attacks made with it, armour by the attacks made on the hero.
  if (attacker.side === 'player' && !o.proc && state.hero) noteUse(state, state.hero.worn[o.weapon ?? 'main'], events);
  if (playerDefends && state.hero) noteUse(state, state.hero.worn.armour, events);
  // 4. Block is rolled before the hit, used only if the blow lands (CO3).
  const blocked = playerDefends && defender.block > 0 ? heroRoll(state, defender, defender.block / 100, events) : false;
  // 5. Hit.
  const surprise = isSurprise(state, attacker, defender);
  const ch = blowChance(state, attacker, defender, { acc: o.acc, surprise, sureHit: o.sureHit });   // the map card's odds too
  // E6 Into the Dark: the blow out of hiding is x (1 + its magnitude %); the buff ends with the attack (statuses.json endsOn).
  const dark = attacker.side === 'player' && attacker.statuses.hidden ? attacker.statuses['into-the-dark']?.magnitude ?? 0 : 0;
  const fromHiding = attacker.side === 'player' && !!attacker.statuses.hidden;   // CF08: Sylla's surprise piety reads it
  if (attacker.side === 'player' && attacker.statuses.hidden) { delete attacker.statuses.hidden; events.push({ type: 'status', id: attacker.id, status: 'hidden', change: 'ended' }); }
  if (attacker.side === 'player' && attacker.statuses['into-the-dark'] && !o.proc) removeStatus(state, attacker, 'into-the-dark', events);
  // RB47: a foe's blow on the hero is his dodge roll (1.7 combat.js:296 !combatRoll(1 - chance)), so Lucky Streak can save it.
  const landed = attacker.side === 'player' ? heroRoll(state, attacker, ch, events) : defender.side === 'player' && defender.statuses?.luckystreak ? !heroRoll(state, defender, 1 - ch, events) : next(rng) < ch;
  // M16, M17: a creature attacked hunts and remembers where the blow came from; others nearby investigate.
  if (defender.side === 'foe') { defender.hunting = true; defender.asleep = false; defender.caughtOff = -1; defender.lastSeen = { x: attacker.x, y: attacker.y, at: state.now }; }
  // EP14 (1.7 enemy-perception.js attacked): a pet's blow is witnessed too, and marks the pet for retaliation (M18).
  if (attacker.side === 'ally' && defender.side === 'foe') defender.petAggressor = attacker.id;
  if (defender.side === 'foe') witness(state, defender, attacker);
  if (!landed) { events.push({ type: 'attacked', id: attacker.id, target: defender.id, hit: false, ranged: !!o.ranged }); return; }
  // 6. Damage.
  const range = o.dmg ?? attacker.dmg;
  const base = roll(rng, range[0], range[1]);
  let dmg = base * (o.mult ?? 1);
  if (attacker.side === 'player') dmg *= heroBlowMult(state, attacker, defender, { melee: !o.ranged, ranged: !!o.ranged, surprise, single: true, primary: true }, o.weapon ?? 'main');
  if (dark) dmg *= 1 + dark / 100;
  // CD1 Pummel (1.7 actions-adapter.js:311, :328-341): the next bare-handed hits x (1 + divine), each one Stuns 1.
  const pummel = attacker.side === 'player' && !o.ranged && !o.proc && (o.weapon ?? 'main') === 'main' && !state.hero?.worn?.main && (state.hero?.pummel ?? 0) > 0;
  if (pummel) { dmg *= 1 + (attacker.divine ?? 1); state.hero.pummel -= 1; }
  // G8 (1.7 actions-adapter.js:334): the Scoundrel's surprise hits x2 (classes.json surpriseMult), anyone else's x1.5.
  if (surprise) dmg *= attacker.side === 'player' ? classes.rows[state.hero?.cls]?.surpriseMult ?? SUR.weaponMult : SUR.weaponMult;
  // 7. Crit.
  let crit = false;
  // G11 (1.7 actions-adapter.js:338): Bulwark keeps a creature's blows on the hero from ever critting.
  if (attacker.side === 'player') crit = !!defender.statuses.sapped || forcedCrit(attacker, defender, { state, events }, !o.proc) || heroRoll(state, attacker, (attacker.crit + critBonus(attacker, defender, { state, events })) / 100, events);   // C32; E29; E36 Friction, Storm Ambush
  else if (attacker.echo) crit = next(rng) < ((attacker.crit ?? 0) + critBonus(attacker, defender, { state, events })) / 100;   // CB49: the echo crits at the hero's chance (no combo crits, as 1.7)
  else if (!defender.bulwark && !defender.defence?.critImmune) crit = next(rng) < CRIT.creatureChancePct / 100;
  if (crit) dmg *= attacker.side === 'player' || attacker.echo ? (attacker.critMult ?? CRIT.playerMultBase) : CRIT.creatureMult;
  if (blocked) dmg *= W.blockedMult;
  const ev = { type: 'attacked', id: attacker.id, target: defender.id, hit: true, crit, surprise, blocked, label: o.label ?? null, damage: 0, ranged: !!o.ranged, ...(attacker.side === 'player' && !o.ranged && !state.hero?.worn?.main ? { unarmed: true } : {}) };
  events.push(ev);
  const hpBefore = defender.hp;
  ev.damage = dealDamage(state, { target: defender, source: attacker, amount: dmg, type: attacker.attackType ?? 'phys', heavy: attacker.heavy, pierce: attacker.side === 'player' ? pierceOf(state.hero, o.ranged ? 'ranged' : o.weapon ?? 'main') : 0, tags: ['attack', o.ranged ? 'ranged' : 'melee', 'single-target'] }, events);
  if (pummel && defender.hp > 0) applyStatus(state, defender, 'stun', { turns: 1, source: attacker.id }, events);
  // Passives (passives.js): the hero's hit, crit and surprise triggers; the defending hero's block triggers.
  if (attacker.side === 'player' && !o.proc) {
    const info = { target: defender, weapon: o.weapon ?? 'main', packet: { raw: dmg, dealt: ev.damage, type: attacker.attackType ?? 'phys', tags: ['attack'] }, hit: { crit, surprise, melee: !o.ranged, ranged: !!o.ranged, single: true, primary: true, hadStatus, statusesBefore, fromHiding } };
    heroEvent(state, 'on-hit', info, events);
    if (crit) heroEvent(state, 'on-crit', info, events);
    if (surprise) heroEvent(state, 'on-surprise-hit', info, events);
  }
  if (attacker.echo && !o.proc && ev.damage > 0) {   // CB49: the echo's riders (1.7 shadow-clone.js weaponHit)
    const info = { target: defender, weapon: o.weapon ?? 'main', packet: { raw: dmg, dealt: ev.damage, type: 'phys', tags: ['attack'] }, hit: { crit, surprise, melee: !o.ranged, ranged: !!o.ranged, single: true, primary: true, hadStatus, statusesBefore } };
    echoEvent(state, attacker, 'on-hit', info, events);
    if (crit) echoEvent(state, attacker, 'on-crit', info, events);
  }
  if (attacker.summon && !o.proc && ev.damage > 0) summonLifeDrain(state, attacker, defender, events);   // CF09
  if (playerDefends && blocked) heroEvent(state, 'on-block', { target: attacker, attacker, packet: { raw: dmg / W.blockedMult, blocked: dmg / W.blockedMult - dmg, type: 'phys', tags: ['attack'] } }, events);
  // C30: independently authored elemental damage receives the same attack, critical and block multipliers.
  // Unchanged creature profiles, including Chaos, retain their proportional elemental component.
  // Its status needs that packet to land (a tiered elemental's, either part of the blow).
  // A tiered earth elemental poisons for 3 instead of rooting.
  // Item 287 (Justin 2026-10-20: "elemental -lings proc at 30% and my Shade Swarm can Fear at 30%"): any body but the
  // hero (1.7 att!==player), at its row's elementProcPct, else the creature default.
  if (attacker.element && attacker.side !== 'player' && defender.hp > 0) {
    const authored = MON.rows[attacker.kind]?.elementalDamage;
    const elementDamage = authored === undefined ? dmg * W.creatureElementPacketMult :
      (Array.isArray(authored) ? roll(rng, authored[0], authored[1]) : authored) * (base ? dmg / base : 0);
    const add = dealDamage(state, { target: defender, source: attacker, amount: elementDamage, type: ELEMENT_TYPE[attacker.element] }, events);
    const tier = MON.rows[attacker.kind]?.elementTier ?? 0;
    const [st, turns] = attacker.element === 'earth' && tier ? ['poison', 3] : ELEMENT_PROC[attacker.element];
    if ((tier ? ev.damage > 0 || add > 0 : add > 0) && defender.hp > 0 && next(rng) < (MON.rows[attacker.kind]?.elementProcPct ?? W.creatureElementProcPct) / 100) applyStatus(state, defender, st, { turns: turns ?? undefined, source: attacker.id }, events);
  }
  // G14 (1.7 actions-adapter.js:149, :158-159): a creature's riders ride only a blow that took HP; one soaked whole by
  // a shield or reduced to nothing carries none.
  if (attacker.passives && defender.hp < hpBefore) onHitPassives(state, attacker, defender, events, { melee: !o.ranged });
}
