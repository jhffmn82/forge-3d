// What the HUD shows, read from the engine state and the data packets. No Pixi here, so it runs in Node tests.
// The engine's hero record is still growing: each reader falls back to what 1.7 showed and never invents a number.

import planes from '../../../data/planes.json' with { type: 'json' };
import progression from '../../../data/progression.json' with { type: 'json' };
import piety from '../../../data/piety.json' with { type: 'json' };
import gods from '../../../data/gods.json' with { type: 'json' };
import prayers from '../../../data/prayers.json' with { type: 'json' };
import races from '../../../data/races.json' with { type: 'json' };
import courts from '../../../data/courts.json' with { type: 'json' };
import statuses from '../../../data/statuses.json' with { type: 'json' };
import strings from '../../../data/strings.json' with { type: 'json' };
import bosses from '../../../data/bosses.json' with { type: 'json' };
import ui from '../../../data/ui.json' with { type: 'json' };
import { toNum } from '../core/colour.js';
import { shieldPools, amount, AUTO } from '../../engine/reads.js';
import { litAt } from '../../engine/reads.js';

export const SLOTS = 8;
const HUNGER = progression.rows.hunger;
const RANKS = piety.rows.ranks;
const ELEMENTS = ['fire', 'water', 'earth', 'air', 'light', 'shadow'];

/** The portrait body for a hero: race and sex, with the court for a Fae ('fae-air-f'). */
export function bodyKey(hero) {
  const pattern = races.rows[hero?.race]?.sexes?.[hero?.sex];
  if (!pattern) return null;
  return pattern.replace('%court', courts.rows[hero.court]?.look ?? '');
}

/** Full, Hungry or Starving, and how full the meter is (1.7: Hungry under 300, Starving at 0). */
export function hungerView(hunger = HUNGER.start) {
  const word = hunger <= 0 ? 'Starving' : hunger < HUNGER.hungryWarningAt ? 'Hungry' : 'Full';
  return { word, frac: Math.max(0, Math.min(1, hunger / HUNGER.max)), now: Math.round(hunger), max: HUNGER.max };
}

/** XP into this level, and the step to the next (null at the cap). */
export function xpView(hero) {
  const c = progression.rows['xp-curve'], level = hero?.level ?? 1;
  const next = level >= c.levelCap ? null : c.toNext[level - 1] ?? null;
  const xp = hero?.xp ?? 0;
  return { level, xp, next, frac: next ? Math.max(0, Math.min(1, xp / next)) : 1 };
}

/** The god's rank and piety toward the next rank; null when unsworn. */
export function pietyView(faith) {
  if (!faith?.god) return null;
  const g = gods.rows[faith.god], rank = faith.rank || RANKS.rankOnJoining;
  const prev = RANKS.thresholds[rank - 1] ?? 0, next = rank >= RANKS.maxRank ? null : RANKS.thresholds[rank] ?? null;
  const now = faith.piety ?? 0;
  return {
    // Item 184: piety and favor whole, as the Faith window shows them (hero-view.js); the rules keep the fractions.
    god: faith.god, name: g?.name ?? faith.god, colour: g?.color ?? '#8a6fb0', rank, piety: Math.round(now), next,
    frac: next ? Math.max(0, Math.min(1, (now - prev) / (next - prev))) : 1, favor: Math.round(faith.favor ?? 0), favorCap: piety.rows.favor.cap, top: RANKS.maxRank,
  };
}

/** Essence, keys and the motes that are not zero. */
export function walletView(hero) {
  return { essence: hero?.essence ?? 0, keys: hero?.keys ?? 0, motes: ELEMENTS.map(el => ({ el, n: hero?.motes?.[el] ?? 0 })).filter(m => m.n > 0) };
}

/** The prayers the hero's rank allows, invoke first (it is a class ability, so it is not listed twice). */
function prayersHad(faith) {
  if (!faith?.god) return [];
  const g = gods.rows[faith.god], rank = faith.rank || RANKS.rankOnJoining;
  return (g?.prayers ?? []).filter(id => (prayers.rows[id]?.rank ?? 1) <= rank);
}

/** 1.7's starting bar: the abilities, then the prayers the hero has, from slot 1. */
export function defaultBar(hero) {
  const list = [...(hero?.abilities ?? []).map(id => ({ kind: 'ability', id })), ...prayersHad(hero?.faith).map(id => ({ kind: 'prayer', id })),
    ...(hero?.worn?.ranged ? [{ kind: 'ranged', id: 'bow' }] : [])];
  return Array.from({ length: SLOTS }, (_, i) => list[i] ?? null);
}

/** The bar as the engine keeps it, or the default while the engine has none. */
export function barOf(state) {
  const b = state?.hero?.hotbar;
  return Array.isArray(b) ? Array.from({ length: SLOTS }, (_, i) => b[i] ?? null) : defaultBar(state?.hero);
}

