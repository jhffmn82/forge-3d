// Puzzle rooms in play (spec/world.md "Puzzles: the plan" 18-21, "Puzzles: each kind" 22-58, turn phases A13-A14;
// data/puzzles.json). The rooms are built by src/world/puzzles/build.js; this reads floor.puzzles, floor.crystalVault
// and floor.treasury and the flags on their props, items and traps.
//   A13 (each action): spell, sigil, blast and spill footprints touching a room (rules 20-21, 25, 40, 49), fire ground
//        on a room (effects.md G4), entering a room (rules 24, 53), mastery and status solves (19, 30, 33, 44, 46, 51),
//        the Air 3 wind over a chasm (29)
//   A14 (each action): fire on or beside a hoard block melts it (39)
//   world pulse (ruled 2026-10-15, answer 1): the burning room keeps burning (35), the baths scald (42), the sentries
//        fire (51), the cold water saps (32, answer 19)
//   bumps: hoard ice (38), the guardian lever (47), the elemental lock (57, a confirm; puzzleCommand takes the yes),
//        the crystal door and the sealed treasury door (56, 58, W54)
//   items: taking a crystal treasure shatters the rest (56); five offerings at the bowl (27)

import puzzles from '../../data/puzzles.json' with { type: 'json' };
import abilities from '../../data/abilities.json' with { type: 'json' };
import sigils from '../../data/sigils.json' with { type: 'json' };
import props from '../../data/props.json' with { type: 'json' };
import * as SP from './set-pieces.js';
import { onPulse } from './pulse-hooks.js';
import { registerPhase } from './phases.js';
import { refreshSight } from './sight.js';
import { applyStatus } from './statuses.js';
import { dealDamage } from './damage.js';
import { amount } from './amount.js';
import { breakProp } from './props.js';
import { makeCreature } from './monsters.js';
import { T, tileAt, opaque } from '../data/tiles.js';
import { castFootprint } from './effects/select.js';

const R = puzzles.rows, A = abilities.rows, S = sigils.rows, P = props.rows;
const D4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const cheb = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
const man = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
const inRect = (r, x, y) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
const say = (events, words, o = {}) => events.push({ type: 'log', words, ...o });
const hero = state => state.actors[state.playerId];
const aff = (state, el) => state.hero?.affinity?.[el] ?? 0;
const ELEMENT_OF = kind => R[kind]?.element;

/** The sigil room at (x, y), or null. */
export const puzzleAt = (state, x, y) => (state.floor?.puzzles ?? []).find(r => inRect(r, x, y)) ?? null;
const atDoor = (state, x, y) => (state.floor?.puzzles ?? []).find(r => r.door.x === x && r.door.y === y) ?? null;
/** Rule 19 and answer 17: 3 affinity in the room's element (baths and the drowned cellar too, ruled 2026-10-15). */
const mastered = (state, kind) => aff(state, ELEMENT_OF(kind)) >= 3;
const levitating = p => !!p.statuses?.levitate;
const hidden = p => !!p.statuses?.hidden;
const stone = p => !!p.statuses?.['stone-skin'];
const roomCells = r => { const out = []; for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) out.push({ x, y }); return out; };

/** Keeps the room list the renderer and sight read in step with a room's darkness. */
function setDark(state, room, dark) {
  room.dark = dark;
  const r = (state.floor.rooms ?? []).find(q => q.x === room.x && q.y === room.y && q.w === room.w && q.h === room.h);
  if (r) r.dark = dark;
}

