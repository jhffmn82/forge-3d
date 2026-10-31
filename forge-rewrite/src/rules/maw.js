// The Deep Maw (floor 15; spec/bosses.md DM1-DM8, bosses.json deep-maw; 1.7 js/world/biomes/caverns/cavernmobs.js
// spawnDeepMaw, mawPlan, mawErupt, mawCallTender, mawDive, mawTick, mawAct @3c8b312). Its loop runs on the world
// clock (ruled 2026-10-16): dormant under the arena until the hero steps in; under 1 game turn, it picks where to
// come up; warn 2 game turns on red marks (never landing in the action that showed them); up 3 game turns (2 below
// half HP) as a 2x2 body, biting whoever touches it; then it dives. While under it is off the map: the body is kept
// in floor.maw and joins the floor's bodies only when it surfaces. Its death opens a burrow as the way on.

import bosses from '../../data/bosses.json' with { type: 'json' };
import propData from '../../data/props.json' with { type: 'json' };
import { next } from '../lib/rng.js';
import { bodyAt, isWall } from './moves.js';
import { refreshSight, lineClear } from './sight.js';
import { T, walkable } from '../data/tiles.js';
import { registerSetPiece, CREATURE_HOOKS } from './set-pieces.js';
import { onPulse } from './pulse-hooks.js';
import { weaponAttack } from './attack.js';
import { dealDamage } from './damage.js';
import { applyStatus } from './statuses.js';
import { amount } from './amount.js';
import tuning from '../../data/tuning.json' with { type: 'json' };
import { makeCreature, makeLimb } from './monsters.js';

const TURN = tuning.rows.clock.unitsPerGameTurn, B = bosses.rows['deep-maw'], propRows = propData.rows ?? {};
const WARN = B.cycle.states.find(s => s.id === 'warn'), UP = B.cycle.states.find(s => s.id === 'up');
const ERUPTION = WARN.effects[0].then;
const BITE = ERUPTION.find(e => e.target?.zone === 'bite'), RUBBLE = ERUPTION.find(e => e.target?.zone === 'rubble');
const MAW = { warn: WARN.turns, up: UP.turns, upHurt: UP.hurtTurns, tenders: ERUPTION.find(e => e.verb === 'summon').count };
const say = (events, words, warning = false) => events.push({ type: 'log', words, warning });
const inArena = (A, p) => p.x >= A.x && p.y >= A.y && p.x < A.x + A.w && p.y < A.y + A.h;
const bodies = state => state.order.map(id => state.actors[id]).filter(b => b.hp > 0);
const touching = (e, o) => o.x >= e.x - 1 && o.x <= e.x + 2 && o.y >= e.y - 1 && o.y <= e.y + 2;

/** The walkable ring round a 2x2 mound. */
function ring(state, m) {
  const out = [];
  for (let y = m.y - 1; y <= m.y + 2; y++) for (let x = m.x - 1; x <= m.x + 2; x++) {
    if (x >= m.x && x <= m.x + 1 && y >= m.y && y <= m.y + 1) continue;
    if (walkable(state.floor, x, y)) out.push({ x, y });
  }
  return out;
}
const fits = (state, M, x, y) => { for (let yy = y; yy <= y + 1; yy++) for (let xx = x; xx <= x + 1; xx++) if (!walkable(state.floor, xx, yy) || !inArena(M.arena, { x: xx, y: yy })) return false; return true; };
const nearestMound = (M, p) => M.arena.mounds.reduce((b, m) => (!b || Math.max(Math.abs(m.x + 0.5 - p.x), Math.abs(m.y + 0.5 - p.y)) < Math.max(Math.abs(b.x + 0.5 - p.x), Math.abs(b.y + 0.5 - p.y)) ? m : b), null);

