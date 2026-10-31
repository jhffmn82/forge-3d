// What a creature notices (spec/character.md A41-A42; spec/monsters.md M12-M16, M23): the notice bands, the hero's
// stealth, hearing, what it remembers and what it witnesses (consolidation C10a: split from ai.js).

import progression from '../../data/progression.json' with { type: 'json' };
import classes from '../../data/classes.json' with { type: 'json' };
import { blocks } from './statuses.js';
import { isWall, bodyAt } from './moves.js';
import { lineClear } from './sight.js';
import { next } from '../lib/rng.js';
import { cheb, D8 } from '../lib/geometry.js';
import { T, walkable, opaque, G } from '../data/tiles.js';
import { registerPhase } from './phases.js';
import abilities from '../../data/abilities.json' with { type: 'json' };
import tuning from '../../data/tuning.json' with { type: 'json' };
import { libraryDormant, stepToward } from './ai-step.js';

const WITNESS = 7;   // M16



export const N = progression.rows.notice;

/** A42: a Scoundrel's notice band edges are 2 tiles shorter, never below 1 (1.7 classes.js noticeBand). */
export const bandCut = state => classes.rows[state.hero?.cls]?.noticeBandCut ?? 0;

export const edge = (upTo, cut) => Math.max(N.bandFloor ?? 1, upTo - cut);

export const bandAt = (dist, cut) => N.bands.find(b => dist <= edge(b.upTo, cut))?.mult ?? N.beyondLastBand ?? 0;

/** A42: the Scoundrel's x0.5, then x (1 - stealth) (the stealth of this action, set by the enemy-hearing phase). */
export const quieted = (state, c) => c * (classes.rows[state.hero?.cls]?.noticeMult ?? 1) * (1 - (state.hero?.stealthNow ?? 0)) / 100;

/** A42: the chance an unaware creature notices the hero this turn. */
export function noticeChance(state, a, p, dist) {
  const cut = bandCut(state);
  const seeing = !p.statuses?.hidden && dist <= edge(N.bands[N.bands.length - 1].upTo, cut) && (cheb(a, p) <= 1 || lineClear(state.floor, a, p));   // M11: Hidden is never seen; item 297: beside it, always seen
  const band = bandAt(dist, cut);
  const c = a.asleep ? (seeing ? N.asleepSeesPct * band : dist <= edge(N.asleepHearsWithin, cut) ? N.asleepHearsPct : 0) : (seeing ? N.awakeSeesPct * band : N.awakeHears);
  return quieted(state, c);
}

export const ST = progression.rows.stealth, HEAR = tuning.rows.hearing, ABILITY = abilities.rows;

/**
 * A41 (1.7 geometry.js stealth, geometry-adapter.js stealthScore): the hero's stealth for this action, 0 to 0.9: the
 * standing part (Agility, Scoundrel, armour weight, gear; derive.js stealth), +20% if he did not move, +25% in tall
 * grass (a step that trampled it counts), +25% in a dark room. 0 while noisy or sworn to Sir Reginald.
 */
export function stealthScore(state, { moved = false, grass = false } = {}) {
  const h = state.hero, p = state.actors[state.playerId];
  if (!h || !p || p.noisy || ST.zeroWhen.includes('god-' + (h.faith?.god ?? ''))) return 0;
  const f = state.floor, k = p.y * f.w + p.x;
  const dark = (f.rooms ?? []).some(r => r.dark && p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h);
  const v = p.derived.stealthRaw + (moved ? 0 : ST.stoodStillPct) + (grass || f.ground?.[k] === G.GRASS ? ST.tallGrassPct : 0) + (dark ? ST.darkRoomPct : 0);
  return Math.max(0, Math.min(ST.capPct, v)) / 100;
}

/**
 * B2 (1.7 enemy-perception.js soundField, hear, playerAction): after a loud action (an attack, a cast, noisy) or a
 * move, a sound spreads from the hero along passages (walls block it, a shut door costs 3, a diagonal 1.4). Each
 * hostile in it, not on a throne and not hunting him in sight, is told: one not hunting rolls the hearing chance and
 * hunts toward the tile; one hunting just remembers it. The buried Maw feels steps on its own (maw.js DM2).
 */
