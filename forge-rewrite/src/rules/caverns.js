// The Caverns' creatures (spec/monsters.md M30-M48 rows for the Caverns, world.md A21-A23; monsters.json stormbeetle,
// sparkjelly, shockeel, myconid, wormtender, sporecaller, shroomling): their moves as 1.7 plays them
// (js/world/biomes/caverns/cavernmobs.js, js/enemies/sporecaller.js @3c8b312), on the rewrite's clocks: cooldowns
// and marked blows count game turns on the world clock and a mark never lands inside the action that showed it
// (ruled 2026-10-16). Hooks: set-pieces.js CREATURE_HOOKS (act, hunt, taken, damaged), telegraph.js landers,
// rules/phases.js (cave-spores). Eels are placed with the floor (world/biomes/caverns/floor.js placeEels, ruling 6).
// No shared file holds Caverns code.

import { next } from '../lib/rng.js';
import { lineClear } from './sight.js';
import { isWall, bodyAt, tryStep } from './moves.js';
import { registerPhase } from './phases.js';
import { T, tileAt, walkable } from '../data/tiles.js';
import { cheb, D8 } from '../lib/geometry.js';
import { CREATURE_HOOKS, PROP_USES } from './set-pieces.js';
import { giveOf } from './loot.js';
import { weaponAttack } from './attack.js';
import { dealDamage, heal } from './damage.js';
import { applyStatus, blocks } from './statuses.js';
import { creatureMoveLands } from './hit.js';
import { makeCreature } from './monsters.js';
import { amount } from './amount.js';
import { ready, spend } from './cooldowns.js';
import { mark as telegraph, registerLander } from './telegraph.js';
import { boltPath } from './shoot.js';
import { stepToward } from './ai-step.js';
import { retreat, position } from './ai-moves.js';
import { layField, fieldAt } from './fields.js';

const CAVE = new Set(['stormbeetle', 'sparkjelly', 'shockeel', 'myconid', 'wormtender', 'sporecaller']);
const SHROOMS = { each: 2, floor: 6 };

const bodies = state => state.order.map(id => state.actors[id]).filter(b => b.hp > 0);
const playerSide = b => b.side === 'player' || b.side === 'ally';
const visible = (state, x, y) => !!state.vis?.[y * state.floor.w + x];
const say = (events, words, warning = false) => events.push({ type: 'log', words, warning });
const controlled = a => !!(a.statuses.stun || a.statuses.frozen || a.statuses.root || a.statuses.web || a.statuses.fear);

// Move cooldowns are cooldowns.js's (the Caverns' world-clock model, moved there in C5 and adopted here in C10e).
const moveOf = (a, id) => (a.moves ?? []).find(m => m.id === id);

const laneTo = (state, a, b) => { const p = boltPath(state, a, b), last = p.at(-1); return last && last.x === b.x && last.y === b.y ? p : null; };

// ---------------------------------------------------------------- marks on the world clock (M37)
// telegraph.js marks (C10e): the warning words are strings.json's, the glow colours ui.json's (1.7 cavernmobs.js:263,
// :397; sporecaller.js:164), said when the owner or a marked tile is seen; each lands on a later pulse.
const mark = (state, a, move, tiles, delay, warning, events) => telegraph(state, a, { kind: move, tiles, delayTurns: delay, warning, say: 'seen' }, events);
registerLander('storm-charge', (state, a, m, events) => { if (!controlled(a)) beetleRun(state, a, m.tiles, events); });
registerLander('water-zap', (state, a, m, events) => eelZap(state, a, m.tiles, events));
registerLander('spore-field', (state, a, m, events) => sporeField(state, a, m.tiles, events));