/** Rule 18: marks the room solved, with what solving it does to the room, the log line and the sound. */
export function solvePuzzle(state, room, how, events) {
  if (!room || room.solved) return false;
  const f = state.floor, k = room.kind;
  room.solved = true;
  if (k === 'poisonvault') f.fields = (f.fields ?? []).filter(x => !(x.puzzleDoor && x.puzzleDoor.x === room.door.x && x.puzzleDoor.y === room.door.y));
  if (k === 'baths' || room.burning) {
    for (const c of roomCells(room)) {
      const i = c.y * f.w + c.x;
      if (f.burning) delete f.burning[i];
      if (room.burning && f.tiles[i] === T.FLOOR) { f.tiles[i] = T.WATER; f.ground[i] = 0; }
    }
    if (room.burning) events.push({ type: 'ground', at: { x: room.cx, y: room.cy } });
  }
  if (k === 'darktraps') { setDark(state, room, false); for (const t of f.traps ?? []) if (t.puzzle && inRect(room, t.x, t.y)) t.found = true; }
  if (k === 'hoard') {
    const gone = f.props.filter(p => p.hoard);
    f.props = f.props.filter(p => !p.hoard);
    for (const p of gone) events.push({ type: 'prop-broken', at: { x: p.x, y: p.y }, id: p.id, melted: true });
  }
  say(events, `<b>${R[k].name}:</b> ${how}`, { cls: 'c-kill', sfx: 'puzzle-solved' });
  refreshSight(state, events);
  return true;
}

// ---------------------------------------------------------------- footprints (rules 20-21)

const square = (c, n) => { const out = []; for (let dy = -n; dy <= n; dy++) for (let dx = -n; dx <= n; dx++) out.push({ x: c.x + dx, y: c.y + dy }); return out; };

/** The element a cast counts as on puzzle rooms: its element, or the type of its damage (ice, poison). */
function castElements(row) {
  const out = new Set([row.element]);
  const walk = list => { for (const e of list ?? []) { if (e.type) out.add(e.type); walk(e.then); walk(e.effects); walk(e.else); walk(e.options); } };
  walk(row.effects);
  return out;
}

/** Rule 20: what touching a room with an element does; fire also melts the hoard blocks it covers. */
function footprint(state, els, tiles, events) {
  const f = state.floor, touches = room => tiles.some(t => inRect(room, t.x, t.y) || (t.x === room.door.x && t.y === room.door.y));
  for (const room of f.puzzles ?? []) {
    if (room.solved || !touches(room)) continue;
    if (els.has('fire') && room.kind === 'hoard') solvePuzzle(state, room, 'the frozen chamber thaws.', events);
    else if (els.has('fire') && room.kind === 'poisonvault') solvePuzzle(state, room, 'the fire burns away the poison gas.', events);
    else if (els.has('light') && room.kind === 'darktraps') solvePuzzle(state, room, 'light reveals the hidden traps.', events);
    else if (room.burning && (els.has('water') || els.has('ice'))) solvePuzzle(state, room, 'the flames die away.', events);
    else if (room.kind === 'baths' && els.has('poison')) solvePuzzle(state, room, 'the poison cools the scalding stone.', events);
  }
  if (els.has('fire')) {
    const melted = f.props.filter(p => p.hoard && tiles.some(t => t.x === p.x && t.y === p.y));
    if (melted.length) { f.props = f.props.filter(p => !melted.includes(p)); for (const p of melted) events.push({ type: 'prop-broken', at: { x: p.x, y: p.y }, id: p.id, melted: true }); }
  }
  const hoard = (f.puzzles ?? []).find(r => r.kind === 'hoard' && !r.solved);
  if (hoard && !f.props.some(p => p.hoard && inRect(hoard, p.x, p.y))) solvePuzzle(state, hoard, 'the last of the ice melts away.', events);
}

/** Rules 25, 40, 49: a sigil read with a room near you. */
function sigilNearRoom(state, id, events) {
  const p = hero(state), base = id.replace(/2$/, ''), greater = id.endsWith('2');
  const near = (room, r) => p.x >= room.x - r && p.x < room.x + room.w + r && p.y >= room.y - r && p.y < room.y + room.h + r;
  for (const room of state.floor.puzzles ?? []) {
    if (room.solved) continue;
    if (base === 'firestorm' && near(room, greater ? 2 : 1)) {
      if (room.kind === 'poisonvault') solvePuzzle(state, room, 'the fire burns away the poison gas.', events);
      if (room.kind === 'hoard') solvePuzzle(state, room, 'the ice runs away as water.', events);
    }
    if (base === 'heal' && room.kind === 'darktraps' && near(room, 2)) solvePuzzle(state, room, 'light reveals every trap.', events);
  }
}

