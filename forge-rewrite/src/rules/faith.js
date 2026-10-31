// Faith (spec/faith.md F1-F21, F60): piety and favor awards, ranks and boons, the shrine (swear, pray, tithe), the
// descent award and kill awards, and a betrayed god's wrath. Prayers themselves (the Faith tab's abilities) wait for
// packet D's casting rules. Data: gods.json, piety.json.

import gods from '../../data/gods.json' with { type: 'json' }; import piety from '../../data/piety.json' with { type: 'json' };
import { amount } from './amount.js';
import { applyStatus, heroChangedNow } from './statuses.js';
import { grantSpells, elementOrder } from './magic.js';
import { UP, provide } from './set-pieces.js'; const runEffect = (...a) => UP.runEffect(...a);   // C17: the one verb path (set-pieces.js UP, from effects.js)
import { graveStrength } from './god-powers.js';
import { heal } from './damage.js';
import { conditionHolds } from './effects/conditions.js';
import { next } from '../lib/rng.js';
import { godRefuses } from './god-refusal.js';
import { stowForbidden, classRow } from './hero.js';
import { ownStat } from './own-stats.js';
import { itemRow } from './items.js';
import { walkable } from '../data/tiles.js';
import { refreshSight } from './sight.js';
import { floorRosterKind } from './spawns.js';
import { nearFree } from './space.js';
import sigilData from '../../data/sigils.json' with { type: 'json' };
import STATUSES from '../../data/statuses.json' with { type: 'json' };
import tuning from '../../data/tuning.json' with { type: 'json' };
import strings from '../../data/strings.json' with { type: 'json' };
import prayers from '../../data/prayers.json' with { type: 'json' };
import { boonWords } from '../lib/fill.js';

const P = piety.rows, G = gods.rows;
const SIGILS = sigilData.rows, TURN = tuning.rows.clock.unitsPerGameTurn;
const plain = s => s.replace(/<\/?b>/g, '');
const biomeIndex = f => Math.min(4, Math.floor((f - 1) / 5));
const godName = id => G[id].name.split(',')[0];

/**
 * CD19 (1.7 progression-adapter.js:80-88): a rank's lines say what came with it: 'Boon: Iron Flesh: +2 armor, ...'
 * and 'New ability: Iron Hide. Gain armor and a shield for 12 turns. Instant. Find it in the Faith tab (P).' A boon says
 * what it gives at the rank it comes at (item 315; lib/fill.js boonWords, as the windows say it).
 */
const boonLine = b => { const said = boonWords(b.id, b.rank); return P.ranks.boonLog.replace('{boon}', said ? `${b.name}: ${said}` : b.name); };
const prayerLine = id => plain(P.ranks.prayerLog.replace('{prayer}', prayers.rows[id]?.name ?? id).replace('{text}', strings.rows['prayer.' + id] ?? '')).replace(/\s+/g, ' ');

/** F3: devotion: x (1 + the piety-gain rows (Human 25%, Cleric 25%) + 25% the god's loved race), the parts added. */
export function devotion(h) {
  const D = P.devotion, loved = G[h.faith.god]?.loves;   // item 288: gods.json names it loves (Murk's Gloomlings, Vellum's Elves)
  return 1 + (ownStat(h, 'piety-gain').pct + (loved && loved === h.race ? D.lovedRacePct : 0)) / 100;   // item 323: the passive rows the cards show
}

/**
 * F4 (1.7 progression.js depthMultiplier): what earned piety is worth on this floor: x1.3 per biome below the first,
 * x2 more in biome 3 and x4 in biome 4 (not on a plane, which keeps its parent's depth but is not the Realm of Chaos).
 */
export function pietyDepth(state) {
  const bi = biomeIndex(state.floorNo ?? 1), late = bi === 4 && state.floor?.plane && P.depth.lateBiome4NotOnPlanes ? 1 : P.depth.lateBiomeMult[bi] ?? 1;
  return P.depth.perBiomeMult ** bi * late;
}

/**
 * F3-F6: an award of `n`. Piety: x devotion x 1.3 per biome below the first (x2 more in biome 3, x4 in 4). Favor:
 * x devotion x divine, capped at 100 (none for a piety-only award). Rank-ups are announced.
 */
