// The run's floor schedule (consolidation C5; engine-rules-33, render-32, world-13, ui-21), read from floors.json
// schedule: which biome a floor is in, its floor within the biome, and the boss floors. One copy for every layer.

import floors from '../../data/floors.json' with { type: 'json' };

const S = floors.rows.schedule;

/** Biome ids in run order: dungeon, crypt, caverns, underdark, chaos. */
export const BIOMES = S.biomes.map(b => b.biome);

/** A floor's biome index (Dungeon 0); floors past the schedule count as its last biome. */
export function biomeIndex(floorNo) {
  const i = S.biomes.findIndex(b => floorNo >= b.floors[0] && floorNo <= b.floors[1]);
  return i >= 0 ? i : floorNo < S.biomes[0].floors[0] ? 0 : S.biomes.length - 1;
}
/** A floor's biome id. */
export const biomeOf = floorNo => BIOMES[biomeIndex(floorNo)];
/** A floor's number within its biome, 1 to 5. */
export const biomeFloor = floorNo => floorNo - S.biomes[biomeIndex(floorNo)].floors[0] + 1;
/** The boss floors of the schedule (5, 10, 15, 20; the Realm's Crucible is its own floor, not a biome boss floor). */
export const isBossFloor = floorNo => S.biomes[biomeIndex(floorNo)].bossFloor === floorNo;