/** This action's events read for footprints: casts, sigils, powder blasts (9 tiles of fire), barrel spills. */
function scanEvents(state, events, from) {
  for (let i = from; i < events.length; i++) {
    const e = events[i];
    if (e.type === 'ability' && A[e.ability]) footprint(state, castElements(A[e.ability]), castFootprint(state, A[e.ability], e.at), events);
    else if (e.type === 'sigil' && S[e.id]) sigilNearRoom(state, e.id, events);
    else if (e.type === 'explosion' && e.at && !e.boss) footprint(state, new Set(['fire']), square(e.at, 1), events);
    else if (e.type === 'prop-broken' && e.id === 'barrel-water' && e.at) footprint(state, new Set(['water']), square(e.at, 1), events);
    else if (e.type === 'prop-broken' && e.id === 'barrel-poison' && e.at) footprint(state, new Set(['poison']), [e.at], events);
  }
}

// ---------------------------------------------------------------- A13: each action

/** The library keepers of a room (rule 52). */
const keepers = (state, door) => state.order.map(id => state.actors[id]).filter(a => a.hp > 0 && a.libraryRoom && a.libraryRoom.x === door.x && a.libraryRoom.y === door.y);

/** Rules 24, 53: entering a room. */
function entered(state, events) {
  const p = hero(state), here = puzzleAt(state, p.x, p.y);
  for (const r of state.floor.puzzles ?? []) if (r.kind === 'poisonvault' && r !== here) r.gasEntered = false;
  if (!here) return;
  if (here.kind === 'poisonvault' && !here.solved && !here.gasEntered) {
    here.gasEntered = true;
    applyStatus(state, p, 'poison', { turns: 3, magnitude: 2, durationModifiers: false }, events);
  }
  if (here.kind === 'library' && !here.entered) {
    here.entered = true;
    const k = keepers(state, here.door);
    for (const a of k) { a.asleep = false; a.hunting = true; a.goal = { x: p.x, y: p.y }; events.push({ type: 'alerted', id: a.id, toward: a.goal }); }
    if (k.length) say(events, 'The library guardians wake.', { cls: 'c-info' });
  }
}

/** Rule 46: the stone sentinels wake (marked solved, as 1.7 does: WO21). */
function wakeSentinels(state, room, events) {
  const f = state.floor, woke = f.props.filter(q => q.sentinel && inRect(room, q.x, q.y));
  room.solved = true;
  f.props = f.props.filter(q => !woke.includes(q));
  const S7 = R.sentinels.sentinel;
  for (const q of woke) {
    const m = makeCreature(S7.base, q.x, q.y);
    Object.assign(m, { name: S7.name, sentinelRoom: { ...room.door }, maxhp: S7.hp, hp: S7.hp, dmg: [...S7.dmg], acc: S7.acc, armour: S7.armour, hunting: true, asleep: false, t: hero(state).t });
    m.look = { ...m.look, art: S7.sprite, colour: S7.colour };
    state.actors[m.id] = m; state.order.push(m.id);
    events.push({ type: 'spawned', id: m.id, at: { x: q.x, y: q.y } });
  }
  events.push({ type: 'shake', amount: 8 });
  say(events, '<b>The stone sentinels wake!</b>', { cls: 'c-you', sfx: 'golem-alert' });
}

/** Rules 19, 30, 33, 44, 46, 49, 51: the room the hero stands in, solved by mastery or a status. */
function standing(state, events) {
  const p = hero(state), room = puzzleAt(state, p.x, p.y);
  if (!room || room.solved) return;
  const k = room.kind, f = state.floor;
  if (k === 'darktraps' && mastered(state, k)) solvePuzzle(state, room, 'your inner light shows every trap.', events);
  else if (k === 'baths' && mastered(state, k)) solvePuzzle(state, room, 'the scalding stone cannot warm your cool blood.', events);
  else if (k === 'sentinels' && !hidden(p)) {
    if (stone(p) || mastered(state, k)) solvePuzzle(state, room, 'the sentinels take you for one of their own and sleep on.', events);
    else wakeSentinels(state, room, events);
  } else if (k === 'sentries' && (hidden(p) || mastered(state, k))) solvePuzzle(state, room, 'the sentries stare straight through you.', events);
  else if (k === 'chasm' && (levitating(p) || mastered(state, k)) && tileAt(f, p.x, p.y) !== T.CHASM) {
    const far = farthestCell(state, room);
    if (far && cheb(p, far) <= 1) solvePuzzle(state, room, 'you cross the chasm.', events);
  } else if (k === 'drowned' && (levitating(p) || mastered(state, k))) solvePuzzle(state, room, 'you cross the water untouched.', events);
  else if (k === 'spikes' && (stone(p) || mastered(state, k))) solvePuzzle(state, room, 'the spikes break on your stone skin.', events);
}