export function award(state, n, events, { pietyOnly = false, favor = n } = {}) {
  const h = state.hero;
  if (!h.faith?.god || n <= 0) return;
  const f = h.faith, dev = devotion(h), rankBefore = f.rank;
  const depth = pietyDepth(state);
  f.piety += n * dev * depth;
  if (!pietyOnly) f.favor = Math.min(P.favor.cap, f.favor + favor * dev * (state.actors[state.playerId].divine ?? 1));
  const R = P.ranks;
  while (f.rank < R.maxRank && f.piety >= R.thresholds[f.rank]) {
    f.rank += 1;
    events.push({ type: 'log', words: plain(R.rankUpLog.replace('{god}', godName(f.god)).replace('{rank}', f.rank)), sfx: R.rankUpSfx }, { type: 'piety-rank', god: f.god, rank: f.rank });
    const boon = (G[f.god].boons ?? []).find(b => b.rank === f.rank);
    if (boon) events.push({ type: 'log', words: boonLine(boon) });
    // F2, F6: prayers at ranks 2 and 4 join the hotbar's first free slot (ruled 2026-10-14).
    const prayer = (G[f.god].prayers ?? [])[f.rank === 2 ? 0 : f.rank === 4 ? 1 : -1];
    if (prayer) {
      events.push({ type: 'log', words: prayerLine(prayer) });
      const free = h.hotbar.findIndex(s => !s);
      if (free >= 0 && !h.hotbar.some(s => s?.id === prayer)) h.hotbar[free] = { kind: 'prayer', id: prayer };
    }
    events.push({ type: 'hero', change: 'rank' });
    graveStrength(state);   // CF09: Grave Strength's summons grow with the rank
  }
  if (f.rank !== rankBefore) { syncKindled(state, events); heroChangedNow(state); }   // CD2: the new boons hold at once
}

/**
 * CD2 Kindled (1.7 religion.js:29-78): Saint Glimmer's rank 5 gives a point of Light outside the affinity cap, when the
 * hero has room for Light (it is held already, or one element is held and it is not Shadow); she takes it back when
 * the hero leaves her. Said once when there is no room.
 */
export function syncKindled(state, events) {
  const h = state.hero, want = (h.faith?.rank ?? 0) >= (G[h.faith?.god]?.kindledAtRank ?? Infinity), aff = h.affinity ??= {};
  if (want && !h.kindled) {
    const held = Object.keys(aff).filter(k => aff[k] > 0);
    if (!held.includes('light') && (held.includes('shadow') || held.length >= 2)) {
      if (!h.kindledNoRoomTold) { h.kindledNoRoomTold = true; events.push({ type: 'log', words: 'Saint Glimmer would kindle Light in you, but there is no room left for it.' }); }
      return;
    }
    h.kindled = true;
    aff.light = (aff.light ?? 0) + 1;
    h.elementOrder = elementOrder(h);
    events.push({ type: 'log', words: 'Saint Glimmer kindles a point of Light in you.' }, { type: 'hero', change: 'kindled' });
    grantSpells(state, events);
  } else if (!want && h.kindled) {
    h.kindled = false;
    aff.light = Math.max(0, (aff.light ?? 0) - 1);
    if (!aff.light) delete aff.light;
    events.push({ type: 'log', words: 'Saint Glimmer takes back the light she gave you.' }, { type: 'hero', change: 'kindled' });
  }
}

/** F12, F14: the shrine as it stands for this hero: whose it is, what can be done. */
export function shrineState(state) {
  const s = state.floor.shrine, h = state.hero;
  if (!s) return null;
  const own = h.faith?.god === s.god, prayed = state.floor.shrinePrayed === state.floorNo, tithed = state.floor.shrineTithed === state.floorNo;
  return { god: s.god, own, prayed, tithed, canSwear: !own && !godRefuses(s.god, h), canTithe: !own && !tithed && h.essence >= P.shrine.titheEssence };
}

const atShrine = state => { const s = state.floor.shrine, p = state.actors[state.playerId]; return !!s && Math.max(Math.abs(s.x - p.x), Math.abs(s.y - p.y)) <= 1; };

/** F10: swearing to the shrine's god, when the hero stands at it and the god takes them. */
export function swear(state, events) {
  const h = state.hero, s = state.floor.shrine;
  if (!atShrine(state)) return 'not-at-shrine';
  if (classRow(h)?.godBound && h.faith?.god) return 'cleric-bound';
  if (godRefuses(s.god, h)) return 'refused';
  return h.faith?.god === s.god ? 'already' : pledge(state, s.god, events);
}

