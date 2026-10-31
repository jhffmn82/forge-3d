// The Unmaker, floor 25 (spec/bosses.md U1-U9, spec/chaos.md 69-83; floors.json unmaker-crucible, unmaker-pylon-beam;
// 1.7 js/world/chaos/unmaker-encounter.js, unmaker-preview.js @3c8b312). One 2x2 body in three forms, its summons,
// marked big moves that always leave a reachable safe step, the Prism Pylons of the Unbound, the Crucible's gates,
// and the Forge of the Elements that ends the run. Timers are world-clock values (bosses.md decided 1).
// The 2x2 body is the boss at its top-left plus three limbs (limbOf) that pass every hit to it.

import { registerSetPiece, CREATURE_HOOKS } from './set-pieces.js';
import { onPulse } from './pulse-hooks.js';
import { weaponAttack } from './attack.js';
import { dealDamage } from './damage.js';
import { hitChance, accuracyOf, evasionOf, hostileSpellLands } from './hit.js';
import { monsterRow, makeCreature, chaosBody, makeLimb } from './monsters.js';
import { bodyAt } from './moves.js';
import { lineClear } from './sight.js';
import { T, tileAt } from '../data/tiles.js';
import { chaosRegionAt, syncGates } from './chaos-map.js';
import { sDMG } from './chaos-ai.js';
import { lineCells } from '../lib/geometry.js';

const FORMS = ['unmaker-tyrant', 'unmaker-unbound', 'unmaker-heart'];
const BOLT = ['fire', 'ice', 'lightning', 'light', 'dark'];
const SUMMONS = ['chaos-horned-reaver', 'chaos-prism-seer', 'chaos-gorehound', 'chaos-lash-dancer', 'chaos-rotling'];
const WARN = { cleave: 'Great Cleave: circle its flank!', rupture: 'Rupture: leave the marked ground!', ring: 'Inversion Pulse: get in close!', pulse: 'Discord Pulse: inner ring, then outer. Step out, then back in!' };
import { cheb } from '../lib/geometry.js';
/** Distance from a 2x2 body's footprint to a cell. */
const fd = (e, t) => Math.max(Math.max(e.x - t.x, 0, t.x - (e.x + 1)), Math.max(e.y - t.y, 0, t.y - (e.y + 1)));
const party = state => state.order.map(id => state.actors[id]).filter(b => b.hp > 0 && (b.side === 'player' || b.side === 'ally'));
const enc = state => state.floor?.crucible?.encounter ?? null;
const bossOf = state => { const s = enc(state); const b = s && state.actors[s.bossId]; return b && b.hp > 0 ? b : null; };

/** Chaos 77: an arena cell: the crucible region between the gates, floor or open door, no blocking prop. */
export function arenaCell(state, x, y) {
  const f = state.floor, c = f.crucible;
  if (!c || y <= c.rearSeal.y || y >= c.entryGate.y || chaosRegionAt(f, x, y) !== 'crucible') return false;
  const t = tileAt(f, x, y);
  return (t === T.FLOOR || t === T.OPEN_DOOR) && !f.props.some(p => p.x === x && p.y === y && p.blocks);
}
const fits = (state, e, x, y) => {
  for (let yy = y; yy < y + 2; yy++) for (let xx = x; xx < x + 2; xx++) {
    if (!arenaCell(state, xx, yy)) return false;
    const b = bodyAt(state, xx, yy); if (b && b !== e && b.limbOf !== e?.id) return false;
  }
  return true;
};
function placeLimbs(state, e) {
  const cells = [[1, 0], [0, 1], [1, 1]];
  e.limbs.forEach((id, i) => { const l = state.actors[id]; if (l) { l.x = e.x + cells[i][0]; l.y = e.y + cells[i][1]; } });
}
function moveBoss(state, e, x, y, events, extra = {}) {
  const from = { x: e.x, y: e.y };
  e.x = x; e.y = y; placeLimbs(state, e);
  events.push({ type: 'moved', id: e.id, from, to: { x, y }, ...extra });
}

