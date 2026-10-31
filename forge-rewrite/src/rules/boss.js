// Set pieces (spec/bosses.md): Grukk the Warchief, G1-G7. His data is bosses.json grukk: the code reads its move rows'
// numbers (C10g; no number moved, number-scale and lethality being 1). His marked blows are telegraph.js marks on the
// world clock (M37). Other bosses join as their biomes are built.

import bosses from '../../data/bosses.json' with { type: 'json' };
import { next } from '../lib/rng.js';
import { weaponAttack } from './attack.js';
import { dealDamage } from './damage.js';
import { applyStatus } from './statuses.js';
import { makeCreature } from './monsters.js';
import { stepToward } from './ai-step.js';
import { registerSetPiece } from './set-pieces.js';
import { mark, registerLander } from './telegraph.js';
import { amount } from './amount.js';
import { cheb } from '../lib/geometry.js';
import { isWall, bodyAt } from './moves.js';
import { lineClear } from './sight.js';
import { walkable, tileAt, T } from '../data/tiles.js';
import propData from '../../data/props.json' with { type: 'json' };

const WORDS = {
  'boss.wake': name => `${name} awakens!`,
  'boss.grukk.reinforcements': () => 'Grukk calls reinforcements!',
  'boss.grukk.enraged': () => 'Enraged: slams cause shockwaves.',
  'boss.grukk.dazed': () => 'Grukk stunned. Strike now!',
};
const say = (events, key, a) => events.push({ type: 'log', words: WORDS[key](a.name), warning: false });
/** His rotation's rows (bosses.json grukk): the numbers below are read from them. */
const MV = Object.fromEntries(bosses.rows.grukk.actions[0].moves.map(m => [m.id, m]));
const SLAM = MV.slam.effects[0], SHOCK = SLAM.then[1], CHARGE = MV.charge.effects[0], RUN = CHARGE.then[0];
const hit = (t, k = 0) => t.then[k];   // a telegraph's blow
const inRoom = (r, p) => r && p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h;

/**
 * Marks tiles for a later blow (M37; telegraph.js, C10g): it lands at the first world pulse at or after now + delay
 * game turns, never inside the action that showed it. He roars as he marks a Slam (1.7 combat.js:463); the Charge and
 * Shockwave marks are silent.
 */
const telegraph = (state, a, tiles, row, move, events) => mark(state, a, { kind: move, tiles, delayTurns: row.delay, warning: row.warning, sfx: move === 'slam' ? 'warchief-roar' : null }, events);
/** Ends a boss's marks and pending blow at its death. */
function endTelegraph(state, a, events) {
  state.floor.marks = (state.floor.marks ?? []).filter(m => m.owner !== a.id);
  a.telegraph = null;
  events.push({ type: 'telegraph-end', id: a.id });
}
// CB18 (1.7 combat.js:404-419): his marked blows land on the hero and the hero's allies alike.
const bodiesOn = (state, tiles) => state.order.map(id => state.actors[id]).filter(b => b.hp > 0 && (b.side === 'player' || b.side === 'ally') && tiles.some(t => t.x === b.x && t.y === b.y));

/** G1: the throne: he wakes when he sees the hero within 7 while the hero is in the boss room, or when hurt. */
function wake(state, a, p, events) {
  const B = bosses.rows[a.set];
  a.throne = false; a.hunting = true; a.lastSeen = { x: p.x, y: p.y, at: state.now };
  say(events, 'boss.wake', a);
  events.push({ type: 'boss', id: a.id, name: a.name, state: 'awake', music: B.music, sfx: B.wake.sfx, shake: B.wake.shake });
  for (const id of state.order) { const g = state.actors[id]; if (g.guardOf === a.id && g.hp > 0) { g.hunting = true; g.asleep = false; g.lastSeen = { x: p.x, y: p.y, at: state.now }; } }
}

/** G2: at 66% and 33% a Goblin and a Goblin Archer join within 3; the rotation starts over. Costs no action. */
function phases(state, a, events) {
  const B = bosses.rows[a.set];
  while (a.phase < B.phases.length && a.hp / a.maxhp * 100 < B.phases[a.phase].belowPct) {
    const ph = B.phases[a.phase];
    a.phase++; a.rot = 0;
    events.push({ type: 'log', words: a.phase === 1 ? WORDS['boss.grukk.reinforcements']() : `${WORDS['boss.grukk.reinforcements']()} ${WORDS['boss.grukk.enraged']()}`, sfx: 'warchief-roar', shake: 10 });   // 1.7 combat.js:452
    for (const e of ph.effects) if (e.verb === 'summon') for (let i = 0; i < e.count; i++) summonNear(state, a, e.creature, e.within ?? 3, events);
  }
}
function summonNear(state, a, kind, within, events) {
  const cells = [];
  for (let dy = -within; dy <= within; dy++) for (let dx = -within; dx <= within; dx++) {
    const x = a.x + dx, y = a.y + dy;
    if ((dx || dy) && walkable(state.floor, x, y) && !isWall(state.floor, x, y) && !bodyAt(state, x, y)) cells.push({ x, y });
  }
  if (!cells.length) return;
  const c = cells[Math.floor(next(state.rng) * cells.length)], m = makeCreature(kind, c.x, c.y);
  const p = state.actors[state.playerId];
  Object.assign(m, { hunting: true, asleep: false, t: a.t, summoned: true, guardOf: a.id, lastSeen: { x: p.x, y: p.y, at: state.now } });
  state.actors[m.id] = m; state.order.push(m.id);
  events.push({ type: 'spawned', id: m.id, at: c });
}

