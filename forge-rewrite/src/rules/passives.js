// The hero's passive effects from enchants, element affinity and combos (spec/items.md I32-I39; spec/magic.md D35-D43;
// upgrades.json enchant-*, elements.json perPoint / rank3 / rank6, combos.json). One collector, compiled onto the
// player's body by applyHero: static parts (stats, resistances, immunities, damage and cost mods, Ice Armor) and
// triggers that fire on hits, crits, blocks, kills, casts and damage dealt. No passive is written here by name.

import upgrades from '../../data/upgrades.json' with { type: 'json' };
import elements from '../../data/elements.json' with { type: 'json' };
import combos from '../../data/combos.json' with { type: 'json' };
import gods from '../../data/gods.json' with { type: 'json' };
import statuses from '../../data/statuses.json' with { type: 'json' };
import { itemRow } from './items.js';
import { amount } from './amount.js';
const runEffect = (...a) => UP.runEffect(...a);   // C17: the one verb path (set-pieces.js UP, from effects.js)
import { holds } from './effects/conditions.js';
const pietyOn = (...a) => UP.pietyOn(...a);   // C17: piety for a hero event (set-pieces.js UP, from faith.js)
import { next } from '../lib/rng.js';
import { heroRoll } from './hit.js';
import { whileOf } from './statuses.js';
import { hook, UP, provide } from './set-pieces.js';
import { registerPhase } from './phases.js';
import { gearBonus, ownStat, passivesOf } from './own-stats.js';

const U = upgrades.rows, E = elements.rows, C = combos.rows;
const ENCHANT_SLOT = { buckler: 'shield', kite: 'shield', orb: 'orb', tome: 'tome', holy: 'holy' };

/**
 * I33: base + step x affinity, floored, x the god bonus unless fixed (godEnchantMult: Vellum rank 5 x1.25, Anvil x(1 + 0.1 x rank)),
 * capped, rounded; asMult turns a percent into a multiplier (asMult: false keeps the percent, as the cards show it; C4).
 */
/**
 * G32 (1.7 enchantments.js:52-55 godBonus): the sworn god's bonus on enchant numbers, from the boons' own rows (item
 * 288): the gear bonus (Vellum's Arcane Attunement) and enchant strength (the Old Anvil's Smith's Blessing, 10% a rank).
 */
export function godEnchantMult(hero) {
  return gearBonus(hero) * (1 + ownStat(hero, 'enchant-strength').pct / 100);
}
export function enchantCurve(cv, hero, el, { asMult = true } = {}) {
  if (typeof cv === 'number') return cv;
  let v = (cv.base ?? 0) + (cv.perAffinity ?? 0) * (hero.affinity?.[el] ?? 0);
  if (cv.min !== undefined) v = Math.max(cv.min, v);
  if (!cv.fixed) {
    v *= godEnchantMult(hero);
  }
  if (cv.max !== undefined) v = Math.min(cv.max, v);
  if (cv.round) v = Math.round(v);
  if (asMult && cv.asMult === 'less') return 1 - v / 100;
  if (asMult && cv.asMult === 'more') return 1 + v / 100;
  return v;
}

/** Replaces every {"from-source": key} with the enchant's own number. */
function bind(x, values) {
  if (Array.isArray(x)) return x.map(y => bind(y, values));
  if (!x || typeof x !== 'object') return x;
  if ('from-source' in x && Object.keys(x).length === 1) return values[x['from-source']] ?? 0;
  return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, bind(v, values)]));
}

/** Which enchant table a worn item uses: weapons (any slot) 'weapon', body armour, shields, orb, tome, holy symbol. */
function enchantSlot(slot, item) {
  const { kind } = itemRow(item.id);
  if (kind === 'weapon') return 'weapon';
  if (slot === 'armour') return 'armour';
  return ENCHANT_SLOT[item.id] ?? null;
}