/** DM3: the eruption site: a 3 x 3 on the hero's last sighting or tremor, or a mound (the first, and every third while above half HP). */
function plan(state, M, events) {
  const e = M.body, hurt = e.hp < e.maxhp / 2, mounds = M.arena.mounds;
  const pickMound = mounds.length && (M.n === 0 || (!hurt && M.n % 3 === 2));
  const target = e.lastSeen ?? null;
  M.rubble = []; M.site = null;
  if (!pickMound && target) {
    const spots = [[-1, -1], [0, -1], [-1, 0], [0, 0]].map(([dx, dy]) => ({ x: target.x + dx, y: target.y + dy })).filter(s => fits(state, M, s.x, s.y));
    if (spots.length) {
      const s = spots[Math.floor(next(state.rng) * spots.length)], cells = [];
      for (let y = target.y - 1; y <= target.y + 1; y++) for (let x = target.x - 1; x <= target.x + 1; x++) if (walkable(state.floor, x, y)) cells.push({ x, y });
      M.site = { x: s.x, y: s.y, mound: null }; M.cells = cells;
      if (hurt && mounds.length) { const nm = nearestMound(M, target); if (nm) M.rubble = ring(state, nm).filter(c => !cells.some(q => q.x === c.x && q.y === c.y)); }
    }
  }
  if (!M.site) {
    if (!mounds.length) { M.cells = []; return false; }
    const m = M.n === 0 && target ? nearestMound(M, target) : mounds[Math.floor(next(state.rng) * mounds.length)];
    M.site = { x: m.x, y: m.y, mound: m }; M.cells = ring(state, m);
  }
  (state.floor.marks ??= []).push({ owner: e.id, tiles: [...M.cells, ...M.rubble], warning: 'warn.maw.surfacing', colour: '#FF3A2A' });
  M.phase = 'warn'; M.at = state.now + MAW.warn * TURN; M.shownIn = state.actions;
  events.push({ type: 'telegraph', id: e.id, tiles: [...M.cells, ...M.rubble], warning: 'warn.maw.surfacing' }, { type: 'boss-move', id: e.id, move: 'surfacing', sfx: 'trap-gas', shake: 4, at: siteMiddle(M) });
  say(events, 'Maw surfacing: leave the red tiles!', true);
  return true;
}

/** Where the dust rises: a mound's own tile, or the middle of the bite (1.7 cavernmobs.js:535). */
const siteMiddle = M => {
  if (M.site.mound || !M.cells.length) return { x: M.site.x, y: M.site.y };
  const n = M.cells.length;
  return { x: Math.round(M.cells.reduce((s, c) => s + c.x, 0) / n), y: Math.round(M.cells.reduce((s, c) => s + c.y, 0) / n) };
};

