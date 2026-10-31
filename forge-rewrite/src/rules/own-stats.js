// The hero's own effect rows, apart from worn gear (spec/character.md A31, faith.md F2): the stat passives unlocked, the
// class, race and court passives and the sworn god's boons to the rank. Plain data, so a gear number (items.js) and the
// god's bonus on enchants (passives.js) read a stat from them without the gear's own values; derive.js adds the gear.

import progression from '../../data/progression.json' with { type: 'json' };
import classes from '../../data/classes.json' with { type: 'json' };
import races from '../../data/races.json' with { type: 'json' };
import courts from '../../data/courts.json' with { type: 'json' };
import gods from '../../data/gods.json' with { type: 'json' };
import { amount } from './amount.js';

/** Stat passives the hero has unlocked (A31 table). */
export function passivesOf(hero) {
  const out = [];
  for (const [attr, list] of Object.entries(progression.rows['stat-passives'])) {
    if (!Array.isArray(list)) continue;
    for (const p of list) if ((hero.attr?.[attr] ?? 0) >= p.at) out.push(p);
  }
  return out;
}

/** The hero's own effect lists: stat passives, class, race, court, the sworn god's boons to the rank; [effects, null, from]. */
export function ownSources(hero) {
  const out = passivesOf(hero).map(p => [p.effects, null, 'passive']);
  out.push([classes.rows[hero.cls]?.passive, null, 'class'], [races.rows[hero.race]?.passive, null, 'race']);
  if (hero.court) out.push([courts.rows[hero.court]?.passive, null, 'court']);
  for (const b of gods.rows[hero.faith?.god]?.boons ?? []) if (b.rank <= (hero.faith.rank ?? 0)) out.push([b.effects, null, 'boon']);
  return out;
}

/** A stat's unconditional percents and adds among those rows, at the hero's rank and for the hero: {pct, add}. */
export function ownStat(hero, stat) {
  const out = { pct: 0, add: 0 }, c = { rank: hero.faith?.rank ?? 0, owner: hero, state: null };
  for (const [effects] of ownSources(hero)) for (const e of effects ?? []) {
    if (e.verb !== 'modify-stat' || e.stat !== stat || e.if || (e.target && e.target.selector !== 'self')) continue;
    if (e.pct !== undefined) out.pct += amount(e.pct, c);
    if (e.add !== undefined) out.add += amount(e.add, c);
  }
  return out;
}

/**
 * I8 (item 288, Justin 2026-10-20: "vellums boon was never implemented"): the gear bonus, 1 + the hero's gear-bonus
 * percent (Vellum's Arcane Attunement, rank 5: x1.25), on every gear number marked gearBonus and on enchants.
 */
export const gearBonus = hero => 1 + ownStat(hero, 'gear-bonus').pct / 100;
