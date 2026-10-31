// The hero's upkeep each paid action (spec/character.md A43-A45): hunger (B5), regeneration (A3), class recovery
// (A10); and eating (spec/items.md I59-I60). Numbers: progression.json hunger and regeneration, foods.json.

import progression from '../../data/progression.json' with { type: 'json' };
import foods from '../../data/foods.json' with { type: 'json' };
import strings from '../../data/strings.json' with { type: 'json' };
import rings from '../../data/rings.json' with { type: 'json' };
import { registerPhase } from './phases.js';
import { dealDamage, heal } from './damage.js';
import { heroHealMult } from './damage.js';
import { applyStatus, removeStatus, statusRow } from './statuses.js';
import { regenGear } from './derive.js';
import { passivesOf } from './own-stats.js';
import { value } from './items.js';
import gods from '../../data/gods.json' with { type: 'json' };
import races from '../../data/races.json' with { type: 'json' };

const H = progression.rows.hunger, RG = progression.rows.regeneration;
const COMBAT_UNITS = 500;   // A44: in combat = hurt within the last 500 time units (ruled 2026-10-15)
const FOOD_BUFFS = new Set(foods.rows['one-buff'].foodBuffs);

const has = (hero, id) => passivesOf(hero).some(p => p.id === id);
const inCombat = (state, p) => p.lastHurtAt !== undefined && state.now - p.lastHurtAt < COMBAT_UNITS;

/** I42: the Sustenance ring: 15% less hunger a power, and food buffs 100% longer a power (never shorter). */
function sustenance(hero) {
  let less = 0, longer = 0;
  for (const s of ['ring1', 'ring2']) {
    const it = hero.worn?.[s];
    if (it?.id !== 'sustenance') continue;
    less -= value(rings.rows.sustenance.values.hungerRatePct, it, hero) / 100;
    longer += Math.max(0, value(rings.rows.sustenance.values.foodBuffMult, it, hero) / 100);
  }
  return { less, longer };
}

/** A43 (B5): hunger drains by the action's cost; below 300 a warning; at 0 starvation. */
registerPhase('hunger', (state, ctx, events) => {
  const h = state.hero, p = state.actors[state.playerId];
  if (!h) return;
  const before = h.hunger;
  const drain = ctx.cost / 100 * H.perGameTurn * (races.rows[h.race]?.hungerMult ?? 1) * (1 - sustenance(h).less);
  h.hunger = Math.max(0, Math.min(H.max, h.hunger - drain));
  if (before >= H.hungryWarningAt && h.hunger < H.hungryWarningAt) events.push({ type: 'log', words: H.hungryLog.replace(/<\/?b>/g, ''), warning: true, sfx: H.hungrySfx });
  if (h.hunger > 0) { h.starveTurns = 0; return; }
  // At 0: 1 damage every 5 game turns and the warning every 25 (turns.md TO1-TO2, ruled 2026-10-15: game turns, not actions).
  const before5 = Math.floor((h.starveTurns ?? 0) / H.starvationEveryActions), before25 = Math.floor((h.starveTurns ?? 0) / H.starvingLogEveryActions);
  h.starveTurns = (h.starveTurns ?? 0) + ctx.cost / 100;
  for (let k = before5; k < Math.floor(h.starveTurns / H.starvationEveryActions); k++) dealDamage(state, { target: p, source: null, amount: H.starvationDamage, type: 'phys', premitigated: true, bypassShields: true, cause: 'starvation' }, events);   // 158 (Justin 2026-10-18): hunger takes HP, never the Guard or a ward (1.7)
  if (Math.floor(h.starveTurns / H.starvingLogEveryActions) > before25) events.push({ type: 'log', words: H.starvingLog, warning: true, sfx: H.hungrySfx });
});

/**
 * A44 (A3), G21 (1.7 turns.js:43-60, foods.js turnFoodRecovery): mana and HP come back a little each action, scaled by
 * its cost. Base HP not while starving, poisoned, rotting or in combat; a Light armour enchant raises it. A Ring of
 * Mending heals while fed and not poisoned, in combat too; the Regeneration food heals 1% of max HP (at least 1) a turn.
 * Rot and a cursed Ring of Mending stop all of it. A Water holy symbol and Mana Flow add mana.
 */
