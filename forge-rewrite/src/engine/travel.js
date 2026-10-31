// Walking more than a step on one command, as 1.7's travel owner (js/world/travel.js @3c8b312): routes over what the
// hero knows (travelPath, with Explore's safety rules when asked) and the walk itself (startTravel, travelStep), used by
// the map's walk to a landmark (automap.js automapWalkTo). Every step is an ordinary move command; the walk stops
// when the hero is hurt, a foe comes into view or a trap is spotted: rules/auto.js's stop rules and perception.js's
// hazards (C12), as auto-explore and rest.
// Headless: the walker is handed play() and say() by main.js and is told when each step's events have played.

import props from '../../data/props.json' with { type: 'json' };
import { T, tileAt, walkable } from '../data/tiles.js';
import { litAt } from '../rules/sight.js';
import { known, hazardAt } from '../rules/perception.js';
import { beginWalk, stopFor } from '../rules/auto.js';

const PR = props.rows;
const USE = [T.DOOR, T.CHEST, T.SHRINE, T.FORGE, T.LOCKED, T.SEALED, T.ICE_DOOR, T.THORNS, T.TOLL];
const useTile = (s, t) => USE.includes(t) || (t === T.EXIT && !s.floor.exitOpen);
const propsAt = (s, x, y) => (s.floor.props ?? []).filter(p => p.x === x && p.y === y && !p.broken);
const blockingProp = (s, x, y) => propsAt(s, x, y).some(p => p.blocks || PR[p.id]?.blocks);
const aName = n => (/^The | the /.test(n ?? '') ? n : (/^[AEIOU]/i.test(n ?? '') ? 'an ' : 'a ') + n);   // CD27: 'a Goblin', as 1.7 aName

/** Levitate turns left on the hero (0 without it). */
const floatTurns = s => { const l = s.actors[s.playerId]?.statuses?.levitate; return l ? (l.n ?? l.turns ?? 1) : 0; };
/** A wind carry (rules/puzzles.js windCarry) holds the hero up for as long as it lasts: 1.7 aff('air') >= 3. */
const carried = s => !!s.actors[s.playerId]?.windCarry && (s.hero?.affinity?.air ?? 0) >= 3;

/**
 * 1.7 travelWalkable: ground a step can stand on. A chasm only while floating with more than this turn left (or on a
 * wind carry), never the Realm's void.
 */
function travelWalkable(s, x, y) {
  if (blockingProp(s, x, y)) return false;
  if (walkable(s.floor, x, y)) return true;
  if (tileAt(s.floor, x, y) !== T.CHASM || s.floor.voidImpassable) return false;
  return floatTurns(s) > 1 || carried(s);
}

/** 1.7 exploreWalkable: no paid interactions, chasms, exits, portals or things to use on Explore's way. */
function exploreWalkable(s, x, y) {
  const t = tileAt(s.floor, x, y);
  if (t === T.CHASM || t === T.EXIT || t === T.PORTAL || (useTile(s, t) && t !== T.DOOR)) return false;
  if (propsAt(s, x, y).some(p => { const r = PR[p.id] ?? {}; return p.blocks || r.blocks || r.breakable || /^lever/.test(p.id) || r.altar || r.drinkable || p.prisoner || r.bush; })) return false;
  return travelWalkable(s, x, y) || t === T.DOOR || t === T.OPEN_DOOR;
}

/** 1.7 travelHazard: known ground that hurts or holds (fire, fields, marked tiles, lava beside; perception.js). */
export const travelHazard = (s, x, y) => hazardAt(s, x, y, { who: 'travel' });

/**
 * 1.7 travelPath: the shortest route over known tiles (fewest diagonals among equals), avoiding found traps and
 * bodies; null when there is none. o.stopAdjacent ends beside (tx, ty); o.explore follows Explore's safety rules
 * (no hazards, nothing to use or pay on the way, bodies in sight only).
 */