export function soundField(f, from, radius) {
  const W = f.w, cost = new Map([[from.y * W + from.x, 0]]), q = [{ x: from.x, y: from.y, c: 0 }];
  const shut = (x, y) => opaque(f, x, y);
  for (let i = 0; i < q.length; i++) {
    const s = q[i];
    for (const [dx, dy] of D8) {
      const x = s.x + dx, y = s.y + dy;
      if (x < 0 || y < 0 || x >= W || y >= f.h) continue;
      const tile = f.tiles[y * W + x];
      if (shut(x, y) && tile !== T.DOOR) continue;
      if (dx && dy && shut(s.x + dx, s.y) && shut(s.x, s.y + dy)) continue;
      const c = s.c + (tile === T.DOOR ? HEAR.doorCost : dx && dy ? HEAR.diagonalCost : 1), n = y * W + x;
      if (c > radius || (cost.has(n) && cost.get(n) <= c)) continue;
      cost.set(n, c); q.push({ x, y, c });
    }
  }
  return cost;
}

/** B2: the chance an unaware creature hears the hero: loud 55% x the A42 band, quiet 20% within 3 (Scoundrel 1). */
export function hearChance(state, loud, dist) {
  const cut = bandCut(state);
  return quieted(state, loud ? HEAR.loudPct * (HEAR.loudUsesNoticeBands ? bandAt(dist, cut) : 1) : dist <= edge(HEAR.quietWithin, cut) ? HEAR.quietPct : 0);
}

registerPhase('enemy-hearing', (state, ctx, events) => {
  const p = state.actors[state.playerId], me = state.playerId;
  if (!p || !state.hero) return;
  const mine = events.filter(e => e.id === me);
  const moved = ctx.kind === 'move' || mine.some(e => e.type === 'moved');
  const grass = mine.some(e => e.type === 'moved' && e.trampled && e.to?.x === p.x && e.to?.y === p.y);
  state.hero.stealthNow = stealthScore(state, { moved, grass });
  // 1.7 lastAttack or castingSpell: a blow, or a spell (a technique such as Shadowstep is not a cast).
  const loud = !!p.noisy || mine.some(e => e.type === 'attacked' || e.type === 'swung' || (e.type === 'ability' && !ABILITY[e.ability]?.tech));
  if (!loud && !moved) return;
  const scoundrel = (classes.rows[state.hero.cls]?.noticeBandCut ?? 0) > 0;
  const field = soundField(state.floor, p, loud ? HEAR.loudRadius : scoundrel ? HEAR.scoundrelQuietRadius : HEAR.quietRadius);
  const at = { x: p.x, y: p.y };
  for (const id of state.order) {
    const a = state.actors[id];
    if (!a || a.hp <= 0 || a.side !== 'foe' || a.throne || a.limbOf || a.flags?.includes('object') || a.statuses?.tomb) continue;
    if (!field.has(a.y * state.floor.w + a.x)) continue;
    if (a.hunting && seesPlayer(state, a, p)) continue;
    if (!a.hunting && next(state.rng) >= hearChance(state, loud, cheb(a, at))) continue;
    remember(state, a, at);   // EP12: a heard tile is a trail too; its search looks the way the sound came from
  }
});

/** M11: the creature sees the hero when its tile is in the hero's view and the hero is not hidden. */
export const seesPlayer = (state, a, p) => !p.statuses?.hidden && !a.statuses?.blind && !!state.vis?.[a.y * state.floor.w + a.x];

/**
 * EP13, M15 (1.7 enemy-perception.js observeMove): before the hero takes a step, every hunter that sees him remembers
 * the tile he steps to, so one that loses him round a corner knows which way he went (never later unseen movement).
 */
export function observeMove(state, to, events) {
  const p = state.actors[state.playerId];
  if (!p || cheb(p, to) !== 1) return;
  for (const id of state.order) {
    const a = state.actors[id];
    if (!a || a.hp <= 0 || a.side !== 'foe' || !a.hunting || a.flags?.includes('object') || a.limbOf) continue;
    if (seesPlayer(state, a, p)) remember(state, a, to);
  }
}

/**
 * M14 (1.7 enemy-perception.js remember): hunt toward a copied point. A new point notes which way the trail went (the
 * search reads it) and ends a search; one that was not hunting is caught off guard.
 */
export function remember(state, a, point) {
  if (libraryDormant(state, a)) return;   // EP16
  const prev = a.lastSeen ?? a, dx = point.x - prev.x, dy = point.y - prev.y;
  if (dx || dy) a.searchDir = { x: Math.sign(dx), y: Math.sign(dy) };
  if (!a.hunting) a.caughtOff = state.actions;
  a.hunting = true; a.asleep = false; a.goal = null;
  delete a.coldSince;
  a.lastSeen = { x: point.x, y: point.y, at: state.now };
  if (a.search && (a.search.ax !== point.x || a.search.ay !== point.y)) a.search = null;
}

