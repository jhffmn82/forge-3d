// The damage pipeline (spec/combat.md C1-C3, C44-C59, C63-C69): validate, defences, round, commit, emit.

const heroEvent = (...a) => UP.heroEvent(...a);   // C17: the hero's passives (set-pieces.js UP, from passives.js)
import { holds } from './effects/conditions.js';
import { holyGroundPower, HOLY_HEAL_PCT } from './spell-ground.js';
import { amount } from './amount.js';
import tuning from '../../data/tuning.json' with { type: 'json' };
import { removeStatus, whileOf } from './statuses.js';
import { shieldPools } from './shields.js';
import statusData from '../../data/statuses.json' with { type: 'json' };
import progression from '../../data/progression.json' with { type: 'json' };
// C7 (engine-rules-04): the statuses' rows, read through statuses.js whileOf, each in the place 1.7 applied it.
const IDS = Object.keys(statusData.rows), pick = (verb, f) => Object.fromEntries(IDS.map(id => [id, whileOf(id, verb).filter(f)]).filter(([, l]) => l.length));
const taken = w => w.direction === 'taken';
/** Statuses' mult and immune resistances (statuses.json while resist); their add rows (wet, chill) are read above. */
const STATUS_RESIST = pick('resist', w => w.mult !== undefined || w.immune);
/** Statuses that cut the damage their bearer takes by a percent (Last Stand on the hero, Iron Brace on a chaos creature). */
const TAKEN_REDUCE = pick('damage-mod', w => taken(w) && w.reducePct !== undefined);
const MANA_BACK = new Set(IDS.filter(id => whileOf(id, 'shield').some(w => w.onAbsorb?.some(x => x.verb === 'mana'))));
/** E24 (1.7 damage.js:12-19, damage-adapter.js:140, :378): Stone Skin's +3 flat on physical blows, and the damage types a status turns away whole (Stone Skin: poison). */
const PHYS_FLAT = Object.fromEntries(Object.entries(pick('damage-mod', w => taken(w) && w.flat !== undefined && w.if?.['damage-type'] === 'phys')).map(([id, l]) => [id, l.reduce((n, w) => n + w.flat, 0)]));
const TYPE_IMMUNE = Object.fromEntries(Object.entries(pick('grant-immunity', w => w.damageType)).map(([id, l]) => [id, l.map(w => w.damageType)]));
/** A physical blow's multiplier from a status (Frozen x2, statuses.json frozen while damage-mod). */
const PHYS_MULT = pick('damage-mod', w => taken(w) && w.mult !== undefined && w.if?.['damage-type'] === 'phys');
/** E18: a creature's statuses that make it take more (Hollowed, before armour) and wear its armour down; C67 Dazed's x1.5 lands after the defences (stage). */
const onCreatures = (verb, f) => Object.fromEntries(Object.entries(pick(verb, w => !w.if && f(w))).filter(([id]) => statusData.rows[id].on?.includes('creature')));
const CREATURE_TAKEN = onCreatures('damage-mod', w => taken(w) && w.mult !== undefined && w.stage !== 'after-defences');
const TAKEN_LATE = pick('damage-mod', w => taken(w) && !w.if && w.mult !== undefined && w.stage === 'after-defences');
const CREATURE_ARMOUR = onCreatures('modify-stat', w => w.stat === 'armour');
/** E8: how long a creature knocked out of Frozen cannot be frozen again (the frozen row's grant-immunity). */
const THAW_TURNS = statusData.rows.frozen.while.flatMap(w => w.effects ?? []).find(e => e.verb === 'grant-immunity')?.turns ?? 0;
/** Frozen's multiplier on a physical blow to t (1 when t is not frozen); the map card reads it too. */
export const physTakenMult = t => Object.keys(t.statuses ?? {}).reduce((m, id) => (PHYS_MULT[id] ?? []).reduce((n, w) => n * w.mult, m), 1);
const kill = (...a) => UP.kill(...a);   // C17: a death (set-pieces.js UP, from death.js)
const splitOnHit = (...a) => UP.splitOnHit(...a);   // C17: a split on a direct hit (set-pieces.js UP, from ai-moves.js)
import { witness } from './ai-sense.js';
import { CREATURE_HOOKS, UP } from './set-pieces.js';
const combatAmusement = (...a) => UP.combatAmusement(...a);   // C17: Wobbles' amusement (set-pieces.js UP, from faith.js)