/** Every passive row the hero holds: [{effects, from, weapon?}], with enchant numbers bound in. */
export function heroPassiveRows(hero) {
  const out = [];
  for (const p of passivesOf(hero)) {
    const effects = p.effects.filter(e => e.verb === 'on-event');
    if (effects.length) out.push({ effects, from: p.id });
  }
  for (const [slot, item] of Object.entries(hero.worn ?? {})) {
    if (!item?.enchant || item.cursed) continue;
    const kind = enchantSlot(slot, item), row = kind && U[`enchant-${kind}-${item.enchant}`];
    if (!row) continue;
    const values = Object.fromEntries(Object.entries(row.values ?? {}).map(([k, cv]) => [k, enchantCurve(cv, hero, item.enchant)]));
    out.push({ effects: bind(row.effects, values), from: `enchant-${kind}-${item.enchant}`, weapon: kind === 'weapon' ? slot : null });
  }
  const aff = hero.affinity ?? {};
  // CD2: Mother Murk's Life Drain replaces the Shadow element's own drain roll (faith.md, ruled 2026-10-15).
  const murkDrain = (hero.faith?.rank ?? 0) >= (gods.rows[hero.faith?.god]?.replacesShadowDrainAtRank ?? Infinity);
  const drains = e => e.verb === 'on-event' && (e.effects ?? []).some(x => (x.then ?? []).some(y => y.verb === 'drain'));
  for (const el of ['fire', 'water', 'air', 'earth', 'light', 'shadow']) {
    const n = aff[el] ?? 0;
    if (n >= 1 && E[el].perPoint) out.push({ effects: (E[el].perPoint.effects ?? []).filter(e => !(murkDrain && el === 'shadow' && drains(e))), from: `${el}-point` });
    if (n >= 3 && E[el].rank3) out.push({ effects: E[el].rank3.effects ?? [], from: `${el}-rank3` });
    if (n >= 6 && E[el].rank6) out.push({ effects: E[el].rank6.effects ?? [], from: `${el}-rank6` });
  }
  const R = C['combo-rule'];
  for (const [id, row] of Object.entries(C)) if (row.kind === 'combo' && (aff[row.first] ?? 0) >= R.first && (aff[row.second] ?? 0) >= R.second) out.push({ effects: row.effects, from: id });
  // CD2: the sworn god's boons up to the rank (gods.json). Their stats and resistances are derive.js's; the rest here.
  const f = hero.faith;
  if (f?.god) for (const b of gods.rows[f.god]?.boons ?? []) if (b.rank <= (f.rank ?? 0) && b.effects?.length) out.push({ effects: b.effects, from: `boon-${f.god}-${b.rank}`, boon: true });
  return out;
}

/** Boon verbs read elsewhere: derive.js (stats, resistances, Iron Flesh's parry), faith.js (Kindled's point of Light). */
const BOON_ELSEWHERE = new Set(['modify-stat', 'resist', 'hit-rule', 'gain']);

/**
 * Compiles the rows for the body: static modifiers for heroStats (modify-stat, resist), and the rest the rules read.
 * The owner ctx gives scaled amounts the hero's affinity.
 */