registerPhase('regeneration', (state, ctx, events) => {
  const h = state.hero, p = state.actors[state.playerId];
  if (!h || p.hp <= 0) return;
  const k = ctx.cost / 100, attr = h.attr, gear = regenGear(h);
  let mp = p.maxmana * (RG.manaBasePct + RG.manaPerFocusPct * Math.max(0, attr.foc - 10)) / 100;
  if (has(h, 'meditation')) mp *= RG.meditationMult;
  if (has(h, 'tidal-mind') && p.mana < p.maxmana / 2) mp *= RG.tidalMindMult;
  if (p.statuses.manaflow) mp += p.maxmana * RG.manaflowPct / 100;
  if (gear.mpPct) mp += p.maxmana * RG.manaBasePct / 100 * gear.mpPct / 100;
  h.regenMp = (h.regenMp ?? 0) + mp * k;
  if (h.regenMp >= 1) { const n = Math.min(Math.floor(h.regenMp), p.maxmana - p.mana); p.mana += Math.max(0, n); h.regenMp -= Math.floor(h.regenMp); }
  if (p.statuses.rot || !(gear.regenMult > 0)) { h.regenHp = 0; return; }
  let hp = 0;
  if (!(h.hunger <= 0 || p.statuses.poison || inCombat(state, p))) {
    hp = p.maxhp * (RG.hpBasePct + RG.hpPerVitalityPct * Math.max(0, attr.vit - 10)) / 100;
    if (has(h, 'resilient') && p.hp < p.maxhp / 2) hp *= RG.resilientMult;
    if (gear.hpPct) hp *= 1 + gear.hpPct / 100;
    hp *= 1 + (gods.rows[h.faith?.god]?.regenPerRankPct ?? 0) * (h.faith?.rank ?? 0) / 100;   // C16: the god's row
  }
  if (gear.mending > 0 && h.hunger > 0 && !p.statuses.poison) hp += p.maxhp * gear.mending / 100;
  if (p.statuses.regeneration) {   // statuses.json regeneration: hp-regen add 1 (% of max HP), min 1
    const w = statusRow('regeneration').while.find(r => r.stat === 'hp-regen');
    hp += Math.max(w.min ?? 0, Math.round(p.maxhp * w.add / 100));
  }
  if (!hp) { h.regenHp = 0; return; }
  // CD2 Mending Light: regeneration is healing too (1.7 damage.js healingAmount); E10: holy ground (1.7 sanctuaryPower).
  hp *= heroHealMult(state, p) * gear.regenMult;
  h.regenHp = (h.regenHp ?? 0) + hp * k;
  // E14 (1.7 turns.js:54, damage-adapter.js:405): regeneration past max HP is overheal; Holy Water rimes it into Ice
  // Armor. It is natural healing, so it never stanches a bleed.
  const holyWater = p.fx?.triggers?.some(t => t.trigger === 'on-heal');   // an on-heal row (Holy Water) wants the overheal
  if (h.regenHp >= 1 && (p.hp < p.maxhp || holyWater)) {
    const whole = Math.floor(h.regenHp);
    h.regenHp -= whole;
    heal(state, p, whole, events, { raw: true, natural: true, onHeal: 'over', mark: { regen: true } });
  } else if (p.hp >= p.maxhp) h.regenHp = 0;
});

/** A45 (A10): a Fighter's Guard refills by the action's cost / 100 while out of combat. */
registerPhase('class-recovery', (state, ctx) => {
  const p = state.actors[state.playerId], h = state.hero;
  p.noisy = false;
  if (!p.maxguard || inCombat(state, p)) return;
  h.regenGuard = (h.regenGuard ?? 0) + ctx.cost / 100;
  if (h.regenGuard >= 1) { p.guard = Math.min(p.maxguard, (p.guard ?? 0) + Math.floor(h.regenGuard)); h.regenGuard -= Math.floor(h.regenGuard); }
});

/**
 * I60: eating costs an action: restores its hunger (to 1500 at most) and starts its buff. One food buff at a time:
 * a new one ends the old; the same one keeps the longer count. Returns a refusal or null.
 */
export function eat(state, bagIndex, events) {
  const h = state.hero, p = state.actors[state.playerId], it = h.bag[bagIndex];
  if (!it) return 'no-item';
  if (it.kind !== 'food') return 'not-usable';
  const row = foods.rows[it.id];
  if ((it.count ?? 1) > 1) it.count -= 1; else h.bag.splice(bagIndex, 1);
  events.push({ type: 'log', words: `You eat the ${row.name.toLowerCase()}.`, sfx: 'eat' });
  for (const e of row.effects) {
    if (e.verb === 'gain' && e.resource === 'hunger') { h.hunger = Math.min(H.max, h.hunger + e.amount); continue; }
    if (e.verb === 'apply-status' && FOOD_BUFFS.has(e.status)) {
      const turns = Math.round(e.turns * (1 + sustenance(h).longer)), same = p.statuses[e.status];
      if (!same || (same.turns ?? 0) < turns) {
        for (const b of FOOD_BUFFS) if (b !== e.status && p.statuses[b]) removeStatus(state, p, b, events);
        applyStatus(state, p, e.status, { turns, magnitude: e.magnitude, source: p.id }, events);
      }
      // EQ14 (1.7 foods.js:37): the food says its buff, and how far a Sustenance ring stretches it.
      const desc = strings.rows[row.text];
      if (desc) events.push({ type: 'log', words: `<b>${row.name}</b>: ${desc}${turns > e.turns ? ` Your ring stretches it to ${turns} turns.` : ''}`, cls: 'c-good' });
      continue;
    }
    state.unbuilt['food:' + e.verb] = (state.unbuilt['food:' + e.verb] ?? 0) + 1;
  }
  events.push({ type: 'hero', change: 'eat', food: it.id });   // EQ15: which food, for its sparkle (fx-layer.js)
  return null;
}
