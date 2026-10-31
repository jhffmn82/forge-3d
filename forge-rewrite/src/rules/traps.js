// Traps in play (spec/world.md traps 77-101): springing one, spotting them (A4), Keen Eyes (A6) and searching.
// What each trap does is its effect list in data/traps.json, run by the effect runner.

import traps from '../../data/traps.json' with { type: 'json' };
import rings from '../../data/rings.json' with { type: 'json' };
const runEffect = (...a) => UP.runEffect(...a);   // C17: the one verb path (set-pieces.js UP, from effects.js)
import { lineClear } from './sight.js';
import { next } from '../lib/rng.js';
import { registerPhase } from './phases.js';
import { value } from './items.js';
import { noteDoor } from './doors.js';
import { T, G } from '../data/tiles.js';
import { theName, capFirst } from './monsters.js';
import { searchInspection } from './inspect.js';
import { hook, UP } from './set-pieces.js';
import { conditionHolds } from './effects/conditions.js';
import classes from '../../data/classes.json' with { type: 'json' };

const R = traps.rows, SPOT = R['rule-spotting'], SEARCH = R['rule-search'];
const EARSHOT = 12;   // rule-common: 12 tiles of sound falloff

export const trapAt = (floor, x, y) => floor.traps?.find(t => t.x === x && t.y === y) ?? null;
const words = kind => R[kind].name.toLowerCase() + ' trap';
const article = w => (/^[aeiou]/.test(w) ? 'an' : 'a');
const bold = w => `<b>${w}</b>`;

/** 8-way compass word from the hero to a tile (screen up is north). */
function direction(from, to) {
  const a = Math.atan2(-(to.y - from.y), to.x - from.x), i = Math.round(a / (Math.PI / 4));
  return ['to the east', 'to the northeast', 'to the north', 'to the northwest', 'to the west', 'to the southwest', 'to the south', 'to the southeast'][(i + 8) % 8];
}

/** Can the hero see this tile right now? */
const inSight = (state, x, y) => !!state.vis?.[y * state.floor.w + x];

/**
 * Traps 77-91: a body has stepped onto a trap. Flying and levitating bodies never trigger it (ruled 2026-10-15).
 * Runs the trap's effects, marks it found, logs it by what the hero can see or hear, and removes a once-trap.
 */
// Traps 77: a body stepping onto a trap springs it (moves.js moveBody, the first stepped hook).
hook('stepped', (state, a, events) => { const t = trapAt(state.floor, a.x, a.y); if (t) springTrap(state, a, t, events); }, 10);

export function springTrap(state, a, trap, events) {
  if (a.flags?.includes('flying') || a.statuses?.levitate) return;
  const row = R[trap.kind], p = state.actors[state.playerId], player = a.id === state.playerId;
  // Item 287 (ruled 2026-10-15, spec/world.md 22: "Stone Skin and Earth 3 ignore spikes for any body"): the trap's
  // immuneIf spares the body (spikes: Levitate, Stone Skin, Earth 3).
  if (row.immuneIf && conditionHolds(row.immuneIf, { state, owner: a, target: a, events })) return;
  const seen = player || inSight(state, trap.x, trap.y);
  trap.found = true;
  events.push({ type: 'trap', kind: trap.kind, id: a.id, at: { x: trap.x, y: trap.y }, sfx: row.sfx, heard: !seen });
  const start = events.length;
  for (const e of row.effects) runEffect(e, { state, owner: a, target: a, source: null, events, trap });
  if (trap.heavy && a.hp > 0) for (const e of R['rule-heavy'].effects) runEffect(e, { state, owner: a, target: a, source: null, events });
  const n = events.slice(start).filter(e => e.type === 'damaged' && e.id === a.id).reduce((s, e) => s + e.amount, 0);
  const applied = events.slice(start).some(e => e.type === 'status' && e.id === a.id && e.change === 'applied');
  const fill = line => line.replace(/\bN\b/, String(n)).replace('<Name>', a.name ? capFirst(theName(a.name)) : 'Something').replace('<name>', a.name ? theName(a.name) : 'something');   // CD27: 'Webs! The Goblin is stuck.'; the N of <Name> is not the number
  const say = line => { for (const w of [].concat(line)) events.push({ type: 'log', words: fill(w) }); };
  if (trap.kind === 'web' && !applied) { /* "only if it applied" */ }
  else if (player) say(row.log.player);
  else if (seen) say(row.log.seen);
  else if (Math.hypot(trap.x - p.x, trap.y - p.y) <= EARSHOT) {
    say(trap.kind === 'alarm' && row.log.heard ? row.log.heard.replace('<direction>', direction(p, trap)) : `You hear a trap spring ${direction(p, trap)}.`);
  }
  if (row.once) state.floor.traps.splice(state.floor.traps.indexOf(trap), 1);
}

/** I42: the Keen Eyes ring's value in percent (two rings add; a cursed one is negative). */
function keenEyes(hero) {
  let v = 0;
  for (const slot of ['ring1', 'ring2']) {
    const it = hero?.worn?.[slot];
    if (it?.id === 'keeneyes') v += value(rings.rows.keeneyes.values.spotPct, it, hero);
  }
  return v;
}

const agilityOver10 = state => Math.max(0, (state.hero?.attr?.agi ?? 10) - 10);