/** Chaos 73: bumping the entry gate when ready starts the fight. */
export function startFight(state, events) {
  const f = state.floor, c = f.crucible, p = state.actors[state.playerId];
  if (!c || c.phase !== 'ready' || p.hp <= 0) return false;
  const friends = party(state).sort((a, b) => (a.side === 'player' ? -1 : b.side === 'player' ? 1 : a.id < b.id ? -1 : 1));
  const spots = [], A = c.party.anchor, Rr = c.party.rect;
  for (let y = Rr.y0; y <= Rr.y1; y++) for (let x = Rr.x0; x <= Rr.x1; x++) if (arenaCell(state, x, y) && !state.order.some(id => { const a = state.actors[id]; return a.hp > 0 && !friends.includes(a) && a.x === x && a.y === y; })) spots.push({ x, y });
  spots.sort((a, b) => cheb(a, A) - cheb(b, A) || b.y - a.y || a.x - b.x);
  if (spots.length < friends.length || !fits(state, null, c.bossStart.x, c.bossStart.y)) return false;
  friends.forEach((b, i) => { const from = { x: b.x, y: b.y }; b.x = spots[i].x; b.y = spots[i].y; events.push({ type: 'teleported', id: b.id, from, to: { ...spots[i] } }); });
  const e = makeCreature(FORMS[0], c.bossStart.x, c.bossStart.y);
  Object.assign(e, { set: 'unmaker', boss: true, size: 2, hunting: true, asleep: false, t: p.t, noReward: true, immune: monsterRow(FORMS[0]).immune ?? ['fear', 'stun'], lastSeen: { x: p.x, y: p.y, at: state.now }, limbs: [] });
  state.actors[e.id] = e; state.order.push(e.id);
  for (let i = 0; i < 3; i++) {
    const l = makeLimb(e, i, { x: e.x, y: e.y }, { kind: 'unmaker-limb', set: 'limb', eva: e.eva, immune: ['fear', 'stun', 'knockback'] });   // decided 7 (C10g)
    state.actors[l.id] = l; state.order.push(l.id); e.limbs.push(l.id);
  }
  placeLimbs(state, e);
  c.encounter = { status: 'active', bossId: e.id, phase: 1, warning: null, majorAt: state.now + 300, rushAt: state.now, summonAt: state.now, summoned: 0, summonIds: [], cycle: 0, elIndex: 0, basic: 0, pylons: [] };
  c.phase = 'active';
  f.boss = true;
  syncGates(f);
  events.push({ type: 'log', words: 'You pass through the entrance gate, and it seals behind you. The Unmaker awakens.', sfx: 'door-open' },
    { type: 'spawned', id: e.id, at: { x: e.x, y: e.y } },
    { type: 'boss', id: e.id, name: e.name, state: 'awake', music: 'boss-unmaker' });
  return true;
}

