// Loot (spec/items.md I3-I5, I54, I59, I64-I69): loot tables, random gear, food, and what lies on the floor.
// A drop is one floor item: {kind:'essence', n} | {kind:'mote', el} | {kind:'food', id} | a gear item (makeItem).
// Tables are loot.json rows; every number comes from loot.json, tiers.json, foods.json and upgrades.json.

import rings from '../../data/rings.json' with { type: 'json' };
import amulets from '../../data/amulets.json' with { type: 'json' };
import sigils from '../../data/sigils.json' with { type: 'json' };
import loot from '../../data/loot.json' with { type: 'json' };
import tiers from '../../data/tiers.json' with { type: 'json' };
import foods from '../../data/foods.json' with { type: 'json' };
import upgrades from '../../data/upgrades.json' with { type: 'json' };
import { amount } from './amount.js';
import { makeItem, itemRow } from './items.js';
import { next, roll, stream } from '../lib/rng.js';

const L = loot.rows, TI = tiers.rows;
export const ELEMENTS = ['fire', 'water', 'air', 'earth', 'light', 'shadow'];
const biomeIndex = floorNo => Math.min(4, Math.floor((floorNo - 1) / 5));
/** The core this floor's boss drops and its gate answers to (1.7 cores.js CORE_NAMES, coreName). */
export const coreName = floorNo => ['Dungeon Core', 'Crypt Core', 'Cavern Core', 'Ruin Core', 'Abyss Core'][biomeIndex(floorNo)];

const weighted = (rng, picks) => {
  let w = next(rng) * picks.reduce((s, p) => s + p.weight, 0);
  for (const p of picks) { w -= p.weight; if (w < 0) return p; }
  return picks[picks.length - 1];
};

/** I3: quality by biome; one draw. */
function quality(rng, floorNo) {
  const b = TI['quality-by-biome'].biomes.find(r => floorNo >= r.floors[0] && floorNo <= r.floors[1]) ?? TI['quality-by-biome'].biomes.at(-1);
  const d = next(rng) * 100;
  return d < b.plainPct ? 1 : d < b.plainPct + b.finePct ? 2 : 3;
}

/** I5: from 0 (or the minimum), each 1-in-3 draw adds 1 up to 3, stopping at the first failure. */
function plusRoll(rng, from = 0) {
  const E = TI['enhancement-roll'];
  let p = from;
  while (p < E.max && next(rng) < E.stepPct / 100) p++;
  return p;
}

/**
 * I64, rule random-gear: cursed on a 15% draw (plus -1 to -3, no enchant), else a plus roll and an enchant chance on
 * weapons and armour; quality by biome; unidentified. A Masterwork the hero already found rerolls the kind once (I65).
 */
export function randomGear(state, floorNo, o = {}) {
  const rng = state.rng, C = TI.curses;
  const cursed = !o.uncursed && next(rng) < C.foundCursedPct / 100;
  // o.kinds (loot.json floor-guaranteed): the normal roll, drawn again until it is one of these kinds.
  const candidate = () => {
    for (let t = 0; t < 500; t++) {
      const id = (next(rng) < 0.3 ? tableGive(state, 'gear-armour') : tableGive(state, 'gear-pools')).item;
      if (!o.kinds || o.kinds.includes(itemRow(id).kind)) return id;
    }
    throw new Error('no gear of kind ' + o.kinds);
  };
  let id = o.item ?? candidate();
  const tier = Math.max(o.tierAtLeast ?? 0, o.tier ?? quality(rng, floorNo));
  if (tier === 3 && !o.item) {
    const had = state.masterworks ?? {}, wanted = id === 'dagger' || id === 'censer' ? 2 : 1;   // G27: the Ceremonial Knife's id is censer
    if ((had[id] ?? 0) >= wanted) id = candidate();
  }
  const item = makeItem(id, tier, cursed ? -roll(rng, -C.plusRoll[1], -C.plusRoll[0]) : plusRoll(rng, o.plusAtLeast ?? 0));
  item.known = !!o.identified;
  if (cursed) item.cursed = true;
  const kind = itemRow(id).kind, E = TI['drop-enchant'];
  if (!cursed && (kind === 'weapon' || kind === 'armour') && next(rng) < (E.basePct + E.perFloorPct * floorNo) / 100) item.enchant = ELEMENTS[Math.floor(next(rng) * ELEMENTS.length)];
  return item;
}