export function compilePassives(hero, body = {}) {
  const rows = heroPassiveRows(hero), ctx = { state: null, rank: hero.faith?.rank ?? 0, owner: { affinity: hero.affinity ?? {}, attr: hero.attr, level: hero.level, divine: body.divine ?? 1 } };
  const fx = { triggers: [], mods: [], immune: [], immuneDamage: [], dealt: [], taken: [], moveSpeedPct: 0, actionTimeMult: 1, castTimeMult: 1, iceArmorMax: 0, unbuilt: [],
    moveTimeDiv: 1, attackSpeedUp: [], healMult: 1, foeStatusTurns: 0, critForce: [], critIf: [], surpriseIf: [], freeActionPct: 0 };
  const num = a => (a === undefined ? 0 : typeof a === 'number' ? a : amount(a, ctx));
  for (const r of rows) for (const e of r.effects) {
    if (e.verb === 'on-event') { fx.triggers.push({ ...e, from: r.from, weapon: r.weapon }); continue; }
    if (r.boon) {
      if (BOON_ELSEWHERE.has(e.verb) || (e.target && e.target.selector !== 'self')) continue;   // a summons' boon is theirs
      // Iron Flesh moves 10% faster a rank; Staggering Blows' unarmed attacks 10% faster a rank (1.7 costs.js:13, :31).
      if (e.verb === 'cost-mod' && e.speedUpPct !== undefined && e.cost === 'move-time') { fx.moveTimeDiv *= 1 + num(e.speedUpPct) / 100; continue; }
      if (e.verb === 'cost-mod' && e.speedUpPct !== undefined && e.cost === 'action-time') { fx.attackSpeedUp.push({ for: e.for ?? 'all', pct: num(e.speedUpPct) }); continue; }
      if (e.verb === 'heal-mod') { fx.healMult *= num(e.mult); continue; }   // Mending Light
      if (e.verb === 'modify-duration' && e.scope === 'foe-statuses') { fx.foeStatusTurns += num(e.add); continue; }   // The Long Patience
    }
    // E31 Lightning Reflexes (1.7 turns.js:14): this share of the hero's attacks and aimed casts take no time (scheduler.js).
    if (e.verb === 'action-economy' && e.free !== undefined) { fx.freeActionPct += num(e.free); continue; }
    // E36 (1.7 actions-adapter.js:46 actionRootCrit): a crit bonus with a condition on the target (the Earth orb on
    // Rooted foes) is added at the roll, for weapon blows and spells (effects.js critBonus).
    if (e.if && e.verb === 'modify-stat' && e.stat === 'crit') { fx.critIf.push({ add: num(e.add), if: e.if, from: r.from }); continue; }
    // E30: a damage-mod keeps its condition (Searing on Burning foes, Blight on Poisoned attackers); damage.js tests it.
    if (e.if && !('combo' in e.if) && e.verb !== 'damage-mod') { fx.unbuilt.push(r.from + ':' + e.verb + ':if'); continue; }
    switch (e.verb) {
      case 'modify-stat': fx.mods.push({ stat: e.stat, add: num(e.add), pct: num(e.pct) }); break;
      case 'resist': if (e.immune) fx.immuneDamage.push(e.type); else fx.mods.push({ stat: 'resist:' + e.type, add: num(e.add), pct: 0 }); break;   // rank 6: immune, not -1000% (item 51)
      case 'grant-immunity': if (!e.turns) fx.immune.push(e.status); break;
      case 'damage-mod': (e.direction === 'taken' ? fx.taken : fx.dealt).push(e); break;
      case 'cost-mod':
        if (e.cost === 'move-time' && e.speedUpPct) fx.moveSpeedPct += num(e.speedUpPct);
        else if (e.cost === 'action-time' && typeof e.mult === 'number') fx.actionTimeMult *= e.mult;
        else if (e.cost === 'cast-time' && typeof e.mult === 'number') fx.castTimeMult *= e.mult;
        else fx.unbuilt.push(r.from + ':cost-mod');
        break;
      case 'shield': if (e.pool === 'ice-armor' && e.cap) fx.iceArmorMax += num(e.cap); else fx.unbuilt.push(r.from + ':shield'); break;
      // E29: Friction and Storm Ambush force crits on the foes their rule names; Numbing Dark makes hits on them surprise.
      case 'crit-rule': if (e.force) fx.critForce.push({ force: e.force, primaryOnly: !!e.primaryOnly, from: r.from }); else fx.unbuilt.push(r.from + ':crit-rule'); break;
      case 'hit-rule': if (e.surprise) fx.surpriseIf.push(e.surprise); else if (!(e.deflectPct ?? e.ignoreEvasionPct ?? e.blockPct ?? e.mult) && e.parryPct === undefined) fx.unbuilt.push(r.from + ':hit-rule'); break;
      default: fx.unbuilt.push(r.from + ':' + e.verb);
    }
  }
  return fx;
}

/**
 * G16 (statuses.json while on-event): the triggers the body's statuses hold now (Thorns, Molten Ring, Iron Body's stun).
 * Frozen's thaw on damage is damage.js's own (its rows are marked own).
 */
function statusTriggers(p) {
  const out = [];
  for (const id of Object.keys(p.statuses ?? {})) for (const w of whileOf(id, 'on-event')) out.push({ ...w, from: `status-${id}` });
  return out;
}