function setForm(state, e, phase, events, quiet = false) {
  const s = enc(state), row = monsterRow(FORMS[phase - 1]), changed = phase !== s.phase;
  Object.assign(e, { kind: FORMS[phase - 1], name: row.name, dmg: [...row.dmg], armour: row.armour ?? 0, speed: row.speed ?? 100, eva: row.eva, look: { sheet: 'mob-' + row.look.sheet, art: row.look.art, ...(row.look.facesLeft ? { facesLeft: true } : {}) } });
  for (const id of e.limbs ?? []) { const l = state.actors[id]; if (l) { l.name = e.name; l.armour = e.armour; l.eva = e.eva; } }
  if (!changed) return false;
  s.phase = phase; s.warning = null; endMarks(state, e); s.majorAt = state.now + 200; s.summonAt = state.now;
  if (phase === 2) s.pylons = s.pylons?.length === 3 ? s.pylons : state.floor.crucible.pylonSites.map((p, i) => ({ id: i, x: p.x, y: p.y, readyAt: state.now + 100 * (i + 1), warning: null }));
  else s.pylons = [];
  pylonLights(state);
  if (!quiet) events.push({ type: 'log', words: phase === 2 ? 'The Unbound: 3 Prism Pylons charge beams!' : 'Heart of Discord: demons incoming!', warning: true }, { type: 'boss-form', id: e.id, phase, name: e.name });
  return true;
}
const phaseFor = e => (e.hp <= e.maxhp * 0.3 ? 3 : e.hp <= e.maxhp * 0.65 ? 2 : 1);
function pylonLights(state) {
  const f = state.floor, s = enc(state);
  f.lights = f.lights.filter(l => !l.pylon);
  for (const p of s?.pylons ?? []) { const site = f.crucible.pylonSites[p.id]; f.lights.push({ kind: 'beacon', role: 'pylon', pylon: true, x: p.x, y: p.y, colour: site.color, radius: 2.2, strength: 0.8 }); }
}

function targetFor(state, e) {
  const p = state.actors[state.playerId];
  const c = party(state).filter(t => (t.side === 'player' ? !p.statuses.hidden && (!!state.vis?.[e.y * state.floor.w + e.x] || !!state.vis?.[(e.y + 1) * state.floor.w + e.x + 1]) : lineClear(state.floor, e, t)));
  c.sort((a, b) => fd(e, a) - fd(e, b) || (a.side === 'player' ? -1 : 1));
  if (c[0]) e.lastSeen = { x: c[0].x, y: c[0].y, at: state.now };
  return c[0] ?? null;
}
const point = (e, t) => ({ x: Math.max(e.x, Math.min(e.x + 1, t.x)), y: Math.max(e.y, Math.min(e.y + 1, t.y)) });
const clearLine = (state, a, b) => lineClear(state.floor, a, b);

function hurt(state, e, t, base, type, events) {
  return dealDamage(state, { target: t, source: e, amount: sDMG(state, base), type, tags: ['area', 'unmaker'] }, events);
}
function spell(state, e, t, events) {
  const s = enc(state), type = BOLT[s.elIndex++ % BOLT.length];
  events.push({ type: 'move-used', id: e.id, move: 'unmaker-bolt', name: 'Bolt', target: t.id, ranged: true, element: type });
  const ch = hitChance(accuracyOf(state, e), evasionOf(t)) * (e.statuses.blind ? 0.6 : 1);
  // CH29 (1.7 unmaker-encounter.js:135): the hero's deflect, Blur and Lucky Streak answer the bolt.
  if (hostileSpellLands(state, e, t, ch, events, { label: 'Bolt' })) hurt(state, e, t, s.phase === 3 ? 49 : 42, type, events);
  else if (!events.at(-1)?.deflected) events.push({ type: 'miss', id: t.id });
}

