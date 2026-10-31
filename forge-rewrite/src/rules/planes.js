// The elemental planes' play rules (spec/planes.md 99-135 and "Justin's answers"; spec/bosses.md PG1-PG7, BO4;
// 1.7 js/world/planes/portals.js :268-404, :543-586 and planesfwa.js :281-538 @3c8b312). Imported for its side
// effects (realm.js). Everything here counts game turns on the world pulse (answer 1): the hazards (A19 light flare
// and falling rocks, A30 lava, deep water, updraft vents, burning rocks, surge, gale), Snuffed and regeneration (A20),
// and the six guardians' timers. A marked blow lands on a later pulse, never inside the action that showed it.
// Hazards spare bodies flagged plane-native (answer 2). Guardians are dispatched by their monster row's `set` from
// the act hook rather than by a.set on the body: death.js sends any body with a.set to bossDied, which would roll the
// grotto chest's table at the corpse; a guardian drops from its own row's table (kill-plane-elite, answer 8).

import planes from '../../data/planes.json' with { type: 'json' };
import bosses from '../../data/bosses.json' with { type: 'json' };
import MON from '../../data/monsters.json' with { type: 'json' };
import tuning from '../../data/tuning.json' with { type: 'json' };
import ui from '../../data/ui.json' with { type: 'json' };
import { registerSetPiece, CREATURE_HOOKS, UP } from './set-pieces.js';
import { registerPhase } from './phases.js';
import { onPulse, onSightRadius } from './pulse-hooks.js';
import { weaponAttack } from './attack.js';
import { dealDamage } from './damage.js';
import { applyStatus, blocks } from './statuses.js';
const runEffect = (...a) => UP.runEffect(...a);   // C17: the one verb path (set-pieces.js UP, from effects.js)
import { amount } from './amount.js';
import { ignite } from './fields.js';
import { stepToward } from './ai-step.js';
import { ready, spend } from './cooldowns.js';
import { mark, registerLander, warningWords } from './telegraph.js';
import { bodyAt, isWall, moveBody } from './moves.js';
import { lineClear, refreshSight } from './sight.js';
import { next, roll } from '../lib/rng.js';
import { T, walkable, tileAt } from '../data/tiles.js';
import { cheb, D4, D8, footprintGap } from '../lib/geometry.js';

const PL = planes.rows;
const TURN = tuning.rows.clock.unitsPerGameTurn;
const OWNER = 'plane-hazard';
const MOTE_PCT = 10;   // sandbox P9: a regular's mote drop, % a kill
const sizeOf = e => e.size ?? 1;
/** The roster's moves and passives are 1.7's own code here; the numbers it reads are their monsters.json rows' (C10c). */
const MOVE = (kind, id) => MON.rows[kind].moves.find(m => m.id === id), PASSIVE = (kind, i) => MON.rows[kind].passives[i];
const live = state => state.order.map(id => state.actors[id]).filter(b => b && b.hp > 0);
const player = state => state.actors[state.playerId];
const say = (events, words, extra = {}) => events.push({ type: 'log', words, ...extra });
const bossMove = (boss, id) => bosses.rows[boss].actions[0].moves.find(m => m.id === id);
const HEART_HIT = bossMove('heart-of-the-mountain', 'stone-spikes').effects[0];
const ERUPTION_HIT = bossMove('emberlord', 'eruption').effects[0].then[0];
const DJINN_HIT = bossMove('djinn', 'lightning').effects[0];
const native = b => b.side !== 'player' && !!b.flags?.includes('plane-native');
const airborne = b => !!(b.flags?.includes('flying') || b.statuses?.levitate);
const kbImmune = b => !!(b.immune?.includes('knockback') || b.statuses?.['imm-knockback']);
const visible = (state, x, y) => !!state.vis?.[y * state.floor.w + x];
const TITLE = el => PL['plane-' + el]?.name ?? `the Plane of ${el[0].toUpperCase()}${el.slice(1)}`;

/** Planes 121, 123: within 2 tiles (Chebyshev, fractional light positions) of any plane light. */
export function litByPlaneLight(floor, b) {
  return (floor.lights ?? []).some(l => Math.abs(l.x - b.x) <= 2 && Math.abs(l.y - b.y) <= 2);
}

/**
 * Planes 121: the hero's sight radius on a plane, or null where the ordinary rule stands. Shadow: 5, 8 within 2 of
 * a plane light; Snuffed: 2 on any plane (off a plane sight.js already caps Snuffed at 2).
 */
onSightRadius('planes', state => planeSightRadius(state));
export function planeSightRadius(state) {
  const f = state.floor, p = player(state);
  if (!f?.plane || !p) return null;
  if (p.statuses?.snuffed) return 2;
  if (f.plane !== 'shadow') return null;
  return litByPlaneLight(f, p) ? 8 : 5;
}

/** A body sees the hero when its tile (any footprint tile) is in the hero's view (M11). */
function seesHero(state, a) {
  const p = player(state);
  if (p.statuses?.hidden || a.statuses?.blind) return false;
  const s = sizeOf(a);
  for (let dy = 0; dy < s; dy++) for (let dx = 0; dx < s; dx++) if (visible(state, a.x + dx, a.y + dy)) return true;
  return false;
}
const blockingProp = (f, x, y) => isWall(f, x, y);
const freeCell = (state, x, y) => walkable(state.floor, x, y) && !blockingProp(state.floor, x, y) && !bodyAt(state, x, y);
/** 1.7 nearFree: a free cell nearest the centre (ring by ring, uniform within the ring), up to r away. */
function nearFree(state, c, r) {
  for (let d = 0; d <= r; d++) {
    const ring = [];
    for (let y = c.y - d; y <= c.y + d; y++) for (let x = c.x - d; x <= c.x + d; x++) if (cheb(c, { x, y }) === d && freeCell(state, x, y)) ring.push({ x, y });
    if (ring.length) return ring[Math.floor(next(state.rng) * ring.length)];
  }
  return null;
}
function moveTo(state, a, to, events, extra = {}) {
  moveBody(state, a, to, events, { mode: 'teleport' });   // C10c (engine-rules-16)
  Object.assign(events.at(-1), extra);
  if (a.side === 'player') refreshSight(state, events);
}
/** Planes 134: up to n tiles in (sign dx, sign dy), stopped by bounds, unwalkable cells, blocking props and bodies. */
function push(state, t, dx, dy, n, events) {
  if (kbImmune(t)) return 0;
  dx = Math.sign(dx); dy = Math.sign(dy);
  if (!dx && !dy) return 0;
  let moved = 0;
  for (let i = 0; i < n && t.hp > 0; i++) {
    const x = t.x + dx, y = t.y + dy;
    if (!freeCell(state, x, y)) { events.push({ type: 'knock-blocked', id: t.id, at: { x: t.x, y: t.y }, sfx: 'knock-thud' }); break; }   // RB51
    moveBody(state, t, { x, y }, events, { mode: 'push' }); moved++;   // C10c (engine-rules-16): each tile walked onto, a trap or field answering
  }
  if (moved) {
    events.push({ type: 'knocked', id: t.id });
    if (t.side === 'player') refreshSight(state, events);
  }
  return moved;
}
/** One hazard or guardian packet; the player's log names it (planes 116, 125-129). Kills with no source credit none. */
function hurt(state, t, n, type, source, why, events, tags = ['environment', 'area']) {
  if (!t || t.hp <= 0) return 0;
  const d = dealDamage(state, { target: t, source: source ?? null, amount: n, type, tags, cause: source ? null : 'plane-hazard' }, events);
  if (t.side === 'player' && why) say(events, `${why}: ${d}.`);
  return d;
}