/** I59: a Ration, or on a 20% draw a special from the general pool plus this biome's own. */
function randomFood(state, floorNo) {
  const special = next(state.rng) < foods.rows['special-chance'].specialPct / 100;
  return special ? specialFood(state, biomeIndex(floorNo) + 1) : 'ration';
}
/** A special food of any biome's or of `biome`'s own (1-based), as loot's { food: 'random-special', biome } asks. */
function specialFood(state, biome) {
  const pool = Object.entries(foods.rows).filter(([, r]) => r.kind === 'food' && r.special && (!r.biome || r.biome === biome)).map(([id]) => id);
  return pool[Math.floor(next(state.rng) * pool.length)];
}

/** I42: each ring and amulet kind wears a look shuffled once per run (side stream seed ^ 0x5eed77); art item-<kind>-<look>. */
export function trinketLook(state, kind, id) {
  const run = (state.run ??= {}), key = kind + 'Looks';
  if (!run[key]) {
    const rows = kind === 'ring' ? rings.rows : amulets.rows, looks = rows.looks.looks.slice(), rng = stream(((state.seed ?? 0) ^ 0x5eed77) >>> 0);
    for (let i = looks.length - 1; i > 0; i--) { const j = Math.floor(next(rng) * (i + 1)); [looks[i], looks[j]] = [looks[j], looks[i]]; }
    const ids = Object.keys(rows).filter(k => rows[k].kind !== 'rule');
    run[key] = Object.fromEntries(ids.map((k, i) => [k, looks[i % looks.length]]));
  }
  return run[key][id] ?? null;
}