// ---------------------------------------------------------------- Storm Beetle
function beetle(state, a, p, { sees, dist }, events) {
  if (a.telegraph) return true;   // holding its lane until the mark lands
  const m = moveOf(a, 'storm-charge');
  if (m && sees && dist >= m.range[0] && dist <= m.range[1] && ready(state, a, m) && !controlled(a)) {
    const lane = laneTo(state, a, p);
    if (lane) { spend(state, a, m); mark(state, a, 'storm-charge', lane.slice(0, 5), 1, 'warn.storm-charge', events); events.push({ type: 'move-used', id: a.id, move: m.id, name: m.name, sfx: 'lightning-cast' }); return true; }
  }
  return false;
}
/** The charge: down the marked lane until a wall or a body, then a 3 x 3 static field round where it stopped. */
function beetleRun(state, a, path, events) {
  // CV19 (1.7 cavernmobs.js:242): the attack pose and lightning-cast as the run starts; the field it leaves is silent.
  events.push({ type: 'move-used', id: a.id, move: 'storm-run', name: 'Storm Charge', sfx: 'lightning-cast' });
  for (const c of path) {
    if (isWall(state.floor, c.x, c.y) || bodyAt(state, c.x, c.y)) break;
    const from = { x: a.x, y: a.y };
    a.x = c.x; a.y = c.y;
    events.push({ type: 'moved', id: a.id, from, to: { ...c }, dash: true });
    trample(state, a, events);   // mushrooms crushed along the lane
    if (a.hp <= 0) return;
  }
  const tiles = [];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (!isWall(state.floor, a.x + dx, a.y + dy)) tiles.push({ x: a.x + dx, y: a.y + dy });
  const field = moveOf(a, 'storm-charge').effects[0].then[0].then[0];
  layField(state, { field: field.field, turns: field.turns, side: field.side, each: field.each }, tiles, a, events);
  events.push({ type: 'log', words: 'Storm Beetle: static field!' }, { type: 'boss-move', id: a.id, move: 'static-field' });
}
/** Beetle Arc: a landed beetle blow sets the others within 3 crackling; one beside an opponent arcs 3-5 into it, once a turn on the floor. */
function beetleArc(state, b, events) {
  const f = state.floor;
  if (f.arcTurn === state.actions) return;
  const others = bodies(state).filter(o => o !== b && o.kind === 'stormbeetle' && o.side === b.side && cheb(o, b) <= 3);
  if (!others.length) return;
  f.arcTurn = state.actions;
  // 1.7 beetleArc (cavernmobs.js:149): the lightning crackles from the beetle to each of the others first.
  for (const o of others) events.push({ type: 'bolt', from: { x: b.x, y: b.y }, to: { x: o.x, y: o.y }, kind: 'lightning' });
  for (const o of others) {
    const target = bodies(state).find(t => playerSide(t) !== playerSide(b) && cheb(o, t) <= 1);
    if (!target) continue;
    const hit = o.passives.find(ps => ps.trigger === 'on-hit').effects[0];
    const n = dealDamage(state, { target, source: o, amount: amount(hit.amount, { state, owner: o, source: o }), type: 'lightning', tags: ['proc'] }, events);
    events.push({ type: 'bolt', from: { x: o.x, y: o.y }, to: { x: target.x, y: target.y }, kind: 'lightning', sfx: 'lightning-hit' });
    if (target.id === state.playerId) events.push({ type: 'log', words: `Beetle Arc: ${n}.` });   // 1.7 caveZap logs only the hero's hurt
    return;
  }
  // CV11 (1.7 cavernmobs.js:153-154): no one beside the others, the crackle (its bolts sound lightning-hit) logs in sight.
  if (visible(state, b.x, b.y)) events.push({ type: 'log', words: 'Storm Beetles: Arc.', cls: 'c-info' });
}

