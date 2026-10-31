// The Forge's upgrade and cleanse (spec/items.md I29-I30, upgrades.json). Fuse, enchant, craft and recycle are
// packet D's (magic.md, not written yet) and are refused as not built.

import upgrades from '../../data/upgrades.json' with { type: 'json' };
import tiers from '../../data/tiers.json' with { type: 'json' };
import { itemRow } from './items.js';
import { ownSources, ownStat } from './own-stats.js';

const U = upgrades.rows, TIER = ['worn', 'plain', 'fine', 'masterwork'];

/** Is the hero beside (or on) this floor's Forge? */
export const atForge = state => { const f = state.floor.forge, p = state.actors[state.playerId]; return !!f && Math.max(Math.abs(f.x - p.x), Math.abs(f.y - p.y)) <= 1; };

/** I29: essence to take a worn item one plus higher (or, cursed, to cleanse it: the +1 price, I30). null when it cannot. */
export function upgradeCost(hero, item) {
  const { kind } = itemRow(item.id);
  if (!U['upgrade-targets'].kinds.includes(kind)) return null;
  const ring = kind === 'ring', table = ring ? U['ring-costs'] : U['gear-costs'];
  const step = item.cursed || item.plus < 0 ? 0 : item.plus, tierMult = ring ? 1 : tiers.rows[TIER[item.tier ?? 1]].upgradeCostMult ?? 1;
  // A23, EQ27, I29 (1.7 upgrade.js:52-64): the upgrade-essence discounts, each a cost-mod row: the race's (a Dwarf pays
  // x 0.75) and the rest of the hero's own (the Old Anvil's Masterwork, rank 5: x 0.7; item 288, read from its row). Its
  // upgrade-cap row opens a fourth rank on a clean +3 piece (3000 x tier, a ring 2000), both discounts taken there.
  const D = U['upgrade-discounts'], off = race => ownSources(hero).filter(s => (s[2] === 'race') === race).flatMap(s => s[0] ?? [])
    .filter(e => e.verb === 'cost-mod' && e.cost === 'upgrade-essence').reduce((m, e) => m * e.mult, 1);
  const dwarf = off(true), god = off(false);
  if (step >= table.maxPlus + ownStat(hero, 'upgrade-cap').add) return null;
  if (step >= table.maxPlus) return Math.round((ring ? D.anvilCapstoneFourthRank.ring : D.anvilCapstoneFourthRank.gear * tierMult) * god * dwarf);
  // The racial discount rounds before the divine one on ordinary ranks.
  return Math.round(Math.round(table.toPlus[step] * tierMult * dwarf) * god);
}

/** I29-I30: the upgrade command. Returns a refusal or null; costs no game time (the Forge's window acts between turns). */
export function upgrade(state, slot, events) {
  const h = state.hero, it = h.worn[slot];
  if (!atForge(state)) return 'not-at-forge';
  if (!it) return 'empty-slot';
  if (it.known === false) { events.push({ type: 'log', words: 'The Forge will not work metal you do not know. Identify it first.' }); return 'unidentified'; }
  const cost = upgradeCost(h, it);
  if (cost === null) return 'at-max';
  if (h.essence < cost) { events.push({ type: 'log', words: `You need ${cost} essence.` }); return 'no-essence'; }
  h.essence -= cost;
  const name = itemRow(it.id).row.name, cleansed = !!(it.cursed || it.plus < 0);
  if (cleansed) {
    it.cursed = false; it.known = true;
    it.plus = itemRow(it.id).kind === 'ring' ? 0 : Math.max(0, it.plus);
    events.push({ type: 'log', words: `The Forge burns the curse out of your ${name}.`, sfx: 'forge-enchant' });
  } else {
    it.plus += 1;
    events.push({ type: 'log', words: `Your ${name} is now +${it.plus}.`, sfx: 'forge-enchant' });   // G28: 1.7 forge-adapter.js:63, every upgrade
  }
  // slot and cleansed: the Forge window's receipt (G29) names the piece and says whether its curse burned out.
  events.push({ type: 'hero', change: 'upgrade', slot, cleansed }, { type: 'essence-spent', amount: cost });
  return null;
}
