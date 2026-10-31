// The sworn gods' own powers that ride the effect verbs (consolidation C8: moved from effects.js; engine-rules-27):
// Mother Murk's summons and Shades, Wobbles' weights, conversions and gifts, and the echo's regeneration.

import { fieldAt } from './fields.js';
import { amount } from './amount.js';
import { next } from '../lib/rng.js';
import { makeCreature } from './monsters.js';
import { rollTable } from './loot.js';
import piety from '../../data/piety.json' with { type: 'json' };
import gods from '../../data/gods.json' with { type: 'json' };
import { itemName } from './item-names.js';
import statuses from '../../data/statuses.json' with { type: 'json' };
import { walkable } from '../data/tiles.js';
import { passivesOf } from './own-stats.js';
import progression from '../../data/progression.json' with { type: 'json' };
import { isBlocking, bodyOn } from './effects/select.js';
import { UP } from './set-pieces.js'; const runEffect = (...a) => UP.runEffect(...a);   // C17: the one verb path (set-pieces.js UP, from effects.js)

/**
 * CF09 (1.7 gods.js murkSummonHp, murkSummonDamage, :619-640): the sworn god's own-summons boons on one of the hero's
 * summons (Mother Murk's Grave Strength from rank 3: +5% max HP and damage a rank), kept against the summons' own
 * numbers so a later rank never compounds them. Speed is costs.js summonCost's. Pass no body to bring every summons
 * up to the hero's rank (after a rank-up).
 */
/**
 * CB49 (1.7 shadow-clone.js snapshot hpRate, mpRate): the echo's regeneration a game turn, as fractions of its max HP
 * and mana: the hero's base and Vitality or Focus rates, Resilient and Tidal Mind's doubling below half, Meditation,
 * Grumbok's boon (ai.js echoRegen runs it).
 */
export function echoRegen(h, o) {
  if (!h) return null;
  const RG = progression.rows.regeneration, ids = new Set(passivesOf(h).map(p => p.id));
  let hp = (RG.hpBasePct + RG.hpPerVitalityPct * Math.max(0, (h.attr?.vit ?? 10) - 10)) / 100;
  hp *= 1 + (gods.rows[h.faith?.god]?.regenPerRankPct ?? 0) * (h.faith?.rank ?? 0) / 100;   // C16: the god's row (Grumbok's 20% a rank)
  hp *= o.fx?.healMult ?? 1;
  const mp = (RG.manaBasePct + RG.manaPerFocusPct * Math.max(0, (h.attr?.foc ?? 10) - 10)) / 100 * (ids.has('meditation') ? RG.meditationMult : 1);
  return { hp, mp, resilient: ids.has('resilient') ? RG.resilientMult : 1, tidal: ids.has('tidal-mind') ? RG.tidalMindMult : 1 };
}

export function graveStrength(state, m = null) {
  if (!m) { for (const id of state.order ?? []) { const a = state.actors[id]; if (a?.summon && a.hp > 0) graveStrength(state, a); } return; }
  const h = state.hero, f = h?.faith, o = state.actors?.[m.owner];
  if (!m.summon || !o || o.side !== 'player') return;
  const rank = f?.rank ?? 0, c = { state: null, owner: o, rank };
  let hp = 0, dmg = 0;
  if (f?.god) for (const b of gods.rows[f.god]?.boons ?? []) if (b.rank <= rank) for (const e of b.effects ?? []) {
    if (e.verb !== 'modify-stat' || e.target?.selector !== 'own-summons' || e.pct === undefined) continue;
    if (e.stat === 'max-hp') hp += amount(e.pct, c);
    if (e.stat === 'damage-pct') dmg += amount(e.pct, c);
  }
  if (!m.graveBase && !hp && !dmg) return;
  m.graveBase ??= { maxhp: m.maxhp, dmg: [...(m.dmg ?? [0, 0])] };
  const max = Math.max(1, Math.round(m.graveBase.maxhp * (1 + hp / 100)));
  if (max !== m.maxhp) { m.hp = Math.max(1, Math.min(max, Math.round(m.hp * max / m.maxhp))); m.maxhp = max; }
  m.dmg = m.graveBase.dmg.map(d => Math.max(1, Math.round(d * (1 + dmg / 100))));
}

/**
 * CF09 (1.7 gods.js murkLifeDrain, :643-658): from rank 3 Mother Murk's Life Drain rides her follower's summons' blows
 * too, at the hero's own odds and strength (his Shadow points, rank and divine); the summons heals what it drains.
 */
export function summonLifeDrain(state, m, target, events) {
  const f = state.hero?.faith, o = state.actors?.[m.owner];
  if (f?.god !== 'murk' || (f.rank ?? 0) < 3 || !m.summon || !o || o.side !== 'player' || target.side !== 'foe' || target.hp <= 0) return;
  const row = (gods.rows.murk.boons ?? []).find(b => b.id === 'life-drain')?.effects?.find(e => e.verb === 'on-event');
  if (!row) return;
  const c = { state, owner: o, target, rank: f.rank, events };
  if (row.chance !== undefined && !(next(state.rng) < amount(row.chance, c) / 100)) return;
  for (const e of row.effects ?? []) runEffect(e.amount === undefined ? e : { ...e, amount: Math.round(amount(e.amount, c)) }, { state, owner: m, source: m, target, events, rank: f.rank });
}

