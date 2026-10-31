// Items: one row lookup and one value resolver for every gear number (spec/items.md "How packet C data is written").

import weapons from '../../data/weapons.json' with { type: 'json' };
import armour from '../../data/armour.json' with { type: 'json' };
import offhands from '../../data/offhands.json' with { type: 'json' };
import rings from '../../data/rings.json' with { type: 'json' };
import amulets from '../../data/amulets.json' with { type: 'json' };
import foods from '../../data/foods.json' with { type: 'json' };
import tiers from '../../data/tiers.json' with { type: 'json' };
import races from '../../data/races.json' with { type: 'json' };
import { gearBonus } from './own-stats.js';

const TABLES = { weapon: weapons.rows, armour: armour.rows, offhand: offhands.rows, ring: rings.rows, amulet: amulets.rows, food: foods.rows };
const UPG = tiers.rows['upgrade-damage'], UPG_ARMOUR = tiers.rows['upgrade-armour'];

/** A body armour's Armor for a hero: its tier number plus each plus and the race's gear bonus (dwarf +1) at the upgrade step (C4, ui-11). */
export const armourValue = (item, hero) => value(itemRow(item.id).row.armour, item, hero) + ((item.plus ?? 0) + (races.rows[hero.race]?.gearUpgradeBonus ?? 0)) * UPG_ARMOUR.perPlus;

/** The data row for an item id in any gear table. */
export function itemRow(id) {
  for (const [kind, rows] of Object.entries(TABLES)) if (rows[id] && rows[id].kind !== 'rule') return { kind, row: rows[id] };
  throw new Error('unknown item ' + id);
}

/** A fresh item as the state stores it. */
export function makeItem(id, tier = 0, plus = 0) {
  const { kind } = itemRow(id);
  return { id, kind, tier, plus };
}

/** I7: the plus a number is counted at (a dwarf counts weapons and body armour one higher). */
function plusFor(shape, item, hero) {
  const bonus = races.rows[hero.race]?.gearUpgradeBonus ?? 0;
  const { kind } = itemRow(item.id);
  const bodyGear = kind === 'weapon' || kind === 'armour';
  return shape.plus === 'effective' && bodyGear ? item.plus + bonus : item.plus;
}

/** I41: a ring's power. +0 is 1 and each plus adds 1; a cursed ring (negative plus) is minus its curse, at least -1. */
export function ringPower(item) {
  return item.plus >= 0 ? item.plus + 1 : Math.min(-1, item.plus);
}

/** The effects an item gives while worn: a ring below 0 power gives its cursedEffects when it has them. */
export function effectsOf(item) {
  const { kind, row } = itemRow(item.id);
  return kind === 'ring' && ringPower(item) < 0 && row.cursedEffects ? row.cursedEffects : row.effects;
}

/**
 * Resolves one value shape for an item worn by a hero. Numbers pass through. A piece is cursed when it says so or its
 * plus is below 0. The curse shapes (spec/items.md I15-I19, I27; C4, ui-02):
 * - zero: nothing while cursed (I27, 1.7 holyDurationPct).
 * - only: counts only while cursed (the orb's spell penalty).
 * - negate-base, penalty, only: while cursed the value is minus (tier number + |per plus| x |plus|), times the gear
 *   bonus: a cursed staff or wand takes spell power away; a cursed wand raises the mana cost by its tier number + 3% x
 *   the size of the curse (ruled 2026-10-15).
 */
export function value(shape, item, hero) {
  if (typeof shape === 'number') return shape;
  if (!shape || typeof shape !== 'object') throw new Error('bad item value ' + JSON.stringify(shape));
  if ('tiers' in shape) {
    const cursed = !!item.cursed || (item.plus ?? 0) < 0;
    if (shape.cursed === 'zero' && cursed) return 0;
    if (shape.cursed === 'only' && !cursed) return 0;
    let v = shape.tiers[item.tier] ?? 0;
    if (Array.isArray(v)) return v;
    if (cursed && (shape.cursed === 'negate-base' || shape.cursed === 'penalty' || shape.cursed === 'only')) {
      v = -(Math.abs(v) + Math.abs(shape.perPlus ?? 0) * Math.abs(item.plus ?? 0)) * (shape.gearBonus ? gearBonus(hero) : 1);
    } else {
      v += (shape.perPlus ?? 0) * plusFor(shape, item, hero);
      if (shape.gearBonus) v *= gearBonus(hero);
      if (shape.round) v = Math.round(v);
    }
    if (shape.min !== undefined) v = Math.max(shape.min, v);
    return v;
  }
  if ('perPower' in shape) {
    // I41: step x power + base x sign(power), times the gear bonus; two rings of a kind add (the caller sums them).
    const power = ringPower(item);
    let v = shape.perPower * power + (shape.base ?? 0) * Math.sign(power);
    if (shape.gearBonus) v *= gearBonus(hero);
    if (shape.round) v = Math.round(v);
    if (shape.min !== undefined) v = Math.max(shape.min, v);
    return v;
  }
  throw new Error('item value shape not built yet: ' + Object.keys(shape).join(','));
}

/** I9: a weapon's damage range at its tier and plus; the dwarf's +1 to both ends (races.json). */
export function weaponDamage(item, hero) {
  const { row } = itemRow(item.id);
  const [lo, hi] = value(row.damage, item, hero);
  const two = row.hands === 2 ? UPG.twoHandedMult : 1;
  const steps = item.plus;
  const addLo = Math.round(UPG.perPlusMin * steps * two), addHi = Math.round((item.tier + UPG.perPlusMaxIsTierIndexPlus) * steps * two);
  const dwarf = races.rows[hero.race]?.gearUpgradeBonus ?? 0;
  return [lo + addLo + dwarf, hi + addHi + dwarf];
}