/** The straight line toward the hero, up to 8 (its row), stopped by walls and blocking props (G5). */
function chargeLine(state, a, p) {
  const dx = Math.sign(p.x - a.x), dy = Math.sign(p.y - a.y), out = [];
  if (!dx && !dy) return out;
  for (let i = 1; i <= CHARGE.tiles.n; i++) { const x = a.x + dx * i, y = a.y + dy * i; if (isWall(state.floor, x, y)) break; out.push({ x, y }); }
  return out;
}

function grukk(state, a, events) {
  const p = state.actors[state.playerId];
  if (a.throne) {
    const sees = !!state.vis?.[a.y * state.floor.w + a.x] && cheb(a, p) <= 7 && inRoom(state.floor.bossRoom, p);
    if (sees || a.hp < a.maxhp) wake(state, a, p, events);
    return;
  }
  // G5: back on his feet after the Dazed of a missed charge (the status itself kept him from acting).
  if (a.wasDazed) { a.wasDazed = false; events.push({ type: 'log', words: 'Grukk recovers.' }); }
  phases(state, a, events);
  // A marked blow waits for the world clock (telegraph.js); he holds his ground meanwhile.
  if (a.telegraph) return;
  const B = bosses.rows[a.set], R = B.actions[0], list = (R.orderByPhase ?? R.listByPhase)[a.phase === 0 ? 'phase-0' : 'phase-1+'];
  const move = list[a.rot % list.length], d = cheb(a, p);
  const chase = () => { if (a.lastSeen) stepToward(state, a, lineClear(state.floor, a, p) ? p : a.lastSeen, events); };
  if (move === 'slam') {
    if (d > MV.slam.if.distance.max) return chase();
    a.rot++;
    const tiles = [], n = SLAM.tiles.n;
    for (let dy = -n; dy <= n; dy++) for (let dx = -n; dx <= n; dx++) if ((dx || dy) && walkable(state.floor, a.x + dx, a.y + dy)) tiles.push({ x: a.x + dx, y: a.y + dy });
    telegraph(state, a, tiles, SLAM, 'slam', events);
    return;
  }
  if (move === 'charge' && d >= MV.charge.if.distance.min) {
    const line = chargeLine(state, a, p);
    if (line.length < MV.charge.minLane) return chase();
    a.rot++;
    telegraph(state, a, line, CHARGE, 'charge', events);
    return;
  }
  // Cleave (G6), and a Charge step taken while adjacent, which becomes a Cleave and is used up (G3).
  if (d <= 1) {
    a.rot++;
    weaponAttack(state, a, p, events);
    // CB18 (1.7 combat.js:478-480): the great axe cleaves every ally beside him at x0.8.
    for (const id of [...state.order]) { const o = state.actors[id]; if (o?.hp > 0 && o.side === 'ally' && cheb(o, a) <= 1) weaponAttack(state, a, o, events, { mult: MV.cleave.effects[1].multiplier }); }
    return;
  }
  chase();
}

/** A telegraphed blow lands on whoever stands on its marks now (G4, G5); its damage and stun are its row's. */
function stunHit(state, a, t, blow, events) {
  for (const b of bodiesOn(state, t.tiles)) {
    dealDamage(state, { target: b, source: a, amount: amount(blow.amount, { state, owner: a }), type: blow.type }, events);
    if (b.hp > 0) applyStatus(state, b, blow.then[0].status, { turns: blow.then[0].turns, source: a.id }, events);
  }
}
registerLander('slam', (state, a, t, events) => {
  events.push({ type: 'boss-move', id: a.id, move: 'slam', sfx: 'warchief-slam', shake: 14 });
  stunHit(state, a, t, hit(SLAM), events);
  // G4: below 33% the slam is followed by a Shockwave on the ring 3-4 tiles out.
  if (a.hp / a.maxhp * 100 < SHOCK.if['hp-below-pct'].pct) {
    const ring = [], { min, max } = SHOCK.tiles;
    for (let dy = -max; dy <= max; dy++) for (let dx = -max; dx <= max; dx++) { const r = Math.max(Math.abs(dx), Math.abs(dy)); if (r >= min && r <= max && walkable(state.floor, a.x + dx, a.y + dy)) ring.push({ x: a.x + dx, y: a.y + dy }); }
    telegraph(state, a, ring, SHOCK, 'shockwave', events);
  }
});
registerLander('shockwave', (state, a, t, events) => {
  events.push({ type: 'boss-move', id: a.id, move: 'shockwave', sfx: 'warchief-slam', shake: 10 });   // CB19: 1.7 combat.js:432 SHAKE 10
  stunHit(state, a, t, hit(SHOCK), events);
});
registerLander('charge', (state, a, t, events) => {
  {
    events.push({ type: 'boss-move', id: a.id, move: 'charge', sfx: 'warchief-roar', shake: 10 });   // the roar as he runs (1.7 combat.js:437)
    // CB18 (1.7 combat.js:439-446): an ally in his path takes 14-20 and stops him unless it falls; the hero stops him
    // with the blow; anything else in the way stops him short. Reaching anyone but the hero leaves him Dazed.
    let struck = null, end = { x: a.x, y: a.y };
    for (const c of t.tiles) {
      if (isWall(state.floor, c.x, c.y)) break;
      let b = bodyAt(state, c.x, c.y);
      if (b?.side === 'player') { struck = b; break; }
      if (b?.side === 'ally') { dealDamage(state, { target: b, source: a, amount: amount(hit(RUN).amount, { state, owner: a }), type: 'phys' }, events); b = b.hp > 0 ? b : bodyAt(state, c.x, c.y); }
      if (b && b.hp > 0) break;
      end = c;
    }
    const from = { x: a.x, y: a.y };
    a.x = end.x; a.y = end.y;
    events.push({ type: 'moved', id: a.id, from, to: { ...end }, dash: true });
    if (struck) {
      const n = amount(hit(RUN).amount, { state, owner: a });
      dealDamage(state, { target: struck, source: a, amount: n, type: 'phys' }, events);
      events.push({ type: 'log', words: `Grukk charge: ${n}.` });
    } else { applyStatus(state, a, 'dazed', { turns: RUN.onMiss[0].turns, source: a.id }, events); a.wasDazed = true; say(events, 'boss.grukk.dazed', a); }
  }
});

