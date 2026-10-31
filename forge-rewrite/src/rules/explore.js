// Auto-explore, as 1.7's (js/world/travel.js toggleAutoExplore, travelStep, travelPath with explore): one step at a
// time toward the nearest reachable edge of what the hero has seen, never reading tiles the hero has not seen.
// It stops when an awake foe is in sight, the hero is hurt, a new trap is found, a condition needs dealing with, or
// the way is dangerous. When nothing is left the floor is marked done and the next press walks to the stairs down and
// descends. A kind of rules/auto.js's walk (C12): its stop rules are auto.js's, its danger perception.js's hazardAt.

import props from '../../data/props.json' with { type: 'json' };
import { T, tileAt, walkable, opaque } from '../data/tiles.js';
import { isWall, bodyAt } from './moves.js';
import { blocks } from './statuses.js';
import { PROP_USES } from './set-pieces.js';
import { D8_CLOCKWISE as D8 } from '../lib/geometry.js';
import { known, hazardAt, foesInSight } from './perception.js';
import { beginWalk, stopFor } from './walk-rules.js';

// 1.7 exploreStopReason: the conditions that stop a walk before it starts and between steps.
const CONDITIONS = ['root', 'stun', 'frozen', 'fear', 'poison', 'burn', 'bleed', 'rot'];
const PR = props.rows;

const foundTrapAt = (s, x, y) => (s.floor.traps ?? []).some(t => t.found && t.x === x && t.y === y);

/**
 * 1.7 exploreWalkable: a thing that answers a walk-in on the way is the hero's to use, not Explore's: something to
 * break, a lever or puzzle switch, an altar, a caged prisoner, a fountain, a portal, a shrine or anything else with a
 * use (set-pieces.js PROP_USES), and a Crypt corpse (a walk-in smashes it). The map's click uses the same things (item 306).
 */
export function usedOnBump(s, x, y) {
  const f = s.floor;
  if (f.portal && f.portal.x === x && f.portal.y === y) return true;
  if ((f.corpses ?? []).some(c => c.x === x && c.y === y)) return true;
  return (f.props ?? []).some(q => {
    if (q.x !== x || q.y !== y || q.broken) return false;
    const r = PR[q.id] ?? {};
    return r.breakable || r.bush || r.altar || r.drinkable || /^lever/.test(q.id) || q.puzzleSwitch || q.prisoner
      || q.cleansingShrine || q.offeringBowl || !!PROP_USES[q.id];
  });
}

/** Where explore may walk: open ground and shut doors; never chasms, exits, portals, locked or paid ways. */
function exploreWalkable(s, x, y) {
  const t = tileAt(s.floor, x, y);
  if (t === T.CHASM || t === T.EXIT || t === T.PORTAL || t === T.STAIRS_UP) return false;
  if (usedOnBump(s, x, y)) return false;
  if (t === T.DOOR) return true;
  return walkable(s.floor, x, y) && !isWall(s.floor, x, y);
}

/** An unvisited known tile beside a tile the hero has not seen (that it could see from here), or a shut door. */
function frontier(s, x, y, visited) {
  if (visited.has(y * s.floor.w + x)) return false;
  if (tileAt(s.floor, x, y) === T.DOOR) return true;
  for (const [dx, dy] of D8) {
    const nx = x + dx, ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= s.floor.w || ny >= s.floor.h || known(s, nx, ny)) continue;
    // A hidden corner behind two touching known walls cannot be seen from here.
    if (dx && dy && known(s, x + dx, y) && opaque(s.floor, x + dx, y) && known(s, x, y + dy) && opaque(s.floor, x, y + dy)) continue;
    return true;
  }
  return false;
}

/**
 * Breadth-first over known tiles: to `goal` when given, else to the nearest frontier. Ties prefer fewer diagonals
 * (1.7). Returns the path of steps (not including the start), or null.
 */
export function explorePath(s, visited, goal = null) {
  const f = s.floor, W = f.w, p = s.actors[s.playerId], start = p.y * W + p.x;
  const prev = new Int32Array(W * f.h).fill(-1), steps = new Int32Array(W * f.h), diag = new Int32Array(W * f.h);
  prev[start] = start;
  const q = [start];
  let end = -1;
  for (let h = 0; h < q.length; h++) {
    const i = q[h], x = i % W, y = (i / W) | 0;
    if (goal ? x === goal.x && y === goal.y : i !== start && frontier(s, x, y, visited)) { end = i; break; }
    // A shut door is a goal, not a way through: the bump opens it and the next search goes on from there.
    if (i !== start && tileAt(f, x, y) === T.DOOR) continue;
    for (const [dx, dy] of D8) {
      const nx = x + dx, ny = y + dy;
      if (!known(s, nx, ny)) continue;
      const ni = ny * W + nx, ns = steps[i] + 1, nd = diag[i] + (dx && dy ? 1 : 0);
      if (prev[ni] >= 0 && (steps[ni] !== ns || diag[ni] <= nd)) continue;
      if (!exploreWalkable(s, nx, ny) || hazardAt(s, nx, ny) || foundTrapAt(s, nx, ny)) continue;
      const b = bodyAt(s, nx, ny);
      if (b && b.side !== 'ally' && b.id !== p.id) continue;
      if (prev[ni] < 0) q.push(ni);
      prev[ni] = i; steps[ni] = ns; diag[ni] = nd;
    }
  }
  if (end < 0) return null;
  const path = [];
  for (let c = end; c !== start; c = prev[c]) path.push({ x: c % W, y: (c / W) | 0 });
  return path.reverse();
}

