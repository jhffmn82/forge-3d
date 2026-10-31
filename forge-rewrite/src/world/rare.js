// Rare rooms rolled once per run (spec/world.md "Rare rooms" 59-63, R4-R5): each from its own stream (run seed ^ salt),
// first a chance, then a floor, so a floor generated again never moves them. Never on a plane or boss floor.

import { stream, next } from '../lib/rng.js';
import { biomeIndex, isBossFloor } from '../data/schedule.js';

/** Rule 59: the floor a rare event of `biome` lands on this run, or -1 (biome 0 floors 2-4; biome b 5b+1 to 5b+4). */
export function rareFloor(runSeed, biome, salt, chance) {
  if (runSeed == null) return -1;
  const ev = stream((runSeed ^ salt) >>> 0);
  if (next(ev) >= chance) return -1;
  const first = biome === 0 ? 2 : biome * 5 + 1, count = biome === 0 ? 3 : 4;
  return first + Math.floor(next(ev) * count);
}


/** R4: the sword in the stone, 5% a run on floors 2-4 of the Dungeon. */
export function swordStoneFloor(runSeed) { return rareFloor(runSeed, 0, 0x53574F52, 0.05); }

/** Rule 61: each biome's pair of hidden sigil themes (rooms.json hidden-* rows, 1.7 rare-rooms.js:2-11 order). */
export const HIDDEN_THEMES = [['cartographer', 'slime-chamber'], ['cleansing-shrine', 'embalmer-cell'], ['fungal-pantry', 'petrified-shrine'], ['smuggler-hideout', 'folded-study']];

/**
 * Rules 60-62: the hidden sigil theme due on this floor, as its rooms.json id without `hidden-`, or null. The Last
 * Expedition (5%, floors 2-4) wins over the biome's theme; a Dungeon Slime Chamber drawn for floor 2 moves to floor 3.
 */
export function hiddenTheme(runSeed, floorNo) {
  if (runSeed == null || isBossFloor(floorNo) || floorNo > 25) return null;
  if (rareFloor(runSeed, 0, 0x45585044, 0.05) === floorNo) return 'last-expedition';
  const b = biomeIndex(floorNo);
  if (b > 3) return null;
  let at = rareFloor(runSeed, b, (0x48494445 ^ (b * 7919)) >>> 0, 0.10);
  const theme = HIDDEN_THEMES[b][Math.floor(next(stream((runSeed ^ 0x53494749 ^ (b * 104729)) >>> 0)) * 2)];
  // Rule 62's other half (a saved floor 2 that already holds one) cannot arise: floor 2 never gets it here.
  if (theme === 'slime-chamber' && at === 2) at = 3;
  return at === floorNo ? theme : null;
}

/** The unique rare rooms in 1.7's order (rare-rooms.js:33-41): kind, biome, salt. */
const UNIQUE = [['bone-gauntlet', 1, 0x424F4E45], ['volatile-hoard', 2, 0x564F4C41], ['drider-lair', 3, 0x44524944],
  ['hungry-spider', 1, 0x53504944], ['sealed-lamp', 2, 0x4C414D50], ['dark-wizard-library', 3, 0x57495A44]];

/**
 * R6, rule 68: the unique rare room due on this floor (each 5% a run), or null. It replaces the first special pick and
 * needs a free room of area 25. Ruling 15 (2026-10-15): when a later one rolls a floor an earlier one of its biome
 * already holds, it moves to the next free floor of its range (round to the range's start), where 1.7 lost it.
 */
export function uniqueRareKind(runSeed, floorNo) {
  if (runSeed == null || isBossFloor(floorNo)) return null;
  const held = new Map();
  for (const [kind, biome, salt] of UNIQUE) {
    let at = rareFloor(runSeed, biome, salt, 0.05);
    if (at < 0) continue;
    const first = biome === 0 ? 2 : biome * 5 + 1, count = biome === 0 ? 3 : 4;
    for (let i = 0; i < count && held.has(at); i++) at = first + ((at - first + 1) % count);
    if (!held.has(at)) held.set(at, kind);
  }
  return held.get(floorNo) ?? null;
}

/**
 * The sandbox's room preview (1.7 FoteRoomPreview, world.js:393, puzzles.js:35, rare-rooms.js:20), generateFloor's
 * opts.force {type, kind} carried on the floor's gen (W6, world-20: no module state): the first special pick is `kind`
 * ({type:'special'}), the hidden room is that theme ({type:'hidden'}) or the floor's puzzle is that one
 * ({type:'puzzle'}). A builder that makes the forced room sets force.built.
 */
export const forcedKind = (gen, type) => (gen?.force?.type === type ? gen.force.kind : null);
/** A builder made the forced room. */
export function forcedBuilt(gen) { if (gen?.force) gen.force.built = true; }