// ---------------------------------------------------------------- Spark Jelly
function jelly(state, a, p, { sees, dist }, events) {
  const m = moveOf(a, 'spark-bolt');
  if (!m || !sees || dist < m.range[0] || dist > m.range[1] || !ready(state, a, m) || !laneTo(state, a, p)) return false;
  spend(state, a, m);
  events.push({ type: 'move-used', id: a.id, move: m.id, name: m.name, target: p.id, ranged: true, sfx: 'lightning-cast' }, { type: 'bolt', from: { x: a.x, y: a.y }, to: { x: p.x, y: p.y }, kind: 'lightning' });
  // M6 (C10e): its roll goes through creatureMoveLands, so the hero's deflect, Blur and Lucky Streak answer it.
  if (creatureMoveLands(state, a, p, events, { accBonus: m.hit?.accBonus ?? 0, label: m.name })) {
    const n = dealDamage(state, { target: p, source: a, amount: amount(m.effects[0].amount, { state, owner: a, source: a }), type: 'lightning', tags: ['attack', 'spell', 'ranged'] }, events);
    say(events, `Spark Jelly bolt: ${n}.`);
  } else { if (!events.at(-1)?.deflected) events.push({ type: 'miss', id: p.id }); events.push({ type: 'log', words: 'Spark Jelly misses.' }); }
  return true;
}
/** Sting Chain: a landed sting jumps to 2 more opponents within 2 of the last, seen, never jellies; 3-5 lightning each. */
function jellyChain(state, j, first, events) {
  const hit = [first];
  let from = first;
  for (let k = 0; k < 2; k++) {
    const nx = bodies(state).filter(o => !hit.includes(o) && o !== j && playerSide(o) !== playerSide(j) && o.kind !== 'sparkjelly' && !o.flags?.includes('object') && cheb(o, from) <= 2 && visible(state, o.x, o.y)).sort((x, z) => cheb(x, from) - cheb(z, from))[0];
    if (!nx) break;
    events.push({ type: 'bolt', from: { x: from.x, y: from.y }, to: { x: nx.x, y: nx.y }, kind: 'lightning' });
    const arc = j.passives.find(ps => ps.trigger === 'on-hit').effects[0];
    const n = dealDamage(state, { target: nx, source: j, amount: amount(arc.amount, { state, owner: j, source: j }), type: 'lightning', tags: ['proc'] }, events);
    if (nx.id === state.playerId) events.push({ type: 'log', words: `Spark Jelly chain: ${n}.` });   // CV23 (1.7 cavernmobs.js:165)
    hit.push(nx); from = nx;
  }
  if (hit.length > 1) say(events, `Spark Jelly: ${hit.length - 1} chain hit${hit.length === 2 ? '' : 's'}.`);
}

// ---------------------------------------------------------------- Myconids, Worm Tenders, Shroomlings
/** Shroomlings sprout on free cells: 2 alive a summoner, 6 a floor (M36, M41); no loot, they act from the summoner's clock. */
export function sprout(state, owner, cells, count, events) {
  const mine = bodies(state).filter(o => o.kind === 'shroomling' && o.owner === owner.id).length;
  const all = bodies(state).filter(o => o.kind === 'shroomling').length;
  let free = cells.filter(c => walkable(state.floor, c.x, c.y) && !isWall(state.floor, c.x, c.y) && tileAt(state.floor, c.x, c.y) !== T.CHASM && !bodyAt(state, c.x, c.y));
  const limit = Math.min(count, SHROOMS.each - mine, SHROOMS.floor - all), out = [];
  const p = state.actors[state.playerId];
  while (out.length < limit && free.length) {
    const c = free.length === 1 ? free[0] : free[Math.floor(next(state.rng) * free.length)];
    free = free.filter(o => o.x !== c.x || o.y !== c.y);
    const s = makeCreature('shroomling', c.x, c.y);
    Object.assign(s, { hunting: true, asleep: false, owner: owner.id, summoned: true, drops: null, t: owner.t, lastSeen: { x: p.x, y: p.y, at: state.now } });
    state.actors[s.id] = s; state.order.push(s.id);
    events.push({ type: 'spawned', id: s.id, at: { ...c } });
    out.push(s);
  }
  return out;
}
const nearFree = (state, at, r) => {
  const c = [];
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { const x = at.x + dx, y = at.y + dy; if ((dx || dy) && walkable(state.floor, x, y) && !isWall(state.floor, x, y) && !bodyAt(state, x, y)) c.push({ x, y }); }
  return c.length ? c[Math.floor(next(state.rng) * c.length)] : null;
};
function myconid(state, a, p, { sees, dist }, events) {
  if (!sees) return false;
  const lob = moveOf(a, 'spore-lob'), sp = moveOf(a, 'sprout');
  if (lob && dist >= lob.range[0] && dist <= lob.range[1] && ready(state, a, lob)) {
    spend(state, a, lob);
    const tiles = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (!isWall(state.floor, p.x + dx, p.y + dy) || (dx === 0 && dy === 0)) tiles.push({ x: p.x + dx, y: p.y + dy });
    const e = lob.effects[0];
    layField(state, { field: 'spores', turns: e.turns, side: 'player-and-allies', each: e.each }, tiles, a, events);
    events.push({ type: 'move-used', id: a.id, move: lob.id, name: lob.name, target: p.id, ranged: true, sfx: 'trap-gas' }, { type: 'bolt', from: { x: a.x, y: a.y }, to: { x: p.x, y: p.y }, kind: 'poison' });
    say(events, `${a.name}: leave the spores!`, true);
    return true;
  }
  if (sp && dist > 1 && ready(state, a, sp)) {
    const c = nearFree(state, p, 1);
    if (c && sprout(state, a, [c], 1, events).length) { spend(state, a, sp); events.push({ type: 'move-used', id: a.id, move: sp.id, name: sp.name }); if (visible(state, a.x, a.y)) say(events, `${a.name}: Shroomling summoned.`); return true; }
  }
  return false;
}

