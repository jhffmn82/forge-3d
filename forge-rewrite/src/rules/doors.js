// Closing doors (1.7 js/combat/systems.js:68-96): Shift+C shuts every empty open door beside the hero, a click or a
// right-click on one beside the hero shuts that one. Each costs the action; a refusal is said and costs nothing.

import { T, tileAt } from '../data/tiles.js';
import { bodyAt } from './moves.js';
import { refreshSight } from './sight.js';

const say = (events, words) => events.push({ type: 'log', words });

/** 1.7 render.js doorMaterial: what a closed door is made of (null for anything that is not a closed door). */
export function doorMaterial(floor, x, y, t = tileAt(floor, x, y)) {
  if (t === T.DOOR) return floor.biome === 'crypt' ? 'crypt' : 'wood';
  if (t === T.SEALED) return floor.crystalVault?.door?.x === x && floor.crystalVault?.door?.y === y ? 'crystal' : 'iron';
  return t === T.LOCKED ? 'iron' : t === T.TOLL ? 'spiked' : t === T.ICE_DOOR ? 'ice' : t === T.THORNS ? 'thorns' : null;
}

/**
 * C4 (render-02; RC7, 2026-09-27 Q22: an opened door keeps its material): the rules note what every closed door is
 * made of when the floor is entered, so an open door still says what it was and the map only reads it.
 */
export function recordDoorMaterials(floor) {
  for (let y = 0; y < floor.h; y++) for (let x = 0; x < floor.w; x++) {
    const k = y * floor.w + x, mat = doorMaterial(floor, x, y);
    if (mat && !floor.doorMaterials?.[k]) (floor.doorMaterials ??= {})[k] = mat;
  }
}
/** M3 (render-02): the material of the closed door now at (x, y), noted when the rules make one in play (a door shut, a
 *  hidden door found), as the map did on drawing it; so an open door reads what it last was. */
export function noteDoor(floor, x, y) {
  const mat = doorMaterial(floor, x, y);
  if (mat) (floor.doorMaterials ??= {})[y * floor.w + x] = mat;
}
const near = (p, x, y) => Math.max(Math.abs(x - p.x), Math.abs(y - p.y)) === 1;

/** The Crucible's gates stay raised once opened (1.7 FoteUnmakerPreview.gateAt). */
function crucibleGate(f, x, y) {
  const c = f.crucible;
  if (!c) return false;
  return [c.entryGate, c.rearSeal].some(g => g && y === g.y && x >= g.x && x < g.x + g.w);
}
const cluttered = (state, x, y) => (state.floor.items ?? []).some(e => e && e.x === x && e.y === y)
  || (state.floor.props ?? []).some(q => q.x === x && q.y === y && !q.broken)
  || !!bodyAt(state, x, y);

/** 1.7 doorClosable: an open door beside the hero with nothing on it. */
export function doorClosable(state, x, y) {
  const f = state.floor, p = state.actors[state.playerId];
  return tileAt(f, x, y) === T.OPEN_DOOR && !crucibleGate(f, x, y) && near(p, x, y) && !cluttered(state, x, y);
}

function shut(state, list, events) {
  const f = state.floor;
  for (const c of list) {
    f.tiles[c.y * f.w + c.x] = T.DOOR; noteDoor(f, c.x, c.y);
    events.push({ type: 'door', at: c, open: false });
  }
  events.push({ type: 'log', words: list.length > 1 ? 'You close the doors.' : 'You close the door.', sfx: 'door-close' });
  refreshSight(state, events);
  return 'act';
}

/** 1.7 closeDoorAt: one door, by a click. 'act', 'refused' (said), or null when (x, y) is no open door. */
export function closeDoorAt(state, x, y, events) {
  const f = state.floor, p = state.actors[state.playerId];
  if (tileAt(f, x, y) !== T.OPEN_DOOR) return null;
  if (!near(p, x, y) && !(x === p.x && y === p.y)) { say(events, 'You need to stand next to the door.'); return 'refused'; }
  if (crucibleGate(f, x, y)) { say(events, 'The Crucible gates stay raised once opened.'); return 'refused'; }
  if (!doorClosable(state, x, y)) { say(events, x === p.x && y === p.y ? 'Step out of the doorway first.' : 'Something is in the way of the door.'); return 'refused'; }
  return shut(state, [{ x, y }], events);
}

/** 1.7 closeAdjacentDoors: Shift+C. */
export function closeAdjacentDoors(state, events) {
  const f = state.floor, p = state.actors[state.playerId], open = [];
  let blocked = 0, gate = false;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if (!dx && !dy) continue;
    const x = p.x + dx, y = p.y + dy;
    if (tileAt(f, x, y) !== T.OPEN_DOOR) continue;
    if (crucibleGate(f, x, y)) { gate = true; continue; }
    if (doorClosable(state, x, y)) open.push({ x, y }); else blocked++;
  }
  if (open.length) return shut(state, open, events);
  say(events, gate ? 'The Crucible gates stay raised once opened.'
    : tileAt(f, p.x, p.y) === T.OPEN_DOOR ? 'You are standing in the doorway. Step out of it to close the door.'
      : blocked ? 'Something is in the way of the door.' : 'There is no open door next to you.');
  return 'refused';
}