/** A new bar with one slot set (null clears). An entry already elsewhere on the bar moves rather than doubles. */
export function withSlot(bar, i, entry) {
  const out = bar.slice();
  if (entry) { const at = out.findIndex(e => e && e.kind === entry.kind && e.id === entry.id); if (at >= 0) out[at] = null; }
  out[i] = entry;
  return out;
}

/** A new bar with two slots swapped. */
export function swapSlots(bar, a, b) {
  const out = bar.slice();
  [out[a], out[b]] = [out[b], out[a]];
  return out;
}

/** The command a slot sends. The engine answers 'refused not-built-yet' until packet D builds it. */
export function slotCommand(entry) {
  if (!entry || entry.kind === 'ranged') return null;   // the bow slot aims and shoots from the HUD (EQ12)
  if (entry.kind === 'prayer') return { type: 'pray', prayer: entry.id };
  if (entry.kind === 'item') return { type: 'use', item: entry.id };
  if (entry.kind === 'amulet') return { type: 'use', amulet: true };   // EQ2: the worn amulet (gear-use.js useAmulet)
  return { type: 'use', ability: entry.id };
}

/** An ability's prayer row when it is one (a Cleric's invoke is the god's invoke prayer). */
export function prayerRowFor(entry, hero) {
  if (entry?.kind === 'prayer') return prayers.rows[entry.id] ?? null;
  if (entry?.kind === 'ability' && entry.id === 'invoke' && hero?.faith?.god) return prayers.rows[gods.rows[hero.faith.god]?.invoke] ?? null;
  return null;
}

/** How many of an item the bag holds (an item slot shows its count and greys at zero). */
export function itemCount(hero, id) {
  return (hero?.bag ?? []).reduce((n, it) => n + (it?.id === id ? it.count ?? 1 : 0), 0);
}

/** The player's statuses as icons with turns left, in the data's order. */
export function statusList(actor, state = null) {
  const out = [];
  for (const [id, st] of Object.entries(actor?.statuses ?? {})) {
    const row = statuses.rows[id];
    if (!row || id.startsWith('imm-')) continue;
    // H20 (1.7 statusicons.js:125): a status whose row says showStacks (Living Mountain, Discipline) carries them, to its max.
    const stacks = row.showStacks ? Math.min(row.stacks?.max ?? Infinity, st?.stacks ?? 0) : 0;
    out.push({ id, name: row.name ?? id, icon: id === 'stillness' ? stillnessIcon(state) ?? row.icon : row.icon ?? null, turns: st?.n ?? null, stacks, harmful: (row.tags ?? []).includes('harmful') });
  }
  return out;
}

/** H21 (1.7 statusicons.js:113-116): Stillness wears the worn Amulet of Stillness's picture, else the run's look for it. */
function stillnessIcon(state) {
  const worn = state?.hero?.worn?.amulet, look = (worn?.id === 'stillness' ? worn.look : null) ?? state?.run?.amuletLooks?.stillness;
  return worn?.id === 'stillness' && worn.icon ? worn.icon : look ? `item-amulet-${look}` : null;
}

// H19 (1.7 statusicons.js STATUS_INFO, :113-125, renderStatusBar card): what a status does, from strings.json (the
// status row's text key, else status.<id>). A row's card ({text, hero?}: on the hero only) is a template whose live
// numbers come from the row: {damage} {crit} {armour} its stat mods, {cut} its damage cut, {regen} its heal, {shield}
// what is left of its pool, {text} the plain words (H5, ui-15).
const fix1 = n => String(Number((Math.round(n * 10) / 10).toFixed(1)));
/** The words for status `id` on `actor`. */
export function statusText(state, actor, id) {
  const row = statuses.rows[id] ?? {}, st = actor?.statuses?.[id] ?? {}, hero = !!state && actor?.id !== undefined ? actor.id === state.playerId : actor?.side === 'player';
  const d = strings.rows[row.text ?? `status.${id}`] ?? '';
  const ctx = { state, owner: actor ?? {}, target: actor ?? {}, status: st, rank: actor?.faithRank ?? 0 };
  const num = a => { try { return amount(a, ctx); } catch { return 0; } };
  const mod = stat => fix1(num((row.while ?? []).find(w => w.verb === 'modify-stat' && w.stat === stat)?.add ?? 0));
  if (!row.card || (row.card.hero && !hero)) return d;
  const fill = { damage: () => mod('damage'), crit: () => mod('crit'), armour: () => mod('armour'), text: () => d, shield: () => Math.round(st.magnitude ?? 0),
    cut: () => Math.round(Math.min(100, num((row.while ?? []).find(w => w.reducePct !== undefined)?.reducePct ?? 0))), regen: () => fix1(num((row.each ?? []).find(e => e.verb === 'heal')?.amount ?? 0)) };
  return (strings.rows[row.card.text] ?? d).replace(/\{(\w+)\}/g, (m, k) => (fill[k] ? fill[k]() : m));
}