/** F11: the vows (the shrine's swear; the sandbox, item 180): piety 20, favor 10, rank 1; leaving another god brings its wrath. */
export function pledge(state, god, events) {
  const h = state.hero, old = h.faith?.god, start = P.shrine.swearStartPiety;
  if (old && old !== god) { h.wrath = { god: old, turns: P.wrath.turns }; events.push({ type: 'log', words: plain(P.conversion.abandonLog.replace('{old}', godName(old))), sfx: 'wrath' }); }
  h.faith = { god, rank: 1, piety: start, favor: Math.round(start * P.favor.onJoiningPctOfStartPiety / 100), amusement: P.conversion.amusementOnJoining, cooldowns: {} };
  events.push({ type: 'log', words: `You swear yourself to ${godName(god)}.`, sfx: 'shrine-convert' }, { type: 'hero', change: 'swear' });
  syncKindled(state, events);   // leaving Saint Glimmer takes her Light back
  // CF15 (1.7 gods.js enforceDivineEquipment): what the new god forbids comes off into the bag.
  const stowed = stowForbidden(h);
  for (const it of stowed) events.push({ type: 'log', words: `${G[god].name} will not allow your ${itemRow(it.id).row.name ?? it.id}. You stow it.` });
  if (stowed.length) events.push({ type: 'hero', change: 'unequip' });
  const boon = (G[god].boons ?? []).find(b => b.rank === 1);
  if (boon) events.push({ type: 'log', words: boonLine(boon) });
  return null;
}

/** F13: at one's own god's shrine, once a floor: favor to 100 and an award of 25 (Cleric) or 10. */
export function prayAtShrine(state, events) {
  const h = state.hero, st = shrineState(state);
  if (!atShrine(state) || !st?.own) return 'not-your-shrine';
  if (st.prayed) return 'already-prayed';
  state.floor.shrinePrayed = state.floorNo;
  h.faith.favor = P.favor.onShrinePrayer;
  events.push({ type: 'log', words: P.shrine.prayLog, sfx: 'shrine-convert' });   // CF55 (1.7 gods.js:212); the tithe keeps 'pray'
  award(state, classRow(h)?.godBound ? P.shrine.prayPiety.cleric : P.shrine.prayPiety.other, events, { favor: 0 });
  return null;
}

/** F13: at another god's shrine, once a floor: 20 essence for Rally 250 and the shrine's blessing. */
export function tithe(state, events) {
  const h = state.hero, p = state.actors[state.playerId], st = shrineState(state);
  if (!atShrine(state) || !st || st.own) return 'not-here';
  if (st.tithed) return 'already-tithed';
  if (h.essence < P.shrine.titheEssence) return 'no-essence';
  h.essence -= P.shrine.titheEssence;
  state.floor.shrineTithed = state.floorNo;
  for (const e of P.shrine.titheEffects) applyStatus(state, p, e.status, { turns: e.turns, source: p.id }, events);
  h.blessed = P.shrine.blessedTurns;
  events.push({ type: 'log', words: P.shrine.titheLog, sfx: 'pray' }, { type: 'essence-spent', amount: P.shrine.titheEssence });
  return null;
}

/** F7: every god gives 5 + the new floor's number on each descent (to a floor never seen before). */
export function descentAward(state, events) {
  if (!state.hero.faith?.god) return;
  const n = amount(P['floor-descent'].effects[0].amount, { state });
  award(state, n, events);
}

/**
 * F8, G34 (1.7 progression.js killReward, progression-adapter.js godOnKill): kill awards from the god's own list.
 * kill-side 'self' is the hero's own blow; 'player' the hero's or an ally's (1.7 playerKill || allyKill); 'own-summon'
 * the hero's Raise Dead servant (1.7 undeadServant). hit-was 'spell' is a kill by the hero's own spell, not its burn
 * or poison afterwards (1.7 cause.kind 'spell', periodic distinct). has-status: the victim was held: the status, or
 * one carrying that tag (1.7 effectHasTag root / slow: Chill and Frozen slow too).
 */