// ---------------------------------------------------------------------------------------------------- the bodies

/** Rule 99, answer 2: each roster kind, the elite, the Heart's limbs and nodes carry plane-native; limbs never wear. */
export function prepare(state) {
  const f = state.floor;
  const R = f?.plane ? PL['plane-' + f.plane]?.roster : null, kinds = new Set(f?.plane ? [...(R?.regulars ?? []), R?.elite, 'heartlimb', 'crystalnode'].filter(Boolean) : []);
  for (const b of live(state)) {
    if (b.planeReady || b.side === 'player' || !(kinds.has(b.kind) || b.planeEncounter)) continue;   // item 287: a chest ambusher off the planes too
    b.planeReady = true;
    b.flags = [...new Set([...(b.flags ?? []), 'plane-native'])];
    // These kinds' moves are taken here (1.7's own code); the generic move list would spend actions on unbuilt verbs.
    if (OWN_MOVES.has(b.kind)) b.moves = null;
    // These kinds' passives are taken here too (1.7's damage-adapter and death-adapter): the shared readers would
    // run their rows half (crypt.js multiplies by a damage-mod's mult, which the shell row has none of).
    if (OWN_PASSIVES.has(b.kind)) b.passives = [];
    if (b.kind === 'heartlimb') Object.assign(b, { hp: 1e9, maxhp: 1e9, noXp: true, immune: ['fear', 'stun', 'knockback', 'root'] });
    if (b.kind === 'mountainheart' || b.kind === 'crystalnode') b.immune = [...new Set([...(b.immune ?? []), 'knockback'])];
  }
  lurk(state);
}
/** PL11 (1.7 portals.js:655-658 hidePlaneActor): a lurker (the Stalker) is unseen until it stands next to the hero,
 *  asleep, wandering or hunting alike. Set on the plane's bodies after every action (A20) and on arrival. */
function lurk(state) {
  const p = player(state);
  if (!state.floor?.plane || !p) return;
  for (const b of live(state)) if (b.params?.entry === 'unseen-until-adjacent') b.hidden = cheb(b, p) > 1;
}
registerPhase('plane-creatures', state => lurk(state));
const OWN_PASSIVES = new Set(['tidecrab', 'dawnsentinel', 'magmacrawler', 'crystalgolem']);
const OWN_MOVES = new Set(['prismscarab', 'halowisp', 'umbralhound', 'cinderimp', 'flamedancer', 'siren', 'drownedone', 'stormhawk', 'windwisp', 'thundertotem']);

/** The Burrower's dive (no row: 1.7 portals.js burrower): every 6 game turns, up again 3 on. */
const DIVE = { id: 'dive', cooldown: 6, under: 3 };

const liveNodes = state => (state.floor.heartNodes ?? []).filter(id => state.actors[id]?.hp > 0);

// ---------------------------------------------------------------------------------------------------- the guardians

/**
 * PG1: Judgment every 7 game turns when it sees the hero; what the hero deals it for 3 turns comes back. A telegraph
 * (telegraph.js, C10c): its pending blow keeps the stored damage and lands on the pulse.
 */
function radiantWarden(state, a, events) {
  if (a.telegraph || state.now < (a.judgmentAt ?? 0) || !seesHero(state, a)) return false;
  a.judgmentAt = state.now + 7 * TURN;
  events.push({ type: 'move-used', id: a.id, move: 'judgment', name: 'Judgment' });
  mark(state, a, { kind: 'judgment', tiles: [{ x: a.x, y: a.y }], delayTurns: 3, warning: 'warn.warden.judgment', data: { stored: 0 } }, events);
  return true;
}
registerLander('judgment', (state, a, j, events) => {
  const p = player(state);
  const n = Math.min(Math.round(j.stored), Math.round(p.maxhp * 0.4));
  if (seesHero(state, a) && n > 0) {
    const d = dealDamage(state, { target: p, source: a, amount: n, type: 'light', tags: ['judgment'] }, events);
    say(events, `Judgment: ${d}.`);
  } else say(events, 'Judgment fades.');
});

/** PG2: every 3 game turns, or at once when the hero is adjacent and it stands in moonlight, a shadow step 2-4 away. */
function nightWarden(state, a, events) {
  const p = player(state);
  if (blocks(a, 'move')) return false;
  if (!(state.now >= (a.stepAt ?? 0) || (cheb(a, p) <= 1 && litByPlaneLight(state.floor, a)))) return false;
  const spots = [];
  for (let y = p.y - 7; y <= p.y + 7; y++) for (let x = p.x - 7; x <= p.x + 7; x++) { const d = cheb({ x, y }, p); if (d >= 2 && d <= 4 && freeCell(state, x, y)) spots.push({ x, y }); }
  if (!spots.length) return false;
  moveTo(state, a, spots[Math.floor(next(state.rng) * spots.length)], events, { sfx: 'vanish' });
  a.stepAt = state.now + 3 * TURN;
  say(events, 'Night Warden: teleported.');
  return true;
}