const TYPES = ['phys', 'fire', 'ice', 'lightning', 'poison', 'dark', 'light', 'magic'];
const ARM = tuning.rows.armour;
const RES = tuning.rows.resistance;
const DEF = tuning.rows.defences;
import { heroRoll } from './hit.js';
import gods from '../../data/gods.json' with { type: 'json' };
const tagged = (p, t) => (p.tags ?? []).includes(t);
/** A foe's own hit on the hero: not an area, a field, a status tick or a proc (1.7 damage-adapter.js: no 'area' tag, a foe source). */
const foeHit = (t, p) => t.side === 'player' && p.source?.side === 'foe' && !p.cause && !['area', 'environment', 'periodic', 'proc', 'cost'].some(x => tagged(p, x));
const OPPOSITE = { fire: 'water', water: 'fire', air: 'earth', earth: 'air', light: 'shadow', shadow: 'light' };
const ELEMENT_TYPE = { fire: 'fire', water: 'ice', air: 'lightning', earth: 'poison', light: 'light', shadow: 'dark' };

/** E8 (1.7 damage-adapter.js:142, :145): a creature knocked out of Frozen cannot be frozen again for 3 game turns. */
function thawed(state, t) {
  if (t.side === 'player' || t.hp <= 0) return;
  const old = t.statuses['imm-frozen'];
  t.statuses['imm-frozen'] = { n: Math.max(old?.n ?? 0, THAW_TURNS), born: state.now, magnitude: null, scale: 1, source: null };
}

/** CH-39: a creature's HP brought to number scale n (from whatever scale it was at), its wounds kept in proportion. */
export function scaleBody(a, n) {
  if (!a || !(a.maxhp > 0)) return;
  const f = n / (a.sbScale ?? 1);
  if (f === 1) return;
  a.maxhp = Math.max(1, Math.round(a.maxhp * f));
  if (a.hp > 0) a.hp = Math.min(a.maxhp, Math.max(1, Math.ceil(a.hp * f)));
  a.sbScale = n;
}

/** C44: physical armour. E24: `earth` adds to the flat part (the hero's Earth points; a heavy blow skips it), `stone` adds even to a heavy blow (Stone Skin). */
export function armourReduce(hit, armour, heavy, earth = 0, stone = 0) {
  if (hit <= 0) return 0;
  const a = Math.max(0, armour);
  const flat = Math.min((heavy ? 0 : Math.ceil(a / ARM.flatDivisor) + earth) + stone, hit * ARM.flatCapOfHit);
  const after = (hit - flat) * (1 - Math.min(ARM.pctCap / 100, (ARM.pctPerArmour / 100) * a));
  return Math.max(ARM.minimumHit, after);
}

/** C48-C54. The hero's own resistances (Vitality, enchants, element points, race, god, rings) are heroStats' resist. */
export function resistMult(target, type, state = null) {
  if (type === 'phys') return 1;
  let m = 1;
  if ((target.side === 'player' || target.echo) && target.resist) {   // CB49: the echo keeps the hero's resistances   // sandbox item 51: shown on the sheet but never applied before
    if (target.resist[type] === 'immune') return 0;
    m -= (target.resist[type] ?? 0) / 100;
  }
  if (target.side !== 'player' && target.element) {
    if (ELEMENT_TYPE[target.element] === type) m += RES.creatureOwnElementPct / 100;
    if (ELEMENT_TYPE[OPPOSITE[target.element]] === type) m += RES.creatureOppositeElementPct / 100;
  }
  if (target.side !== 'player' && type === 'light' && (target.undead || target.shadowy)) m += RES.undeadLightPct / 100;
  if (target.resistAll) m -= target.resistAll / 100;   // CD1 The Brood: Sylla's spiderlings resist 5% + 5% a rank
  if (target.statuses.wet && type === 'lightning') m += RES.wetLightningPct / 100;
  if (target.statuses.wet && type === 'fire') m += RES.wetFirePct / 100;
  if (target.statuses.chill && type === 'ice') m += RES.chilledIcePct / 100;
  if (target.side === 'player') m = Math.max(type === 'magic' ? RES.playerMagicFloor : RES.playerElementalFloor, m);
  // G3 (1.7 actions.js:36-40): a status's own resistance after the floors: Poison Ward makes poison 0; Shade, Storm
  // and Fire Ward halve their type; Starfruit x0.8 on every type but magic; Corrupted takes x1.25 dark.
  for (const id of Object.keys(target.statuses)) for (const w of STATUS_RESIST[id] ?? []) {
    if (w.type !== type && !(w.type === 'elemental' && type !== 'magic')) continue;
    if (w.immune) return 0;
    if (w.mult !== undefined) m *= w.mult;
  }
  // C53: holy ground (sanctuary) under the hero or an ally lowers it by 15% x the field's power, floor 0.25.
  if (state?.floor?.fields?.length && target.side !== 'foe') {
    const k = target.y * state.floor.w + target.x, holy = state.floor.fields.find(r => /holy/.test(r.kind) && r.cells.includes(k));
    if (holy) { const power = holy.power ?? state.actors?.[holy.owner]?.divine ?? 1; m = Math.min(m, Math.max(RES.sanctuaryFloor, m - RES.sanctuaryPerPowerPct / 100 * power)); }
  }
  return m;
}