/** One `give` from a table, resolved to drops (see the closed list in spec/items.md "Loot entries"). */
export function giveOf(state, g, floorNo) {
  const ctx = { state };
  if (g.keepPct !== undefined && !(next(state.rng) < g.keepPct / 100)) return [];   // a pick that gives nothing the rest of the time
  if ('essence' in g) {
    let n = amount(g.essence, ctx);
    if (g.mult) n = (g.round === 'up' ? Math.ceil : Math.round)(n * g.mult);   // item 287: a gold chest's x1.25, rounded up (1.7 systems.js:700)
    return [{ kind: 'essence', n: Math.round(n) }];
  }
  // The biome boss's core (packet D): carried to the exit gate (W51).
  if ('core' in g) return [{ kind: 'core', name: coreName(floorNo) }];
  if ('mote' in g) return [{ kind: 'mote', el: g.mote === 'random' ? ELEMENTS[Math.floor(next(state.rng) * ELEMENTS.length)] : g.mote }];
  if ('food' in g) return [{ ...makeItem(g.food === 'random' ? randomFood(state, floorNo) : g.food === 'random-special' ? specialFood(state, g.biome ?? biomeIndex(floorNo) + 1) : g.food), count: 1 }];
  if ('item' in g) return [makeItem(g.item, 1)];
  if ('table' in g) return rollTable(state, g.table, floorNo);
  if ('gear' in g) {
    // Item 287 (Justin 2026-10-14 loot pass; 1.7 tiers.js:77-82 bumpEnhancement): a special reward (enhanced chest, puzzle
    // room, crystal vault, plane chest) raises the plus by one, at most 3, a cursed piece untouched (tiers.json special-reward-bump).
    const it = randomGear(state, floorNo, g), B = TI['special-reward-bump'];
    if (g.plusBump && !(it.cursed && B.skipCursed)) it.plus = Math.min(B.max, it.plus + B.plus);
    return [it];
  }
  // D46: a sigil, by the sigil-drop table or from a named group.
  if ('sigil' in g && (g.sigil === 'random' || String(g.sigil).startsWith('group:'))) {
    if (g.sigil === 'random') return rollTable(state, 'sigil-drop', floorNo);
    const pool = (sigils.rows.groups[g.sigil.slice(6)] ?? []).filter(id => !(g.except ?? []).includes(id));
    return pool.length ? [{ kind: 'sigil', id: pool[Math.floor(next(state.rng) * pool.length)], count: 1 }] : [];
  }
  // I41-I47: a ring or amulet (rings.json / amulets.json make rules): unidentified; a ring is +1 on 30%, else +0;
  // found cursed at curses.foundCursedPct unless the give says cursedPct (a cursed ring is -1 to -3); an amulet starts
  // at level 1 with one charge and prefers a kind not yet seen this run.
  if ('ring' in g || 'amulet' in g) {
    const ring = 'ring' in g, rows = ring ? rings.rows : amulets.rows, make = rows.make;
    const ids = Object.keys(rows).filter(k => rows[k].kind !== 'rule');
    const seen = (state.run ??= {}).seenTrinkets ??= [];
    let pool = ids;
    if (!ring && make.preferUnseen) { const fresh = ids.filter(k => !seen.includes(k)); if (fresh.length) pool = fresh; }
    const id = g.ring && g.ring !== 'random' ? g.ring : g.amulet && g.amulet !== 'random' ? g.amulet : pool[Math.floor(next(state.rng) * pool.length)];
    if (!seen.includes(id)) seen.push(id);
    const cursed = next(state.rng) < (g.cursedPct ?? TI.curses.foundCursedPct) / 100;
    let plus = ring ? (next(state.rng) < make.plusOnePct / 100 ? 1 : 0) : (make.plus ?? 0);
    if (g.plusAtLeast !== undefined) plus = Math.max(plus, g.plusAtLeast);
    if (cursed) { const [lo, hi] = make.cursedPlusRoll ?? TI.curses.plusRoll; plus = roll(state.rng, lo, hi); }
    const item = makeItem(id, 0, plus);
    item.known = false;
    item.look = trinketLook(state, ring ? 'ring' : 'amulet', id);
    if (cursed) item.cursed = true;
    if (!ring) { item.level = make.level ?? 1; item.charges = amulets.rows.charges.startCharges ?? 1; }
    return [item];
  }
  // The library's sigils are not built yet: recorded, never silently dropped.
  const key = 'loot:' + Object.keys(g)[0];
  state.unbuilt[key] = (state.unbuilt[key] ?? 0) + 1;
  return [];
}

/** A table row's single weighted pick, as the `give` it names (for the gear pools). */
function tableGive(state, id) {
  let g = weighted(state.rng, L[id].picks).give;
  while ('table' in g) g = weighted(state.rng, L[g.table].picks).give;
  return g;
}

/** Rolls a loot.json table: its fixed `gives` (each with its chance), then `rolls` weighted `picks` (a gold chest has both). */
export function rollTable(state, id, floorNo) {
  const t = L[id];
  if (!t) throw new Error('unknown loot table ' + id);
  const out = [];
  if (t.gives) {
    for (const g of t.gives) {
      if (g.floors && (floorNo < g.floors[0] || floorNo > g.floors[1])) continue;
      if (g.chancePct !== undefined && !(next(state.rng) < g.chancePct / 100)) continue;
      out.push(...giveOf(state, g, floorNo));
    }
  }
  if (t.every) for (let i = 0; i < t.rolls; i++) out.push(...giveOf(state, t.every, floorNo));   // a rule table: each roll gives this
  else if (t.picks?.length) for (let i = 0; i < (t.rolls ?? 1); i++) out.push(...giveOf(state, weighted(state.rng, t.picks).give, floorNo));
  return out;
}

/** Essence on the floor is worth the biome multiplier when stepped on (upgrades.json essence-biome-mult). */
export const essenceMult = floorNo => upgrades.rows['essence-biome-mult'].byBiome[biomeIndex(floorNo)];