export function killAward(state, victim, by, events, tags = []) {
  const h = state.hero;
  if (!h?.faith?.god || victim.noXp || victim.noReward) return;
  const p = state.actors[state.playerId];
  // C8 (engine-rules-10): the one interpreter, with the victim as target, the killer as by, statuses by tag (Sylla's
  // kills of the webbed, rooted, slowed or poisoned) and the killing blow a spell of the hero's own.
  const ctx = { state, owner: p, target: victim, by, byTag: true, events, hit: { spell: by?.id === p.id && tags.includes('spell') && !tags.includes('periodic') } };
  const holds = c => conditionHolds(c, ctx);
  for (const e of G[h.faith.god].piety ?? []) if (e.trigger === 'on-kill' && (!e.if || holds(e.if))) awardRow(state, e, holds, events);
}

/** A piety row's effects that hold, as one award of piety and favor (killAward, pietyOn). */
function awardRow(state, e, holds, events) {
  let pp = 0, fv = 0;
  for (const g of e.effects) { if (g.if && !holds(g.if)) continue; if (g.resource === 'piety') pp += g.amount; if (g.resource === 'favor') fv += g.amount; }
  if (pp || fv) award(state, pp, events, { favor: fv });
}

/**
 * CF08 (1.7 sylla.js syllaHitReactions :105): the god's piety list on a hero event other than a kill, a spend or a
 * craft: Sylla's 1 piety and favor for a surprise hit, 2 when the hero struck it from hiding.
 */
export function pietyOn(state, trigger, events, info = {}) {
  const h = state.hero, list = h?.faith?.god ? G[h.faith.god].piety : null;
  if (!list || ['on-kill', 'on-spend', 'on-craft', 'on-pay-mana'].includes(trigger)) return;   // on-pay-mana: manaPiety
  const p = state.actors[state.playerId];
  // C8: the one interpreter; its target the body struck (item 288: Grom's unarmed hit on a foe), and the hit (from hiding).
  const holds = c => conditionHolds(c, { state, owner: p, target: info.target ?? p, hit: info.hit, events });
  for (const e of list) if (e.trigger === trigger && (!e.if || holds(e.if))) awardRow(state, e, holds, events);
}

/**
 * G45 (1.7 costs-adapter.js:43-47 vellumManaPiety): a god with an on-pay-mana row (Vellum) gives a point of piety and
 * favor for every 20 mana paid for spells and invokes, the remainder carried to the next cast.
 */
export function manaPiety(state, cost, events) {
  const h = state.hero, g = h?.faith?.god && G[h.faith.god];
  if (!(cost > 0) || !g?.piety?.some(e => e.trigger === 'on-pay-mana')) return;
  const per = g.manaPerPiety ?? 20;
  h.manaSpent = (h.manaSpent ?? 0) + cost;
  const n = Math.floor(h.manaSpent / per);
  h.manaSpent -= n * per;
  if (n > 0) award(state, n, events);
}

/**
 * CF12 (1.7 gods.js spendEssence, forge-adapter.js:26, :61): the god's awards for what one action did, read from its
 * events from `from` on: Old Anvil's point of piety and favor for every 5 essence spent anywhere (essence-spent: the
 * Forge, carving, a tithe, the merchant), 20 for an enchantment and 10 for an upgrade or a cleansing. True when any.
 */
export function actionAwards(state, events, from = 0) {
  const h = state.hero, g = h?.faith?.god && G[h.faith.god];
  if (!g?.piety?.some(e => e.trigger === 'on-spend' || e.trigger === 'on-craft')) return false;
  let any = false;
  for (let i = from, end = events.length; i < end; i++) {
    const ev = events[i];
    if (ev.type === 'essence-spent' && ev.amount > 0 && g.piety.some(e => e.trigger === 'on-spend')) {
      const per = g.essencePerPiety ?? 5;
      h.essenceSpent = (h.essenceSpent ?? 0) + ev.amount;
      const n = Math.floor(h.essenceSpent / per);
      h.essenceSpent -= n * per;
      if (n > 0) { award(state, n, events); any = true; }
    }
    const craft = ev.type === 'enchanted' ? 'enchant' : ev.type === 'hero' && ev.change === 'upgrade' ? 'upgrade' : null;
    if (!craft) continue;
    for (const e of g.piety) {
      if (e.trigger !== 'on-craft' || (e.if && e.if['craft-was'] !== craft)) continue;
      const sum = r => e.effects.filter(x => x.resource === r).reduce((a, x) => a + (typeof x.amount === 'number' ? x.amount : 0), 0);
      const pp = sum('piety'), fv = sum('favor');
      if (pp || fv) { award(state, pp, events, { favor: fv }); any = true; }
    }
  }
  return any;
}

