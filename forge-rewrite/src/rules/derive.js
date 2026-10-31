// The hero's derived numbers (spec/character.md A33-A40, combat.md C6-C7, C32-C38, C49), recomputed on any change.
// Base formulas come from progression.json; every unconditional modify-stat and resist from unlocked stat passives,
// the class passive and worn gear is folded in from data, so no passive is written here by name.

import { compilePassives, heroPassiveRows } from './passives.js';
import progression from '../../data/progression.json' with { type: 'json' };
import classes from '../../data/classes.json' with { type: 'json' };
import races from '../../data/races.json' with { type: 'json' };
import tuning from '../../data/tuning.json' with { type: 'json' };
import gods from '../../data/gods.json' with { type: 'json' };
import { amount } from './amount.js';
import { itemRow, value, weaponDamage, effectsOf, armourValue } from './items.js';
import { whileOf } from './statuses.js';
import weapons from '../../data/weapons.json' with { type: 'json' };
import { holds } from './effects/conditions.js';
import { ownSources, passivesOf } from './own-stats.js';

const P = progression.rows;
const B = P['player-base-stats'];
const SCALE = tuning.rows['number-scale'];
const W = tuning.rows['weapon-damage'];
const TYPES = ['fire', 'ice', 'lightning', 'poison', 'dark', 'light', 'magic'];
const ELEMENTAL = ['fire', 'ice', 'lightning', 'poison', 'dark', 'light'];

/** One modifier's number: an item's own value, a scaled amount at the hero's rank, or a plain number. */
const resolveFor = (hero, item, owner = hero) => a => (a && typeof a === 'object' && 'from-source' in a) ? value(itemRow(item.id).row.values[a['from-source']], item, hero)
  : (a && typeof a === 'object') ? amount(a, { rank: hero.faith?.rank ?? 0, owner, state: null }) : a;
/** A row aimed at someone else (a god's own-summons boon) is not the hero's. */
const notSelf = e => e.target && e.target.selector !== 'self';

/** The hero's effect lists: their own (own-stats.js) and the worn gear's; [effects, item, from]. */
function heroSources(hero) {
  const out = ownSources(hero);
  for (const [slot, item] of Object.entries(hero.worn)) if (item) out.push([effectsOf(item), item, slot]);
  return out;
}

/** Every unconditional modifier on the hero: stat passives, class and race passives, boons, worn gear effects. */
function modifiers(hero, owner = hero) {
  const mods = [];
  for (const [effects, item, from] of heroSources(hero)) for (const e of effects ?? []) {
    if (e.if || e.only === 'creatures' || notSelf(e)) continue;
    const resolve = resolveFor(hero, item, owner);
    if (e.verb === 'modify-stat') mods.push({ stat: e.stat, add: resolve(e.add) ?? 0, pct: resolve(e.pct) ?? 0, from });
    if (e.verb === 'resist') mods.push({ stat: 'resist:' + e.type, add: resolve(e.add) ?? 0, pct: 0, from });
  }
  // Enchants, element points and combos (passives.js).
  for (const m of compilePassives(hero).mods) mods.push({ ...m, from: 'enchant' });
  return mods;
}

/**
 * E2 (1.7 stats.js:108, :113, :143, :145, :155-171): the numbers the hero's own statuses add while they last (Iron
 * Body, Iron Hide and Temper armour, Temper's +2 weapon, Forge Heat, Living Mountain, Warrior's Discipline, Rally's
 * spell power, Haste and Cinder Stride speed). Damage percents are attack.js's (per blow); hunger and regeneration
 * terms are upkeep's; Chill's slow is costs.js's.
 */
function statusMods(hero, body, owner) {
  const mods = [];
  for (const [id, st] of Object.entries(body?.statuses ?? {})) for (const w of whileOf(id, 'modify-stat')) {
    if (w.stat === 'damage-pct' || w.stat === 'hp-regen') continue;
    if (w.if && !holds(w.if, { state: null, owner: body, target: body })) continue;
    const c = { state: null, owner, status: st, rank: hero.faith?.rank ?? 0 };
    mods.push({ stat: w.stat, add: w.add === undefined ? 0 : amount(w.add, c), pct: w.pct === undefined ? 0 : amount(w.pct, c), from: 'status' });
  }
  return mods;
}