/** PG3: the Heart never moves; dormant until struck or touched, then bites, then throws stone spikes. */
function heart(state, a, events) {
  const p = player(state);
  if (a.statuses.stun || a.statuses.frozen || a.statuses.fear) return true;
  const touching = b => b && b.hp > 0 && footprintGap(a, b) <= 1;
  if (!a.awake) {
    if (a.provoked || touching(p)) {
      Object.assign(a, { awake: true, hunting: true, asleep: false, lastSeen: { x: p.x, y: p.y, at: state.now } });
      say(events, 'Heart of the Mountain wakes with a rumble.', { sfx: 'heart-intro' });
      events.push({ type: 'boss', id: a.id, name: a.name, state: 'awake', sfx: 'heart-intro', shake: 6 });
    }
    return true;
  }
  if (touching(p)) { if (!blocks(a, 'melee')) weaponAttack(state, a, p, events); return true; }
  const ally = live(state).find(b => b.side === 'ally' && touching(b));
  if (ally) { if (!blocks(a, 'melee')) weaponAttack(state, a, ally, events); return true; }
  if (seesHero(state, a) && footprintGap(a, p) <= 6 && state.now >= (a.spikeAt ?? 0)) {
    a.spikeAt = state.now + 3 * TURN;
    events.push({ type: 'move-used', id: a.id, move: 'stone-spikes', name: 'Stone Spikes', target: p.id, ranged: true, shake: 4 });
    const d = dealDamage(state, { target: p, source: a, amount: amount(HEART_HIT.amount, { state, owner: a, source: a }), type: 'phys', tags: ['ability', 'ranged'] }, events);
    say(events, `${a.name} spikes: ${d}.`);
    if (p.hp > 0 && next(state.rng) < 0.35) applyStatus(state, p, 'root', { turns: 2, source: a.id }, events);
  }
  return true;
}

const burnGround = (state, x, y) => { if (walkable(state.floor, x, y) && tileAt(state.floor, x, y) !== T.WATER) ignite(state, x, y, false, 3); };

/** PG4: enraged at half HP (its 3x3 burns each action); Eruption every 6 game turns on the hero's 3x3 (lands on the pulse). */
function emberlord(state, a, events) {
  const p = player(state);
  if (a.hp <= a.maxhp * 0.5 && !a.kindled) { a.kindled = true; say(events, 'Emberlord enraged: ground ignites!'); events.push({ type: 'boss-move', id: a.id, move: 'enrage', shake: 8 }); }
  if (a.kindled) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) burnGround(state, a.x + dx, a.y + dy);
  if (a.telegraph || state.now < (a.eruptAt ?? 0) || !seesHero(state, a) || cheb(a, p) > 8) return false;
  const tiles = [];
  for (let y = p.y - 1; y <= p.y + 1; y++) for (let x = p.x - 1; x <= p.x + 1; x++) if (walkable(state.floor, x, y)) tiles.push({ x, y });
  if (!tiles.length) return false;
  a.eruptAt = state.now + 6 * TURN;
  events.push({ type: 'move-used', id: a.id, move: 'eruption', name: 'Eruption' });
  mark(state, a, { kind: 'eruption', tiles, delayTurns: 2, warning: 'warn.emberlord.eruption' }, events);   // C10c: telegraph.js
  return true;
}
registerLander('eruption', (state, a, { tiles }, events) => {
  events.push({ type: 'boss-move', id: a.id, move: 'eruption', tiles, element: 'fire', shake: 10 });
  for (const c of tiles) {
    for (const t of live(state)) {
      if (t.x !== c.x || t.y !== c.y || native(t)) continue;
      hurt(state, t, amount(ERUPTION_HIT.amount, { state, owner: a, source: a }), 'fire', a, t.side === 'player' ? 'Emberlord eruption' : null, events, ['area']);
      const burn = ERUPTION_HIT.then[0];
      if (t.hp > 0) applyStatus(state, t, 'burn', { turns: burn.turns, magnitude: amount(burn.magnitude, { state, owner: a, source: a }), source: a.id }, events);
      if (player(state).hp <= 0) return;
    }
    if (next(state.rng) < 0.5) burnGround(state, c.x, c.y);
  }
});

/** PG5: in water with the hero 2+ away it dives (untouchable); next action it comes up beside the hero. Tail Sweep. */
function leviathan(state, a, events) {
  const p = player(state), d = cheb(a, p);
  if (a.submerged) {
    if (blocks(a, 'move')) return true;
    const up = nearFree(state, p, 1) ?? nearFree(state, a, 2);
    if (up) moveTo(state, a, up, events);
    a.submerged = false; a.diveAt = state.now + 5 * TURN;
    say(events, 'Leviathan Eel emerges!');
    events.push({ type: 'boss-move', id: a.id, move: 'emerge', shake: 6 });
    return true;
  }
  if (!blocks(a, 'move') && state.now >= (a.diveAt ?? 0) && tileAt(state.floor, a.x, a.y) === T.WATER && d > 1) {
    a.submerged = true; a.diveAt = state.now + 2 * TURN;
    say(events, 'Leviathan Eel dives: invulnerable.');
    events.push({ type: 'boss-move', id: a.id, move: 'dive' });
    return true;
  }
  if (d <= 1 && state.now >= (a.sweepAt ?? 0)) {
    a.sweepAt = state.now + 4 * TURN;
    events.push({ type: 'move-used', id: a.id, move: 'tail-sweep', name: 'Tail Sweep', target: p.id, shake: 7 });
    hurt(state, p, roll(state.rng, a.dmg[0], a.dmg[1]), 'phys', a, 'Leviathan tail', events, ['attack', 'melee']);
    if (p.hp > 0) { push(state, p, p.x - a.x, p.y - a.y, 3, events); applyStatus(state, p, 'stun', { turns: 1, source: a.id }, events); }
    return true;
  }
  return false;
}