const WA = P['wobbles-amusement'];
const cheb = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
const turnOf = state => Math.floor((state.now ?? 0) / TURN);

/** CF17 (1.7 gods.js combatAmusement): a blow the hero lands on a foe, or takes from one, amuses Wobbles a point, once a game turn each way. */
export function combatAmusement(state, side) {
  const f = state.hero?.faith;
  if (f?.god !== 'wobbles') return;
  const k = side === 'out' ? 'amusedOut' : 'amusedIn', t = turnOf(state);
  if (f[k] === t) return;
  f[k] = t;
  f.amusement = Math.min(WA.max, (f.amusement ?? WA.start) + (side === 'out' ? WA.gainPerGameTurnDealing : WA.gainPerGameTurnTaking));
}

/** 1.7 wobblesMoodOdds: per game turn, a prank is 1/50 at 10 Amusement and 1/500 at 40; a gift the same from 90 down. */
export function wobblesOdds(mood) {
  const o = WA.odds, m = Math.max(0, Math.min(WA.max, Number(mood) || 0));
  const fall = Math.log((o.peak - o.floor) / (o.tenth - o.floor)) / o.spread;
  return { prank: o.floor + (o.peak - o.floor) * Math.exp((o.prankPivot - m) * fall), reward: o.floor + (o.peak - o.floor) * Math.exp((m - o.rewardPivot) * fall) };
}

/** 1.7 recoveryInCombat: a hunting foe in sight. */
const inCombat = state => state.order.some(id => { const a = state.actors[id]; return a.side === 'foe' && a.hp > 0 && a.hunting && !!state.vis?.[a.y * state.floor.w + a.x]; });

/**
 * CF17 (1.7 gods.js godsWorldAdvance, resolveAmusement, :674-705): each game turn sworn to Wobbles, Amusement drains a
 * point every 10 turns out of combat, then the mood's odds roll: a prank ("Prank!") or, turned by Favorite Toy or
 * rolled outright, a gift ("Gift!"), each with his giggle and a burst of magic, and Amusement goes back to 50.
 */
function wobblesPulse(state, events) {
  const h = state.hero, f = h?.faith, p = state.actors[state.playerId];
  if (f?.god !== 'wobbles' || !p || p.hp <= 0 || state.over) return;
  f.amusement ??= WA.start;
  if (!inCombat(state)) {
    f.amuseDrain = (f.amuseDrain ?? 0) + TURN;
    while (f.amuseDrain >= WA.lossPerUnitsOutOfCombat) { f.amuseDrain -= WA.lossPerUnitsOutOfCombat; f.amusement = Math.max(0, f.amusement - 1); }
  }
  const odds = wobblesOdds(f.amusement), W = P['wobbles-outcome'], roll = next(state.rng);
  const conv = (f.rank ?? 0) >= W.prankToRewardFromRank ? Math.min(W.prankToRewardCapPct, W.prankToRewardPerRankPct * f.rank) / 100 : 0;
  const prank = roll < odds.prank, converted = prank && conv > 0 && next(state.rng) < conv;
  if (converted) events.push({ type: 'log', words: W.favoriteToyLog });
  if (prank && !converted) { f.amusement = WA.resetAfterEvent; amusedFloat(p, WA.prankFloat, events); wobblesPrank(state, events); }
  else if (converted || roll < odds.prank + odds.reward) { f.amusement = WA.resetAfterEvent; amusedFloat(p, WA.giftFloat, events); wobblesGift(state, events); }
}

const amusedFloat = (p, words, events) => events.push({ type: 'float', id: p.id, words, tone: 'magic', sparkle: 24, sfx: 'wobbles-giggle' });