/**
 * Divine (1.7 stats.js powerValues): 1 + the gear's divine percent (Ceremonial Knife, Holy Symbol), + Mother Murk's
 * Lich boon (2% a point of Vitality over 10).
 */
function divineOf(hero) {
  const mods = modifiers(hero);
  return 1 + mods.filter(m => m.stat === 'divine').reduce((a, m) => a + (m.pct || 0), 0) / 100
    + Math.max(0, mods.filter(m => m.stat === 'divine').reduce((a, m) => a + (m.add || 0), 0));
}

/**
 * CB06, G7 (1.7 weaponBaseDamage, actions-adapter.js:296-313): every weapon-damage percent the hero holds, each with
 * its condition, which attack.js reads per blow: Heavy Hands and Unstoppable on melee hits, Crushing Blows on a target
 * below half HP, Glimmer's bonus on undead and shadowy foes; unconditional ones (enchants, element points) too.
 */
export function damageRows(hero) {
  const out = [];
  for (const [effects, item] of heroSources(hero)) for (const e of effects ?? []) {
    if (e.verb !== 'modify-stat' || e.stat !== 'damage-pct' || e.only === 'creatures' || notSelf(e)) continue;
    out.push({ pct: resolveFor(hero, item)(e.pct) ?? 0, if: e.if ?? null });
  }
  for (const m of compilePassives(hero).mods) if (m.stat === 'damage-pct' && m.pct) out.push({ pct: m.pct, if: null });
  return out;
}
/**
 * G21 (1.7 turns.js:50-60, damage-adapter.js:518): the regeneration the hero's worn gear gives, which upkeep.js reads.
 *   mending   Ring of Mending: % of max HP healed a game turn, while fed and not poisoned (even in combat)
 *   hpPct     % more base HP regeneration (a Light armour enchant)
 *   mpPct     % of the base 0.6% mana a game turn added (a Water holy symbol)
 *   regenMult x on every regeneration heal (a cursed Ring of Mending stops it)
 */
export function regenGear(hero) {
  const out = { mending: 0, hpPct: 0, mpPct: 0, regenMult: 1 };
  for (const item of Object.values(hero.worn ?? {})) {
    if (!item) continue;
    const resolve = resolveFor(hero, item);
    for (const e of effectsOf(item) ?? []) {
      if (e.verb === 'heal-mod' && e.heals === 'regen') out.regenMult *= e.mult;
      if (e.verb === 'modify-stat' && e.stat === 'hp-regen' && e.add !== undefined) out.mending += Math.max(0, resolve(e.add) ?? 0);
    }
  }
  for (const m of compilePassives(hero).mods) {
    if (m.stat === 'hp-regen') out.hpPct += m.pct || 0;
    if (m.stat === 'mp-regen') out.mpPct += m.pct || 0;
  }
  return out;
}
const meleeOnly = c => !c || (Object.keys(c).length === 1 && c['hit-was'] === 'melee');

/**
 * CB07, CB08, CB09, CB11 (1.7 combat.js:152, :547-552; actions-adapter.js:256; damage-adapter.js:132-136, :168;
 * effects.js:54): the hero's defences and hit rules read from data, each as a number the rules use.
 *   deflectPct   arrows and bolts turned away (a buckler, air armour): 'deflected' and the miss sound
 *   ignoreEvaPct the hero's weapon blows ignore that much of a foe's evasion (Keen Aim)
 *   blur         a creature's blow on the hero lands at x mult, never below min% (Blur)
 *   spellWard    spells and abilities from foes blocked (Spell Ward)
 *   taken        damage-mod taken rows with a condition, a flat cut or a cooldown (Magic Barrier, Fortitude)
 *   selfStatus   the hero's own harmful statuses x mult, at least min turns (Iron Constitution)
 *   buffLonger   CF18: each buff the hero gains lasts pct% longer, once, at least min turns (the Holy Symbol)
 *   critImmune   creatures' blows never crit (Bulwark)
 *   resists      E23: statuses, or tags of them, a stat passive turns away with 'Resisted X.' (Unstoppable: slow, chill, frozen, root, stun, knockback)
 */
