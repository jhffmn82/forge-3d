// Which area row the light reads (lighting.json areas): by the floor's band or plane, by a region's name, and whether
// the hero stands in a dark room. Pure: state and data in, rows out (lights.js, light-grid.js).

import data from '../../data/lighting.json' with { type: 'json' };

const P = data.rows.pipeline, AREAS = data.rows.areas, REGIONS = data.rows.regions;

/** The biome a floor's lighting reads, by its depth (1.7 level-lighting.js:41: the floorNo band). */
export const biomeOf = state => ['dungeon', 'crypt', 'caverns'][Math.min(2, Math.floor(((state.floorNo ?? 1) - 1) / 5))];

/** The hero stands in a room marked dark and carries no Light or Fire affinity (1.7 level-lighting.js:112). */
export function inDarkRoom(state) {
  const p = state.actors?.[state.playerId], aff = state.hero?.affinity ?? {};
  if (!p || aff.light > 0 || aff.fire > 0) return false;
  return (state.floor.rooms ?? []).some(r => r.dark && (r.cells ? r.cells.includes(p.y * state.floor.w + p.x) : p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h));
}

/** The area row a floor takes (a plane, else its band), or a region's by name. */
export function areaRow(state, region = null) {
  return AREAS[region] ?? AREAS[state.floor?.plane ?? state.plane] ?? AREAS[biomeOf(state)] ?? AREAS.dungeon;
}

/** Ambient and memory where the hero is (look 'relief' or 'classic'): a dark room keeps its memory, loses its ambient. */
export function area(state, look = 'relief', region = null) {
  const row = areaRow(state, region), classic = look === 'classic' ? row.classic ?? AREAS[biomeOf(state)].classic : null;
  const memory = classic ? classic.memory.map(v => v * P.memoryShareClassic) : row.memory;
  return { ambient: inDarkRoom(state) ? P.darkRoomAmbient : classic ? classic.ambient : row.ambient, memory };
}

/** The area index of each tile: a Realm floor's palette (W8) or an Underdark floor's regions, named by lighting.json
 *  regions for its biome, else one area for the whole floor. */
export function areasOf(state) {
  const f = state.floor, idx = f.palette?.at ?? f.region, names = f.treasureRoom ? ['dungeon'] : idx ? REGIONS[f.biome ?? state.where] ?? REGIONS.underdark : null;
  const base = areaRow(state);
  const list = names ? names.map(n => AREAS[n] ?? base) : [base];
  return { list, names: names ?? [f.plane ?? state.plane ?? biomeOf(state)], at: (x, y) => (names ? Math.max(0, Math.min(names.length - 1, idx[y * f.w + x] ?? 0)) : 0) };
}