function tilesAround(state, o, min, max) {
  const out = [];
  for (let y = o.y - max; y < o.y + 2 + max; y++) for (let x = o.x - max; x < o.x + 2 + max; x++) {
    const p = { x, y }, d = cheb(o, p);
    if (d >= min && d <= max && arenaCell(state, x, y) && clearLine(state, o, p)) out.push(p);
  }
  return out;
}
function legalStep(state, from, to, e) {
  if (!arenaCell(state, to.x, to.y)) return false;
  const b = bodyAt(state, to.x, to.y);
  if (b && b.side === 'foe') return false;
  if (b && (b === e || b.limbOf === e.id)) return false;
  const dx = to.x - from.x, dy = to.y - from.y;
  return !(dx && dy && !arenaCell(state, from.x + dx, from.y) && !arenaCell(state, from.x, from.y + dy));
}
function pendingTiles(state, except) {
  const s = enc(state); let out = [];
  if (s?.warning && s.warning !== except) out = out.concat(s.warning.tiles);
  for (const p of s?.pylons ?? []) if (p.warning && p.warning !== except) out = out.concat(p.warning.tiles);
  return out;
}
/** U5: every marked tile keeps a legal unmarked step beside it; else the nearest such step is unmarked. */
function safePattern(state, tiles, e, fixed = []) {
  const W = state.floor.w, held = new Set(fixed.map(t => t.y * W + t.x)), marked = new Set([...tiles, ...fixed].map(t => t.y * W + t.x));
  for (const t of [...tiles, ...fixed]) {
    let opts = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy) { const p = { x: t.x + dx, y: t.y + dy }; if (legalStep(state, t, p, e)) opts.push(p); }
    if (opts.some(p => !marked.has(p.y * W + p.x))) continue;
    opts = opts.filter(p => !held.has(p.y * W + p.x)).sort((a, b) => cheb(a, e) - cheb(b, e));
    if (opts.length) marked.delete(opts[0].y * W + opts[0].x); else if (!held.has(t.y * W + t.x)) marked.delete(t.y * W + t.x);
  }
  return tiles.filter(t => marked.has(t.y * W + t.x));
}
// CH18: 1.7 (unmaker-encounter.js:335 drawTelegraphs) shows a Discord Pulse's outer ring from the start, at the second
// level (drawBossDangerTiles due 2, the fainter red), beside the inner ring, so the hero can plan the step out and back in.
// CH17: a pylon's line carries when it fires (landAt), so it pulses slowly until its last turn (1.7 due = ceil((fireAt -
// clock) / 100)); the boss's own marks land a turn on and pulse urgently from the start (due 1).
function marks(state, owner, tiles, warning, outer = null, landAt = null) {
  const f = state.floor;
  f.marks = (f.marks ?? []).filter(m => m.owner !== owner);
  if (tiles.length) f.marks.push({ owner, tiles: tiles.map(t => ({ x: t.x, y: t.y })), warning, unmaker: true, ...(landAt !== null ? { landAt } : {}) });
  if (outer?.length) f.marks.push({ owner, tiles: outer.map(t => ({ x: t.x, y: t.y })), warning, unmaker: true, level: 2 });
}
function endMarks(state, e) { const f = state.floor; f.marks = (f.marks ?? []).filter(m => !m.unmaker || m.owner !== e.id); }

function warn(state, e, kind, t, events) {
  const s = enc(state);
  let tiles = [], outer = null, origin = { x: e.x, y: e.y };
  if (kind === 'cleave') {
    const dx = Math.sign(t.x - e.x), dy = Math.sign(t.y - e.y);
    tiles = safePattern(state, tilesAround(state, e, 1, 2).filter(c => (c.x - e.x) * dx + (c.y - e.y) * dy > 0), e);
  } else if (kind === 'rupture') {
    origin = { x: t.x, y: t.y };
    for (let y = t.y - 1; y <= t.y + 1; y++) for (let x = t.x - 1; x <= t.x + 1; x++) if (arenaCell(state, x, y)) tiles.push({ x, y });
    tiles = safePattern(state, tiles, e, pendingTiles(state));
  } else if (kind === 'ring') tiles = safePattern(state, tilesAround(state, e, 2, 5), e, pendingTiles(state));
  else { tiles = safePattern(state, tilesAround(state, e, 1, 1), e); outer = safePattern(state, tilesAround(state, e, 2, 4), e); }
  if (!tiles.length) return false;
  s.warning = { kind, tiles, outer, origin, shownIn: state.actions, landAt: state.now + 100, beat: 1 };
  marks(state, e.id, tiles, kind, outer);
  events.push({ type: 'log', words: WARN[kind], warning: true }, { type: 'telegraph', id: e.id, tiles, warning: 'warn.unmaker.' + kind }, { type: 'move-used', id: e.id, move: kind, name: kind });
  return true;
}
/** U3: a pending warning lands on the boss's action after a later player action and its game turn. */
function release(state, e, events) {
  const s = enc(state), w = s.warning;
  if (state.actions <= w.shownIn || state.now < w.landAt) return true;
  const W = state.floor.w, hit = new Set(w.tiles.map(t => t.y * W + t.x)), type = w.kind === 'cleave' ? 'phys' : w.kind === 'ring' ? 'lightning' : 'magic';
  events.push({ type: 'boss-move', id: e.id, move: w.kind, beat: w.beat, tiles: w.tiles, element: type });
  for (const t of party(state)) if (hit.has(t.y * W + t.x) && ((w.origin.x === t.x && w.origin.y === t.y) || clearLine(state, w.origin, t))) hurt(state, e, t, w.kind === 'cleave' ? 76 : 66, type, events);
  if (w.kind === 'pulse' && w.beat === 1 && w.outer?.length) {
    w.tiles = w.outer; w.outer = null; w.beat = 2; w.shownIn = state.actions; w.landAt = state.now + 100;
    marks(state, e.id, w.tiles, 'pulse');
    events.push({ type: 'telegraph', id: e.id, tiles: w.tiles, warning: 'warn.unmaker.pulse' });
    return true;
  }
  s.warning = null; endMarks(state, e); events.push({ type: 'telegraph-end', id: e.id });
  s.majorAt = state.now + 400;
  return true;
}

