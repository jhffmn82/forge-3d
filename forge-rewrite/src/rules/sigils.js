// Sigils and the Forge's other mote work (spec/magic.md D46-D54; sigils.json, forge.json enchant, carve, recycle).
// Reading a sigil is one action; carving, enchanting and recycling happen in the Forge's window and take no time.

import sigils from '../../data/sigils.json' with { type: 'json' };
import forge from '../../data/forge.json' with { type: 'json' };
import gods from '../../data/gods.json' with { type: 'json' };
import loot from '../../data/loot.json' with { type: 'json' };
import { UP } from './set-pieces.js'; const runEffect = (...a) => UP.runEffect(...a);   // C17: the one verb path (set-pieces.js UP, from effects.js)
const heroEvent = (...a) => UP.heroEvent(...a);   // C17: the hero's passives (set-pieces.js UP, from passives.js)
import runes from '../../data/runes.json' with { type: 'json' };
import { stream, next } from '../lib/rng.js';
import { itemRow } from './items.js';
import { atForge, upgradeCost } from './forge.js';
import { essenceMult } from './loot.js';
import progression from '../../data/progression.json' with { type: 'json' };
import { walkable, T } from '../data/tiles.js';
import { realmAllows } from './crucible.js';
import { tally } from './run-record.js';
import { runeOf, sigilName, sigilKnown, itemName } from './item-names.js';
import { nearFree, free } from './space.js';

const S = sigils.rows, BAG = loot.rows.bag.slots, RECYCLE = forge.rows.recycle;
const isSigil = id => S[id]?.kind === 'sigil';



const know = (state, id) => { const k = (state.run ??= {}).knownSigils ??= []; if (!k.includes(id)) k.push(id); };

/** D47 (1.7 sigils.js:88-94 sigilForbidden): the god's refusal of a sigil: Grumbok every sigil; another god one carved with its forbidden element. */
function godForbids(state, row) {
  const g = state.hero?.faith?.god && gods.rows[state.hero.faith.god];
  if (!g || !row) return null;
  if (g.conduct?.noSigils) return `${g.name.split(',')[0]} forbids every sigil.`;
  const el = (row.motes ?? []).find(m => g.forbiddenElements?.includes(m));
  return el ? `${g.name.split(',')[0]} forbids this sigil: it is carved with a ${el[0].toUpperCase() + el.slice(1)} mote.` : null;
}

/** The refusal in its own words, for a sigil's card and the Forge's Craft tiles (1.7 bagCard, forge.js:131-135), or ''. */
export const sigilForbidden = (state, id) => (isSigil(id) ? godForbids(state, S[id]) ?? '' : '');

const LEVEL_CAP = progression.rows['xp-curve'].levelCap;
/** C11: what each sigils.json refusedWhen key checks: true when the read is refused. */
const REFUSED = {
  'no-way-out': state => !(state.floor.tiles.some(t => t === T.STAIRS) || (state.floor.exit && state.floor.exitOpen)),
  'no-known-curse': state => !Object.values(state.hero.worn).some(it => it?.cursed && it.known),
  'nothing-to-upgrade': state => ![...Object.values(state.hero.worn), ...state.hero.bag].some(it => it && it.kind !== 'food' && it.kind !== 'sigil' && upgradeCost(state.hero, it) != null),
  'level-cap': state => state.hero.level >= LEVEL_CAP,
  'no-blink-tile': state => !blinkTiles(state).length,
  'no-room': (state, row) => nearFree(state, state.actors[state.playerId], row.roomNeeded.radius).length < row.roomNeeded.tiles,
};
/** The sigil's own refusal in its row's words (sigils.json refusedWhen, refusal), or null. */
function ownRefusal(state, id) {
  const row = S[id];
  return (row.refusedWhen ?? []).some(k => REFUSED[k]?.(state, row)) ? row.refusal.replace('{cap}', LEVEL_CAP) : null;
}

/**
 * C11: one gate for a read and the Amulet of Echoes' echo: the god's refusal, Fear, the sigil's own refusal, and a
 * picker sigil's choice. Returns { refused } with the refusal, { ask: true } when the chooser must open, or { choice }.
 */
