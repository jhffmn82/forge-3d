// One way off a floor and one way onto one (consolidation C3, engine-rules-05). The ordinary stairs, the Realm's
// currents and treasure room, the planes and the sandbox all call these, so a floor left behind is kept the same way
// every time: its creatures with every ally (allies wait on the floor they were left on: chaos answer 5, ruled
// 2026-10-16 "they wait"), never the followers (the fed hungry spider, Justin 2026-10-16: "it follows you"), stamped
// with when it was left; and taken back with its clocks paused for the time away (spec/world.md 838; planes 37).
// Keys reset on each new floor (W27, W48), not on a plane.

import { pauseClocks } from './floor-clocks.js';
import { isWall, bodyAt } from '../rules/moves.js';
import { removeStatus } from '../rules/statuses.js';
import { noteDoor } from '../rules/doors.js';
import { portalLight, gatewayLight, chaosLights, lightsAsEntries } from '../world/floor-lights.js';
export { replaceWebScenery } from '../world/biomes/underdark/web-traps.js';   // a loaded floor's webs (save.js reads the world through the engine)

/** The floor the hero is on and every kept one. */
const everyFloor = state => [state.floor, ...Object.values(state.stored ?? {}).map(s => s?.floor)].filter(f => f?.tiles);

/** W8 (save.js's version 6 migration): every floor's terrain lights as floor.lights entries, the Realm's palette its own. */
export function lightsOwnRecord(state) {
  for (const f of everyFloor(state)) lightsAsEntries(f);
  return state;
}

/**
 * M3 (render-02; save.js's version 5 migration): a save from before the rules owned these carries what the map wrote at
 * draw time. Every floor in it (the one the hero is on and every kept one) takes its closed doors' materials and its
 * portal, gateway and Chaos lights from the rules and the floor builders (C4, W3), which replace the drawn entries; an
 * open door keeps the material it has.
 */
export function rulesOwnFloors(state) {
  for (const f of [state.floor, ...Object.values(state.stored ?? {}).map(s => s?.floor)]) {
    if (!f?.tiles) continue;
    for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) noteDoor(f, x, y);
    portalLight(f);
    if (f.treasureRoom) gatewayLight(f);
    chaosLights(f);
  }
  return state;
}

/** The hero's allies that go where the hero goes (the fed hungry spider). */
export const followers = state => state.order.slice(1).map(id => state.actors[id]).filter(a => a && a.follows && a.side === 'ally' && a.hp > 0);

/** Keeps the floor the hero is on under `key` (extra: anything more kept with it, as a plane's way home); returns its followers. */
export function leaveFloor(state, key, extra = {}) {
  const pets = followers(state);
  state.stored[key] = { floor: state.floor, creatures: state.order.slice(1).map(id => state.actors[id]).filter(a => a && !pets.includes(a)), seen: state.seen, leftAt: state.now, ...extra };
  return pets;
}

/** Takes a kept floor back out, its clocks paused for the time the hero was away; null when there is none. */
export function takeStored(state, key) {
  const kept = state.stored[key];
  if (!kept) return null;
  delete state.stored[key];
  pauseClocks(kept, state.now - (kept.leftAt ?? state.now));
  return kept;
}

/** Puts the hero on a floor through enter (game.js enterFloor): the keys reset (keepKeys on a plane), the followers beside him. */
export function arriveFloor(state, floorNo, built, at, { enter, pets = [], keepKeys = false }) {
  if (!keepKeys) state.hero.keys = 0;
  enter(state, floorNo, built, at);
  const p = state.actors[state.playerId];
  // Item 287 (1.7 transition-adapter.js:36, :51 player.levitate=0): Levitate ends with the floor left behind.
  if (p.statuses?.levitate) removeStatus(state, p, 'levitate', []);
  for (const a of pets) {
    let spot = null;
    for (let r = 1; r <= 4 && !spot; r++) for (let dy = -r; dy <= r && !spot; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const x = p.x + dx, y = p.y + dy;
      if (!isWall(state.floor, x, y) && !bodyAt(state, x, y)) { spot = { x, y }; break; }
    }
    if (!spot) continue;
    Object.assign(a, { x: spot.x, y: spot.y, t: p.t });
    state.actors[a.id] = a; state.order.push(a.id);
  }
}