/** Rule 13 for a built room: its cell farthest from the door (the centre and the door-side cells never count). */
function farthestCell(state, room) {
  const f = state.floor;
  const cells = roomCells(room).filter(c => !(c.x === room.cx && c.y === room.cy) && f.tiles[c.y * f.w + c.x] !== T.WALL);
  return cells.sort((a, b) => man(b, room.door) - man(a, room.door))[0] ?? null;
}

/** Rule 29: Air 3 and a chasm beside you or under you: the wind carries you (Levitate 1). */
function windCarry(state, events) {
  const p = hero(state), f = state.floor;
  if (aff(state, 'air') < 3) { p.windCarry = false; return; }
  const on = tileAt(f, p.x, p.y) === T.CHASM;
  let near = on;
  for (let dy = -1; dy <= 1 && !near; dy++) for (let dx = -1; dx <= 1; dx++) if (tileAt(f, p.x + dx, p.y + dy) === T.CHASM) { near = true; break; }
  if (!near) { p.windCarry = false; return; }
  if (!on) p.windCarry = true;
  if (p.windCarry) applyStatus(state, p, 'levitate', { turns: 1 }, events);
}

const mark = new WeakMap();   // events arrays already scanned up to an index (a step may call A13 once per action)
registerPhase('puzzle-hazards', (state, ctx, events) => {
  const f = state.floor;
  if (!f) return;
  if (f.puzzles?.length) {
    scanEvents(state, events, mark.get(events) ?? 0);
    // effects.md G4: fire ground on the gas vault or the hoard (any spell, blast or trap's fire) clears it.
    for (const room of f.puzzles) {
      if (room.solved || !(room.kind === 'poisonvault' || room.kind === 'hoard') || !f.burning) continue;
      const lit = [...roomCells(room), room.door].some(c => f.burning[c.y * f.w + c.x]);
      if (lit) solvePuzzle(state, room, room.kind === 'hoard' ? 'the frozen chamber thaws.' : 'the fire burns away the poison gas.', events);
    }
    if (ctx.kind === 'move') entered(state, events);
    standing(state, events);
  }
  windCarry(state, events);
  mark.set(events, events.length);
});

// ---------------------------------------------------------------- A14: melt hoard

registerPhase('melt-hoard', (state, ctx, events) => {
  const f = state.floor;
  if (!f?.burning || !f.props.some(p => p.hoard)) return;
  const gone = f.props.filter(p => p.hoard && square(p, 1).some(c => f.burning[c.y * f.w + c.x]));
  if (!gone.length) return;
  f.props = f.props.filter(p => !gone.includes(p));
  for (const p of gone) events.push({ type: 'prop-broken', at: { x: p.x, y: p.y }, id: p.id, melted: true });
  say(events, gone.length > 1 ? `Fire melts ${gone.length} blocks of ice.` : 'Fire melts a block of ice.', { cls: 'c-kill', sfx: 'ice-melt' });
  if (!f.props.some(p => p.hoard)) { const hr = (f.puzzles ?? []).find(r => r.kind === 'hoard' && !r.solved); if (hr) solvePuzzle(state, hr, 'the last of the ice runs away as water.', events); }
});

// ---------------------------------------------------------------- the world pulse

/** 1.7 propProjectilePath: a sentry's line to the hero, stopped by opaque tiles and blocking props. */
function hasShot(state, from, to) {
  const f = state.floor, n = Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y));
  for (let i = 1; i < n; i++) {
    const x = Math.round(from.x + (to.x - from.x) * i / n), y = Math.round(from.y + (to.y - from.y) * i / n);
    if (opaque(f, x, y) || f.props.some(q => q.x === x && q.y === y && P[q.id]?.blocks && !P[q.id]?.flat)) return false;
  }
  return true;
}