function rush(state, e, t, events) {
  const s = enc(state), d = fd(e, t);
  if (s.phase !== 1 || state.now < s.rushAt || d < 2 || d > 7 || e.statuses.root || !clearLine(state, point(e, t), t)) return false;
  let steps = 0;
  for (let i = 0; i < 4 && fd(e, t) > 1; i++) {
    const edge = point(e, t), dx = Math.sign(t.x - edge.x), dy = Math.sign(t.y - edge.y);
    if (!fits(state, e, e.x + dx, e.y + dy)) break;
    // CH4 (1.7 unmaker-encounter.js:230-237): the rush is one slide over a step's time, its steps sharing it in playback.
    moveBoss(state, e, e.x + dx, e.y + dy, events, { rush: true }); steps++;
  }
  if (!steps) return false;
  s.rushAt = state.now + 400;
  if (fd(e, t) <= 1) weaponAttack(state, e, t, events, { mult: 1.15, label: 'Shoulder Rush' });
  return true;
}
function summon(state, e, events) {
  const s = enc(state);
  if (state.now < s.summonAt) return false;
  const live = state.order.filter(id => { const a = state.actors[id]; return a.hp > 0 && a.owner === e.id; }).length;
  if (live >= 3) return false;
  const p = state.actors[state.playerId], spots = [];
  for (let y = e.y - 4; y <= e.y + 4; y++) for (let x = e.x - 4; x <= e.x + 4; x++) if (arenaCell(state, x, y) && !bodyAt(state, x, y) && cheb(e, { x, y }) >= 2 && cheb(p, { x, y }) >= 2) spots.push({ x, y });
  spots.sort((a, b) => cheb(a, p) - cheb(b, p) || a.y - b.y || a.x - b.x);
  let born = 0;
  while (spots.length && live + born < 3 && born < 2) {
    const c = spots.shift(), kind = SUMMONS[s.summoned % SUMMONS.length];
    const add = chaosBody(kind, c.x, c.y, 'crucible', { asleep: false, offspring: true, owner: e.id, wait: 0 });
    Object.assign(add, { hunting: true, alerted: true, lastSeen: { x: p.x, y: p.y, at: state.now }, t: state.now + 100, summoned: true });
    state.actors[add.id] = add; state.order.push(add.id); s.summonIds.push(add.id); s.summoned++; born++;
    events.push({ type: 'spawned', id: add.id, at: c });
  }
  if (!born) return false;
  s.summonAt = state.now + 400;
  events.push({ type: 'log', words: 'Chaos demons summoned!' }, { type: 'move-used', id: e.id, move: 'summon', name: 'Summon' });
  return true;
}
/** One 2x2 step toward the target over arena positions where the body fits (breadth-first). */
function stepToward(state, e, t, events) {
  if (e.statuses.root) return false;
  const W = state.floor.w, H = state.floor.h, d = new Int32Array(W * H).fill(-1), q = [];
  for (let y = t.y - 2; y <= t.y + 1; y++) for (let x = t.x - 2; x <= t.x + 1; x++) if (fd({ x, y }, t) <= 1 && fits(state, e, x, y)) { d[y * W + x] = 0; q.push(y * W + x); }
  for (let i = 0; i < q.length; i++) {
    const c = q[i], cx = c % W, cy = (c / W) | 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = cx + dx, ny = cy + dy, n = ny * W + nx;
      if ((dx || dy) && nx >= 0 && ny >= 0 && nx < W && ny < H && d[n] < 0 && fits(state, e, nx, ny)) { d[n] = d[c] + 1; q.push(n); }
    }
  }
  let best = null;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const nx = e.x + dx, ny = e.y + dy, v = (dx || dy) && nx >= 0 && ny >= 0 ? d[ny * W + nx] : -1;
    if (v >= 0 && (!best || v < best.v)) best = { x: nx, y: ny, v };
  }
  if (!best) return false;
  moveBoss(state, e, best.x, best.y, events);
  return true;
}

