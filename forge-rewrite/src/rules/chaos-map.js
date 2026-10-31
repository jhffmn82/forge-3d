// The Realm of Chaos map rules that play reads as well as the floor builders (consolidation C3, world-19): which island
// a cell is on, and the Crucible's gate tiles by phase. Moved from world/biomes/chaos/realm.js, which imports them.

import { T } from '../data/tiles.js';

// WC13, rule 73: off the Realm, an Underdark ritual that failed or a shattered Sealed Lamp lets chaos in; the whole floor
// is its one region (1.7 chaos-enemies.js regionAt: 'ritual-incursion' while floorMeta.ritualChaos or chaosIncursion).
export const chaosRegionAt = (floor, x, y) => (x < 0 || y < 0 || x >= floor.w || y >= floor.h ? null : !floor.chaos ? (floor.ritualChaos || floor.chaosIncursion ? 'ritual-incursion' : null) : floor.chaos.regions[floor.chaos.regionOf[y * floor.w + x]]?.id ?? null);

/** Chaos 70: the gates' tiles by phase (ready: entry shut, rear sealed; active: both sealed; defeated: both open). */
export function syncGates(floor) {
  const c = floor.crucible, W = floor.w;
  if (!c) return;
  // CH33: the sandbox's gate walkthrough raises both (1.7 syncGates: state.walkthrough opens entry and rear).
  const up = c.phase === 'defeated' || !!c.walkthrough;
  // 'preview' (1.7): the locks came back with someone between the gates, so the entrance stays raised and nobody is shut in.
  const entry = up || c.phase === 'preview' ? T.OPEN_DOOR : c.phase === 'ready' ? T.DOOR : T.SEALED, rear = up ? T.OPEN_DOOR : T.SEALED;
  for (let x = c.entryGate.x; x < c.entryGate.x + c.entryGate.w; x++) floor.tiles[c.entryGate.y * W + x] = entry;
  for (let x = c.rearSeal.x; x < c.rearSeal.x + c.rearSeal.w; x++) floor.tiles[c.rearSeal.y * W + x] = rear;
}