// ---------------------------------------------------------------- Myconid Sporecaller (sporecaller.js)
function sporecaller(state, a, p, { sees, dist }, events) {
  if (a.telegraph) return true;
  if (!sees) { if (a.lastSeen) stepToward(state, a, a.lastSeen, events); return true; }
  // Retreat inside 3 (from the hero or an ally of the hero's with an open line: ai.js retreat, 1.7 teamwork retreat).
  if (retreat(state, a, p, events, a.params?.retreatWithin ?? 3)) return true;
  const field = moveOf(a, 'spore-field'), coat = moveOf(a, 'sporecoat');
  if (field && dist <= field.range[1] && lineClear(state.floor, a, p) && ready(state, a, field)) {
    const live = (state.floor.fields ?? []).filter(f => f.kind === 'spore-field').length + bodies(state).filter(o => o.telegraph?.kind === 'spore-field').length;
    if (live < (field.floorCap ?? 2)) {
      const c = { x: p.x + Math.sign(a.x - p.x), y: p.y + Math.sign(a.y - p.y) }, tiles = [];
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const x = c.x + dx, y = c.y + dy; if (walkable(state.floor, x, y) && tileAt(state.floor, x, y) !== T.CHASM && lineClear(state.floor, c, { x, y })) tiles.push({ x, y }); }
      if (tiles.some(t => t.x === p.x && t.y === p.y)) {
        spend(state, a, field);
        mark(state, a, 'spore-field', tiles, 1, 'warn.spore-field', events);
        events.push({ type: 'move-used', id: a.id, move: field.id, name: field.name, sfx: 'shaman-cast' });
        return true;
      }
    }
  }
  if (coat && support(state, a, coat, false, events)) return true;
  // EP21 (1.7 sporecaller.js:68, teamwork position): close to 5, else keep beside its escort.
  if (position(state, a, p, a.params?.holdRange ?? 5, false, events)) return true;
  if (coat) support(state, a, coat, true, events);
  return true;
}
function support(state, a, m, idle, events) {
  if (!idle && !ready(state, a, m)) return false;
  const allies = bodies(state).filter(o => o !== a && o.side === a.side && o.family === 'cavern' && o.hunting && o.kind !== 'sporecaller' && cheb(a, o) <= 4 && lineClear(state.floor, a, o) && (o.hp < o.maxhp || !o.statuses.sporecoat))
    .sort((x, z) => x.hp / x.maxhp - z.hp / z.maxhp || cheb(x, a) - cheb(z, a));
  const t = allies[0];
  if (!t) return false;
  spend(state, a, m);
  // EP33 (1.7 sporecaller.js:55-57): the poison bolt flies to the ally first, then the heal sparkles (12) on it and
  // 'Sporecoat' floats over it in the heal colour.
  events.push({ type: 'move-used', id: a.id, move: m.id, name: m.name, target: t.id, ranged: true, sfx: 'shaman-cast' });
  const base = Math.max(1, Math.round(t.maxhp * 0.5));
  const healed = heal(state, t, t.statuses.rot ? Math.floor(base * 0.5) : base, events, { overheal: false });   // C10e: the one heal (damage.js)
  if (!t.statuses.sporecoat) applyStatus(state, t, 'sporecoat', { turns: 3, magnitude: Math.min(12, Math.max(3, Math.round(t.maxhp * 0.15))), source: a.id }, events);
  events.push({ type: 'sparkle', at: { x: t.x, y: t.y }, kind: 'heal', n: 12 }, { type: 'float', id: t.id, words: 'Sporecoat', tone: 'heal' });
  if (visible(state, a.x, a.y) || visible(state, t.x, t.y)) say(events, `Sporecaller: ${t.name}: Sporecoat${healed ? `; +${healed} HP` : ''}.`);
  return true;
}
/** The marked ground sprouts Shroomlings and a field: Root once per body, fixed Poison if not already Poisoned. */
function sporeField(state, a, tiles, events) {
  if (!a.hunting || controlled(a)) return;
  const sprouts = sprout(state, a, tiles, 2, events);
  const field = moveOf(a, 'spore-field').effects[0].then.find(e => e.verb === 'field');
  layField(state, { field: 'spore-field', turns: field.turns, side: field.side,
    each: field.each, eachOnce: field.eachOnce }, tiles, a, events);
  const f = state.floor;
  f.mushrooms ??= {};
  // 1.7 growth()[i] = { known: vis[i] }: 2 marks one the hero has seen (sight.js keeps it so), 1 one he has not.
  for (const t of tiles) f.mushrooms[t.y * f.w + t.x] = visible(state, t.x, t.y) ? 2 : 1;
  // EP8, EP34: the ground is redrawn now, so the mushrooms show as they are planted (1.7 draws them each frame) and the
  // first one crushed has a drawn set to puff from.
  if (tiles.length) events.push({ type: 'ground', at: { x: tiles[0].x, y: tiles[0].y } });
  // EP33 (1.7 sporecaller.js:81): the field sprouts in a poison burst (24) from its centre when any of it is seen.
  if (tiles.length && tiles.some(t => visible(state, t.x, t.y))) {
    const cx = Math.round(tiles.reduce((n, t) => n + t.x, 0) / tiles.length), cy = Math.round(tiles.reduce((n, t) => n + t.y, 0) / tiles.length);
    events.push({ type: 'burst', at: { x: cx, y: cy }, kind: 'poison', n: 24, spread: 0.05, seen: true });
  }
  // The burst hisses when seen (1.7 sporecaller.js:82).
  if (tiles.some(t => visible(state, t.x, t.y))) events.push({ type: 'log', words: `Spore field: Root, Poison${sprouts.length ? `; ${sprouts.length} Shroomling${sprouts.length === 1 ? '' : 's'} summoned` : ''}.`, warning: false, sfx: 'trap-gas' });
}