/**
 * One damage packet. Returns the HP actually lost.
 * @param {{target:any, source:any, amount:number, type?:string, premitigated?:boolean, bypassShields?:boolean, heavy?:boolean, cause?:string, tags?:string[]}} p
 */
/** The armour a creature's statuses take off it (modify-stat armour), as a blow reads it. */
export function creatureArmourOff(state, t) {
  let worn = 0;
  for (const [id, st] of Object.entries(t.statuses ?? {})) for (const w of CREATURE_ARMOUR[id] ?? []) worn -= typeof w.add === 'number' ? w.add : amount(w.add, { state, owner: t, target: t, status: st });
  return worn;
}

export function dealDamage(state, p, events) {
  const type = p.type ?? 'phys', t = p.target;
  if (!TYPES.includes(type)) return 0;
  if (t.hp <= 0) return 0;
  if (t.statuses?.tomb) return 0;   // 1.7 damage-adapter.js:98: an entombed body, the hero too, takes no damage
  // E24 (1.7 damage-adapter.js:378 admitDamage): Stone Skin turns poison away whole, ticks too.
  if (t.side === 'player' && Object.keys(t.statuses ?? {}).some(id => TYPE_IMMUNE[id]?.includes(type))) return 0;
  let dmg = p.amount;
  // CH-39: a sandbox run's Number scale and Lethality (1.7 game.js sHP / sDMG): a body not yet at the run's number
  // scale takes it first, then every hit counts x numbers x lethality, before its defences as 1.7 scaled the roll.
  const sc = state.sandbox?.scale;
  if (sc && !p.premitigated) { if (t.side !== 'player') scaleBody(t, sc.numbers); dmg *= sc.numbers * sc.lethality; }
  // CB07 Spell Ward (1.7 damage-adapter.js:132-135): a foe's spell or ability, not a weapon blow, is blocked at the
  // shield's block chance, or without one 25% + 1% a Might point over 10 (at most 40%); a block takes x0.25.
  if (t.defence?.spellWard && foeHit(t, p) && !(tagged(p, 'attack') && !tagged(p, 'spell'))) {
    const ch = t.block > 0 ? t.block : Math.min(DEF.spellWardCapPct, DEF.spellWardBasePct + DEF.spellWardPerMightPct * Math.max(0, (t.attr?.mig ?? 10) - 10));
    if (heroRoll(state, t, ch / 100, events)) {   // RB47 Lucky Streak
      dmg *= DEF.spellWardMult;
      events.push({ type: 'float', id: t.id, words: 'block', sfx: ['block'] });
      heroEvent(state, 'on-block', { target: p.source, attacker: p.source, packet: { raw: p.amount, blocked: p.amount - dmg, type, tags: p.tags ?? [] } }, events);
    }
  }
  // E18 Hollowed (1.7 damage-adapter.js:109, combat.js armorOf): each stack on a creature is 5% more damage taken and 1 armour less.
  if (t.side !== 'player') for (const [id, st] of Object.entries(t.statuses)) {
    for (const w of CREATURE_TAKEN[id] ?? []) dmg *= typeof w.mult === 'number' ? w.mult : amount(w.mult, { state, owner: t, target: t, status: st });
  }
  const worn = t.side !== 'player' ? creatureArmourOff(state, t) : 0;
  if (!p.premitigated) {
    if (type === 'phys') {
      const frozen = !!t.statuses.frozen;
      // CD10 (1.7 damage.js:13, damage-adapter.js:139): a mace's pierce (p.pierce) ignores that much armour.
      // E24: the hero's Earth points add 1 each to the flat part, Stone Skin 3 more.
      const earth = t.side === 'player' ? t.affinity?.earth ?? 0 : 0, stone = t.side === 'player' ? Object.keys(t.statuses).reduce((n, id) => n + (PHYS_FLAT[id] ?? 0), 0) : 0;
      dmg = armourReduce(dmg, Math.max(0, (t.armour ?? 0) - worn - (p.pierce ?? 0)), p.heavy, earth, stone);
      if (frozen) { dmg *= physTakenMult(t); removeStatus(state, t, 'frozen', events); thawed(state, t); events.push({ type: 'float', id: t.id, words: 'shatter' }); }
    } else {
      if (t.side === 'player' && t.resist?.[type] === 'immune') { events.push({ type: 'float', id: t.id, words: 'immune' }); return 0; }   // 1.7: the hit is turned away
      dmg *= resistMult(t, type, state);
      if (t.statuses.frozen && dmg > 0) { removeStatus(state, t, 'frozen', events); thawed(state, t); }
    }
  } else if (p.resist) {
    dmg *= resistMult(t, type, state);
  }
  // Passive damage mods (passives.js): the hero's dealt mods on foes, taken mods on the hero.
  const src = p.source;
  if (src?.side === 'player' && src.fx?.dealt?.length) for (const m of src.fx.dealt) if (!m.if || holds(m.if, { state, owner: src, target: t, events })) dmg *= typeof m.mult === 'number' ? m.mult : amount(m.mult, { state, owner: src, target: t });
  // CD1 Last Stand (statuses.json while damage-mod taken; 1.7 damage.js lastStand): 4% less a rank x divine, at most 50%;
  // Iron Brace's 45% on a chaos creature (chaosbrace) the same way.
  for (const [id, st] of Object.entries(t.statuses ?? {})) for (const w of TAKEN_REDUCE[id] ?? []) dmg *= 1 - Math.min(100, amount(w.reducePct, { state, owner: t, status: st, rank: t.faithRank ?? 0 })) / 100;
  // E30 Blight: a taken mod's condition is read on this blow (the attacker Poisoned: has-status body source).
  if (t.side === 'player' && t.fx?.taken?.length) for (const m of t.fx.taken) if (!m.if || 'combo' in m.if || holds(m.if, { state, owner: t, target: t, source: src ?? null, events })) dmg *= m.reducePct !== undefined ? 1 - m.reducePct / 100 : typeof m.mult === 'number' ? m.mult : 1;
  // CB09 Magic Barrier (1.7 damage-adapter.js:136, :153): a foe's single-target hit from 2 or more tiles away loses 5, never below 1.
  if (dmg > 0 && foeHit(t, p)) for (const m of t.defence?.taken ?? []) {
    if (m.flat === undefined || m.cooldown !== undefined) continue;
    if (m.if && !holds(m.if, { state, owner: t, target: p.source, source: p.source, events, hit: { single: true }, packet: { type, tags: p.tags ?? [] } })) continue;
    dmg = Math.max(m.minimum ?? 1, dmg - m.flat);
  }
  for (const id of Object.keys(t.statuses ?? {})) for (const w of TAKEN_LATE[id] ?? []) dmg *= w.mult;   // C67, statuses.json dazed: x1.5 after its defences (Grukk after a missed charge)
  if (t.side !== 'player') for (const h of CREATURE_HOOKS.taken) { const m = h(state, t, p, events); if (m !== undefined) dmg *= m; }   // biome creature rules (crypt.js)
  dmg = Math.round(dmg);
  // Shield pools (rules/shields.js, E26 order): a status pool's magnitude is what is left, spent, the status ends.
  if (!p.bypassShields) for (const s of shieldPools(t)) {
    if (dmg <= 0) break;
    const soak = Math.min(s.n, dmg);
    dmg -= soak;
    if (s.field) { t[s.field] -= soak; events.push({ type: 'absorbed', id: t.id, amount: soak, pool: s.pool }); continue; }
    const id = s.status, st = t.statuses[id];
    st.magnitude -= soak;
    events.push({ type: 'absorbed', id: t.id, amount: soak, pool: id, ...(statusData.rows[id]?.absorbTone ? { tone: statusData.rows[id].absorbTone } : {}) });   // CH31: the Lens Shield's soak in light gold
    // CD1 Mana Ward: each HP it takes gives the hero back a point of mana (1.7 damage-adapter.js:160-164).
    // E25: the mana it gives back floats '+N mp' in ice blue; a pool used up says so on the blow's line ("Mana Ward broken", "ward broken").
    if (MANA_BACK.has(id) && t.maxmana) { const was = t.mana ?? 0; t.mana = Math.min(t.maxmana, was + soak); if (t.mana > was) events.push({ type: 'mana', id: t.id, amount: t.mana - was }, { type: 'float', id: t.id, words: `+${Number((t.mana - was).toFixed(1))} mp`, tone: 'ice' }); }
    if (st.magnitude <= 0) { if (statusData.rows[id]?.log?.broken) events.push({ type: 'note', id: t.id, words: statusData.rows[id].log.broken }); removeStatus(state, t, id, events); }
  }
  // CB08 Fortitude (1.7 damage-adapter.js:168): a foe's hit that still reaches HP is halved, then not again for 600 units.
  let fortitude = false;
  if (dmg > 0 && t.side === 'player' && p.source?.side === 'foe') for (const m of t.defence?.taken ?? []) {
    if (m.cooldown === undefined || (t.fortUntil ?? -Infinity) > state.now) continue;
    dmg = Math.round(dmg * (m.mult ?? DEF.fortitudeMult)); t.fortUntil = state.now + m.cooldown; fortitude = true;
  }
  if (dmg <= 0) return 0;
  const before = t.hp;
  t.hp = Math.max(0, t.hp - dmg);
  t.lastHurtAt = state.now;
  if (t.statuses.sapped && t.statuses.stun) removeStatus(state, t, 'stun', events);   // D18: the first damage after a Sap ends its stun
  if (t.side === 'foe') t.hunting = true;
  // EP14 (1.7 damaged -> attacked): a direct hit by the hero or a pet (a spell too, not a tick or the ground) is witnessed.
  if (t.side === 'foe' && (src?.side === 'player' || src?.side === 'ally') && !p.cause && !tagged(p, 'periodic') && !tagged(p, 'environment')) witness(state, t, src);
  // E48: a rider's packet carries its tags (proc, arc, reflected), so the log can name it on another body ("Arc → Bat: 5.").
  events.push({ type: 'damaged', id: t.id, by: p.source?.id ?? null, amount: dmg, dtype: type, cause: p.cause ?? null, ...(p.tags?.length ? { tags: p.tags } : {}) });
  if (fortitude) events.push({ type: 'note', id: t.id, words: 'Fortitude' });   // E21 (1.7 combatActionNote): rides the blow's line, else "You: Fortitude."
  for (const h of CREATURE_HOOKS.damaged) h(state, t, p, dmg, events);   // riders and reactions (crypt.js)
  // CF17 (1.7 gods.js godDamageResolved): the hero's blows on foes, and theirs on him, amuse Wobbles.
  if (src && gods.rows[state.hero?.faith?.god]?.amusedByCombat) { if (src.side === 'player' && t.side === 'foe') combatAmusement(state, 'out'); else if (t.side === 'player' && src.side === 'foe') combatAmusement(state, 'in'); }
  if (src?.side === 'player' && t.side === 'foe') heroEvent(state, 'on-damage-dealt', { target: t, packet: { dealt: dmg, raw: p.amount, type, tags: p.tags ?? [] } }, events);
  // CD2: the hero's boons on taking HP damage (Wizard Hunter, Warrior's Discipline, Coward's Mark), the attacker as target;
  // and on a blow that would kill him (Wobbles' Last Laugh leaves 1 HP once a floor).
  if (t.side === 'player' && t.hp > 0 && !(p.tags ?? []).includes('cost')) {
    const foe = src && src.side === 'foe' ? src : null, apart = foe ? Math.max(Math.abs(foe.x - t.x), Math.abs(foe.y - t.y)) > 1 : false;
    heroEvent(state, 'on-damaged', { target: foe ?? t, attacker: foe, packet: { dealt: dmg, raw: p.amount, type, tags: p.tags ?? [] }, hit: { ranged: (p.tags ?? []).includes('ranged') || apart, spell: type !== 'phys' } }, events);   // E25: Magma Answer answers ranged or non-physical damage
  }
  if (t.hp === 0 && t.side === 'player') heroEvent(state, 'on-lethal', { target: t, attacker: src ?? null, packet: { dealt: dmg, type, tags: p.tags ?? [] } }, events);
  if (t.hp === 0) kill(state, t, p.source, events, p.tags, { cause: p.cause, type });   // EP38: what killed the hero; a body dies once (kill)
  else if (t.passives && p.source && !p.cause) splitOnHit(state, t, before, p.source, events);   // M38: a direct hit
  return dmg;
}

