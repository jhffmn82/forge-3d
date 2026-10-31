// Biome hooks for the shared floor builder (src/world/generate.js). Each biome registers the parts of a floor it
// builds its own way; a hook left out means the Dungeon's way. One registry for every biome, so generate.js holds
// one call per hook site and no biome code. Hooks draw only from the rng they are given.
//
// Hook sites (all optional; ctx is { floorNo, bf (floor in biome 1-5), boss, runSeed, floorSeed }):
//   layout(rng, ctx)                                 -> a layout like layoutDungeon's, replacing it
//   bossRoom(rng, floor, rooms, grid, ctx)           -> { room, bodies } on a boss floor, replacing buildBossRoom
//   stairs(rng, floor, goal, rooms, grid, ctx)       -> {x,y} of the down stairs it placed, or null for the Dungeon's
//   dressRoom(rng, floor, grid, room, ctx)           after the plain dressing of each plain room
//   beforeStages(rng, floor, rooms, grid, ctx)       after all room dressing, before propStages (renames, special-room rebuilds)
//   finish(build, ctx)                               in finish(), after keepRoutesOpen and before the arrival stairs
//   arrival(rng, floor, startC, rooms, ctx)          -> {x,y}: where the hero arrives (floors 2+), else null
//   vegetation: false                                 skip the Dungeon's vegetation growth
//   wallTorches: true                                 the Dungeon's derived wall torches (sconces) on this biome's floors
//   specials: { kind: (gen, floor, rooms, host, out, {carvePocket}) -> false when not built }  the biome's own rooms
//   attempt(rng, floorNo, today, runSeed, force, masterworks) -> one attempt at a floor built the biome's own way, or null (it fails)
//   complete(build, floorNo, floorSeed, runSeed)     -> {floor, creatures, start}: that attempt finished (Caverns, Underdark);
//                                                       generate.js runs the attempt loop and the last passes for both

import { biomeOf } from '../../data/schedule.js';

const HOOKS = {};
export function registerBiome(id, hooks) { HOOKS[id] = { ...(HOOKS[id] ?? {}), ...hooks }; }
/** The hooks for a floor (an empty object for the Dungeon or an unbuilt biome). */
export const hooksFor = floorNo => HOOKS[biomeOf(floorNo)] ?? {};