/**
 * Fires the hero's triggers of one kind. info: {target, packet: {raw, dealt, blocked, type, tags}, hit: {crit, surprise,
 * melee, ranged, spell, single, primary}, weapon (the worn slot that swung, for weapon enchants), victim (on-kill)}.
 */
export function heroEvent(state, trigger, info, events) {
  const p = state.actors[state.playerId];
  pietyOn(state, trigger, events, info);   // CF08: the god's piety for this kind of hit (Sylla's surprise hits)
  // G16: the hero's statuses' own triggers ride beside the compiled ones while they last (Thorns, Molten Ring).
  const list = p ? [...(p.fx?.triggers ?? []), ...statusTriggers(p)] : null;
  if (!list?.length || (p.hp <= 0 && trigger !== 'on-lethal')) return;
  fireTriggers(state, p, list, trigger, info, events);
}

/**
 * CB49 (1.7 shadow-clone.js weaponHit): the hero's echo carries his hit and crit riders (enchants, element points,
 * combos) and its own buffs' (Molten Ring); they fire for its blows with the echo as their owner.
 */
export function echoEvent(state, a, trigger, info, events) {
  if (!a?.echo || a.hp <= 0) return;
  const list = [...(a.fx?.triggers ?? []), ...statusTriggers(a)];
  if (list.length) fireTriggers(state, a, list, trigger, info, events);
}

function fireTriggers(state, p, list, trigger, info, events) {
  for (const t of list) {
    if (t.trigger !== trigger) continue;
    if (t.weapon && info.weapon !== t.weapon) continue;   // a weapon's enchant rides its own swings only
    if (info.weaponOnly && !t.weapon) continue;   // E34: a spell carrying the weapon's enchant fires that enchant alone
    const target = info.target ?? info.victim ?? p;
    if (t.filters?.victimStatus && !info.victim?.statuses?.[t.filters.victimStatus]) continue;
    if (t.filters?.by === 'spell' && !(info.packet?.tags ?? []).includes('spell')) continue;
    if (t.filters?.applied && info.applied?.status !== t.filters.applied) continue;   // E24: on-status-applied names its status
    if (t.filters?.natural === false && info.natural) continue;   // E11: natural healing (holy ground's pulse) does not stanch a bleed
    // attacker: the body that struck or attacked the hero (on-damaged, on-attacked), named by a 'source' selector.
    const c = { state, owner: p, target, source: p, attacker: info.attacker ?? null, events, packet: info.packet ?? null, hit: info.hit ?? null, victim: info.victim ?? null, tags: info.packet?.tags ?? [], rank: state.hero?.faith?.rank ?? 0, craft: info.craft ?? null, applied: info.applied ?? null, status: info.status ?? null };
    if (t.if && !holds(t.if, c)) continue;
    // oncePer (Warrior's Discipline once an action, Last Laugh once a floor): kept on the body, so saves carry it.
    const once = t.oncePer && `${t.from}:${t.trigger}`, at = t.oncePer === 'floor' ? `${state.floorNo}:${state.floor?.plane ?? state.where ?? ''}` : state.actions;
    if (once && (p.once ??= {})[once] === at) continue;
    if (t.chance !== undefined && !heroRoll(state, p, (amount(t.chance, c) + (p.luck ?? 0)) / 100, events)) continue;   // CB05: procs roll with Lady Luck; RB47 Lucky Streak
    if (once) p.once[once] = at;
    const from = events.length;
    for (const e of t.effects ?? []) runEffect(info.weaponOnly && info.hit?.spell && e.verb === 'weapon-attack' ? spellRepeat(e, info) : e, c);
    // E48 (1.7 death-adapter.js:119, :144): what a trigger put on a body or dealt says whose it was (Wildfire, Smoke), for the log.
    for (let k = from; k < events.length; k++) { const v = events[k]; if ((v.type === 'status' && v.change === 'applied') || v.type === 'damaged') v.rider ??= t.from; }
    // E27 (1.7 damage-adapter.js:250-263 Coward's Mark): a row with logApplied names what took on the foe: "Rat: Afraid, Rooted."
    if (t.logApplied) {
      const took = events.slice(from).filter(v => v.type === 'status' && v.change === 'applied' && v.id !== p.id);
      const body = took.length ? state.actors[took[0].id] : null, names = took.filter(v => v.id === body?.id).map(v => statuses.rows[v.status]?.name ?? v.status);
      if (body && names.length) events.push({ type: 'log', words: `${body.name ?? 'Attacker'}: ${names.join(', ')}.`, cls: t.logApplied });
    }
    // EQ16 (1.7 shieldench.js:24, :27, :32, :40): a row with log says its line once it fired; {dealt} is what it dealt foes.
    if (t.log) {
      const dealt = events.slice(from).filter(v => v.type === 'damaged' && v.id !== p.id).reduce((n, v) => n + (v.amount ?? 0), 0);
      events.push({ type: 'log', words: t.log.replace('{dealt}', String(dealt)), cls: t.logCls ?? 'c-good' });
    }
  }
}
/** E34 (1.7 spellench.js:25-28): the Air enchant's second blow, on a spell, is the spell's raw damage again, of its type. */
const spellRepeat = (e, info) => ({ verb: 'damage-from-packet', packet: 'raw', ratio: 1, type: info.packet?.type ?? 'magic', chance: e.chance, tags: ['gust', 'enchant'] });

