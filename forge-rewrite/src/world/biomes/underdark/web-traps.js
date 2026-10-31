import { T } from '../../../data/tiles.js';

/** Replace placed web scenery with visible, functional web traps, including on loaded floors. A web whose cell is not
 *  open floor, or holds another prop (a trap never lies under a prop, W12), stays scenery. */
export function replaceWebScenery(floor) {
  if (floor.biome !== 'underdark') return;
  const WEB = /^web-(floor-[1-4]|corner-[12]|curtain-[hv])$/, kept = [], traps = floor.traps ??= [];
  const held = new Set((floor.props ?? []).filter(p => !WEB.test(p.id)).map(p => p.y * floor.w + p.x));
  for (const p of floor.props ?? []) {
    if (!WEB.test(p.id)) { kept.push(p); continue; }
    const x = p.x, y = p.y + (p.wall ? 1 : 0);
    if (floor.tiles[y * floor.w + x] !== T.FLOOR || held.has(y * floor.w + x)) { kept.push(p); continue; }
    const trap = traps.find(t => t.x === x && t.y === y);
    if (trap) { trap.kind = 'web'; trap.found = true; }
    else traps.push({ x, y, kind: 'web', found: true });
  }
  floor.props = kept;
}