/** DM5: the bite and the rubble, then the 2x2 body comes up (a mound it uses opens); anything under it is thrown clear. */
function erupt(state, M, events) {
  const e = M.body, f = state.floor, p = state.actors[state.playerId], hurt = e.hp < e.maxhp / 2;
  f.marks = (f.marks ?? []).filter(m => m.owner !== e.id);
  events.push({ type: 'telegraph-end', id: e.id }, { type: 'boss-move', id: e.id, move: 'erupt', sfx: 'explosion', shake: 10, tiles: [...M.cells, ...M.rubble] });
  const on = (list, b) => list.some(c => c.x === b.x && c.y === b.y);
  for (const t of bodies(state)) {
    if (t.limbOf === e.id) continue;
    const bite = on(M.cells, t), rub = !bite && on(M.rubble, t);
    if (!bite && !rub) continue;
    const hit = bite ? BITE : RUBBLE;
    let n = amount(hit.amount, { state, owner: e, source: e });
    if (t.side === 'player') n = Math.min(n, Math.round(t.maxhp * hit.capPctMaxHp / 100));
    const d = dealDamage(state, { target: t, source: e, amount: n, type: hit.type, premitigated: false, tags: ['area', 'boss'] }, events);
    if (t.side === 'player') say(events, `${bite ? 'Maw bite' : 'Maw rubble'}: ${d}.`);
  }
  if (p.hp <= 0) return;
  const s = M.site;
  if (s.mound) for (const q of f.props) if (q.x === s.mound.x && q.y === s.mound.y && /^worm-burrow/.test(q.id)) q.id = 'worm-burrow-open';
  // Whoever stands where the body comes up is thrown clear (nearest free tile within 3).
  for (const t of bodies(state)) {
    if (t.x < s.x || t.x > s.x + 1 || t.y < s.y || t.y > s.y + 1) continue;
    const to = freeNear(state, t, 3, s);
    if (to) { const from = { x: t.x, y: t.y }; t.x = to.x; t.y = to.y; events.push({ type: 'moved', id: t.id, from, to, knocked: true }); if (t.side === 'player') { say(events, 'You are thrown clear.'); refreshSight(state, events); } }
  }
  Object.assign(e, { x: s.x, y: s.y, t: p.t, hunting: true, burrowed: false, size: 2, areaOncePerAction: true });   // CH2: drawn across its 2x2 (1.7 big: 2)
  if (!state.actors[e.id]) { state.actors[e.id] = e; state.order.push(e.id); }
  M.limbs = [[1, 0], [0, 1], [1, 1]].map(([dx, dy], i) => {
    const l = makeLimb(e, i, { x: s.x + dx, y: s.y + dy }, { kind: 'mawlimb', set: 'maw-limb' });   // decided 7 (C10g)
    state.actors[l.id] = l; state.order.push(l.id);
    return l.id;
  });
  M.phase = 'up'; M.at = state.now + (hurt ? MAW.upHurt : MAW.up) * TURN; M.n++;
  events.push({ type: 'spawned', id: e.id, at: { x: s.x, y: s.y }, surfaced: true, sfx: 'maw-intro' });
  say(events, 'Maw exposed. Attack before it dives!');
  callTender(state, M, events);
}
function freeNear(state, at, r, site) {
  for (let d = 1; d <= r; d++) {
    const ring2 = [];
    for (let dy = -d; dy <= d; dy++) for (let dx = -d; dx <= d; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== d) continue;
      const x = at.x + dx, y = at.y + dy;
      if (x >= site.x && x <= site.x + 1 && y >= site.y && y <= site.y + 1) continue;
      if (!isWall(state.floor, x, y) && !bodyAt(state, x, y)) ring2.push({ x, y });
    }
    if (ring2.length) return ring2[Math.floor(next(state.rng) * ring2.length)];
  }
  return null;
}
/** A Worm Tender climbs out beside a random mound with a free tile, while fewer than 1 of its own live. */
function callTender(state, M, events) {
  const mounds = M.arena.mounds;
  if (!mounds.length || M.tenders.filter(id => state.actors[id]?.hp > 0 && state.actors[id].side === 'foe').length >= MAW.tenders) return;
  const o = Math.floor(next(state.rng) * mounds.length), p = state.actors[state.playerId];
  for (let k = 0; k < mounds.length; k++) {
    const spots = ring(state, mounds[(o + k) % mounds.length]).filter(c => !bodyAt(state, c.x, c.y) && !isWall(state.floor, c.x, c.y));
    if (!spots.length) continue;
    const c = spots[Math.floor(next(state.rng) * spots.length)], t = makeCreature('wormtender', c.x, c.y);
    Object.assign(t, { hunting: true, asleep: false, drops: null, summoned: true, t: M.body.t, lastSeen: { x: p.x, y: p.y, at: state.now } });
    state.actors[t.id] = t; state.order.push(t.id); M.tenders.push(t.id);
    events.push({ type: 'spawned', id: t.id, at: c });
    say(events, 'Worm Tender summoned!');
    return;
  }
}
/** DM6: it dives and goes under for 1 game turn. */
function dive(state, M, events) {
  const e = M.body;
  removeBody(state, M);
  e.burrowed = true;
  M.phase = 'under'; M.at = state.now + TURN;
  events.push({ type: 'boss-move', id: e.id, move: 'dive', shake: 5 }, { type: 'despawned', id: e.id, burrowed: true });
  say(events, 'Maw dives. Watch the floor.');
}
function removeBody(state, M) {
  const gone = new Set([M.body.id, ...(M.limbs ?? [])]);
  for (const id of gone) delete state.actors[id];
  state.order = state.order.filter(id => !gone.has(id));
  M.limbs = [];
}