/** 1.7 safeWobbleSpots + wobblesTeleportSpots: reachable free ground, the far end of it (at least 8 tiles, or 65% of the farthest). */
function teleportSpots(state) {
  const f = state.floor, p = state.actors[state.playerId], w = f.w, seen = new Uint8Array(w * f.h), out = [];
  const busy = new Set(state.order.map(id => state.actors[id]).filter(a => a.hp > 0).map(a => a.y * w + a.x));
  const traps = new Set((f.traps ?? []).map(t => t.y * w + t.x));
  const start = p.y * w + p.x, q = [start];
  seen[start] = 1;
  for (let i = 0; i < q.length; i++) {
    const k = q[i], x = k % w, y = (k / w) | 0;
    if (k !== start && !busy.has(k) && !traps.has(k) && !f.burning?.[k]) out.push({ x, y });
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy, n = ny * w + nx;
      if ((dx || dy) && nx >= 0 && ny >= 0 && nx < w && ny < f.h && !seen[n] && walkable(f, nx, ny)) { seen[n] = 1; q.push(n); }
    }
  }
  const far = out.reduce((m, t) => Math.max(m, cheb(p, t)), 0), min = Math.min(far, Math.max(8, Math.ceil(far * 0.65)));
  return out.filter(t => cheb(p, t) >= min);
}

/**
 * 1.7 wobblesPassivePrank: by weight among those possible, he eats a carried food, changes a carried sigil, teleports
 * the hero far, calls a creature of the floor close by (hunting, no loot), or Blinds, Chills or Roots for 6 turns.
 */
function wobblesPrank(state, events) {
  const h = state.hero, p = state.actors[state.playerId], log = words => events.push({ type: 'log', words });
  const foods = h.bag.filter(b => b.kind === 'food' && (b.count ?? 1) > 0), sigils = h.bag.filter(b => b.kind === 'sigil' && (b.count ?? 1) > 0);
  const spots = teleportSpots(state), kind = floorRosterKind(state), room = nearFree(state, p, 3);
  const can = { food: foods.length > 0, sigil: sigils.length > 0, 'teleport-spot': spots.length > 0, 'summon-spot': !!kind && room.length > 0 };
  const pool = WA.pranks.filter(r => !r.needs || can[r.needs]);
  let w = next(state.rng) * pool.reduce((a, r) => a + r.weight, 0);
  const pick = pool.find(r => (w -= r.weight) < 0) ?? pool.at(-1);
  const take = it => { if ((it.count ?? 1) > 1) it.count -= 1; else h.bag.splice(h.bag.indexOf(it), 1); };
  if (pick.needs === 'food') {
    const meal = foods[Math.floor(next(state.rng) * foods.length)];
    take(meal);
    log(`Wobbles eats ${itemRow(meal.id).row.name}.`);
    events.push({ type: 'hero', change: 'bag' });
  } else if (pick.needs === 'sigil') {
    const it = sigils[Math.floor(next(state.rng) * sigils.length)], ids = Object.keys(SIGILS).filter(id => Array.isArray(SIGILS[id].motes));
    const id = ids[Math.floor(next(state.rng) * ids.length)];
    take(it);
    const stack = h.bag.find(b => b.kind === 'sigil' && b.id === id);
    if (stack) stack.count = (stack.count ?? 1) + 1; else h.bag.push({ kind: 'sigil', id, count: 1 });
    log('Wobbles transforms a carried sigil.');
    events.push({ type: 'hero', change: 'bag' });
  } else if (pick.needs === 'teleport-spot') {
    const to = spots[Math.floor(next(state.rng) * spots.length)];
    runEffect({ verb: 'teleport', who: { selector: 'self' }, to: 'target-tile' }, { state, owner: p, target: p, tile: to, events });
    refreshSight(state, events);
    log('Wobbles: teleport.');
  } else if (pick.needs === 'summon-spot') {
    const at = room[Math.floor(next(state.rng) * room.length)], before = state.order.length;
    runEffect({ verb: 'summon', side: 'hostile', creature: kind, count: 1, within: 0, noLoot: true }, { state, owner: p, target: p, tile: at, events });
    const m = before < state.order.length ? state.actors[state.order[before]] : null;
    if (m) { m.summon = false; m.owner = null; log(`Wobbles summons ${m.name}.`); }
  } else {
    const e = pick.effects[0], name = STATUSES.rows[e.status]?.name ?? e.status;
    log(applyStatus(state, p, e.status, { turns: e.turns }, events) ? `Wobbles: ${name} for ${e.turns} turns.` : `Wobbles: ${name} resisted.`);
  }
}