/** PG6: Cyclone (3-7, clear line, every 6 game turns) pulls up to 3 and stuns; Lightning (2+, every 3). */
function djinn(state, a, events) {
  const p = player(state), d = cheb(a, p), sees = seesHero(state, a) && lineClear(state.floor, a, p);
  if (sees && d >= 3 && d <= 7 && state.now >= (a.cycloneAt ?? 0)) {
    a.cycloneAt = state.now + 6 * TURN;
    events.push({ type: 'move-used', id: a.id, move: 'cyclone', name: 'Cyclone', target: p.id, ranged: true, shake: 6 });
    const n = push(state, p, a.x - p.x, a.y - p.y, 3, events);
    applyStatus(state, p, 'stun', { turns: 1, source: a.id }, events);
    say(events, `Tempest Djinn: whirlwind${n ? `; pulled ${n} tile${n === 1 ? '' : 's'}` : ''}.`);
    return true;
  }
  if (sees && d >= 2 && state.now >= (a.boltAt ?? 0)) {
    a.boltAt = state.now + 3 * TURN;
    events.push({ type: 'move-used', id: a.id, move: 'lightning', name: 'Lightning', target: p.id, ranged: true, element: 'lightning' });
    hurt(state, p, amount(DJINN_HIT.amount, { state, owner: a, source: a }), 'lightning', a, 'Tempest Djinn', events, ['attack', 'ranged']);
    return true;
  }
  return false;
}

const GUARDIANS = { radiantwarden: radiantWarden, nightwarden: nightWarden, emberlord, leviathaneel: leviathan, tempestdjinn: djinn };

/** A guardian's or a plane body's whole action, or false for the shared hunter. */
function planeAct(state, a, events) {
  const f = state.floor;
  if (!f?.plane || a.side !== 'foe') return false;
  prepare(state);
  if (a.kind === 'mountainheart') return heart(state, a, events);
  if (a.kind === 'thundertotem') return totem(state, a, events);
  const g = GUARDIANS[a.kind];
  if (!g || !a.hunting || a.statuses.fear) return false;
  return g(state, a, events);
}

// A set piece by its monsters.json `set`, should a body carry one: its move, else a plain hunter's blow or step.
for (const set of ['radiant-warden', 'night-warden', 'heart-of-the-mountain', 'emberlord', 'leviathan', 'djinn']) {
  registerSetPiece(set, (state, a, events) => {
    if (planeAct(state, a, events)) return;
    const p = player(state);
    if (!a.hunting) return;
    if (cheb(a, p) <= 1) { if (!blocks(a, 'melee')) weaponAttack(state, a, p, events); }
    else if (!blocks(a, 'move')) stepToward(state, a, seesHero(state, a) ? p : (a.lastSeen ?? p), events);
  });
}
(CREATURE_HOOKS.act ??= []).push(planeAct);

// ---------------------------------------------------------------------------------------------------- the roster

/** 1.7 totem: never moves; wakes when it sees the hero within 7; zaps down its row or column (1-6, every 2 game turns). */
function totem(state, a, events) {
  const p = player(state), d = cheb(a, p), sees = seesHero(state, a);
  if (!a.hunting) {
    if (sees && d <= 7) { Object.assign(a, { hunting: true, asleep: false, lastSeen: { x: p.x, y: p.y, at: state.now } }); say(events, 'The Thunder Totem hums awake.'); events.push({ type: 'noticed', id: a.id }); }
    return true;
  }
  const m = MOVE('thundertotem', 'totem-zap');
  if ((a.x === p.x || a.y === p.y) && sees && d <= m.range[1] && ready(state, a, m) && lineClear(state.floor, a, p)) {
    spend(state, a, m);
    events.push({ type: 'move-used', id: a.id, move: 'totem-zap', name: 'Lightning', target: p.id, ranged: true, element: 'lightning' });
    hurt(state, p, amount(m.effects[0].amount, { state, owner: a, source: a }), 'lightning', a, 'Thunder Totem', events, ['attack', 'ranged']);
    if (p.hp > 0 && next(state.rng) < m.effects[0].then[0].chance / 100) applyStatus(state, p, 'stun', { turns: 1, source: a.id }, events);
  }
  return true;
}

function fleeStep(state, a, from, events) {
  if (blocks(a, 'move')) return false;
  const opts = D8.map(([dx, dy]) => ({ dx, dy, g: cheb({ x: a.x + dx, y: a.y + dy }, from) - cheb(a, from) })).filter(o => o.g > 0 && freeCell(state, a.x + o.dx, a.y + o.dy));
  if (!opts.length) return false;
  const o = opts.sort((p, q) => q.g - p.g)[0];
  moveBody(state, a, { x: a.x + o.dx, y: a.y + o.dy }, events);   // C10c: a step, as any (engine-rules-16)
  return true;
}
/** The water pull shared by the Siren and the Drowned One: one recovery window for the group (1.7 waterPull). */
function waterPull(state, a, p, d, m, events) {
  if (d < m.range[0] || d > m.range[1] || !ready(state, a, m) || state.now < (p.waterPullUntil ?? 0) || !lineClear(state.floor, a, p)) return false;
  spend(state, a, m);
  events.push({ type: 'move-used', id: a.id, move: a.kind === 'siren' ? 'siren-song' : 'drag', name: a.kind === 'siren' ? 'Siren Song' : 'Drag', target: p.id, ranged: true });
  const n = push(state, p, a.x - p.x, a.y - p.y, 1, events);
  if (n) p.waterPullUntil = state.now + m.sharedRecovery.turns * TURN;
  if (a.kind === 'siren') say(events, `Siren song: ${n ? 'pulled 1 tile.' : 'resisted.'}`);
  else if (n) say(events, 'Drowned One: pulled 1 tile.', { sfx: 'trap-web' });
  return true;
}