/** The loop on the world clock (A24 played on game turns, ruled 2026-10-16). */
export function mawPulse(state, events) {
  const M = state.floor?.maw, p = state.actors[state.playerId];
  if (!M || M.phase === 'dead' || p.hp <= 0 || M.body.hp <= 0) return;
  const e = M.body;
  // DM2: in the arena every step is a tremor it feels; it knows the tile.
  if (inArena(M.arena, p) && !p.statuses?.levitate) e.lastSeen = { x: p.x, y: p.y, at: state.now };
  if (M.phase === 'dormant') {
    if (!inArena(M.arena, p)) return;
    M.phase = 'under'; M.at = state.now;
    say(events, 'Maw approaching underground.');
    events.push({ type: 'boss', id: e.id, name: e.name, state: 'awake', music: B.music, shake: B.wake?.shake ?? 6 });
  }
  if (M.phase === 'under' && state.now >= M.at) { if (!plan(state, M, events)) M.at = state.now + TURN; return; }
  if (M.phase === 'warn' && state.now >= M.at && state.actions > M.shownIn) { erupt(state, M, events); return; }
  // 1.7 mawTick: each warning turn before the bite the ground rumbles (a dust burst and a small shake, cavernmobs.js:614).
  if (M.phase === 'warn' && state.actions > M.shownIn) { events.push({ type: 'tremor', id: e.id, at: siteMiddle(M), shake: 3 }); return; }
  if (M.phase === 'up' && state.now >= M.at) dive(state, M, events);
}
onPulse('deep-maw', mawPulse);

/** Surfaced: bite a touching enemy first; otherwise spit acid at a visible enemy in range. */
registerSetPiece('deep-maw', (state, a, events) => {
  const M = state.floor?.maw;
  if (!M || M.phase !== 'up' || a.statuses.stun || a.statuses.frozen) return;
  const p = state.actors[state.playerId];
  const t = touching(a, p) && !p.statuses?.hidden ? p : bodies(state).find(o => o.side === 'ally' && touching(a, o));
  if (t) { weaponAttack(state, a, t, events); return; }
  const spit = B.acidSpit;
  const candidates = [p, ...bodies(state).filter(o => o.side === 'ally')];
  for (const target of candidates) {
    if (target.hp <= 0 || target.statuses?.hidden) continue;
    const from = { x: Math.max(a.x, Math.min(a.x + 1, target.x)), y: Math.max(a.y, Math.min(a.y + 1, target.y)) };
    if (Math.max(Math.abs(target.x - from.x), Math.abs(target.y - from.y)) > spit.range || !lineClear(state.floor, from, target)) continue;
    const to = { x: target.x, y: target.y };
    events.push({ type: 'boss-move', id: a.id, move: 'acid-spit', target: target.id },
      { type: 'bolt', id: a.id, by: a.id, from, to, kind: 'poison', acidSpit: true },
      { type: 'burst', at: to, kind: 'poison', n: 18, spread: 0.12 });
    const dealt = dealDamage(state, { target, source: a, amount: amount(spit.damage, { state, owner: a }), type: 'poison', tags: ['spell', 'ranged', 'boss'] }, events);
    if (target.hp > 0 && dealt > 0) applyStatus(state, target, 'poison', { turns: spit.poisonTurns, source: a.id }, events);
    say(events, `Maw acid spit: ${dealt}.`);
    break;
  }
});
// M9, DM7: a limb passes every hit to the body (damage.js's limb rule); the Maw takes at most one area hit an action.
CREATURE_HOOKS.taken.push((state, t, pk) => {
  if (t.kind !== 'deepmaw' || !pk.tags?.includes('area')) return undefined;
  if (t.areaHitIn === state.actions && !pk.premitigated) return 0;
  t.areaHitIn = state.actions;
  return undefined;
});

/**
 * RB18 (1.7 run-events.js:80-88 caveFallbackExitSpot): with no free floor near the arena's middle, the burrow opens on
 * the free floor nearest the hero that he can walk to (no prop, item or body on it); null when there is none.
 */