// ---------------------------------------------------------------- Shock Eel (aquatic)
const water = (f, x, y) => tileAt(f, x, y) === T.WATER;
/** The water joined to the eel within r (8-way, through water). */
function eelWater(f, e, r) {
  const out = [];
  if (!water(f, e.x, e.y)) return out;
  const seen = new Set([e.y * f.w + e.x]), q = [{ x: e.x, y: e.y }];
  out.push({ x: e.x, y: e.y });
  for (let h = 0; h < q.length; h++) for (const [dx, dy] of D8) {
    const x = q[h].x + dx, y = q[h].y + dy, k = y * f.w + x;
    if (seen.has(k) || !water(f, x, y) || Math.max(Math.abs(x - e.x), Math.abs(y - e.y)) > r) continue;
    seen.add(k); out.push({ x, y }); q.push({ x, y });
  }
  return out;
}
/** The whole action of an eel awake (asleep, the shared noticing wakes it): bite, mark the water, or swim. */
function eel(state, e, events) {
  const f = state.floor, p = state.actors[state.playerId];
  if (e.asleep) return false;   // the shared rules roll its noticing
  const see = !p.statuses?.hidden && visible(state, e.x, e.y), d = cheb(e, p);
  if (see && !e.hunting) { e.hunting = true; e.caughtOff = state.actions; e.lastSeen = { x: p.x, y: p.y, at: state.now }; events.push({ type: 'noticed', id: e.id }); }
  if (see) e.lastSeen = { x: p.x, y: p.y, at: state.now };
  if (e.telegraph) return true;
  const onLand = !water(f, e.x, e.y);
  if (e.hunting) {
    if (see && d <= 1 && !e.statuses.fear) { weaponAttack(state, e, p, events); e.surfacedAt = state.actions; return true; }
    const m = moveOf(e, 'water-zap');
    if (m && !onLand && d <= m.range[1] && ready(state, e, m)) {
      const cells = eelWater(f, e, 4), inIt = b => cells.some(c => c.x === b.x && c.y === b.y);
      const allyIn = bodies(state).some(o => o.side === 'ally' && inIt(o) && lineClear(f, e, o));
      if ((see && inIt(p)) || allyIn) {
        spend(state, e, m); e.surfacedAt = state.actions;
        mark(state, e, 'water-zap', cells, 1, 'warn.shock-eel', events);
        events.push({ type: 'move-used', id: e.id, move: m.id, name: m.name });
        return true;
      }
    }
  }
  if (e.statuses.root || e.statuses.stun || e.statuses.frozen) return true;
  // Swim: only through water; stranded on land, back to the nearest water.
  let goal = e.hunting ? (see ? p : e.lastSeen) : e.goal ?? null;
  if (!goal || (e.goal && e.x === e.goal.x && e.y === e.goal.y) || (!e.hunting && next(state.rng) < 0.1)) {
    const opts = eelWater(f, e, 5);
    if (opts.length) { e.goal = opts[Math.floor(next(state.rng) * opts.length)]; goal = e.goal; }
  }
  let best = null, bd = 1e9;
  for (const [dx, dy] of D8) {
    const nx = e.x + dx, ny = e.y + dy;
    if (!water(f, nx, ny) || bodyAt(state, nx, ny)) continue;
    let dd = goal ? Math.max(Math.abs(goal.x - nx), Math.abs(goal.y - ny)) + 0.01 * (Math.abs(goal.x - nx) + Math.abs(goal.y - ny)) : next(state.rng);
    if (e.statuses.fear) dd = -dd;
    if (dd < bd) { bd = dd; best = { x: nx, y: ny }; }
  }
  const here = goal ? Math.max(Math.abs(goal.x - e.x), Math.abs(goal.y - e.y)) : 1e9;
  if (best && (onLand || bd < here || !e.hunting)) { const from = { x: e.x, y: e.y }; e.x = best.x; e.y = best.y; events.push({ type: 'moved', id: e.id, from, to: { ...best } }); }
  return true;
}
function eelZap(state, e, cells, events) {
  e.surfacedAt = state.actions;
  events.push({ type: 'boss-move', id: e.id, move: 'water-zap', sfx: 'lightning-hit', shake: 3, tiles: cells });
  let any = false;
  for (const t of bodies(state)) {
    if (t === e || t.flags?.includes('aquatic') || t.flags?.includes('object') || t.limbOf) continue;
    if (!cells.some(c => c.x === t.x && c.y === t.y)) continue;
    any = true;
    const hit = moveOf(e, 'water-zap').effects[0].then[0];
    const n = dealDamage(state, { target: t, source: e, amount: amount(hit.amount, { state, owner: e, source: e }), type: 'lightning', tags: ['area'] }, events);
    if (t.side === 'player') say(events, `Shock Eel water: ${n}.`);
  }
  if (!any && visible(state, e.x, e.y)) say(events, 'Shock Eel: no hits.');
}