registerSetPiece('grukk', grukk);


/**
 * E45 (1.7 cores.js:41-76 coreReachableTiles, coreDropSpot): the boss core lands on a free floor tile on the hero's
 * side of walls and closed gates: the reachable tile nearest where the boss fell (then nearest the hero), with no body,
 * item or prop on it; a crowded room leaves it at his feet.
 */
export function coreDropSpot(state, origin) {
  const f = state.floor, p = state.actors[state.playerId];
  if (!p) return { x: origin.x, y: origin.y };
  const propAt = (x, y) => f.props?.find(q => q.x === x && q.y === y && !q.broken) ?? null;
  const seen = new Set([p.y * f.w + p.x]), queue = [{ x: p.x, y: p.y }];
  for (let i = 0; i < queue.length; i++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if (!dx && !dy) continue;
    const x = queue[i].x + dx, y = queue[i].y + dy, k = y * f.w + x;
    if (x < 0 || y < 0 || x >= f.w || y >= f.h || seen.has(k)) continue;
    const q = propAt(x, y);
    if (!walkable(f, x, y) && !(tileAt(f, x, y) === T.DOOR && !(q && (q.blocks || propData.rows[q.id]?.blocks)))) continue;
    seen.add(k); queue.push({ x, y });
  }
  let best = null, score = Infinity;
  for (const { x, y } of queue) {
    // The Maw's large death frame covers its footprint and the surrounding tile edge.
    if (origin.kind === 'deepmaw' && x >= origin.x - 1 && x <= origin.x + 2 && y >= origin.y - 1 && y <= origin.y + 2) continue;
    if (tileAt(f, x, y) !== T.FLOOR || !walkable(f, x, y) || bodyAt(state, x, y) || f.items?.some(i => i.x === x && i.y === y) || propAt(x, y)) continue;
    const s = cheb({ x, y }, origin) * 100 + Math.abs(x - p.x) + Math.abs(y - p.y);
    if (s < score) { score = s; best = { x, y }; }
  }
  return best ?? { x: p.x, y: p.y };
}

/** Boss rewards and the fear on his guards (bosses.json deathEffects, rewards). */
export function bossDied(state, a, events, rollTable) {
  const B = bosses.rows[a.set];
  if (!B) return;
  events.push({ type: 'boss', id: a.id, name: a.name, state: 'dead' });
  for (const id of state.order) { const g = state.actors[id]; if (g.guardOf === a.id && g.hp > 0) applyStatus(state, g, 'fear', { turns: 6, source: a.id }, events); }
  endTelegraph(state, a, events);
  const drops = B.rewards?.table ? rollTable(state, B.rewards.table, state.floorNo) : [];
  for (const it of drops) {
    const at = it.kind === 'core' || a.kind === 'deepmaw' ? coreDropSpot(state, a) : a;   // The Maw's whole hoard lands clear of its corpse.
    state.floor.items.push({ x: at.x, y: at.y, item: it });
  }
  if (drops.length) events.push({ type: 'drops', at: { x: a.x, y: a.y } });
  // RB16 (1.7 run-events.js:66-68): the blast where he fell (the picture only), and the core's line. The cap rises
  // when the core is taken up (pickup.js), so 1.7's 'Affinity cap' line at the death never shows there either.
  events.push({ type: 'explosion', at: { x: a.x, y: a.y }, boss: true });
  const core = drops.find(it => it.kind === 'core');
  if (core) events.push({ type: 'log', words: `${core.name} dropped. Bring it to the exit gate.`, kill: true });
}
