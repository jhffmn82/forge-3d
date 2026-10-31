// Item 208 (Justin 2026-10-19: "the first biome needs to be a little more visually interesting" and "we need more
// variety to bring people into the game"): the dressing on the walls' faces, chosen once a floor. Banners, chains, a
// shield and a tapestry hang on the hung layer (terrain.js root.hung, over the lip); niches and a drain lie in the
// face. No cracks, broken stone or stains (Justin: "get rid of these wall decals, they are too small and just look
// muddy"), no cobweb (item 314, Justin 2026-10-22: "we need to drop this art entirely"). Sparse and spaced: never two
// within two cells, never on or beside a door, a torch or a face's end block. The room a face looks into dresses it by
// its template's walls (rooms.json, item 233: its share of banners, whether ivy may grow, what it keeps, as a guardroom
// its shackles and an ossuary its skulls in niches); what it neither hangs nor keeps stays bare. A collapsed floor
// hangs few banners. Item 231 (Justin: "vines for the walls (in rooms with vegitatation)"): his ivy hangs from the
// ledge of the faces of rooms that grow something (grass or moss on the ground, a bush, fern, vines or mossy boulder)
// where the template lets it, now and then mirrored, with roots and moss, and its corner piece takes a wall's top-left
// end there; a bare room has none. All but two banners are the Dungeon's own (tools/assets/vendor/wall-dressing, drawn
// in PixelLab): another biome's walls take only those. Pure: the floor and a few questions about it in, the pieces by
// cell out.

import { T, G, isDoor } from '../data/tiles.js';
import { hash2 } from '../lib/noise.js';
import rooms from '../../data/rooms.json' with { type: 'json' };

const BANNERS = ['banner-1', 'banner-2'], DUNGEON_BANNERS = ['banner-oak', 'banner-sun', 'banner-swords'];
const IVY = ['ivy-hanging', 'ivy-branching', 'ivy-white-flowers', 'ivy-tuft', 'ivy-berries', 'ivy-withered', 'roots'];
const MOSS = ['moss-1', 'moss-2'];
const HUNG = /^(banner|ivy|roots|shackles|chain|shield|tapestry)/;   // on the hung layer, over the lip
/** The capstone's depth over a face, in tiles (terrain.js draws its rim over the face's lip; 20 of 64). */
export const RIM = 20 / 64;
// Item 260 (Justin 2026-10-20: "this art needs to be lowered on the wall:"): a niche lies in its face under the rim, its
// base at the face's foot, never up over the rim or the wall's top.
const IN_FACE = { s: 1 - RIM, dy: RIM / 2 };
/** A room's walls by its template (rooms.json); a corridor or a room without one (1.7's classic floors): ivy where it
 *  grows, a third of its pieces banners, some kept. */
const NONE = { ivy: true, banners: 0.35, kept: ['niche-urn-2', 'niche-skull-1', 'chain-2', 'grate'], keep: 0.2 };
export const wallsOf = room => rooms.rows[room?.template]?.walls ?? NONE;
const RATE = 0.5;   // of the faces that may take a piece, before spacing (the spacing keeps it sparse)
const IVY_SHARE = 0.6, MOSS_SHARE = 0.5;   // of a growing room's pieces, then of the rest
const GREEN_GROUND = new Set([G.GRASS, G.SHORT, G.MOSS]), GREEN_PROPS = /^(bush|vines|fern|mossy-boulder)$/;

/** The rooms that grow something: grass or moss on their ground, or a bush, fern, vines or mossy boulder in them. */
export function greenRooms(floor) {
  const W = floor.w, inside = (r, x, y) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
  return new Set((floor.rooms ?? []).filter(r => {
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) if (GREEN_GROUND.has(floor.ground?.[y * W + x])) return true;
    return (floor.props ?? []).some(p => GREEN_PROPS.test(p.id) && inside(r, p.x, p.y));
  }));
}

/**
 * @param {{w:number, h:number, tiles:ArrayLike<number>, ground?:ArrayLike<number>, props?:any[], rooms?:any[], mood?:string}} floor
 * @param {{face:(x:number,y:number)=>boolean, end:(x:number,y:number)=>string|null, torch:(x:number,y:number)=>boolean,
 *   salt?:number, biome?:string}} q face: a wall face; end: which of its end blocks it is ('left', 'right', 'both') or
 *   null; torch: a torch hangs there; biome: whose walls (the Crypt hangs no banners, RL20)
 * @returns {Map<number, {name:string, hung:boolean, flip:boolean, s?:number, dy?:number}>} by cell index; s and dy: a
 *   niche's size and drop in its face (terrain.js decal)
 */
export function wallDecor(floor, { face, end, torch, salt = 0, biome = 'dungeon' }) {
  const W = floor.w, H = floor.h, out = new Map(), dungeon = biome === 'dungeon', green = dungeon ? greenRooms(floor) : new Set();
  const banners = biome === 'crypt' ? [] : dungeon ? [...BANNERS, ...DUNGEON_BANNERS] : BANNERS;
  const tile = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? T.WALL : floor.tiles[y * W + x]);
  const doorNear = (x, y) => [[0, 0], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]].some(([dx, dy]) => isDoor(tile(x + dx, y + dy)) || tile(x + dx, y + dy) === T.OPEN_DOOR);
  const roomOf = (x, y) => floor.rooms?.find(r => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h);
  const cells = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!face(x, y) || tile(x, y) === T.SECRET || doorNear(x, y) || torch(x, y) || torch(x - 1, y) || torch(x + 1, y)) continue;
    const e = end(x, y), room = roomOf(x, y + 1), walls = wallsOf(room), growing = !!room && walls.ivy && green.has(room);
    if (e && !(growing && (e === 'left' || e === 'both'))) continue;   // an end block takes only a growing room's corner ivy
    if (hash2(x, y, salt + 82) < RATE) cells.push([x, y, e, walls, growing]);
  }
  cells.sort((a, b) => hash2(a[0], a[1], salt + 81) - hash2(b[0], b[1], salt + 81));
  const taken = [], from = (list, x, y) => list[Math.floor(hash2(x, y, salt + 84) * list.length)];
  const put = (k, name, flip = false) => out.set(k, { name, hung: HUNG.test(name), flip, ...(/^niche-/.test(name) ? IN_FACE : {}) });
  for (const [x, y, e, walls, growing] of cells) {
    if (taken.some(([tx, ty]) => Math.abs(tx - x) <= 2 && Math.abs(ty - y) <= 2)) continue;
    const k = y * W + x;
    if (e) put(k, 'ivy-corner');
    else if (growing && hash2(x, y, salt + 85) < IVY_SHARE) put(k, from(IVY, x, y), hash2(x, y, salt + 86) < 0.5);
    else if (growing && hash2(x, y, salt + 87) < MOSS_SHARE) put(k, from(MOSS, x, y));
    else {
      const share = !banners.length ? 0 : floor.mood === 'collapsed' ? Math.min(0.1, walls.banners) : walls.banners;
      if (hash2(x, y, salt + 83) < share) put(k, from(banners, x, y));
      else if (dungeon && walls.kept.length && hash2(x, y, salt + 88) < walls.keep) put(k, from(walls.kept, x, y));
    }
    if (out.has(k)) taken.push([x, y]);
  }
  return out;
}