// ---------------------------------------------------------------- hooks
const HUNT = { stormbeetle: beetle, sparkjelly: jelly, myconid, wormtender: myconid, sporecaller };
CREATURE_HOOKS.hunt.push((state, a, p, ctx, events) => {
  if (!CAVE.has(a.kind)) return false;
  // Their on-hit passives are played here (Beetle Arc, Sting Chain), not by the shared on-hit pass.
  if (a.kind === 'stormbeetle' || a.kind === 'sparkjelly') (a.cd ??= {})['passive:on-hit'] = Infinity;
  if (HUNT[a.kind]?.(state, a, p, ctx, events)) return true;
  return basicHunt(state, a, p, ctx, events);
});
/** The rest of a hunter's action for the creatures played here: their moves are this file's, never the shared move list's. */
function basicHunt(state, a, p, { sees, dist }, events) {
  if ((sees || dist <= 1) && dist === 1) { if (!blocks(a, 'melee')) weaponAttack(state, a, p, events); return true; }
  if (blocks(a, 'move')) return true;
  if (a.params?.erraticPct && next(state.rng) < a.params.erraticPct / 100) { const [dx, dy] = D8[Math.floor(next(state.rng) * 8)]; if (tryStep(state, a, dx, dy, events)) return true; }
  stepToward(state, a, sees ? p : a.lastSeen ?? p, events);
  return true;
}
(CREATURE_HOOKS.act ??= []).push((state, a, events) => (a.kind === 'shockeel' ? eel(state, a, events) : false));
// Storm Beetles take half from lightning (monsters.json passives resist).
CREATURE_HOOKS.taken.push((state, t, pk) => {
  if (!CAVE.has(t.kind)) return undefined;
  let m;
  for (const ps of t.passives ?? []) if (ps.verb === 'resist' && ps.type === (pk.type ?? 'phys')) m = (m ?? 1) * ps.mult;
  return m;
});
CREATURE_HOOKS.damaged.push((state, t, pk, dealt, events) => {
  const s = pk.source;
  if (!s || s.hp <= 0 || !pk.tags?.includes('attack') || pk.tags.includes('ranged')) return;
  if (s.kind === 'stormbeetle' && playerSide(t)) beetleArc(state, s, events);
  if (s.kind === 'sparkjelly' && playerSide(t)) jellyChain(state, s, t, events);
  if (s.kind === 'shockeel') s.surfacedAt = state.actions;
  if (t.kind === 'shockeel') t.surfacedAt = state.actions;
});