function prepareSigil(state, id, choice, events) {
  const p = state.actors[state.playerId], say = w => events.push({ type: 'log', words: w });
  const god = godForbids(state, S[id]);
  if (god) { say(god); return { refused: 'forbidden' }; }
  if (p.statuses.fear) { say('You are too afraid.'); return { refused: 'feared' }; }
  const own = ownRefusal(state, id);
  if (own) { say(own); return { refused: 'refused' }; }
  choice = knowledgeChoice(state, id, choice);
  return PICKER.has(id) && !choice ? { ask: true } : { choice };
}

/** D47: picker sigils (identify one, Rot, Ascension, Transmutation) need the player's choice: {bag} or {slot}. */
const PICKER = new Set(['identify', 'rot', 'ascension', 'transmutation']);

/** E50 (1.7 knowPicker, sigils.js:301-322): the unidentified gear a Sigil of Knowledge could read, worn first, as choices. */
export function unknownGear(state) {
  const h = state.hero, gear = it => it && it.kind !== 'food' && it.kind !== 'sigil' && it.known === false;
  return [...Object.entries(h.worn ?? {}).filter(([, it]) => gear(it)).map(([slot]) => ({ slot })),
    ...(h.bag ?? []).map((it, bag) => (gear(it) ? { bag } : null)).filter(Boolean)];
}
/** E50: Knowledge asks only when there are two or more pieces: one is read at once, none reads only the sigils. */
function knowledgeChoice(state, id, choice) {
  if (id !== 'identify' || choice) return choice;
  const list = unknownGear(state);
  return list.length === 1 ? list[0] : list.length ? null : { none: true };
}

/**
 * D47: reads the sigil at bag index `i`. With a picker and no `choice`, it asks first (a 'picker' event; nothing spent).
 * Returns 'act', 'free' (asked, nothing spent) or a refusal.
 */
export function useSigil(state, i, choice, events) {
  const h = state.hero, p = state.actors[state.playerId], it = h.bag[i], say = w => events.push({ type: 'log', words: w });
  if (!it || it.kind !== 'sigil' || !isSigil(it.id)) return 'no-item';
  const row = S[it.id], ready = prepareSigil(state, it.id, choice, events);
  if (ready.refused) return ready.refused;
  if (ready.ask) { events.push({ type: 'picker', sigil: it.id, bag: i }); return 'free'; }
  choice = ready.choice;
  // Spend one, then the effects; the kind is known for the run and recorded as the last read (Amulet of Echoes).
  if ((it.count ?? 1) > 1) it.count -= 1;
  else {
    h.bag.splice(i, 1);
    // E38: the chosen bag line was counted with the sigil still in the bag; past it, it is one line up now.
    if (choice?.bag !== undefined && choice.bag > i) choice = { ...choice, bag: choice.bag - 1 };
  }
  know(state, it.id);
  (state.run ??= {}).lastSigil = it.id;
  const base = it.id.replace(/2$/, '');
  events.push({ type: 'sigil', id: it.id, by: p.id, name: row.name, sfx: [row.sfx?.cue ?? `sigil-${base}`, `sigil-${base}`, 'sigil-use'] });
  const ctx = { state, owner: p, target: p, source: p, events, choice: choice ?? null, sigil: row };
  const before = readFacts(state);
  for (const e of row.effects ?? []) runEffect(e, ctx);
  const line = resultLine(state, it.id, before);
  events.push({ type: 'log', words: line?.[0] ?? `You read the ${row.name}.`, ...(line?.[1] ? { cls: line[1] } : {}) });
  if (choice?.none) say('All gear identified.');   // E50 (1.7 knowPicker)
  return 'act';
}

/** G39: what a result line compares against (mana, unread gear, known curses worn) before the sigil's effects run. */
function readFacts(state) {
  const h = state.hero, p = state.actors[state.playerId];
  return { mp: p.mana ?? 0, unknown: [...Object.values(h.worn ?? {}), ...(h.bag ?? [])].filter(x => x && x.known === false).length,
    curses: Object.values(h.worn ?? {}).filter(x => x?.cursed).length };
}
const turnsWord = n => `${n} turn${n === 1 ? '' : 's'}`;
/**
 * G39 (1.7 sigil-adapter.js:63-212, sigilBuffNotice :14-23): the line each sigil says when it is read, in place of the
 * plain "You read the X."; a buff sigil gives its timer ("Haste: 20 turns."). The row's readLog (C11): {x} fills from
 * the read's facts, [..] stays only when its numbers are above 0, and a line naming a status is the plain line while
 * the status is absent. [words, log class], or null for the plain line (Mending, Knowledge, Rot, Ascension,
 * Transmutation, Smoke and the Deep Map say their own, as in 1.7).
 */