/** M14 (1.7 forget): the trail is cold; it wanders again. Item 149: coldSince, when it last saw the hero (ai.js sleeps it). */
export function forget(a) {
  if (a.lastSeen) a.coldSince = a.lastSeen.at;
  a.hunting = false; a.lastSeen = null; a.goal = null; a.search = null; a.searchDir = null; a.petAggressor = null;
}

/** M11 (1.7 sees, other bodies): a creature sees one of the hero's allies within 7 on an open line. */
export const seesBody = (state, a, b) => b.hp > 0 && !a.statuses?.blind && !b.statuses?.hidden && cheb(a, b) <= WITNESS && lineClear(state.floor, a, b);

/**
 * EP14, M16 (1.7 enemy-perception.js attacked): when the hero or one of his allies attacks a creature, every other
 * unblinded hostile within 7 with an open line to the victim hunts toward the attacker's tile if it sees him, else the
 * victim's; one that sees an ally attacker marks it for pet retaliation (M18). Witnesses do not pass it on.
 */
export function witness(state, victim, attacker) {
  if (!attacker || (attacker.side !== 'player' && attacker.side !== 'ally')) return;
  for (const id of state.order) {
    const b = state.actors[id];
    if (b === victim || b.hp <= 0 || b.side !== 'foe' || b.statuses?.blind || cheb(b, victim) > WITNESS || !lineClear(state.floor, b, victim)) continue;
    if (b.throne || b.limbOf || b.flags?.includes('object') || b.statuses?.tomb) continue;
    const seen = attacker.side === 'player' ? seesPlayer(state, b, attacker) : seesBody(state, b, attacker);
    remember(state, b, seen ? attacker : victim);
    if (attacker.side === 'ally' && seen) b.petAggressor = attacker.id;
  }
}

/**
 * EP12, M14 (1.7 enemy-perception.js investigate, searchStep): out of sight a hunter walks to the last seen tile; on
 * arrival (or beside it, when the tile is a wall or taken) it searches for 600 time units, each step toward an unvisited
 * tile within 4 of the sighting (4 steps away at most) scored +12 round a corner from it, +2 a tile along the way the
 * trail went, -1 a step. The search never reads where the hidden hero is. Its time or the memory spent, it forgets.
 */
export const SEARCH = 600;

export function investigate(state, a, events) {
  const at = a.lastSeen, f = state.floor;
  if (a.search && (a.search.ax !== at.x || a.search.ay !== at.y)) a.search = null;   // a new trail (heard, told, hit)
  if (!a.search) {
    const d = cheb(a, at), body = bodyAt(state, at.x, at.y);
    if (d > 0 && !(d <= 1 && (isWall(f, at.x, at.y) || (body && body !== a)))) { stepToward(state, a, at, events); return; }
    a.search = { ax: at.x, ay: at.y, until: state.now + SEARCH, visited: [], goal: null };
  }
  if (state.now >= a.search.until) { forget(a); return; }
  searchStep(state, a, events);
}

export function searchStep(state, a, events) {
  const f = state.floor, W = f.w, s = a.search, anchor = { x: s.ax, y: s.ay }, here = a.y * W + a.x;
  if (!s.visited.includes(here)) s.visited.push(here);
  if (!s.goal || (a.x === s.goal.x && a.y === s.goal.y)) {
    const dir = a.searchDir ?? { x: 0, y: 0 }, q = [{ x: a.x, y: a.y, n: 0 }], checked = new Set([here]);
    let best = null, score = -Infinity;
    for (let i = 0; i < q.length; i++) {
      const c = q[i];
      if (c.n > 0 && !s.visited.includes(c.y * W + c.x)) {
        const v = (lineClear(f, anchor, c) ? 0 : 12) + 2 * ((c.x - anchor.x) * dir.x + (c.y - anchor.y) * dir.y) - c.n;
        if (v > score) { score = v; best = { x: c.x, y: c.y }; }
      }
      if (c.n >= 4) continue;
      for (const [dx, dy] of D8) {
        const x = c.x + dx, y = c.y + dy, n = y * W + x;
        if (x < 0 || y < 0 || x >= W || y >= f.h || checked.has(n) || cheb(anchor, { x, y }) > 4) continue;
        if ((isWall(f, x, y) && f.tiles[n] !== T.DOOR) || f.burning?.[n]) continue;
        if (dx && dy && !walkable(f, x, c.y) && !walkable(f, c.x, y)) continue;
        checked.add(n); q.push({ x, y, n: c.n + 1 });
      }
    }
    s.goal = best;
  }
  if (!s.goal || blocks(a, 'move')) return;
  if (!stepToward(state, a, s.goal, events)) { s.visited.push(s.goal.y * W + s.goal.x); s.goal = null; }
}
