// The floor fields generation lays (consolidation W5, world-18; W6, world-27): the Crypt's grave ooze, a tomb's
// consecrated ground and a poison vault's gas, each built from its data row. Pure records for src/rules/fields.js;
// kept apart so the pockets and the shared specials need not import a biome.

import biomes from '../../data/biomes.json' with { type: 'json' };
import rooms from '../../data/rooms.json' with { type: 'json' };
import puzzles from '../../data/puzzles.json' with { type: 'json' };

const OOZE = biomes.rows['hazard-grave-ooze'].effects[0], HOLY = rooms.rows['heroes-tomb'].layout.consecrated;
const GAS = puzzles.rows.poisonvault.hazards[0].effects[0];

/** A18: the floor's grave ooze as one permanent field (biomes.json hazard-grave-ooze; src/rules/fields.js): 1 poison
 *  a game turn, direct (no guards or wards), sparing the undead, objects, fliers, oozes and the sporeproof. */
export function oozeField(cells) {
  return {
    id: 'field-ooze', kind: 'poison-trail', ooze: true, cells: cells.slice(), until: null, side: 'all', eachOnce: [], owner: null, byPlayer: false, seen: [],
    each: structuredClone(OOZE.each),
  };
}

/** The tomb's consecrated ground (rooms.json heroes-tomb): holy ground of its power (heals the hero's side that much a
 *  game turn) that burns foes for its damage in light. */
export const consecrated = cells => ({
  id: 'field-consecrated', kind: 'holy-ground', cells: cells.slice(), until: null, side: 'all', eachOnce: [], owner: null, byPlayer: true, seen: [],
  each: [
    { verb: 'damage', type: 'light', amount: HOLY.damage, tags: ['environment', 'ground', 'periodic'], if: { 'target-is': 'creature' } },
    { verb: 'heal', amount: HOLY.power, if: { not: { 'target-is': 'creature' } } },
  ],
});

/** A poison vault's gas (puzzles.json poisonvault): its damage in poison each turn, sparing the undead, objects and the
 *  gas-immune (as the Crypt's gas, world.md 144); `door`: the vault's door, which names the field. */
export const vaultGas = (cells, door) => ({
  id: `puzzle-gas-${door.x}-${door.y}`, kind: 'gas', cells, until: null, side: 'all', owner: null, byPlayer: false, seen: [], eachOnce: [],
  each: [{ verb: 'damage', type: GAS.type, amount: GAS.amount, tags: ['environment', 'area', 'ground'], if: { not: { any: [{ 'creature-flag': 'undead' }, { 'creature-flag': 'object' }, { 'creature-flag': 'gas-immune' }] } } }],
  puzzleDoor: { ...door },
});
