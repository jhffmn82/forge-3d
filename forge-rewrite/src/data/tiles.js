// The terrain layer's tiles (spec/world.md "Tiles"): one table that moving, sight, drawing and light all read.

export const T = {
  WALL: 0, FLOOR: 1, DOOR: 2, STAIRS: 3, CHEST: 4, FORGE: 5, RUBBLE: 6, OPEN_DOOR: 7, CHASM: 8, LOCKED: 9,
  SHRINE: 10, ICE_DOOR: 11, THORNS: 12, EXIT: 13, TOLL: 14, SECRET: 15, WATER: 16, BRIDGE: 17, SEALED: 18,
  STAIRS_UP: 19, PORTAL: 20, LAVA: 21,
};

const WALKABLE = new Set([T.FLOOR, T.OPEN_DOOR, T.STAIRS, T.STAIRS_UP, T.RUBBLE, T.WATER, T.BRIDGE, T.PORTAL]);
const OPAQUE = new Set([T.WALL, T.DOOR, T.LOCKED, T.ICE_DOOR, T.THORNS, T.TOLL, T.SECRET, T.SEALED]);
/** Doors of every kind, shut, open, locked, sealed or hidden (spec/world.md Tiles: the door column). */
const DOORS = new Set([T.DOOR, T.OPEN_DOOR, T.LOCKED, T.ICE_DOOR, T.THORNS, T.TOLL, T.SEALED, T.SECRET]);
/** Tiles that are a piece of the floor's furniture: nothing else is put on them (chests, stairs, doors, Forge, shrine). */
const OBJECTS = new Set([T.CHEST, T.STAIRS, T.FORGE, T.DOOR, T.OPEN_DOOR, T.STAIRS_UP, T.PORTAL, T.SHRINE, T.EXIT]);
/** Tiles drawn as wall (the wall art): walls and the doors that look like wall. */
const WALL_LIKE = new Set([T.WALL, T.SECRET]);

export const tileAt = (floor, x, y) => (x < 0 || y < 0 || x >= floor.w || y >= floor.h ? T.WALL : floor.tiles[y * floor.w + x]);

/** A tile a body may stand on (the open exit and blocking props aside). */
export const walkTile = t => WALKABLE.has(t);
/** A door tile of any kind. */
export const isDoor = t => DOORS.has(t);
/** A furniture tile (an object tile): chest, stairs, door, Forge, shrine, portal, exit. */
export const isObjectTile = t => OBJECTS.has(t);

/** Can a body stand here? (The open exit and blocking props are checked by their owners.) */
export const walkable = (floor, x, y) => WALKABLE.has(tileAt(floor, x, y)) || (tileAt(floor, x, y) === T.EXIT && !!floor.exitOpen);

/** Does this tile stop sight and light? (spec/sight.md V4; world.md "Tiles": tall grass too, ground code 1.) */
// Tall grass hides what is behind it; the Crypt's glowing mushrooms share its ground code and do not (1.7 geometry.js:21-24,
// cryptset.js:432 cryptShrooms: Crypt floors, not a plane).
export const opaque = (floor, x, y) => OPAQUE.has(tileAt(floor, x, y)) || (floor.ground?.[y * floor.w + x] === 1 && !(floor.biome === 'crypt' && !floor.plane)) || !!floor.rocks?.[y * floor.w + x];   // Upheaval's rocks (magic.md D30)

/** A tile code drawn as wall: a wall or a hidden door (render-23: the painters' local copies read this). */
export const isWallTile = t => WALL_LIKE.has(t);
/** A tile code that stops sight and light by itself: walls and the shut doors of every kind. */
export const isOpaqueTile = t => OPAQUE.has(t);

/** Is this tile drawn with the wall art? */
export const wallLike = (floor, x, y) => WALL_LIKE.has(tileAt(floor, x, y));

/** Passable for route checks: walkable, or a shut door or a chest (spec/world.md W11). */
export const passable = (floor, x, y) => walkable(floor, x, y) || [T.DOOR, T.CHEST].includes(tileAt(floor, x, y));

// The ground layer's kinds and reader (consolidation C5: moved from world/ground.js with the tiles).
/** Ground codes, as 1.7 numbers them (js/world/world.js:9). */
export const G = { NONE: 0, GRASS: 1, SHORT: 2, ASH: 3, PUDDLE: 4, BLOOD: 5, SCORCH: 6, MOSS: 7, BONES: 8, ICE: 9, TELL: 10, WEB: 11 };
/** Item 207: the Dungeon floor's wear (floor.wear, world/ground.js wear): an old room's cracks, damp by water (no worn paths). */
export const WEAR = { NONE: 0, CRACKED: 2, DAMP: 3 };