function burrowFallback(state, maw) {
  const f = state.floor, p = state.actors[state.playerId];
  if (!p) return null;
  const seen = new Set([p.y * f.w + p.x]), queue = [{ x: p.x, y: p.y }];
  const blocks = (x, y) => f.props.some(q => q.x === x && q.y === y);
  for (let i = 0; i < queue.length; i++) {
    const { x, y } = queue[i];
    if (i && f.tiles[y * f.w + x] === T.FLOOR && !blocks(x, y) && !f.items.some(it => it.x === x && it.y === y) && !bodyAt(state, x, y) && !(x === maw.x && y === maw.y)) return { x, y };
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy, k = ny * f.w + nx;
      if ((!dx && !dy) || nx < 1 || ny < 1 || nx >= f.w - 1 || ny >= f.h - 1 || seen.has(k)) continue;
      seen.add(k);
      if (walkable(f, nx, ny) && !f.props.some(q => q.x === nx && q.y === ny && (q.blocks || propRows[q.id]?.blocks))) queue.push({ x: nx, y: ny });
    }
  }
  return null;
}

// DM8: its death clears the marks, takes its Worm Tenders and their Shroomlings, and opens a burrow as the way on.
CREATURE_HOOKS.death.push((state, a, by, events) => {
  if (a.kind !== 'deepmaw') return undefined;
  const f = state.floor, M = f.maw;
  if (!M) return undefined;
  M.phase = 'dead';
  f.marks = (f.marks ?? []).filter(m => m.owner !== a.id);
  const brood = new Set(M.tenders);
  for (const b of bodies(state)) if (brood.has(b.id) || (b.kind === 'shroomling' && brood.has(b.owner))) { b.hp = 0; events.push({ type: 'died', id: b.id, dismissed: true }); }
  for (const id of M.limbs ?? []) { delete state.actors[id]; }
  state.order = state.order.filter(id => state.actors[id]);
  f.fields = (f.fields ?? []).filter(r => !brood.has(r.owner));
  // Its hoard and core fall where they can be picked up: it may have surfaced on a burrow mound, which blocks.
  const drop = [];
  for (let d = 0; d <= 3 && !drop.length; d++) for (let y = a.y - d; y <= a.y + 1 + d; y++) for (let x = a.x - d; x <= a.x + 1 + d; x++) if (!isWall(f, x, y) && f.tiles[y * f.w + x] === T.FLOOR) drop.push({ x, y });
  if (drop.length) { a.x = drop[0].x; a.y = drop[0].y; }
  // The way on: a burrow on the free floor nearest the arena's middle (within 6), sealed until the core is pressed in.
  const A = M.arena, cx = A.x + Math.floor(A.w / 2), cy = A.y + Math.floor(A.h / 2);
  let spot = null, bd = 1e9;
  for (let y = cy - 6; y <= cy + 6; y++) for (let x = cx - 6; x <= cx + 6; x++) {
    if (x < 1 || y < 1 || x >= f.w - 1 || y >= f.h - 1 || f.tiles[y * f.w + x] !== T.FLOOR || f.props.some(q => q.x === x && q.y === y) || f.items.some(i => i.x === x && i.y === y) || (x === a.x && y === a.y)) continue;
    const d = Math.max(Math.abs(x - cx), Math.abs(y - cy)) + (bodyAt(state, x, y) ? 100 : 0);
    if (d < bd) { bd = d; spot = { x, y }; }
  }
  if (!spot) spot = burrowFallback(state, a);
  if (spot) { f.tiles[spot.y * f.w + spot.x] = T.EXIT; f.exit = spot; f.exitOpen = false; f.stairs = spot; f.caveExit = spot; }   // caveExit: drawn as an open worm burrow (1.7 run-events.js:96)
  events.push({ type: 'boss-move', id: a.id, move: 'death', shake: 12 });
  // RB18 (1.7 run-events.js:96-97): the burrow opens in a sparkle of earth, 30; the way on is said, and if no tile could
  // take the burrow, so is that.
  if (spot) events.push({ type: 'sparkle', at: { x: spot.x, y: spot.y }, kind: 'earth', n: 30 });
  events.push({ type: 'log', words: 'Bring the Cavern Core to the burrow to enter the Underdark.', cls: 'c-kill' });
  if (!spot) events.push({ type: 'log', words: 'Burrow blocked: clear a reachable floor tile.', cls: 'c-info' });
  return undefined;
});