/** Traps 97 (A4): each unfound trap the hero sees within 3 may be spotted; at most one an action. */
registerPhase('explore', (state, ctx, events) => {
  const p = state.actors[state.playerId];
  let pct = 8 + 3 * agilityOver10(state) + (classes.rows[state.hero?.cls]?.searchBonusPct ?? 0) + Math.min(0, keenEyes(state.hero));
  pct = Math.max(0, pct);
  for (const t of state.floor.traps ?? []) {
    if (t.found || Math.max(Math.abs(t.x - p.x), Math.abs(t.y - p.y)) > 3 || !inSight(state, t.x, t.y)) continue;
    if (next(state.rng) < (pct * (t.room ? 0.2 : 1)) / 100) {
      t.found = true;
      events.push({ type: 'trap-found', at: { x: t.x, y: t.y }, kind: t.kind, sfx: 'trap-spot' });
      events.push({ type: 'log', words: SPOT.passive.log.replace('a(n)', article(words(t.kind))).replace('<b>X trap</b>', bold(words(t.kind))), cls: 'c-info' });   // P8: the name in bold
      return;
    }
  }
});

/** Traps 98 (A6): Keen Eyes rolls its value for every unfound trap in sight. */
registerPhase('keen-eyes', (state, ctx, events) => {
  const v = keenEyes(state.hero);
  if (v <= 0) return;
  // Each hidden door in sight opens on half the ring's value (rings.json keeneyes doorPct).
  const f = state.floor;
  for (let k = 0; k < f.tiles.length; k++) if (f.tiles[k] === T.SECRET && state.vis?.[k] && next(state.rng) < v / 2 / 100) revealSecret(state, k % f.w, (k / f.w) | 0, events, 'Your ring tingles: a <b>hidden door</b>.');
  for (const t of state.floor.traps ?? []) {
    if (t.found || !inSight(state, t.x, t.y) || !(next(state.rng) < v / 100)) continue;
    t.found = true;
    events.push({ type: 'trap-found', at: { x: t.x, y: t.y }, kind: t.kind, sfx: 'trap-spot' });
    events.push({ type: 'log', words: `Your ring tingles: ${article(words(t.kind))} ${bold(words(t.kind))}.`, cls: 'c-info' });
  }
});

/** W30: a found hidden door becomes a door; its line in kill gold (1.7 c-kill). */
export function revealSecret(state, x, y, events, words = 'You find a hidden door!') {
  state.floor.tiles[y * state.floor.w + x] = T.DOOR; noteDoor(state.floor, x, y);   // M3: what it is made of (RC7)
  events.push({ type: 'door', at: { x, y }, found: true, sfx: 'door-secret' }, { type: 'log', words, cls: 'c-kill' });
}

const nearTell = (f, x, y) => { for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (f.ground?.[(y + dy) * f.w + x + dx] === G.TELL) return true; return false; };

/**
 * Traps 99: Search, one action, radius 2; every hidden door and unfound trap in range rolls separately. Resting (K1,
 * 1.7 searchAround(true, true)) searches at half the chance, with no sweep on the map and no "nothing new" line.
 * Quiet (P3, the touch pad's centre key, 1.7 touchui.js searchAround(false, true)) is a full search shown by one faint
 * ring, without the "nothing new" line, so waiting turn after turn does not flash the sweep or fill the log.
 */
export function search(state, events, { resting = false, quiet = false } = {}) {
  const p = state.actors[state.playerId], key = p.y * state.floor.w + p.x;
  if (!resting) events.push({ type: 'searched', at: { x: p.x, y: p.y }, radius: SEARCH.radius, ...(quiet ? { quiet: true } : {}) });   // the sweep on the map (fx-layer.js, 1.7 searchSweepFx)
  // P6 (1.7 puzzles.js:456 floorMeta.searched): the repeat bonus belongs to that spot on this floor.
  const searched = (state.floor.searched ??= {});
  const before = searched[key] ?? 0;
  const pct = (40 + 2 * agilityOver10(state) + keenEyes(state.hero) + 20 * before) * (resting ? 0.5 : 1);
  searched[key] = before + 1;
  let found = 0;
  const f = state.floor;
  for (let y = p.y - SEARCH.radius; y <= p.y + SEARCH.radius; y++) for (let x = p.x - SEARCH.radius; x <= p.x + SEARCH.radius; x++) {
    if (x < 0 || y < 0 || x >= f.w || y >= f.h || f.tiles[y * f.w + x] !== T.SECRET) continue;
    // A hidden door beside a tell is always found when the searcher also stands beside a tell.
    if ((nearTell(f, x, y) && nearTell(f, p.x, p.y)) || next(state.rng) < pct / 100) { revealSecret(state, x, y, events, 'You find a <b>hidden door</b>!'); found++; }   // P8 (1.7 puzzles.js:467)
  }
  for (const t of state.floor.traps ?? []) {
    if (t.found || Math.max(Math.abs(t.x - p.x), Math.abs(t.y - p.y)) > SEARCH.radius) continue;
    if (next(state.rng) < pct / 100) {
      t.found = true; found++;
      events.push({ type: 'trap-found', at: { x: t.x, y: t.y }, kind: t.kind, sfx: 'trap-spot' });
      events.push({ type: 'log', words: `You find ${article(words(t.kind))} ${bold(words(t.kind))}.`, cls: 'c-info' });   // P8 (1.7 puzzles.js:470)
    }
  }
  // H11 (1.7 logSearchInspection): a search (not a rest) lists what the hero sees within its radius, nearest first;
  // the "nothing new" line only comes when there was nothing to list either.
  const seen = !resting ? searchInspection(state, SEARCH.radius) : [];
  if (seen.length) events.push({ type: 'log', words: `You inspect your surroundings and see: ${seen.join(', ')}.` });
  if (!found && !resting && !quiet && !seen.length) events.push({ type: 'log', words: before ? 'You search carefully again and find nothing new.' : 'You search carefully and find nothing new.' });
}