onPulse('puzzles', (state, events) => {
  const f = state.floor;
  if (!f?.puzzles?.length) return;
  // Rule 35: the burning room never burns out; its kept barrel never catches (1.7 burn:0).
  if (f.burning) for (const q of f.props) if (q.noBurn) delete f.burning[q.y * f.w + q.x];
  for (const room of f.puzzles) {
    if (!room.burning || room.solved) continue;
    f.burning ??= {};
    for (const c of roomCells(room)) {
      const i = c.y * f.w + c.x;
      if (f.tiles[i] !== T.FLOOR || f.props.some(q => q.noBurn && q.x === c.x && q.y === c.y)) continue;
      f.burning[i] = { n: Math.max(f.burning[i]?.n ?? 0, 3), player: !!f.burning[i]?.player };
    }
  }
  const p = hero(state), room = puzzleAt(state, p.x, p.y);
  if (!room || room.solved || p.hp <= 0) return;
  // Rule 42: the scalding stone (not floating; Earth 3 solves it on entry instead).
  if (room.kind === 'baths' && !levitating(p) && !mastered(state, 'baths')) {
    const n = dealDamage(state, { target: p, source: null, amount: amount(R.baths.hazards[0].effects[0].amount, { state }), type: 'fire', tags: ['environment'] }, events);
    say(events, `The scalding stone burns you: ${n} damage.`, { cls: 'c-you' });
  }
  // Rule 51: each sentry with a clear shot.
  if (room.kind === 'sentries' && !hidden(p) && aff(state, 'shadow') < 3) {
    for (const s of f.props.filter(q => q.sentry && inRect(room, q.x, q.y))) {
      if (p.hp <= 0 || !hasShot(state, s, p)) continue;
      events.push({ type: 'bolt', from: { x: s.x, y: s.y }, to: { x: p.x, y: p.y }, element: 'light' });
      const n = dealDamage(state, { target: p, source: null, amount: amount(R.sentries.hazards[0].effects[0].amount, { state }), type: 'light', tags: ['environment'] }, events);
      say(events, `A sentry's eyes flare: ${n} damage.`, { cls: 'c-you' });
    }
  }
  // Rule 32, answer 19: each game turn in the cellar's water, not floating, 8% of max HP as ice, no defences.
  if (room.deep && tileAt(f, p.x, p.y) === T.WATER && !levitating(p) && !mastered(state, 'drowned')) {
    const n = Math.max(1, Math.round(p.maxhp * 0.08));
    dealDamage(state, { target: p, source: null, amount: n, type: 'ice', premitigated: true, bypassShields: true, tags: ['environment', 'drowning'] }, events);
    say(events, `The cold water saps you: ${n} damage.`, { cls: 'c-you' });
  }
});

// ---------------------------------------------------------------- bumps

/** Rule 38: the hoard's ice: Fire 3 melts it at a touch (an action); otherwise blows glance off (no action). */
const iceUse = SP.PROP_USES['ice-block'];
SP.PROP_USES['ice-block'] = (state, prop, events) => {
  if (!prop.hoard) return iceUse ? iceUse(state, prop, events) : breakProp(state, prop.x, prop.y, events, { by: state.playerId }) ? 'act' : 'refused';
  const hr = (state.floor.puzzles ?? []).find(r => r.kind === 'hoard');
  if (aff(state, 'fire') >= 3) { if (hr) solvePuzzle(state, hr, 'the ice melts at your touch.', events); return 'act'; }
  events.push({ type: 'log', words: 'The ice is too hard to break. Only fire will melt it.', cls: 'c-info', sfx: 'ice-hit' },
    { type: 'burst', at: { x: prop.x, y: prop.y }, kind: 'ice', n: 6, spread: 0.03 });   // P11 (1.7 puzzles.js:542): chips off the ice
  return 'refused';
};