export function heroDefence(hero) {
  const d = { deflectPct: 0, ignoreEvaPct: 0, blur: null, spellWard: false, taken: [], selfStatus: null, buffLonger: null, critImmune: false, resists: [] };
  const read = (e, num, from) => {
    if (e.verb === 'hit-rule') {
      if (e.deflectPct !== undefined) d.deflectPct += Math.max(0, num(e.deflectPct) ?? 0);
      if (e.ignoreEvasionPct !== undefined) d.ignoreEvaPct = Math.min(100, d.ignoreEvaPct + (num(e.ignoreEvasionPct) ?? 0));
      if (e.mult !== undefined && e.only === 'creatures') d.blur = { mult: num(e.mult), min: num(e.min) ?? 0 };
      if (e.blockPct !== undefined) d.spellWard = true;
    }
    if (e.verb === 'crit-rule' && e.immune) d.critImmune = true;   // G11 Bulwark (1.7 actions-adapter.js:338): no creature crits
    if (e.verb === 'grant-immunity' && e.status && !e.turns && from === 'passive') d.resists.push(e.status);   // E23 Unstoppable (1.7 effects.js:82): 'Resisted Slow.'
    if (e.verb === 'damage-mod' && e.direction === 'taken' && (e.if || e.flat !== undefined || e.cooldown !== undefined)) d.taken.push({ ...e, flat: num(e.flat), mult: num(e.mult) });
    if (e.verb === 'modify-duration' && e.scope === 'self-statuses') d.selfStatus = { mult: num(e.mult), min: num(e.min) ?? 1 };
    if (e.verb === 'modify-duration' && e.scope === 'self-buffs' && e.pct !== undefined) {
      const pct = Math.max(0, num(e.pct) ?? 0);
      if (pct > 0) d.buffLonger = { pct: (d.buffLonger?.pct ?? 0) + pct, min: num(e.min) ?? 1, except: [...(d.buffLonger?.except ?? []), ...(e.except ?? [])] };
    }
  };
  for (const [effects, item, from] of heroSources(hero)) for (const e of effects ?? []) if (!notSelf(e)) read(e, resolveFor(hero, item), from);
  // Enchants, element points and combos (their numbers are bound in already); boons are counted above.
  for (const r of heroPassiveRows(hero)) if (!r.boon) for (const e of r.effects ?? []) read(e, a => (typeof a === 'number' ? a : undefined));
  return d;
}

/** G5 (1.7 costs.js:26 fleet): the hero's move time multipliers (Fleet x0.85 at Agility 18), from cost-mod move-time rows. */
function moveMultOf(hero) {
  let m = 1;
  for (const [effects] of heroSources(hero)) for (const e of effects ?? []) if (e.verb === 'cost-mod' && e.cost === 'move-time' && typeof e.mult === 'number' && !e.if && !notSelf(e)) m *= e.mult;
  return m;
}

/** The worn bow's shot (range over 1 in the ranged slot), or null: {range, dmg, acc}. */
function rangedOf(hero, accNoWeapon, rangeAdd, dmgAdd, accMult) {
  const w = hero.worn?.ranged, r = w && itemRow(w.id);
  if (!r || !((r.row.range ?? 0) > 1)) return null;
  return { range: r.row.range + rangeAdd, dmg: weaponDamage(w, hero).map(n => Math.max(1, Math.round(n + dmgAdd))), acc: Math.round((accNoWeapon + value(r.row.accuracy ?? 0, w, hero)) * accMult) };
}

const sum = (mods, stat, key) => mods.filter(m => m.stat === stat).reduce((a, m) => a + (m[key] || 0), 0);
const DSP = P['derived-spell-power'];

/**
 * E3 (1.7 stats.js powerValues): spell power = the character term (1 + 4% a Focus point over 10, Arcane Study and
 * Archmage, at least 0.3) x (1 + the focus in hand: staff, wand, a cursed orb) x (1 + half the Ring of Wizardry, at
 * least -0.5) x a fire tome; a robe adds its percent beside the focus; Rally x1.1; Vellum's Perfect Invocation adds
 * half of (divine - 1) last.
 */
