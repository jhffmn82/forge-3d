// A creature's step (consolidation C17, moved from ai.js so the AI's parts below it need not import it): the walk field
// toward a goal, kept until the walls change, a step down it or away, and a dormant library keeper.

import { tryStep, bodyAt } from './moves.js';
import { walkField, openGrid, sideOpen, stepAway as pathStepAway } from './path.js';
import { lavaRisk } from './perception.js';
import { D8 } from '../lib/geometry.js';
import { T } from '../data/tiles.js';

const FIELDS = new WeakMap();   // per game state, kept off the state so saves stay plain data

// Sandbox item 43: every wandering creature ran a whole-floor search each action, a step took up to a second. The
// distances depend only on the floor's walls, so they are kept until a wall, door, prop or the floor changes.
function field(state, goal) {
  const f = state.floor, W = f.w;
  let c = FIELDS.get(state);
  if (!c || c.actions !== state.actions || c.floor !== f) {
    const grid = openGrid(f);
    const same = c && c.floor === f && c.grid.length === grid.length && c.grid.every((v, i) => v === grid[i]);
    c = { actions: state.actions, floor: f, grid, fields: same ? c.fields : new Map() };
    FIELDS.set(state, c);
  }
  const key = goal.y * W + goal.x;
  if (c.fields.has(key)) return c.fields.get(key);
  if (c.fields.size > 64) c.fields.clear();
  const d = walkField(f, goal, { grid: c.grid });   // C10a: path.js's field, item 141's corner rule
  c.fields.set(key, d);
  return d;
}

/** The same distances with some cells closed (burning ground for G27); built only when the plain field is blocked. */
const fieldAvoiding = (state, goal, closed) => walkField(state.floor, goal, { closed });

export { field as walkDistances };   // for the tests

/** One step down the field toward `goal` (bodies route round); true when it moved or opened a door. */
export function stepToward(state, a, goal, events) {
  const f = state.floor, W = f.w;
  // G27 (1.7 actor-ai.js:31, :40, :142-148; M28): a creature never steps into a burning tile unless it is a fire creature;
  // when fire stands on its way it walks a field that routes round the flames.
  const traps = a.escapee || a.avoidTraps ? new Set((f.traps ?? []).map(t => t.y * W + t.x)) : null;
  const shy = traps || (f.burning && a.element !== 'fire') ? i => traps?.has(i) || (a.element !== 'fire' && !!f.burning?.[i]) : null;
  const pick = d => {
    const here = d[a.y * W + a.x];
    return D8.map(([dx, dy]) => ({ dx, dy, v: d[(a.y + dy) * W + a.x + dx] }))
      .filter(o => o.v >= 0 && !shy?.((a.y + o.dy) * W + a.x + o.dx) && (here < 0 || o.v < here || (o.v === here && !bodyAt(state, a.x + o.dx, a.y + o.dy))))
      .sort((p, q) => p.v - q.v);
  };
  let options = pick(traps?.size ? fieldAvoiding(state, goal, shy) : field(state, goal));
  if (shy && !options.length) options = pick(fieldAvoiding(state, goal, shy));
  // Sandbox U4 (lava.js): a step that leaves it beside lava is taken only when no other step makes progress.
  if (f.lava && options.some(o => !lavaRisk(f, a, a.x + o.dx, a.y + o.dy))) options.sort((p, q) => lavaRisk(f, a, a.x + p.dx, a.y + p.dy) - lavaRisk(f, a, a.x + q.dx, a.y + q.dy) || p.v - q.v);
  for (const o of options) {
    const x = a.x + o.dx, y = a.y + o.dy;
    if (f.tiles[y * W + x] === T.DOOR) {   // M28; G28 (1.7 actor-ai.js:59): a door seen opening is heard and told
      f.tiles[y * W + x] = T.OPEN_DOOR;
      const seen = !!state.vis?.[y * W + x];
      events.push({ type: 'door', at: { x, y }, open: true, by: a.id, ...(seen ? { sfx: 'door-open' } : {}) });
      if (seen) events.push({ type: 'log', words: 'A door swings open.' });
      return true;
    }
    if (o.dx && o.dy && !sideOpen(f, a.x + o.dx, a.y) && !sideOpen(f, a.x, a.y + o.dy)) continue;
    if (tryStep(state, a, o.dx, o.dy, events)) return true;
  }
  // 1.7 stepToward (actor-ai.js: actorPathStep || stepEnt): with no step down the field (the goal shut off from it, or
  // every way taken), the direct step toward the goal, else either half of it, so a creature closes in instead of
  // standing where it is.
  if (options.length) return false;
  const sx = Math.sign(goal.x - a.x), sy = Math.sign(goal.y - a.y);
  for (const [dx, dy] of [[sx, sy], [sx, 0], [0, sy]]) {
    if (!dx && !dy) continue;
    if (dx && dy && !sideOpen(f, a.x + dx, a.y) && !sideOpen(f, a.x, a.y + dy)) continue;
    if (shy?.((a.y + dy) * W + a.x + dx)) continue;
    if (tryStep(state, a, dx, dy, events)) return true;
  }
  return false;
}

export const stepAway = (state, a, from, events) => pathStepAway(a, from, (dx, dy) => tryStep(state, a, dx, dy, events));   // 1.7 fleeStep (path.js)

/**
 * EP16, M21 (1.7 enemy-perception.js libraryDormant): a keeper of a library the hero has not entered sleeps on and
 * forgets; it takes no action and nothing it hears or sees wakes it (puzzles.js entered() wakes the room's keepers).
 */
export function libraryDormant(state, a) {
  const d = a?.libraryRoom;
  if (!d) return false;
  const room = (state.floor?.puzzles ?? []).find(r => r.kind === 'library' && r.door?.x === d.x && r.door?.y === d.y);
  if (!room || room.entered) return false;
  const p = state.actors[state.playerId];
  if (p && p.x >= room.x && p.y >= room.y && p.x < room.x + room.w && p.y < room.y + room.h) return false;
  a.asleep = true; a.hunting = false; a.lastSeen = null; a.goal = null; a.search = null;
  return true;
}