/** The roster's own moves and the behaviours ai.js leaves unbuilt (caster, ambusher, burrower), 1.7's order. */
function rosterHunt(state, a, p, { sees, dist: d }, events) {
  const canMove = !blocks(a, 'move'), seen = () => visible(state, a.x, a.y);
  switch (a.kind) {
    case 'prismscarab': {   // Split Beam (1.7 actions-adapter.js:111-116): 70% to the hero and 70% to an ally within 3
      const m = MOVE('prismscarab', 'split-beam'), { splitMult, splitTo } = m.effects[0];
      if (!sees || d < m.range[0] || d > m.range[1] || blocks(a, 'ranged') || !lineClear(state.floor, a, p)) return false;
      const other = live(state).filter(o => o.side === 'ally' && cheb(o, p) <= splitTo.range && lineClear(state.floor, a, o))[0];
      events.push({ type: 'move-used', id: a.id, move: 'split-beam', name: 'Split Beam', target: p.id, element: 'light', ranged: true });
      weaponAttack(state, a, p, events, { mult: other ? splitMult : 1, label: 'Split Beam', ranged: true });
      if (other && other.hp > 0) {
        events.push({ type: 'move-used', id: a.id, move: 'split-beam', name: 'Split Beam', target: other.id, element: 'light', ranged: true });
        weaponAttack(state, a, other, events, { mult: splitMult, label: 'Split Beam', ranged: true });
      }
      return true;
    }
    case 'halowisp': {   // caster: Mend the most hurt ally within 4 (every 2 game turns), else keep 3 away
      const m = MOVE('halowisp', 'mend');
      const hurtAlly = live(state).filter(o => o.side === 'foe' && o !== a && o.hp < o.maxhp && cheb(o, a) <= m.target.range && !o.limbOf).sort((x, y) => x.hp / x.maxhp - y.hp / y.maxhp)[0];
      if (hurtAlly && ready(state, a, m)) {
        spend(state, a, m);
        events.push({ type: 'move-used', id: a.id, move: 'mend', name: 'Mend', target: hurtAlly.id, element: 'light' });
        runEffect(m.effects[0], { state, owner: a, target: hurtAlly, source: a, events });
        return true;
      }
      return d <= 3 && fleeStep(state, a, p, events);
    }
    case 'umbralhound': {   // Howl, once, when it sees the hero: everything within 14 hunts
      if (a.howled || !sees) return false;
      a.howled = true;
      say(events, 'Umbral Hound: nearby enemies alerted.');
      events.push({ type: 'move-used', id: a.id, move: 'howl', name: 'Howl' });
      for (const o of live(state)) if (o.side === 'foe' && !o.hunting && cheb(o, a) <= MOVE('umbralhound', 'howl').effects[0].radius && !o.limbOf && o.kind !== 'crystalnode') Object.assign(o, { hunting: true, asleep: false, lastSeen: { x: p.x, y: p.y, at: state.now } });
      return true;
    }
    case 'stalker': {   // ambusher: unseen until adjacent; its first blow on the hero lands double
      a.hidden = d > 1;
      if (d === 1 && !a.ambushed && !blocks(a, 'melee')) { a.ambushed = true; weaponAttack(state, a, p, events, { mult: PASSIVE('stalker', 0).mult, label: 'Ambush' }); return true; }
      return false;
    }
    case 'burrower': {   // dives when 3+ away (every 6 game turns, M32), tunnels, comes up beside the hero 3 game turns on
      if (!canMove) return false;
      if (!a.burrowed && d > 2 && ready(state, a, DIVE)) { a.burrowed = true; a.hidden = true; spend(state, a, DIVE); a.readyAt.surface = state.now + DIVE.under * TURN; if (seen()) say(events, 'Burrower dives.'); return true; }
      if (!a.burrowed) return false;
      if (d <= 1 || state.now >= a.readyAt.surface) {
        const sp = nearFree(state, p, 1);
        if (sp) moveTo(state, a, sp, events);
        a.burrowed = false; a.hidden = false;
        say(events, 'Burrower emerges!');
        events.push({ type: 'boss-move', id: a.id, move: 'emerge', shake: 4 });
        return true;
      }
      const nx = a.x + Math.sign(p.x - a.x), ny = a.y + Math.sign(p.y - a.y);
      if (tileAt(state.floor, nx, ny) !== T.WALL && nx >= 0 && ny >= 0 && nx < state.floor.w && ny < state.floor.h && !bodyAt(state, nx, ny)) { const from = { x: a.x, y: a.y }; a.x = nx; a.y = ny; events.push({ type: 'moved', id: a.id, from, to: { x: nx, y: ny }, burrowed: true }); }
      return true;
    }
    case 'cinderimp': {   // Leap beside the hero (2-4, every 3 game turns), leaving and landing on burning ground
      const m = MOVE('cinderimp', 'cinder-hop');
      if (!canMove || !sees || d < m.range[0] || d > m.range[1] || !ready(state, a, m)) return false;
      const to = nearFree(state, p, 1);
      if (!to) return false;
      burnGround(state, a.x, a.y);
      moveTo(state, a, to, events, { leap: true });
      spend(state, a, m);
      burnGround(state, a.x, a.y);
      if (seen()) say(events, 'Cinder Imp: leaps; ground ignited.');
      return true;
    }
    case 'flamedancer': {   // 35%: a step aside that stays within 2 of the hero
      const m = MOVE('flamedancer', 'sidestep');
      if (!sees || !canMove || d > 1 || !(next(state.rng) < m.chance / 100)) return false;
      const side = D8.filter(([dx, dy]) => freeCell(state, a.x + dx, a.y + dy) && cheb({ x: a.x + dx, y: a.y + dy }, p) <= m.effects[0].max);
      if (!side.length) return false;
      const [dx, dy] = side[Math.floor(next(state.rng) * side.length)];
      moveBody(state, a, { x: a.x + dx, y: a.y + dy }, events);
      if (seen()) say(events, 'The Flame Dancer spins aside.');
      return true;
    }
    case 'siren': return sees && waterPull(state, a, p, d, MOVE('siren', 'siren-song'), events);
    case 'drownedone': return sees && waterPull(state, a, p, d, MOVE('drownedone', 'drag'), events);
    case 'stormhawk': {   // Swoop beside the hero (3-5, every 4 game turns): its blow and a push
      const m = MOVE('stormhawk', 'swoop');
      if (!canMove || !sees || d < m.range[0] || d > m.range[1] || !ready(state, a, m)) return false;
      const to = nearFree(state, p, 1);
      if (!to) return false;
      spend(state, a, m);
      moveTo(state, a, to, events, { dash: true });
      events.push({ type: 'move-used', id: a.id, move: 'swoop', name: 'Swoop', target: p.id });
      const n = hurt(state, p, roll(state.rng, a.dmg[0], a.dmg[1]), 'phys', a, 'Storm Hawk', events, ['attack', 'melee']);
      if (p.hp > 0 && n > 0) push(state, p, p.x - a.x, p.y - a.y, 1, events);
      return true;
    }
    case 'windwisp': {   // Gust (within 2, every 3 game turns): the hero pushed a tile
      const m = MOVE('windwisp', 'gust');
      if (!sees || d > m.range[1] || !ready(state, a, m)) return false;
      spend(state, a, m);
      events.push({ type: 'move-used', id: a.id, move: 'gust', name: 'Gust', target: p.id });
      if (push(state, p, p.x - a.x, p.y - a.y, 1, events)) say(events, 'Wind Wisp: pushed 1 tile.');
      return true;
    }
  }
  return false;
}
// Item 287 (1.7 world.js:1365 planeEncounter): a chest ambusher off the planes hunts with its plane ways too (rooms.json
// ambush planeBehaviour), made ready on its first hunt.
CREATURE_HOOKS.hunt.push((state, a, p, info, events) => {
  if (a.side !== 'foe' || !(state.floor?.plane || a.planeEncounter)) return false;
  if (a.planeEncounter && !a.planeReady) prepare(state);
  return rosterHunt(state, a, p, info, events);
});