// A22: spores slow the hero standing in them (2 turns, x0.8), unless already slowed or frozen, or Earth 6+.
registerPhase('cave-spores', (state, ctx, events) => {
  const p = state.actors[state.playerId];
  if (state.floor?.mushrooms && ctx.kind === 'move') trample(state, p, events);   // a spore field's mushrooms, trampled (2 poison)
  if (!state.floor?.fields?.length || !fieldAt(state, p.x, p.y, 'spores')) return;
  if (p.statuses.slow || p.statuses.frozen || (state.hero?.affinity?.earth ?? 0) >= 6) return;
  if (applyStatus(state, p, 'slow', { turns: 2, magnitude: 0.8 }, events)) events.push({ type: 'float', id: p.id, words: 'slowed', tone: 'poison' });   // CV22: 1.7 floatText 'slowed','poison'
});

// Mushrooms a spore field leaves: any walking body that steps on one crushes it (1.7 sporecaller.js trample, called
// from every creature's move and the skeleton's charge): every cell of its n x n footprint is crushed, the map redraws
// the ground, where a crushed one in sight puffs spores, with a soft grass step when the body is seen; 2 poison (not the
// sporeproof). They last until trampled.
export function trample(state, a, events) {
  const f = state.floor, n = a.size ?? 1;
  if (!f?.mushrooms || a.hp <= 0 || a.flags?.includes('flying') || a.statuses?.levitate) return;
  let crushed = false;
  for (let y = a.y; y < a.y + n; y++) for (let x = a.x; x < a.x + n; x++) {
    const k = y * f.w + x;
    if (!f.mushrooms[k]) continue;
    delete f.mushrooms[k]; crushed = true;
  }
  if (!crushed) return;
  const seen = (() => { for (let y = a.y; y < a.y + n; y++) for (let x = a.x; x < a.x + n; x++) if (visible(state, x, y)) return true; return false; })();
  events.push({ type: 'ground', at: { x: a.x, y: a.y }, by: a.id, crushed: 'mushrooms', ...(seen ? { sfx: 'step-grass', volume: 0.5 } : {}) });
  if (a.flags?.includes('sporeproof')) return;
  const dmg = dealDamage(state, { target: a, source: null, amount: 2, type: 'poison', tags: ['environment', 'movement'] }, events);
  if (a.side === 'player' && dmg) say(events, `Mushrooms: ${dmg}.`);
}
(CREATURE_HOOKS.moved ??= []).push((state, a, events) => { if (state.floor?.mushrooms) trample(state, a, events); });