function spellPowerOf(hero, mods, sMods) {
  const of = (from, key = 'pct') => mods.filter(m => m.stat === 'spell-power' && from(m.from)).reduce((a, m) => a + (m[key] || 0), 0) / 100;
  const character = Math.max(DSP.characterTermMin, DSP.base + DSP.perFocusOver10 * (hero.attr.foc - 10) + of(f => ['passive', 'class', 'race', 'court'].includes(f), 'add'));
  const focus = of(f => f === 'main' || f === 'off'), robe = of(f => f === 'armour');
  const wizardry = Math.max(DSP.wizardryRingHalfMin, of(f => f === 'ring1' || f === 'ring2'));
  let spell = character * (1 + focus) * (1 + wizardry) * (1 + of(f => f === 'enchant'));
  if (robe) spell *= Math.max(0.1, 1 + focus + robe) / Math.max(0.1, 1 + focus);
  for (const m of sMods) if (m.stat === 'spell-power' && m.pct) spell *= 1 + m.pct / 100;
  return spell + of(f => f === 'boon', 'add');
}

/**
 * The numbers the character sheet shows and combat reads. `body` (the hero's body on the map) brings its statuses'
 * numbers (E2); without it the sheet shows the hero bare of buffs.
 */
export function heroStats(hero, body = null) {
  const divine = divineOf(hero), owner = { ...hero, ...(body ?? {}), attr: hero.attr, level: hero.level, divine };
  const mods = modifiers(hero, owner), sMods = statusMods(hero, body, owner), all = [...mods, ...sMods];
  const add = s => sum(all, s, 'add'), pct = s => sum(mods, s, 'pct');
  // A status's percent on accuracy, evasion or speed multiplies on its own (Living Mountain 2% accuracy a stack; Haste x1.3).
  const sMult = s => sMods.filter(m => m.stat === s && m.pct).reduce((a, m) => a * (1 + m.pct / 100), 1);
  const { mig, agi, vit, foc } = hero.attr, lv = hero.level;
  const hp = P['derived-max-hp'], mp = P['derived-max-mp'];
  const maxhp = Math.max(hp.min, Math.round((hp.base + hp.perVitality * vit * (1 + lv / hp.levelDivisor)) * (1 + pct('max-hp') / 100) * SCALE.numberScale));
  const maxmana = Math.max(mp.min, Math.round(Math.ceil(Math.ceil(foc * (1 + lv / mp.levelDivisor)) * (1 + pct('max-mp') / 100)) * SCALE.numberScale));
  const w = hero.worn, main = w.main && itemRow(w.main.id), off = w.off && itemRow(w.off.id), arm = w.armour && itemRow(w.armour.id);
  const dwarfNoPenalty = races.rows[hero.race]?.noHeavyArmourEvasionPenalty;
  const armourEva = arm ? value(arm.row.evasion ?? 0, w.armour, hero) : 0;
  const offEva = off ? (off.kind === 'weapon' ? B.offHandWeaponEvasion + B.offHandWeaponEvasionPerPlus * Math.max(0, w.off.plus ?? 0) : value(off.row.evasion ?? 0, w.off, hero)) : 0;   // 1.7 create.js offHandWeapon
  // Bare hands are the Fists row; Chad's followers fight with his fists for their rank (gods.json unarmedWeaponByRank).
  const rank = hero.faith?.rank ?? 0, fistsId = hero.faith?.god ? gods.rows[hero.faith.god]?.unarmedWeaponByRank?.[Math.min(5, rank)] : null;
  const fists = weapons.rows[fistsId ?? 'fists'] ?? weapons.rows.fists;
  // Flat weapon damage from gear, boons and buffs (Ring of Striking, Smith's Blessing, Temper, Living Mountain, Discipline).
  const dmgAdd = add('damage');
  const dmg = (w.main ? weaponDamage(w.main, hero) : fists.damage).map(n => Math.max(1, Math.round(n + dmgAdd)));
  // The sheet shows a melee blow on a foe with no condition of its own (above half HP, not undead): attack.js's pools.
  const meleeShown = Math.max(W.poolFloor, 1 + (W.mightPerPointPct * Math.max(0, mig - 10)) / 100 + damageRows(hero).filter(r => meleeOnly(r.if)).reduce((a, r) => a + r.pct, 0) / 100);
  const blockBase = off && off.row.block ? value(off.row.block, w.off, hero) : 0;
  const resist = {};
  for (const t of TYPES) {
    const r = Math.max(0, vit - 10) * B.resistPerVitality + -add('resist:' + t) + (ELEMENTAL.includes(t) ? -add('resist:elemental') : 0);
    resist[t] = Math.round(r);
  }
  for (const t of compilePassives(hero).immuneDamage) resist[t] = 'immune';   // an element's rank 6 (sandbox item 51)
  // Iron Flesh (hit-rule parryPct while unarmed): bare hands parry as a weapon in the off hand does.
  const unarmedParry = !w.main && heroSources(hero).some(([effects]) => (effects ?? []).some(e => e.verb === 'hit-rule' && e.parryPct && (!e.if || e.if.wielding === 'unarmed')));
  const accMult = sMult('accuracy') * (1 + pct('accuracy') / 100);
  // CB05 Lady Luck (1.7 luck.js, stats.js:168-169): Wobbles' +3 points a rank on crit, parry and block (block to its
  // cap); attack.js takes it off a foe's chance to hit, and the hero's procs roll with it (passives.js, effects.js).
  const luck = add('luck'), parryBase = off?.kind === 'weapon' || unarmedParry ? B.parryBasePct + (agi / B.parryAgilityDivisor) * 100 : 0;
  return {
    maxhp, maxmana, xpPct: pct('xp-gain'), divine,
    acc: Math.round((B.accuracyBase + B.accuracyPerAgility * agi + (main ? value(main.row.accuracy ?? 0, w.main, hero) : fists.accuracy ?? 0) + add('accuracy')) * accMult),
    eva: Math.round((B.evasionBase + B.evasionPerAgility * agi + (dwarfNoPenalty ? Math.max(0, armourEva) : armourEva) + offEva + add('evasion')) * (1 + pct('evasion') / 100) * sMult('evasion')),
    armour: (arm ? armourValue(w.armour, hero) : 0) + Math.round(add('armour')),
    dmg, damageShown: dmg.map(n => Math.round(n * meleeShown)),
    crit: B.critBasePct + B.critPerAgilityPct * (agi - 10) + add('crit') + luck,
    critMult: tuning.rows.critical.playerMultBase + add('crit-mult') / 100,
    block: blockBase ? Math.min(B.blockCapPct, blockBase + B.blockPerMightPct * (mig - 10) + add('block') + luck) : 0,   // C38: the Earth shield's block
    parry: parryBase ? parryBase + luck : 0, luck, defence: heroDefence(hero), moveMult: moveMultOf(hero),
    speed: Math.round((races.rows[hero.race]?.speed ?? 100) * (1 + pct('speed') / 100) * sMult('speed')),
    spellPower: spellPowerOf(hero, mods, sMods),
    range: main?.row.range ?? 1,
    // A41 (1.7 geometry.js stealth): the standing part, in percent: 2 a point of Agility over 10, the Scoundrel's 25,
    // the body armour's weight (medium -10, heavy -25) and gear (shadow armour). ai.js stealthScore adds the moment's.
    ...(() => {
      const raw = P.stealth.perAgilityOver10Pct * Math.max(0, agi - 10) + (classes.rows[hero.cls]?.stealthBonusPct ?? 0)
        + (arm?.row.stealthPct ?? 0) + add('stealth') + pct('stealth');
      return { stealthRaw: raw, stealth: P.stealth.zeroWhen.includes('god-' + (hero.faith?.god ?? '')) ? 0 : Math.max(0, Math.min(P.stealth.capPct, raw)) };
    })(),
    // C71 (1.7 stats.js computeWithRanged): the ranged slot's bow answers for a shot with its own damage and
    // accuracy (the main hand's accuracy swapped for the bow's) and its own range, plus the elf's +1.
    bow: rangedOf(hero, add('accuracy') + B.accuracyBase + B.accuracyPerAgility * agi, add('range'), dmgAdd, accMult),
    resist,
    passives: passivesOf(hero).map(p => p.id),
  };
}