/** Rule 47: the guardian shutoff lever. */
SP.PROP_USES['lever-up'] = (state, prop, events) => {
  const f = state.floor, room = prop.puzzleSwitch ? atDoor(state, prop.roomDoor.x, prop.roomDoor.y) : null;
  if (!room) { events.push({ type: 'blocked', id: state.playerId, at: { x: prop.x, y: prop.y } }); return 'refused'; }
  if (room.disabled) return 'refused';
  room.disabled = true; room.solved = true; prop.used = true; prop.id = 'lever-down';
  if (room.kind === 'library') {
    setDark(state, room, false);
    // WC14 (1.7 beta-world.js:70): the keepers go in a burst of light, with no death of their own.
    for (const a of keepers(state, room.door)) { a.hp = 0; events.push({ type: 'died', id: a.id, dismissed: true, vanish: true, quiet: true, at: { x: a.x, y: a.y }, burst: { kind: 'light', n: 16, spread: 0.05 } }); }
    prop.light = { col: '#FFE0A0' };
  }
  for (const q of f.props) if (inRect(room, q.x, q.y) && (q.sentinel || q.sentry)) { q.sentinel = false; q.sentry = false; q.light = null; q.dim = true; }
  for (const id of state.order) {
    const a = state.actors[id];
    if (a.hp <= 0 || !a.sentinelRoom || a.sentinelRoom.x !== room.door.x || a.sentinelRoom.y !== room.door.y) continue;
    // WC14 (beta-world.js:74): a sentinel goes straight back to stone, the statue drawn the same moment.
    a.hp = 0; events.push({ type: 'died', id: a.id, dismissed: true, vanish: true, quiet: true, statue: true, at: { x: a.x, y: a.y } });
    f.props.push({ id: 'statue', x: a.x, y: a.y, keep: true, dim: true, guardianStatue: true });
  }
  events.push({ type: 'door', at: { x: prop.x, y: prop.y } });   // the lever down and the statues drawn
  say(events, 'The guardians go still.', { cls: 'c-good', sfx: 'lever' });
  refreshSight(state, events);
  return 'act';
};

/** Rule 57: the elemental lock asks first (1.7's confirm box); nothing is spent until the hero says yes. */
SP.PROP_USES['elemental-lock'] = (state, prop, events) => {
  const h = state.hero, cost = prop.moteCost ?? 1, el = prop.element, s = cost === 1 ? '' : 's';
  if (prop.opened) return 'refused';
  if ((h.motes?.[el] ?? 0) < cost) { say(events, `The lock requires ${cost} ${el} mote${s}.`, { cls: 'c-info' }); return 'refused'; }
  events.push({ type: 'confirm', id: 'elemental-lock', title: 'Elemental lock', text: `Offer the lock <b>${cost} ${el} mote${s}</b>?`, yes: 'Offer the mote', command: { type: 'puzzle', action: 'lock', x: prop.x, y: prop.y } });
  return 'refused';
};

/** The lock's offer accepted (an action): the motes go, the treasury's seal dissolves. */
function offerLock(state, c, events) {
  const f = state.floor, h = state.hero, p = hero(state);
  const prop = f.props.find(q => q.id === 'elemental-lock' && q.x === c.x && q.y === c.y);
  const cost = prop?.moteCost ?? 1;
  if (!prop || prop.opened || cheb(p, prop) !== 1 || (h.motes?.[prop.element] ?? 0) < cost) return 'refused';
  h.motes[prop.element] -= cost;
  prop.opened = true;
  f.tiles[prop.door.y * f.w + prop.door.x] = T.OPEN_DOOR;
  if (f.treasury) f.treasury.opened = true;
  events.push({ type: 'door', at: { ...prop.door }, open: true });
  say(events, 'The lock drinks the mote. The seal dissolves.', { cls: 'c-kill', sfx: 'puzzle-solved' });
  refreshSight(state, events);
  return 'act';
}

/** Commands a puzzle's confirm sends back (game.js resolveHeroCommand: {type:'puzzle', action}). */
export function puzzleCommand(state, c, events) {
  if (c.action === 'lock') return offerLock(state, c, events);
  return 'refused';
}