/** 1.7 exploreStopReason: why explore cannot go on from here, or null (walk: the walk under way, for its alarms). */
export function exploreStopReason(s, walk = null) {
  const p = s.actors[s.playerId];
  // Chaos rule 65 (C12): a hidden Shade or a sleeping foe in sight does not stop it.
  if (foesInSight(s, { awake: true, hidden: false }).length) return 'You stop exploring: an enemy is in sight.';
  if (CONDITIONS.some(k => p.statuses?.[k]) || blocks(p, 'move')) return 'You stop exploring: deal with your condition first.';
  if (hazardAt(s, p.x, p.y)) return 'You stop exploring: you are standing in danger.';
  // 1.7 T.alarms: an alarm bell within earshot when the walk began has since rung (a sprung alarm leaves the floor).
  if (walk && stopFor(s, walk, 'alarm')) return 'You stop exploring: an alarm sounds nearby.';
  return null;
}

/** The nearest stairs down the hero has seen and can safely reach. */
function stairsDown(s, visited) {
  let best = null, len = Infinity;
  const f = s.floor;
  for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) {
    if (!known(s, x, y) || tileAt(f, x, y) !== T.STAIRS) continue;
    const route = explorePath(s, visited, { x, y });
    if (route && route.length < len) { best = { x, y }; len = route.length; }
  }
  return best;
}

/**
 * Starts auto-explore. Returns { walk } (the walk's memory, for exploreNext) or { say } when it cannot start. On a
 * floor marked done it walks to the stairs down instead, unless a new way has opened since (1.7).
 */
export function startExplore(s) {
  const p = s.actors[s.playerId];
  if (!p || p.hp <= 0 || s.over) return { say: null };
  const why = exploreStopReason(s);
  if (why) return { say: why };
  const walk = { ...beginWalk(s, 'explore'), visited: new Set([p.y * s.floor.w + p.x]), destination: null };
  if (s.floor.exploreComplete) {
    const left = explorePath(s, walk.visited);
    if (left?.length) delete s.floor.exploreComplete;
    else {
      walk.destination = stairsDown(s, walk.visited);
      if (!walk.destination) return { say: 'No safely reachable stairs down.' };
    }
  }
  return { walk };
}

/**
 * The walk's next command: { command } to play, or { stop, say } when it ends ({ stop, command } when it ends by
 * taking the stairs down). Call after each step's events have played.
 */
export function exploreNext(s, walk) {
  const p = s.actors[s.playerId];
  if (stopFor(s, walk, 'gone')) return { stop: true };
  if (stopFor(s, walk, 'hurt')) return { stop: true, say: 'You stop: you are hurt.' };
  if (stopFor(s, walk, 'trap')) return { stop: true, say: 'You stop: you spotted a trap.' };
  const why = exploreStopReason(s, walk);
  if (why) return { stop: true, say: why };
  walk.visited.add(p.y * s.floor.w + p.x);
  const d = walk.destination;
  if (d && tileAt(s.floor, d.x, d.y) !== T.STAIRS) return { stop: true, say: 'The stairs are no longer there.' };
  if (d && p.x === d.x && p.y === d.y) return { stop: true, command: { type: 'descend' } };
  const path = explorePath(s, walk.visited, d);
  if (!path?.length) {
    if (d) return { stop: true, say: 'No safely reachable stairs down.' };
    s.floor.exploreComplete = true;
    return { stop: true, say: 'No more safely reachable areas to explore.' };
  }
  const step = path[0];
  // A step that did not move the hero (a bump that was refused) ends the walk; a door opening is a move.
  if (walk.last && walk.last.x === p.x && walk.last.y === p.y && !(walk.lastDoor && tileAt(s.floor, walk.lastDoor.x, walk.lastDoor.y) === T.OPEN_DOOR)) return { stop: true };
  walk.last = { x: p.x, y: p.y };
  walk.lastDoor = tileAt(s.floor, step.x, step.y) === T.DOOR ? step : null;
  walk.hp = Math.min(walk.hp, p.hp);
  return { command: { type: 'move', dx: step.x - p.x, dy: step.y - p.y } };
}