// ---------------------------------------------------------------- crystal resonance (rooms.json crystal-resonance)
/** 1.7 interactUncommonEvent and resolveUncommonRewards for the crystal: touched once, it wakes every foe within 8
 *  and sends it hunting toward the crystal, refills the hero's Mana and sets a mote of a random element beside it. */
PROP_USES['resonance-crystal'] = (state, crystal, events) => {
  if (crystal.used) { events.push({ type: 'log', words: 'Its work is done.' }); return 'refused'; }
  crystal.used = true;
  const f = state.floor, p = state.actors[state.playerId], at = { x: crystal.x, y: crystal.y };
  for (const a of bodies(state)) {
    if (a.side !== 'foe' || cheb(a, crystal) > 8) continue;
    a.asleep = false; a.hunting = true; a.lastSeen = { ...at, at: state.now };
    events.push({ type: 'alerted', id: a.id, toward: at });
  }
  if ((p.maxmana ?? 0) > (p.mana ?? 0)) { events.push({ type: 'mana', id: p.id, amount: p.maxmana - (p.mana ?? 0) }); p.mana = p.maxmana; }
  // 1.7 resolveUncommonRewards: nearFree(crystal, 2), else the hero's own tile.
  const spot = spotNear(state, crystal, 2) ?? { x: p.x, y: p.y };
  for (const it of giveOf(state, { mote: 'random' }, state.floorNo)) f.items.push({ x: spot.x, y: spot.y, item: it });
  events.push({ type: 'log', words: 'The crystal refills your Mana and releases a mote. Its resonance draws nearby enemies.', sfx: 'pickup-item' }, { type: 'drops', at: spot });
  return 'act';
};
/** 1.7 nearFree: the nearest open floor within r with nothing lying, standing or set on it. */
function spotNear(state, at, r) {
  const f = state.floor;
  for (let d = 1; d <= r; d++) for (let dy = -d; dy <= d; dy++) for (let dx = -d; dx <= d; dx++) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) !== d) continue;
    const x = at.x + dx, y = at.y + dy;
    if (tileAt(f, x, y) === T.FLOOR && !isWall(f, x, y) && !bodyAt(state, x, y) && !(f.props ?? []).some(q => q.x === x && q.y === y) && !f.items.some(i => i.x === x && i.y === y)) return { x, y };
  }
  return null;
}