function resultLine(state, id, b) {
  const L = S[id]?.readLog, p = state.actors[state.playerId];
  if (!L) return null;
  const st = L.status && p.statuses?.[L.status];
  if (L.status && !(st?.n || st?.magnitude)) return null;
  const after = readFacts(state), curses = b.curses - after.curses;
  const facts = { mp: Number(Math.max(0, (p.mana ?? 0) - b.mp).toFixed(1)), turns: st ? turnsWord(st.n) : '', ward: st?.magnitude ?? 0,
    gear: b.unknown - after.unknown, curses: curses > 0 ? `${curses} curse${curses === 1 ? '' : 's'}` : 0 };
  const fill = t => t.replace(/\{(\w+)\}/g, (_, k) => facts[k]);
  return [fill(L.words.replace(/\[([^\]]*)\]/g, (_, seg) => ([...seg.matchAll(/\{(\w+)\}/g)].every(m => facts[m[1]]) ? seg : ''))), L.cls];
}
/**
 * I47 (1.7 amulets.js:75-98): the Amulet of Echoes reads sigil `id` again without using one. The same refusals as a
 * read; a picker sigil asks its chooser first (the picker event carries amulet: true) and the echo waits for the choice.
 * Returns 'act', 'free' (the chooser opened) or a refusal; 'picker' means nothing was spent.
 */
export function echoSigil(state, id, choice, events) {
  const p = state.actors[state.playerId], row = S[id], say = w => events.push({ type: 'log', words: w });
  if (!isSigil(id)) return 'no-sigil';
  const ready = prepareSigil(state, id, choice, events);
  if (ready.refused) return ready.refused;
  if (ready.ask) { events.push({ type: 'picker', sigil: id, amulet: true }); return 'picker'; }
  choice = ready.choice;
  const base = id.replace(/2$/, '');
  events.push({ type: 'sigil', id, by: p.id, name: row.name, echo: true, sfx: [row.sfx?.cue ?? `sigil-${base}`, `sigil-${base}`, 'sigil-use'] }, { type: 'log', words: `The amulet echoes the ${row.name}.` });
  const ctx = { state, owner: p, target: p, source: p, events, choice: choice ?? null, sigil: row };
  for (const e of row.effects ?? []) runEffect(e, ctx);
  if (choice?.none) say('All gear identified.');   // E50 (1.7 knowPicker)
  return 'act';
}

/** The motes a sigil is carved from (Echoes' level gate). */
export const sigilMotes = id => S[id]?.motes?.length ?? 99;

/** D53: carve a sigil at the Forge. Returns a refusal or null. */
/** What carving the sigil costs in essence (1.7 sigilEssence): the row's own, a recipe's, else one mote 100, more 200.
 * The Craft tile, the journal and the cavern merchant read this, so every shown price is what carve() charges. */
export function carveCost(id) {
  const C = S['essence-cost'], row = S[id];
  return row?.essence ?? C.byRecipe[id] ?? ((row?.motes?.length ?? 1) > 1 ? C.moreMotes : C.oneMote);
}

export function carve(state, id, events) {
  const h = state.hero, row = S[id], say = w => events.push({ type: 'log', words: w });
  if (!isSigil(id)) return 'no-sigil';
  if (!atForge(state)) { say('You must stand at the Forge.'); return 'not-at-forge'; }
  const god = godForbids(state, row);
  if (god) { say(god); return 'forbidden'; }
  const need = {};
  for (const m of row.motes) need[m] = (need[m] ?? 0) + 1;
  if (Object.entries(need).some(([m, n]) => (h.motes[m] ?? 0) < n)) { say('You lack the motes.'); return 'no-motes'; }
  const cost = carveCost(id);
  if (h.essence < cost) { say('You lack the essence.'); return 'no-essence'; }
  const stack = h.bag.find(b => b.kind === 'sigil' && b.id === id);
  if (!stack && h.bag.length >= BAG) { say('Your bag is full.'); return 'bag-full'; }
  for (const [m, n] of Object.entries(need)) h.motes[m] -= n;
  h.essence -= cost;
  if (stack) stack.count = (stack.count ?? 1) + 1; else h.bag.push({ kind: 'sigil', id, count: 1 });
  know(state, id);
  events.push({ type: 'carved', id, sfx: 'forge-craft' }, { type: 'essence-spent', amount: cost }, { type: 'log', words: `You carve a ${row.name}.` });
  heroEvent(state, 'on-craft', { craft: 'carve', packet: { motesSpent: need } }, events);   // CD2 Second Heat
  return null;
}