/** The hover card for one status in the HUD row (1.7: name, stacks, turns or steps left, what it does). */
export function statusCard(state, actor, s) {
  const row = statuses.rows[s.id] ?? {}, st = actor?.statuses?.[s.id] ?? {}, max = row.stacks?.max;
  const stacks = max && row.showStacks ? st.stacks ?? 0 : 0;
  const rows = [];
  if (stacks) rows.push(['Stacks', `${stacks} / ${max}`]);
  if (s.turns > 0 && s.turns < 999) rows.push([row.counts === 'step' ? 'Steps left' : 'Turns left', s.turns]);   // 1.7 unit 'steps' (Stillness)
  const d = statusText(state, actor, s.id);
  return { title: stacks ? `${s.name} ×${stacks}` : s.name, rows, lines: d ? [d] : [] };
}

// The HP card lists the pools in 1.7's order (G44, 1.7 costs-adapter.js:33-39 shieldParts): Guard, Ice Armor, the tome's
// ward (E35, 1.7 costs.js:45), then the status wards in data order.
const SHIELD_ORDER = ['guard', 'ice-armor', 'tome-ward', ...Object.keys(statuses.rows)];
const SHIELD_NAMES = { guard: 'Guard', 'ice-armor': 'Ice Armor', 'tome-ward': 'Tome Ward' };

/** 1.7's shield on HP's end: every pool the rules soak through (ui-37, rules/shields.js), with each source's words. */
export function shieldsOf(actor) {
  const parts = shieldPools(actor).sort((a, b) => SHIELD_ORDER.indexOf(a.pool) - SHIELD_ORDER.indexOf(b.pool)).map(q => {
    const n = Math.floor(q.n), name = SHIELD_NAMES[q.pool] ?? statuses.rows[q.pool]?.name ?? q.pool;
    const words = q.pool === 'guard' ? `Guard ${n} of ${Math.floor(actor.maxguard || actor.guard)}, refills out of combat` : q.pool === 'ice-armor' ? `Ice Armor ${n} from Water affinity` : undefined;
    return words ? { name, n, words } : { name, n };
  });
  return { total: parts.reduce((s, p) => s + p.n, 0), parts };
}

/** The boss in sight, if any (the engine marks bosses with `boss`). */
export function bossOf(state) {
  for (const id of state?.order ?? []) {
    const a = state.actors[id];
    if (a?.boss && a.hp > 0 && !a.throne && (!state.vis || litAt(state, a.x, a.y))) return a;
  }
  return null;
}

// 1.7 ui.js:378-380 bossBar: the boss's current warning beside its name, in its bosses.json row's barWords by the blow's
// kind, coloured from ui.json bossBar (H5, ui-15). No countdown numbers (Justin's telegraph ruling: the marks show where
// it lands); the Matron's break counter and the Pulse's beat are not countdowns.
const TONE = ui.bossBar, BAR_OF = {};
for (const r of Object.values(bosses.rows)) for (const m of r.monsters ?? []) BAR_OF[m] = r.barWords ?? {};
/** {text, colour} for the boss bar, or null: DAZED yellow, a Matron ritual red, a wind-up orange red. */
export function bossWarning(state, b) {
  if (!b) return null;
  if (b.statuses?.dazed) return { text: statuses.rows.dazed.barWord, colour: toNum(TONE.dazed) };
  const bar = BAR_OF[b.kind] ?? {}, rit = b.mt?.rit;
  if (rit) return { text: `${bar[rit.kind === 'tithe' ? 'tithe' : 'brood']} · break it ${Math.max(0, rit.hp0 - b.hp)}/${rit.need}`, colour: toNum(TONE.ritual) };
  const enc = state?.floor?.crucible?.encounter, w = enc && enc.bossId === b.id ? enc.warning : null, tw = w && bar[w.kind];
  if (tw) return { text: w.kind === 'pulse' ? `${tw} ${w.beat ?? 1}/2` : tw, colour: toNum(TONE.windup) };
  const t = bar[b.telegraph?.kind];   // C10g: Grukk's marked blow is a telegraph.js mark
  return t ? { text: t, colour: toNum(TONE.windup) } : null;
}

/** Things on the player's tile that Pick up would bag (floor.items: {x, y, item}); a step takes the AUTO kinds (aa299f1). */
export function itemsHere(state) {
  const p = state?.actors?.[state.playerId];
  if (!p) return 0;
  return (state.floor?.items ?? []).filter(e => e && e.x === p.x && e.y === p.y && !AUTO.includes(e.item?.kind)).length;
}

/** "Dungeon · Floor 1", as 1.7's depth label. */
export function depthLine(state) {
  const names = { crypt: 'Crypt', caverns: 'Caverns', underdark: 'Underdark', chaos: 'Realm of Chaos' };   // the floor's biome names it
  // Planes rule 2: on a plane the theme's name (planes.json themeName: Cinder Reach, Skyvault, ...).
  const plane = state?.floor?.plane && planes.rows['plane-' + state.floor.plane]?.themeName;
  const where = plane ?? names[state?.floor?.biome] ?? String(state?.where ?? 'dungeon');
  return `${where[0].toUpperCase()}${where.slice(1)} · Floor ${state?.floorNo ?? 1}`;
}
