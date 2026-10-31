// The Crypt, floors 6-10 (spec/world.md "The Crypt"; biomes.json crypt): its hooks into the shared floor builder.

import { registerBiome } from '../registry.js';
import { cryptBossLayout, buildMortyHall, clearHall } from './hall.js';
import { dressCryptRoom, dressCryptFloor, cryptOoze, cryptWallVeg, cryptScatterRules, repairWallPieces, urnChamber } from './dress.js';
import { roomGrid } from '../../dress.js';
import { deadEndStairs, deadEndArrival } from '../dead-end.js';
import { CRYPT_SPECIALS } from './specials.js';
import { CRYPT_ROOMS } from './rooms.js';
import { oozeField } from '../../fields.js';

registerBiome('crypt', {
  // 12-14: the shared BSP rooms; floor 10 adds the stamped hall.
  layout: (rng, ctx) => (ctx.boss ? cryptBossLayout(rng, ctx.cap) : null),
  bossRoom: (rng, floor, rooms) => buildMortyHall(rng, floor, rooms),
  // Ruling 12: the urn chamber built as its own kind when it is rolled (rooms.json urn-chamber, in place of storage).
  specials: { ...CRYPT_SPECIALS, ...CRYPT_ROOMS, 'urn-chamber': (gen, floor, rooms, host) => { host.special = 'urn-chamber'; urnChamber(gen.rng, floor, roomGrid(floor, rooms), host); } },   // S22 the hero's tomb, S34 the funeral bell; C8 ossuary, flooded crypt, choir loft
  stairs: (rng, floor, goal, rooms) => deadEndStairs(rng, floor, goal, rooms),
  arrival: (rng, floor, start, rooms) => deadEndArrival(rng, floor, start, rooms),
  dressRoom: (rng, floor, grid, room) => { if (!room.hall) dressCryptRoom(rng, floor, grid, room); },
  beforeStages: (rng, floor, rooms, grid) => dressCryptFloor(rng, floor, rooms, grid),
  // After the attempt (1.7's post-passes, in their order): the hall cleared, ooze, wall growth, the scatter rules.
  finish: (b) => {
    const { floor, rooms, grid, gen } = b;
    clearHall(floor);
    cryptOoze(gen.rng, floor, rooms);
    cryptWallVeg(gen.rng, floor);
    cryptScatterRules(gen.rng, floor, rooms, grid);
    repairWallPieces(floor);
    floor.ooze = [...new Set(floor.ooze ?? [])];
    delete floor.oozeSet;
    if (floor.ooze.length) (floor.fields ??= []).push(oozeField(floor.ooze));
    // M47: Buried Ghouls are floor records, not bodies, until one emerges behind the hero (rules/crypt.js A1).
    for (let i = b.creatures.length - 1; i >= 0; i--) {
      const c = b.creatures[i];
      if (c.behaviour === 'ambusher' && c.params?.entry === 'buried') { (floor.buried ??= []).unshift(c); b.creatures.splice(i, 1); }
    }
  },
  wallTorches: true,   // wall sconces as in the Dungeon (they burn green, spec/world.md Crypt 51)
  vegetation: false,   // the Crypt keeps its own mushrooms (1.7 vegGrow runs in the Dungeon and the Caverns only)
});
