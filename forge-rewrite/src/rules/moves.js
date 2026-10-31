import props from '../../data/props.json' with { type: 'json' };
import { walkable } from '../data/tiles.js';
import { HOOKS } from './set-pieces.js';

// Moving bodies on the floor. Anything not walkable (spec/world.md tiles), a blocking prop and other bodies stop a step.

export const propAt = (floor, x, y) => floor.props?.find(p => p.x === x && p.y === y) ?? null;
export const isWall = (floor, x, y) => { const p = propAt(floor, x, y); return !walkable(floor, x, y) || !!p?.blocks || !!props.rows[p?.id]?.blocks; };

/**
 * G43 (1.7 geometry.js:11 projectileBlocker, world.js:56): the body on (x, y) that stops a shot or a bolt flying past;
 * a Tiny creature can be aimed at but does not intercept a shot aimed beyond it.
 */
export function shotBodyAt(state, x, y) {
  const a = bodyAt(state, x, y);
  return a && !(a.flags ?? []).includes('tiny') ? a : null;
}

export function bodyAt(state, x, y) {
  for (const id of state.order) {
    const a = state.actors[id];
    if (a.hp > 0 && a.x === x && a.y === y) return a;
  }
  return null;
}

/** Moves one step if the tile is open and empty. Returns true when it moved. */
export function tryStep(state, a, dx, dy, events) {
  const x = a.x + dx, y = a.y + dy;
  if (isWall(state.floor, x, y) || bodyAt(state, x, y)) return false;
  moveBody(state, a, { x, y }, events);
  return true;
}

/**
 * C5 (engine-rules-16): puts a body on `to` (the caller has checked the tile) and fires what that way of moving fires.
 * - 'step' and 'push' (a knockback): walking onto the tile; grass is trampled, a trap springs, a field takes it.
 * - 'dash': a charge's run; the 'moved' event carries dash, nothing on the tile answers.
 * - 'teleport': a blink or a swap; a 'teleported' event, nothing on the tile answers.
 */
export function moveBody(state, a, to, events, { mode = 'step' } = {}) {
  const from = { x: a.x, y: a.y }, { x, y } = to;
  a.x = x; a.y = y;
  if (mode === 'teleport') { events.push({ type: 'teleported', id: a.id, from, to: { x, y } }); return; }
  if (mode === 'dash') { events.push({ type: 'moved', id: a.id, from, to: { x, y }, dash: true }); return; }
  // Vegetation 126: a body that walks (not one that flies or levitates) tramples tall grass short; the step is then
  // the grass rustle alone (CB31, 1.7 systems.js:64).
  const k = y * state.floor.w + x;
  const trampled = state.floor.ground?.[k] === 1 && !a.flags?.includes('flying') && !a.statuses?.levitate;
  events.push({ type: 'moved', id: a.id, from, to: { x, y }, ...(mode === 'push' ? { knocked: true } : {}), ...(trampled ? { trampled: true } : {}) });
  if (trampled) {
    state.floor.ground[k] = 2;
    events.push({ type: 'ground', at: { x, y }, ground: 2, by: a.id });
  }
  // What the tile answers (set-pieces.js stepped, in order): traps 77, a trap springs; E13, a field takes the body.
  for (const h of HOOKS.stepped) { if (a.hp <= 0) break; h(state, a, events); }
}