/**
 * 1.7 wobblesPassiveReward: half the HP back (the likelier the more is missing, below 80%), else half the mana, else a
 * gift beside the hero (a sigil, a mote, or 40-80 essence x 1 + the biome's index).
 */
function wobblesGift(state, events) {
  const p = state.actors[state.playerId];
  const chance = (cur, max) => max > 0 && cur < max * WA.rewardHpMpBelowPct / 100 ? Math.max(0, Math.min(1, 1 - cur / max)) : 0;
  const hp = chance(p.hp, p.maxhp), mp = chance(p.mana ?? 0, p.maxmana ?? 0);
  if (hp > 0 && next(state.rng) < hp) {
    const n = heal(state, p, Math.round(p.maxhp * WA.restorePct / 100), events, { raw: true, overheal: false });   // E11: his gift stanches a bleed
    events.push({ type: 'log', words: `Wobbles: +${n} HP.` });
    return;
  }
  if (mp > 0 && next(state.rng) < mp) {
    const n = Math.min(p.maxmana - p.mana, Math.round(p.maxmana * WA.restorePct / 100));
    p.mana += n;
    events.push({ type: 'log', words: `Wobbles: +${n} Mana.` });
    return;
  }
  runEffect({ verb: 'create-item', item: 'wobbles-gift-passive', essenceScale: 1 + biomeIndex(state.floorNo) }, { state, owner: p, target: p, events });
}

/**
 * CD14 (1.7 gods.js:697-702 godsWorldAdvance; gods.json reginald rules): each game turn sworn to Sir Reginald, every
 * foe within 8 tiles of the hero hears him and hunts him from where he stands.
 */
function unsneakyPulse(state, events) {
  const h = state.hero, p = state.actors[state.playerId];
  const rule = h?.faith?.god && (G[h.faith.god].rules ?? []).find(r => r.trigger === 'on-world-pulse');
  const alert = rule?.effects?.find(e => e.verb === 'alert');
  if (!alert || !p || p.hp <= 0) return;
  for (const id of state.order) {
    const a = state.actors[id];
    if (!a || a.side !== 'foe' || a.hp <= 0) continue;
    const n = (a.size ?? 1) - 1, dx = Math.max(a.x - p.x, 0, p.x - (a.x + n)), dy = Math.max(a.y - p.y, 0, p.y - (a.y + n));
    if (Math.max(dx, dy) > alert.radius) continue;
    const woke = a.asleep || !a.hunting;
    a.asleep = false; a.hunting = true; a.caughtOff = -1;
    a.lastSeen = { x: p.x, y: p.y, at: state.now }; a.goal = { x: p.x, y: p.y };
    if (woke) events.push({ type: 'alerted', id: a.id, toward: a.goal });
  }
}

/** F21, F60: a betrayed god's wrath rolls once a game turn for 250 turns; the shrine blessing counts down too. */
export function faithPulse(state, events) {
  const h = state.hero, p = state.actors[state.playerId];
  if (h.blessed > 0 && --h.blessed === 0) events.push({ type: 'log', words: P.shrine.blessingEndLog });
  wobblesPulse(state, events);
  unsneakyPulse(state, events);
  if (!h.wrath) return;
  if (next(state.rng) < P.wrath.chancePct / 100) {
    events.push({ type: 'log', words: plain(P.wrath.log.replace('{god}', godName(h.wrath.god))), sfx: P.wrath.sfx });
    // F21: 8% of max HP as dark damage that cannot kill (damage then set-hp atLeast 1, applied as one step so no
    // death is ever recorded), then one of the chosen statuses.
    for (const e of P.wrath.effects) {
      if (e.verb === 'damage') {
        const n = Math.max(1, Math.round(amount(e.amount, { state, target: p })));
        const dealt = Math.min(n, p.hp - 1);
        if (dealt > 0) { p.hp -= dealt; events.push({ type: 'damaged', id: p.id, by: null, amount: dealt, dtype: e.type, cause: 'wrath' }); }
      } else if (e.verb !== 'set-hp') runEffect(e, { state, owner: p, target: p, source: null, events });
    }
  }
  if (--h.wrath.turns <= 0) { events.push({ type: 'log', words: P.wrath.endLog.replace('{god}', godName(h.wrath.god)) }); h.wrath = null; }
}
provide('combatAmusement', combatAmusement); provide('pietyOn', pietyOn);   // C17: what the rules below this module call up to it (set-pieces.js UP)