/**
 * E10 (1.7 damage.js:40-47 healingAmount, damage-adapter.js playerHealingContext): what a heal the hero gets is
 * multiplied by: Rot x0.5, Mending Light's boon, and holy ground under him 1 + 25% a point of power (its own heal aside).
 * Regeneration is upkeep.js's (Rot stops it there).
 */
export function heroHealMult(state, t, holyGround = false) {
  let m = t.fx?.healMult ?? 1;
  if (t.statuses?.rot) m *= 0.5;
  if (!holyGround) m *= 1 + HOLY_HEAL_PCT * holyGroundPower(state, t) / 100;
  return m;
}

/**
 * C5, C7 (engine-rules-17): one heal for every source. The hero's heals take heroHealMult (Mending Light, Rot x0.5, holy
 * ground unless it is the ground's own heal) unless raw; a full heal fills the bar. What did not fit is the overheal
 * (overheal: false for a source that never had one), and the hero's on-heal fires with both (E27 Holy Water; a full
 * heal fires it too, E11); onHeal: 'over' fires it only for overheal (regeneration, which never stanches a bleed).
 * mark rides on the healed event (regen). Returns the HP gained.
 */
export function heal(state, t, n, events, { full = false, raw = false, holyGround = false, natural = false, capMaxHpPct, overheal = true, onHeal = 'always', mark = {} } = {}) {
  if (t.hp <= 0) return 0;   // item 174: a fallen body takes no heal (a drain whose owner fell during its hit), so it dies once
  let v = full ? t.maxhp : n;
  if (!full && !raw && t.side === 'player') v *= heroHealMult(state, t, holyGround);
  if (capMaxHpPct !== undefined) v = Math.min(v, t.maxhp * capMaxHpPct / 100);
  const gained = Math.max(0, Math.min(Math.round(v), t.maxhp - t.hp));
  if (gained > 0) { t.hp += gained; events.push({ type: 'healed', id: t.id, amount: gained, ...mark }); }
  const over = full || !overheal ? 0 : Math.max(0, Math.round(v) - gained);
  if (t.side === 'player' && (onHeal === 'over' ? over > 0 : gained > 0 || over > 0)) heroEvent(state, 'on-heal', { target: t, packet: { healed: gained, overheal: over, tags: [] }, natural }, events);
  return gained;
}

/**
 * Bosses.md decided 7 (M9, DM7; C10c, engine-rules-30): a limb (limbOf) passes every hit to its body and never wears.
 * A body flagged areaOncePerAction (the Maw) takes at most one area hit an action through its limbs.
 */
CREATURE_HOOKS.damaged.push((state, t, pk, dealt, events) => {
  if (!t.limbOf) return;
  t.hp = t.maxhp;
  const body = state.actors[t.limbOf];
  if (!body || body.hp <= 0 || dealt <= 0) return;
  if (body.areaOncePerAction && pk.tags?.includes('area')) { if (body.areaHitIn === state.actions) return; body.areaHitIn = state.actions; }
  dealDamage(state, { ...pk, target: body, amount: dealt, premitigated: true, bypassShields: true }, events);
});