export function travelPath(s, tx, ty, o = {}) {
  const f = s.floor, W = f.w, p = s.actors[s.playerId], ex = o.explore ?? null;
  const prev = new Int32Array(W * f.h).fill(-1), steps = new Int32Array(W * f.h), diag = new Int32Array(W * f.h);
  const start = p.y * W + p.x;
  let goal = ty * W + tx, adjacent = -1;
  prev[start] = start;
  const trap = new Set((f.traps ?? []).filter(q => q.found).map(q => q.y * W + q.x));
  const body = new Set();
  for (const id of s.order) {
    const a = s.actors[id];
    if (!a || a.hp <= 0 || id === s.playerId || a.side === 'ally' || a.hidden) continue;
    const n = a.size ?? 1;
    for (let y = a.y; y < a.y + n; y++) for (let x = a.x; x < a.x + n; x++) if (ex ? litAt(s, x, y) : known(s, x, y)) body.add(y * W + x);
  }
  const q = [start];
  for (let h = 0; h < q.length; h++) {
    const i = q[h];
    if (adjacent >= 0 && steps[i] > steps[adjacent]) break;
    if (i === goal) break;
    const x = i % W, y = (i / W) | 0;
    if (o.stopAdjacent && i !== start && Math.max(Math.abs(x - tx), Math.abs(y - ty)) <= 1) {
      if (adjacent < 0 || diag[i] < diag[adjacent]) adjacent = i;
      continue;
    }
    if (adjacent >= 0) continue;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = x + dx, ny = y + dy;
      if (!known(s, nx, ny)) continue;
      const ni = ny * W + nx, ns = steps[i] + 1, nd = diag[i] + (dx && dy ? 1 : 0);
      if (prev[ni] >= 0 && (steps[ni] !== ns || diag[ni] <= nd)) continue;
      const t = tileAt(f, nx, ny), isGoal = ni === goal;
      if (o.noChasm && t === T.CHASM) continue;
      const ok = travelWalkable(s, nx, ny) || t === T.DOOR || t === T.OPEN_DOOR || (isGoal && (useTile(s, t) || t === T.EXIT));
      if (!ok || (trap.has(ni) && (!isGoal || ex))) continue;
      if (ex && (!exploreWalkable(s, nx, ny) || travelHazard(s, nx, ny))) continue;
      if (!isGoal && body.has(ni)) continue;
      if (prev[ni] < 0) q.push(ni);
      prev[ni] = i; steps[ni] = ns; diag[ni] = nd;
    }
  }
  if (adjacent >= 0) goal = adjacent;
  if (goal < 0 || prev[goal] < 0 || goal === start) return goal === start && o.stopAdjacent ? [] : null;
  const path = [];
  for (let c = goal; c !== start; c = prev[c]) path.push({ x: c % W, y: (c / W) | 0 });
  path.reverse();
  // 1.7 travelPath: a route over a chasm must leave Levitate for the approach, the crossing and the landing; when it
  // would not, the route goes round on solid ground instead (or there is none). Air mastery 3 (the wind carry) needs no
  // budget.
  if (!o.noChasm && (s.hero?.affinity?.air ?? 0) < 3) {
    let last = -1;
    path.forEach((q, n) => { if (tileAt(f, q.x, q.y) === T.CHASM) last = n; });
    if (last >= 0 && last + 2 > floatTurns(s)) return travelPath(s, tx, ty, { ...o, noChasm: true });
  }
  return path;
}

/** Foes in sight and awake (1.7 visibleFoeIds). */
export const visibleFoes = s => s.order.map(id => s.actors[id]).filter(a => a && a.hp > 0 && a.side === 'foe' && !a.hidden && !a.asleep && litAt(s, a.x, a.y));

/**
 * The walker. hooks: game() the state now, play(command) one command, say(words) a log line. main.js calls next()
 * each time a step's events have played.
 */
export function createTraveller(hooks) {
  let R = null, hinted = false;
  const g = () => hooks.game();

  function stop(why) {
    if (!R) return false;
    R = null;
    if (why) hooks.say(why);
    return true;
  }
  function begin(rec) {
    const s = g(), p = s.actors[s.playerId];
    R = { ...rec, ...beginWalk(s, 'travel'), foes: visibleFoes(s).map(a => a.id), last: null };
    next();
    return true;
  }

  /** A route of steps (1.7 startTravel). With an awake foe in sight it is one step at a time. */
  function walk(path, then = null) {
    stop();
    const s = g();
    if (!s || !path) return false;
    if (!path.length) { then?.(); return true; }
    if (path.length > 1 && visibleFoes(s).length) {
      path = path.slice(0, 1);
      if (!hinted) { hinted = true; hooks.say('With an enemy in sight, you take one step at a time. Click again to keep going.'); }
    }
    return begin({ path: path.slice(), then });
  }

  /** Called when the last step's events have played: judge it, then take the next one. */
  function next() {
    const s = g();
    if (!R || !s) return;
    const p = s.actors[s.playerId];
    if (stopFor(s, R, 'gone')) { stop(); return; }
    // What the last step did.
    if (R.last) {
      const l = R.last; R.last = null;
      const moved = p.x !== l.x || p.y !== l.y, spent = s.now !== l.now || s.actions !== l.actions;
      if (!moved) {
        // A shut door on the way opened with the bump: the same step again (1.7).
        if (spent && tileAt(s.floor, l.step.x, l.step.y) === T.OPEN_DOOR) R.path.unshift(l.step);
        else if (!R.path.length && spent) { const th = R.then; R = null; th?.(); return; }
        else { stop(); return; }
      }
    }
    // What stops a walk.
    if (stopFor(s, R, 'hurt')) { stop('You stop: you are hurt.'); return; }
    const fresh = visibleFoes(s).find(a => !R.foes.includes(a.id));
    if (fresh) { stop(`You stop: ${aName(fresh.name)} comes into view.`); return; }
    if (stopFor(s, R, 'trap')) { stop('You stop: you spotted a trap.'); return; }
    R.hp = Math.min(R.hp, p.hp);
    const st = R.path.shift();
    if (!st) { const th = R.then; R = null; th?.(); return; }
    const dx = st.x - p.x, dy = st.y - p.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) !== 1) { stop(); return; }
    if (tileAt(s.floor, st.x, st.y) === T.CHASM && !travelWalkable(s, st.x, st.y)) { stop('You stop: the chasm is no longer safe to cross.'); return; }
    R.last = { x: p.x, y: p.y, now: s.now, actions: s.actions, step: st };
    hooks.play({ type: 'move', dx, dy });
  }

  return {
    walk, next, stop,
    get active() { return !!R; },
  };
}