// ---------------------------------------------------------------------------------------------------- damage rules

const loggedIn = (a, key, state) => { if (a[key] === state.actions) return false; a[key] = state.actions; return true; };
CREATURE_HOOKS.taken.push((state, t, pk, events) => {
  const f = state.floor;
  if (!f?.plane && t.kind !== 'magmacrawler') return undefined;   // the crawler also lives in the Underdark's volcanic caves (sandbox U9)
  prepare(state);
  const fromHero = pk.source?.side === 'player';
  if (t.kind === 'mountainheart') {
    if (fromHero) t.provoked = true;
    const n = liveNodes(state).length;
    if (n) {
      events.push({ type: 'float', id: t.id, words: 'immune' });
      if (fromHero && loggedIn(t, 'immuneLogIn', state)) say(events, `Heart of the Mountain: immune. Destroy ${n} crystal node${n === 1 ? '' : 's'}.`);
      return 0;
    }
  }
  if (t.kind === 'nightwarden' && !litByPlaneLight(f, t)) {
    events.push({ type: 'float', id: t.id, words: 'immune' });
    if (fromHero && loggedIn(t, 'immuneLogIn', state)) say(events, 'Night Warden: immune outside crystal light.');
    return 0;
  }
  if (t.submerged) { if (fromHero && loggedIn(t, 'immuneLogIn', state)) say(events, 'Leviathan Eel: submerged and invulnerable.'); return 0; }
  if (t.burrowed) return 0;
  const amt = pk.amount ?? 0, tags = pk.tags ?? [];
  // monsters.md Tide Crab Shell (1.7 damage-adapter.js:29-35, ruled 2026-09-28): the first blow of each game turn is
  // turned; after 3 turned blows the shell cracks for good.
  if (t.kind === 'tidecrab' && !t.shellCracked && amt > 0) {
    const turn = Math.floor(state.now / TURN);
    if (t.shellTurn !== turn) {
      t.shellTurn = turn; t.shellBlocks = (t.shellBlocks ?? 0) + 1;
      const seen = visible(state, t.x, t.y);
      if (t.shellBlocks >= PASSIVE('tidecrab', 0).uses) { t.shellCracked = true; events.push({ type: 'float', id: t.id, words: 'cracked' }); if (seen) say(events, 'Tide Crab: blocked. Shell broken.'); }
      else { events.push({ type: 'float', id: t.id, words: 'shell' }); if (seen) say(events, 'Tide Crab: blocked.'); }
      return 0;
    }
  }
  // Magma Crawler Fire-fed (1.7 admitDamage, damageAbsorption fire 1): fire heals it instead (halved under Rot).
  if (t.kind === 'magmacrawler' && (pk.type ?? 'phys') === 'fire' && amt > 0) {
    runEffect({ verb: 'heal', amount: Math.round(amt * (t.statuses?.rot ? 0.5 : 1)) }, { state, owner: t, target: t, source: t, events });
    return 0;
  }
  // Dawn Sentinel Reflect (1.7 damage-adapter.js:68-76): the hero's spell or ranged damage over 1 is halved, and 4
  // of the same kind comes back to the hero (not for damage over time, arcs or riders).
  if (t.kind === 'dawnsentinel' && fromHero && ((pk.type ?? 'phys') !== 'phys' || cheb(t, pk.source) > 1) && amt > 1 && !tags.includes('reflected')) {
    const [cut, back] = PASSIVE('dawnsentinel', 0).effects;
    if (!tags.includes('periodic') && !tags.includes('arc') && (!tags.includes('proc') || tags.includes('attack')))
      hurt(state, pk.source, back.flat, pk.type ?? 'phys', t, null, events, ['reflected']);
    return (amt - Math.round(amt * cut.reducePct / 100)) / amt;
  }
  return undefined;
});
CREATURE_HOOKS.damaged.push((state, t, pk, dealt, events) => {
  if (!state.floor?.plane && t.kind !== 'magmacrawler') return;   // sandbox U9
  if (t.telegraph?.kind === 'judgment' && pk.source?.side === 'player') t.telegraph.stored += dealt;   // PG1: stored while it waits
  if (pk.type === 'fire' || t.statuses?.burn) t.burnedAt = state.now;              // planes 124: fire stops regeneration
  // Magma Crawler (1.7 enemy-fields.js onDamaged): a direct hit sets the ground around it burning.
  if (t.kind === 'magmacrawler' && t.hp > 0 && dealt > 0 && pk.source && !pk.tags?.some(x => x === 'periodic' || x === 'environment')) {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) burnGround(state, t.x + dx, t.y + dy);
    if (visible(state, t.x, t.y)) say(events, 'Magma Crawler: nearby ground burns.');
  }
  // Planes 122: a Gloom Moth's hit snuffs the hero's light for 5 game turns.
  if (t.side === 'player' && pk.source?.kind === 'gloommoth' && dealt > 0 && !pk.tags?.includes('reflected')) applyStatus(state, t, 'snuffed', { turns: 5, replace: true, source: pk.source.id }, events);
});
CREATURE_HOOKS.death.push((state, a, by, events) => {
  const f = state.floor;
  if (!f?.plane && a.kind !== 'magmacrawler') return undefined;   // sandbox U9
  // Magma Burst (1.7 death-adapter.js:15-19): 8-13 fire and Burn 2 to every non-native beside it, half the 3x3 alight.
  if (a.kind === 'magmacrawler') {
    events.push({ type: 'boss-move', id: a.id, move: 'magma-burst', shake: 6 });
    if (visible(state, a.x, a.y)) say(events, 'Magma Crawler explodes!', { kill: true });
    const [hit, ground] = PASSIVE('magmacrawler', 2).effects, burn = hit.then[0];
    for (const o of live(state)) {
      if (o === a || cheb(o, a) > 1 || native(o)) continue;
      hurt(state, o, roll(state.rng, ...hit.amount.roll), 'fire', null, 'Molten rock sprays over you', events);
      if (o.hp > 0) applyStatus(state, o, 'burn', { turns: burn.turns, magnitude: amount(burn.magnitude, { state }) }, events);
    }
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (next(state.rng) < ground.chance / 100) burnGround(state, a.x + dx, a.y + dy);
  }
  // Crystal Golem Shards (1.7 death-adapter.js:39-41): 6 physical to the hero's side beside it.
  if (a.kind === 'crystalgolem') {
    for (const o of live(state)) {
      if (o.side === 'foe' || o.side === 'neutral' || cheb(o, a) > 1) continue;
      const d = hurt(state, o, PASSIVE('crystalgolem', 0).effects[0].amount, 'phys', null, null, events, ['area']);
      if (o.side === 'player') say(events, `Crystal shards: ${d}.`);
    }
  }
  if (a.kind === 'crystalnode' && f.heartNodes?.includes(a.id)) {
    const left = liveNodes(state).length;
    say(events, left ? `Crystal node destroyed; ${left} left.` : 'Heart of the Mountain exposed!', { kill: true });
  }
  // Sandbox P9 (Justin 2026-10-16: "give them a small chance maybe 10% to drop their motes"): an ordinary plane creature
  // killed by the hero's side drops a mote of the plane's element on 10% of kills, rolled apart from its essence and
  // gear. Not the guardian, the Heart's limbs or nodes, or a summon.
  if (f.plane && a.id !== f.eliteId && !a.limbOf && !a.noXp && !a.summon && a.kind !== 'crystalnode' && (by?.side === 'player' || by?.side === 'ally')
    && PL['plane-' + f.plane]?.roster?.regulars?.includes(a.kind) && next(state.rng) < MOTE_PCT / 100) {
    (f.items ??= []).push({ x: a.x, y: a.y, item: { kind: 'mote', el: f.plane } });
    say(events, `${a.name} drops a ${f.plane} mote.`);
  }
  if (a.id === f.eliteId) {
    // Planes 108, BO4: the guardian's fall. Its marks and the Heart's limbs go with it.
    f.eliteDead = true;
    f.marks = (f.marks ?? []).filter(m => m.owner !== a.id);
    a.telegraph = null;
    for (const b of live(state)) if (b.limbOf === a.id) { b.hp = 0; events.push({ type: 'died', id: b.id, dismissed: true }); }
    events.push({ type: 'boss', id: a.id, name: a.name, state: 'dead' });
    say(events, `The guardian of ${TITLE(f.plane)} falls. Its treasure waits in the grotto.`, { kill: true });
  }
  return undefined;
});