function unmakerAct(state, e, events) {
  const s = enc(state);
  if (!s || s.status !== 'active' || e.hp <= 0) return;
  setForm(state, e, phaseFor(e), events);
  if (s.warning) { release(state, e, events); return; }
  if (summon(state, e, events)) return;
  const t = targetFor(state, e);
  if (!t) { if (e.lastSeen) stepToward(state, e, e.lastSeen, events); return; }
  const d = fd(e, t), clear = clearLine(state, point(e, t), t);
  if (state.now >= s.majorAt && clear) {
    if (s.phase === 1 && d <= 2 && warn(state, e, 'cleave', t, events)) return;
    if (s.phase === 2 && d <= 8 && warn(state, e, s.cycle++ % 2 ? 'ring' : 'rupture', t, events)) return;
    if (s.phase === 3 && d <= 4 && warn(state, e, 'pulse', t, events)) return;
  }
  if (rush(state, e, t, events)) return;
  if (d <= 1) {
    if (s.phase === 3 && s.basic++ % 2) spell(state, e, t, events);
    else weaponAttack(state, e, t, events, { label: s.phase === 2 ? 'Unbound Lash' : null });
    return;
  }
  if (s.phase >= 2 && d <= 7 && clear) { spell(state, e, t, events); return; }
  stepToward(state, e, t, events);
}
registerSetPiece('unmaker', unmakerAct);