/** Rules 56, 58 (W54): the crystal door opens with a crystal key; the treasury's door says where its lock is. */
SP.TILE_USES.push((state, x, y, events) => {
  const f = state.floor;
  if (tileAt(f, x, y) !== T.SEALED) return undefined;
  const cv = f.crystalVault;
  if (cv && !cv.opened && cv.door.x === x && cv.door.y === y) {
    const h = state.hero;
    if ((h.crystalKeys ?? 0) > 0) {
      h.crystalKeys -= 1; cv.opened = true;
      f.tiles[y * f.w + x] = T.OPEN_DOOR;
      events.push({ type: 'door', at: { x, y }, open: true, sfx: 'door-unlock' });
      say(events, 'The crystal key rings true. <b>Take one treasure</b>; the rest will shatter.', { cls: 'c-kill' });
      refreshSight(state, events);
      return 'act';
    }
    say(events, 'A door of solid crystal. A <b>crystal key</b> on this floor opens it.', { cls: 'c-info', sfx: 'door-locked' });
    return 'refused';
  }
  const tr = f.treasury;
  if (tr && tr.door.x === x && tr.door.y === y) {
    const s = tr.moteCost === 1 ? '' : 's';
    say(events, `Sealed by elemental magic. A lock pedestal elsewhere on this floor requires ${tr.moteCost} ${tr.element} mote${s}.`, { cls: 'c-info' });
    return 'refused';
  }
  return undefined;
});

/** CB39 (1.7 systems.js:321 bumpProp offeringBowl): walking into the offering bowl reads its inscription; no time spent. */
SP.TILE_USES.push((state, x, y, events) => {
  if (!state.floor.props.some(q => q.x === x && q.y === y && q.offeringBowl)) return undefined;
  say(events, 'Leave an offering at my feet and you will be rewarded with change.', { cls: 'c-info' });
  return 'refused';
});

// ---------------------------------------------------------------- items

/** Rule 56: one crystal treasure taken, the others shatter with their markers. Called when a floor item is taken. */
export function itemTaken(state, i, events) {
  if (i?.item?.kind === 'key' && i.item.key === 'crystal') state.hero.crystalKeys = (state.hero.crystalKeys ?? 0) + 1;
  const f = state.floor, cv = f?.crystalVault;
  if (!i?.crystal || !cv || cv.claimed) return;
  cv.claimed = true;
  const rest = f.items.filter(x => x.crystal && x !== i && inRect(cv.room, x.x, x.y));
  f.items = f.items.filter(x => !rest.includes(x));
  f.props = f.props.filter(q => !(q.crystalVault && inRect(cv.room, q.x, q.y)));
  if (rest.length) say(events, 'The other treasures shatter.', { cls: 'c-you', sfx: 'ice-melt' });
  for (const x of rest) events.push({ type: 'burst', at: { x: x.x, y: x.y }, kind: 'ice', n: 20, spread: 0.06 });   // P11 (1.7 puzzles.js:426)
}

/** Rule 27: gear or a sigil dropped beside the bowl while you stand beside it; five there make a Transmutation sigil. */
export function itemDropped(state, i, events) {
  const f = state.floor, p = hero(state);
  const accepted = it => ['weapon', 'armour', 'offhand', 'ring', 'amulet', 'sigil'].includes(it?.kind);
  if (!accepted(i?.item)) return;
  const bowl = f.props.find(q => q.offeringBowl && cheb(p, q) === 1 && cheb(i, q) === 1);
  if (!bowl) return;
  const room = puzzleAt(state, bowl.x, bowl.y);
  if (!room || room.solved) return;
  const offerings = f.items.filter(x => accepted(x.item) && cheb(x, bowl) <= 1);
  if (offerings.length < 5) return;
  const gone = offerings.slice(0, 5);
  f.items = f.items.filter(x => !gone.includes(x));
  f.props = f.props.filter(q => q !== bowl);
  f.items.push({ x: bowl.x, y: bowl.y, item: { kind: 'sigil', id: 'transmutation', count: 1 } });
  events.push({ type: 'drops', at: { x: bowl.x, y: bowl.y } }, { type: 'burst', at: { x: bowl.x, y: bowl.y }, kind: 'poison', n: 30, spread: 0.08 });   // P12 (1.7 puzzles.js:309)
  solvePuzzle(state, room, 'the bowl and your offerings vanish, leaving transmutation.', events);
}

SP.ITEM_TAKEN.push(itemTaken);
SP.ITEM_DROPPED.push(itemDropped);