/**
 * E24 (1.7 effect-adapter.js onApplied, onChill): a status the hero put on a foe fires 'on-status-applied' with what
 * took (Venom, Petrify, Purging Flame, Radiant Roots) and the hit behind it (Chill Arc). What those riders put on in
 * turn does not fire it again, as 1.7 applied them past its hook.
 */
let landing = 0;
hook('statusLanded', (state, bearer, id, info, events) => {
  if (landing) return;
  landing += 1;
  try {
    const cause = info.cause ?? {};
    heroEvent(state, 'on-status-applied', { target: bearer, packet: cause.packet ?? null, hit: cause.hit ?? null, applied: { status: id, previous: info.previous, turns: info.turns }, status: { turns: Math.max(1, info.turns) } }, events);
  } finally { landing -= 1; }
});

/**
 * E23 (1.7 elements.js:149-152 turnElementAfterAction): each action out of a fight (no hunting foe in sight) and not
 * loud adds to the calm count; at the Fade row's count (16 - 2 a Shadow point, at least 4) the hero slips into hiding
 * for 2 game turns, unless already hidden longer.
 */
registerPhase('element-after-action', (state, ctx, events) => {
  const p = state.actors[state.playerId], f = state.floor;
  if (!p || p.hp <= 0 || !f) return;
  const me = state.playerId, mine = events.filter(e => e.id === me);
  const loud = mine.some(e => e.type === 'attacked' || e.type === 'swung' || (e.type === 'ability' && e.kind === 'spell'));
  const fighting = state.order.some(id => { const a = state.actors[id]; return a.hp > 0 && a.side === 'foe' && a.hunting && !!state.vis?.[a.y * f.w + a.x]; });
  p.calm = fighting || loud ? 0 : (p.calm ?? 0) + 1;
  for (const t of p.fx?.triggers ?? []) {
    if (t.trigger !== 'on-quiet' || p.calm < amount(t.n ?? 0, { state, owner: p })) continue;
    if ((p.statuses.hidden?.n ?? 0) > 1) continue;
    for (const e of t.effects ?? []) runEffect(e, { state, owner: p, target: p, source: p, events });
  }
});

/** E35 (1.7 infusions.js:28-32 turnClearTomeWard): the tome's ward is lost once a Light tome is no longer in the off hand. */
registerPhase('tome-ward', state => {
  const p = state.actors[state.playerId], off = state.hero?.worn?.off;
  if (p?.tomeWard > 0 && !(off && enchantSlot('off', off) === 'tome' && off.enchant === 'light')) p.tomeWard = 0;
});

/** E26 (1.7 combos.js:583-590 turnComboAfterAction): the hero's 'on-action' rows after each action (Permafrost). */
registerPhase('combo-after-action', (state, ctx, events) => {
  const p = state.actors[state.playerId];
  if (p?.hp > 0) heroEvent(state, 'on-action', { target: p }, events);
});
provide('heroEvent', heroEvent);   // C17: what the rules below this module call up to it (set-pieces.js UP)