/** U8, chaos 78: each world pulse, ready pylons fire their marked line, then idle pylons mark a new one. */
function pulsePylons(state, events) {
  const s = enc(state), e = bossOf(state);
  if (!s || s.status !== 'active' || !e) return;
  // U2: a form change also follows damage between the boss's own actions.
  if (phaseFor(e) !== s.phase) setForm(state, e, phaseFor(e), events);
  if (s.phase !== 2) return;
  const W = state.floor.w, now = state.now, sites = state.floor.crucible.pylonSites;
  for (const p of s.pylons) {
    const w = p.warning;
    if (!w || now < w.fireAt || state.actions <= w.shownIn) continue;
    const hit = new Set(w.tiles.map(t => t.y * W + t.x));
    events.push({ type: 'boss-move', id: e.id, move: 'pylon-beam', pylon: p.id, tiles: w.tiles, element: 'light', colour: sites[p.id].color });
    for (const t of party(state)) if (hit.has(t.y * W + t.x) && lineCells(p, t).every(c => arenaCell(state, c.x, c.y))) hurt(state, e, t, 48, 'light', events);
    p.warning = null; p.readyAt = now + 500;
    marks(state, 'pylon-' + p.id, [], null);
  }
  if (state.actors[state.playerId].hp <= 0) return;
  const p0 = state.actors[state.playerId], canSee = !!state.vis?.[e.y * W + e.x] || !!state.vis?.[(e.y + 1) * W + e.x + 1];
  for (const p of s.pylons) {
    if (p.warning || now < p.readyAt) continue;
    const t = party(state).filter(b => b !== p0 || canSee).sort((a, b) => cheb(p, a) - cheb(p, b) || (a.side === 'player' ? -1 : 1))[0];
    if (!t) { p.readyAt = now + 100; continue; }
    let dx = t.x - p.x, dy = t.y - p.y; if (!dx && !dy) dy = -1;
    const k = 40 / Math.max(Math.abs(dx), Math.abs(dy)), line = [{ x: p.x, y: p.y }, ...lineCells(p, { x: Math.round(p.x + dx * k), y: Math.round(p.y + dy * k) })], cells = [];
    for (const c of line) { if (!arenaCell(state, c.x, c.y)) break; cells.push(c); }
    const tiles = safePattern(state, cells, e, pendingTiles(state));
    if (!tiles.length) { p.readyAt = now + 100; continue; }
    p.warning = { tiles, shownIn: state.actions, fireAt: now + 200 };
    marks(state, 'pylon-' + p.id, tiles, 'pylon', null, now + 200);
    events.push({ type: 'log', words: `Pylon ${sites[p.id].label}: beam in 2 turns!`, warning: true }, { type: 'telegraph', id: 'pylon-' + p.id, tiles, warning: 'warn.unmaker.pylon' });
  }
}
onPulse('unmaker-pylons', pulsePylons);

/** U9, chaos 79: its defeat. Called from the death rules for the boss (death.js hook). */
export function unmakerDefeated(state, e, events) {
  const s = enc(state);
  if (!s || s.status !== 'active' || e.id !== s.bossId) return false;
  s.status = 'defeated'; s.warning = null; s.pylons = []; pylonLights(state);
  const gone = new Set([e.id, ...(e.limbs ?? [])]);
  for (const id of state.order) { const a = state.actors[id]; if (a.owner === e.id && a.hp > 0) { a.hp = 0; gone.add(a.id); events.push({ type: 'died', id: a.id, dismissed: true, vanish: true, at: { x: a.x, y: a.y } }); } }   // CH19: gone in a burst, no clip
  for (const id of e.limbs ?? []) { const l = state.actors[id]; if (l) l.hp = 0; }
  state.floor.fields = (state.floor.fields ?? []).filter(r => r.kind !== 'chaos-hazard' || !gone.has(r.owner));   // its brood's poison patches go with it
  state.floor.marks = (state.floor.marks ?? []).filter(m => !m.unmaker);
  const c = state.floor.crucible; c.phase = 'defeated'; syncGates(state.floor);
  state.floor.boss = false; state.bossDead = true;
  events.push({ type: 'boss', id: e.id, name: e.name, state: 'dead' }, { type: 'telegraph-end', id: e.id },
    { type: 'log', words: 'The rear gate rises. The Forge of the Elements awaits.', sfx: 'door-unlock' },
    { type: 'log', words: '<b>The Unmaker falls.</b> Use the Forge of the Elements when you are ready to restore balance.', kill: true });   // CH32 (1.7 unmaker-encounter.js:274)
  return true;
}

CREATURE_HOOKS.death.push((state, a, by, events) => { if (a.set === 'unmaker') unmakerDefeated(state, a, events); });

/** Chaos 80: the Forge of the Elements' footprint, and whether the hero stands beside it. */
export function trueForgeAt(floor, x, y) {
  const f = floor.crucible?.trueForge;
  return !!f && x >= f.x && y >= f.y && x < f.x + f.w && y < f.y + f.h;
}