// ---------------------------------------------------------------------------------------------------- the pulse

// Each plane's telegraphed hazard, every n world pulses; its words (strings.json) and colour (ui.json) by warning id.
const HAZARD = {
  light: { every: 4, key: 'plane-light-flare-warning', row: 'plane-hazard-light-flare' }, earth: { every: 6, key: 'plane-falling-rocks-warning', row: 'plane-hazard-falling-rocks' }, fire: { every: 5, key: 'plane-burning-rocks-warning', row: 'plane-hazard-burning-rocks' },
  water: { every: 6, key: 'plane-surge-warning', row: 'plane-hazard-surge' }, air: { every: 5, key: 'plane-gale-warning', row: 'plane-hazard-gale' },
};
const ri = (state, a, b) => roll(state.rng, a, b);
const SHADE = /crystal|stalagmite|rune|dais/;

/** Planes 118-119, 131-132: the cells of the next telegraph, around the hero. */
function hazardCells(state, el) {
  const f = state.floor, p = player(state), cells = [], ok = (x, y) => x >= 0 && y >= 0 && x < f.w && y < f.h && walkable(f, x, y);
  let dir = null;
  if (el === 'light') {
    const shaded = (x, y) => D4.some(([dx, dy]) => (f.props ?? []).some(q => q.x === x + dx && q.y === y + dy && SHADE.test(q.id)));
    for (let b = 0; b < 3; b++) {
      const bx = p.x + ri(state, -5, 5), by = p.y + ri(state, -4, 4);
      for (let y = by - 1; y <= by + 1; y++) for (let x = bx - 2; x <= bx + 2; x++) if (ok(x, y) && !shaded(x, y) && next(state.rng) < 0.8) cells.push({ x, y });
    }
    if (next(state.rng) < 0.6) cells.push({ x: p.x, y: p.y });
  } else if (el === 'earth') {
    for (let k = 0; k < 7; k++) { const x = p.x + ri(state, -3, 3), y = p.y + ri(state, -3, 3); if (ok(x, y)) cells.push({ x, y }); }
  } else if (el === 'fire') {
    for (let k = 0; k < 3; k++) {
      const bx = p.x + ri(state, -4, 4), by = p.y + ri(state, -3, 3);
      for (let y = by - 1; y <= by + 1; y++) for (let x = bx - 1; x <= bx + 1; x++) if (ok(x, y) && next(state.rng) < 0.7) cells.push({ x, y });
    }
    if (next(state.rng) < 0.6) cells.push({ x: p.x, y: p.y });
  } else {
    // Water and air come as a wave: a band across a uniform one of 4 directions, 3 deep, shifted -1..1 sideways.
    const dd = D4[Math.floor(next(state.rng) * 4)], ax = dd[0] ? 0 : 1, ay = dd[0] ? 1 : 0, wide = el === 'water' ? 4 : 3, off = ri(state, -1, 1);
    for (let k = -wide; k <= wide; k++) for (let j = -1; j <= 1; j++) { const x = p.x + ax * (k + off) + dd[0] * j, y = p.y + ay * (k + off) + dd[1] * j; if (ok(x, y)) cells.push({ x, y }); }
    dir = dd;
  }
  const seen = new Set();
  return { tiles: cells.filter(c => { const k = c.y * f.w + c.x; if (seen.has(k)) return false; seen.add(k); return true; }), dir };
}

