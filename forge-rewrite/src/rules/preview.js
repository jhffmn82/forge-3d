// Sandbox E2 (Justin 2026-10-16, "yes to all"): what an enchant or the next affinity point would give this hero, as
// before and after numbers the Forge and Character windows can show. Pure: works on copies, never changes the hero.

import upgrades from '../../data/upgrades.json' with { type: 'json' };
import elements from '../../data/elements.json' with { type: 'json' };
import abilities from '../../data/abilities.json' with { type: 'json' };
import { heroStats } from './derive.js';
import { compilePassives, heroPassiveRows } from './passives.js';
import { grantedSpells } from './magic.js';
import { enchantCurve } from './passives.js';

const STATS = [
  ['maxhp', 'Max HP'], ['maxmana', 'Max mana'], ['armour', 'Armour'], ['eva', 'Evasion'], ['acc', 'Accuracy'],
  ['crit', 'Crit %'], ['block', 'Block %'], ['spellPower', 'Spell power'],
];
const RESIST = ['fire', 'ice', 'lightning', 'poison', 'dark', 'light'];

const copy = hero => JSON.parse(JSON.stringify(hero));
const round = n => Math.round(n * 100) / 100;

/** The changed numbers between two heroes: stats, resistances, move speed, Ice Armor. */
function diff(a, b) {
  const sa = heroStats(a), sb = heroStats(b), fa = compilePassives(a), fb = compilePassives(b), out = [];
  for (const [k, label] of STATS) if (round(sa[k]) !== round(sb[k])) out.push({ key: k, label, before: round(sa[k]), after: round(sb[k]) });
  for (const t of RESIST) if (sa.resist[t] !== sb.resist[t]) out.push({ key: 'resist:' + t, label: `${t[0].toUpperCase() + t.slice(1)} resist %`, before: sa.resist[t], after: sb.resist[t] });
  if (fa.moveSpeedPct !== fb.moveSpeedPct) out.push({ key: 'move', label: 'Move speed %', before: round(fa.moveSpeedPct), after: round(fb.moveSpeedPct) });
  if (fa.iceArmorMax !== fb.iceArmorMax) out.push({ key: 'iceArmor', label: 'Ice Armor', before: round(fa.iceArmorMax), after: round(fb.iceArmorMax) });
  return out;
}

/** The trigger rows a hero gains (names like "fire-point", "enchant-weapon-fire"), for one-line "On hit: ..." notes. */
function newTriggers(a, b) {
  const had = new Set(heroPassiveRows(a).map(r => r.from));
  return heroPassiveRows(b).filter(r => !had.has(r.from)).map(r => r.from);
}

/**
 * Enchanting the item in `slot` with `element`: { stats: [{key, label, before, after}], values: {name: number},
 * triggers: [row ids gained], replaces: old element or null }. values are the enchant's own numbers at this hero's
 * affinity (extraRatio, burnPct, chillPct ...), so the window can say "+16% of the blow as fire, 10% Burn".
 */
export function previewEnchant(hero, slot, element) {
  const it = hero.worn?.[slot];
  if (!it) return null;
  const after = copy(hero);
  after.worn[slot] = { ...after.worn[slot], enchant: element, cursed: false };
  const before = copy(hero);
  const kind = Object.keys(upgrades.rows).find(k => k.startsWith('enchant-') && k.endsWith('-' + element) && heroPassiveRows(after).some(r => r.from === k));
  const values = {};
  if (kind) {
    const row = upgrades.rows[kind], n = hero.affinity?.[element] ?? 0;
    // G32 (1.7 enchantments.js:52-55 godBonus): the preview carries the god bonus the worn enchant gets (passives.js
    // curve): Vellum rank 5 x1.25, the Old Anvil +10% a rank, on every number that is not fixed.
    // C16: the curve is passives.js's (enchantCurve, with the god's bonus), as a percent.
    for (const [k, cv] of Object.entries(row.values ?? {})) {
      if (typeof cv === 'number') { values[k] = cv; continue; }
      const v = enchantCurve(cv, hero, element, { asMult: false });
      values[k] = cv.round ? v : round(v);
    }
  }
  return { stats: diff(before, after), values, triggers: newTriggers(before, after), replaces: it.enchant && it.enchant !== element ? it.enchant : null, row: kind ?? null };
}

/**
 * One more point of `element`: { stats, triggers, spells: [names of spells it unlocks], rank: the new rank,
 * powers: [rank 3 / rank 6 power names reached] }.
 */
export function previewAffinity(hero, element) {
  const E = elements.rows[element];
  if (!E || E.kind !== 'element') return null;
  const before = copy(hero), after = copy(hero);
  after.affinity = { ...(after.affinity ?? {}), [element]: (after.affinity?.[element] ?? 0) + 1 };
  const rank = after.affinity[element], had = new Set(grantedSpells(before));
  const spells = grantedSpells(after).filter(id => !had.has(id)).map(id => abilities.rows[id]?.name ?? id);
  const powers = [];
  if (rank === 3 && E.rank3) powers.push(E.rank3.name);
  if (rank === 6 && E.rank6) powers.push(E.rank6.name);
  return { stats: diff(before, after), triggers: newTriggers(before, after), spells, rank, powers };
}