/** D52: set a mote's element into a worn main hand, off hand, ranged weapon or armour. The window asks before replacing. */
export function enchant(state, slot, el, events) {
  const h = state.hero, it = h.worn[slot], say = w => events.push({ type: 'log', words: w });
  if (!forge.rows.enchant.slots.includes(slot) || !it) return 'no-item';
  if (!atForge(state)) { say('You must stand at the Forge.'); return 'not-at-forge'; }
  const g = h.faith?.god && gods.rows[h.faith.god];
  if (g?.forbiddenElements?.includes(el)) { say(`${g.name.split(',')[0]} forbids that element.`); return 'forbidden'; }
  if (it.known === false) { say('Identify it first.'); return 'unknown'; }
  if ((h.motes[el] ?? 0) < 1) { say('You have no mote of that element.'); return 'no-mote'; }
  if (it.enchant === el) { say('It already holds that element.'); return 'same'; }
  h.motes[el] -= 1;
  it.enchant = el;
  if (it.cursed) { it.cursed = false; if (it.plus < 0) it.plus = 0; }
  events.push({ type: 'enchanted', slot, element: el, sfx: 'forge-enchant' }, { type: 'log', words: `Your ${itemRow(it.id).row.name ?? it.id} now holds ${el}.` });
  heroEvent(state, 'on-craft', { craft: 'enchant', packet: { motesSpent: { [el]: 1 } } }, events);   // CD2 Second Heat
  return null;
}

/** D54: essence for melting one carried item. */
export function recycleValue(state, it) {
  const { kind, row } = itemRow(it.id);
  let v;
  if (row.joke) v = RECYCLE.joke;
  else if (kind === 'ring' || kind === 'amulet') v = RECYCLE.ringOrAmulet;
  else if (kind === 'weapon' || kind === 'armour' || kind === 'offhand') v = RECYCLE.byTier[it.tier ?? 0] * (1 + RECYCLE.perPlus * Math.max(0, it.plus ?? 0));
  else return 0;
  return Math.max(RECYCLE.min, Math.round(v * essenceMult(state.floorNo)));
}

/** D54: melt bag item `i` (or every gear piece in the bag) into essence. Returns a refusal or null. */
export function recycle(state, i, events, all = false) {
  const h = state.hero;
  if (!atForge(state)) { events.push({ type: 'log', words: 'You must stand at the Forge.' }); return 'not-at-forge'; }
  const can = it => it && it.kind !== 'food' && it.kind !== 'sigil' && recycleValue(state, it) > 0;
  const picks = all ? h.bag.map((it, k) => (can(it) ? k : -1)).filter(k => k >= 0) : can(h.bag[i]) ? [i] : [];
  if (!picks.length) return 'no-item';
  let total = 0;
  const one = picks.length === 1 ? itemName(h.bag[picks[0]], state) : null;
  for (const k of picks.sort((a, b) => b - a)) { total += recycleValue(state, h.bag[k]); h.bag.splice(k, 1); }
  h.essence += total; tally(state, 'essence', total);   // the score counts essence earned (1.7 gainEssence)
  // W47 (1.7 forgeui.js:117, :127): the Forge's own words, in moss.
  const words = one ? `The Forge melts down your <b>${one}</b>: +${total} essence.` : `The Forge melts down ${picks.length} pieces of gear: +${total} essence.`;
  events.push({ type: 'recycled', count: picks.length, essence: total, sfx: 'forge-recycle' }, { type: 'log', words, cls: 'c-good' });
  return null;
}



/** Blink (ruled 2026-10-12): visible free tiles 3 to 6 away (its sigils.json teleport row's band). */
const BLINK = S.blink.effects.find(e => e.verb === 'teleport');
export function blinkTiles(state) {
  const p = state.actors[state.playerId], f = state.floor, out = [], { min, max } = BLINK;
  for (let y = p.y - max; y <= p.y + max; y++) for (let x = p.x - max; x <= p.x + max; x++) {
    const d = Math.max(Math.abs(x - p.x), Math.abs(y - p.y));
    if (d >= min && d <= max && state.vis?.[y * f.w + x] && free(state, x, y)) out.push({ x, y });
  }
  return out;
}