/** Planes 116, 129: a pending hazard lands on every non-native body standing on its marks (each once). */
// Each hazard has its own fixed damage budget in planes.json, independent of the portal's host floor.
function landHazard(state, h, events) {
  const f = state.floor, el = f.plane, p = player(state), struck = new Set();
  const effects = PL[HAZARD[el].row].effects[0].effects[0].then, hit = effects[0];
  events.push({ type: 'telegraph-end', id: OWNER }, { type: 'plane-hazard', plane: el, tiles: h.tiles, shake: el === 'earth' ? 7 : el === 'air' ? 6 : el === 'fire' ? 5 : 0 });
  for (const c of h.tiles) {
    for (const t of live(state)) {
      if (t.x !== c.x || t.y !== c.y || native(t) || struck.has(t.id)) continue;
      struck.add(t.id);
      const me = t.side === 'player';
      if (el === 'light') {
        const n = hurt(state, t, amount(hit.amount, { state }), 'light', null, null, events);
        const bl = t.hp > 0 && applyStatus(state, t, 'blind', { turns: 2 }, events);
        if (me) say(events, `Light flare: ${n}${bl || t.statuses.blind ? '; Blind' : ''}.`);
      } else if (el === 'earth') hurt(state, t, amount(hit.amount, { state }), 'phys', null, me && 'Falling rocks', events);
      else if (el === 'fire') { hurt(state, t, amount(hit.amount, { state }), 'fire', null, me && 'Burning rocks', events); if (t.hp > 0) applyStatus(state, t, 'burn', { turns: effects[1].turns, magnitude: amount(effects[1].magnitude, { state }) }, events); }
      else if (el === 'water') {
        hurt(state, t, amount(hit.amount, { state }), 'ice', null, me && 'Surge', events);
        if (t.hp > 0) { push(state, t, h.dx, h.dy, 1, events); if (me) runEffect({ verb: 'add-stack', status: 'chill' }, { state, owner: t, target: t, events }); }
      } else { hurt(state, t, amount(hit.amount, { state }), 'phys', null, me && 'Gale', events); if (t.hp > 0) push(state, t, h.dx, h.dy, 2, events); }
      if (p.hp <= 0) return;
    }
    if (el === 'fire' && next(state.rng) < 0.4) ignite(state, c.x, c.y, false, 3);
  }
}

function hazards(state, events) {
  const f = state.floor, el = f.plane, H = (f.planeHazard ??= { n: 0, pending: null }), row = HAZARD[el];
  H.n++;
  const pend = H.pending;
  if (pend && state.now >= pend.landAt && state.actions > pend.shownIn) {
    H.pending = null;
    f.marks = (f.marks ?? []).filter(m => m.owner !== OWNER);
    landHazard(state, pend, events);
    if (['fire', 'water', 'air'].includes(el) || player(state).hp <= 0) return;   // rule 129: the landing posts nothing
  }
  if (!row || H.n % row.every || H.pending) return;
  const { tiles, dir } = hazardCells(state, el);
  if (!tiles.length && el !== 'light') return;   // rule 120: a light telegraph is posted even with no cells
  H.pending = { tiles, landAt: state.now + 2 * TURN, shownIn: state.actions, dx: dir?.[0] ?? 1, dy: dir?.[1] ?? 0 };
  (f.marks ??= []).push({ owner: OWNER, tiles, warning: row.key, colour: ui.warningColours[row.key] });
  say(events, warningWords(row.key), { warning: true });
  events.push({ type: 'telegraph', id: OWNER, tiles, warning: row.key });
}

/** A30, answer 4: lava beside and deep water under hurt non-native, non-airborne bodies. Vents push. */
function standing(state, events) {
  const f = state.floor, el = f.plane, p = player(state);
  if (el === 'fire') {
    const lavaBeside = b => D4.some(([dx, dy]) => tileAt(f, b.x + dx, b.y + dy) === T.LAVA);
    for (const t of live(state)) {
      if (airborne(t) || native(t) || !lavaBeside(t)) continue;
      hurt(state, t, amount(PL['plane-hazard-lava-standing'].effects[0].amount, { state }), 'fire', null, t === p ? 'Lava' : null, events);
      if (p.hp <= 0) return false;
    }
  } else if (el === 'water') {
    const deep = new Set(f.deep ?? []);
    for (const t of live(state)) {
      if (airborne(t) || native(t) || !deep.has(t.y * f.w + t.x)) continue;
      hurt(state, t, amount(PL['plane-hazard-deep-water'].effects[0].amount, { state }), 'ice', null, t === p ? 'Deep water' : null, events);
      if (p.hp <= 0) return false;
      if (t === p) runEffect({ verb: 'add-stack', status: 'chill' }, { state, owner: p, target: p, events });
    }
  } else if (el === 'air') {
    if ((f.vents ?? []).some(v => v.x === p.x && v.y === p.y) && !p.statuses.root) {
      const [dx, dy] = D8[Math.floor(next(state.rng) * 8)];   // answer 3: a uniform one of the 8 neighbours
      if (push(state, p, dx, dy, 1, events)) { say(events, 'Air vent: pushed.', { sfx: 'trap-spark' }); events.push({ type: 'plane-vent', at: { x: p.x, y: p.y }, sfx: 'trap-spark' }); }
    }
  }
  return true;
}

/** A20: Snuffed counts down on the plane's pulse (statuses.js ticks it); its end is said here. Regeneration. */
function snuffAndRegen(state, events) {
  const p = player(state);
  if (p.statuses.snuffed) p.wasSnuffed = true;
  else if (p.wasSnuffed) { p.wasSnuffed = false; say(events, 'Your light steadies.'); refreshSight(state, events); }
  for (const a of live(state)) {
    if (a.side !== 'foe' || a.hp >= a.maxhp || a.statuses.burn || state.now - (a.burnedAt ?? -1e9) < 5 * TURN) continue;
    if (!(a.passives ?? []).some(ps => ps.effects?.some(e => e.verb === 'heal' && e.regen))) continue;
    runEffect({ verb: 'heal', amount: 4 }, { state, owner: a, target: a, source: a, events });
  }
}

function planePulse(state, events) {
  const f = state.floor, p = player(state);
  if (!f.plane) {
    // Off a plane Snuffed still caps sight but does not count down (planes.json plane-hazard-snuffed offPlane).
    if (p.statuses.snuffed) p.statuses.snuffed.born = state.now + 1;
    return;
  }
  prepare(state);
  snuffAndRegen(state, events);
  if (!standing(state, events)) return;
  hazards(state, events);
}
onPulse('planes', planePulse);
