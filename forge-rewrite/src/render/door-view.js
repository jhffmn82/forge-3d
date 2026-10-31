// The doors drawn from the walls-and-doors art (consolidation M9: moved out of structures.js, which places them; the
// art packet art-packets/walls-doors.md, sheet environment-walls-doors): side doors shut and open, and the open front
// doors 1.7 had no painted open state for.

import { Container, Sprite } from '../../../forge-godot/runtime/pixi.js';
import { T } from '../data/tiles.js';
import { sheet, hasSheet } from './art-store.js';
import { recolour } from './realm-palette.js';

const SHEET = 'environment-walls-doors';
/** A shut door's material (1.7 render.js doorMaterial); an open one keeps the material the rules noted (RC7). */
export function doorMaterial(floor, x, y, t) {
  if (t === T.OPEN_DOOR) return floor.doorMaterials?.[y * floor.w + x] ?? 'wood';
  if (t === T.DOOR) return floor.biome === 'crypt' ? 'crypt' : 'wood';
  if (t === T.SEALED) return floor.crystalVault?.door.x === x && floor.crystalVault?.door.y === y ? 'crystal' : 'iron';
  return t === T.LOCKED ? 'iron' : t === T.TOLL ? 'spiked' : t === T.ICE_DOOR ? 'ice' : t === T.THORNS ? 'thorns' : 'wood';
}

/** One cell of the sheet, on a Chaos island regraded into the island's palette as the art it stands for (realm-palette.js;
 *  CH-R16, 1.7 doorPalette). */
function cell(key, pal, as) {
  const tex = sheet(SHEET).textures[key];
  return tex ? new Sprite(pal ? recolour(tex, pal, as) : tex) : null;
}
// A side door's leaf in its 128 px canvas (D1 shut, D2 open, every material): rows 28 to 100 on column 52, three planks
// across, swung open from there 72 px east. Item 196 (Justin 2026-10-19: "the side doors shouldn't be so narrow"): the
// leaf runs the doorway's whole length, the tile north to south, on the wall's centre line. Item 261 (Justin 2026-10-20:
// "I wanted the door to fill the height of it's cell, if anything the door is too thick and should thinner than it is
// (like 2 of the 3 segments)"): shut, it reaches SHUT.over of a tile past each end, under the frame's caps, so no floor
// shows between. It is LEAF.wide of its art thick, two planks, shut (across) and open (down, swung back along the
// doorway's north side, item 199; Justin 2026-10-20: "we didn't reduce the width of open side doors, only when closed").
const LEAF = { top: 28, len: 72, mid: 52, wide: 2 / 3 }, SHUT = { over: 0.04 };

/**
 * A side door (in a north-south wall), shut or open, or an open front door that has no 1.7 open picture (structures.js
 * draws wood's and iron's) (item 176, Justin 2026-10-19: "the side doors look bad and you can't see the door when
 * open"). A side door is its leaf alone (the packet's D1, D2), filling its doorway north to south shut and swung back
 * along its north side open; its frame is the wall's own capstone lintels and caps on the wall tiles north and south of
 * it (terrain.js, items 190 and 196: the packet's W13 terminals read as iron brackets). A front door's leaf stands swung
 * inside its arch (D3 on W14, their canvases on the tile), the Crypt's in its purple-grey masonry.
 * null until the sheet is in. The terrain lays floor under an open door.
 */
export function doorGraphic(floor, x, y, t, side, TS) {
  if (!hasSheet(SHEET)) return null;
  const mat = doorMaterial(floor, x, y, t), open = t === T.OPEN_DOOR, c = new Container(), ch = floor.chaos;
  const pal = ch ? ch.regions?.[ch.regionOf?.[y * floor.w + x]]?.palette ?? null : null, leaf = mat === 'iron' ? 'door-iron' : 'door-wood';
  const parts = side ? [[`${open ? 'd2' : 'd1'}/side-${mat}-${open ? 'open' : 'closed'}`, leaf]]
    : [[`w14/front-door-frame-${mat === 'crypt' ? 'crypt' : 'iron'}`, 'archway'], [`d3/front-${mat}-open`, leaf]];
  const k = side ? TS / LEAF.len : TS / 128, shut = side && !open, o = shut ? SHUT.over : 0;   // screen px per canvas px
  const kx = shut ? k * LEAF.wide : k, ky = side && open ? k * LEAF.wide : k * (1 + 2 * o);
  for (const [key, as] of parts) {
    const s = cell(key, pal, as); if (!s) continue;
    s.width = 128 * kx; s.height = 128 * ky;
    s.position.set(side ? (x + 0.5) * TS - LEAF.mid * kx : x * TS, side ? (y - o) * TS - LEAF.top * ky : y * TS);
    c.addChild(s);
  }
  return c.children.length ? c : (c.destroy(), null);
}