/**
 * CB14 (1.7 combat.js:178-189 raiseShade): the slain body stands up as the hero's Shade where it fell: its own kind's
 * moves at ratio x its HP and damage, in the Shade's own art, no XP, no loot. At the cap the weakest Shade goes first.
 */
export function raiseCopy(e, c) {
  const s = c.state, v = c.victim ?? c.target, o = c.owner;
  if (!v || !o) return;
  const ratio = typeof e.ratio === 'number' ? e.ratio : 0.5;
  const mine = s.order.map(id => s.actors[id]).filter(a => a?.hp > 0 && a.shade && a.owner === o.id);
  if (e.cap && mine.length >= e.cap) {
    const weak = mine.sort((a, b) => a.hp - b.hp)[0];
    weak.hp = 0; c.events.push({ type: 'died', id: weak.id, dismissed: true });
  }
  const m = makeCreature(v.kind, v.x, v.y), look = makeCreature('shade', v.x, v.y).look;
  const maxhp = Math.max(1, Math.round((v.maxhp ?? m.maxhp) * ratio));
  Object.assign(m, {
    name: `Shade of ${m.name}`, side: 'ally', owner: o.id, summon: true, shade: true, noXp: true, drops: 'kill-none', hunting: true,
    t: o.t ?? 0, hp: maxhp, maxhp, dmg: (v.dmg ?? m.dmg).map(d => Math.max(1, Math.round(d * ratio))),
    abilityScale: (m.abilityScale ?? 1) * ratio, look,   // 1.7 inheritedAbilityDamage x0.5; drawn as the Shade (m-shade at 0.9)
  });
  s.actors[m.id] = m; s.order.push(m.id);
  graveStrength(s, m);   // CF09 (1.7 murkSummonHp)
  c.events.push({ type: 'spawned', id: m.id, at: { x: m.x, y: m.y }, summon: true },
    { type: 'log', words: statuses.rows.corrupt?.log?.shade ?? 'Shade summoned.', cls: 'c-good' },
    { type: 'sparkle', at: { x: m.x, y: m.y }, kind: 'dark', n: 8, rise: true });
}

/**
 * CF06 (1.7 gods.js wobblesInvokeRules, religion.js Tempt Fate; progression.js wobblesOutcome): a choose weight; the
 * Wobbles split reads the reward chance: Roll the Dice 1 - 0.4 / divine, Tempt Fate 0.65; the prank takes the rest.
 */
export function weightOf(w, c) {
  if (typeof w === 'number') return w;
  const key = w?.['from-source'];
  if (key === 'rewardWeight' || key === 'prankWeight') {
    const W = piety.rows['wobbles-outcome'], divine = c.owner?.divine ?? 1;
    const base = c.ability?.kind === 'prayer' ? W.temptBaseReward : W.invokeDivideByDivine ? 1 - (1 - W.invokeBaseReward) / divine : W.invokeBaseReward;
    const r = Math.max(0, Math.min(1, base));
    return key === 'rewardWeight' ? r : 1 - r;
  }
  return amount(w, c);
}

/** 1.7 wobblesOutcome conversion: 5% a rank from rank 3, while sworn to Wobbles. */
export function favoriteToy(c) {
  const f = c.state.hero?.faith, W = piety.rows['wobbles-outcome'];
  if (f?.god !== 'wobbles' || (f.rank ?? 0) < W.prankToRewardFromRank) return 0;
  return Math.min(W.prankToRewardCapPct, W.prankToRewardPerRankPct * f.rank) / 100;
}

/**
 * CF06 (1.7 gods.js grantWobblesGift, wobblesGiftDrop): a loot table's gifts on the first empty, unburning neighbour
 * in 1.7's fixed order (else the hero's tile), drawing nothing for the landing, with "Wobbles: X dropped nearby."
 */
export function giftDrop(e, c) {
  const s = c.state, f = s.floor, o = c.owner;
  const drops = rollTable(s, e.item, s.floorNo);
  for (const it of drops) {
    if (it.kind === 'essence' && e.essenceScale) it.n = Math.round(it.n * e.essenceScale);   // CF17: a mood gift's essence x the biome
    let at = { x: o.x, y: o.y };
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const x = o.x + dx, y = o.y + dy;
      if (walkable(f, x, y) && !bodyOn(s, x, y) && !f.props?.some(q => q.x === x && q.y === y && isBlocking(q)) && !f.burning?.[y * f.w + x] && !fieldAt(s, x, y, 'fire')) { at = { x, y }; break; }
    }
    f.items.push({ x: at.x, y: at.y, item: it });
    const name = it.kind === 'essence' ? `${it.n} Essence` : it.kind === 'mote' ? `1 ${it.el} mote` : itemName(it, s);
    const source = e.item === 'amulet-plenty' ? 'Amulet of Plenty' : 'Wobbles';
    c.events.push({ type: 'drops', at }, { type: 'log', words: `${source}: ${name} dropped nearby.` });
  }
}
